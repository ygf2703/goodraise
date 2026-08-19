from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import re
import sys
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

import psycopg


GOODRAISE_UUID_NAMESPACE = uuid.uuid5(uuid.NAMESPACE_URL, "goodraise")
CSV_FIELD_NAMES = [
    "id",
    "created_at",
    "full_name",
    "reward",
    "price",
    "quantity",
    "total",
    "currencyname",
    "phone",
    "email",
    "Ambassador name",
    "Ambassador email",
    "shipping_name",
    "delivery_comment",
    "google_address_line",
    "city",
    "zip",
    "charged_success",
    "charge_result",
    "direct_debit",
    "direct debit active",
]
CSV_FIELD_ALIASES = {
    "ambassador_name": "Ambassador name",
    "ambassadorName": "Ambassador name",
    "ambassador_email": "Ambassador email",
    "ambassadorEmail": "Ambassador email",
    "fullName": "full_name",
    "createdAt": "created_at",
    "shippingName": "shipping_name",
    "deliveryComment": "delivery_comment",
    "address": "google_address_line",
    "addressLine": "google_address_line",
    "currency": "currencyname",
    "chargedSuccess": "charged_success",
    "chargeResult": "charge_result",
    "directDebit": "direct_debit",
    "directDebitActive": "direct debit active",
}


SCHEMA_SQL = """
CREATE SCHEMA IF NOT EXISTS goodraise;

CREATE TABLE IF NOT EXISTS goodraise.organizations (
    id UUID PRIMARY KEY,
    app_id TEXT,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS goodraise.campaigns (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES goodraise.organizations(id) ON DELETE CASCADE,
    app_id TEXT,
    slug TEXT NOT NULL,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    target_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
    updated_by TEXT NOT NULL DEFAULT '',
    source_filename TEXT,
    source_checksum_sha256 TEXT,
    starts_at TIMESTAMPTZ,
    ends_at TIMESTAMPTZ,
    currency_code TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, slug)
);

CREATE TABLE IF NOT EXISTS goodraise.currencies (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS goodraise.import_batches (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES goodraise.organizations(id) ON DELETE CASCADE,
    campaign_id UUID NOT NULL REFERENCES goodraise.campaigns(id) ON DELETE CASCADE,
    source_filename TEXT NOT NULL,
    source_checksum_sha256 TEXT NOT NULL,
    raw_fieldnames JSONB NOT NULL,
    raw_row_count INTEGER NOT NULL DEFAULT 0,
    imported_row_count INTEGER NOT NULL DEFAULT 0,
    skipped_blank_rows INTEGER NOT NULL DEFAULT 0,
    imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    imported_by TEXT NOT NULL DEFAULT 'codex',
    notes TEXT,
    UNIQUE (campaign_id, source_checksum_sha256)
);

CREATE TABLE IF NOT EXISTS goodraise.donors (
    id UUID PRIMARY KEY,
    donor_key TEXT NOT NULL UNIQUE,
    full_name TEXT,
    phone TEXT,
    email TEXT,
    email_normalized TEXT,
    shipping_name TEXT,
    delivery_comment TEXT,
    google_address_line TEXT,
    city TEXT,
    zip TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS goodraise.ambassadors (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES goodraise.organizations(id) ON DELETE CASCADE,
    campaign_id UUID NOT NULL REFERENCES goodraise.campaigns(id) ON DELETE CASCADE,
    ambassador_key TEXT NOT NULL,
    full_name TEXT,
    email TEXT,
    email_normalized TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (campaign_id, ambassador_key)
);

CREATE TABLE IF NOT EXISTS goodraise.rewards (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES goodraise.organizations(id) ON DELETE CASCADE,
    campaign_id UUID NOT NULL REFERENCES goodraise.campaigns(id) ON DELETE CASCADE,
    reward_key TEXT NOT NULL,
    reward_name TEXT,
    unit_price NUMERIC(12, 2),
    quantity INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (campaign_id, reward_key)
);

CREATE TABLE IF NOT EXISTS goodraise.transactions (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES goodraise.organizations(id) ON DELETE CASCADE,
    campaign_id UUID NOT NULL REFERENCES goodraise.campaigns(id) ON DELETE CASCADE,
    import_batch_id UUID NOT NULL REFERENCES goodraise.import_batches(id) ON DELETE CASCADE,
    source_row_number INTEGER NOT NULL,
    source_id TEXT,
    source_transaction_key TEXT NOT NULL,
    canonical_event_key TEXT,
    donor_id UUID REFERENCES goodraise.donors(id),
    ambassador_id UUID REFERENCES goodraise.ambassadors(id),
    reward_id UUID REFERENCES goodraise.rewards(id),
    occurred_at TIMESTAMPTZ,
    occurred_at_raw TEXT,
    total_amount NUMERIC(12, 2),
    currency_code TEXT REFERENCES goodraise.currencies(code),
    charged_success BOOLEAN,
    charge_result_code TEXT,
    direct_debit BOOLEAN,
    direct_debit_active BOOLEAN,
    raw_payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (campaign_id, source_transaction_key)
);

CREATE TABLE IF NOT EXISTS goodraise.transactions_csv_raw (
    import_batch_id UUID NOT NULL REFERENCES goodraise.import_batches(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES goodraise.organizations(id) ON DELETE CASCADE,
    campaign_id UUID NOT NULL REFERENCES goodraise.campaigns(id) ON DELETE CASCADE,
    transaction_id UUID REFERENCES goodraise.transactions(id) ON DELETE SET NULL,
    source_row_number INTEGER NOT NULL,
    "id" TEXT,
    "created_at" TEXT,
    "full_name" TEXT,
    "reward" TEXT,
    "price" TEXT,
    "quantity" TEXT,
    "total" TEXT,
    "currencyname" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "Ambassador name" TEXT,
    "Ambassador email" TEXT,
    "shipping_name" TEXT,
    "delivery_comment" TEXT,
    "google_address_line" TEXT,
    "city" TEXT,
    "zip" TEXT,
    "charged_success" TEXT,
    "charge_result" TEXT,
    "direct_debit" TEXT,
    "direct debit active" TEXT,
    imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (import_batch_id, source_row_number)
);

CREATE TABLE IF NOT EXISTS goodraise.campaign_configs (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES goodraise.organizations(id) ON DELETE CASCADE,
    campaign_id UUID NOT NULL REFERENCES goodraise.campaigns(id) ON DELETE CASCADE,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    revision BIGINT NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by TEXT NOT NULL DEFAULT '',
    UNIQUE (campaign_id)
);

CREATE TABLE IF NOT EXISTS goodraise.campaign_sources (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES goodraise.organizations(id) ON DELETE CASCADE,
    campaign_id UUID NOT NULL REFERENCES goodraise.campaigns(id) ON DELETE CASCADE,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    has_secret BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by TEXT NOT NULL DEFAULT '',
    UNIQUE (campaign_id)
);

CREATE TABLE IF NOT EXISTS goodraise.campaign_datasets (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES goodraise.organizations(id) ON DELETE CASCADE,
    campaign_id UUID NOT NULL REFERENCES goodraise.campaigns(id) ON DELETE CASCADE,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    row_count INTEGER NOT NULL DEFAULT 0,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (campaign_id)
);

CREATE TABLE IF NOT EXISTS goodraise.admin_users (
    id UUID PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL DEFAULT 'platform_admin',
    organization_app_id TEXT NOT NULL DEFAULT '',
    organization_slug TEXT NOT NULL DEFAULT '',
    campaign_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    campaign_slugs JSONB NOT NULL DEFAULT '[]'::jsonb,
    password_hash TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    password_set_at TIMESTAMPTZ,
    last_login_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS goodraise.admin_sessions (
    token TEXT PRIMARY KEY,
    admin_user_id UUID NOT NULL REFERENCES goodraise.admin_users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_campaigns_org ON goodraise.campaigns(organization_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_organizations_app_id ON goodraise.organizations(app_id) WHERE app_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_campaigns_org_app_id ON goodraise.campaigns(organization_id, app_id) WHERE app_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_import_batches_campaign ON goodraise.import_batches(campaign_id);
CREATE INDEX IF NOT EXISTS idx_ambassadors_campaign ON goodraise.ambassadors(campaign_id);
CREATE INDEX IF NOT EXISTS idx_rewards_campaign ON goodraise.rewards(campaign_id);
CREATE INDEX IF NOT EXISTS idx_transactions_campaign_time ON goodraise.transactions(campaign_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_transactions_donor ON goodraise.transactions(donor_id);
CREATE INDEX IF NOT EXISTS idx_transactions_ambassador ON goodraise.transactions(ambassador_id);
CREATE INDEX IF NOT EXISTS idx_raw_campaign ON goodraise.transactions_csv_raw(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_configs_campaign ON goodraise.campaign_configs(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_sources_campaign ON goodraise.campaign_sources(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_datasets_campaign ON goodraise.campaign_datasets(campaign_id);
CREATE INDEX IF NOT EXISTS idx_admin_users_role ON goodraise.admin_users(role);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_user ON goodraise.admin_sessions(admin_user_id);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires ON goodraise.admin_sessions(expires_at);
ALTER TABLE goodraise.transactions ADD COLUMN IF NOT EXISTS canonical_event_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_transactions_campaign_canonical_event_key ON goodraise.transactions(campaign_id, canonical_event_key);
"""


