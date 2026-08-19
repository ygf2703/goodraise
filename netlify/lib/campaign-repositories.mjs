import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

import { createPlatformStore } from "./platform-store.mjs";
import {
  DEFAULT_PLATFORM_ORGANIZATION_ID,
  DEFAULT_PLATFORM_ORGANIZATION_SLUG,
  ROLE_PLATFORM_ADMIN,
  buildCampaignSummary,
  buildDateTimeIso,
  cloneJson,
  createAuditRecord,
  createCampaignDatasetRecord,
  createCampaignRecord,
  createOrganizationRecord,
  defaultSourceConfig,
  isoNow,
  normalizeEmail,
  normalizeRole,
  normalizeSlug,
  normalizeSourceConfig,
  normalizeStableId,
} from "./multi-tenant-model.mjs";

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PLATFORM_DEV_STORE_PATH = resolve(ROOT_DIR, "work", "data", "goodraise-platform-dev.json");
const LEGACY_CAMPAIGN_STORE_PATH = resolve(ROOT_DIR, "work", "data", "netlify-campaign-config-dev.json");
const LEGACY_SOURCE_STORE_PATH = resolve(ROOT_DIR, "work", "data", "netlify-source-config-dev.json");
const LEGACY_DATASET_PATH = resolve(ROOT_DIR, "netlify", "data", "admin-dataset.json");
const STORE_NAME = "goodraise-platform";
const MIGRATION_KEY = "migration:legacy-registry-v2";
const LEGACY_CAMPAIGN_KEY = "campaign-config";
const LEGACY_SOURCE_KEY = "source-config";
const POSTGRES_CAMPAIGN_SCHEMA_SQL = `
CREATE SCHEMA IF NOT EXISTS goodraise;

ALTER TABLE goodraise.organizations ADD COLUMN IF NOT EXISTS app_id TEXT;
ALTER TABLE goodraise.organizations ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
CREATE UNIQUE INDEX IF NOT EXISTS uq_organizations_app_id ON goodraise.organizations(app_id) WHERE app_id IS NOT NULL;

ALTER TABLE goodraise.campaigns ADD COLUMN IF NOT EXISTS app_id TEXT;
ALTER TABLE goodraise.campaigns ADD COLUMN IF NOT EXISTS target_amount NUMERIC(14, 2) NOT NULL DEFAULT 0;
ALTER TABLE goodraise.campaigns ADD COLUMN IF NOT EXISTS updated_by TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX IF NOT EXISTS uq_campaigns_org_app_id ON goodraise.campaigns(organization_id, app_id) WHERE app_id IS NOT NULL;

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

CREATE INDEX IF NOT EXISTS idx_campaign_configs_campaign ON goodraise.campaign_configs(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_sources_campaign ON goodraise.campaign_sources(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_datasets_campaign ON goodraise.campaign_datasets(campaign_id);
`;

let postgresPoolPromise = null;
let postgresSchemaPromise = null;

function organizationKey(organizationId) {
  return `organization:${organizationId}`;
}

function campaignKey(organizationId, campaignId) {
  return `campaign:${organizationId}:${campaignId}`;
}

function campaignConfigKey(organizationId, campaignId) {
  return `campaign-config:${organizationId}:${campaignId}`;
}

function campaignSourceKey(organizationId, campaignId) {
  return `campaign-source:${organizationId}:${campaignId}`;
}

function campaignDatasetKey(organizationId, campaignId) {
  return `campaign-dataset:${organizationId}:${campaignId}`;
}

function auditKey() {
  return `audit:${Date.now()}:${Math.random().toString(16).slice(2, 10)}`;
}

function getStore() {
  return createPlatformStore({
    storeName: STORE_NAME,
    devStorePath: PLATFORM_DEV_STORE_PATH,
  });
}

function getDatabaseUrl() {
  return String(process.env.GOODRAISE_DATABASE_URL || process.env.DATABASE_URL || "").trim();
}

function usesPostgresCampaignStore() {
  return Boolean(getDatabaseUrl());
}

