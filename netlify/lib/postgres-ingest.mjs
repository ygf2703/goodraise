import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { getCampaignDataset, saveCampaignDataset } from "./campaign-repositories.mjs";
import { normalizeEmail } from "./multi-tenant-model.mjs";

let postgresPoolPromise = null;
const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const LOCAL_INGEST_KEY_PATH = resolve(ROOT_DIR, "work", "config", "goodraise-ingest.local.json");

const CSV_FIELD_NAMES = [
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
];

const CSV_FIELD_ALIASES = {
  transaction_id: "id",
  transactionId: "id",
  transaction_datetime: "created_at",
  transactionDateTime: "created_at",
  transaction_amount: "total",
  transactionAmount: "total",
  ambassador_name: "Ambassador name",
  ambassadorName: "Ambassador name",
  ambassador_email: "Ambassador email",
  ambassadorEmail: "Ambassador email",
  fullName: "full_name",
  createdAt: "created_at",
  shippingName: "shipping_name",
  deliveryComment: "delivery_comment",
  address: "google_address_line",
  addressLine: "google_address_line",
  currency: "currencyname",
  chargedSuccess: "charged_success",
  chargeResult: "charge_result",
  directDebit: "direct_debit",
  directDebitActive: "direct debit active",
};

// Google Sheets often exposes human-readable Hebrew headers and formatted
// values instead of the machine headers used by the original CSV export.
// Keep this translation at ingestion time so the canonical database schema
// remains unchanged for every source.
const HUMAN_FIELD_ALIASES = {
  id: ["transaction id", "transaction_id", "order id", "donation id", "מזהה", "מזהה עסקה", "מספר עסקה", "מספר הזמנה", "מספר תרומה"],
  created_at: ["date", "date time", "datetime", "created at", "transaction date", "transaction datetime", "transaction_datetime", "donation date", "תאריך", "תאריך ושעה", "מועד עסקה", "תאריך עסקה", "תאריך תרומה"],
  full_name: ["name", "donor", "donor name", "שם מלא", "שם התורם", "שם התורמת", "תורם", "תורמת"],
  reward: ["reward", "gift", "שי", "תגמול", "פרס"],
  price: ["price", "מחיר"],
  quantity: ["quantity", "qty", "כמות"],
  total: ["amount", "total amount", "donation amount", "transaction amount", "transaction_amount", "סכום", "סכום תרומה", "סכום עסקה", "סהכ", "סך הכל", "סכום כולל"],
  currencyname: ["currency", "מטבע"],
  phone: ["phone", "mobile", "טלפון", "נייד", "מספר טלפון"],
  email: ["email", "e-mail", "mail", "מייל", "דואל", "דוא ל", "כתובת מייל"],
  "Ambassador name": ["ambassador", "ambassador name", "referrer", "שגריר", "שגרירה", "שם שגריר", "שם השגריר", "שם שגרירה"],
  "Ambassador email": ["ambassador email", "שגריר מייל", "מייל שגריר", "מייל השגריר"],
  city: ["city", "עיר"],
  charged_success: ["charged success", "success", "payment success", "סטטוס", "חיוב הצליח", "סליקה הצליחה"],
  charge_result: ["charge result", "payment result", "תוצאת סליקה", "תוצאת חיוב"],
};

function normalizeSourceFieldName(value) {
  return String(value || "")
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/["'`]/g, "")
    .replace(/[()/:\\_-]+/g, " ")
    .replace(/\s+/g, " ");
}

const NORMALIZED_HUMAN_FIELD_ALIASES = Object.fromEntries(
  Object.entries(HUMAN_FIELD_ALIASES).flatMap(([canonical, aliases]) =>
    aliases.map((alias) => [normalizeSourceFieldName(alias), canonical]),
  ),
);

const SCHEMA_SQL = `
CREATE SCHEMA IF NOT EXISTS goodraise;

CREATE TABLE IF NOT EXISTS goodraise.organizations (
    id UUID PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS goodraise.campaigns (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES goodraise.organizations(id) ON DELETE CASCADE,
    slug TEXT NOT NULL,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
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
    skipped_invalid_rows INTEGER NOT NULL DEFAULT 0,
    imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    imported_by TEXT NOT NULL DEFAULT 'external-api',
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
    phone TEXT,
    nickname TEXT,
    referred_by TEXT,
    was_ambassador_before BOOLEAN,
    registration_source TEXT,
    is_over_18 BOOLEAN,
    understands_not_packing BOOLEAN,
    terms_accepted BOOLEAN,
    registered_at TIMESTAMPTZ,
    registered_at_raw TEXT,
    registration_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
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

ALTER TABLE goodraise.transactions ADD COLUMN IF NOT EXISTS canonical_event_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_transactions_campaign_canonical_event_key ON goodraise.transactions(campaign_id, canonical_event_key);
ALTER TABLE goodraise.import_batches ADD COLUMN IF NOT EXISTS skipped_invalid_rows INTEGER NOT NULL DEFAULT 0;

ALTER TABLE goodraise.ambassadors ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE goodraise.ambassadors ADD COLUMN IF NOT EXISTS nickname TEXT;
ALTER TABLE goodraise.ambassadors ADD COLUMN IF NOT EXISTS referred_by TEXT;
ALTER TABLE goodraise.ambassadors ADD COLUMN IF NOT EXISTS was_ambassador_before BOOLEAN;
ALTER TABLE goodraise.ambassadors ADD COLUMN IF NOT EXISTS registration_source TEXT;
ALTER TABLE goodraise.ambassadors ADD COLUMN IF NOT EXISTS is_over_18 BOOLEAN;
ALTER TABLE goodraise.ambassadors ADD COLUMN IF NOT EXISTS understands_not_packing BOOLEAN;
ALTER TABLE goodraise.ambassadors ADD COLUMN IF NOT EXISTS terms_accepted BOOLEAN;
ALTER TABLE goodraise.ambassadors ADD COLUMN IF NOT EXISTS registered_at TIMESTAMPTZ;
ALTER TABLE goodraise.ambassadors ADD COLUMN IF NOT EXISTS registered_at_raw TEXT;
ALTER TABLE goodraise.ambassadors ADD COLUMN IF NOT EXISTS registration_payload JSONB NOT NULL DEFAULT '{}'::jsonb;
`;

class IngestHttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "IngestHttpError";
    this.status = status;
  }
}

