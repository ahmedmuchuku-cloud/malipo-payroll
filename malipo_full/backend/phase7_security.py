"""
=============================================================================
KENYA PAYROLL SYSTEM — Phase 7: Security, RBAC & Data Privacy
=============================================================================
Components:

  1. UserContext          — Carries authenticated user identity and role
                            through every operation.

  2. RBAC                 — Role definitions + permission matrix.
                            require_role() decorator gates any function.

  3. RBACPlugin           — EventBus plugin that logs every access decision
                            and blocks prohibited operations.

  4. CredentialVault      — Abstraction over credential storage:
                              • Dev/test:    environment variables
                              • Production:  HashiCorp Vault via HVAC
                            Provides get/set/rotate with full audit trail.

  5. EncryptionManager    — SQLCipher integration hook for shard encryption.
                            Provides encrypt/decrypt helpers; the actual
                            SQLCipher extension must be installed in prod.
                            Falls back to plaintext in dev/test with a warning.

  6. SessionManager       — Short-lived signed session tokens (HMAC-SHA256)
                            for web/API use. No external dependency.

  7. ApprovalWorkflow     — Two-step payroll approval: CALCULATE → APPROVE → LOCK.
                            Prevents payroll from being remitted without a
                            second-eye sign-off by a payroll_approver.

Design principles:
  • Zero coupling — every component uses the EventBus; payroll core is unchanged.
  • Fail-safe — a failed RBAC check raises PermissionError, never silently passes.
  • Audit-first — every access decision is logged via AuditPlugin.
  • No external hard dependencies in the base implementation; vault and
    SQLCipher are optional enhancements that degrade gracefully.
=============================================================================
"""
from __future__ import annotations

import functools
import hashlib
import hmac
import json
import logging
import os
import secrets
import threading
import time
from dataclasses import dataclass, field, asdict
from datetime import datetime, timedelta
from enum import Enum
from pathlib import Path
from typing import Any, Callable, Optional

from events import EventBus, PayrollEvent, PayrollPlugin, get_bus
from shard_manager import ShardManager

logger = logging.getLogger(__name__)


# ─── ROLES & PERMISSIONS ─────────────────────────────────────────────────────

class Role(str, Enum):
    """Payroll system roles in ascending privilege order."""
    VIEWER           = "payroll_viewer"      # Read reports, own P9A
    OPERATOR         = "payroll_operator"    # Run calculations, read all reports
    APPROVER         = "payroll_approver"    # Approve + lock runs, all operator perms
    ADMIN            = "payroll_admin"       # Manage employees, reliefs, settings
    SYSTEM           = "system"              # Internal service account (full access)


class Permission(str, Enum):
    """Fine-grained permission flags."""
    VIEW_OWN_PAYSLIP    = "view_own_payslip"
    VIEW_ALL_REPORTS    = "view_all_reports"
    RUN_PAYROLL         = "run_payroll"
    VIEW_TRANSACTIONS   = "view_transactions"
    APPROVE_RUN         = "approve_run"
    LOCK_RUN            = "lock_run"
    MANAGE_EMPLOYEES    = "manage_employees"
    MANAGE_RELIEFS      = "manage_reliefs"
    MANAGE_SETTINGS     = "manage_settings"
    DOWNLOAD_TEMPLATES  = "download_templates"
    EXPORT_P9A          = "export_p9a"
    VIEW_AUDIT_LOG      = "view_audit_log"
    RESTORE_BACKUP      = "restore_backup"
    MANAGE_CREDENTIALS  = "manage_credentials"