@dataclass
class CsvRow:
    row_number: int
    raw: dict[str, str]
    occurred_at: datetime | None
    total_amount: Decimal | None
    charged_success: bool | None
    direct_debit: bool | None
    direct_debit_active: bool | None
    donor_key: str
    ambassador_key: str | None
    reward_key: str | None
    canonical_event_key: str
    source_transaction_key: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Create the GoodRaise relational PostgreSQL schema and import a campaign CSV.")
    parser.add_argument("--database-url", default=os.getenv("GOODRAISE_DATABASE_URL") or os.getenv("DATABASE_URL"), help="PostgreSQL connection string")
    parser.add_argument("--csv", required=True, help="Path to the CSV file to import")
    parser.add_argument("--organization-slug", default="default-org", help="Organization slug")
    parser.add_argument("--organization-name", default="GoodRaise Imported Organization", help="Organization display name")
    parser.add_argument("--campaign-slug", default="imported-campaign", help="Campaign slug")
    parser.add_argument("--campaign-name", default="Imported Campaign", help="Campaign display name")
    parser.add_argument("--campaign-status", default="completed", help="Campaign status")
    parser.add_argument("--imported-by", default="codex", help="Audit label for the import batch")
    parser.add_argument("--notes", default="", help="Optional note saved on the import batch")
    return parser.parse_args()


def normalize_slug(value: str, fallback: str) -> str:
    candidate = re.sub(r"[^a-z0-9]+", "-", (value or "").strip().lower()).strip("-")
    return candidate or fallback


def normalize_email(value: str) -> str:
    return (value or "").strip().lower()


def normalize_phone(value: str) -> str:
    return re.sub(r"\D+", "", value or "")


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "").strip())