async function getPostgresPool() {
  if (!postgresPoolPromise) {
    postgresPoolPromise = import("pg").then(({ Pool }) => {
      const connectionString = getDatabaseUrl();
      if (!connectionString) {
        throw new Error("GOODRAISE_DATABASE_URL is not configured.");
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

async function ensurePostgresSchema() {
  if (!usesPostgresCampaignStore()) {
    return;
  }
  if (!postgresSchemaPromise) {
    postgresSchemaPromise = (async () => {
      const pool = await getPostgresPool();
      const client = await pool.connect();
      try {
        await client.query(POSTGRES_CAMPAIGN_SCHEMA_SQL);
      } finally {
        client.release();
      }
    })();
  }
  return postgresSchemaPromise;
}

async function withPostgresClient(callback) {
  await ensurePostgresSchema();
  const pool = await getPostgresPool();
  const client = await pool.connect();
  try {
    return await callback(client);
  } finally {
    client.release();
  }
}

function normalizeDatasetPayload(dataset, organizationId, campaignId) {
  return createCampaignDatasetRecord(dataset, { organizationId, campaignId });
}

function hasBearerTokenInSource(sourceConfig) {
  return Boolean(sourceConfig?.api && typeof sourceConfig.api === "object" && sourceConfig.api.bearerToken);
}

function mapOrganizationRow(row) {
  return createOrganizationRecord({
    id: row.app_id || row.slug,
    slug: row.slug,
    name: row.name,
    status: row.status || "active",
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at || ""),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at || ""),
  });
}

function mapCampaignRow(row) {
  return createCampaignRecord({
    id: row.app_id || row.slug,
    organizationId: row.organization_app_id || row.organization_slug || "",
    slug: row.slug,
    name: row.name,
    status: row.status || "draft",
    startAt: row.starts_at instanceof Date ? row.starts_at.toISOString() : String(row.starts_at || ""),
    endAt: row.ends_at instanceof Date ? row.ends_at.toISOString() : String(row.ends_at || ""),
    target: Number(row.target_amount || 0) || 0,
    currency: String(row.currency_code || "ILS").trim().toUpperCase() || "ILS",
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at || ""),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at || ""),
    updatedBy: normalizeEmail(row.updated_by || ""),
  });
}

async function readLegacyDevStore(path) {
  try {
    const content = await readFile(path, "utf8");
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === "object" && parsed.items && typeof parsed.items === "object" ? parsed.items : {};
  } catch {
    return {};
  }
}

async function readLegacyDataset() {
  try {
    const content = await readFile(LEGACY_DATASET_PATH, "utf8");
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeCampaignSnapshot(snapshot = {}, entry = {}) {
  const basics = snapshot?.basics && typeof snapshot.basics === "object" ? snapshot.basics : {};
  const orgName = String(
    snapshot?.organization?.name ||
      basics.organizationName ||
      entry.organizationName ||
      "Default Organization",
  ).trim() || "Default Organization";
  const orgSlug = normalizeSlug(
    snapshot?.organization?.slug ||
      basics.organizationSlug ||
      entry.organizationSlug ||
      orgName,
    DEFAULT_PLATFORM_ORGANIZATION_SLUG,
  );
  const orgId = normalizeStableId(
    snapshot?.organization?.id ||
      basics.organizationId ||
      entry.organizationId ||
      orgSlug,
    DEFAULT_PLATFORM_ORGANIZATION_ID,
  );
  const organization = createOrganizationRecord(
    {
      id: orgId,
      slug: orgSlug,
      name: orgName,
      createdAt: entry.updatedAt || basics.createdAt || isoNow(),
      updatedAt: entry.updatedAt || basics.updatedAt || isoNow(),
      status: "active",
    },
  );

  const campaignSlug = normalizeSlug(entry.slug || basics.slug || basics.campaignName || "campaign", "campaign");
  const campaignId = normalizeStableId(entry.id || basics.id || campaignSlug, campaignSlug);
  const campaignName = String(entry.name || basics.campaignName || campaignSlug).trim() || campaignSlug;
  const campaign = createCampaignRecord(
    {
      id: campaignId,
      organizationId: organization.id,
      slug: campaignSlug,
      name: campaignName,
      status: basics.status || "draft",
      startAt: buildDateTimeIso(basics.startDate, basics.startTime, ""),
      endAt: buildDateTimeIso(basics.endDate, basics.endTime, ""),
      target: Number(snapshot?.goals?.campaignGoal || basics.target || 0),
      currency: basics.currency || "ILS",
      createdAt: entry.updatedAt || snapshot?.meta?.lastSavedAt || isoNow(),
      updatedAt: entry.updatedAt || snapshot?.meta?.lastSavedAt || isoNow(),
      updatedBy: normalizeEmail(entry.updatedBy || snapshot?.meta?.lastSavedBy || ""),
    },
    organization,
  );

  const config = cloneJson(snapshot);
  config.organization = {
    id: organization.id,
    slug: organization.slug,
    name: organization.name,
    status: organization.status,
  };
  config.basics = {
    ...(config.basics || {}),
    id: campaign.id,
    organizationId: organization.id,
    organizationSlug: organization.slug,
    organizationName: organization.name,
    slug: campaign.slug,
    campaignName: campaign.name,
    status: campaign.status,
    target: campaign.target,
    currency: campaign.currency,
  };
  config.meta = {
    ...(config.meta || {}),
    lastSavedAt: entry.updatedAt || config.meta?.lastSavedAt || "",
    lastSavedBy: normalizeEmail(entry.updatedBy || config.meta?.lastSavedBy || ""),
  };
  return { organization, campaign, config };
}

function parseLegacyCampaignRegistry(value) {
  const candidate = value && typeof value === "object" ? value : {};
  const legacyCandidate =
    candidate?.config && typeof candidate.config === "object" && !Array.isArray(candidate.config)
      ? candidate.config
      : candidate?.campaigns
        ? null
        : candidate;
  const rawCampaigns = Array.isArray(candidate.campaigns)
    ? candidate.campaigns
    : legacyCandidate && Object.keys(legacyCandidate).length
      ? [
          {
            id: candidate.id,
            name: candidate.name,
            slug: candidate.slug,
            updatedAt: candidate.updatedAt,
            updatedBy: candidate.updatedBy,
            config: legacyCandidate,
          },
        ]
      : [];
  const entries = rawCampaigns.map((item, index) => {
    const rawEntry = item && typeof item === "object" ? item : {};
    const snapshot = rawEntry?.config && typeof rawEntry.config === "object" ? rawEntry.config : rawEntry;
    return normalizeCampaignSnapshot(snapshot, {
      id: rawEntry.id || `campaign-${index + 1}`,
      name: rawEntry.name,
      slug: rawEntry.slug,
      updatedAt: rawEntry.updatedAt,
      updatedBy: rawEntry.updatedBy,
    });
  });
  return {
    activeCampaignId: normalizeStableId(candidate.activeCampaignId || entries[0]?.campaign.id || "", entries[0]?.campaign.id || ""),
    entries,
  };
}

async function readLegacyCampaignRegistry() {
  const store = await readLegacyDevStore(LEGACY_CAMPAIGN_STORE_PATH);
  return store[LEGACY_CAMPAIGN_KEY] || null;
}

async function readLegacySourceConfig() {
  const store = await readLegacyDevStore(LEGACY_SOURCE_STORE_PATH);
  return store[LEGACY_SOURCE_KEY] || null;
}

function buildDatasetSeed(dataset, scope) {
  return createCampaignDatasetRecord(
    {
      rows: Array.isArray(dataset?.rows) ? dataset.rows : [],
      meta: dataset?.meta && typeof dataset.meta === "object" ? dataset.meta : {},
      sourceLabel: dataset?.sourceLabel || "",
      generatedAt: dataset?.generatedAt || isoNow(),
      updatedAt: dataset?.generatedAt || isoNow(),
    },
    scope,
  );
}

async function findOrganizationRow(client, organizationId, slugHint = "") {
  const normalizedId = normalizeStableId(organizationId || slugHint || "", DEFAULT_PLATFORM_ORGANIZATION_ID);
  const normalizedSlug = normalizeSlug(slugHint || organizationId || "", DEFAULT_PLATFORM_ORGANIZATION_SLUG);
  const result = await client.query(
    `
      SELECT id::text, app_id, slug, name, status, created_at, updated_at
      FROM goodraise.organizations
      WHERE app_id = $1 OR slug = $2
      ORDER BY CASE WHEN app_id = $1 THEN 0 ELSE 1 END, updated_at DESC
      LIMIT 1
    `,
    [normalizedId, normalizedSlug],
  );
  return result.rows[0] || null;
}

async function findCampaignRow(client, organizationRow, campaignId, slugHint = "") {
  if (!organizationRow?.id) {
    return null;
  }
  const normalizedId = normalizeStableId(campaignId || slugHint || "", "campaign");
  const normalizedSlug = normalizeSlug(slugHint || campaignId || "", "campaign");
  const result = await client.query(
    `
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
        c.updated_by,
        o.app_id AS organization_app_id,
        o.slug AS organization_slug
      FROM goodraise.campaigns c
      JOIN goodraise.organizations o ON o.id = c.organization_id
      WHERE c.organization_id = $1
        AND (c.app_id = $2 OR c.slug = $3)
      ORDER BY CASE WHEN c.app_id = $2 THEN 0 ELSE 1 END, c.updated_at DESC
      LIMIT 1
    `,
    [organizationRow.id, normalizedId, normalizedSlug],
  );
  return result.rows[0] || null;
}

async function upsertOrganizationRow(client, record) {
  const normalized = createOrganizationRecord(record);
  const existing = await findOrganizationRow(client, normalized.id, normalized.slug);
  if (existing) {
    const result = await client.query(
      `
        UPDATE goodraise.organizations
        SET app_id = $1,
            slug = $2,
            name = $3,
            status = $4,
            updated_at = $5
        WHERE id = $6::uuid
        RETURNING id::text, app_id, slug, name, status, created_at, updated_at
      `,
      [normalized.id, normalized.slug, normalized.name, normalized.status, normalized.updatedAt || isoNow(), existing.id],
    );
    return result.rows[0];
  }

  const inserted = await client.query(
    `
      INSERT INTO goodraise.organizations (id, app_id, slug, name, status, created_at, updated_at)
      VALUES ($1::uuid, $2, $3, $4, $5, $6, $7)
      RETURNING id::text, app_id, slug, name, status, created_at, updated_at
    `,
    [
      randomUUID(),
      normalized.id,
      normalized.slug,
      normalized.name,
      normalized.status,
      normalized.createdAt || isoNow(),
      normalized.updatedAt || isoNow(),
    ],
  );
  return inserted.rows[0];
}

async function upsertCampaignRow(client, record) {
  const normalized = createCampaignRecord(record);
  const organizationRow =
    (await findOrganizationRow(client, normalized.organizationId, normalized.organizationId)) ||
    (await upsertOrganizationRow(
      client,
      createOrganizationRecord({
        id: normalized.organizationId,
        slug: normalized.organizationId,
        name: normalized.organizationId,
        status: "active",
        createdAt: normalized.createdAt || isoNow(),
        updatedAt: normalized.updatedAt || isoNow(),
      }),
    ));
  const existing = await findCampaignRow(client, organizationRow, normalized.id, normalized.slug);
  if (existing) {
    const result = await client.query(
      `
        UPDATE goodraise.campaigns
        SET app_id = $1,
            slug = $2,
            name = $3,
            status = $4,
            target_amount = $5,
            currency_code = $6,
            starts_at = NULLIF($7, '')::timestamptz,
            ends_at = NULLIF($8, '')::timestamptz,
            updated_by = $9,
            updated_at = $10
        WHERE id = $11::uuid
        RETURNING
          id::text,
          app_id,
          slug,
          name,
          status,
          target_amount,
          currency_code,
          starts_at,
          ends_at,
          created_at,
          updated_at,
          updated_by,
          $12::text AS organization_app_id,
          $13::text AS organization_slug
      `,
      [
        normalized.id,
        normalized.slug,
        normalized.name,
        normalized.status,
        normalized.target || 0,
        normalized.currency || "ILS",
        normalized.startAt || "",
        normalized.endAt || "",
        normalizeEmail(normalized.updatedBy || ""),
        normalized.updatedAt || isoNow(),
        existing.id,
        organizationRow.app_id || organizationRow.slug,
        organizationRow.slug,
      ],
    );
    return result.rows[0];
  }

  const inserted = await client.query(
    `
      INSERT INTO goodraise.campaigns (
        id,
        organization_id,
        app_id,
        slug,
        name,
        status,
        target_amount,
        currency_code,
        starts_at,
        ends_at,
        updated_by,
        created_at,
        updated_at
      )
      VALUES (
        $1::uuid,
        $2::uuid,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        NULLIF($9, '')::timestamptz,
        NULLIF($10, '')::timestamptz,
        $11,
        $12,
        $13
      )
      RETURNING
        id::text,
        app_id,
        slug,
        name,
        status,
        target_amount,
        currency_code,
        starts_at,
        ends_at,
        created_at,
        updated_at,
        updated_by,
        $14::text AS organization_app_id,
        $15::text AS organization_slug
    `,
    [
      randomUUID(),
      organizationRow.id,
      normalized.id,
      normalized.slug,
      normalized.name,
      normalized.status,
      normalized.target || 0,
      normalized.currency || "ILS",
      normalized.startAt || "",
      normalized.endAt || "",
      normalizeEmail(normalized.updatedBy || ""),
      normalized.createdAt || isoNow(),
      normalized.updatedAt || isoNow(),
      organizationRow.app_id || organizationRow.slug,
      organizationRow.slug,
    ],
  );
  return inserted.rows[0];
}

async function getCampaignScopeRows(client, organizationId, campaignId) {
  const organizationRow = await findOrganizationRow(client, organizationId, organizationId);
  if (!organizationRow) {
    return { organizationRow: null, campaignRow: null };
  }
  const campaignRow = await findCampaignRow(client, organizationRow, campaignId, campaignId);
  return {
    organizationRow,
    campaignRow,
  };
}

async function getStoredPayload(client, tableName, organizationId, campaignId) {
  const { campaignRow } = await getCampaignScopeRows(client, organizationId, campaignId);
  if (!campaignRow) {
    return null;
  }
  const result = await client.query(
    `
      SELECT payload
      FROM goodraise.${tableName}
      WHERE campaign_id = $1::uuid
      LIMIT 1
    `,
    [campaignRow.id],
  );
  return result.rows[0] || null;
}

async function upsertPayload(client, tableName, organizationId, campaignId, payload, options = {}) {
  const { organizationRow, campaignRow } = await getCampaignScopeRows(client, organizationId, campaignId);
  if (!organizationRow || !campaignRow) {
    throw new Error(`Missing campaign scope for ${organizationId}/${campaignId}.`);
  }
  const now = options.updatedAt || isoNow();
  const updatedBy = normalizeEmail(options.updatedBy || "");
  const hasSecret = Boolean(options.hasSecret);
  const rowCount = Number(options.rowCount || 0) || 0;
  const generatedAt = options.generatedAt || now;
  const columns =
    tableName === "campaign_sources"
      ? "id, organization_id, campaign_id, payload, has_secret, updated_at, updated_by"
      : tableName === "campaign_datasets"
        ? "id, organization_id, campaign_id, payload, row_count, generated_at, updated_at"
        : "id, organization_id, campaign_id, payload, revision, updated_at, updated_by";
  const values =
    tableName === "campaign_sources"
      ? [
          randomUUID(),
          organizationRow.id,
          campaignRow.id,
          payload,
          hasSecret,
          now,
          updatedBy,
        ]
      : tableName === "campaign_datasets"
        ? [
            randomUUID(),
            organizationRow.id,
            campaignRow.id,
            payload,
            rowCount,
            generatedAt,
            now,
          ]
        : [
            randomUUID(),
            organizationRow.id,
            campaignRow.id,
            payload,
            1,
            now,
            updatedBy,
          ];
  const updateSql =
    tableName === "campaign_sources"
      ? "payload = EXCLUDED.payload, has_secret = EXCLUDED.has_secret, updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by"
      : tableName === "campaign_datasets"
        ? "payload = EXCLUDED.payload, row_count = EXCLUDED.row_count, generated_at = EXCLUDED.generated_at, updated_at = EXCLUDED.updated_at"
        : "payload = EXCLUDED.payload, revision = goodraise.campaign_configs.revision + 1, updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by";
  const result = await client.query(
    `
      INSERT INTO goodraise.${tableName} (${columns})
      VALUES (${values.map((_, index) => `$${index + 1}`).join(", ")})
      ON CONFLICT (campaign_id) DO UPDATE SET
        ${updateSql}
      RETURNING payload
    `,
    values,
  );
  return result.rows[0]?.payload || payload;
}

export async function appendAuditEvent(event) {
  const store = getStore();
  const record = createAuditRecord(event);
  await store.setJSON(auditKey(), record);
  return record;
}

export async function listOrganizations() {
  if (!usesPostgresCampaignStore()) {
    const store = getStore();
    const items = await store.listJSON("organization:");
    return items.map((item) => createOrganizationRecord(item.value));
  }
  return withPostgresClient(async (client) => {
    const result = await client.query(
      `
        SELECT id::text, app_id, slug, name, status, created_at, updated_at
        FROM goodraise.organizations
        WHERE app_id IS NOT NULL
        ORDER BY updated_at DESC, created_at DESC
      `,
    );
    return result.rows.map(mapOrganizationRow);
  });
}

export async function getOrganization(organizationId) {
  if (!usesPostgresCampaignStore()) {
    const store = getStore();
    const value = await store.getJSON(organizationKey(organizationId));
    return value ? createOrganizationRecord(value) : null;
  }
  return withPostgresClient(async (client) => {
    const row = await findOrganizationRow(client, organizationId, organizationId);
    return row ? mapOrganizationRow(row) : null;
  });
}

export async function saveOrganization(record) {
  if (!usesPostgresCampaignStore()) {
    const store = getStore();
    const normalized = createOrganizationRecord(record);
    await store.setJSON(organizationKey(normalized.id), normalized);
    return normalized;
  }
  return withPostgresClient(async (client) => {
    const row = await upsertOrganizationRow(client, record);
    return mapOrganizationRow(row);
  });
}

export async function listCampaigns(organizationId = "") {
  if (!usesPostgresCampaignStore()) {
    const store = getStore();
    const prefix = organizationId ? `campaign:${organizationId}:` : "campaign:";
    const items = await store.listJSON(prefix);
    return items.map((item) => createCampaignRecord(item.value));
  }
  return withPostgresClient(async (client) => {
    let orgRow = null;
    if (organizationId) {
      orgRow = await findOrganizationRow(client, organizationId, organizationId);
      if (!orgRow) {
        return [];
      }
    }
    const result = await client.query(
      `
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
          c.updated_by,
          o.app_id AS organization_app_id,
          o.slug AS organization_slug
        FROM goodraise.campaigns c
        JOIN goodraise.organizations o ON o.id = c.organization_id
        WHERE c.app_id IS NOT NULL
          AND ($1::uuid IS NULL OR c.organization_id = $1::uuid)
        ORDER BY c.updated_at DESC, c.created_at DESC
      `,
      [orgRow?.id || null],
    );
    return result.rows.map(mapCampaignRow);
  });
}

export async function getCampaign(organizationId, campaignId) {
  if (!usesPostgresCampaignStore()) {
    const store = getStore();
    const value = await store.getJSON(campaignKey(organizationId, campaignId));
    return value ? createCampaignRecord(value) : null;
  }
  return withPostgresClient(async (client) => {
    const { campaignRow } = await getCampaignScopeRows(client, organizationId, campaignId);
    return campaignRow ? mapCampaignRow(campaignRow) : null;
  });
}

export async function saveCampaign(record) {
  if (!usesPostgresCampaignStore()) {
    const store = getStore();
    const organization = await getOrganization(record.organizationId);
    const normalized = createCampaignRecord(record, organization || createOrganizationRecord({ id: record.organizationId }));
    await store.setJSON(campaignKey(normalized.organizationId, normalized.id), normalized);
    return normalized;
  }
  return withPostgresClient(async (client) => {
    const row = await upsertCampaignRow(client, record);
    return mapCampaignRow(row);
  });
}

export async function getCampaignConfig(organizationId, campaignId) {
  if (!usesPostgresCampaignStore()) {
    const store = getStore();
    return (await store.getJSON(campaignConfigKey(organizationId, campaignId))) || null;
  }
  return withPostgresClient(async (client) => {
    const row = await getStoredPayload(client, "campaign_configs", organizationId, campaignId);
    return row?.payload || null;
  });
}

export async function saveCampaignConfig(organizationId, campaignId, config, updatedBy = "") {
  if (!usesPostgresCampaignStore()) {
    const store = getStore();
    const existing = await getCampaignConfig(organizationId, campaignId);
    const merged = cloneJson(config || existing || {});
    merged.meta = {
      ...(merged.meta || {}),
      lastSavedAt: isoNow(),
      lastSavedBy: normalizeEmail(updatedBy || merged.meta?.lastSavedBy || ""),
    };
    await store.setJSON(campaignConfigKey(organizationId, campaignId), merged);
    return merged;
  }
  const existing = await getCampaignConfig(organizationId, campaignId);
  const merged = cloneJson(config || existing || {});
  merged.meta = {
    ...(merged.meta || {}),
    lastSavedAt: isoNow(),
    lastSavedBy: normalizeEmail(updatedBy || merged.meta?.lastSavedBy || ""),
  };
  return withPostgresClient(async (client) =>
    upsertPayload(client, "campaign_configs", organizationId, campaignId, merged, {
      updatedAt: merged.meta.lastSavedAt,
      updatedBy: merged.meta.lastSavedBy,
    }),
  );
}

export async function getCampaignSource(organizationId, campaignId) {
  if (!usesPostgresCampaignStore()) {
    const store = getStore();
    const value = await store.getJSON(campaignSourceKey(organizationId, campaignId));
    return value ? normalizeSourceConfig(value) : normalizeSourceConfig(defaultSourceConfig());
  }
  return withPostgresClient(async (client) => {
    const row = await getStoredPayload(client, "campaign_sources", organizationId, campaignId);
    return row?.payload ? normalizeSourceConfig(row.payload) : normalizeSourceConfig(defaultSourceConfig());
  });
}

export async function saveCampaignSource(organizationId, campaignId, sourceConfig, updatedBy = "") {
  if (!usesPostgresCampaignStore()) {
    const store = getStore();
    const existing = await getCampaignSource(organizationId, campaignId);
    const normalized = normalizeSourceConfig(sourceConfig, existing);
    await store.setJSON(campaignSourceKey(organizationId, campaignId), normalized);
    return normalized;
  }
  const existing = await getCampaignSource(organizationId, campaignId);
  const normalized = normalizeSourceConfig(sourceConfig, existing);
  return withPostgresClient(async (client) =>
    upsertPayload(client, "campaign_sources", organizationId, campaignId, normalized, {
      updatedAt: isoNow(),
      updatedBy,
      hasSecret: hasBearerTokenInSource(normalized),
    }),
  );
}

export async function getCampaignDataset(organizationId, campaignId) {
  if (!usesPostgresCampaignStore()) {
    const store = getStore();
    const value = await store.getJSON(campaignDatasetKey(organizationId, campaignId));
    return value ? createCampaignDatasetRecord(value, { organizationId, campaignId }) : null;
  }
  return withPostgresClient(async (client) => {
    const row = await getStoredPayload(client, "campaign_datasets", organizationId, campaignId);
    return row?.payload ? createCampaignDatasetRecord(row.payload, { organizationId, campaignId }) : null;
  });
}

export async function saveCampaignDataset(organizationId, campaignId, dataset) {
  if (!usesPostgresCampaignStore()) {
    const store = getStore();
    const normalized = createCampaignDatasetRecord(dataset, { organizationId, campaignId });
    await store.setJSON(campaignDatasetKey(organizationId, campaignId), normalized);
    return normalized;
  }
  const normalized = normalizeDatasetPayload(dataset, organizationId, campaignId);
  return withPostgresClient(async (client) => {
    const payload = await upsertPayload(client, "campaign_datasets", organizationId, campaignId, normalized, {
      generatedAt: normalized.generatedAt || isoNow(),
      updatedAt: normalized.updatedAt || isoNow(),
      rowCount: Array.isArray(normalized.rows) ? normalized.rows.length : 0,
    });
    return createCampaignDatasetRecord(payload, { organizationId, campaignId });
  });
}

export async function listCampaignDatasets(organizationId = "") {
  if (!usesPostgresCampaignStore()) {
    const store = getStore();
    const prefix = organizationId ? `campaign-dataset:${organizationId}:` : "campaign-dataset:";
    const items = await store.listJSON(prefix);
    return items.map((item) => createCampaignDatasetRecord(item.value));
  }
  return withPostgresClient(async (client) => {
    let orgRow = null;
    if (organizationId) {
      orgRow = await findOrganizationRow(client, organizationId, organizationId);
      if (!orgRow) {
        return [];
      }
    }
    const result = await client.query(
      `
        SELECT
          d.payload,
          o.app_id AS organization_app_id,
          o.slug AS organization_slug,
          c.app_id AS campaign_app_id,
          c.slug AS campaign_slug
        FROM goodraise.campaign_datasets d
        JOIN goodraise.campaigns c ON c.id = d.campaign_id
        JOIN goodraise.organizations o ON o.id = d.organization_id
        WHERE c.app_id IS NOT NULL
          AND ($1::uuid IS NULL OR d.organization_id = $1::uuid)
        ORDER BY d.updated_at DESC
      `,
      [orgRow?.id || null],
    );
    return result.rows.map((row) =>
      createCampaignDatasetRecord(row.payload, {
        organizationId: row.organization_app_id || row.organization_slug,
        campaignId: row.campaign_app_id || row.campaign_slug,
      }),
    );
  });
}

export async function ensureMultiTenantMigration() {
  const store = getStore();
  const existingMigration = await store.getJSON(MIGRATION_KEY);
  if (existingMigration?.completedAt) {
    return existingMigration;
  }

  const organizations = await listOrganizations();
  const campaigns = await listCampaigns();
  if (organizations.length || campaigns.length) {
    const marker = {
      completedAt: isoNow(),
      skipped: true,
      reason: "records_already_exist",
      persistence: usesPostgresCampaignStore() ? "postgres" : "platform-store",
    };
    await store.setJSON(MIGRATION_KEY, marker);
    return marker;
  }

  const legacyRegistry = await readLegacyCampaignRegistry();
  const legacySource = await readLegacySourceConfig();
  const legacyDataset = await readLegacyDataset();
  const parsedLegacy = parseLegacyCampaignRegistry(legacyRegistry || {});

  const migratedOrganizations = new Map();
  let migratedCampaigns = 0;

  for (const entry of parsedLegacy.entries) {
    migratedOrganizations.set(entry.organization.id, entry.organization);
    await saveOrganization(entry.organization);
    await saveCampaign(entry.campaign);
    await saveCampaignConfig(entry.organization.id, entry.campaign.id, entry.config, entry.config?.meta?.lastSavedBy || "");
    await saveCampaignSource(
      entry.organization.id,
      entry.campaign.id,
      normalizeSourceConfig(legacySource || defaultSourceConfig()),
      entry.config?.meta?.lastSavedBy || "",
    );
    if (legacyDataset) {
      await saveCampaignDataset(
        entry.organization.id,
        entry.campaign.id,
        buildDatasetSeed(legacyDataset, {
          organizationId: entry.organization.id,
          campaignId: entry.campaign.id,
        }),
      );
    }
    migratedCampaigns += 1;
  }

  const marker = {
    completedAt: isoNow(),
    activeCampaignId: parsedLegacy.activeCampaignId || "",
    migratedOrganizations: migratedOrganizations.size,
    migratedCampaigns,
    copiedLegacyDatasetToCampaigns: Boolean(legacyDataset),
    copiedLegacySourceToCampaigns: Boolean(legacySource),
    legacyArtifactsRetained: true,
    persistence: usesPostgresCampaignStore() ? "postgres" : "platform-store",
  };
  await store.setJSON(MIGRATION_KEY, marker);
  await appendAuditEvent({
    action: "legacy_registry_migration",
    outcome: "success",
    role: ROLE_PLATFORM_ADMIN,
    detail: marker,
  });
  return marker;
}

export async function buildCampaignContext(organizationId, campaignId) {
  const organization = await getOrganization(organizationId);
  const campaign = await getCampaign(organizationId, campaignId);
  if (!organization || !campaign) {
    return null;
  }
  const [config, source, dataset] = await Promise.all([
    getCampaignConfig(organizationId, campaignId),
    getCampaignSource(organizationId, campaignId),
    getCampaignDataset(organizationId, campaignId),
  ]);
  return {
    organizationId,
    campaignId,
    organization,
    campaign,
    config: config || {},
    goals: config?.goals || {},
    source: source || normalizeSourceConfig(defaultSourceConfig()),
    ambassadors: config?.ambassadors?.records || [],
    teams: config?.teams?.groups || [],
    prizes: {
      placePrizes: config?.goals?.placePrizes || [],
      tierPrizes: config?.goals?.tierPrizes || [],
      tierRuleNote: config?.goals?.tierRuleNote || "",
    },
    dataset: dataset || createCampaignDatasetRecord({}, { organizationId, campaignId }),
    meta: config?.meta || {},
  };
}

export async function listCampaignSummaries() {
  const organizations = await listOrganizations();
  const organizationMap = new Map(organizations.map((item) => [item.id, item]));
  const campaigns = await listCampaigns();
  const summaries = [];
  for (const campaign of campaigns) {
    const dataset = await getCampaignDataset(campaign.organizationId, campaign.id);
    const config = await getCampaignConfig(campaign.organizationId, campaign.id);
    summaries.push(
      buildCampaignSummary({
        organization: organizationMap.get(campaign.organizationId) || null,
        campaign,
        dataset,
        config,
      }),
    );
  }
  return summaries;
}