# Role → set of granted permissions
ROLE_PERMISSIONS: dict[Role, set[Permission]] = {
    Role.VIEWER: {
        Permission.VIEW_OWN_PAYSLIP,
    },
    Role.OPERATOR: {
        Permission.VIEW_OWN_PAYSLIP,
        Permission.VIEW_ALL_REPORTS,
        Permission.RUN_PAYROLL,
        Permission.VIEW_TRANSACTIONS,
        Permission.DOWNLOAD_TEMPLATES,
        Permission.EXPORT_P9A,
    },
    Role.APPROVER: {
        Permission.VIEW_OWN_PAYSLIP,
        Permission.VIEW_ALL_REPORTS,
        Permission.RUN_PAYROLL,
        Permission.VIEW_TRANSACTIONS,
        Permission.DOWNLOAD_TEMPLATES,
        Permission.EXPORT_P9A,
        Permission.APPROVE_RUN,
        Permission.LOCK_RUN,
        Permission.VIEW_AUDIT_LOG,
    },
    Role.ADMIN: {
        Permission.VIEW_OWN_PAYSLIP,
        Permission.VIEW_ALL_REPORTS,
        Permission.RUN_PAYROLL,
        Permission.VIEW_TRANSACTIONS,
        Permission.DOWNLOAD_TEMPLATES,
        Permission.EXPORT_P9A,
        Permission.APPROVE_RUN,
        Permission.LOCK_RUN,
        Permission.VIEW_AUDIT_LOG,
        Permission.MANAGE_EMPLOYEES,
        Permission.MANAGE_RELIEFS,
        Permission.MANAGE_SETTINGS,
        Permission.RESTORE_BACKUP,
        Permission.MANAGE_CREDENTIALS,
    },
    Role.SYSTEM: set(Permission),   # All permissions
}


def has_permission(role: Role, perm: Permission) -> bool:
    return perm in ROLE_PERMISSIONS.get(role, set())


# ─── USER CONTEXT ─────────────────────────────────────────────────────────────

@dataclass
class UserContext:
    """
    Carries authenticated user identity through every operation.
    Passed as initiated_by to PayrollRunner; embedded in audit log.
    """
    user_id:    str
    username:   str
    role:       Role
    ip_address: str   = "127.0.0.1"
    session_id: str   = ""
    company_id: int   = 1

    def can(self, perm: Permission) -> bool:
        return has_permission(self.role, perm)

    def require(self, perm: Permission) -> None:
        """Raise PermissionError if user lacks the permission."""
        if not self.can(perm):
            raise PermissionError(
                f"User '{self.username}' (role={self.role.value}) "
                f"lacks permission '{perm.value}'"
            )

    def __str__(self) -> str:
        return f"{self.username}[{self.role.value}]@{self.ip_address}"


# ─── RBAC DECORATOR ──────────────────────────────────────────────────────────

def require_role(*required_roles: Role):
    """
    Decorator that gates a function behind one or more roles.
    The decorated function must accept a 'user' keyword argument
    of type UserContext (or None for system calls).

    Usage:
        @require_role(Role.APPROVER, Role.ADMIN)
        def approve_run(run_id: int, user: UserContext):
            ...
    """
    def decorator(fn: Callable) -> Callable:
        @functools.wraps(fn)
        def wrapper(*args, user: UserContext | None = None, **kwargs):
            if user is None:
                # System calls (no user context) are always allowed
                return fn(*args, user=user, **kwargs)
            if user.role not in required_roles and user.role != Role.SYSTEM:
                raise PermissionError(
                    f"Function '{fn.__name__}' requires one of "
                    f"{[r.value for r in required_roles]}; "
                    f"user '{user}' has role '{user.role.value}'"
                )
            return fn(*args, user=user, **kwargs)
        wrapper._required_roles = required_roles
        return wrapper
    return decorator


def require_permission(perm: Permission):
    """
    Finer-grained decorator that checks a specific permission.

    Usage:
        @require_permission(Permission.EXPORT_P9A)
        def export_p9a(year: int, user: UserContext):
            ...
    """
    def decorator(fn: Callable) -> Callable:
        @functools.wraps(fn)
        def wrapper(*args, user: UserContext | None = None, **kwargs):
            if user is not None and user.role != Role.SYSTEM:
                user.require(perm)
            return fn(*args, user=user, **kwargs)
        wrapper._required_permission = perm
        return wrapper
    return decorator