function normalizeText(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function normalizePhone(value) {
  return String(value || "").replace(/\D+/g, "");
}

function parseDecimal(value) {
  const raw = normalizeText(value)
    .replace(/[\s\u00A0]/g, "")
    .replace(/[^0-9,.-]/g, "")
    .replace(/,/g, "");
  if (!raw) {
    return null;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseInteger(value) {
  const raw = normalizeText(value);
  if (!raw) {
    return null;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseBoolean(value) {
  const raw = normalizeText(value).toLowerCase();
  if (["true", "1", "yes", "y", "כן", "מסכים", "מסכימה", "יודע", "יודעת"].includes(raw) || /^(מסכימ|יודע)/.test(raw)) {
    return true;
  }
  if (["false", "0", "no", "n", "לא"].includes(raw)) {
    return false;
  }
  return null;
}

function normalizeNickname(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "");
}

function deriveNicknameFromEmail(email) {
  const normalized = normalizeEmail(email);
  const atIndex = normalized.lastIndexOf("@");
  return atIndex > 0 ? normalizeNickname(normalized.slice(0, atIndex)) : "";
}

export function normalizeAmbassadorRegistration(rawRecord = {}) {
  const record = rawRecord && typeof rawRecord === "object" ? rawRecord : {};
  const entries = Object.entries(record).map(([key, value]) => ({
    key: normalizeText(key).replace(/^\uFEFF/, "").toLowerCase(),
    value: value == null ? "" : String(value).trim(),
  }));
  const pick = (...aliases) => {
    const normalizedAliases = aliases.map((alias) => normalizeText(alias).toLowerCase());
    const exact = entries.find((entry) => normalizedAliases.includes(entry.key) && entry.value);
    if (exact) return exact.value;
    const partial = entries.find((entry) => entry.value && normalizedAliases.some((alias) => alias && entry.key.includes(alias)));
    return partial?.value || "";
  };
  const fullName = pick("fullName", "full_name", "name", "שם מלא", "שם מלא של השגריר");
  const candidateEmail = normalizeEmail(pick("email", "כתובת מייל", "מייל"));
  const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidateEmail) ? candidateEmail : "";
  const suppliedNickname = normalizeNickname(pick("nickname", "alias", "slug", "כינוי"));
  const nickname = suppliedNickname || deriveNicknameFromEmail(email);
  return {
    fullName: normalizeText(fullName),
    email,
    phone: normalizeText(pick("phone", "mobile", "מספר טלפון", "טלפון")),
    nickname,
    referredBy: normalizeText(pick("referredBy", "referred_by", "שם השגריר שהפנה אותך")),
    wasAmbassadorBefore: parseBoolean(pick("wasAmbassadorBefore", "was_ambassador_before", "האם כבר היית שגריר בעבר")),
    registrationSource: normalizeText(pick("registrationSource", "registration_source", "איך הגעת לקישור הרשמה לשגרירים")),
    isOver18: parseBoolean(pick("isOver18", "is_over_18", "מעל גיל 18")),
    understandsNotPacking: parseBoolean(pick("understandsNotPacking", "understands_not_packing", "לא הקישור הרשמה לאריזות")),
    termsAccepted: parseBoolean(pick("termsAccepted", "terms_accepted", "מסכימ", "תקנון")),
    registeredAtRaw: normalizeText(pick("registeredAt", "registered_at", "timestamp", "חותמת זמן")),
    rawPayload: record,
  };
}

function buildRegistrationAmbassadorKey(record) {
  if (record.email) return sha256(`ambassador-registration-email:${record.email}`);
  if (record.nickname) return sha256(`ambassador-registration-nickname:${record.nickname}`);
  return record.fullName ? sha256(`ambassador-registration-name:${record.fullName.toLowerCase()}`) : "";
}

function parseTimestamp(value) {
  const raw = normalizeText(value);
  if (!raw) {
    return null;
  }
  const shortMatch = raw.match(/^(\d{2})[./-](\d{2})[./-](\d{2})(?:\s+(\d{2}):(\d{2}))?$/);
  if (shortMatch) {
    const [, day, month, year, hours = "00", minutes = "00"] = shortMatch;
    return new Date(Date.UTC(Number(`20${year}`), Number(month) - 1, Number(day), Number(hours), Number(minutes)));
  }
  const longMatch = raw.match(/^(\d{2})[./-](\d{2})[./-](\d{4})(?:\s+(\d{2}):(\d{2}))?$/);
  if (longMatch) {
    const [, day, month, year, hours = "00", minutes = "00"] = longMatch;
    return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hours), Number(minutes)));
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export function normalizeExternalRecord(payload = {}) {
  const record = payload && typeof payload.record === "object" && !Array.isArray(payload.record) ? payload.record : payload;
  const normalized = Object.fromEntries(CSV_FIELD_NAMES.map((field) => [field, ""]));
  for (const [key, value] of Object.entries(record || {})) {
    const normalizedKey = normalizeSourceFieldName(key);
    const canonicalKey = CSV_FIELD_ALIASES[key] || NORMALIZED_HUMAN_FIELD_ALIASES[normalizedKey] || key;
    if (canonicalKey in normalized) {
      normalized[canonicalKey] = value == null ? "" : String(value).trim();
    }
  }
  return normalized;
}

function hasSuspiciousQuestionMarks(value) {
  const text = normalizeText(value);
  if (!text.includes("?")) {
    return false;
  }
  const compact = text.replace(/\s+/g, "");
  const questionCount = Array.from(compact).filter((char) => char === "?").length;
  if (questionCount < 2) {
    return false;
  }
  const hasLetterOrDigit = /[A-Za-z0-9\u0590-\u05FF]/.test(text);
  if (!hasLetterOrDigit) {
    return true;
  }
  return questionCount / Math.max(compact.length, 1) >= 0.45;
}

function validateExternalRecordEncoding(record) {
  const suspiciousFields = [
    ["full_name", "full_name"],
    ["Ambassador name", "Ambassador name"],
    ["city", "city"],
    ["shipping_name", "shipping_name"],
    ["google_address_line", "google_address_line"],
  ]
    .filter(([fieldName]) => hasSuspiciousQuestionMarks(record[fieldName]))
    .map(([, label]) => label);
  if (suspiciousFields.length) {
    throw new IngestHttpError(
      400,
      `Payload text appears mis-encoded in fields: ${suspiciousFields.join(", ")}. Send the JSON body as UTF-8.`,
    );
  }
}

function isBlankRecord(record) {
  return Object.values(record).every((value) => !normalizeText(value));
}

// A row that only names an ambassador is not a donation. Requiring a usable
// timestamp and amount prevents registration or layout rows from polluting the
// campaign transaction ledger.
export function getDonationRecordValidationError(record) {
  if (!parseTimestamp(record.created_at)) {
    return "A donation record must include a valid created_at timestamp.";
  }
  if (parseDecimal(record.total) === null) {
    return "A donation record must include a numeric total amount.";
  }
  return "";
}

function buildDonorKey(record) {
  const email = normalizeEmail(record.email);
  const phone = normalizePhone(record.phone);
  const fullName = normalizeText(record.full_name);
  const address = normalizeText(record.google_address_line);
  const city = normalizeText(record.city);
  const zip = normalizeText(record.zip);
  if (email) {
    return sha256(`email:${email}`);
  }
  if (phone) {
    return sha256(`phone:${phone}`);
  }
  return sha256(`name:${fullName}|address:${address}|city:${city}|zip:${zip}`);
}

function buildAmbassadorKey(record) {
  const email = normalizeEmail(record["Ambassador email"]);
  const fullName = normalizeText(record["Ambassador name"]);
  if (email) {
    return sha256(`ambassador-email:${email}`);
  }
  if (fullName) {
    return sha256(`ambassador-name:${fullName}`);
  }
  return null;
}

function buildRewardKey(record) {
  const reward = normalizeText(record.reward);
  const price = normalizeText(record.price);
  const quantity = normalizeText(record.quantity);
  if (!reward && !price && !quantity) {
    return null;
  }
  return sha256(`reward:${reward}|price:${price}|quantity:${quantity}`);
}

function buildCanonicalEventKey(record) {
  const sourceId = normalizeText(record.id);
  if (sourceId) {
    return sha256(`source-id:${sourceId}`);
  }
  return sha256(
    stableStringify({
      created_at: normalizeText(record.created_at),
      email: normalizeEmail(record.email),
      phone: normalizePhone(record.phone),
      full_name: normalizeText(record.full_name),
      total: normalizeText(record.total),
      currencyname: normalizeText(record.currencyname),
      ambassador_email: normalizeEmail(record["Ambassador email"]),
      charge_result: normalizeText(record.charge_result),
      charged_success: normalizeText(record.charged_success),
    }),
  );
}

function buildSourceTransactionKey(record) {
  return buildCanonicalEventKey(record);
}

function buildDatasetMeta(rows) {
  const uniqueDates = [...new Set(rows.map((row) => row.date).filter(Boolean))].sort();
  const defaultFrom = uniqueDates[0] || "";
  const defaultTo = uniqueDates[uniqueDates.length - 1] || "";
  return {
    uniqueDates,
    projectDates: uniqueDates,
    defaultFrom,
    defaultTo,
    minDate: defaultFrom,
    maxDate: defaultTo,
    rowCount: rows.length,
    projectWindowLabel: defaultFrom && defaultTo ? `${defaultFrom} עד ${defaultTo}` : "",
  };
}

function buildDatasetRow(record) {
  const occurredAt = parseTimestamp(record.created_at);
  const createdIso = occurredAt instanceof Date && !Number.isNaN(occurredAt.getTime()) ? occurredAt.toISOString().slice(0, 16) : "";
  return {
    id: normalizeText(record.id) || sha256(`dataset-row:${normalizeText(record.created_at)}|${normalizeEmail(record.email)}|${normalizeText(record.total)}`),
    createdIso,
    date: createdIso.slice(0, 10),
    hour: occurredAt instanceof Date && !Number.isNaN(occurredAt.getTime()) ? occurredAt.getUTCHours() : 0,
    email: normalizeEmail(record.email),
    donor: normalizeText(record.full_name) || "ללא שם",
    ambassador: normalizeText(record["Ambassador name"]) || "ללא שיוך",
    amount: parseDecimal(record.total) ?? 0,
    city: normalizeText(record.city) || "ללא עיר",
    status: parseBoolean(record.charged_success) ? "success" : "failed",
    chargeResult: normalizeText(record.charge_result),
  };
}

function buildDatasetRowFromDatabaseRow(row) {
  const occurredAt =
    row.occurred_at instanceof Date && !Number.isNaN(row.occurred_at.getTime())
      ? row.occurred_at
      : parseTimestamp(row.occurred_at_raw || "");
  const createdIso =
    occurredAt instanceof Date && !Number.isNaN(occurredAt.getTime()) ? occurredAt.toISOString().slice(0, 16) : "";
  return {
    id:
      normalizeText(row.source_id) ||
      sha256(
        `dataset-row:${normalizeText(row.occurred_at_raw)}|${normalizeEmail(row.donor_email)}|${normalizeText(
          row.total_amount,
        )}`,
      ),
    createdIso,
    date: createdIso.slice(0, 10),
    hour: occurredAt instanceof Date && !Number.isNaN(occurredAt.getTime()) ? occurredAt.getUTCHours() : 0,
    email: normalizeEmail(row.donor_email),
    donor: normalizeText(row.donor_name) || "ללא שם",
    ambassador: normalizeText(row.ambassador_name) || "ללא שיוך",
    amount: Number(row.total_amount || 0) || 0,
    city: normalizeText(row.city) || "ללא עיר",
    status: row.charged_success === true ? "success" : "failed",
    chargeResult: normalizeText(row.charge_result_code),
  };
}

export function hasConfiguredRelationalIngest() {
  return Boolean(String(process.env.GOODRAISE_DATABASE_URL || process.env.DATABASE_URL || "").trim());
}

export async function clearCampaignOperationalData({
  organizationIdentifier,
  campaignIdentifier,
  resetSourceLabel = "prelaunch-reset",
  clearedBy = "scheduled-prelaunch-reset",
}) {
  const pool = await getPostgresPool();
  const client = await pool.connect();
  let scope = null;
  try {
    await client.query("BEGIN");
    await ensureSchema(client);
    scope = await resolveScope(client, organizationIdentifier, campaignIdentifier);
    if (!scope) {
      throw new IngestHttpError(404, "Organization or campaign was not found in PostgreSQL.");
    }

    const countsBeforeResult = await client.query(
      `
        SELECT
          (SELECT COUNT(*)::int FROM goodraise.transactions WHERE campaign_id = $1::uuid) AS transactions_count,
          (SELECT COUNT(*)::int FROM goodraise.import_batches WHERE campaign_id = $1::uuid) AS import_batches_count,
          (SELECT COUNT(*)::int FROM goodraise.transactions_csv_raw WHERE campaign_id = $1::uuid) AS raw_rows_count,
          (SELECT COUNT(*)::int FROM goodraise.ambassadors WHERE campaign_id = $1::uuid) AS ambassadors_count,
          (SELECT COUNT(*)::int FROM goodraise.rewards WHERE campaign_id = $1::uuid) AS rewards_count
      `,
      [scope.campaign_id],
    );
    const countsBefore = countsBeforeResult.rows[0] || {};

    await client.query("DELETE FROM goodraise.transactions_csv_raw WHERE campaign_id = $1::uuid", [scope.campaign_id]);
    await client.query("DELETE FROM goodraise.transactions WHERE campaign_id = $1::uuid", [scope.campaign_id]);
    await client.query("DELETE FROM goodraise.import_batches WHERE campaign_id = $1::uuid", [scope.campaign_id]);
    await client.query("DELETE FROM goodraise.ambassadors WHERE campaign_id = $1::uuid", [scope.campaign_id]);
    await client.query("DELETE FROM goodraise.rewards WHERE campaign_id = $1::uuid", [scope.campaign_id]);
    await client.query(
      `
        DELETE FROM goodraise.donors d
        WHERE NOT EXISTS (
          SELECT 1
          FROM goodraise.transactions t
          WHERE t.donor_id = d.id
        )
      `,
    );
    await client.query(
      `
        UPDATE goodraise.campaigns
        SET source_filename = NULL,
            source_checksum_sha256 = NULL,
            updated_at = NOW()
        WHERE id = $1::uuid
      `,
      [scope.campaign_id],
    );
    await client.query("COMMIT");

    const timestamp = new Date().toISOString();
    await saveCampaignDataset(scope.organization_slug, scope.campaign_slug, {
      organizationId: scope.organization_slug,
      campaignId: scope.campaign_slug,
      rows: [],
      meta: {
        uniqueDates: [],
        projectDates: [],
        defaultFrom: "",
        defaultTo: "",
        minDate: "",
        maxDate: "",
        rowCount: 0,
        projectWindowLabel: "",
        resetState: true,
        resetAt: timestamp,
        resetBy: clearedBy,
      },
      sourceLabel: resetSourceLabel,
      generatedAt: timestamp,
      updatedAt: timestamp,
    });

    return {
      organizationId: scope.organization_slug,
      campaignId: scope.campaign_slug,
      sourceLabel: resetSourceLabel,
      clearedAt: timestamp,
      countsBefore: {
        transactions: Number(countsBefore.transactions_count || 0),
        importBatches: Number(countsBefore.import_batches_count || 0),
        rawRows: Number(countsBefore.raw_rows_count || 0),
        ambassadors: Number(countsBefore.ambassadors_count || 0),
        rewards: Number(countsBefore.rewards_count || 0),
      },
    };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw error;
  } finally {
    client.release();
  }
}

async function syncCampaignDatasetSnapshot(scope, record, sourceLabel) {
  const organizationKey = scope.organization_slug;
  const campaignKey = scope.campaign_slug;
  const currentDataset = (await getCampaignDataset(organizationKey, campaignKey)) || {
    rows: [],
    meta: {},
    sourceLabel: "",
    generatedAt: "",
    updatedAt: "",
  };
  const nextRow = buildDatasetRow(record);
  const nextRows = [nextRow, ...((Array.isArray(currentDataset.rows) ? currentDataset.rows : []).filter((row) => String(row?.id || "").trim() !== nextRow.id))].sort((left, right) =>
    String(right?.createdIso || "").localeCompare(String(left?.createdIso || "")),
  );
  await saveCampaignDataset(organizationKey, campaignKey, {
    ...currentDataset,
    rows: nextRows,
    meta: buildDatasetMeta(nextRows),
    sourceLabel: String(currentDataset.sourceLabel || sourceLabel || "external-api").trim(),
    generatedAt: currentDataset.generatedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  return {
    rowCount: nextRows.length,
    sourceLabel: String(currentDataset.sourceLabel || sourceLabel || "external-api").trim(),
  };
}

export async function rebuildCampaignDatasetSnapshot(scope, sourceLabel = "") {
  const pool = await getPostgresPool();
  const client = await pool.connect();
  try {
    await ensureSchema(client);
    const result = await client.query(
      `
        SELECT
          t.source_id,
          t.occurred_at,
          t.occurred_at_raw,
          t.total_amount,
          t.charged_success,
          t.charge_result_code,
          COALESCE(d.email_normalized, d.email, '') AS donor_email,
          COALESCE(d.full_name, '') AS donor_name,
          COALESCE(d.city, '') AS city,
          COALESCE(a.full_name, '') AS ambassador_name
        FROM goodraise.transactions t
        LEFT JOIN goodraise.donors d ON d.id = t.donor_id
        LEFT JOIN goodraise.ambassadors a ON a.id = t.ambassador_id
        WHERE t.campaign_id = $1::uuid
        ORDER BY t.occurred_at DESC NULLS LAST, t.created_at DESC
      `,
      [scope.campaign_id],
    );
    const rows = result.rows.map(buildDatasetRowFromDatabaseRow);
    const currentDataset = (await getCampaignDataset(scope.organization_slug, scope.campaign_slug)) || {};
    const nextTimestamp = new Date().toISOString();
    const nextSourceLabel =
      String(sourceLabel || "").trim() ||
      String(currentDataset.sourceLabel || "").trim() ||
      "google-sheets";
    await saveCampaignDataset(scope.organization_slug, scope.campaign_slug, {
      organizationId: scope.organization_slug,
      campaignId: scope.campaign_slug,
      rows,
      meta: buildDatasetMeta(rows),
      sourceLabel: nextSourceLabel,
      generatedAt: currentDataset.generatedAt || nextTimestamp,
      updatedAt: nextTimestamp,
    });
    return {
      rowCount: rows.length,
      sourceLabel: nextSourceLabel,
    };
  } finally {
    client.release();
  }
}

function getConfiguredApiKeys() {
  const singular = String(process.env.GOODRAISE_INGEST_API_KEY || "").trim();
  const plural = String(process.env.GOODRAISE_INGEST_API_KEYS || "").trim();
  if (plural) {
    try {
      const parsed = JSON.parse(plural);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item || "").trim()).filter(Boolean);
      }
    } catch {
      return plural.split(",").map((item) => item.trim()).filter(Boolean);
    }
  }
  if (singular) {
    return [singular];
  }
  if (existsSync(LOCAL_INGEST_KEY_PATH)) {
    try {
      const parsed = JSON.parse(readFileSync(LOCAL_INGEST_KEY_PATH, "utf8"));
      if (Array.isArray(parsed?.apiKeys)) {
        const keys = parsed.apiKeys.map((item) => String(item || "").trim()).filter(Boolean);
        if (keys.length) {
          return keys;
        }
      }
      const legacyKey = String(parsed?.apiKey || "").trim();
      if (legacyKey) {
        return [legacyKey];
      }
    } catch {}
  }
  if (!process.env.NETLIFY) {
    const generatedKey = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
    try {
      mkdirSync(dirname(LOCAL_INGEST_KEY_PATH), { recursive: true });
      writeFileSync(
        LOCAL_INGEST_KEY_PATH,
        JSON.stringify(
          {
            apiKeys: [generatedKey],
            createdAt: new Date().toISOString(),
            note: "Local ingest API key for GoodRaise external event simulation.",
          },
          null,
          2,
        ),
        "utf8",
      );
      return [generatedKey];
    } catch {}
  }
  return [];
}

function readPresentedApiKey(request) {
  const headerKey = String(request.headers.get("x-goodraise-api-key") || "").trim();
  if (headerKey) {
    return headerKey;
  }
  const authHeader = String(request.headers.get("authorization") || "").trim();
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  return bearerMatch ? bearerMatch[1].trim() : "";
}

export function validateIngestApiKey(request) {
  const configuredKeys = getConfiguredApiKeys();
  if (!configuredKeys.length) {
    return { ok: false, status: 503, message: "Ingest API key is not configured on the server." };
  }
  const presentedKey = readPresentedApiKey(request);
  if (!presentedKey) {
    return { ok: false, status: 401, message: "Missing API key." };
  }
  const matched = configuredKeys.some((configuredKey) => {
    const left = Buffer.from(configuredKey);
    const right = Buffer.from(presentedKey);
    return left.length === right.length && timingSafeEqual(left, right);
  });
  return matched ? { ok: true } : { ok: false, status: 401, message: "Invalid API key." };
}

async function getPostgresPool() {
  if (!postgresPoolPromise) {
    postgresPoolPromise = import("pg").then(({ Pool }) => {
      const connectionString = String(process.env.GOODRAISE_DATABASE_URL || process.env.DATABASE_URL || "").trim();
      if (!connectionString) {
        throw new IngestHttpError(503, "GOODRAISE_DATABASE_URL is not configured on the server.");
      }
      return new Pool({
        connectionString,
        max: 4,
        idleTimeoutMillis: 10_000,
        connectionTimeoutMillis: 10_000,
      });
    });
  }
  return postgresPoolPromise;
}

async function ensureSchema(client) {
  await client.query(SCHEMA_SQL);
}

async function resolveScope(client, organizationIdentifier, campaignIdentifier) {
  const result = await client.query(
    `
      SELECT
        o.id::text AS organization_id,
        o.slug AS organization_slug,
        o.name AS organization_name,
        c.id::text AS campaign_id,
        c.slug AS campaign_slug,
        c.name AS campaign_name,
        c.status AS campaign_status,
        c.currency_code AS currency_code
      FROM goodraise.organizations o
      INNER JOIN goodraise.campaigns c
        ON c.organization_id = o.id
      WHERE
        (LOWER(CAST(o.id AS TEXT)) = LOWER($1) OR LOWER(o.slug) = LOWER($1))
        AND
        (LOWER(CAST(c.id AS TEXT)) = LOWER($2) OR LOWER(c.slug) = LOWER($2))
      LIMIT 1
    `,
    [organizationIdentifier, campaignIdentifier],
  );
  return result.rows[0] || null;
}

async function backfillExistingCanonicalEventKeys(client, campaignId) {
  const result = await client.query(
    `
      SELECT id::text AS id, source_id, raw_payload
      FROM goodraise.transactions
      WHERE campaign_id = $1::uuid
        AND (canonical_event_key IS NULL OR canonical_event_key = '')
    `,
    [campaignId],
  );
  for (const row of result.rows) {
    const record = normalizeExternalRecord(row.raw_payload || {});
    if (row.source_id) {
      record.id = String(row.source_id);
    }
    await client.query(
      `
        UPDATE goodraise.transactions
        SET canonical_event_key = $1
        WHERE id = $2::uuid
      `,
      [buildCanonicalEventKey(record), row.id],
    );
  }
}

async function findExistingTransactionByCanonicalKey(client, campaignId, canonicalEventKey) {
  const result = await client.query(
    `
      SELECT id::text AS id, import_batch_id::text AS import_batch_id
      FROM goodraise.transactions
      WHERE campaign_id = $1::uuid
        AND canonical_event_key = $2
      LIMIT 1
    `,
    [campaignId, canonicalEventKey],
  );
  return result.rows[0] || null;
}

async function ensureCurrency(client, code) {
  const normalized = normalizeText(code).toUpperCase();
  if (!normalized) {
    return null;
  }
  await client.query(
    `
      INSERT INTO goodraise.currencies (code, name)
      VALUES ($1, $1)
      ON CONFLICT (code) DO NOTHING
    `,
    [normalized],
  );
  return normalized;
}

async function upsertDonor(client, record) {
  const donorKey = buildDonorKey(record);
  const result = await client.query(
    `
      INSERT INTO goodraise.donors (
        id, donor_key, full_name, phone, email, email_normalized, shipping_name, delivery_comment, google_address_line, city, zip
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
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
      RETURNING id::text
    `,
    [
      randomUUID(),
      donorKey,
      record.full_name,
      record.phone,
      record.email,
      normalizeEmail(record.email),
      record.shipping_name,
      record.delivery_comment,
      record.google_address_line,
      record.city,
      record.zip,
    ],
  );
  return { id: result.rows[0].id, donorKey };
}

async function upsertAmbassador(client, organizationId, campaignId, record) {
  const ambassadorKey = buildAmbassadorKey(record);
  if (!ambassadorKey) {
    return { id: null, ambassadorKey: null };
  }
  const result = await client.query(
    `
      INSERT INTO goodraise.ambassadors (
        id, organization_id, campaign_id, ambassador_key, full_name, email, email_normalized
      )
      VALUES ($1, $2::uuid, $3::uuid, $4, $5, $6, $7)
      ON CONFLICT (campaign_id, ambassador_key) DO UPDATE
      SET full_name = COALESCE(NULLIF(EXCLUDED.full_name, ''), goodraise.ambassadors.full_name),
          email = COALESCE(NULLIF(EXCLUDED.email, ''), goodraise.ambassadors.email),
          email_normalized = COALESCE(NULLIF(EXCLUDED.email_normalized, ''), goodraise.ambassadors.email_normalized),
          updated_at = NOW()
      RETURNING id::text
    `,
    [
      randomUUID(),
      organizationId,
      campaignId,
      ambassadorKey,
      record["Ambassador name"],
      record["Ambassador email"],
      normalizeEmail(record["Ambassador email"]),
    ],
  );
  return { id: result.rows[0].id, ambassadorKey };
}

async function upsertReward(client, organizationId, campaignId, record) {
  const rewardKey = buildRewardKey(record);
  if (!rewardKey) {
    return { id: null, rewardKey: null };
  }
  const result = await client.query(
    `
      INSERT INTO goodraise.rewards (
        id, organization_id, campaign_id, reward_key, reward_name, unit_price, quantity
      )
      VALUES ($1, $2::uuid, $3::uuid, $4, $5, $6, $7)
      ON CONFLICT (campaign_id, reward_key) DO UPDATE
      SET reward_name = COALESCE(NULLIF(EXCLUDED.reward_name, ''), goodraise.rewards.reward_name),
          unit_price = COALESCE(EXCLUDED.unit_price, goodraise.rewards.unit_price),
          quantity = COALESCE(EXCLUDED.quantity, goodraise.rewards.quantity),
          updated_at = NOW()
      RETURNING id::text
    `,
    [
      randomUUID(),
      organizationId,
      campaignId,
      rewardKey,
      record.reward,
      parseDecimal(record.price),
      parseInteger(record.quantity),
    ],
  );
  return { id: result.rows[0].id, rewardKey };
}

export async function ingestCampaignRecord({ organizationIdentifier, campaignIdentifier, payload = {} }) {
  const record = normalizeExternalRecord(payload);
  validateExternalRecordEncoding(record);
  if (isBlankRecord(record)) {
    throw new IngestHttpError(400, "Payload must include a non-empty record object.");
  }
  const donationValidationError = getDonationRecordValidationError(record);
  if (donationValidationError) {
    throw new IngestHttpError(400, donationValidationError);
  }

  const sourceLabel = normalizeText(payload.sourceLabel || payload.source || "external-api") || "external-api";
  const requestReference = normalizeText(payload.requestId || payload.externalReference || payload.reference || "");
  const canonicalEventKey = buildCanonicalEventKey(record);
  const sourceTransactionKey = buildSourceTransactionKey(record);
  const importBatchId = randomUUID();
  const importChecksum = sha256(
    stableStringify({
      requestReference,
      sourceLabel,
      record,
      transactionKey: sourceTransactionKey,
      importBatchId,
    }),
  );

  const pool = await getPostgresPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await ensureSchema(client);

    const scope = await resolveScope(client, organizationIdentifier, campaignIdentifier);
    if (!scope) {
      throw new IngestHttpError(404, "Organization or campaign was not found in PostgreSQL.");
    }
    await backfillExistingCanonicalEventKeys(client, scope.campaign_id);
    const existingTransaction = await findExistingTransactionByCanonicalKey(client, scope.campaign_id, canonicalEventKey);
    if (existingTransaction) {
      await client.query("COMMIT");
      const datasetState = await syncCampaignDatasetSnapshot(scope, record, sourceLabel);
      return {
        ok: true,
        duplicate: true,
        created: false,
        organization: {
          id: scope.organization_id,
          slug: scope.organization_slug,
          name: scope.organization_name,
        },
        campaign: {
          id: scope.campaign_id,
          slug: scope.campaign_slug,
          name: scope.campaign_name,
          status: scope.campaign_status,
        },
        importBatch: {
          id: existingTransaction.import_batch_id,
          sourceLabel,
          requestReference,
        },
        dataset: datasetState,
        transaction: {
          id: existingTransaction.id,
          sourceId: normalizeText(record.id) || "",
          sourceTransactionKey,
          totalAmount: parseDecimal(record.total),
          currencyCode: normalizeText(record.currencyname || scope.currency_code || ""),
          donorId: "",
          ambassadorId: "",
          rewardId: "",
        },
      };
    }

    const occurredAt = parseTimestamp(record.created_at);
    const currencyCode = await ensureCurrency(client, record.currencyname || scope.currency_code || "ILS");
    const donor = await upsertDonor(client, record);
    const ambassador = await upsertAmbassador(client, scope.organization_id, scope.campaign_id, record);
    const reward = await upsertReward(client, scope.organization_id, scope.campaign_id, record);

    await client.query(
      `
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
        VALUES ($1, $2::uuid, $3::uuid, $4, $5, $6::jsonb, 1, 1, 0, $7, $8)
      `,
      [
        importBatchId,
        scope.organization_id,
        scope.campaign_id,
        `${sourceLabel}.json`,
        importChecksum,
        JSON.stringify(CSV_FIELD_NAMES),
        "external-api",
        requestReference ? `request_reference=${requestReference}` : "",
      ],
    );

    const transactionResult = await client.query(
      `
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
          $1, $2::uuid, $3::uuid, $4::uuid, 1, $5, $6, $7, $8::uuid, $9::uuid, $10::uuid, $11, $12, $13, $14, $15, $16, $17, $18, $19::jsonb
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
            raw_payload = EXCLUDED.raw_payload,
            import_batch_id = EXCLUDED.import_batch_id
        RETURNING id::text
      `,
      [
        randomUUID(),
        scope.organization_id,
        scope.campaign_id,
        importBatchId,
        normalizeText(record.id) || null,
        sourceTransactionKey,
        canonicalEventKey,
        donor.id,
        ambassador.id,
        reward.id,
        occurredAt,
        record.created_at,
        parseDecimal(record.total),
        currencyCode,
        parseBoolean(record.charged_success),
        normalizeText(record.charge_result) || null,
        parseBoolean(record.direct_debit),
        parseBoolean(record["direct debit active"]),
        JSON.stringify(record),
      ],
    );
    const transactionId = transactionResult.rows[0].id;

    await client.query(
      `
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
          $1::uuid, $2::uuid, $3::uuid, $4::uuid, 1, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25
        )
      `,
      [
        importBatchId,
        scope.organization_id,
        scope.campaign_id,
        transactionId,
        record.id,
        record.created_at,
        record.full_name,
        record.reward,
        record.price,
        record.quantity,
        record.total,
        record.currencyname,
        record.phone,
        record.email,
        record["Ambassador name"],
        record["Ambassador email"],
        record.shipping_name,
        record.delivery_comment,
        record.google_address_line,
        record.city,
        record.zip,
        record.charged_success,
        record.charge_result,
        record.direct_debit,
        record["direct debit active"],
      ],
    );

    await client.query("COMMIT");
    const datasetState = await syncCampaignDatasetSnapshot(scope, record, sourceLabel);
    return {
      ok: true,
      duplicate: false,
      created: true,
      organization: {
        id: scope.organization_id,
        slug: scope.organization_slug,
        name: scope.organization_name,
      },
      campaign: {
        id: scope.campaign_id,
        slug: scope.campaign_slug,
        name: scope.campaign_name,
        status: scope.campaign_status,
      },
      importBatch: {
        id: importBatchId,
        sourceLabel,
        requestReference,
      },
      dataset: datasetState,
      transaction: {
        id: transactionId,
        sourceId: normalizeText(record.id) || "",
        sourceTransactionKey,
        totalAmount: parseDecimal(record.total),
        currencyCode: currencyCode || "",
        donorId: donor.id,
        ambassadorId: ambassador.id || "",
        rewardId: reward.id || "",
      },
    };
  } catch (error) {
    await client.query("ROLLBACK");
    if (error instanceof IngestHttpError) {
      throw error;
    }
    throw new IngestHttpError(500, "Failed to ingest the external campaign record.");
  } finally {
    client.release();
  }
}

