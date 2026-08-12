from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib import error as urllib_error
from urllib import request as urllib_request
from urllib.parse import urlparse


ROOT_DIR = Path(__file__).resolve().parent.parent
WORK_DIR = ROOT_DIR / "work"
CONFIG_DIR = WORK_DIR / "config"
DATA_DIR = WORK_DIR / "data"
OUTPUTS_DIR = ROOT_DIR / "outputs"
NETLIFY_DATA_DIR = ROOT_DIR / "netlify" / "data"
ADMIN_DATASET_PATH = NETLIFY_DATA_DIR / "admin-dataset.json"
SOURCE_CONFIG_PATH = DATA_DIR / "dashboard-source-config.json"
CAMPAIGN_CONFIG_PATH = DATA_DIR / "dashboard-campaign-config.json"
AUDIT_LOG_PATH = DATA_DIR / "dashboard-audit-log.jsonl"
LOCAL_ACCESS_CONTROL_PATH = Path(
    os.getenv("YELLOW_DASHBOARD_ACCESS_CONTROL_JSON", str(CONFIG_DIR / "dashboard-access.local.json"))
).resolve()
EXAMPLE_ACCESS_CONTROL_PATH = (CONFIG_DIR / "dashboard-access.example.json").resolve()
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


def fetch_source_payload(config: dict[str, Any]) -> dict[str, Any]:
    normalized = normalize_source_config(config)
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

    request = urllib_request.Request(endpoint, data=body_bytes, headers=headers, method=method)

    try:
        with urllib_request.urlopen(request, timeout=30) as response:
            charset = response.headers.get_content_charset("utf-8")
            payload_text = response.read().decode(charset, errors="replace")
            if normalized["api"].get("responseFormat") == "json":
                payload: Any = json.loads(payload_text)
            else:
                payload = payload_text
    except urllib_error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace") if hasattr(exc, "read") else ""
        raise RuntimeError(
            f"המערכת החיצונית החזירה שגיאה {exc.code}{f': {detail[:180]}' if detail else ''}"
        ) from exc
    except urllib_error.URLError as exc:
        raise RuntimeError(f"לא ניתן היה להגיע לכתובת ה-API שהוגדרה: {exc.reason}") from exc
    except json.JSONDecodeError as exc:
        raise RuntimeError("התגובה מה-API הוגדרה כ-JSON אך לא התקבלה תגובת JSON תקינה.") from exc

    return {
        "mode": normalized["mode"],
        "sourceLabel": f"API · {endpoint}",
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
                ("Access-Control-Allow-Headers", "Content-Type"),
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
            with get_connection() as connection:
                ensure_schema(connection)
                seed_admins(connection)
                connection.execute("SELECT 1").fetchone()
                persistence_ok = True
        except sqlite3.Error:
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
                "authDatabaseReady": auth_db_exists,
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

    def handle_auth_status(self) -> None:
        auth_context = self.get_auth_context()
        self.respond_json(
            HTTPStatus.OK,
            {
                "mode": "backend",
                "authenticated": bool(auth_context),
                "email": auth_context["email"] if auth_context else "",
                "role": auth_context["role"] if auth_context else "",
                "organizationSlug": auth_context["organizationSlug"] if auth_context else "",
                "campaignSlugs": auth_context["campaignSlugs"] if auth_context else [],
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
        normalized = save_source_config(config)
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