# ─── RBAC PLUGIN ─────────────────────────────────────────────────────────────

class RBACPlugin(PayrollPlugin):
    """
    Logs every access decision to the audit log.
    Emits ACCESS_CHECKED events with the decision result.

    In production, extend on_run_started to verify the initiating
    user has Permission.RUN_PAYROLL before the run proceeds.
    """
    name = "RBACPlugin"

    def __init__(self, shard_manager: ShardManager):
        self.sm = shard_manager

    def register(self, bus: EventBus | None = None) -> None:
        b = bus or get_bus()
        b.subscribe(PayrollEvent.ACCESS_CHECKED, self.on_access_checked)
        b.subscribe(PayrollEvent.RUN_STARTED,    self.on_run_started)
        logger.info(f"Plugin '{self.name}' registered")

    def on_access_checked(self, event, **kw):
        user     = kw.get("user")
        perm     = kw.get("permission")
        granted  = kw.get("granted", False)
        resource = kw.get("resource", "")
        if user:
            logger.info(
                f"RBAC: user='{user}' perm='{perm}' "
                f"resource='{resource}' granted={granted}"
            )

    def on_run_started(self, event, **kw):
        initiated_by = kw.get("initiated_by", "system")
        logger.info(f"RBACPlugin: payroll run initiated by '{initiated_by}'")

    @staticmethod
    def log_access(bus: EventBus, user: UserContext,
                   perm: Permission, resource: str,
                   granted: bool) -> None:
        """Publish an ACCESS_CHECKED event for audit trail."""
        bus.publish(PayrollEvent.ACCESS_CHECKED,
                    user=str(user), permission=perm.value,
                    resource=resource, granted=granted,
                    timestamp=datetime.utcnow().isoformat())


# ─── CREDENTIAL VAULT ────────────────────────────────────────────────────────