export async function ingestCampaignRecords({
  organizationIdentifier,
  campaignIdentifier,
  sourceLabel = "google-sheets",
  importedBy = "google-sheets-sync",
  requestReference = "",
  records = [],
}) {
  const sourceRecords = Array.isArray(records) ? records : [];
  const normalizedRecords = [];
  let skippedBlankRows = 0;
  let skippedInvalidRows = 0;
  for (const rawRecord of sourceRecords) {
    const record = normalizeExternalRecord(rawRecord || {});
    validateExternalRecordEncoding(record);
    if (isBlankRecord(record)) {
      skippedBlankRows += 1;
      continue;
    }
    if (getDonationRecordValidationError(record)) {
      skippedInvalidRows += 1;
      continue;
    }
    normalizedRecords.push(record);
  }

  const pool = await getPostgresPool();
  const client = await pool.connect();
  let scope = null;
  const importBatchId = randomUUID();
  try {
    await client.query("BEGIN");
    await ensureSchema(client);

    scope = await resolveScope(client, organizationIdentifier, campaignIdentifier);
    if (!scope) {
      throw new IngestHttpError(404, "Organization or campaign was not found in PostgreSQL.");
    }

    const importChecksum = sha256(
      stableStringify({
        sourceLabel,
        importedBy,
        requestReference,
        importBatchId,
        records: normalizedRecords,
      }),
    );

    await client.query(
      `
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
          skipped_invalid_rows,
          imported_by,
          notes
        )
        VALUES ($1, $2::uuid, $3::uuid, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12)
      `,
      [
        importBatchId,
        scope.organization_id,
        scope.campaign_id,
        `${normalizeText(sourceLabel) || "google-sheets"}.csv`,
        importChecksum,
        JSON.stringify(CSV_FIELD_NAMES),
        sourceRecords.length,
        normalizedRecords.length,
        skippedBlankRows,
        skippedInvalidRows,
        normalizeText(importedBy) || "google-sheets-sync",
        requestReference ? `request_reference=${requestReference}` : "",
      ],
    );

    for (const [index, record] of normalizedRecords.entries()) {
      const occurredAt = parseTimestamp(record.created_at);
      const donor = await upsertDonor(client, record);
      const ambassador = await upsertAmbassador(client, scope.organization_id, scope.campaign_id, record);
      const reward = await upsertReward(client, scope.organization_id, scope.campaign_id, record);
      const currencyCode = await ensureCurrency(client, record.currencyname || scope.currency_code || "ILS");

      await client.query(
        `
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
            $1, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, $8, $9::uuid, $10::uuid, $11::uuid, $12, $13, $14, $15, $16, $17, $18, $19, $20::jsonb
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
              raw_payload = EXCLUDED.raw_payload,
              import_batch_id = EXCLUDED.import_batch_id
        `,
        [
          randomUUID(),
          scope.organization_id,
          scope.campaign_id,
          importBatchId,
          index + 1,
          normalizeText(record.id) || null,
          buildSourceTransactionKey(record),
          buildCanonicalEventKey(record),
          donor.id,
          ambassador.id,
          reward.id,
          occurredAt,
          record.created_at,
          parseDecimal(record.total),
          currencyCode,
          parseBoolean(record.charged_success),
          normalizeText(record.charge_result) || null,
          parseBoolean(record.direct_debit),
          parseBoolean(record["direct debit active"]),
          JSON.stringify(record),
        ],
      );

      await client.query(
        `
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
            $1::uuid, $2::uuid, $3::uuid, NULL, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25
          )
          ON CONFLICT (import_batch_id, source_row_number) DO UPDATE
          SET "id" = EXCLUDED."id",
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
        `,
        [
          importBatchId,
          scope.organization_id,
          scope.campaign_id,
          index + 1,
          record.id,
          record.created_at,
          record.full_name,
          record.reward,
          record.price,
          record.quantity,
          record.total,
          record.currencyname,
          record.phone,
          record.email,
          record["Ambassador name"],
          record["Ambassador email"],
          record.shipping_name,
          record.delivery_comment,
          record.google_address_line,
          record.city,
          record.zip,
          record.charged_success,
          record.charge_result,
          record.direct_debit,
          record["direct debit active"],
        ],
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    if (error instanceof IngestHttpError) {
      throw error;
    }
    throw new IngestHttpError(500, "Failed to ingest the Google Sheets campaign records.");
  } finally {
    client.release();
  }

  const dataset = scope ? await rebuildCampaignDatasetSnapshot(scope, sourceLabel) : { rowCount: 0, sourceLabel };
  return {
    ok: true,
    organization: {
      id: scope.organization_id,
      slug: scope.organization_slug,
      name: scope.organization_name,
    },
    campaign: {
      id: scope.campaign_id,
      slug: scope.campaign_slug,
      name: scope.campaign_name,
      status: scope.campaign_status,
    },
    importBatch: {
      id: importBatchId,
      sourceLabel,
      requestReference,
      rawRowCount: sourceRecords.length,
      skippedBlankRows,
      skippedInvalidRows,
    },
    dataset,
    processedCount: normalizedRecords.length,
    skippedBlankRows,
    skippedInvalidRows,
  };
}

export async function importAmbassadorRegistrations({
  organizationIdentifier,
  campaignIdentifier,
  records = [],
  importedBy = "",
  sourceLabel = "ambassador-registration-csv",
}) {
  if (!Array.isArray(records)) {
    throw new IngestHttpError(400, "Ambassador import must include a records array.");
  }
  const normalizedByKey = new Map();
  const skippedRows = [];
  let duplicateRows = 0;

  records.forEach((rawRecord, index) => {
    const record = normalizeAmbassadorRegistration(rawRecord);
    const ambassadorKey = buildRegistrationAmbassadorKey(record);
    if (!record.fullName || !ambassadorKey) {
      skippedRows.push(index + 1);
      return;
    }
    if (normalizedByKey.has(ambassadorKey)) {
      duplicateRows += 1;
    }
    normalizedByKey.set(ambassadorKey, record);
  });

  const pool = await getPostgresPool();
  const client = await pool.connect();
  let scope = null;
  try {
    await client.query("BEGIN");
    await ensureSchema(client);
    scope = await resolveScope(client, organizationIdentifier, campaignIdentifier);
    if (!scope) {
      throw new IngestHttpError(404, "Organization or campaign was not found in PostgreSQL.");
    }

    for (const [ambassadorKey, record] of normalizedByKey) {
      const registeredAt = parseTimestamp(record.registeredAtRaw);
      await client.query(
        `
          INSERT INTO goodraise.ambassadors (
            id, organization_id, campaign_id, ambassador_key, full_name, email, email_normalized,
            phone, nickname, referred_by, was_ambassador_before, registration_source, is_over_18,
            understands_not_packing, terms_accepted, registered_at, registered_at_raw, registration_payload
          )
          VALUES (
            $1, $2::uuid, $3::uuid, $4, $5, $6, $7,
            $8, $9, $10, $11, $12, $13,
            $14, $15, $16, $17, $18::jsonb
          )
          ON CONFLICT (campaign_id, ambassador_key) DO UPDATE
          SET full_name = EXCLUDED.full_name,
              email = COALESCE(NULLIF(EXCLUDED.email, ''), goodraise.ambassadors.email),
              email_normalized = COALESCE(NULLIF(EXCLUDED.email_normalized, ''), goodraise.ambassadors.email_normalized),
              phone = COALESCE(NULLIF(EXCLUDED.phone, ''), goodraise.ambassadors.phone),
              nickname = COALESCE(NULLIF(EXCLUDED.nickname, ''), goodraise.ambassadors.nickname),
              referred_by = COALESCE(NULLIF(EXCLUDED.referred_by, ''), goodraise.ambassadors.referred_by),
              was_ambassador_before = COALESCE(EXCLUDED.was_ambassador_before, goodraise.ambassadors.was_ambassador_before),
              registration_source = COALESCE(NULLIF(EXCLUDED.registration_source, ''), goodraise.ambassadors.registration_source),
              is_over_18 = COALESCE(EXCLUDED.is_over_18, goodraise.ambassadors.is_over_18),
              understands_not_packing = COALESCE(EXCLUDED.understands_not_packing, goodraise.ambassadors.understands_not_packing),
              terms_accepted = COALESCE(EXCLUDED.terms_accepted, goodraise.ambassadors.terms_accepted),
              registered_at = COALESCE(EXCLUDED.registered_at, goodraise.ambassadors.registered_at),
              registered_at_raw = COALESCE(NULLIF(EXCLUDED.registered_at_raw, ''), goodraise.ambassadors.registered_at_raw),
              registration_payload = EXCLUDED.registration_payload,
              updated_at = NOW()
        `,
        [
          randomUUID(),
          scope.organization_id,
          scope.campaign_id,
          ambassadorKey,
          record.fullName,
          record.email,
          record.email,
          record.phone,
          record.nickname,
          record.referredBy,
          record.wasAmbassadorBefore,
          record.registrationSource,
          record.isOver18,
          record.understandsNotPacking,
          record.termsAccepted,
          registeredAt,
          record.registeredAtRaw,
          JSON.stringify(record.rawPayload),
        ],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    if (error instanceof IngestHttpError) throw error;
    throw new IngestHttpError(500, "Failed to import ambassador registrations.");
  } finally {
    client.release();
  }

  return {
    ok: true,
    organization: { id: scope.organization_id, slug: scope.organization_slug },
    campaign: { id: scope.campaign_id, slug: scope.campaign_slug },
    sourceLabel: normalizeText(sourceLabel) || "ambassador-registration-csv",
    totalRows: records.length,
    importedCount: normalizedByKey.size,
    duplicateRows,
    skippedRows,
  };
}

export { IngestHttpError };
