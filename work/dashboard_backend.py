from __future__ import annotations

import base64
import hashlib
import hmac
import ipaddress
import json
import os
import secrets
import socket
import sqlite3
import re
import uuid
from datetime import datetime, timedelta, timezone
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib import error as urllib_error
from urllib import request as urllib_request
from urllib.parse import parse_qs, urljoin, urlparse

try:
    import psycopg
except Exception:  # pragma: no cover - optional at runtime
    psycopg = None  # type: ignore[assignment]

try:
    from scripts import setup_relational_campaign_db as relational_postgres
except Exception:  # pragma: no cover - optional at runtime
    relational_postgres = None  # type: ignore[assignment]


ROOT_DIR = Path(__file__).resolve().parent.parent
WORK_DIR = ROOT_DIR / "work"
CONFIG_DIR = WORK_DIR / "config"
DATA_DIR = WORK_DIR / "data"
OUTPUTS_DIR = ROOT_DIR / "outputs"
NETLIFY_DATA_DIR = ROOT_DIR / "netlify" / "data"
PLATFORM_STORE_PATH = DATA_DIR / "goodraise-platform-dev.json"
ADMIN_DATASET_PATH = NETLIFY_DATA_DIR / "admin-dataset.json"
SOURCE_CONFIG_PATH = DATA_DIR / "dashboard-source-config.json"
CAMPAIGN_CONFIG_PATH = DATA_DIR / "dashboard-campaign-config.json"
AUDIT_LOG_PATH = DATA_DIR / "dashboard-audit-log.jsonl"
LOCAL_ACCESS_CONTROL_PATH = Path(
    os.getenv("YELLOW_DASHBOARD_ACCESS_CONTROL_JSON", str(CONFIG_DIR / "dashboard-access.local.json"))
).resolve()
EXAMPLE_ACCESS_CONTROL_PATH = (CONFIG_DIR / "dashboard-access.example.json").resolve()
LOCAL_INGEST_KEY_PATH = Path(
    os.getenv("GOODRAISE_INGEST_KEY_JSON", str(CONFIG_DIR / "goodraise-ingest.local.json"))
).resolve()
DB_PATH = Path(
    os.getenv("YELLOW_DASHBOARD_AUTH_DB_PATH", str(DATA_DIR / "dashboard-auth.sqlite3"))
).resolve()
SESSION_COOKIE_NAME = "yellow_dashboard_admin_session"
SESSION_DURATION_HOURS = 24 * 30
PASSWORD_ITERATIONS = 200_000
ALLOWED_ORIGINS = {
    "http://127.0.0.1:8766",
    "http://127.0.0.1:8767",
    "http://127.0.0.1:8791",
    "http://localhost:8766",
    "http://localhost:8767",
    "http://localhost:8791",
}
SECURITY_HEADERS = (
    ("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob:; connect-src 'self' http://127.0.0.1:8767 http://localhost:8767 http://127.0.0.1:8791 http://localhost:8791; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"),
    ("Referrer-Policy", "strict-origin-when-cross-origin"),
    ("X-Content-Type-Options", "nosniff"),
    ("X-Frame-Options", "DENY"),
    ("Cross-Origin-Opener-Policy", "same-origin"),
    ("Cross-Origin-Resource-Policy", "same-origin"),
    ("Permissions-Policy", "camera=(), microphone=(), geolocation=()"),
)

DEFAULT_SOURCE_FIELD_MAP = {
    "id": "id",
    "created_at": "created_at",
    "full_name": "full_name",
    "email": "email",
    "Ambassador name": "Ambassador name",
    "total": "total",
    "city": "city",
    "charged_success": "charged_success",
    "charge_result": "charge_result",
}

SOURCE_FETCH_TIMEOUT_SECONDS = 15
SOURCE_FETCH_MAX_BYTES = 5 * 1024 * 1024
SOURCE_FETCH_MAX_REDIRECTS = 3
SOURCE_REDIRECT_STATUS_CODES = {301, 302, 303, 307, 308}
BLOCKED_SOURCE_HOSTNAMES = {"localhost", "metadata.google.internal"}
BLOCKED_SOURCE_HOST_SUFFIXES = (".localhost", ".internal")
BLOCKED_SOURCE_METADATA_IPS = {
    "169.254.169.254",
    "100.100.100.200",
    "::ffff:169.254.169.254",
}

ROLE_PLATFORM_ADMIN = "platform_admin"
ROLE_ORGANIZATION_ADMIN = "organization_admin"
ROLE_CAMPAIGN_MANAGER = "campaign_manager"
ROLE_ANALYST = "analyst"
ROLE_VIEWER = "viewer"
KNOWN_ROLES = {
    ROLE_PLATFORM_ADMIN,
    ROLE_ORGANIZATION_ADMIN,
    ROLE_CAMPAIGN_MANAGER,
    ROLE_ANALYST,
    ROLE_VIEWER,
}
ROLE_ORDER = {
    ROLE_VIEWER: 1,
    ROLE_ANALYST: 2,
    ROLE_CAMPAIGN_MANAGER: 3,
    ROLE_ORGANIZATION_ADMIN: 4,
    ROLE_PLATFORM_ADMIN: 5,
}
INGEST_API_KEY_HEADER = "X-GoodRaise-API-Key"