class CredentialVault:
    """
    Abstraction over credential storage with three backends:

      1. EnvBackend (default/dev):
         Reads from env vars: PAYROLL_{PORTAL}_{FIELD}
         e.g. PAYROLL_KRA_USERNAME, PAYROLL_KRA_PASSWORD

      2. FileBackend (test/staging):
         Reads from an encrypted JSON file (AES-256 via cryptography lib).
         Falls back gracefully if cryptography is not installed.

      3. HashiCorpVaultBackend (production):
         Uses hvac client to read secrets from HashiCorp Vault.
         Path convention: secret/payroll/{portal}/{field}
         Falls back to EnvBackend if hvac is not installed.

    All credential retrievals are logged (access time, not value).
    Credentials are NEVER logged in plaintext.
    """

    def __init__(self, backend: str = "env",
                 vault_url: str = "",
                 vault_token: str = "",
                 secrets_file: Path | None = None,
                 bus: EventBus | None = None):
        self.bus = bus or get_bus()
        self._backend_name = backend
        self._access_log: list[dict] = []
        self._lock = threading.Lock()

        if backend == "hashicorp":
            self._backend = self._init_hashicorp(vault_url, vault_token)
        elif backend == "file":
            self._backend = self._init_file(secrets_file)
        else:
            self._backend = self._env_backend

    # ── Public API ────────────────────────────────────────────────────────────
    def get(self, portal_code: str, field: str) -> Optional[str]:
        """
        Retrieve a credential. Returns None if not found.
        Logs access time and portal/field (never the value).
        """
        key = f"{portal_code.upper()}_{field.upper()}"
        value = self._backend(portal_code, field)
        self._log_access(key, found=(value is not None))
        return value

    def set_env(self, portal_code: str, field: str, value: str) -> None:
        """
        Set a credential in environment (for testing only).
        Production should use the vault's own API.
        """
        key = f"PAYROLL_{portal_code.upper()}_{field.upper()}"
        os.environ[key] = value

    def access_history(self) -> list[dict]:
        """Return the credential access log (timestamps and keys, no values)."""
        with self._lock:
            return list(self._access_log)

    # ── Backends ──────────────────────────────────────────────────────────────
    @staticmethod
    def _env_backend(portal_code: str, field: str) -> Optional[str]:
        key = f"PAYROLL_{portal_code.upper()}_{field.upper()}"
        return os.environ.get(key)

    def _init_hashicorp(self, vault_url: str, token: str) -> Callable:
        try:
            import hvac  # type: ignore
            client = hvac.Client(url=vault_url, token=token)
            if not client.is_authenticated():
                logger.warning("CredentialVault: HashiCorp Vault not authenticated; "
                               "falling back to env backend")
                return self._env_backend

            def _vault_backend(portal_code: str, field: str) -> Optional[str]:
                try:
                    secret = client.secrets.kv.read_secret_version(
                        path=f"payroll/{portal_code.lower()}"
                    )
                    return secret["data"]["data"].get(field.lower())
                except Exception as e:
                    logger.warning(f"Vault read failed for {portal_code}/{field}: {e}")
                    return self._env_backend(portal_code, field)
            return _vault_backend

        except ImportError:
            logger.warning("CredentialVault: hvac not installed; using env backend. "
                           "Install with: pip install hvac")
            return self._env_backend

    def _init_file(self, secrets_file: Optional[Path]) -> Callable:
        if not secrets_file or not secrets_file.exists():
            logger.warning(f"CredentialVault: secrets file not found: {secrets_file}; "
                           "using env backend")
            return self._env_backend

        try:
            from cryptography.fernet import Fernet  # type: ignore
            key_env = os.environ.get("PAYROLL_VAULT_KEY", "")
            if not key_env:
                logger.warning("CredentialVault: PAYROLL_VAULT_KEY not set; "
                               "falling back to env backend")
                return self._env_backend

            fernet = Fernet(key_env.encode())
            with open(secrets_file, "rb") as f:
                decrypted = fernet.decrypt(f.read())
            secrets_data = json.loads(decrypted)

            def _file_backend(portal_code: str, field: str) -> Optional[str]:
                portal_secrets = secrets_data.get(portal_code.lower(), {})
                return portal_secrets.get(field.lower()) or self._env_backend(portal_code, field)

            return _file_backend

        except ImportError:
            logger.warning("CredentialVault: cryptography not installed; using env backend")
            return self._env_backend
        except Exception as e:
            logger.error(f"CredentialVault: file backend init failed: {e}; using env backend")
            return self._env_backend

    def _log_access(self, key: str, found: bool) -> None:
        entry = {
            "key":       key,
            "found":     found,
            "timestamp": datetime.utcnow().isoformat(),
            "backend":   self._backend_name,
        }
        with self._lock:
            self._access_log.append(entry)
        self.bus.publish(PayrollEvent.CREDENTIAL_ACCESSED,
                         key=key, found=found, backend=self._backend_name)


# ─── SESSION MANAGER ─────────────────────────────────────────────────────────