def parse_timestamp(value: str) -> datetime | None:
    raw = normalize_text(value)
    if not raw:
        return None
    iso_candidate = raw.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(iso_candidate)
        return parsed.astimezone(UTC) if parsed.tzinfo else parsed.replace(tzinfo=UTC)
    except ValueError:
        pass
    for pattern in ("%d/%m/%y %H:%M", "%d/%m/%Y %H:%M", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(raw, pattern).replace(tzinfo=UTC)
        except ValueError:
            continue
    return None


def parse_decimal(value: str) -> Decimal | None:
    raw = normalize_text(value).replace(",", "")
    if not raw:
        return None
    try:
        return Decimal(raw)
    except InvalidOperation:
        return None


def parse_bool(value: str) -> bool | None:
    raw = normalize_text(value).lower()
    if raw in {"true", "1", "yes", "y"}:
        return True
    if raw in {"false", "0", "no", "n"}:
        return False
    return None


def parse_int(value: str) -> int | None:
    raw = normalize_text(value)
    if not raw:
        return None
    try:
        return int(raw)
    except ValueError:
        return None


def build_sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def build_stable_uuid(*parts: str) -> uuid.UUID:
    return uuid.uuid5(GOODRAISE_UUID_NAMESPACE, "|".join(parts))


def build_donor_key(row: dict[str, str]) -> str:
    email = normalize_email(row.get("email", ""))
    phone = normalize_phone(row.get("phone", ""))
    name = normalize_text(row.get("full_name", ""))
    address = normalize_text(row.get("google_address_line", ""))
    city = normalize_text(row.get("city", ""))
    zip_code = normalize_text(row.get("zip", ""))
    if email:
        return build_sha256(f"email:{email}")
    if phone:
        return build_sha256(f"phone:{phone}")
    return build_sha256(f"name:{name}|address:{address}|city:{city}|zip:{zip_code}")


def build_ambassador_key(row: dict[str, str]) -> str | None:
    email = normalize_email(row.get("Ambassador email", ""))
    name = normalize_text(row.get("Ambassador name", ""))
    if email:
        return build_sha256(f"ambassador-email:{email}")
    if name:
        return build_sha256(f"ambassador-name:{name}")
    return None


def build_reward_key(row: dict[str, str]) -> str | None:
    reward = normalize_text(row.get("reward", ""))
    price = normalize_text(row.get("price", ""))
    quantity = normalize_text(row.get("quantity", ""))
    if not any((reward, price, quantity)):
        return None
    return build_sha256(f"reward:{reward}|price:{price}|quantity:{quantity}")


def build_canonical_event_key(row: dict[str, str]) -> str:
    source_id = normalize_text(row.get("id", ""))
    if source_id:
        return build_sha256(f"source-id:{source_id}")
    stable = json.dumps(
        {
            "created_at": normalize_text(row.get("created_at", "")),
            "email": normalize_email(row.get("email", "")),
            "phone": normalize_phone(row.get("phone", "")),
            "full_name": normalize_text(row.get("full_name", "")),
            "total": normalize_text(row.get("total", "")),
            "currencyname": normalize_text(row.get("currencyname", "")),
            "ambassador_email": normalize_email(row.get("Ambassador email", "")),
            "charge_result": normalize_text(row.get("charge_result", "")),
            "charged_success": normalize_text(row.get("charged_success", "")),
        },
        ensure_ascii=False,
        sort_keys=True,
    )
    return build_sha256(stable)


def build_source_transaction_key(row: dict[str, str], row_number: int) -> str:
    _ = row_number
    return build_canonical_event_key(row)


def is_blank_row(row: dict[str, str]) -> bool:
    return all(not normalize_text(value) for value in row.values())


def normalize_external_record(payload: dict[str, Any]) -> dict[str, str]:
    normalized = {field: "" for field in CSV_FIELD_NAMES}
    for key, value in (payload or {}).items():
        canonical_key = CSV_FIELD_ALIASES.get(str(key), str(key))
        if canonical_key in normalized:
            normalized[canonical_key] = "" if value is None else str(value).strip()
    return normalized


def compute_file_checksum(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_csv_rows(path: Path) -> tuple[list[str], list[CsvRow], int, int, datetime | None, datetime | None, str | None]:
    with path.open("r", encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        if not reader.fieldnames:
            raise ValueError("CSV file has no header row")

        raw_count = 0
        skipped_blank = 0
        parsed_rows: list[CsvRow] = []
        min_dt: datetime | None = None
        max_dt: datetime | None = None
        first_currency: str | None = None

        for row_number, raw_row in enumerate(reader, start=2):
            raw_count += 1
            clean_row = {key: (value or "").strip() for key, value in raw_row.items()}
            if is_blank_row(clean_row):
                skipped_blank += 1
                continue
            occurred_at = parse_timestamp(clean_row.get("created_at", ""))
            if occurred_at:
                min_dt = occurred_at if min_dt is None or occurred_at < min_dt else min_dt
                max_dt = occurred_at if max_dt is None or occurred_at > max_dt else max_dt
            currency = normalize_text(clean_row.get("currencyname", ""))
            if currency and not first_currency:
                first_currency = currency

            parsed_rows.append(
                CsvRow(
                    row_number=row_number,
                    raw=clean_row,
                    occurred_at=occurred_at,
                    total_amount=parse_decimal(clean_row.get("total", "")),
                    charged_success=parse_bool(clean_row.get("charged_success", "")),
                    direct_debit=parse_bool(clean_row.get("direct_debit", "")),
                    direct_debit_active=parse_bool(clean_row.get("direct debit active", "")),
                    donor_key=build_donor_key(clean_row),
                    ambassador_key=build_ambassador_key(clean_row),
                    reward_key=build_reward_key(clean_row),
                    canonical_event_key=build_canonical_event_key(clean_row),
                    source_transaction_key=build_source_transaction_key(clean_row, row_number),
                )
            )

    return reader.fieldnames, parsed_rows, raw_count, skipped_blank, min_dt, max_dt, first_currency


def fetch_one_uuid(cursor: psycopg.Cursor[Any], query: str, params: tuple[Any, ...]) -> uuid.UUID | None:
    cursor.execute(query, params)
    row = cursor.fetchone()
    return row[0] if row else None


def ensure_organization(cursor: psycopg.Cursor[Any], slug: str, name: str) -> uuid.UUID:
    organization_id = fetch_one_uuid(cursor, "SELECT id FROM goodraise.organizations WHERE slug = %s", (slug,))
    if organization_id:
        cursor.execute(
            """
            UPDATE goodraise.organizations
            SET name = %s, updated_at = NOW()
            WHERE id = %s
            """,
            (name, organization_id),
        )
        return organization_id

    organization_id = uuid.uuid4()
    cursor.execute(
        """
        INSERT INTO goodraise.organizations (id, slug, name)
        VALUES (%s, %s, %s)
        """,
        (organization_id, slug, name),
    )
    return organization_id


def ensure_campaign(
    cursor: psycopg.Cursor[Any],
    organization_id: uuid.UUID,
    slug: str,
    name: str,
    status: str,
    source_filename: str,
    source_checksum: str,
    starts_at: datetime | None,
    ends_at: datetime | None,
    currency_code: str | None,
) -> uuid.UUID:
    campaign_id = fetch_one_uuid(
        cursor,
        "SELECT id FROM goodraise.campaigns WHERE organization_id = %s AND slug = %s",
        (organization_id, slug),
    )
    if campaign_id:
        cursor.execute(
            """
            UPDATE goodraise.campaigns
            SET name = %s,
                status = %s,
                source_filename = %s,
                source_checksum_sha256 = %s,
                starts_at = COALESCE(%s, starts_at),
                ends_at = COALESCE(%s, ends_at),
                currency_code = COALESCE(%s, currency_code),
                updated_at = NOW()
            WHERE id = %s
            """,
            (name, status, source_filename, source_checksum, starts_at, ends_at, currency_code, campaign_id),
        )
        return campaign_id

    campaign_id = uuid.uuid4()
    cursor.execute(
        """
        INSERT INTO goodraise.campaigns (
            id, organization_id, slug, name, status, source_filename, source_checksum_sha256, starts_at, ends_at, currency_code
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (campaign_id, organization_id, slug, name, status, source_filename, source_checksum, starts_at, ends_at, currency_code),
    )
    return campaign_id


def ensure_currency(cursor: psycopg.Cursor[Any], code: str | None) -> str | None:
    if not code:
        return None
    normalized = normalize_text(code).upper()
    if not normalized:
        return None
    cursor.execute(
        """
        INSERT INTO goodraise.currencies (code, name)
        VALUES (%s, %s)
        ON CONFLICT (code) DO NOTHING
        """,
        (normalized, normalized),
    )
    return normalized


def ensure_import_batch(
    cursor: psycopg.Cursor[Any],
    organization_id: uuid.UUID,
    campaign_id: uuid.UUID,
    source_filename: str,
    source_checksum: str,
    fieldnames: list[str],
    raw_row_count: int,
    imported_row_count: int,
    skipped_blank_rows: int,
    imported_by: str,
    notes: str,
) -> tuple[uuid.UUID, bool]:
    cursor.execute(
        """
        SELECT id
        FROM goodraise.import_batches
        WHERE campaign_id = %s AND source_checksum_sha256 = %s
        """,
        (campaign_id, source_checksum),
    )
    existing = cursor.fetchone()
    if existing:
        return existing[0], False

    batch_id = uuid.uuid4()
    cursor.execute(
        """
        INSERT INTO goodraise.import_batches (
            id,
            organization_id,
            campaign_id,
            source_filename,
            source_checksum_sha256,
            raw_fieldnames,
            raw_row_count,
            imported_row_count,
            skipped_blank_rows,
            imported_by,
            notes
        )
        VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s, %s, %s, %s, %s)
        """,
        (
            batch_id,
            organization_id,
            campaign_id,
            source_filename,
            source_checksum,
            json.dumps(fieldnames, ensure_ascii=False),
            raw_row_count,
            imported_row_count,
            skipped_blank_rows,
            imported_by,
            notes,
        ),
    )
    return batch_id, True


def upsert_donor(cursor: psycopg.Cursor[Any], row: CsvRow, donor_cache: dict[str, uuid.UUID]) -> uuid.UUID:
    cached = donor_cache.get(row.donor_key)
    if cached:
        return cached

    donor_id = uuid.uuid4()
    cursor.execute(
        """
        INSERT INTO goodraise.donors (
            id, donor_key, full_name, phone, email, email_normalized, shipping_name, delivery_comment, google_address_line, city, zip
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (donor_key) DO UPDATE
        SET full_name = COALESCE(NULLIF(EXCLUDED.full_name, ''), goodraise.donors.full_name),
            phone = COALESCE(NULLIF(EXCLUDED.phone, ''), goodraise.donors.phone),
            email = COALESCE(NULLIF(EXCLUDED.email, ''), goodraise.donors.email),
            email_normalized = COALESCE(NULLIF(EXCLUDED.email_normalized, ''), goodraise.donors.email_normalized),
            shipping_name = COALESCE(NULLIF(EXCLUDED.shipping_name, ''), goodraise.donors.shipping_name),
            delivery_comment = COALESCE(NULLIF(EXCLUDED.delivery_comment, ''), goodraise.donors.delivery_comment),
            google_address_line = COALESCE(NULLIF(EXCLUDED.google_address_line, ''), goodraise.donors.google_address_line),
            city = COALESCE(NULLIF(EXCLUDED.city, ''), goodraise.donors.city),
            zip = COALESCE(NULLIF(EXCLUDED.zip, ''), goodraise.donors.zip),
            updated_at = NOW()
        RETURNING id
        """,
        (
            donor_id,
            row.donor_key,
            row.raw.get("full_name", ""),
            row.raw.get("phone", ""),
            row.raw.get("email", ""),
            normalize_email(row.raw.get("email", "")),
            row.raw.get("shipping_name", ""),
            row.raw.get("delivery_comment", ""),
            row.raw.get("google_address_line", ""),
            row.raw.get("city", ""),
            row.raw.get("zip", ""),
        ),
    )
    donor_id = cursor.fetchone()[0]
    donor_cache[row.donor_key] = donor_id
    return donor_id


def upsert_ambassador(
    cursor: psycopg.Cursor[Any],
    organization_id: uuid.UUID,
    campaign_id: uuid.UUID,
    row: CsvRow,
    ambassador_cache: dict[str, uuid.UUID],
) -> uuid.UUID | None:
    if not row.ambassador_key:
        return None
    cached = ambassador_cache.get(row.ambassador_key)
    if cached:
        return cached

    ambassador_id = uuid.uuid4()
    cursor.execute(
        """
        INSERT INTO goodraise.ambassadors (
            id, organization_id, campaign_id, ambassador_key, full_name, email, email_normalized
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (campaign_id, ambassador_key) DO UPDATE
        SET full_name = COALESCE(NULLIF(EXCLUDED.full_name, ''), goodraise.ambassadors.full_name),
            email = COALESCE(NULLIF(EXCLUDED.email, ''), goodraise.ambassadors.email),
            email_normalized = COALESCE(NULLIF(EXCLUDED.email_normalized, ''), goodraise.ambassadors.email_normalized),
            updated_at = NOW()
        RETURNING id
        """,
        (
            ambassador_id,
            organization_id,
            campaign_id,
            row.ambassador_key,
            row.raw.get("Ambassador name", ""),
            row.raw.get("Ambassador email", ""),
            normalize_email(row.raw.get("Ambassador email", "")),
        ),
    )
    ambassador_id = cursor.fetchone()[0]
    ambassador_cache[row.ambassador_key] = ambassador_id
    return ambassador_id


def upsert_reward(
    cursor: psycopg.Cursor[Any],
    organization_id: uuid.UUID,
    campaign_id: uuid.UUID,
    row: CsvRow,
    reward_cache: dict[str, uuid.UUID],
) -> uuid.UUID | None:
    if not row.reward_key:
        return None
    cached = reward_cache.get(row.reward_key)
    if cached:
        return cached

    reward_id = uuid.uuid4()
    cursor.execute(
        """
        INSERT INTO goodraise.rewards (
            id, organization_id, campaign_id, reward_key, reward_name, unit_price, quantity
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (campaign_id, reward_key) DO UPDATE
        SET reward_name = COALESCE(NULLIF(EXCLUDED.reward_name, ''), goodraise.rewards.reward_name),
            unit_price = COALESCE(EXCLUDED.unit_price, goodraise.rewards.unit_price),
            quantity = COALESCE(EXCLUDED.quantity, goodraise.rewards.quantity),
            updated_at = NOW()
        RETURNING id
        """,
        (
            reward_id,
            organization_id,
            campaign_id,
            row.reward_key,
            row.raw.get("reward", ""),
            parse_decimal(row.raw.get("price", "")),
            parse_int(row.raw.get("quantity", "")),
        ),
    )
    reward_id = cursor.fetchone()[0]
    reward_cache[row.reward_key] = reward_id
    return reward_id


def insert_transaction(
    cursor: psycopg.Cursor[Any],
    organization_id: uuid.UUID,
    campaign_id: uuid.UUID,
    import_batch_id: uuid.UUID,
    donor_id: uuid.UUID,
    ambassador_id: uuid.UUID | None,
    reward_id: uuid.UUID | None,
    row: CsvRow,
    currency_code: str | None,
) -> uuid.UUID:
    transaction_id = uuid.uuid4()
    cursor.execute(
        """
        INSERT INTO goodraise.transactions (
            id,
            organization_id,
            campaign_id,
            import_batch_id,
            source_row_number,
            source_id,
            source_transaction_key,
            canonical_event_key,
            donor_id,
            ambassador_id,
            reward_id,
            occurred_at,
            occurred_at_raw,
            total_amount,
            currency_code,
            charged_success,
            charge_result_code,
            direct_debit,
            direct_debit_active,
            raw_payload
        )
        VALUES (
            %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb
        )
        ON CONFLICT (campaign_id, canonical_event_key) DO UPDATE
        SET donor_id = EXCLUDED.donor_id,
            ambassador_id = EXCLUDED.ambassador_id,
            reward_id = EXCLUDED.reward_id,
            occurred_at = EXCLUDED.occurred_at,
            occurred_at_raw = EXCLUDED.occurred_at_raw,
            total_amount = EXCLUDED.total_amount,
            currency_code = EXCLUDED.currency_code,
            charged_success = EXCLUDED.charged_success,
            charge_result_code = EXCLUDED.charge_result_code,
            direct_debit = EXCLUDED.direct_debit,
            direct_debit_active = EXCLUDED.direct_debit_active,
            raw_payload = EXCLUDED.raw_payload
        RETURNING id
        """,
        (
            transaction_id,
            organization_id,
            campaign_id,
            import_batch_id,
            row.row_number,
            normalize_text(row.raw.get("id", "")) or None,
            row.source_transaction_key,
            row.canonical_event_key,
            donor_id,
            ambassador_id,
            reward_id,
            row.occurred_at,
            row.raw.get("created_at", ""),
            row.total_amount,
            currency_code,
            row.charged_success,
            normalize_text(row.raw.get("charge_result", "")) or None,
            row.direct_debit,
            row.direct_debit_active,
            json.dumps(row.raw, ensure_ascii=False),
        ),
    )
    return cursor.fetchone()[0]


def insert_raw_row(
    cursor: psycopg.Cursor[Any],
    import_batch_id: uuid.UUID,
    organization_id: uuid.UUID,
    campaign_id: uuid.UUID,
    transaction_id: uuid.UUID,
    row: CsvRow,
) -> None:
    cursor.execute(
        """
        INSERT INTO goodraise.transactions_csv_raw (
            import_batch_id,
            organization_id,
            campaign_id,
            transaction_id,
            source_row_number,
            "id",
            "created_at",
            "full_name",
            "reward",
            "price",
            "quantity",
            "total",
            "currencyname",
            "phone",
            "email",
            "Ambassador name",
            "Ambassador email",
            "shipping_name",
            "delivery_comment",
            "google_address_line",
            "city",
            "zip",
            "charged_success",
            "charge_result",
            "direct_debit",
            "direct debit active"
        )
        VALUES (
            %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
        )
        ON CONFLICT (import_batch_id, source_row_number) DO UPDATE
        SET transaction_id = EXCLUDED.transaction_id,
            "id" = EXCLUDED."id",
            "created_at" = EXCLUDED."created_at",
            "full_name" = EXCLUDED."full_name",
            "reward" = EXCLUDED."reward",
            "price" = EXCLUDED."price",
            "quantity" = EXCLUDED."quantity",
            "total" = EXCLUDED."total",
            "currencyname" = EXCLUDED."currencyname",
            "phone" = EXCLUDED."phone",
            "email" = EXCLUDED."email",
            "Ambassador name" = EXCLUDED."Ambassador name",
            "Ambassador email" = EXCLUDED."Ambassador email",
            "shipping_name" = EXCLUDED."shipping_name",
            "delivery_comment" = EXCLUDED."delivery_comment",
            "google_address_line" = EXCLUDED."google_address_line",
            "city" = EXCLUDED."city",
            "zip" = EXCLUDED."zip",
            "charged_success" = EXCLUDED."charged_success",
            "charge_result" = EXCLUDED."charge_result",
            "direct_debit" = EXCLUDED."direct_debit",
            "direct debit active" = EXCLUDED."direct debit active"
        """,
        (
            import_batch_id,
            organization_id,
            campaign_id,
            transaction_id,
            row.row_number,
            row.raw.get("id", ""),
            row.raw.get("created_at", ""),
            row.raw.get("full_name", ""),
            row.raw.get("reward", ""),
            row.raw.get("price", ""),
            row.raw.get("quantity", ""),
            row.raw.get("total", ""),
            row.raw.get("currencyname", ""),
            row.raw.get("phone", ""),
            row.raw.get("email", ""),
            row.raw.get("Ambassador name", ""),
            row.raw.get("Ambassador email", ""),
            row.raw.get("shipping_name", ""),
            row.raw.get("delivery_comment", ""),
            row.raw.get("google_address_line", ""),
            row.raw.get("city", ""),
            row.raw.get("zip", ""),
            row.raw.get("charged_success", ""),
            row.raw.get("charge_result", ""),
            row.raw.get("direct_debit", ""),
            row.raw.get("direct debit active", ""),
        ),
    )


def backfill_existing_canonical_event_keys(cursor: psycopg.Cursor[Any], campaign_id: uuid.UUID) -> None:
    cursor.execute(
        """
        SELECT id, source_id, raw_payload
        FROM goodraise.transactions
        WHERE campaign_id = %s
          AND (canonical_event_key IS NULL OR canonical_event_key = '')
        """,
        (campaign_id,),
    )
    pending_updates: list[tuple[str, uuid.UUID]] = []
    for transaction_id, source_id, raw_payload in cursor.fetchall():
        payload = raw_payload if isinstance(raw_payload, dict) else {}
        record = normalize_external_record(payload)
        if source_id:
            record["id"] = str(source_id)
        pending_updates.append((build_canonical_event_key(record), transaction_id))
    if pending_updates:
        cursor.executemany(
            """
            UPDATE goodraise.transactions
            SET canonical_event_key = %s
            WHERE id = %s
            """,
            pending_updates,
        )


def fetch_existing_canonical_event_keys(cursor: psycopg.Cursor[Any], campaign_id: uuid.UUID) -> set[str]:
    cursor.execute(
        """
        SELECT canonical_event_key
        FROM goodraise.transactions
        WHERE campaign_id = %s
          AND canonical_event_key IS NOT NULL
          AND canonical_event_key <> ''
        """,
        (campaign_id,),
    )
    return {row[0] for row in cursor.fetchall() if row and row[0]}


def filter_new_rows(rows: list[CsvRow], existing_canonical_keys: set[str]) -> tuple[list[CsvRow], int]:
    filtered: list[CsvRow] = []
    seen_keys = set(existing_canonical_keys)
    skipped_duplicates = 0
    for row in rows:
        if row.canonical_event_key in seen_keys:
            skipped_duplicates += 1
            continue
        filtered.append(row)
        seen_keys.add(row.canonical_event_key)
    return filtered, skipped_duplicates


def resolve_organization_campaign(
    cursor: psycopg.Cursor[Any],
    organization_identifier: str,
    campaign_identifier: str,
) -> dict[str, Any] | None:
    normalized_org = normalize_text(organization_identifier).lower()
    normalized_campaign = normalize_text(campaign_identifier).lower()
    cursor.execute(
        """
        SELECT
            o.id,
            o.slug,
            o.name,
            c.id,
            c.slug,
            c.name,
            c.status,
            c.currency_code
        FROM goodraise.organizations o
        INNER JOIN goodraise.campaigns c
            ON c.organization_id = o.id
        WHERE
            (LOWER(CAST(o.id AS TEXT)) = %s OR LOWER(o.slug) = %s)
            AND
            (LOWER(CAST(c.id AS TEXT)) = %s OR LOWER(c.slug) = %s)
        LIMIT 1
        """,
        (normalized_org, normalized_org, normalized_campaign, normalized_campaign),
    )
    row = cursor.fetchone()
    if not row:
        return None
    return {
        "organization_id": row[0],
        "organization_slug": row[1],
        "organization_name": row[2],
        "campaign_id": row[3],
        "campaign_slug": row[4],
        "campaign_name": row[5],
        "campaign_status": row[6],
        "currency_code": row[7],
    }


def build_live_csv_row(record: dict[str, str], source_row_number: int = 1) -> CsvRow:
    return CsvRow(
        row_number=source_row_number,
        raw=record,
        occurred_at=parse_timestamp(record.get("created_at", "")),
        total_amount=parse_decimal(record.get("total", "")),
        charged_success=parse_bool(record.get("charged_success", "")),
        direct_debit=parse_bool(record.get("direct_debit", "")),
        direct_debit_active=parse_bool(record.get("direct debit active", "")),
        donor_key=build_donor_key(record),
        ambassador_key=build_ambassador_key(record),
        reward_key=build_reward_key(record),
        canonical_event_key=build_canonical_event_key(record),
        source_transaction_key=build_source_transaction_key(record, source_row_number),
    )


def build_dataset_meta(rows: list[dict[str, Any]]) -> dict[str, Any]:
    unique_dates = sorted({str(row.get("date") or "").strip() for row in rows if str(row.get("date") or "").strip()})
    default_from = unique_dates[0] if unique_dates else ""
    default_to = unique_dates[-1] if unique_dates else ""
    return {
        "uniqueDates": unique_dates,
        "projectDates": unique_dates,
        "defaultFrom": default_from,
        "defaultTo": default_to,
        "minDate": default_from,
        "maxDate": default_to,
        "rowCount": len(rows),
        "projectWindowLabel": f"{default_from} עד {default_to}" if default_from and default_to else "",
    }


def build_dataset_row(record: dict[str, str]) -> dict[str, Any]:
    occurred_at = parse_timestamp(record.get("created_at", ""))
    created_iso = occurred_at.strftime("%Y-%m-%dT%H:%M") if occurred_at else ""
    return {
        "id": normalize_text(record.get("id", "")) or build_sha256(
            f"dataset-row:{normalize_text(record.get('created_at', ''))}|{normalize_email(record.get('email', ''))}|{normalize_text(record.get('total', ''))}"
        ),
        "createdIso": created_iso,
        "date": created_iso[:10],
        "hour": occurred_at.hour if occurred_at else 0,
        "ambassador": normalize_text(record.get("Ambassador name", "")) or "ללא שיוך",
        "donor": normalize_text(record.get("full_name", "")) or "ללא שם",
        "email": normalize_email(record.get("email", "")),
        "amount": float(parse_decimal(record.get("total", "")) or 0),
        "city": normalize_text(record.get("city", "")) or "ללא עיר",
        "status": "success" if parse_bool(record.get("charged_success", "")) else "failed",
        "chargeResult": normalize_text(record.get("charge_result", "")),
    }


def sync_campaign_dataset_snapshot(
    cursor: psycopg.Cursor[Any],
    scope: dict[str, Any],
    record: dict[str, str],
    source_label: str,
) -> dict[str, Any]:
    cursor.execute(
        """
        SELECT payload
        FROM goodraise.campaign_datasets
        WHERE campaign_id = %s
        LIMIT 1
        """,
        (scope["campaign_id"],),
    )
    existing_row = cursor.fetchone()
    existing_payload = existing_row[0] if existing_row and isinstance(existing_row[0], dict) else {}
    current_rows = existing_payload.get("rows") if isinstance(existing_payload.get("rows"), list) else []
    next_row = build_dataset_row(record)
    next_rows = [next_row, *[row for row in current_rows if str(row.get("id", "")).strip() != next_row["id"]]]
    next_rows.sort(key=lambda row: str(row.get("createdIso") or ""), reverse=True)
    next_payload = {
        "organizationId": existing_payload.get("organizationId") or scope["organization_slug"],
        "campaignId": existing_payload.get("campaignId") or scope["campaign_slug"],
        "rows": next_rows,
        "meta": build_dataset_meta(next_rows),
        "sourceLabel": str(existing_payload.get("sourceLabel") or source_label or "external-api").strip(),
        "generatedAt": existing_payload.get("generatedAt") or datetime.now(UTC).isoformat(),
        "updatedAt": datetime.now(UTC).isoformat(),
    }
    cursor.execute(
        """
        INSERT INTO goodraise.campaign_datasets (id, organization_id, campaign_id, payload, row_count, generated_at, updated_at)
        VALUES (%s::uuid, %s::uuid, %s::uuid, %s::jsonb, %s, %s, %s)
        ON CONFLICT (campaign_id) DO UPDATE SET
            payload = EXCLUDED.payload,
            row_count = EXCLUDED.row_count,
            generated_at = EXCLUDED.generated_at,
            updated_at = EXCLUDED.updated_at
        """,
        (
            str(uuid.uuid4()),
            str(scope["organization_id"]),
            str(scope["campaign_id"]),
            json.dumps(next_payload, ensure_ascii=False),
            len(next_rows),
            next_payload["generatedAt"],
            next_payload["updatedAt"],
        ),
    )
    return {
        "rowCount": len(next_rows),
        "sourceLabel": next_payload["sourceLabel"],
    }


def ingest_external_record(
    connection: psycopg.Connection[Any],
    organization_identifier: str,
    campaign_identifier: str,
    record_payload: dict[str, Any],
    source_label: str = "external-api",
    imported_by: str = "external-api",
    request_reference: str = "",
) -> dict[str, Any]:
    normalized_record = normalize_external_record(record_payload)
    if is_blank_row(normalized_record):
        raise ValueError("Payload record is empty.")

    live_row = build_live_csv_row(normalized_record, 1)
    checksum = build_sha256(
        json.dumps(
            {
                "organization": organization_identifier,
                "campaign": campaign_identifier,
                "request_reference": request_reference,
                "source_label": source_label,
                "record": normalized_record,
                "created_at": datetime.now(UTC).isoformat(),
            },
            ensure_ascii=False,
            sort_keys=True,
        )
    )

    with connection.cursor() as cursor:
        cursor.execute(SCHEMA_SQL)
        scope = resolve_organization_campaign(cursor, organization_identifier, campaign_identifier)
        if not scope:
            raise LookupError("Organization or campaign was not found in PostgreSQL.")
        backfill_existing_canonical_event_keys(cursor, scope["campaign_id"])
        cursor.execute(
            """
            SELECT id, import_batch_id
            FROM goodraise.transactions
            WHERE campaign_id = %s AND canonical_event_key = %s
            LIMIT 1
            """,
            (scope["campaign_id"], live_row.canonical_event_key),
        )
        existing_transaction = cursor.fetchone()
        if existing_transaction:
            dataset_state = sync_campaign_dataset_snapshot(cursor, scope, normalized_record, source_label)
            connection.commit()
            return {
                "organizationId": str(scope["organization_id"]),
                "organizationSlug": scope["organization_slug"],
                "campaignId": str(scope["campaign_id"]),
                "campaignSlug": scope["campaign_slug"],
                "transactionId": str(existing_transaction[0]),
                "importBatchId": str(existing_transaction[1]),
                "dataset": dataset_state,
                "sourceTransactionKey": live_row.source_transaction_key,
                "currencyCode": normalize_text(normalized_record.get("currencyname") or scope.get("currency_code") or ""),
                "totalAmount": str(live_row.total_amount) if live_row.total_amount is not None else "",
                "duplicate": True,
                "created": False,
            }

        currency_code = ensure_currency(cursor, normalized_record.get("currencyname") or scope.get("currency_code"))
        import_batch_id = uuid.uuid4()
        cursor.execute(
            """
            INSERT INTO goodraise.import_batches (
                id,
                organization_id,
                campaign_id,
                source_filename,
                source_checksum_sha256,
                raw_fieldnames,
                raw_row_count,
                imported_row_count,
                skipped_blank_rows,
                imported_by,
                notes
            )
            VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s, %s, %s, %s, %s)
            """,
            (
                import_batch_id,
                scope["organization_id"],
                scope["campaign_id"],
                f"{source_label}.json",
                checksum,
                json.dumps(CSV_FIELD_NAMES, ensure_ascii=False),
                1,
                1,
                0,
                imported_by,
                f"request_reference={request_reference or 'n/a'}",
            ),
        )

        donor_id = upsert_donor(cursor, live_row, {})
        ambassador_id = upsert_ambassador(cursor, scope["organization_id"], scope["campaign_id"], live_row, {})
        reward_id = upsert_reward(cursor, scope["organization_id"], scope["campaign_id"], live_row, {})
        transaction_id = insert_transaction(
            cursor,
            scope["organization_id"],
            scope["campaign_id"],
            import_batch_id,
            donor_id,
            ambassador_id,
            reward_id,
            live_row,
            currency_code,
        )
        insert_raw_row(cursor, import_batch_id, scope["organization_id"], scope["campaign_id"], transaction_id, live_row)
        dataset_state = sync_campaign_dataset_snapshot(cursor, scope, normalized_record, source_label)
        connection.commit()

    return {
        "organizationId": str(scope["organization_id"]),
        "organizationSlug": scope["organization_slug"],
        "campaignId": str(scope["campaign_id"]),
        "campaignSlug": scope["campaign_slug"],
        "transactionId": str(transaction_id),
        "importBatchId": str(import_batch_id),
        "dataset": dataset_state,
        "sourceTransactionKey": live_row.source_transaction_key,
        "currencyCode": currency_code,
        "totalAmount": str(live_row.total_amount) if live_row.total_amount is not None else "",
        "duplicate": False,
        "created": True,
    }


def build_batch_payloads(
    organization_id: uuid.UUID,
    campaign_id: uuid.UUID,
    import_batch_id: uuid.UUID,
    rows: list[CsvRow],
    currency_code: str | None,
) -> tuple[list[tuple[Any, ...]], list[tuple[Any, ...]], list[tuple[Any, ...]], list[tuple[Any, ...]], list[tuple[Any, ...]]]:
    donor_records: dict[str, tuple[Any, ...]] = {}
    ambassador_records: dict[str, tuple[Any, ...]] = {}
    reward_records: dict[str, tuple[Any, ...]] = {}
    transaction_records: list[tuple[Any, ...]] = []
    raw_records: list[tuple[Any, ...]] = []

    for row in rows:
        donor_id = build_stable_uuid("donor", row.donor_key)
        donor_records[row.donor_key] = (
            donor_id,
            row.donor_key,
            row.raw.get("full_name", ""),
            row.raw.get("phone", ""),
            row.raw.get("email", ""),
            normalize_email(row.raw.get("email", "")),
            row.raw.get("shipping_name", ""),
            row.raw.get("delivery_comment", ""),
            row.raw.get("google_address_line", ""),
            row.raw.get("city", ""),
            row.raw.get("zip", ""),
        )

        ambassador_id: uuid.UUID | None = None
        if row.ambassador_key:
            ambassador_id = build_stable_uuid("ambassador", str(campaign_id), row.ambassador_key)
            ambassador_records[row.ambassador_key] = (
                ambassador_id,
                organization_id,
                campaign_id,
                row.ambassador_key,
                row.raw.get("Ambassador name", ""),
                row.raw.get("Ambassador email", ""),
                normalize_email(row.raw.get("Ambassador email", "")),
            )

        reward_id: uuid.UUID | None = None
        if row.reward_key:
            reward_id = build_stable_uuid("reward", str(campaign_id), row.reward_key)
            reward_records[row.reward_key] = (
                reward_id,
                organization_id,
                campaign_id,
                row.reward_key,
                row.raw.get("reward", ""),
                parse_decimal(row.raw.get("price", "")),
                parse_int(row.raw.get("quantity", "")),
            )

        transaction_id = build_stable_uuid("transaction", str(campaign_id), row.source_transaction_key)
        transaction_records.append(
            (
                transaction_id,
                organization_id,
                campaign_id,
                import_batch_id,
                row.row_number,
                normalize_text(row.raw.get("id", "")) or None,
                row.source_transaction_key,
                row.canonical_event_key,
                donor_id,
                ambassador_id,
                reward_id,
                row.occurred_at,
                row.raw.get("created_at", ""),
                row.total_amount,
                currency_code,
                row.charged_success,
                normalize_text(row.raw.get("charge_result", "")) or None,
                row.direct_debit,
                row.direct_debit_active,
                json.dumps(row.raw, ensure_ascii=False),
            )
        )
        raw_records.append(
            (
                import_batch_id,
                organization_id,
                campaign_id,
                transaction_id,
                row.row_number,
                row.raw.get("id", ""),
                row.raw.get("created_at", ""),
                row.raw.get("full_name", ""),
                row.raw.get("reward", ""),
                row.raw.get("price", ""),
                row.raw.get("quantity", ""),
                row.raw.get("total", ""),
                row.raw.get("currencyname", ""),
                row.raw.get("phone", ""),
                row.raw.get("email", ""),
                row.raw.get("Ambassador name", ""),
                row.raw.get("Ambassador email", ""),
                row.raw.get("shipping_name", ""),
                row.raw.get("delivery_comment", ""),
                row.raw.get("google_address_line", ""),
                row.raw.get("city", ""),
                row.raw.get("zip", ""),
                row.raw.get("charged_success", ""),
                row.raw.get("charge_result", ""),
                row.raw.get("direct_debit", ""),
                row.raw.get("direct debit active", ""),
            )
        )

    return list(donor_records.values()), list(ambassador_records.values()), list(reward_records.values()), transaction_records, raw_records


def batch_upsert_donors(cursor: psycopg.Cursor[Any], donor_records: list[tuple[Any, ...]]) -> None:
    if not donor_records:
        return
    cursor.executemany(
        """
        INSERT INTO goodraise.donors (
            id, donor_key, full_name, phone, email, email_normalized, shipping_name, delivery_comment, google_address_line, city, zip
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (donor_key) DO UPDATE
        SET full_name = COALESCE(NULLIF(EXCLUDED.full_name, ''), goodraise.donors.full_name),
            phone = COALESCE(NULLIF(EXCLUDED.phone, ''), goodraise.donors.phone),
            email = COALESCE(NULLIF(EXCLUDED.email, ''), goodraise.donors.email),
            email_normalized = COALESCE(NULLIF(EXCLUDED.email_normalized, ''), goodraise.donors.email_normalized),
            shipping_name = COALESCE(NULLIF(EXCLUDED.shipping_name, ''), goodraise.donors.shipping_name),
            delivery_comment = COALESCE(NULLIF(EXCLUDED.delivery_comment, ''), goodraise.donors.delivery_comment),
            google_address_line = COALESCE(NULLIF(EXCLUDED.google_address_line, ''), goodraise.donors.google_address_line),
            city = COALESCE(NULLIF(EXCLUDED.city, ''), goodraise.donors.city),
            zip = COALESCE(NULLIF(EXCLUDED.zip, ''), goodraise.donors.zip),
            updated_at = NOW()
        """,
        donor_records,
    )


def batch_upsert_ambassadors(cursor: psycopg.Cursor[Any], ambassador_records: list[tuple[Any, ...]]) -> None:
    if not ambassador_records:
        return
    cursor.executemany(
        """
        INSERT INTO goodraise.ambassadors (
            id, organization_id, campaign_id, ambassador_key, full_name, email, email_normalized
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (campaign_id, ambassador_key) DO UPDATE
        SET full_name = COALESCE(NULLIF(EXCLUDED.full_name, ''), goodraise.ambassadors.full_name),
            email = COALESCE(NULLIF(EXCLUDED.email, ''), goodraise.ambassadors.email),
            email_normalized = COALESCE(NULLIF(EXCLUDED.email_normalized, ''), goodraise.ambassadors.email_normalized),
            updated_at = NOW()
        """,
        ambassador_records,
    )


def batch_upsert_rewards(cursor: psycopg.Cursor[Any], reward_records: list[tuple[Any, ...]]) -> None:
    if not reward_records:
        return
    cursor.executemany(
        """
        INSERT INTO goodraise.rewards (
            id, organization_id, campaign_id, reward_key, reward_name, unit_price, quantity
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (campaign_id, reward_key) DO UPDATE
        SET reward_name = COALESCE(NULLIF(EXCLUDED.reward_name, ''), goodraise.rewards.reward_name),
            unit_price = COALESCE(EXCLUDED.unit_price, goodraise.rewards.unit_price),
            quantity = COALESCE(EXCLUDED.quantity, goodraise.rewards.quantity),
            updated_at = NOW()
        """,
        reward_records,
    )


def batch_upsert_transactions(cursor: psycopg.Cursor[Any], transaction_records: list[tuple[Any, ...]]) -> None:
    if not transaction_records:
        return
    cursor.executemany(
        """
        INSERT INTO goodraise.transactions (
            id,
            organization_id,
            campaign_id,
            import_batch_id,
            source_row_number,
            source_id,
            source_transaction_key,
            canonical_event_key,
            donor_id,
            ambassador_id,
            reward_id,
            occurred_at,
            occurred_at_raw,
            total_amount,
            currency_code,
            charged_success,
            charge_result_code,
            direct_debit,
            direct_debit_active,
            raw_payload
        )
        VALUES (
            %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb
        )
        ON CONFLICT (campaign_id, canonical_event_key) DO UPDATE
        SET donor_id = EXCLUDED.donor_id,
            ambassador_id = EXCLUDED.ambassador_id,
            reward_id = EXCLUDED.reward_id,
            occurred_at = EXCLUDED.occurred_at,
            occurred_at_raw = EXCLUDED.occurred_at_raw,
            total_amount = EXCLUDED.total_amount,
            currency_code = EXCLUDED.currency_code,
            charged_success = EXCLUDED.charged_success,
            charge_result_code = EXCLUDED.charge_result_code,
            direct_debit = EXCLUDED.direct_debit,
            direct_debit_active = EXCLUDED.direct_debit_active,
            raw_payload = EXCLUDED.raw_payload
        """,
        transaction_records,
    )


def batch_upsert_raw_rows(cursor: psycopg.Cursor[Any], raw_records: list[tuple[Any, ...]]) -> None:
    if not raw_records:
        return
    cursor.executemany(
        """
        INSERT INTO goodraise.transactions_csv_raw (
            import_batch_id,
            organization_id,
            campaign_id,
            transaction_id,
            source_row_number,
            "id",
            "created_at",
            "full_name",
            "reward",
            "price",
            "quantity",
            "total",
            "currencyname",
            "phone",
            "email",
            "Ambassador name",
            "Ambassador email",
            "shipping_name",
            "delivery_comment",
            "google_address_line",
            "city",
            "zip",
            "charged_success",
            "charge_result",
            "direct_debit",
            "direct debit active"
        )
        VALUES (
            %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
        )
        ON CONFLICT (import_batch_id, source_row_number) DO UPDATE
        SET transaction_id = EXCLUDED.transaction_id,
            "id" = EXCLUDED."id",
            "created_at" = EXCLUDED."created_at",
            "full_name" = EXCLUDED."full_name",
            "reward" = EXCLUDED."reward",
            "price" = EXCLUDED."price",
            "quantity" = EXCLUDED."quantity",
            "total" = EXCLUDED."total",
            "currencyname" = EXCLUDED."currencyname",
            "phone" = EXCLUDED."phone",
            "email" = EXCLUDED."email",
            "Ambassador name" = EXCLUDED."Ambassador name",
            "Ambassador email" = EXCLUDED."Ambassador email",
            "shipping_name" = EXCLUDED."shipping_name",
            "delivery_comment" = EXCLUDED."delivery_comment",
            "google_address_line" = EXCLUDED."google_address_line",
            "city" = EXCLUDED."city",
            "zip" = EXCLUDED."zip",
            "charged_success" = EXCLUDED."charged_success",
            "charge_result" = EXCLUDED."charge_result",
            "direct_debit" = EXCLUDED."direct_debit",
            "direct debit active" = EXCLUDED."direct debit active"
        """,
        raw_records,
    )


def count_table(cursor: psycopg.Cursor[Any], table_name: str, campaign_id: uuid.UUID) -> int:
    cursor.execute(f"SELECT COUNT(*) FROM goodraise.{table_name} WHERE campaign_id = %s", (campaign_id,))
    return int(cursor.fetchone()[0])


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    args = parse_args()
    if not args.database_url:
        print("Missing PostgreSQL connection string. Supply --database-url or GOODRAISE_DATABASE_URL.", file=sys.stderr)
        return 1

    csv_path = Path(args.csv).resolve()
    if not csv_path.exists():
        print(f"CSV file not found: {csv_path}", file=sys.stderr)
        return 1

    fieldnames, rows, raw_row_count, skipped_blank_rows, min_dt, max_dt, detected_currency = read_csv_rows(csv_path)
    checksum = compute_file_checksum(csv_path)
    organization_slug = normalize_slug(args.organization_slug, "default-org")
    campaign_slug = normalize_slug(args.campaign_slug, "imported-campaign")

    with psycopg.connect(args.database_url) as connection:
        with connection.cursor() as cursor:
            cursor.execute(SCHEMA_SQL)
            organization_id = ensure_organization(cursor, organization_slug, args.organization_name)
            currency_code = ensure_currency(cursor, detected_currency)
            campaign_id = ensure_campaign(
                cursor,
                organization_id,
                campaign_slug,
                args.campaign_name,
                args.campaign_status,
                csv_path.name,
                checksum,
                min_dt,
                max_dt,
                currency_code,
            )
            backfill_existing_canonical_event_keys(cursor, campaign_id)
            rows_to_import, skipped_duplicate_rows = filter_new_rows(rows, fetch_existing_canonical_event_keys(cursor, campaign_id))
            import_batch_id, created = ensure_import_batch(
                cursor,
                organization_id,
                campaign_id,
                csv_path.name,
                checksum,
                fieldnames,
                raw_row_count,
                len(rows_to_import),
                skipped_blank_rows,
                args.imported_by,
                f"{args.notes} | skipped_duplicate_rows={skipped_duplicate_rows}".strip(" |"),
            )

            imported_transactions = 0
            if created:
                donor_records, ambassador_records, reward_records, transaction_records, raw_records = build_batch_payloads(
                    organization_id,
                    campaign_id,
                    import_batch_id,
                    rows_to_import,
                    currency_code,
                )
                batch_upsert_donors(cursor, donor_records)
                batch_upsert_ambassadors(cursor, ambassador_records)
                batch_upsert_rewards(cursor, reward_records)
                batch_upsert_transactions(cursor, transaction_records)
                batch_upsert_raw_rows(cursor, raw_records)
                imported_transactions = len(transaction_records)
            connection.commit()

            summary = {
                "database_schema": "goodraise",
                "organization": {
                    "id": str(organization_id),
                    "slug": organization_slug,
                    "name": args.organization_name,
                },
                "campaign": {
                    "id": str(campaign_id),
                    "slug": campaign_slug,
                    "name": args.campaign_name,
                    "status": args.campaign_status,
                    "starts_at": min_dt.isoformat() if min_dt else None,
                    "ends_at": max_dt.isoformat() if max_dt else None,
                    "currency_code": currency_code,
                },
                "import_batch": {
                    "id": str(import_batch_id),
                    "source_filename": csv_path.name,
                    "source_checksum_sha256": checksum,
                    "created_now": created,
                    "raw_row_count": raw_row_count,
                    "importable_rows": len(rows),
                    "new_rows_to_import": len(rows_to_import),
                    "skipped_blank_rows": skipped_blank_rows,
                    "skipped_duplicate_rows": skipped_duplicate_rows,
                    "processed_transactions": imported_transactions if created else 0,
                },
                "campaign_counts": {
                    "ambassadors": count_table(cursor, "ambassadors", campaign_id),
                    "rewards": count_table(cursor, "rewards", campaign_id),
                    "transactions": count_table(cursor, "transactions", campaign_id),
                    "raw_rows": count_table(cursor, "transactions_csv_raw", campaign_id),
                },
            }
            print(json.dumps(summary, ensure_ascii=False, indent=2))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