def normalize_email(value: str) -> str:
    return (value or "").strip().lower()


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def isoformat_utc(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat()


def normalize_slug(value: Any, fallback: str = "default") -> str:
    raw = "".join(char.lower() if char.isalnum() else "-" for char in str(value or "").strip())
    cleaned = "-".join(part for part in raw.split("-") if part)
    return cleaned or fallback


def normalize_role(value: Any, fallback: str = ROLE_PLATFORM_ADMIN) -> str:
    candidate = str(value or "").strip().lower()
    return candidate if candidate in KNOWN_ROLES else fallback


def normalize_campaign_scope(values: Any) -> list[str]:
    if isinstance(values, list):
        return [normalize_slug(value) for value in values if str(value or "").strip()]
    if isinstance(values, str) and values.strip():
        return [normalize_slug(value) for value in values.split(",") if str(value or "").strip()]
    return []


def normalize_manager_record(raw_record: Any, fallback_role: str = ROLE_PLATFORM_ADMIN) -> dict[str, Any] | None:
    if isinstance(raw_record, str):
        email = normalize_email(raw_record)
        if not email:
            return None
        return {
            "email": email,
            "role": fallback_role,
            "organizationSlug": "default-org",
            "campaignSlugs": [],
            "isActive": True,
        }

    if not isinstance(raw_record, dict):
        return None

    email = normalize_email(str(raw_record.get("email", "")))
    if not email:
        return None

    return {
        "email": email,
        "role": normalize_role(raw_record.get("role"), fallback_role),
        "organizationSlug": normalize_slug(raw_record.get("organizationSlug") or "default-org"),
        "campaignSlugs": normalize_campaign_scope(raw_record.get("campaignSlugs")),
        "isActive": bool(raw_record.get("isActive", True)),
    }


def unique_manager_records(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    unique: list[dict[str, Any]] = []
    seen: set[str] = set()
    for record in records:
        email = normalize_email(record.get("email", ""))
        if not email or email in seen:
            continue
        next_record = {
            "email": email,
            "role": normalize_role(record.get("role"), ROLE_PLATFORM_ADMIN),
            "organizationSlug": normalize_slug(record.get("organizationSlug") or "default-org"),
            "campaignSlugs": normalize_campaign_scope(record.get("campaignSlugs")),
            "isActive": bool(record.get("isActive", True)),
        }
        unique.append(next_record)
        seen.add(email)
    return unique


def load_manager_records_from_file(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []

    records: list[dict[str, Any]] = []
    file_records = payload.get("managers")
    if isinstance(file_records, list):
        records.extend(
            record
            for item in file_records
            for record in [normalize_manager_record(item, ROLE_PLATFORM_ADMIN)]
            if record
        )

    file_emails = payload.get("managerEmails")
    if isinstance(file_emails, list):
        records.extend(
            record
            for item in file_emails
            for record in [normalize_manager_record(item, ROLE_PLATFORM_ADMIN)]
            if record
        )

    return unique_manager_records(records)


def load_manager_records() -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []

    env_emails = os.getenv("YELLOW_DASHBOARD_MANAGER_EMAILS", "").strip()
    if env_emails:
        try:
            parsed = json.loads(env_emails)
            if isinstance(parsed, list) and parsed:
                records = unique_manager_records(
                    [
                        record
                        for item in parsed
                        for record in [normalize_manager_record(item, ROLE_PLATFORM_ADMIN)]
                        if record
                    ]
                )
        except json.JSONDecodeError:
            records = unique_manager_records(
                [
                    record
                    for item in env_emails.split(",")
                    for record in [normalize_manager_record(item, ROLE_PLATFORM_ADMIN)]
                    if record
                ]
            )

    if not records:
        local_records = load_manager_records_from_file(LOCAL_ACCESS_CONTROL_PATH)
        if local_records:
            records = local_records

    if not records and os.getenv("YELLOW_DASHBOARD_ALLOW_EXAMPLE_MANAGERS", "").strip().lower() in {"1", "true", "yes", "on"}:
        example_records = load_manager_records_from_file(EXAMPLE_ACCESS_CONTROL_PATH)
        if example_records:
            records = example_records

    return unique_manager_records(records)


def load_ingest_api_keys() -> list[str]:
    raw_plural = os.getenv("GOODRAISE_INGEST_API_KEYS", "").strip()
    if raw_plural:
        try:
            parsed = json.loads(raw_plural)
            if isinstance(parsed, list):
                return [str(item).strip() for item in parsed if str(item).strip()]
        except json.JSONDecodeError:
            return [item.strip() for item in raw_plural.split(",") if item.strip()]

    raw_single = os.getenv("GOODRAISE_INGEST_API_KEY", "").strip()
    if raw_single:
        return [raw_single]

    if LOCAL_INGEST_KEY_PATH.exists():
        try:
            payload = json.loads(LOCAL_INGEST_KEY_PATH.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            payload = {}
        file_keys = payload.get("apiKeys")
        if isinstance(file_keys, list):
            keys = [str(item).strip() for item in file_keys if str(item).strip()]
            if keys:
                return keys
        legacy_key = str(payload.get("apiKey") or "").strip()
        if legacy_key:
            return [legacy_key]
    return []


def ensure_local_ingest_api_key_file() -> list[str]:
    configured_keys = load_ingest_api_keys()
    if configured_keys:
        return configured_keys

    generated_key = secrets.token_urlsafe(32)
    LOCAL_INGEST_KEY_PATH.parent.mkdir(parents=True, exist_ok=True)
    LOCAL_INGEST_KEY_PATH.write_text(
        json.dumps(
            {
                "apiKeys": [generated_key],
                "createdAt": isoformat_utc(utc_now()),
                "note": "Local ingest API key for GoodRaise external event simulation.",
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    return [generated_key]


def extract_ingest_api_key(headers: Any) -> str:
    header_key = (headers.get(INGEST_API_KEY_HEADER) or "").strip()
    if header_key:
        return header_key
    auth_header = (headers.get("Authorization") or "").strip()
    match = re.match(r"^Bearer\s+(.+)$", auth_header, re.IGNORECASE)
    return match.group(1).strip() if match else ""


def validate_ingest_api_key(headers: Any) -> tuple[bool, HTTPStatus, str]:
    configured_keys = load_ingest_api_keys()
    if not configured_keys:
        return False, HTTPStatus.SERVICE_UNAVAILABLE, "Ingest API key is not configured on the server."

    presented_key = extract_ingest_api_key(headers)
    if not presented_key:
        return False, HTTPStatus.UNAUTHORIZED, "Missing API key."

    if any(hmac.compare_digest(configured_key, presented_key) for configured_key in configured_keys):
        return True, HTTPStatus.OK, ""

    return False, HTTPStatus.UNAUTHORIZED, "Invalid API key."


def ensure_data_dir() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)


def get_connection() -> sqlite3.Connection:
    ensure_data_dir()
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def ensure_schema(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS admins (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL UNIQUE,
            role TEXT NOT NULL DEFAULT 'platform_admin',
            organization_slug TEXT NOT NULL DEFAULT 'default-org',
            campaign_slugs TEXT NOT NULL DEFAULT '[]',
            password_hash TEXT,
            is_active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            password_set_at TEXT,
            last_login_at TEXT
        );

        CREATE TABLE IF NOT EXISTS admin_sessions (
            token TEXT PRIMARY KEY,
            admin_email TEXT NOT NULL,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            FOREIGN KEY(admin_email) REFERENCES admins(email) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_admin_sessions_email
        ON admin_sessions(admin_email);

        CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires
        ON admin_sessions(expires_at);
        """
    )
    existing_columns = {
        row["name"]
        for row in connection.execute("PRAGMA table_info(admins)").fetchall()
    }
    if "role" not in existing_columns:
        connection.execute("ALTER TABLE admins ADD COLUMN role TEXT NOT NULL DEFAULT 'platform_admin'")
    if "organization_slug" not in existing_columns:
        connection.execute("ALTER TABLE admins ADD COLUMN organization_slug TEXT NOT NULL DEFAULT 'default-org'")
    if "campaign_slugs" not in existing_columns:
        connection.execute("ALTER TABLE admins ADD COLUMN campaign_slugs TEXT NOT NULL DEFAULT '[]'")
    connection.commit()


def seed_admins(connection: sqlite3.Connection) -> None:
    created_at = isoformat_utc(utc_now())
    for manager in load_manager_records():
        connection.execute(
            """
            INSERT INTO admins (email, role, organization_slug, campaign_slugs, is_active, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(email) DO UPDATE SET
                role = excluded.role,
                organization_slug = excluded.organization_slug,
                campaign_slugs = excluded.campaign_slugs,
                is_active = excluded.is_active
            """,
            (
                manager["email"],
                manager["role"],
                manager["organizationSlug"],
                json.dumps(manager["campaignSlugs"], ensure_ascii=False),
                1 if manager["isActive"] else 0,
                created_at,
            ),
        )
    connection.commit()


def initialize_database() -> None:
    ensure_local_ingest_api_key_file()
    if uses_postgres_platform_store():
        with _connect_postgres_platform() as connection:
            seed_admins_postgres(connection)
        return
    with get_connection() as connection:
        ensure_schema(connection)
        seed_admins(connection)


def cleanup_expired_sessions(connection: sqlite3.Connection) -> None:
    connection.execute(
        "DELETE FROM admin_sessions WHERE expires_at <= ?",
        (isoformat_utc(utc_now()),),
    )
    connection.commit()


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt,
        PASSWORD_ITERATIONS,
    )
    return "pbkdf2_sha256${iterations}${salt}${digest}".format(
        iterations=PASSWORD_ITERATIONS,
        salt=base64.urlsafe_b64encode(salt).decode("ascii"),
        digest=base64.urlsafe_b64encode(digest).decode("ascii"),
    )


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        algorithm, iterations_text, salt_b64, digest_b64 = stored_hash.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        iterations = int(iterations_text)
        salt = base64.urlsafe_b64decode(salt_b64.encode("ascii"))
        expected_digest = base64.urlsafe_b64decode(digest_b64.encode("ascii"))
    except (ValueError, TypeError):
        return False

    candidate_digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt,
        iterations,
    )
    return hmac.compare_digest(candidate_digest, expected_digest)


def get_admin(connection: sqlite3.Connection, email: str) -> sqlite3.Row | None:
    return connection.execute(
        """
        SELECT
            email,
            role,
            organization_slug,
            campaign_slugs,
            password_hash,
            is_active,
            password_set_at,
            last_login_at
        FROM admins
        WHERE lower(email) = ?
        """,
        (normalize_email(email),),
    ).fetchone()


def get_admin_scope(admin: sqlite3.Row | dict[str, Any] | None) -> dict[str, Any]:
    if not admin:
        return {
            "role": ROLE_VIEWER,
            "organizationSlug": "",
            "campaignSlugs": [],
        }
    raw_campaigns = admin["campaign_slugs"] if isinstance(admin, sqlite3.Row) else admin.get("campaign_slugs", "[]")
    try:
        campaign_slugs = json.loads(raw_campaigns or "[]")
    except json.JSONDecodeError:
        campaign_slugs = []
    if not isinstance(campaign_slugs, list):
        campaign_slugs = []
    return {
        "role": normalize_role(admin["role"] if isinstance(admin, sqlite3.Row) else admin.get("role"), ROLE_PLATFORM_ADMIN),
        "organizationSlug": normalize_slug(
            admin["organization_slug"] if isinstance(admin, sqlite3.Row) else admin.get("organization_slug"),
            "default-org",
        ),
        "campaignSlugs": normalize_campaign_scope(campaign_slugs),
    }


def has_required_role(role: str, minimum_role: str) -> bool:
    return ROLE_ORDER.get(normalize_role(role, ROLE_VIEWER), 0) >= ROLE_ORDER.get(normalize_role(minimum_role, ROLE_PLATFORM_ADMIN), 0)


def update_admin_password(connection: sqlite3.Connection, email: str, password: str) -> None:
    connection.execute(
        """
        UPDATE admins
        SET password_hash = ?, password_set_at = ?
        WHERE lower(email) = ?
        """,
        (
            hash_password(password),
            isoformat_utc(utc_now()),
            normalize_email(email),
        ),
    )
    connection.commit()


def delete_sessions_for_email(connection: sqlite3.Connection, email: str) -> None:
    connection.execute("DELETE FROM admin_sessions WHERE lower(admin_email) = ?", (normalize_email(email),))
    connection.commit()


def create_session(connection: sqlite3.Connection, email: str) -> str:
    cleanup_expired_sessions(connection)
    token = secrets.token_urlsafe(32)
    created_at = utc_now()
    expires_at = created_at + timedelta(hours=SESSION_DURATION_HOURS)
    connection.execute(
        """
        INSERT INTO admin_sessions (token, admin_email, created_at, expires_at)
        VALUES (?, ?, ?, ?)
        """,
        (
            token,
            normalize_email(email),
            isoformat_utc(created_at),
            isoformat_utc(expires_at),
        ),
    )
    connection.execute(
        """
        UPDATE admins
        SET last_login_at = ?
        WHERE lower(email) = ?
        """,
        (isoformat_utc(created_at), normalize_email(email)),
    )
    connection.commit()
    return token


def delete_session(connection: sqlite3.Connection, token: str) -> None:
    connection.execute("DELETE FROM admin_sessions WHERE token = ?", (token,))
    connection.commit()


def get_authenticated_admin_context(connection: sqlite3.Connection, token: str) -> dict[str, Any] | None:
    cleanup_expired_sessions(connection)
    record = connection.execute(
        """
        SELECT
            admin_sessions.admin_email,
            admin_sessions.expires_at,
            admins.role,
            admins.organization_slug,
            admins.campaign_slugs
        FROM admin_sessions
        JOIN admins ON lower(admins.email) = lower(admin_sessions.admin_email)
        WHERE admin_sessions.token = ? AND admins.is_active = 1
        """,
        (token,),
    ).fetchone()
    if not record:
        return None
    scope = get_admin_scope(record)
    return {
        "email": normalize_email(record["admin_email"]),
        "role": scope["role"],
        "organizationSlug": scope["organizationSlug"],
        "campaignSlugs": scope["campaignSlugs"],
        "expiresAt": str(record["expires_at"] or ""),
    }


def get_authenticated_email(connection: sqlite3.Connection, token: str) -> str | None:
    context = get_authenticated_admin_context(connection, token)
    return normalize_email(context["email"]) if context else None


def seed_admins_postgres(connection: Any) -> None:
    created_at = isoformat_utc(utc_now())
    with connection.cursor() as cursor:
        for manager in load_manager_records():
            cursor.execute(
                """
                INSERT INTO goodraise.admin_users (
                    id,
                    email,
                    role,
                    organization_app_id,
                    organization_slug,
                    campaign_ids,
                    campaign_slugs,
                    is_active,
                    created_at,
                    updated_at
                )
                VALUES (%s::uuid, %s, %s, %s, %s, %s::jsonb, %s::jsonb, %s, %s, %s)
                ON CONFLICT (email) DO UPDATE SET
                    role = EXCLUDED.role,
                    organization_app_id = EXCLUDED.organization_app_id,
                    organization_slug = EXCLUDED.organization_slug,
                    campaign_ids = EXCLUDED.campaign_ids,
                    campaign_slugs = EXCLUDED.campaign_slugs,
                    is_active = EXCLUDED.is_active,
                    updated_at = EXCLUDED.updated_at
                """,
                (
                    str(uuid.uuid4()),
                    manager["email"],
                    manager["role"],
                    normalize_slug(manager.get("organizationSlug") or "", ""),
                    normalize_slug(manager.get("organizationSlug") or "", ""),
                    json.dumps([], ensure_ascii=False),
                    json.dumps(manager.get("campaignSlugs", []), ensure_ascii=False),
                    bool(manager.get("isActive", True)),
                    created_at,
                    created_at,
                ),
            )
    connection.commit()


def get_admin_postgres(connection: Any, email: str) -> dict[str, Any] | None:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT
                email,
                role,
                organization_app_id,
                organization_slug,
                campaign_slugs,
                password_hash,
                is_active,
                password_set_at,
                last_login_at
            FROM goodraise.admin_users
            WHERE lower(email) = lower(%s)
            LIMIT 1
            """,
            (normalize_email(email),),
        )
        row = cursor.fetchone()
    if not row:
        return None
    campaign_slugs = row[4]
    if isinstance(campaign_slugs, list):
        campaign_slugs_json = json.dumps(campaign_slugs, ensure_ascii=False)
    else:
        campaign_slugs_json = str(campaign_slugs or "[]")
    return {
        "email": normalize_email(row[0] or ""),
        "role": normalize_role(row[1], ROLE_PLATFORM_ADMIN),
        "organization_slug": normalize_slug(row[3] or row[2] or "", "default-org"),
        "campaign_slugs": campaign_slugs_json,
        "password_hash": row[5] or "",
        "is_active": bool(row[6]),
        "password_set_at": row[7].isoformat() if hasattr(row[7], "isoformat") else str(row[7] or ""),
        "last_login_at": row[8].isoformat() if hasattr(row[8], "isoformat") else str(row[8] or ""),
    }


def update_admin_password_postgres(connection: Any, email: str, password: str) -> None:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            UPDATE goodraise.admin_users
            SET password_hash = %s,
                password_set_at = %s,
                updated_at = %s
            WHERE lower(email) = lower(%s)
            """,
            (
                hash_password(password),
                isoformat_utc(utc_now()),
                isoformat_utc(utc_now()),
                normalize_email(email),
            ),
        )
    connection.commit()


def cleanup_expired_sessions_postgres(connection: Any) -> None:
    with connection.cursor() as cursor:
        cursor.execute("DELETE FROM goodraise.admin_sessions WHERE expires_at <= NOW()")
    connection.commit()


def create_session_postgres(connection: Any, email: str) -> str:
    cleanup_expired_sessions_postgres(connection)
    token = secrets.token_urlsafe(32)
    created_at = utc_now()
    expires_at = created_at + timedelta(hours=SESSION_DURATION_HOURS)
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT id::text FROM goodraise.admin_users WHERE lower(email) = lower(%s) LIMIT 1",
            (normalize_email(email),),
        )
        row = cursor.fetchone()
        if not row:
            raise RuntimeError(f"Admin user not found for session creation: {email}")
        cursor.execute(
            """
            INSERT INTO goodraise.admin_sessions (token, admin_user_id, created_at, expires_at)
            VALUES (%s, %s::uuid, %s, %s)
            """,
            (token, str(row[0]), isoformat_utc(created_at), isoformat_utc(expires_at)),
        )
        cursor.execute(
            """
            UPDATE goodraise.admin_users
            SET last_login_at = %s, updated_at = %s
            WHERE lower(email) = lower(%s)
            """,
            (isoformat_utc(created_at), isoformat_utc(created_at), normalize_email(email)),
        )
    connection.commit()
    return token


def delete_session_postgres(connection: Any, token: str) -> None:
    with connection.cursor() as cursor:
        cursor.execute("DELETE FROM goodraise.admin_sessions WHERE token = %s", (token,))
    connection.commit()


def delete_sessions_for_email_postgres(connection: Any, email: str) -> None:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            DELETE FROM goodraise.admin_sessions
            WHERE admin_user_id IN (
                SELECT id FROM goodraise.admin_users WHERE lower(email) = lower(%s)
            )
            """,
            (normalize_email(email),),
        )
    connection.commit()


def get_authenticated_admin_context_postgres(connection: Any, token: str) -> dict[str, Any] | None:
    cleanup_expired_sessions_postgres(connection)
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT
                u.email,
                s.expires_at,
                u.role,
                u.organization_slug,
                u.campaign_slugs
            FROM goodraise.admin_sessions s
            JOIN goodraise.admin_users u ON u.id = s.admin_user_id
            WHERE s.token = %s AND u.is_active = TRUE
            LIMIT 1
            """,
            (token,),
        )
        row = cursor.fetchone()
    if not row:
        return None
    raw_campaigns = row[4]
    if isinstance(raw_campaigns, list):
        campaign_slugs = normalize_campaign_scope(raw_campaigns)
    else:
        try:
            campaign_slugs = normalize_campaign_scope(json.loads(str(raw_campaigns or "[]")))
        except json.JSONDecodeError:
            campaign_slugs = []
    return {
        "email": normalize_email(row[0] or ""),
        "role": normalize_role(row[2], ROLE_PLATFORM_ADMIN),
        "organizationSlug": normalize_slug(row[3] or "", "default-org"),
        "campaignSlugs": campaign_slugs,
        "expiresAt": row[1].isoformat() if hasattr(row[1], "isoformat") else str(row[1] or ""),
    }


def get_authenticated_email_postgres(connection: Any, token: str) -> str | None:
    context = get_authenticated_admin_context_postgres(connection, token)
    return normalize_email(context["email"]) if context else None


def reset_admin_password_postgres(connection: Any, email: str) -> None:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            UPDATE goodraise.admin_users
            SET password_hash = NULL,
                password_set_at = NULL,
                last_login_at = NULL,
                updated_at = %s
            WHERE lower(email) = lower(%s)
            """,
            (isoformat_utc(utc_now()), normalize_email(email)),
        )
        cursor.execute(
            """
            DELETE FROM goodraise.admin_sessions
            WHERE admin_user_id IN (
                SELECT id FROM goodraise.admin_users WHERE lower(email) = lower(%s)
            )
            """,
            (normalize_email(email),),
        )
    connection.commit()


def write_audit_event(event_type: str, email: str, detail: dict[str, Any] | None = None) -> None:
    ensure_data_dir()
    event = {
        "at": isoformat_utc(utc_now()),
        "type": event_type,
        "email": normalize_email(email),
        "detail": detail or {},
    }
    with AUDIT_LOG_PATH.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(event, ensure_ascii=False) + "\n")


def build_set_cookie(token: str | None, max_age: int) -> str:
    cookie = SimpleCookie()
    cookie[SESSION_COOKIE_NAME] = token or ""
    morsel = cookie[SESSION_COOKIE_NAME]
    morsel["path"] = "/"
    morsel["httponly"] = True
    morsel["samesite"] = "Lax"
    morsel["max-age"] = max_age
    if os.getenv("YELLOW_DASHBOARD_SECURE_COOKIES", "").strip().lower() in {"1", "true", "yes", "on"}:
        morsel["secure"] = True
    return cookie.output(header="").strip()


def load_admin_dataset_payload() -> dict[str, Any] | None:
    if not ADMIN_DATASET_PATH.exists():
        return None
    try:
        payload = json.loads(ADMIN_DATASET_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None
    return payload if isinstance(payload, dict) else None


def get_goodraise_database_url() -> str:
    return str(os.getenv("GOODRAISE_DATABASE_URL") or os.getenv("DATABASE_URL") or "").strip()


def uses_postgres_platform_store() -> bool:
    return bool(get_goodraise_database_url() and psycopg is not None and relational_postgres is not None)


def _postgres_json_load(value: Any) -> Any:
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return None
    return value


def _ensure_postgres_platform_schema(connection: Any) -> None:
    if relational_postgres is None:
        raise RuntimeError("Relational PostgreSQL helpers are not available.")
    with connection.cursor() as cursor:
        cursor.execute(relational_postgres.SCHEMA_SQL)
    connection.commit()


def _connect_postgres_platform() -> Any:
    database_url = get_goodraise_database_url()
    if not database_url or psycopg is None or relational_postgres is None:
        raise RuntimeError("GOODRAISE_DATABASE_URL is not configured for platform persistence.")
    connection = psycopg.connect(database_url)
    _ensure_postgres_platform_schema(connection)
    return connection


def _find_postgres_organization(connection: Any, organization_id: str) -> dict[str, Any] | None:
    normalized_id = normalize_slug(organization_id, "default-org")
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT id::text, app_id, slug, name, status, created_at, updated_at
            FROM goodraise.organizations
            WHERE app_id = %s OR slug = %s
            ORDER BY CASE WHEN app_id = %s THEN 0 ELSE 1 END, updated_at DESC
            LIMIT 1
            """,
            (normalized_id, normalized_id, normalized_id),
        )
        row = cursor.fetchone()
    if not row:
        return None
    return {
        "dbId": str(row[0]),
        "id": str(row[1] or row[2] or normalized_id),
        "slug": str(row[2] or normalized_id),
        "name": str(row[3] or normalized_id),
        "status": str(row[4] or "active"),
        "createdAt": str(row[5].isoformat() if hasattr(row[5], "isoformat") else row[5] or ""),
        "updatedAt": str(row[6].isoformat() if hasattr(row[6], "isoformat") else row[6] or ""),
    }


def _find_postgres_campaign(connection: Any, organization_id: str, campaign_id: str) -> dict[str, Any] | None:
    organization = _find_postgres_organization(connection, organization_id)
    if not organization:
        return None
    normalized_campaign_id = normalize_slug(campaign_id, "campaign")
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT
                c.id::text,
                c.app_id,
                c.slug,
                c.name,
                c.status,
                c.target_amount,
                c.currency_code,
                c.starts_at,
                c.ends_at,
                c.created_at,
                c.updated_at,
                c.updated_by
            FROM goodraise.campaigns c
            WHERE c.organization_id = %s::uuid
              AND (c.app_id = %s OR c.slug = %s)
            ORDER BY CASE WHEN c.app_id = %s THEN 0 ELSE 1 END, c.updated_at DESC
            LIMIT 1
            """,
            (organization["dbId"], normalized_campaign_id, normalized_campaign_id, normalized_campaign_id),
        )
        row = cursor.fetchone()
    if not row:
        return None
    return {
        "dbId": str(row[0]),
        "id": str(row[1] or row[2] or normalized_campaign_id),
        "slug": str(row[2] or normalized_campaign_id),
        "name": str(row[3] or normalized_campaign_id),
        "status": str(row[4] or "draft"),
        "target": int(row[5] or 0),
        "currency": str(row[6] or "ILS"),
        "startAt": str(row[7].isoformat() if hasattr(row[7], "isoformat") else row[7] or ""),
        "endAt": str(row[8].isoformat() if hasattr(row[8], "isoformat") else row[8] or ""),
        "createdAt": str(row[9].isoformat() if hasattr(row[9], "isoformat") else row[9] or ""),
        "updatedAt": str(row[10].isoformat() if hasattr(row[10], "isoformat") else row[10] or ""),
        "updatedBy": normalize_email(row[11] or ""),
        "organizationId": organization["id"],
    }


def _upsert_postgres_organization(connection: Any, value: dict[str, Any]) -> dict[str, Any]:
    normalized_id = normalize_slug(value.get("id"), "default-org")
    normalized_slug = normalize_slug(value.get("slug") or normalized_id, normalized_id)
    existing = _find_postgres_organization(connection, normalized_id)
    with connection.cursor() as cursor:
        if existing:
            cursor.execute(
                """
                UPDATE goodraise.organizations
                SET app_id = %s,
                    slug = %s,
                    name = %s,
                    status = %s,
                    updated_at = %s
                WHERE id = %s::uuid
                """,
                (
                    normalized_id,
                    normalized_slug,
                    str(value.get("name") or normalized_id).strip() or normalized_id,
                    str(value.get("status") or "active").strip().lower() or "active",
                    str(value.get("updatedAt") or isoformat_utc(utc_now())),
                    existing["dbId"],
                ),
            )
        else:
            cursor.execute(
                """
                INSERT INTO goodraise.organizations (id, app_id, slug, name, status, created_at, updated_at)
                VALUES (%s::uuid, %s, %s, %s, %s, %s, %s)
                """,
                (
                    str(uuid.uuid4()),
                    normalized_id,
                    normalized_slug,
                    str(value.get("name") or normalized_id).strip() or normalized_id,
                    str(value.get("status") or "active").strip().lower() or "active",
                    str(value.get("createdAt") or isoformat_utc(utc_now())),
                    str(value.get("updatedAt") or isoformat_utc(utc_now())),
                ),
            )
    connection.commit()
    return _find_postgres_organization(connection, normalized_id) or {
        "id": normalized_id,
        "slug": normalized_slug,
        "name": str(value.get("name") or normalized_id).strip() or normalized_id,
        "status": str(value.get("status") or "active").strip().lower() or "active",
    }


def _upsert_postgres_campaign(connection: Any, value: dict[str, Any]) -> dict[str, Any]:
    organization = _upsert_postgres_organization(
        connection,
        {
            "id": value.get("organizationId"),
            "slug": value.get("organizationId"),
            "name": value.get("organizationId"),
            "status": "active",
            "createdAt": value.get("createdAt") or isoformat_utc(utc_now()),
            "updatedAt": value.get("updatedAt") or isoformat_utc(utc_now()),
        },
    )
    normalized_campaign_id = normalize_slug(value.get("id"), "campaign")
    normalized_slug = normalize_slug(value.get("slug") or normalized_campaign_id, normalized_campaign_id)
    existing = _find_postgres_campaign(connection, organization["id"], normalized_campaign_id)
    with connection.cursor() as cursor:
        if existing:
            cursor.execute(
                """
                UPDATE goodraise.campaigns
                SET app_id = %s,
                    slug = %s,
                    name = %s,
                    status = %s,
                    target_amount = %s,
                    currency_code = %s,
                    starts_at = NULLIF(%s, '')::timestamptz,
                    ends_at = NULLIF(%s, '')::timestamptz,
                    updated_by = %s,
                    updated_at = %s
                WHERE id = %s::uuid
                """,
                (
                    normalized_campaign_id,
                    normalized_slug,
                    str(value.get("name") or normalized_campaign_id).strip() or normalized_campaign_id,
                    str(value.get("status") or "draft").strip().lower() or "draft",
                    int(value.get("target") or 0),
                    str(value.get("currency") or "ILS").strip().upper() or "ILS",
                    str(value.get("startAt") or ""),
                    str(value.get("endAt") or ""),
                    normalize_email(value.get("updatedBy") or ""),
                    str(value.get("updatedAt") or isoformat_utc(utc_now())),
                    existing["dbId"],
                ),
            )
        else:
            cursor.execute(
                """
                INSERT INTO goodraise.campaigns (
                    id, organization_id, app_id, slug, name, status, target_amount, currency_code, starts_at, ends_at, updated_by, created_at, updated_at
                )
                VALUES (
                    %s::uuid, %s::uuid, %s, %s, %s, %s, %s, %s, NULLIF(%s, '')::timestamptz, NULLIF(%s, '')::timestamptz, %s, %s, %s
                )
                """,
                (
                    str(uuid.uuid4()),
                    organization["dbId"],
                    normalized_campaign_id,
                    normalized_slug,
                    str(value.get("name") or normalized_campaign_id).strip() or normalized_campaign_id,
                    str(value.get("status") or "draft").strip().lower() or "draft",
                    int(value.get("target") or 0),
                    str(value.get("currency") or "ILS").strip().upper() or "ILS",
                    str(value.get("startAt") or ""),
                    str(value.get("endAt") or ""),
                    normalize_email(value.get("updatedBy") or ""),
                    str(value.get("createdAt") or isoformat_utc(utc_now())),
                    str(value.get("updatedAt") or isoformat_utc(utc_now())),
                ),
            )
    connection.commit()
    return _find_postgres_campaign(connection, organization["id"], normalized_campaign_id) or {
        "id": normalized_campaign_id,
        "organizationId": organization["id"],
        "slug": normalized_slug,
        "name": str(value.get("name") or normalized_campaign_id).strip() or normalized_campaign_id,
    }


def _get_postgres_payload(connection: Any, table_name: str, organization_id: str, campaign_id: str) -> Any:
    campaign = _find_postgres_campaign(connection, organization_id, campaign_id)
    if not campaign:
        return None
    with connection.cursor() as cursor:
        cursor.execute(
            f"SELECT payload FROM goodraise.{table_name} WHERE campaign_id = %s::uuid LIMIT 1",
            (campaign["dbId"],),
        )
        row = cursor.fetchone()
    return _postgres_json_load(row[0]) if row else None


def _upsert_postgres_payload(connection: Any, table_name: str, organization_id: str, campaign_id: str, value: dict[str, Any]) -> Any:
    organization = _find_postgres_organization(connection, organization_id)
    campaign = _find_postgres_campaign(connection, organization_id, campaign_id)
    if not organization or not campaign:
        raise RuntimeError(f"Missing platform scope for {organization_id}/{campaign_id}.")
    payload_json = json.dumps(_clone_json(value), ensure_ascii=False)
    row_count = len(value.get("rows", [])) if isinstance(value.get("rows"), list) else 0
    generated_at = str(value.get("generatedAt") or value.get("updatedAt") or isoformat_utc(utc_now()))
    updated_at = str(value.get("updatedAt") or value.get("meta", {}).get("lastSavedAt") or isoformat_utc(utc_now()))
    updated_by = normalize_email(value.get("meta", {}).get("lastSavedBy") or value.get("updatedBy") or "")
    has_secret = bool(
        isinstance(value.get("api"), dict) and str(value.get("api", {}).get("bearerToken") or "").strip()
    )
    with connection.cursor() as cursor:
        if table_name == "campaign_configs":
            cursor.execute(
                """
                INSERT INTO goodraise.campaign_configs (id, organization_id, campaign_id, payload, revision, updated_at, updated_by)
                VALUES (%s::uuid, %s::uuid, %s::uuid, %s::jsonb, 1, %s, %s)
                ON CONFLICT (campaign_id) DO UPDATE SET
                    payload = EXCLUDED.payload,
                    revision = goodraise.campaign_configs.revision + 1,
                    updated_at = EXCLUDED.updated_at,
                    updated_by = EXCLUDED.updated_by
                RETURNING payload
                """,
                (str(uuid.uuid4()), organization["dbId"], campaign["dbId"], payload_json, updated_at, updated_by),
            )
        elif table_name == "campaign_sources":
            cursor.execute(
                """
                INSERT INTO goodraise.campaign_sources (id, organization_id, campaign_id, payload, has_secret, updated_at, updated_by)
                VALUES (%s::uuid, %s::uuid, %s::uuid, %s::jsonb, %s, %s, %s)
                ON CONFLICT (campaign_id) DO UPDATE SET
                    payload = EXCLUDED.payload,
                    has_secret = EXCLUDED.has_secret,
                    updated_at = EXCLUDED.updated_at,
                    updated_by = EXCLUDED.updated_by
                RETURNING payload
                """,
                (str(uuid.uuid4()), organization["dbId"], campaign["dbId"], payload_json, has_secret, updated_at, updated_by),
            )
        else:
            cursor.execute(
                """
                INSERT INTO goodraise.campaign_datasets (id, organization_id, campaign_id, payload, row_count, generated_at, updated_at)
                VALUES (%s::uuid, %s::uuid, %s::uuid, %s::jsonb, %s, %s, %s)
                ON CONFLICT (campaign_id) DO UPDATE SET
                    payload = EXCLUDED.payload,
                    row_count = EXCLUDED.row_count,
                    generated_at = EXCLUDED.generated_at,
                    updated_at = EXCLUDED.updated_at
                RETURNING payload
                """,
                (str(uuid.uuid4()), organization["dbId"], campaign["dbId"], payload_json, row_count, generated_at, updated_at),
            )
        row = cursor.fetchone()
    connection.commit()
    return _postgres_json_load(row[0]) if row else _clone_json(value)


def read_platform_store() -> dict[str, Any]:
    if not PLATFORM_STORE_PATH.exists():
        return {"items": {}}
    try:
        payload = json.loads(PLATFORM_STORE_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {"items": {}}
    if not isinstance(payload, dict) or not isinstance(payload.get("items"), dict):
        return {"items": {}}
    return payload


def write_platform_store(store: dict[str, Any]) -> None:
    ensure_data_dir()
    PLATFORM_STORE_PATH.write_text(json.dumps(store, ensure_ascii=False, indent=2), encoding="utf-8")


def platform_get(key: str) -> Any:
    if uses_postgres_platform_store():
        try:
            with _connect_postgres_platform() as connection:
                if key.startswith("organization:"):
                    organization_id = key.split(":", 1)[1]
                    return _find_postgres_organization(connection, organization_id)
                if key.startswith("campaign-config:"):
                    _, organization_id, campaign_id = key.split(":", 2)
                    return _get_postgres_payload(connection, "campaign_configs", organization_id, campaign_id)
                if key.startswith("campaign-source:"):
                    _, organization_id, campaign_id = key.split(":", 2)
                    return _get_postgres_payload(connection, "campaign_sources", organization_id, campaign_id)
                if key.startswith("campaign-dataset:"):
                    _, organization_id, campaign_id = key.split(":", 2)
                    return _get_postgres_payload(connection, "campaign_datasets", organization_id, campaign_id)
                if key.startswith("campaign:"):
                    _, organization_id, campaign_id = key.split(":", 2)
                    return _find_postgres_campaign(connection, organization_id, campaign_id)
        except Exception:
            return None
    return read_platform_store().get("items", {}).get(key)


def platform_set(key: str, value: Any) -> None:
    if uses_postgres_platform_store():
        with _connect_postgres_platform() as connection:
            if key.startswith("organization:") and isinstance(value, dict):
                _upsert_postgres_organization(connection, value)
                return
            if key.startswith("campaign:") and isinstance(value, dict):
                _upsert_postgres_campaign(connection, value)
                return
            if key.startswith("campaign-config:") and isinstance(value, dict):
                _, organization_id, campaign_id = key.split(":", 2)
                _upsert_postgres_payload(connection, "campaign_configs", organization_id, campaign_id, value)
                return
            if key.startswith("campaign-source:") and isinstance(value, dict):
                _, organization_id, campaign_id = key.split(":", 2)
                _upsert_postgres_payload(connection, "campaign_sources", organization_id, campaign_id, value)
                return
            if key.startswith("campaign-dataset:") and isinstance(value, dict):
                _, organization_id, campaign_id = key.split(":", 2)
                _upsert_postgres_payload(connection, "campaign_datasets", organization_id, campaign_id, value)
                return
    store = read_platform_store()
    store.setdefault("items", {})
    store["items"][key] = _clone_json(value)
    write_platform_store(store)


def platform_list(prefix: str) -> list[tuple[str, Any]]:
    if uses_postgres_platform_store() and prefix == "campaign:":
        try:
            with _connect_postgres_platform() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        SELECT
                            o.app_id,
                            o.slug,
                            c.app_id,
                            c.slug,
                            c.name,
                            c.status,
                            c.target_amount,
                            c.currency_code,
                            c.starts_at,
                            c.ends_at,
                            c.created_at,
                            c.updated_at,
                            c.updated_by
                        FROM goodraise.campaigns c
                        JOIN goodraise.organizations o ON o.id = c.organization_id
                        WHERE c.app_id IS NOT NULL
                        ORDER BY c.updated_at DESC, c.created_at DESC
                        """
                    )
                    rows = cursor.fetchall()
                items: list[tuple[str, Any]] = []
                for row in rows:
                    organization_id = str(row[0] or row[1] or "default-org")
                    campaign_id = str(row[2] or row[3] or "campaign")
                    items.append(
                        (
                            campaign_key(organization_id, campaign_id),
                            {
                                "id": campaign_id,
                                "organizationId": organization_id,
                                "slug": str(row[3] or campaign_id),
                                "name": str(row[4] or campaign_id),
                                "status": str(row[5] or "draft"),
                                "target": int(row[6] or 0),
                                "currency": str(row[7] or "ILS"),
                                "startAt": str(row[8].isoformat() if hasattr(row[8], "isoformat") else row[8] or ""),
                                "endAt": str(row[9].isoformat() if hasattr(row[9], "isoformat") else row[9] or ""),
                                "createdAt": str(row[10].isoformat() if hasattr(row[10], "isoformat") else row[10] or ""),
                                "updatedAt": str(row[11].isoformat() if hasattr(row[11], "isoformat") else row[11] or ""),
                                "updatedBy": normalize_email(row[12] or ""),
                            },
                        )
                    )
                return items
        except Exception:
            return []
    items = read_platform_store().get("items", {})
    return [(key, value) for key, value in items.items() if key.startswith(prefix)]


def organization_key(organization_id: str) -> str:
    return f"organization:{normalize_slug(organization_id, 'default-org')}"


def campaign_key(organization_id: str, campaign_id: str) -> str:
    return f"campaign:{normalize_slug(organization_id, 'default-org')}:{normalize_slug(campaign_id, 'campaign')}"


def campaign_config_key(organization_id: str, campaign_id: str) -> str:
    return f"campaign-config:{normalize_slug(organization_id, 'default-org')}:{normalize_slug(campaign_id, 'campaign')}"


def campaign_source_key(organization_id: str, campaign_id: str) -> str:
    return f"campaign-source:{normalize_slug(organization_id, 'default-org')}:{normalize_slug(campaign_id, 'campaign')}"


def campaign_dataset_key(organization_id: str, campaign_id: str) -> str:
    return f"campaign-dataset:{normalize_slug(organization_id, 'default-org')}:{normalize_slug(campaign_id, 'campaign')}"


def get_platform_organization(organization_id: str) -> dict[str, Any] | None:
    value = platform_get(organization_key(organization_id))
    return value if isinstance(value, dict) else None


def get_platform_campaign(organization_id: str, campaign_id: str) -> dict[str, Any] | None:
    value = platform_get(campaign_key(organization_id, campaign_id))
    return value if isinstance(value, dict) else None


def get_platform_campaign_config(organization_id: str, campaign_id: str) -> dict[str, Any] | None:
    value = platform_get(campaign_config_key(organization_id, campaign_id))
    return value if isinstance(value, dict) else None


def get_platform_campaign_source(organization_id: str, campaign_id: str) -> dict[str, Any] | None:
    value = platform_get(campaign_source_key(organization_id, campaign_id))
    return value if isinstance(value, dict) else None


def get_platform_campaign_dataset(organization_id: str, campaign_id: str) -> dict[str, Any] | None:
    value = platform_get(campaign_dataset_key(organization_id, campaign_id))
    return value if isinstance(value, dict) else None


def list_platform_campaign_summaries() -> list[dict[str, Any]]:
    ensure_local_platform_seed_from_legacy()
    summaries: list[dict[str, Any]] = []
    for _key, raw_campaign in platform_list("campaign:"):
        if not isinstance(raw_campaign, dict):
            continue
        organization_id = normalize_slug(raw_campaign.get("organizationId"), "default-org")
        campaign_id = normalize_slug(raw_campaign.get("id"), "campaign")
        organization = get_platform_organization(organization_id) or {}
        config = get_platform_campaign_config(organization_id, campaign_id) or {}
        dataset = get_platform_campaign_dataset(organization_id, campaign_id) or {}
        meta = config.get("meta") if isinstance(config.get("meta"), dict) else {}
        rows = dataset.get("rows") if isinstance(dataset.get("rows"), list) else []
        summaries.append(
            {
                "organizationId": organization_id,
                "organizationSlug": normalize_slug(organization.get("slug") or organization_id, organization_id),
                "organizationName": str(organization.get("name") or organization_id).strip(),
                "campaignId": campaign_id,
                "campaignSlug": normalize_slug(raw_campaign.get("slug") or campaign_id, campaign_id),
                "campaignName": str(raw_campaign.get("name") or campaign_id).strip(),
                "status": str(raw_campaign.get("status") or "draft").strip().lower() or "draft",
                "target": int(raw_campaign.get("target") or 0),
                "currency": str(raw_campaign.get("currency") or "ILS").strip().upper() or "ILS",
                "startAt": str(raw_campaign.get("startAt") or "").strip(),
                "endAt": str(raw_campaign.get("endAt") or "").strip(),
                "updatedAt": str(raw_campaign.get("updatedAt") or meta.get("lastSavedAt") or "").strip(),
                "updatedBy": normalize_email(raw_campaign.get("updatedBy") or meta.get("lastSavedBy") or ""),
                "datasetRecordCount": len(rows),
            }
        )
    return summaries


def get_accessible_campaign_summaries(auth_context: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not auth_context:
        return []
    role = normalize_role(auth_context.get("role"), ROLE_VIEWER)
    summaries = list_platform_campaign_summaries()
    if role == ROLE_PLATFORM_ADMIN:
        return summaries

    organization_slug = normalize_slug(auth_context.get("organizationSlug") or "", "")
    allowed_campaigns = {
        normalize_slug(item)
        for item in auth_context.get("campaignSlugs", [])
        if str(item or "").strip()
    }

    filtered: list[dict[str, Any]] = []
    for item in summaries:
        if organization_slug and item["organizationSlug"] != organization_slug:
            continue
        if role == ROLE_ORGANIZATION_ADMIN:
            filtered.append(item)
            continue
        if not allowed_campaigns:
            continue
        if item["campaignId"] in allowed_campaigns or item["campaignSlug"] in allowed_campaigns:
            filtered.append(item)
    return filtered


def build_campaign_registry_for_accessible(auth_context: dict[str, Any], active_campaign_id: str = "") -> dict[str, Any]:
    summaries = get_accessible_campaign_summaries(auth_context)
    campaigns: list[dict[str, Any]] = []
    for item in summaries:
        config = get_platform_campaign_config(item["organizationId"], item["campaignId"]) or {
            "organization": {
                "id": item["organizationId"],
                "slug": item["organizationSlug"],
                "name": item["organizationName"],
                "status": "active",
            },
            "basics": {
                "id": item["campaignId"],
                "organizationId": item["organizationId"],
                "organizationSlug": item["organizationSlug"],
                "organizationName": item["organizationName"],
                "slug": item["campaignSlug"],
                "campaignName": item["campaignName"],
                "status": item["status"],
                "target": item["target"],
                "currency": item["currency"],
            },
            "meta": {
                "lastSavedAt": item["updatedAt"],
                "lastSavedBy": item["updatedBy"],
            },
        }
        campaigns.append(
            {
                "id": item["campaignId"],
                "name": item["campaignName"],
                "slug": item["campaignSlug"],
                "updatedAt": item["updatedAt"],
                "updatedBy": item["updatedBy"],
                "config": _clone_json(config),
            }
        )
    resolved_active_campaign_id = active_campaign_id if any(item["id"] == active_campaign_id for item in campaigns) else (campaigns[0]["id"] if campaigns else "")
    return {
        "version": 2,
        "activeCampaignId": resolved_active_campaign_id,
        "campaigns": campaigns,
    }


def save_platform_campaign_snapshot(snapshot: dict[str, Any], updated_by: str, organization_id: str, campaign_id: str) -> dict[str, Any]:
    timestamp = isoformat_utc(utc_now())
    basics = snapshot.get("basics") if isinstance(snapshot.get("basics"), dict) else {}
    organization = snapshot.get("organization") if isinstance(snapshot.get("organization"), dict) else {}
    source_payload = snapshot.get("dataSource") if isinstance(snapshot.get("dataSource"), dict) else snapshot.get("source")
    normalized_source = normalize_source_config(source_payload if isinstance(source_payload, dict) else None, get_platform_campaign_source(organization_id, campaign_id) or {})
    assert_safe_source_config(normalized_source)
    normalized_email = normalize_email(updated_by)
    org_record = {
        "id": organization_id,
        "slug": normalize_slug(organization.get("slug") or basics.get("organizationSlug") or organization_id, organization_id),
        "name": str(organization.get("name") or basics.get("organizationName") or organization_id).strip() or organization_id,
        "status": str(organization.get("status") or "active").strip().lower() or "active",
        "createdAt": str((get_platform_organization(organization_id) or {}).get("createdAt") or timestamp).strip() or timestamp,
        "updatedAt": timestamp,
    }
    campaign_record = {
        "id": campaign_id,
        "organizationId": organization_id,
        "slug": normalize_slug(basics.get("slug") or campaign_id, campaign_id),
        "name": str(basics.get("campaignName") or campaign_id).strip() or campaign_id,
        "status": str(basics.get("status") or "draft").strip().lower() or "draft",
        "startAt": str(basics.get("startAt") or "").strip(),
        "endAt": str(basics.get("endAt") or "").strip(),
        "target": int(snapshot.get("goals", {}).get("campaignGoal") or basics.get("target") or 0),
        "currency": str(basics.get("currency") or "ILS").strip().upper() or "ILS",
        "createdAt": str((get_platform_campaign(organization_id, campaign_id) or {}).get("createdAt") or timestamp).strip() or timestamp,
        "updatedAt": timestamp,
        "updatedBy": normalized_email,
    }
    normalized_snapshot = _clone_json(snapshot)
    normalized_snapshot["organization"] = {
        "id": org_record["id"],
        "slug": org_record["slug"],
        "name": org_record["name"],
        "status": org_record["status"],
    }
    normalized_snapshot["basics"] = {
        **(basics if isinstance(basics, dict) else {}),
        "id": campaign_record["id"],
        "organizationId": org_record["id"],
        "organizationSlug": org_record["slug"],
        "organizationName": org_record["name"],
        "slug": campaign_record["slug"],
        "campaignName": campaign_record["name"],
        "status": campaign_record["status"],
        "target": campaign_record["target"],
        "currency": campaign_record["currency"],
    }
    meta = normalized_snapshot.get("meta") if isinstance(normalized_snapshot.get("meta"), dict) else {}
    normalized_snapshot["meta"] = {
        **meta,
        "lastSavedAt": timestamp,
        "lastSavedBy": normalized_email,
    }
    platform_set(organization_key(organization_id), org_record)
    platform_set(campaign_key(organization_id, campaign_id), campaign_record)
    platform_set(campaign_config_key(organization_id, campaign_id), normalized_snapshot)
    platform_set(campaign_source_key(organization_id, campaign_id), normalized_source)
    existing_dataset = get_platform_campaign_dataset(organization_id, campaign_id)
    if not existing_dataset:
        platform_set(
            campaign_dataset_key(organization_id, campaign_id),
            {
                "organizationId": organization_id,
                "campaignId": campaign_id,
                "rows": [],
                "meta": {},
                "sourceLabel": "",
                "generatedAt": timestamp,
                "updatedAt": timestamp,
            },
        )
    return {
        "organization": org_record,
        "campaign": campaign_record,
        "config": normalized_snapshot,
        "source": normalized_source,
        "updatedAt": timestamp,
        "updatedBy": normalized_email,
    }


def ensure_local_platform_seed_from_legacy() -> None:
    if platform_list("campaign:"):
        return

    registry = load_campaign_config()
    campaigns = registry.get("campaigns") if isinstance(registry.get("campaigns"), list) else []
    active_campaign_id = str(registry.get("activeCampaignId") or "").strip()
    active_dataset = load_admin_dataset_payload() or {}
    active_source = load_source_config()
    did_seed = False

    for index, item in enumerate(campaigns, start=1):
        if not isinstance(item, dict):
            continue
        snapshot = item.get("config") if isinstance(item.get("config"), dict) else {}
        basics = snapshot.get("basics") if isinstance(snapshot.get("basics"), dict) else {}
        organization_id = normalize_slug(basics.get("organizationId") or basics.get("organizationSlug") or "default-org", "default-org")
        campaign_id = normalize_slug(item.get("id") or basics.get("id") or basics.get("slug") or f"campaign-{index}", f"campaign-{index}")
        saved = save_platform_campaign_snapshot(snapshot, str(item.get("updatedBy") or snapshot.get("meta", {}).get("lastSavedBy") or ""), organization_id, campaign_id)
        if campaign_id == active_campaign_id and active_dataset:
            dataset_payload = {
                "organizationId": organization_id,
                "campaignId": campaign_id,
                "rows": active_dataset.get("rows", []),
                "meta": active_dataset.get("meta", {}),
                "sourceLabel": active_dataset.get("sourceLabel", ""),
                "generatedAt": active_dataset.get("generatedAt", saved["updatedAt"]),
                "updatedAt": saved["updatedAt"],
            }
            platform_set(campaign_dataset_key(organization_id, campaign_id), dataset_payload)
            platform_set(campaign_source_key(organization_id, campaign_id), normalize_source_config(active_source, saved["source"]))
        did_seed = True

    if not did_seed and active_dataset:
        timestamp = isoformat_utc(utc_now())
        platform_set(
            organization_key("default-org"),
            {
                "id": "default-org",
                "slug": "default-org",
                "name": "Default Organization",
                "status": "active",
                "createdAt": timestamp,
                "updatedAt": timestamp,
            },
        )
        platform_set(
            campaign_key("default-org", "campaign-1"),
            {
                "id": "campaign-1",
                "organizationId": "default-org",
                "slug": "campaign-1",
                "name": "Campaign 1",
                "status": "draft",
                "startAt": "",
                "endAt": "",
                "target": 0,
                "currency": "ILS",
                "createdAt": timestamp,
                "updatedAt": timestamp,
                "updatedBy": "",
            },
        )
        platform_set(
            campaign_config_key("default-org", "campaign-1"),
            {
                "organization": {
                    "id": "default-org",
                    "slug": "default-org",
                    "name": "Default Organization",
                    "status": "active",
                },
                "basics": {
                    "id": "campaign-1",
                    "organizationId": "default-org",
                    "organizationSlug": "default-org",
                    "organizationName": "Default Organization",
                    "slug": "campaign-1",
                    "campaignName": "Campaign 1",
                    "status": "draft",
                    "target": 0,
                    "currency": "ILS",
                },
                "meta": {
                    "lastSavedAt": timestamp,
                    "lastSavedBy": "",
                },
            },
        )
        platform_set(
            campaign_dataset_key("default-org", "campaign-1"),
            {
                "organizationId": "default-org",
                "campaignId": "campaign-1",
                "rows": active_dataset.get("rows", []),
                "meta": active_dataset.get("meta", {}),
                "sourceLabel": active_dataset.get("sourceLabel", ""),
                "generatedAt": active_dataset.get("generatedAt", timestamp),
                "updatedAt": timestamp,
            },
        )
        platform_set(campaign_source_key("default-org", "campaign-1"), normalize_source_config(active_source))


def get_default_source_config() -> dict[str, Any]:
    return {
        "mode": "file",
        "api": {
            "endpoint": "",
            "method": "GET",
            "responseFormat": "csv",
            "recordsPath": "",
            "authType": "none",
            "bearerToken": "",
            "hasBearerToken": False,
            "autoRefreshMinutes": 5,
            "headersText": "",
            "bodyText": "",
            "fieldMapText": json.dumps(DEFAULT_SOURCE_FIELD_MAP, ensure_ascii=False, indent=2),
        },
    }


def normalize_positive_int(value: Any, fallback: int) -> int:
    try:
        numeric = int(str(value or "").strip())
    except (TypeError, ValueError):
        return fallback
    return numeric if numeric >= 0 else fallback


def normalize_multiline_text(value: Any) -> str:
    return str(value or "").replace("\r\n", "\n").strip()


def normalize_field_map_text(value: Any) -> str:
    raw_text = str(value or "").strip()
    if not raw_text:
        return json.dumps(DEFAULT_SOURCE_FIELD_MAP, ensure_ascii=False, indent=2)
    try:
        parsed = json.loads(raw_text)
    except json.JSONDecodeError:
        return json.dumps(DEFAULT_SOURCE_FIELD_MAP, ensure_ascii=False, indent=2)
    if not isinstance(parsed, dict):
        return json.dumps(DEFAULT_SOURCE_FIELD_MAP, ensure_ascii=False, indent=2)
    return json.dumps(parsed, ensure_ascii=False, indent=2)


def normalize_source_config(raw_config: dict[str, Any] | None, existing_config: dict[str, Any] | None = None) -> dict[str, Any]:
    defaults = get_default_source_config()
    candidate = raw_config if isinstance(raw_config, dict) else {}
    existing_api = (
        existing_config.get("api")
        if isinstance(existing_config, dict) and isinstance(existing_config.get("api"), dict)
        else defaults["api"]
    )
    api_candidate = candidate.get("api") if isinstance(candidate.get("api"), dict) else {}
    incoming_token = str(api_candidate.get("bearerToken") or "").strip()
    clear_bearer_token = bool(api_candidate.get("clearBearerToken"))
    preserved_token = "" if clear_bearer_token else (incoming_token or str(existing_api.get("bearerToken") or "").strip())

    return {
        "mode": "api" if candidate.get("mode") == "api" else "file",
        "api": {
            "endpoint": str(api_candidate.get("endpoint") or "").strip(),
            "method": "POST" if str(api_candidate.get("method") or defaults["api"]["method"]).strip().upper() == "POST" else "GET",
            "responseFormat": "json"
            if str(api_candidate.get("responseFormat") or defaults["api"]["responseFormat"]).strip().lower() == "json"
            else "csv",
            "recordsPath": str(api_candidate.get("recordsPath") or "").strip(),
            "authType": "bearer"
            if str(api_candidate.get("authType") or defaults["api"]["authType"]).strip().lower() == "bearer"
            else "none",
            "bearerToken": preserved_token,
            "hasBearerToken": bool(preserved_token),
            "autoRefreshMinutes": normalize_positive_int(
                api_candidate.get("autoRefreshMinutes"), int(defaults["api"]["autoRefreshMinutes"])
            ),
            "headersText": normalize_multiline_text(api_candidate.get("headersText")),
            "bodyText": normalize_multiline_text(api_candidate.get("bodyText")),
            "fieldMapText": normalize_field_map_text(api_candidate.get("fieldMapText")),
        },
    }


def redact_source_config(config: dict[str, Any]) -> dict[str, Any]:
    normalized = normalize_source_config(config)
    normalized["api"]["bearerToken"] = ""
    normalized["api"]["hasBearerToken"] = bool(config.get("api", {}).get("bearerToken")) if isinstance(config.get("api"), dict) else False
    return normalized


def load_source_config() -> dict[str, Any]:
    if not SOURCE_CONFIG_PATH.exists():
        return get_default_source_config()
    try:
        payload = json.loads(SOURCE_CONFIG_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return get_default_source_config()
    return normalize_source_config(payload if isinstance(payload, dict) else None)


def save_source_config(raw_config: dict[str, Any]) -> dict[str, Any]:
    ensure_data_dir()
    existing = load_source_config()
    normalized = normalize_source_config(raw_config, existing)
    assert_safe_source_config(normalized)
    SOURCE_CONFIG_PATH.write_text(json.dumps(normalized, ensure_ascii=False, indent=2), encoding="utf-8")
    return normalized


def _clone_json(value: Any) -> Any:
    return json.loads(json.dumps(value))


def _campaign_entry_id(slug: str, fallback_index: int = 1) -> str:
    normalized_slug = normalize_slug(slug or "")
    return normalized_slug or f"campaign-{fallback_index}"


def normalize_campaign_registry(config: Any) -> dict[str, Any]:
    candidate = config if isinstance(config, dict) else {}
    legacy_candidate: dict[str, Any] = {}
    if isinstance(candidate.get("config"), dict) and not isinstance(candidate.get("campaigns"), list):
        legacy_candidate = candidate["config"]
    elif candidate and not isinstance(candidate.get("campaigns"), list):
        legacy_candidate = candidate

    raw_campaigns = candidate.get("campaigns") if isinstance(candidate.get("campaigns"), list) else None
    if raw_campaigns is None and legacy_candidate:
        raw_campaigns = [
            {
                "id": candidate.get("id"),
                "name": candidate.get("name"),
                "slug": candidate.get("slug"),
                "updatedAt": candidate.get("updatedAt"),
                "updatedBy": candidate.get("updatedBy"),
                "config": legacy_candidate,
            }
        ]

    campaigns: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    seen_slugs: set[str] = set()
    for index, item in enumerate(raw_campaigns or [], start=1):
        entry = item if isinstance(item, dict) else {}
        snapshot = entry.get("config") if isinstance(entry.get("config"), dict) else entry
        snapshot = _clone_json(snapshot if isinstance(snapshot, dict) else {})
        basics = snapshot.get("basics") if isinstance(snapshot.get("basics"), dict) else {}
        slug = normalize_slug(entry.get("slug") or basics.get("slug") or basics.get("campaignName") or f"campaign-{index}")
        if not slug:
            slug = f"campaign-{index}"
        base_slug = slug
        suffix = 2
        while slug in seen_slugs:
            slug = f"{base_slug}-{suffix}"
            suffix += 1
        seen_slugs.add(slug)
        campaign_name = str(entry.get("name") or basics.get("campaignName") or f"Campaign {index}").strip() or f"Campaign {index}"
        campaign_id = _campaign_entry_id(entry.get("id") or slug, index)
        base_id = campaign_id
        suffix = 2
        while campaign_id in seen_ids:
            campaign_id = f"{base_id}-{suffix}"
            suffix += 1
        seen_ids.add(campaign_id)
        snapshot["basics"] = {
            **(basics if isinstance(basics, dict) else {}),
            "slug": slug,
            "campaignName": campaign_name,
        }
        meta = snapshot.get("meta") if isinstance(snapshot.get("meta"), dict) else {}
        updated_at = str(entry.get("updatedAt") or meta.get("lastSavedAt") or "").strip()
        updated_by = normalize_email(entry.get("updatedBy") or meta.get("lastSavedBy") or "")
        snapshot["meta"] = {
            **meta,
            "lastSavedAt": updated_at,
            "lastSavedBy": updated_by,
        }
        campaigns.append(
            {
                "id": campaign_id,
                "name": campaign_name,
                "slug": slug,
                "updatedAt": updated_at,
                "updatedBy": updated_by,
                "config": snapshot,
            }
        )

    if not campaigns:
        campaigns = [
            {
                "id": "campaign-1",
                "name": "Campaign 1",
                "slug": "campaign-1",
                "updatedAt": "",
                "updatedBy": "",
                "config": {
                    "basics": {
                        "campaignName": "Campaign 1",
                        "slug": "campaign-1",
                    },
                    "meta": {
                        "lastSavedAt": "",
                        "lastSavedBy": "",
                    },
                },
            }
        ]

    active_campaign_id = str(candidate.get("activeCampaignId") or "").strip()
    if active_campaign_id not in {item["id"] for item in campaigns}:
        active_campaign_id = campaigns[0]["id"]

    return {
        "version": 1,
        "activeCampaignId": active_campaign_id,
        "campaigns": campaigns,
    }


def load_campaign_config() -> dict[str, Any]:
    if not CAMPAIGN_CONFIG_PATH.exists():
        return normalize_campaign_registry({})
    try:
        payload = json.loads(CAMPAIGN_CONFIG_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return normalize_campaign_registry({})
    if isinstance(payload, dict) and isinstance(payload.get("config"), dict):
        return normalize_campaign_registry(payload.get("config"))
    return normalize_campaign_registry(payload)


def save_campaign_config(config: dict[str, Any], updated_by: str) -> dict[str, Any]:
    ensure_data_dir()
    normalized = normalize_campaign_registry(config)
    timestamp = isoformat_utc(utc_now())
    normalized_email = normalize_email(updated_by)
    active_campaign_id = normalized.get("activeCampaignId")
    for item in normalized.get("campaigns", []):
        if item.get("id") == active_campaign_id:
            item["updatedAt"] = timestamp
            item["updatedBy"] = normalized_email
            snapshot = item.get("config") if isinstance(item.get("config"), dict) else {}
            meta = snapshot.get("meta") if isinstance(snapshot.get("meta"), dict) else {}
            snapshot["meta"] = {
                **meta,
                "lastSavedAt": timestamp,
                "lastSavedBy": normalized_email,
            }
            item["config"] = snapshot
            break
    payload = {
        "config": normalized,
        "updatedAt": timestamp,
        "updatedBy": normalized_email,
    }
    CAMPAIGN_CONFIG_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return payload


def parse_headers_text(text: str) -> dict[str, str]:
    headers: dict[str, str] = {}
    for raw_line in normalize_multiline_text(text).split("\n"):
        line = raw_line.strip()
        if not line or ":" not in line:
            continue
        key, value = line.split(":", 1)
        key = key.strip()
        value = value.strip()
        if key and value:
            headers[key] = value
    return headers


def is_local_source_development_mode() -> bool:
    return os.getenv("NODE_ENV", "").strip().lower() != "production" and not os.getenv("NETLIFY")


def is_blocked_source_hostname(hostname: str) -> bool:
    normalized = str(hostname or "").strip().lower()
    return bool(normalized) and (
        normalized in BLOCKED_SOURCE_HOSTNAMES or any(normalized.endswith(suffix) for suffix in BLOCKED_SOURCE_HOST_SUFFIXES)
    )


def is_blocked_source_ip(address: str) -> bool:
    normalized = str(address or "").strip().lower()
    if not normalized:
        return False
    if normalized in BLOCKED_SOURCE_METADATA_IPS:
        return True
    try:
        parsed = ipaddress.ip_address(normalized)
    except ValueError:
        return False
    return (
        parsed.is_private
        or parsed.is_loopback
        or parsed.is_link_local
        or parsed.is_reserved
        or parsed.is_unspecified
        or parsed.is_multicast
    )


def validate_external_source_url(raw_url: str) -> Any:
    try:
        parsed = urlparse(str(raw_url or "").strip())
    except ValueError as exc:
        raise ValueError("כתובת ה-API אינה תקינה.") from exc

    if parsed.scheme not in {"https", "http"}:
        raise ValueError("מותר להשתמש רק ב-HTTPS, או ב-HTTP מקומי בסביבת פיתוח.")
    if parsed.scheme == "http" and not is_local_source_development_mode():
        raise ValueError("בפרודקשן מותר להשתמש רק ב-HTTPS.")
    if parsed.username or parsed.password:
        raise ValueError("אין להעביר פרטי גישה כחלק מה-URL.")

    hostname = str(parsed.hostname or "").strip().lower()
    if not hostname:
        raise ValueError("כתובת ה-API אינה כוללת host תקין.")
    if is_blocked_source_hostname(hostname):
        raise ValueError("הכתובת מצביעה ליעד פנימי שאינו מורשה.")
    if is_blocked_source_ip(hostname):
        raise ValueError("הכתובת מצביעה ל-IP פרטי או פנימי שאינו מורשה.")

    try:
        resolved_records = socket.getaddrinfo(hostname, parsed.port or (443 if parsed.scheme == "https" else 80), type=socket.SOCK_STREAM)
    except socket.gaierror:
        resolved_records = []

    for record in resolved_records:
        candidate_ip = ""
        sockaddr = record[4] if len(record) > 4 else ()
        if isinstance(sockaddr, tuple) and sockaddr:
            candidate_ip = str(sockaddr[0] or "").strip()
        if candidate_ip and is_blocked_source_ip(candidate_ip):
            raise ValueError("הכתובת נפתרת ליעד פנימי או פרטי שאינו מורשה.")

    return parsed


def assert_safe_source_config(config: dict[str, Any]) -> None:
    if str(config.get("mode") or "file").strip().lower() != "api":
        return
    api_config = config.get("api") if isinstance(config.get("api"), dict) else {}
    endpoint = str(api_config.get("endpoint") or "").strip()
    if not endpoint:
        return
    validate_external_source_url(endpoint)


class NoRedirectHandler(urllib_request.HTTPRedirectHandler):
    def redirect_request(self, req: Any, fp: Any, code: int, msg: str, headers: Any, newurl: str) -> None:  # type: ignore[override]
        return None


def read_limited_response_body(stream: Any, max_bytes: int) -> str:
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = stream.read(64 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > max_bytes:
            raise RuntimeError("תגובת ה-API חורגת ממגבלת הגודל המותרת.")
        chunks.append(chunk)
    charset = "utf-8"
    if hasattr(stream, "headers") and stream.headers:
        charset = stream.headers.get_content_charset("utf-8")
    return b"".join(chunks).decode(charset, errors="replace")


def safe_fetch_url(raw_url: str, *, method: str, headers: dict[str, str], body: bytes | None) -> dict[str, Any]:
    current_url = raw_url
    redirects = 0
    opener = urllib_request.build_opener(NoRedirectHandler())

    while redirects <= SOURCE_FETCH_MAX_REDIRECTS:
        parsed = validate_external_source_url(current_url)
        request = urllib_request.Request(parsed.geturl(), data=body, headers=headers, method=method)
        try:
            with opener.open(request, timeout=SOURCE_FETCH_TIMEOUT_SECONDS) as response:
                return {
                    "text": read_limited_response_body(response, SOURCE_FETCH_MAX_BYTES),
                    "finalUrl": parsed.geturl(),
                }
        except urllib_error.HTTPError as exc:
            if exc.code in SOURCE_REDIRECT_STATUS_CODES:
                location = exc.headers.get("Location") if exc.headers else ""
                if not location:
                    raise RuntimeError("ה-API החזיר הפניה ללא כתובת יעד.") from exc
                current_url = urljoin(parsed.geturl(), location)
                redirects += 1
                continue
            raise RuntimeError(f"המערכת החיצונית החזירה שגיאה {exc.code}.") from exc
        except urllib_error.URLError as exc:
            raise RuntimeError("לא ניתן היה להגיע לכתובת ה-API שהוגדרה.") from exc

    raise RuntimeError("נחסמה שרשרת הפניות ארוכה מדי.")


def fetch_source_payload(config: dict[str, Any]) -> dict[str, Any]:
    normalized = normalize_source_config(config)
    assert_safe_source_config(normalized)
    endpoint = str(normalized["api"].get("endpoint") or "").strip()
    if not endpoint:
        raise ValueError("יש להגדיר קודם כתובת API תקפה לפני משיכת נתונים.")

    headers = parse_headers_text(str(normalized["api"].get("headersText") or ""))
    if normalized["api"].get("responseFormat") == "json":
        headers.setdefault("Accept", "application/json, text/plain, */*")
    else:
        headers.setdefault("Accept", "text/csv, text/plain, */*")

    bearer_token = str(normalized["api"].get("bearerToken") or "").strip()
    if normalized["api"].get("authType") == "bearer" and bearer_token:
        headers["Authorization"] = f"Bearer {bearer_token}"

    method = str(normalized["api"].get("method") or "GET").upper()
    body_text = str(normalized["api"].get("bodyText") or "")
    body_bytes = None
    if method == "POST" and body_text:
        body_bytes = body_text.encode("utf-8")
        if not any(key.lower() == "content-type" for key in headers):
            headers["Content-Type"] = "application/json" if body_text.strip().startswith("{") else "text/plain; charset=utf-8"

    try:
        response = safe_fetch_url(endpoint, method=method, headers=headers, body=body_bytes)
        payload_text = str(response["text"])
        if normalized["api"].get("responseFormat") == "json":
            payload: Any = json.loads(payload_text)
        else:
            payload = payload_text
    except json.JSONDecodeError as exc:
        raise RuntimeError("התגובה מה-API הוגדרה כ-JSON אך לא התקבלה תגובת JSON תקינה.") from exc

    return {
        "mode": normalized["mode"],
        "sourceLabel": f"API · {response['finalUrl']}",
        "fetchedAt": datetime.now().isoformat(timespec="seconds"),
        "format": normalized["api"]["responseFormat"],
        "payload": payload,
        "recordsPath": normalized["api"]["recordsPath"],
        "fieldMapText": normalized["api"]["fieldMapText"],
        "autoRefreshMinutes": normalized["api"]["autoRefreshMinutes"],
    }


class DashboardServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, server_address: tuple[str, int], handler_class: type[BaseHTTPRequestHandler]) -> None:
        super().__init__(server_address, handler_class)
        self.browser_output = OUTPUTS_DIR / "yellow-project-dashboard-browser.html"
        self.shell_output = OUTPUTS_DIR / "yellow-project-dashboard.html"


class DashboardRequestHandler(BaseHTTPRequestHandler):
    server_version = "YellowDashboardBackend/1.0"
    SCOPED_CAMPAIGN_RE = re.compile(r"^/api/organizations/([^/]+)/campaigns/([^/]+)$")
    SCOPED_DATASET_RE = re.compile(r"^/api/organizations/([^/]+)/campaigns/([^/]+)/dataset$")
    SCOPED_SOURCE_RE = re.compile(r"^/api/organizations/([^/]+)/campaigns/([^/]+)/source$")
    SCOPED_SOURCE_REFRESH_RE = re.compile(r"^/api/organizations/([^/]+)/campaigns/([^/]+)/source/refresh$")
    SCOPED_INGEST_RE = re.compile(r"^/api/organizations/([^/]+)/campaigns/([^/]+)/ingest$")
    SCOPED_CAMPAIGN_LIST_RE = re.compile(r"^/api/organizations/([^/]+)/campaigns$")

    @property
    def dashboard_server(self) -> DashboardServer:
        return self.server  # type: ignore[return-value]

    def log_message(self, format: str, *args: Any) -> None:
        super().log_message(format, *args)

    def send_security_headers(self) -> None:
        for key, value in SECURITY_HEADERS:
            self.send_header(key, value)

    def is_request_origin_allowed(self) -> bool:
        origin = (self.headers.get("Origin") or "").strip()
        return not origin or origin in ALLOWED_ORIGINS

    def get_cors_headers(self) -> list[tuple[str, str]]:
        origin = (self.headers.get("Origin") or "").strip()
        if origin and origin in ALLOWED_ORIGINS:
            return [
                ("Access-Control-Allow-Origin", origin),
                ("Access-Control-Allow-Credentials", "true"),
                ("Access-Control-Allow-Headers", "Content-Type, X-GoodRaise-API-Key, Authorization"),
                ("Access-Control-Allow-Methods", "GET, POST, OPTIONS"),
                ("Vary", "Origin"),
            ]
        return []

    def do_OPTIONS(self) -> None:
        if not self.is_request_origin_allowed():
            self.send_response(HTTPStatus.FORBIDDEN)
            self.send_security_headers()
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_security_headers()
        for key, value in self.get_cors_headers():
            self.send_header(key, value)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if self.try_handle_scoped_request("GET", parsed.path):
            return
        if parsed.path == "/api/health":
            self.handle_health()
            return
        if parsed.path == "/api/auth/status":
            self.handle_auth_status()
            return
        if parsed.path == "/api/admin/dataset":
            self.handle_admin_dataset()
            return
        if parsed.path == "/api/admin/source-config":
            self.handle_source_config_get()
            return
        if parsed.path == "/api/admin/campaign-config":
            self.handle_campaign_config_get()
            return
        path_parts = [part for part in parsed.path.split("/") if part]
        is_project_route = len(path_parts) in {1, 2} and path_parts and path_parts[0] not in {
            "api",
            "admin",
            "rules",
            "privacy",
            "yellow-project-dashboard.html",
            "yellow-project-dashboard-browser.html",
            "index.html",
        }
        if parsed.path in {"/", "/index.html", "/yellow-project-dashboard-browser.html"} or is_project_route:
            self.serve_file(self.dashboard_server.browser_output, "text/html; charset=utf-8")
            return
        if parsed.path == "/yellow-project-dashboard.html":
            self.serve_file(self.dashboard_server.shell_output, "text/html; charset=utf-8")
            return
        self.respond_json(HTTPStatus.NOT_FOUND, {"message": "הנתיב המבוקש לא נמצא."})

    def do_POST(self) -> None:
        if not self.is_request_origin_allowed():
            self.respond_json(HTTPStatus.FORBIDDEN, {"message": "מקור הבקשה אינו מורשה."})
            return
        parsed = urlparse(self.path)
        if self.try_handle_scoped_request("POST", parsed.path):
            return
        if parsed.path == "/api/auth/login":
            self.handle_auth_login()
            return
        if parsed.path == "/api/auth/setup":
            self.handle_auth_setup()
            return
        if parsed.path == "/api/auth/logout":
            self.handle_auth_logout()
            return
        if parsed.path == "/api/auth/change-password":
            self.handle_auth_change_password()
            return
        if parsed.path == "/api/auth/reset-local":
            self.handle_auth_reset_local()
            return
        if parsed.path == "/api/admin/source-config":
            self.handle_source_config_save()
            return
        if parsed.path == "/api/admin/campaign-config":
            self.handle_campaign_config_save()
            return
        if parsed.path == "/api/admin/source-refresh":
            self.handle_source_refresh()
            return
        self.respond_json(HTTPStatus.NOT_FOUND, {"message": "הנתיב המבוקש לא נמצא."})

    def try_handle_scoped_request(self, method: str, path: str) -> bool:
        campaign_list_match = self.SCOPED_CAMPAIGN_LIST_RE.match(path)
        if method == "GET" and campaign_list_match:
            self.handle_scoped_campaign_list(normalize_slug(campaign_list_match.group(1), "default-org"))
            return True

        campaign_match = self.SCOPED_CAMPAIGN_RE.match(path)
        if campaign_match:
            organization_id = normalize_slug(campaign_match.group(1), "default-org")
            campaign_id = normalize_slug(campaign_match.group(2), "campaign")
            if method == "GET":
                self.handle_scoped_campaign_config(organization_id, campaign_id)
                return True
            if method == "POST":
                self.handle_scoped_campaign_config_save(organization_id, campaign_id)
                return True

        dataset_match = self.SCOPED_DATASET_RE.match(path)
        if method == "GET" and dataset_match:
            self.handle_scoped_dataset(
                normalize_slug(dataset_match.group(1), "default-org"),
                normalize_slug(dataset_match.group(2), "campaign"),
            )
            return True

        source_match = self.SCOPED_SOURCE_RE.match(path)
        if source_match:
            organization_id = normalize_slug(source_match.group(1), "default-org")
            campaign_id = normalize_slug(source_match.group(2), "campaign")
            if method == "GET":
                self.handle_scoped_source_config(organization_id, campaign_id)
                return True
            if method == "POST":
                self.handle_scoped_source_config_save(organization_id, campaign_id)
                return True

        source_refresh_match = self.SCOPED_SOURCE_REFRESH_RE.match(path)
        if method == "POST" and source_refresh_match:
            self.handle_scoped_source_refresh(
                normalize_slug(source_refresh_match.group(1), "default-org"),
                normalize_slug(source_refresh_match.group(2), "campaign"),
            )
            return True

        ingest_match = self.SCOPED_INGEST_RE.match(path)
        if method == "POST" and ingest_match:
            self.handle_scoped_external_ingest(
                normalize_slug(ingest_match.group(1), "default-org"),
                normalize_slug(ingest_match.group(2), "campaign"),
            )
            return True
        return False

    def read_json_body(self) -> dict[str, Any]:
        content_length = int(self.headers.get("Content-Length", "0") or "0")
        raw = self.rfile.read(content_length) if content_length > 0 else b"{}"
        try:
            parsed = json.loads(raw.decode("utf-8") or "{}")
        except json.JSONDecodeError:
            parsed = {}
        return parsed if isinstance(parsed, dict) else {}

    def audit(self, event_type: str, email: str = "", **detail: Any) -> None:
        request_context = {
            "path": self.path,
            "origin": self.headers.get("Origin", ""),
            "remote": self.client_address[0] if self.client_address else "",
        }
        write_audit_event(event_type, email, {**request_context, **detail})

    def get_auth_context(self) -> dict[str, Any] | None:
        token = self.get_session_token()
        if not token:
            return None
        if uses_postgres_platform_store():
            with _connect_postgres_platform() as connection:
                seed_admins_postgres(connection)
                return get_authenticated_admin_context_postgres(connection, token)
        with get_connection() as connection:
            ensure_schema(connection)
            seed_admins(connection)
            return get_authenticated_admin_context(connection, token)

    def require_authenticated_admin(self, minimum_role: str = ROLE_VIEWER) -> dict[str, Any] | None:
        context = self.get_auth_context()
        if not context:
            return None
        if not has_required_role(context.get("role", ROLE_VIEWER), minimum_role):
            return {
                "error": True,
                "status": HTTPStatus.FORBIDDEN,
                "message": "אין הרשאה מספקת לביצוע הפעולה המבוקשת.",
                "context": context,
            }
        return context

    def build_health_payload(self) -> dict[str, Any]:
        source_config = load_source_config()
        dataset_available = ADMIN_DATASET_PATH.exists()
        dataset_size = ADMIN_DATASET_PATH.stat().st_size if dataset_available else 0
        campaign_config_exists = CAMPAIGN_CONFIG_PATH.exists()
        auth_db_exists = DB_PATH.exists()
        persistence_ok = False
        try:
            if uses_postgres_platform_store():
                with _connect_postgres_platform() as connection:
                    seed_admins_postgres(connection)
                    with connection.cursor() as cursor:
                        cursor.execute("SELECT 1")
                        cursor.fetchone()
                    persistence_ok = True
            else:
                with get_connection() as connection:
                    ensure_schema(connection)
                    seed_admins(connection)
                    connection.execute("SELECT 1").fetchone()
                    persistence_ok = True
        except Exception:
            persistence_ok = False

        return {
            "ok": persistence_ok,
            "service": "yellow-dashboard-backend",
            "application": {
                "status": "ok" if self.dashboard_server.browser_output.exists() else "degraded",
                "browserOutputReady": self.dashboard_server.browser_output.exists(),
                "shellOutputReady": self.dashboard_server.shell_output.exists(),
            },
            "persistence": {
                "status": "ok" if persistence_ok else "error",
                "authDatabaseReady": True if uses_postgres_platform_store() else auth_db_exists,
                "authDatabaseType": "postgresql" if uses_postgres_platform_store() else "sqlite",
                "campaignConfigReady": campaign_config_exists,
            },
            "dataSource": {
                "mode": source_config.get("mode", "file"),
                "apiConfigured": bool(source_config.get("api", {}).get("endpoint")) if isinstance(source_config.get("api"), dict) else False,
                "adminDatasetReady": dataset_available,
                "adminDatasetBytes": dataset_size,
            },
            "time": {
                "checkedAt": isoformat_utc(utc_now()),
                "sessionDurationHours": SESSION_DURATION_HOURS,
            },
        }

    def handle_health(self) -> None:
        payload = self.build_health_payload()
        status = HTTPStatus.OK if payload.get("ok") else HTTPStatus.SERVICE_UNAVAILABLE
        self.respond_json(status, payload)

    def respond_json(
        self,
        status: HTTPStatus,
        payload: dict[str, Any],
        extra_headers: list[tuple[str, str]] | None = None,
    ) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_security_headers()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        for key, value in self.get_cors_headers():
            self.send_header(key, value)
        if extra_headers:
            for key, value in extra_headers:
                self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def serve_file(self, path: Path, content_type: str) -> None:
        if not path.exists():
            self.respond_json(
                HTTPStatus.NOT_FOUND,
                {"message": f"הקובץ {path.name} עדיין לא נבנה. הריצו קודם את build הדשבורד."},
            )
            return
        content = path.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_security_headers()
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(content)))
        for key, value in self.get_cors_headers():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(content)

    def get_session_token(self) -> str:
        cookie_header = self.headers.get("Cookie", "")
        cookie = SimpleCookie()
        cookie.load(cookie_header)
        morsel = cookie.get(SESSION_COOKIE_NAME)
        return morsel.value if morsel else ""

    def get_scope_from_query(self) -> tuple[str, str]:
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query or "")
        organization_id = normalize_slug((params.get("organizationId") or [""])[0], "")
        campaign_id = normalize_slug((params.get("campaignId") or [""])[0], "")
        return organization_id, campaign_id

    def resolve_scoped_access(
        self,
        minimum_role: str = ROLE_VIEWER,
        organization_id: str = "",
        campaign_id: str = "",
        allow_default: bool = True,
        require_write: bool = False,
    ) -> dict[str, Any] | None:
        auth_context = self.require_authenticated_admin(minimum_role)
        if not auth_context:
            return None
        if auth_context.get("error"):
            return auth_context

        query_org_id, query_campaign_id = self.get_scope_from_query()
        requested_organization_id = normalize_slug(organization_id or query_org_id, "")
        requested_campaign_id = normalize_slug(campaign_id or query_campaign_id, "")
        summaries = get_accessible_campaign_summaries(auth_context)
        has_explicit_scope = bool(requested_organization_id or requested_campaign_id)

        matched_summary = None
        for item in summaries:
            campaign_match = (
                not requested_campaign_id
                or item["campaignId"] == requested_campaign_id
                or item["campaignSlug"] == requested_campaign_id
            )
            organization_match = (
                not requested_organization_id
                or item["organizationId"] == requested_organization_id
                or item["organizationSlug"] == requested_organization_id
            )
            if campaign_match and organization_match:
                matched_summary = item
                break

        if not matched_summary and has_explicit_scope:
            resource_exists = bool(
                get_platform_campaign(requested_organization_id, requested_campaign_id)
                or get_platform_organization(requested_organization_id)
            )
            return {
                "error": True,
                "status": HTTPStatus.FORBIDDEN if resource_exists else HTTPStatus.NOT_FOUND,
                "message": "אין הרשאה לקמפיין או לארגון המבוקש." if resource_exists else "הקמפיין המבוקש אינו קיים.",
                "context": auth_context,
            }

        selected_summary = matched_summary or (summaries[0] if allow_default and summaries else None)
        if not selected_summary:
            return {
                "error": True,
                "status": HTTPStatus.NOT_FOUND,
                "message": "לא נמצא קמפיין זמין עבור המשתמש המחובר.",
                "context": auth_context,
            }

        if require_write and normalize_role(auth_context.get("role"), ROLE_VIEWER) in {ROLE_VIEWER, ROLE_ANALYST}:
            return {
                "error": True,
                "status": HTTPStatus.FORBIDDEN,
                "message": "אין הרשאת כתיבה לקמפיין המבוקש.",
                "context": auth_context,
            }

        return {
            "email": auth_context["email"],
            "role": auth_context["role"],
            "organizationSlug": auth_context["organizationSlug"],
            "campaignSlugs": auth_context["campaignSlugs"],
            "expiresAt": auth_context["expiresAt"],
            "organizationId": selected_summary["organizationId"],
            "campaignId": selected_summary["campaignId"],
            "organization": get_platform_organization(selected_summary["organizationId"]) or {},
            "campaign": get_platform_campaign(selected_summary["organizationId"], selected_summary["campaignId"]) or {},
            "accessibleCampaigns": summaries,
        }

    def handle_scoped_campaign_list(self, organization_id: str) -> None:
        auth_context = self.resolve_scoped_access(ROLE_VIEWER, organization_id=organization_id, allow_default=False)
        if not auth_context:
            self.respond_json(HTTPStatus.UNAUTHORIZED, {"message": "נדרשת התחברות מנהל כדי לטעון את רשימת הקמפיינים."})
            return
        if auth_context.get("error"):
            self.respond_json(auth_context["status"], {"message": auth_context["message"]})
            return
        campaigns = [
            item
            for item in auth_context.get("accessibleCampaigns", [])
            if item.get("organizationId") == auth_context["organizationId"]
        ]
        self.respond_json(
            HTTPStatus.OK,
            {
                "organizationId": auth_context["organizationId"],
                "campaigns": campaigns,
            },
        )

    def handle_scoped_dataset(self, organization_id: str, campaign_id: str) -> None:
        auth_context = self.resolve_scoped_access(ROLE_ANALYST, organization_id=organization_id, campaign_id=campaign_id, allow_default=False)
        if not auth_context:
            self.respond_json(HTTPStatus.UNAUTHORIZED, {"message": "נדרשת התחברות מנהל כדי לטעון את הנתונים הניהוליים."})
            return
        if auth_context.get("error"):
            denied_context = auth_context.get("context", {})
            self.audit("dataset_forbidden", denied_context.get("email", ""), role=denied_context.get("role", ""))
            self.respond_json(auth_context["status"], {"message": auth_context["message"]})
            return
        payload = get_platform_campaign_dataset(auth_context["organizationId"], auth_context["campaignId"])
        if not payload:
            self.respond_json(HTTPStatus.NOT_FOUND, {"message": "מאגר הנתונים הניהולי לקמפיין המבוקש אינו זמין כרגע."})
            return
        self.respond_json(
            HTTPStatus.OK,
            {
                "organizationId": auth_context["organizationId"],
                "campaignId": auth_context["campaignId"],
                "organization": auth_context["organization"],
                "campaign": auth_context["campaign"],
                "rows": payload.get("rows", []),
                "meta": payload.get("meta", {}),
                "sourceLabel": payload.get("sourceLabel", "קובץ בסיס מאובטח"),
                "generatedAt": payload.get("generatedAt", ""),
            },
        )
        self.audit("dataset_view", auth_context["email"], role=auth_context["role"], organizationId=auth_context["organizationId"], campaignId=auth_context["campaignId"])

    def handle_scoped_source_config(self, organization_id: str, campaign_id: str) -> None:
        auth_context = self.resolve_scoped_access(ROLE_CAMPAIGN_MANAGER, organization_id=organization_id, campaign_id=campaign_id, allow_default=False)
        if not auth_context:
            self.respond_json(HTTPStatus.UNAUTHORIZED, {"message": "נדרשת התחברות מנהל כדי לנהל חיבורי API של מקור הנתונים."})
            return
        if auth_context.get("error"):
            self.respond_json(auth_context["status"], {"message": auth_context["message"]})
            return
        config = get_platform_campaign_source(auth_context["organizationId"], auth_context["campaignId"]) or get_default_source_config()
        self.respond_json(
            HTTPStatus.OK,
            {
                "organizationId": auth_context["organizationId"],
                "campaignId": auth_context["campaignId"],
                "config": redact_source_config(config),
                "message": "הגדרות מקור הנתונים נטענו.",
            },
        )
        self.audit("source_config_view", auth_context["email"], role=auth_context["role"], organizationId=auth_context["organizationId"], campaignId=auth_context["campaignId"])

    def handle_scoped_source_config_save(self, organization_id: str, campaign_id: str) -> None:
        auth_context = self.resolve_scoped_access(
            ROLE_CAMPAIGN_MANAGER,
            organization_id=organization_id,
            campaign_id=campaign_id,
            allow_default=False,
            require_write=True,
        )
        if not auth_context:
            self.respond_json(HTTPStatus.UNAUTHORIZED, {"message": "נדרשת התחברות מנהל כדי לשמור חיבור API."})
            return
        if auth_context.get("error"):
            self.respond_json(auth_context["status"], {"message": auth_context["message"]})
            return
        payload = self.read_json_body()
        config = payload.get("config") if isinstance(payload.get("config"), dict) else {}
        existing = get_platform_campaign_source(auth_context["organizationId"], auth_context["campaignId"]) or {}
        normalized = normalize_source_config(config, existing if isinstance(existing, dict) else None)
        try:
            assert_safe_source_config(normalized)
        except ValueError as exc:
            self.respond_json(HTTPStatus.BAD_REQUEST, {"message": str(exc)})
            return
        platform_set(campaign_source_key(auth_context["organizationId"], auth_context["campaignId"]), normalized)
        self.respond_json(
            HTTPStatus.OK,
            {
                "saved": True,
                "organizationId": auth_context["organizationId"],
                "campaignId": auth_context["campaignId"],
                "config": redact_source_config(normalized),
                "message": "חיבור מקור הנתונים נשמר בשרת המקומי." if normalized.get("mode") == "api" else "מצב מקור הנתונים נשמר על טעינת קובץ.",
            },
        )
        self.audit("source_config_saved", auth_context["email"], role=auth_context["role"], organizationId=auth_context["organizationId"], campaignId=auth_context["campaignId"], mode=normalized.get("mode", "file"))

    def handle_scoped_campaign_config(self, organization_id: str, campaign_id: str) -> None:
        auth_context = self.resolve_scoped_access(ROLE_CAMPAIGN_MANAGER, organization_id=organization_id, campaign_id=campaign_id, allow_default=False)
        if not auth_context:
            self.respond_json(HTTPStatus.UNAUTHORIZED, {"message": "נדרשת התחברות מנהל כדי לטעון את הגדרות הקמפיין."})
            return
        if auth_context.get("error"):
            self.respond_json(auth_context["status"], {"message": auth_context["message"]})
            return
        registry = build_campaign_registry_for_accessible(auth_context, auth_context["campaignId"])
        active_entry = next((item for item in registry.get("campaigns", []) if item.get("id") == auth_context["campaignId"]), None)
        self.respond_json(
            HTTPStatus.OK,
            {
                "config": registry,
                "activeCampaign": {
                    "organizationId": auth_context["organizationId"],
                    "campaignId": auth_context["campaignId"],
                },
                "portfolio": auth_context.get("accessibleCampaigns", []),
                "updatedAt": active_entry.get("updatedAt", "") if isinstance(active_entry, dict) else "",
                "updatedBy": active_entry.get("updatedBy", "") if isinstance(active_entry, dict) else "",
                "message": "הגדרות הקמפיין נטענו מהשרת המקומי.",
            },
        )
        self.audit("campaign_config_view", auth_context["email"], role=auth_context["role"], organizationId=auth_context["organizationId"], campaignId=auth_context["campaignId"])

    def handle_scoped_campaign_config_save(self, organization_id: str, campaign_id: str) -> None:
        auth_context = self.resolve_scoped_access(
            ROLE_CAMPAIGN_MANAGER,
            organization_id=organization_id,
            campaign_id=campaign_id,
            allow_default=False,
            require_write=True,
        )
        if not auth_context:
            self.respond_json(HTTPStatus.UNAUTHORIZED, {"message": "נדרשת התחברות מנהל כדי לשמור את הגדרות הקמפיין."})
            return
        if auth_context.get("error"):
            self.respond_json(auth_context["status"], {"message": auth_context["message"]})
            return
        payload = self.read_json_body()
        registry = normalize_campaign_registry(payload.get("config") if isinstance(payload.get("config"), dict) else {})
        active_campaign_id = normalize_slug(registry.get("activeCampaignId") or auth_context["campaignId"], auth_context["campaignId"])
        active_entry = next((item for item in registry.get("campaigns", []) if normalize_slug(item.get("id"), "") == active_campaign_id), None)
        snapshot = active_entry.get("config") if isinstance(active_entry, dict) and isinstance(active_entry.get("config"), dict) else {}
        try:
            saved = save_platform_campaign_snapshot(snapshot if isinstance(snapshot, dict) else {}, auth_context["email"], auth_context["organizationId"], auth_context["campaignId"])
        except ValueError as exc:
            self.respond_json(HTTPStatus.BAD_REQUEST, {"message": str(exc)})
            return
        next_registry = build_campaign_registry_for_accessible(auth_context, auth_context["campaignId"])
        self.respond_json(
            HTTPStatus.OK,
            {
                "saved": True,
                "config": next_registry,
                "activeCampaign": {
                    "organizationId": auth_context["organizationId"],
                    "campaignId": auth_context["campaignId"],
                },
                "updatedAt": saved["updatedAt"],
                "updatedBy": saved["updatedBy"],
                "message": "הגדרות הקמפיין נשמרו בשרת המקומי.",
            },
        )
        self.audit("campaign_config_saved", auth_context["email"], role=auth_context["role"], organizationId=auth_context["organizationId"], campaignId=auth_context["campaignId"])

    def handle_scoped_source_refresh(self, organization_id: str, campaign_id: str) -> None:
        auth_context = self.resolve_scoped_access(
            ROLE_CAMPAIGN_MANAGER,
            organization_id=organization_id,
            campaign_id=campaign_id,
            allow_default=False,
            require_write=True,
        )
        if not auth_context:
            self.respond_json(HTTPStatus.UNAUTHORIZED, {"message": "נדרשת התחברות מנהל כדי למשוך נתונים ממערכת המקור."})
            return
        if auth_context.get("error"):
            self.respond_json(auth_context["status"], {"message": auth_context["message"]})
            return
        config = get_platform_campaign_source(auth_context["organizationId"], auth_context["campaignId"]) or get_default_source_config()
        if config.get("mode") != "api":
            self.respond_json(HTTPStatus.CONFLICT, {"message": "מקור הנתונים הפעיל מוגדר כרגע כקובץ, לא כ-API."})
            return
        try:
            payload = fetch_source_payload(config)
        except ValueError as exc:
            self.respond_json(HTTPStatus.BAD_REQUEST, {"message": str(exc)})
            return
        except RuntimeError as exc:
            self.respond_json(HTTPStatus.BAD_GATEWAY, {"message": str(exc)})
            return
        self.respond_json(
            HTTPStatus.OK,
            {
                "ok": True,
                "organizationId": auth_context["organizationId"],
                "campaignId": auth_context["campaignId"],
                **payload,
                "message": "הנתונים נמשכו בהצלחה מהמערכת החיצונית.",
            },
        )
        self.audit("source_refresh", auth_context["email"], role=auth_context["role"], organizationId=auth_context["organizationId"], campaignId=auth_context["campaignId"], mode=config.get("mode", "file"))

    def handle_scoped_external_ingest(self, organization_id: str, campaign_id: str) -> None:
        is_valid, status, message = validate_ingest_api_key(self.headers)
        if not is_valid:
            self.audit("external_ingest", "", organizationId=organization_id, campaignId=campaign_id, outcome="denied", reason=message)
            self.respond_json(status, {"message": message})
            return

        database_url = (os.getenv("GOODRAISE_DATABASE_URL") or os.getenv("DATABASE_URL") or "").strip()
        if not database_url:
            self.respond_json(HTTPStatus.SERVICE_UNAVAILABLE, {"message": "GOODRAISE_DATABASE_URL is not configured on the server."})
            return
        if psycopg is None or relational_postgres is None:
            self.respond_json(HTTPStatus.SERVICE_UNAVAILABLE, {"message": "PostgreSQL ingestion dependencies are not available on the server."})
            return

        payload = self.read_json_body()
        source_label = str(payload.get("sourceLabel") or payload.get("source") or "external-api").strip() or "external-api"
        request_reference = str(payload.get("requestId") or payload.get("externalReference") or payload.get("reference") or "").strip()

        try:
            with psycopg.connect(database_url) as connection:
                result = relational_postgres.ingest_external_record(
                    connection,
                    organization_id,
                    campaign_id,
                    payload.get("record") if isinstance(payload.get("record"), dict) else payload,
                    source_label=source_label,
                    imported_by="external-api",
                    request_reference=request_reference,
                )
        except LookupError as exc:
            self.audit("external_ingest", "", organizationId=organization_id, campaignId=campaign_id, outcome="error", reason=str(exc))
            self.respond_json(HTTPStatus.NOT_FOUND, {"message": str(exc)})
            return
        except ValueError as exc:
            self.audit("external_ingest", "", organizationId=organization_id, campaignId=campaign_id, outcome="error", reason=str(exc))
            self.respond_json(HTTPStatus.BAD_REQUEST, {"message": str(exc)})
            return
        except Exception:
            self.audit("external_ingest", "", organizationId=organization_id, campaignId=campaign_id, outcome="error", reason="unexpected_failure")
            self.respond_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"message": "Failed to ingest the external record."})
            return

        self.audit(
            "external_ingest",
            "",
            organizationId=result.get("organizationId", organization_id),
            campaignId=result.get("campaignId", campaign_id),
            outcome="success",
            transactionId=result.get("transactionId", ""),
            importBatchId=result.get("importBatchId", ""),
            sourceTransactionKey=result.get("sourceTransactionKey", ""),
            sourceLabel=source_label,
        )
        self.respond_json(
            HTTPStatus.OK if result.get("created") is False else HTTPStatus.CREATED,
            {
                "ok": True,
                **result,
                "message": "The external record was ingested successfully.",
            },
        )

    def handle_auth_status(self) -> None:
        auth_context = self.get_auth_context()
        accessible_campaigns = get_accessible_campaign_summaries(auth_context) if auth_context else []
        self.respond_json(
            HTTPStatus.OK,
            {
                "mode": "backend",
                "authenticated": bool(auth_context),
                "email": auth_context["email"] if auth_context else "",
                "role": auth_context["role"] if auth_context else "",
                "organizationSlug": auth_context["organizationSlug"] if auth_context else "",
                "campaignSlugs": auth_context["campaignSlugs"] if auth_context else [],
                "accessibleCampaigns": accessible_campaigns,
                "sessionExpiresAt": auth_context["expiresAt"] if auth_context else "",
                "setupSupported": True,
            },
        )

    def handle_admin_dataset(self) -> None:
        auth_context = self.require_authenticated_admin(ROLE_ANALYST)
        if not auth_context:
            self.respond_json(HTTPStatus.UNAUTHORIZED, {"message": "נדרשת התחברות מנהל כדי לטעון את הנתונים הניהוליים."})
            return
        if auth_context.get("error"):
            denied_context = auth_context.get("context", {})
            self.audit("dataset_forbidden", denied_context.get("email", ""), role=denied_context.get("role", ""))
            self.respond_json(auth_context["status"], {"message": auth_context["message"]})
            return

        payload = load_admin_dataset_payload()
        if not payload:
            self.respond_json(
                HTTPStatus.NOT_FOUND,
                {"message": "מאגר הנתונים הניהולי לא זמין כרגע. אפשר להעלות קובץ עסקאות ידנית לאחר הכניסה."},
            )
            return

        self.respond_json(
            HTTPStatus.OK,
            {
                "rows": payload.get("rows", []),
                "meta": payload.get("meta", {}),
                "sourceLabel": payload.get("sourceLabel", "קובץ בסיס מאובטח"),
                "generatedAt": payload.get("generatedAt", ""),
            },
        )
        self.audit("admin_dataset_view", auth_context["email"], role=auth_context["role"])
        return
        token = self.get_session_token()
        authenticated_email = None
        if token:
            with get_connection() as connection:
                ensure_schema(connection)
                seed_admins(connection)
                authenticated_email = get_authenticated_email(connection, token)

        if not authenticated_email:
            self.respond_json(HTTPStatus.UNAUTHORIZED, {"message": "נדרשת התחברות מנהל כדי לטעון את הנתונים הניהוליים."})
            return

        payload = load_admin_dataset_payload()
        if not payload:
            self.respond_json(
                HTTPStatus.NOT_FOUND,
                {"message": "מאגר הנתונים הניהולי לא זמין כרגע. אפשר להעלות קובץ עסקאות ידנית לאחר הכניסה."},
            )
            return

        self.respond_json(
            HTTPStatus.OK,
            {
                "rows": payload.get("rows", []),
                "meta": payload.get("meta", {}),
                "sourceLabel": payload.get("sourceLabel", "קובץ בסיס מאובטח"),
                "generatedAt": payload.get("generatedAt", ""),
            },
        )

    def require_authenticated_admin(self, minimum_role: str = ROLE_VIEWER) -> dict[str, Any] | None:
        context = self.get_auth_context()
        if not context:
            return None
        if not has_required_role(context.get("role", ROLE_VIEWER), minimum_role):
            return {
                "error": True,
                "status": HTTPStatus.FORBIDDEN,
                "message": "אין הרשאה מספקת לביצוע הפעולה המבוקשת.",
                "context": context,
            }
        return context
        token = self.get_session_token()
        if not token:
            return None
        with get_connection() as connection:
            ensure_schema(connection)
            seed_admins(connection)
            return get_authenticated_email(connection, token)

    def handle_source_config_get(self) -> None:
        auth_context = self.require_authenticated_admin(ROLE_CAMPAIGN_MANAGER)
        if not auth_context:
            self.respond_json(HTTPStatus.UNAUTHORIZED, {"message": "נדרשת התחברות מנהל כדי לנהל חיבורי API של מקור הנתונים."})
            return
        if auth_context.get("error"):
            self.respond_json(auth_context["status"], {"message": auth_context["message"]})
            return

        config = load_source_config()
        self.respond_json(
            HTTPStatus.OK,
            {
                "config": redact_source_config(config),
                "message": "הגדרות מקור הנתונים נטענו.",
            },
        )
        self.audit("source_config_view", auth_context["email"], role=auth_context["role"])
        return
        authenticated_email = self.require_authenticated_admin()
        if not authenticated_email:
            self.respond_json(HTTPStatus.UNAUTHORIZED, {"message": "נדרשת התחברות מנהל כדי לנהל חיבורי API של מקור הנתונים."})
            return

        config = load_source_config()
        self.respond_json(
            HTTPStatus.OK,
            {
                "config": redact_source_config(config),
                "message": "הגדרות מקור הנתונים נטענו.",
            },
        )

    def handle_source_config_save(self) -> None:
        auth_context = self.require_authenticated_admin(ROLE_CAMPAIGN_MANAGER)
        if not auth_context:
            self.respond_json(HTTPStatus.UNAUTHORIZED, {"message": "נדרשת התחברות מנהל כדי לשמור חיבור API."})
            return
        if auth_context.get("error"):
            self.respond_json(auth_context["status"], {"message": auth_context["message"]})
            return

        payload = self.read_json_body()
        config = payload.get("config") if isinstance(payload.get("config"), dict) else {}
        try:
            normalized = save_source_config(config)
        except ValueError as exc:
            self.respond_json(HTTPStatus.BAD_REQUEST, {"message": str(exc)})
            return
        self.respond_json(
            HTTPStatus.OK,
            {
                "saved": True,
                "config": redact_source_config(normalized),
                "message": "חיבור מקור הנתונים נשמר בשרת המקומי." if normalized.get("mode") == "api" else "מצב מקור הנתונים נשמר על טעינת קובץ.",
            },
        )
        self.audit("source_config_saved", auth_context["email"], role=auth_context["role"], mode=normalized.get("mode", "file"))
        return
        authenticated_email = self.require_authenticated_admin()
        if not authenticated_email:
            self.respond_json(HTTPStatus.UNAUTHORIZED, {"message": "נדרשת התחברות מנהל כדי לשמור חיבור API."})
            return

        payload = self.read_json_body()
        config = payload.get("config") if isinstance(payload.get("config"), dict) else {}
        normalized = save_source_config(config)
        self.respond_json(
            HTTPStatus.OK,
            {
                "saved": True,
                "config": redact_source_config(normalized),
                "message": "חיבור מקור הנתונים נשמר בשרת המקומי." if normalized.get("mode") == "api" else "מצב מקור הנתונים נשמר על טעינת קובץ.",
            },
        )

    def handle_campaign_config_get(self) -> None:
        auth_context = self.require_authenticated_admin(ROLE_CAMPAIGN_MANAGER)
        if not auth_context:
            self.respond_json(HTTPStatus.UNAUTHORIZED, {"message": "נדרשת התחברות מנהל כדי לטעון את הגדרות הקמפיין."})
            return
        if auth_context.get("error"):
            self.respond_json(auth_context["status"], {"message": auth_context["message"]})
            return

        stored_payload: dict[str, Any] = {}
        if CAMPAIGN_CONFIG_PATH.exists():
            try:
                loaded = json.loads(CAMPAIGN_CONFIG_PATH.read_text(encoding="utf-8"))
                if isinstance(loaded, dict):
                    stored_payload = loaded
            except json.JSONDecodeError:
                stored_payload = {}

        config = load_campaign_config()
        self.respond_json(
            HTTPStatus.OK,
            {
                "config": config,
                "updatedAt": stored_payload.get("updatedAt", ""),
                "updatedBy": stored_payload.get("updatedBy", ""),
                "message": "הגדרות הקמפיין נטענו מהשרת המקומי.",
            },
        )
        self.audit("campaign_config_view", auth_context["email"], role=auth_context["role"])
        return
        authenticated_email = self.require_authenticated_admin()
        if not authenticated_email:
            self.respond_json(HTTPStatus.UNAUTHORIZED, {"message": "נדרשת התחברות מנהל כדי לטעון את הגדרות הקמפיין."})
            return

        stored_payload: dict[str, Any] = {}
        if CAMPAIGN_CONFIG_PATH.exists():
            try:
                loaded = json.loads(CAMPAIGN_CONFIG_PATH.read_text(encoding="utf-8"))
                if isinstance(loaded, dict):
                    stored_payload = loaded
            except json.JSONDecodeError:
                stored_payload = {}

        config = load_campaign_config()
        self.respond_json(
            HTTPStatus.OK,
            {
                "config": config,
                "updatedAt": stored_payload.get("updatedAt", ""),
                "updatedBy": stored_payload.get("updatedBy", ""),
                "message": "הגדרות הקמפיין נטענו מהשרת המקומי.",
            },
        )

    def handle_campaign_config_save(self) -> None:
        auth_context = self.require_authenticated_admin(ROLE_CAMPAIGN_MANAGER)
        if not auth_context:
            self.respond_json(HTTPStatus.UNAUTHORIZED, {"message": "נדרשת התחברות מנהל כדי לשמור את הגדרות הקמפיין."})
            return
        if auth_context.get("error"):
            self.respond_json(auth_context["status"], {"message": auth_context["message"]})
            return

        payload = self.read_json_body()
        config = payload.get("config") if isinstance(payload.get("config"), dict) else {}
        saved = save_campaign_config(config, auth_context["email"])
        self.respond_json(
            HTTPStatus.OK,
            {
                "saved": True,
                "config": saved.get("config", {}),
                "updatedAt": saved.get("updatedAt", ""),
                "updatedBy": saved.get("updatedBy", ""),
                "message": "הגדרות הקמפיין נשמרו בשרת המקומי.",
            },
        )
        self.audit("campaign_config_saved", auth_context["email"], role=auth_context["role"])
        return
        authenticated_email = self.require_authenticated_admin()
        if not authenticated_email:
            self.respond_json(HTTPStatus.UNAUTHORIZED, {"message": "נדרשת התחברות מנהל כדי לשמור את הגדרות הקמפיין."})
            return

        payload = self.read_json_body()
        config = payload.get("config") if isinstance(payload.get("config"), dict) else {}
        saved = save_campaign_config(config, authenticated_email)
        self.respond_json(
            HTTPStatus.OK,
            {
                "saved": True,
                "config": saved.get("config", {}),
                "updatedAt": saved.get("updatedAt", ""),
                "updatedBy": saved.get("updatedBy", ""),
                "message": "הגדרות הקמפיין נשמרו בשרת המקומי.",
            },
        )

    def handle_source_refresh(self) -> None:
        auth_context = self.require_authenticated_admin(ROLE_CAMPAIGN_MANAGER)
        if not auth_context:
            self.respond_json(HTTPStatus.UNAUTHORIZED, {"message": "נדרשת התחברות מנהל כדי למשוך נתונים ממערכת המקור."})
            return
        if auth_context.get("error"):
            self.respond_json(auth_context["status"], {"message": auth_context["message"]})
            return

        config = load_source_config()
        if config.get("mode") != "api":
            self.respond_json(HTTPStatus.CONFLICT, {"message": "מקור הנתונים הפעיל מוגדר כרגע כקובץ, לא כ-API."})
            return

        try:
            payload = fetch_source_payload(config)
        except ValueError as exc:
            self.respond_json(HTTPStatus.BAD_REQUEST, {"message": str(exc)})
            return
        except RuntimeError as exc:
            self.respond_json(HTTPStatus.BAD_GATEWAY, {"message": str(exc)})
            return

        self.respond_json(
            HTTPStatus.OK,
            {
                "ok": True,
                **payload,
                "message": "הנתונים נמשכו בהצלחה מהמערכת החיצונית.",
            },
        )
        self.audit("source_refresh", auth_context["email"], role=auth_context["role"], mode=config.get("mode", "file"))
        return
        authenticated_email = self.require_authenticated_admin()
        if not authenticated_email:
            self.respond_json(HTTPStatus.UNAUTHORIZED, {"message": "נדרשת התחברות מנהל כדי למשוך נתונים ממערכת המקור."})
            return

        config = load_source_config()
        if config.get("mode") != "api":
            self.respond_json(HTTPStatus.CONFLICT, {"message": "מקור הנתונים הפעיל מוגדר כרגע כקובץ, לא כ-API."})
            return

        try:
            payload = fetch_source_payload(config)
        except (RuntimeError, ValueError) as exc:
            self.respond_json(HTTPStatus.BAD_GATEWAY, {"message": str(exc)})
            return

        self.respond_json(
            HTTPStatus.OK,
            {
                "ok": True,
                **payload,
                "message": "הנתונים נמשכו בהצלחה מהמערכת החיצונית.",
            },
        )

    def handle_auth_login(self) -> None:
        payload = self.read_json_body()
        email = normalize_email(str(payload.get("email", "")))
        password = str(payload.get("password", ""))
        if not email or not password:
            self.respond_json(HTTPStatus.BAD_REQUEST, {"message": "יש למלא גם מייל וגם סיסמה."})
            return

        if uses_postgres_platform_store():
            with _connect_postgres_platform() as connection:
                seed_admins_postgres(connection)
                admin = get_admin_postgres(connection, email)
                if not admin or not bool(admin["is_active"]):
                    self.respond_json(
                        HTTPStatus.FORBIDDEN,
                        {"message": "המייל שהוזן אינו מורשה לגישה לפאנל הניהול."},
                    )
                    return
                if not admin["password_hash"]:
                    self.respond_json(
                        HTTPStatus.CONFLICT,
                        {
                            "message": "זו כניסה ראשונה עבור המייל הזה. יש להגדיר סיסמה אישית לפני כניסה.",
                            "code": "setup_required",
                            "setupRequired": True,
                        },
                    )
                    return
                if not verify_password(password, str(admin["password_hash"])):
                    self.respond_json(HTTPStatus.UNAUTHORIZED, {"message": "הסיסמה שגויה. נסו שוב."})
                    return
                token = create_session_postgres(connection, email)
        else:
            with get_connection() as connection:
                ensure_schema(connection)
                seed_admins(connection)
                admin = get_admin(connection, email)
                if not admin or not bool(admin["is_active"]):
                    self.respond_json(
                        HTTPStatus.FORBIDDEN,
                        {"message": "המייל שהוזן אינו מורשה לגישה לפאנל הניהול."},
                    )
                    return
                if not admin["password_hash"]:
                    self.respond_json(
                        HTTPStatus.CONFLICT,
                        {
                            "message": "זו כניסה ראשונה עבור המייל הזה. יש להגדיר סיסמה אישית לפני כניסה.",
                            "code": "setup_required",
                            "setupRequired": True,
                        },
                    )
                    return
                if not verify_password(password, str(admin["password_hash"])):
                    self.respond_json(HTTPStatus.UNAUTHORIZED, {"message": "הסיסמה שגויה. נסו שוב."})
                    return
                token = create_session(connection, email)

        self.respond_json(
            HTTPStatus.OK,
            {
                "authenticated": True,
                "email": email,
                "message": "הכניסה הצליחה. הדשבורד הניהולי נפתח.",
            },
            extra_headers=[("Set-Cookie", build_set_cookie(token, SESSION_DURATION_HOURS * 60 * 60))],
        )

    def handle_auth_setup(self) -> None:
        payload = self.read_json_body()
        email = normalize_email(str(payload.get("email", "")))
        password = str(payload.get("password", ""))
        confirm_password = str(payload.get("confirmPassword", ""))
        if not email or not password or not confirm_password:
            self.respond_json(HTTPStatus.BAD_REQUEST, {"message": "יש למלא מייל, סיסמה ואימות סיסמה."})
            return
        if password != confirm_password:
            self.respond_json(HTTPStatus.BAD_REQUEST, {"message": "אימות הסיסמה לא תואם."})
            return
        if len(password) < 8:
            self.respond_json(HTTPStatus.BAD_REQUEST, {"message": "יש לבחור סיסמה באורך 8 תווים לפחות."})
            return

        if uses_postgres_platform_store():
            with _connect_postgres_platform() as connection:
                seed_admins_postgres(connection)
                admin = get_admin_postgres(connection, email)
                if not admin or not bool(admin["is_active"]):
                    self.respond_json(
                        HTTPStatus.FORBIDDEN,
                        {"message": "המייל שהוזן אינו מורשה להגדיר גישת מנהל."},
                    )
                    return
                if admin["password_hash"]:
                    self.respond_json(
                        HTTPStatus.CONFLICT,
                        {"message": "כבר הוגדרה סיסמה עבור המייל הזה. ניתן לעבור למסך הכניסה הרגיל."},
                    )
                    return
                update_admin_password_postgres(connection, email, password)
                token = create_session_postgres(connection, email)
        else:
            with get_connection() as connection:
                ensure_schema(connection)
                seed_admins(connection)
                admin = get_admin(connection, email)
                if not admin or not bool(admin["is_active"]):
                    self.respond_json(
                        HTTPStatus.FORBIDDEN,
                        {"message": "המייל שהוזן אינו מורשה להגדיר גישת מנהל."},
                    )
                    return
                if admin["password_hash"]:
                    self.respond_json(
                        HTTPStatus.CONFLICT,
                        {"message": "כבר הוגדרה סיסמה עבור המייל הזה. ניתן לעבור למסך הכניסה הרגיל."},
                    )
                    return
                update_admin_password(connection, email, password)
                token = create_session(connection, email)

        self.respond_json(
            HTTPStatus.OK,
            {
                "authenticated": True,
                "email": email,
                "message": "הסיסמה נשמרה והגישה לפאנל הניהול נפתחה.",
            },
            extra_headers=[("Set-Cookie", build_set_cookie(token, SESSION_DURATION_HOURS * 60 * 60))],
        )

    def handle_auth_logout(self) -> None:
        token = self.get_session_token()
        auth_context = self.get_auth_context()
        if token:
            if uses_postgres_platform_store():
                with _connect_postgres_platform() as connection:
                    delete_session_postgres(connection, token)
            else:
                with get_connection() as connection:
                    ensure_schema(connection)
                    delete_session(connection, token)

        self.respond_json(
            HTTPStatus.OK,
            {"loggedOut": True},
            extra_headers=[("Set-Cookie", build_set_cookie(None, 0))],
        )
        self.audit("logout", auth_context["email"] if auth_context else "")

    def handle_auth_change_password(self) -> None:
        auth_context = self.require_authenticated_admin(ROLE_VIEWER)
        if not auth_context:
            self.respond_json(HTTPStatus.UNAUTHORIZED, {"message": "נדרשת התחברות כדי להחליף סיסמה."})
            return
        if auth_context.get("error"):
            self.respond_json(auth_context["status"], {"message": auth_context["message"]})
            return

        payload = self.read_json_body()
        current_password = str(payload.get("currentPassword", ""))
        new_password = str(payload.get("newPassword", ""))
        confirm_password = str(payload.get("confirmPassword", ""))
        if not current_password or not new_password or not confirm_password:
            self.respond_json(HTTPStatus.BAD_REQUEST, {"message": "יש למלא סיסמה נוכחית, סיסמה חדשה ואימות סיסמה."})
            return
        if new_password != confirm_password:
            self.respond_json(HTTPStatus.BAD_REQUEST, {"message": "אימות הסיסמה החדשה לא תואם."})
            return
        if len(new_password) < 8:
            self.respond_json(HTTPStatus.BAD_REQUEST, {"message": "הסיסמה החדשה חייבת לכלול לפחות 8 תווים."})
            return

        if uses_postgres_platform_store():
            with _connect_postgres_platform() as connection:
                seed_admins_postgres(connection)
                admin = get_admin_postgres(connection, auth_context["email"])
                if not admin or not admin["password_hash"] or not verify_password(current_password, str(admin["password_hash"])):
                    self.respond_json(HTTPStatus.UNAUTHORIZED, {"message": "הסיסמה הנוכחית שגויה."})
                    return
                update_admin_password_postgres(connection, auth_context["email"], new_password)
                delete_sessions_for_email_postgres(connection, auth_context["email"])
                token = create_session_postgres(connection, auth_context["email"])
        else:
            with get_connection() as connection:
                ensure_schema(connection)
                seed_admins(connection)
                admin = get_admin(connection, auth_context["email"])
                if not admin or not admin["password_hash"] or not verify_password(current_password, str(admin["password_hash"])):
                    self.respond_json(HTTPStatus.UNAUTHORIZED, {"message": "הסיסמה הנוכחית שגויה."})
                    return
                update_admin_password(connection, auth_context["email"], new_password)
                delete_sessions_for_email(connection, auth_context["email"])
                token = create_session(connection, auth_context["email"])

        self.respond_json(
            HTTPStatus.OK,
            {
                "changed": True,
                "message": "הסיסמה הוחלפה בהצלחה.",
            },
            extra_headers=[("Set-Cookie", build_set_cookie(token, SESSION_DURATION_HOURS * 60 * 60))],
        )
        self.audit("password_changed", auth_context["email"], role=auth_context["role"])

    def handle_auth_reset_local(self) -> None:
        payload = self.read_json_body()
        email = normalize_email(str(payload.get("email", "")))
        if not email:
            self.respond_json(HTTPStatus.BAD_REQUEST, {"message": "יש להזין מייל מנהל/ת כדי לאפס סיסמה."})
            return

        if uses_postgres_platform_store():
            with _connect_postgres_platform() as connection:
                seed_admins_postgres(connection)
                admin = get_admin_postgres(connection, email)
                if not admin or not bool(admin["is_active"]):
                    self.respond_json(
                        HTTPStatus.FORBIDDEN,
                        {"message": "המייל שהוזן אינו מורשה לאיפוס במערכת הניהול המקומית."},
                    )
                    return
                reset_admin_password_postgres(connection, email)
        else:
            with get_connection() as connection:
                ensure_schema(connection)
                seed_admins(connection)
                admin = get_admin(connection, email)
                if not admin or not bool(admin["is_active"]):
                    self.respond_json(
                        HTTPStatus.FORBIDDEN,
                        {"message": "המייל שהוזן אינו מורשה לאיפוס במערכת הניהול המקומית."},
                    )
                    return
                connection.execute(
                    """
                    UPDATE admins
                    SET password_hash = NULL, password_set_at = NULL, last_login_at = NULL
                    WHERE lower(email) = ?
                    """,
                    (normalize_email(email),),
                )
                connection.execute(
                    "DELETE FROM admin_sessions WHERE lower(admin_email) = ?",
                    (normalize_email(email),),
                )
                connection.commit()

        self.respond_json(
            HTTPStatus.OK,
            {
                "reset": True,
                "email": email,
                "message": "הסיסמה אופסה במערכת המקומית. בכניסה הבאה יש להגדיר סיסמה חדשה.",
            },
            extra_headers=[("Set-Cookie", build_set_cookie(None, 0))],
        )
        self.audit("password_reset_local", email)


def serve(host: str = "127.0.0.1", port: int = 8767) -> None:
    initialize_database()
    server = DashboardServer((host, port), DashboardRequestHandler)
    print(f"Yellow dashboard backend listening on http://{host}:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