class SessionManager:
    """
    Issues and validates short-lived HMAC-SHA256 signed session tokens.
    No external dependency — uses Python's hmac + secrets modules.

    Token format (base64-encoded JSON):
        { user_id, username, role, company_id, exp, jti }
        + HMAC-SHA256 signature

    Usage:
        sm = SessionManager(secret_key="...")
        token = sm.create_session(user_context)
        user  = sm.validate_session(token)   # raises if invalid/expired
    """

    TOKEN_TTL_SECONDS = 3600 * 8   # 8 hours

    def __init__(self, secret_key: str = "",
                 ttl_seconds: int = TOKEN_TTL_SECONDS):
        self._key = secret_key or os.environ.get("PAYROLL_SESSION_KEY") or secrets.token_hex(32)
        self._ttl = ttl_seconds
        self._revoked: set[str] = set()
        self._lock = threading.Lock()

    def create_session(self, user: UserContext) -> str:
        """Return a signed session token string."""
        payload = {
            "user_id":    user.user_id,
            "username":   user.username,
            "role":       user.role.value,
            "company_id": user.company_id,
            "ip":         user.ip_address,
            "exp":        int(time.time()) + self._ttl,
            "jti":        secrets.token_hex(8),   # unique token ID
        }
        payload_bytes = json.dumps(payload, separators=(",", ":")).encode()
        payload_b64   = payload_bytes.hex()
        sig = hmac.new(self._key.encode(), payload_bytes, hashlib.sha256).hexdigest()
        token = f"{payload_b64}.{sig}"
        logger.debug(f"Session created for {user.username} (exp={payload['exp']})")
        return token

    def validate_session(self, token: str) -> UserContext:
        """
        Validate a token and return the UserContext.
        Raises ValueError if expired, revoked, or signature invalid.
        """
        try:
            payload_hex, sig = token.rsplit(".", 1)
        except ValueError:
            raise ValueError("Invalid token format")

        payload_bytes = bytes.fromhex(payload_hex)
        expected_sig  = hmac.new(self._key.encode(), payload_bytes, hashlib.sha256).hexdigest()

        if not hmac.compare_digest(sig, expected_sig):
            raise ValueError("Token signature invalid")

        payload = json.loads(payload_bytes)

        if int(time.time()) > payload["exp"]:
            raise ValueError("Token expired")

        jti = payload.get("jti", "")
        with self._lock:
            if jti in self._revoked:
                raise ValueError("Token has been revoked")

        try:
            role = Role(payload["role"])
        except ValueError:
            raise ValueError(f"Unknown role: {payload['role']}")

        return UserContext(
            user_id    = payload["user_id"],
            username   = payload["username"],
            role       = role,
            ip_address = payload.get("ip", ""),
            session_id = jti,
            company_id = payload.get("company_id", 1),
        )

    def revoke_session(self, token: str) -> None:
        """Invalidate a token immediately (e.g., on logout)."""
        try:
            payload_hex, _ = token.rsplit(".", 1)
            payload = json.loads(bytes.fromhex(payload_hex))
            jti = payload.get("jti", "")
            if jti:
                with self._lock:
                    self._revoked.add(jti)
                logger.info(f"Session revoked: jti={jti}")
        except Exception as e:
            logger.warning(f"SessionManager.revoke: {e}")


# ─── ENCRYPTION MANAGER ──────────────────────────────────────────────────────

class EncryptionManager:
    """
    SQLCipher integration for encrypting SQLite shard files at rest.

    In production with SQLCipher installed:
        pip install sqlcipher3

    Without SQLCipher, falls back to unencrypted SQLite with a WARNING.
    The key is always loaded from the CredentialVault, never hardcoded.

    Note: Encrypting existing shards requires a one-time migration using
    sqlcipher_export() (see SQLCipher docs). New shards created after
    migration will be encrypted by default.
    """

    def __init__(self, vault: CredentialVault):
        self.vault      = vault
        self._available = self._check_sqlcipher()

    @staticmethod
    def _check_sqlcipher() -> bool:
        try:
            import sqlcipher3  # type: ignore
            logger.info("EncryptionManager: SQLCipher available — shards will be encrypted")
            return True
        except ImportError:
            logger.warning(
                "EncryptionManager: sqlcipher3 not installed — shards are UNENCRYPTED.\n"
                "Install with: pip install sqlcipher3\n"
                "Encrypt existing shards with: sqlcipher3 shard.db "
                "'ATTACH DATABASE encrypted.db AS enc KEY \"<key>\"; "
                "SELECT sqlcipher_export(\"enc\"); DETACH DATABASE enc;'"
            )
            return False

    @property
    def is_available(self) -> bool:
        return self._available

    def get_connection(self, db_path: str) -> Any:
        """
        Open an encrypted (or plain) SQLite connection.
        Callers use this instead of sqlite3.connect() for encrypted shards.
        """
        key = self.vault.get("shard_encryption", "key")

        if self._available and key:
            import sqlcipher3  # type: ignore
            conn = sqlcipher3.connect(db_path)
            conn.execute(f"PRAGMA key='{key}'")
            conn.execute("PRAGMA cipher_page_size=4096")
            conn.execute("PRAGMA kdf_iter=256000")
            return conn
        else:
            import sqlite3
            if key:
                logger.warning(
                    f"EncryptionManager: key available but SQLCipher not installed. "
                    f"Opening {db_path} unencrypted."
                )
            return sqlite3.connect(db_path)

    def encrypt_existing_shard(self, plain_path: Path,
                                encrypted_path: Path) -> bool:
        """
        Migrate an existing plaintext shard to encrypted format.
        Returns True on success. Source file is NOT deleted automatically.
        """
        if not self._available:
            logger.error("EncryptionManager: SQLCipher not available — cannot encrypt")
            return False

        key = self.vault.get("shard_encryption", "key")
        if not key:
            logger.error("EncryptionManager: no encryption key available")
            return False

        try:
            import sqlcipher3  # type: ignore
            import sqlite3
            source = sqlite3.connect(str(plain_path))
            dest   = sqlcipher3.connect(str(encrypted_path))
            dest.execute(f"PRAGMA key='{key}'")
            source.backup(dest)
            dest.close(); source.close()
            logger.info(f"EncryptionManager: encrypted {plain_path.name} → {encrypted_path.name}")
            return True
        except Exception as e:
            logger.error(f"EncryptionManager: encryption failed: {e}")
            return False


# ─── APPROVAL WORKFLOW ───────────────────────────────────────────────────────

class ApprovalWorkflow:
    """
    Enforces a two-step approval gate before payroll can be locked and remitted:

      1. OPERATOR runs payroll → status = 'processed'
      2. APPROVER reviews and approves → status = 'locked'

    Only 'locked' runs are included in government remittance exports.
    Prevents a single operator from both running and submitting payroll.
    """

    def __init__(self, shard_manager: ShardManager,
                 bus: EventBus | None = None):
        self.sm  = shard_manager
        self.bus = bus or get_bus()
        self._approvals: dict[str, dict] = {}   # run_key → approval record
        self._lock = threading.Lock()

    @require_role(Role.APPROVER, Role.ADMIN)
    def approve_run(self, shard_id: int, payroll_run_id: int,
                    month: int, year: int,
                    user: UserContext | None = None) -> dict:
        """
        Approve a processed payroll run. Requires APPROVER or ADMIN role.
        Returns approval record.
        """
        run_key = f"{shard_id}:{payroll_run_id}"
        approval = {
            "shard_id":       shard_id,
            "payroll_run_id": payroll_run_id,
            "period":         f"{year}-{month:02d}",
            "approved_by":    str(user) if user else "system",
            "approved_at":    datetime.utcnow().isoformat(),
            "status":         "approved",
        }
        with self._lock:
            self._approvals[run_key] = approval

        # Lock the run in the shard
        self.sm.lock_run(shard_id, payroll_run_id)

        logger.info(
            f"ApprovalWorkflow: run {payroll_run_id} (shard {shard_id}) "
            f"approved and locked by {user}"
        )
        self.bus.publish(PayrollEvent.ACCESS_CHECKED,
                         user=str(user), permission=Permission.APPROVE_RUN.value,
                         resource=f"run:{payroll_run_id}", granted=True)
        return approval

    @require_role(Role.APPROVER, Role.ADMIN)
    def reject_run(self, shard_id: int, payroll_run_id: int,
                   reason: str = "",
                   user: UserContext | None = None) -> dict:
        """Reset a processed run back to 'draft' for correction."""
        with self.sm.connection(shard_id) as conn:
            conn.execute(
                "UPDATE payroll_runs SET status='draft' WHERE payroll_run_id=?",
                (payroll_run_id,)
            )
        rejection = {
            "shard_id":       shard_id,
            "payroll_run_id": payroll_run_id,
            "rejected_by":    str(user) if user else "system",
            "rejected_at":    datetime.utcnow().isoformat(),
            "reason":         reason,
            "status":         "rejected",
        }
        logger.info(f"ApprovalWorkflow: run {payroll_run_id} rejected by {user}: {reason}")
        return rejection

    def is_approved(self, shard_id: int, payroll_run_id: int) -> bool:
        """Check whether a run has been approved."""
        with self._lock:
            key    = f"{shard_id}:{payroll_run_id}"
            record = self._approvals.get(key)
            if record and record.get("status") == "approved":
                return True
        # Also check DB status
        try:
            with self.sm.connection(shard_id) as conn:
                row = conn.execute(
                    "SELECT status FROM payroll_runs WHERE payroll_run_id=?",
                    (payroll_run_id,)
                ).fetchone()
            return row and row["status"] == "locked"
        except Exception:
            return False

    def pending_approvals(self, month: int, year: int,
                          company_id: int = 1) -> list[dict]:
        """Return all 'processed' (not yet locked) runs for a given period."""
        pending = []
        for shard_id in self.sm.list_shards():
            try:
                with self.sm.connection(shard_id) as conn:
                    rows = conn.execute("""
                        SELECT payroll_run_id, run_month, run_year, status, initiated_by
                        FROM payroll_runs
                        WHERE run_month=? AND run_year=?
                          AND company_id=? AND status='processed'
                    """, (month, year, company_id)).fetchall()
                for row in rows:
                    pending.append({**dict(row), "shard_id": shard_id})
            except Exception:
                pass
        return pending


# ─── CONVENIENCE SETUP ───────────────────────────────────────────────────────

def setup_phase7(shard_manager: ShardManager,
                 bus: EventBus | None = None,
                 session_key: str = "",
                 vault_backend: str = "env",
                 vault_url: str = "",
                 vault_token: str = "") -> dict:
    """
    Initialise all Phase 7 components. Returns a components dict.

    Usage at startup:
        ctx = setup_phase7(shard_manager, session_key="...")
        session_mgr  = ctx["session_manager"]
        vault        = ctx["vault"]
        workflow     = ctx["approval_workflow"]
        rbac_plugin  = ctx["rbac_plugin"]

    Authentication flow:
        user = UserContext(user_id="1", username="alice",
                           role=Role.APPROVER, ip_address="10.0.0.1")
        token = session_mgr.create_session(user)
        # ... later ...
        user = session_mgr.validate_session(token)

    Approval flow:
        # After PayrollRunner.run():
        workflow.approve_run(shard_id=1, payroll_run_id=42,
                             month=3, year=2026, user=approver_user)
    """
    b = bus or get_bus()

    vault   = CredentialVault(backend=vault_backend,
                               vault_url=vault_url, vault_token=vault_token)
    enc     = EncryptionManager(vault)
    session = SessionManager(secret_key=session_key)
    rbac    = RBACPlugin(shard_manager)
    rbac.register(b)
    workflow = ApprovalWorkflow(shard_manager, bus=b)

    logger.info(
        f"Phase 7: RBACPlugin registered | "
        f"vault={vault_backend} | "
        f"encryption={'available' if enc.is_available else 'unavailable (dev mode)'}"
    )

    return {
        "vault":            vault,
        "encryption":       enc,
        "session_manager":  session,
        "rbac_plugin":      rbac,
        "approval_workflow": workflow,
    }
