import { getDatabasePool } from '../database.ts';
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

import { createPlatformStore } from "./platform-store.mjs";
import { validateSourceConfig } from "./source-security.mjs";
import { authorize } from "./authorization.mjs";
import { normalizePostgresConnectionString, shouldRunRuntimeSchemaMigrations } from "./postgres-connection.mjs";
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
const DATA_DIR = process.env.GOODRAISE_DATA_DIR || resolve(ROOT_DIR, "work", "data");
const PLATFORM_DEV_STORE_PATH = resolve(DATA_DIR, "goodraise-platform-dev.json");
const LEGACY_CAMPAIGN_STORE_PATH = resolve(DATA_DIR, "netlify-campaign-config-dev.json");
const LEGACY_SOURCE_STORE_PATH = resolve(DATA_DIR, "netlify-source-config-dev.json");
const LEGACY_DATASET_PATH = resolve(ROOT_DIR, "netlify", "data", "admin-dataset.json");
const DEFAULT_CAMPAIGN_PATH = resolve(ROOT_DIR, "apps", "web", "src", "default-campaign.json");
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

CREATE TABLE IF NOT EXISTS goodraise.campaign_public_snapshots (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES goodraise.organizations(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES goodraise.campaigns(id) ON DELETE CASCADE,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  completed_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (campaign_id)
);

CREATE INDEX IF NOT EXISTS idx_campaign_configs_campaign ON goodraise.campaign_configs(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_sources_campaign ON goodraise.campaign_sources(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_datasets_campaign ON goodraise.campaign_datasets(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_public_snapshots_completed ON goodraise.campaign_public_snapshots(completed_at DESC);
`;

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

function campaignPublicSnapshotKey(organizationId, campaignId) {
  return `campaign-public-snapshot:${organizationId}:${campaignId}`;
}

function auditKey() {
  return `audit:${Date.now()}:${Math.random().toString(16).slice(2, 10)}`;
}

function runtimeFlagKey(namespace, identifier) {
  return `runtime-flag:${namespace}:${identifier}`;
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
  return getDatabasePool();
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
        if (shouldRunRuntimeSchemaMigrations()) {
          await client.query(POSTGRES_CAMPAIGN_SCHEMA_SQL);
        } else {
          await client.query("SELECT 1");
        }
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

function sqlTimestamp(value) {
  // pg returns Date for columns and strings for the same columns inside JSON.
  return value ? new Date(value).toISOString() : "";
}

function mapOrganizationRow(row) {
  return createOrganizationRecord({
    id: row.app_id || row.slug,
    slug: row.slug,
    name: row.name,
    status: row.status || "active",
    createdAt: sqlTimestamp(row.created_at),
    updatedAt: sqlTimestamp(row.updated_at),
  });
}

function mapCampaignRow(row) {
  return createCampaignRecord({
    id: row.app_id || row.slug,
    organizationId: row.organization_app_id || row.organization_slug || "",
    slug: row.slug,
    name: row.name,
    status: row.status || "draft",
    startAt: sqlTimestamp(row.starts_at),
    endAt: sqlTimestamp(row.ends_at),
    target: Number(row.target_amount || 0) || 0,
    currency: String(row.currency_code || "ILS").trim().toUpperCase() || "ILS",
    createdAt: sqlTimestamp(row.created_at),
    updatedAt: sqlTimestamp(row.updated_at),
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

async function buildFreshLocalDemoEntry(dataset) {
  let presentation = {};
  try {
    presentation = JSON.parse(await readFile(DEFAULT_CAMPAIGN_PATH, "utf8"));
  } catch {}
  const meta = dataset?.meta && typeof dataset.meta === "object" ? dataset.meta : {};
  const startDate = String(meta.defaultFrom || meta.minDate || "").slice(0, 10);
  const endDate = String(meta.defaultTo || meta.maxDate || "").slice(0, 10);
  const snapshot = {
    organization: {
      id: "goodraise-demo",
      slug: "goodraise-demo",
      name: "GoodRaise Demo",
      status: "active",
    },
    basics: {
      id: "demo-campaign",
      organizationId: "goodraise-demo",
      organizationSlug: "goodraise-demo",
      organizationName: "GoodRaise Demo",
      slug: "demo-campaign",
      campaignName: String(presentation.title || "קמפיין לדוגמה"),
      status: "live",
      target: 100000,
      currency: "ILS",
      startDate,
      endDate,
    },
    branding: {
      eyebrow: presentation.eyebrow || "GoodRaise",
      title: presentation.title || "קמפיין לדוגמה",
      subtitle: presentation.subtitle || "",
      storyMarkdown: presentation.storyMarkdown || "",
      primaryCtaLabel: presentation.primaryCtaLabel || "",
      secondaryCtaLabel: presentation.secondaryCtaLabel || "",
      mediaType: presentation.mediaType || "image",
      mediaUrl: presentation.mediaUrl || "",
      mediaAlt: presentation.mediaAlt || "",
      campaignLogoUrl: presentation.campaignLogoUrl || "",
      organizationLogoUrl: presentation.organizationLogoUrl || "",
      fontFamily: presentation.fontFamily || "Assistant",
      theme: presentation.theme || {},
    },
    donation: {
      presets: Array.isArray(presentation.amountCards) ? cloneJson(presentation.amountCards) : [],
      showRecurring: presentation.showRecurring !== false,
      externalDonationUrl: presentation.externalDonationUrl || "",
      trustNote: presentation.trustNote || "",
      successHint: presentation.successHint || "",
    },
    goals: { campaignGoal: 100000 },
  };
  return normalizeCampaignSnapshot(snapshot, {
    id: "demo-campaign",
    name: snapshot.basics.campaignName,
    slug: "demo-campaign",
    updatedAt: dataset?.generatedAt || isoNow(),
  });
}

async function persistMigratedCampaign(entry, legacySource, legacyDataset) {
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

export async function getRuntimeFlag(namespace, identifier) {
  const store = getStore();
  return (await store.getJSON(runtimeFlagKey(namespace, identifier))) || null;
}

export async function saveRuntimeFlag(namespace, identifier, payload = {}) {
  const store = getStore();
  const record = {
    namespace: String(namespace || "").trim(),
    identifier: String(identifier || "").trim(),
    ...cloneJson(payload || {}),
    updatedAt: isoNow(),
  };
  await store.setJSON(runtimeFlagKey(namespace, identifier), record);
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
        WHERE ($1::uuid IS NULL OR c.organization_id = $1::uuid)
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

// Authorization needs identities, never config, source secrets or donation rows.
// Resolve the organization once and constrain the campaign lookup to that tenant.
export async function getCampaignIdentity(organizationId, campaignId) {
  if (usesPostgresCampaignStore()) {
    return withPostgresClient(async (client) => {
      const { organizationRow, campaignRow } = await getCampaignScopeRows(client, organizationId, campaignId);
      return {
        organization: organizationRow ? mapOrganizationRow(organizationRow) : null,
        campaign: campaignRow ? mapCampaignRow(campaignRow) : null,
      };
    });
  }
  const organization = await getOrganization(organizationId)
    || (await listOrganizations()).find((item) => item.slug === organizationId) || null;
  if (!organization) return { organization: null, campaign: null };
  const campaign = await getCampaign(organization.id, campaignId)
    || (await listCampaigns(organization.id)).find((item) => item.slug === campaignId) || null;
  return { organization, campaign };
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
  const existing = await getCampaignSource(organizationId, campaignId);
  const normalized = normalizeSourceConfig(sourceConfig, existing);
  await validateSourceConfig(normalized);
  if (!usesPostgresCampaignStore()) {
    const store = getStore();
    await store.setJSON(campaignSourceKey(organizationId, campaignId), normalized);
    return normalized;
  }
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
        WHERE ($1::uuid IS NULL OR d.organization_id = $1::uuid)
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

export async function getCampaignPublicSnapshot(organizationId, campaignId) {
  if (!usesPostgresCampaignStore()) {
    const store = getStore();
    return (await store.getJSON(campaignPublicSnapshotKey(organizationId, campaignId))) || null;
  }
  return withPostgresClient(async (client) => {
    const row = await getStoredPayload(client, "campaign_public_snapshots", organizationId, campaignId);
    return row?.payload || null;
  });
}

export async function listCampaignPublicSnapshots() {
  if (!usesPostgresCampaignStore()) {
    const store = getStore();
    const items = await store.listJSON("campaign-public-snapshot:");
    return items.map((item) => cloneJson(item.value));
  }
  return withPostgresClient(async (client) => {
    const result = await client.query(`
      SELECT payload
      FROM goodraise.campaign_public_snapshots
      ORDER BY completed_at DESC, updated_at DESC
    `);
    return result.rows.map((row) => row.payload);
  });
}

export async function saveCampaignPublicSnapshot(organizationId, campaignId, snapshot) {
  const payload = cloneJson(snapshot || {});
  if (!usesPostgresCampaignStore()) {
    const store = getStore();
    await store.setJSON(campaignPublicSnapshotKey(organizationId, campaignId), payload);
    return payload;
  }
  return withPostgresClient(async (client) => {
    const { organizationRow, campaignRow } = await getCampaignScopeRows(client, organizationId, campaignId);
    if (!organizationRow || !campaignRow) {
      throw new Error(`Missing campaign scope for ${organizationId}/${campaignId}.`);
    }
    const completedAt = payload.completedAt || payload.updatedAt || isoNow();
    const updatedAt = payload.updatedAt || isoNow();
    const result = await client.query(`
      INSERT INTO goodraise.campaign_public_snapshots (
        id, organization_id, campaign_id, payload, completed_at, updated_at
      ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6)
      ON CONFLICT (campaign_id) DO UPDATE SET
        payload = EXCLUDED.payload,
        completed_at = EXCLUDED.completed_at,
        updated_at = EXCLUDED.updated_at
      RETURNING payload
    `, [randomUUID(), organizationRow.id, campaignRow.id, payload, completedAt, updatedAt]);
    return result.rows[0]?.payload || payload;
  });
}

export async function deleteCampaignPublicSnapshot(organizationId, campaignId) {
  if (!usesPostgresCampaignStore()) {
    const store = getStore();
    await store.delete(campaignPublicSnapshotKey(organizationId, campaignId));
    return;
  }
  await withPostgresClient(async (client) => {
    const { campaignRow } = await getCampaignScopeRows(client, organizationId, campaignId);
    if (campaignRow) {
      await client.query("DELETE FROM goodraise.campaign_public_snapshots WHERE campaign_id = $1::uuid", [campaignRow.id]);
    }
  });
}

function isSuccessfulDatasetRow(row) {
  const status = String(row?.status || "").trim().toLowerCase();
  return status === "success" || row?.chargedSuccess === true || row?.charged_success === true;
}

function localSupporterKey(row) {
  const email = normalizeEmail(row?.email || "");
  if (email) return `email:${email}`;
  const donor = String(row?.donor || row?.fullName || row?.full_name || "").trim().toLowerCase();
  if (donor) return `name:${donor}`;
  const id = String(row?.donorId || row?.donor_id || row?.id || "").trim();
  return id ? `id:${id}` : "";
}

export async function getCampaignPublicTotals(organizationId, campaignId) {
  if (!usesPostgresCampaignStore()) {
    const dataset = await getCampaignDataset(organizationId, campaignId);
    const successfulRows = (Array.isArray(dataset?.rows) ? dataset.rows : []).filter(isSuccessfulDatasetRow);
    const supporters = new Set(successfulRows.map(localSupporterKey).filter(Boolean));
    return {
      raised: successfulRows.reduce((sum, row) => sum + Number(row?.amount || 0), 0),
      supporterCount: supporters.size,
    };
  }
  return withPostgresClient(async (client) => {
    const { campaignRow } = await getCampaignScopeRows(client, organizationId, campaignId);
    if (!campaignRow) return { raised: 0, supporterCount: 0 };
    const result = await client.query(`
      SELECT
        COALESCE(SUM(total_amount) FILTER (WHERE charged_success IS TRUE), 0)::float8 AS raised,
        COUNT(DISTINCT donor_id) FILTER (WHERE charged_success IS TRUE AND donor_id IS NOT NULL)::int AS supporter_count
      FROM goodraise.transactions
      WHERE campaign_id = $1::uuid
    `, [campaignRow.id]);
    return {
      raised: Number(result.rows[0]?.raised || 0),
      supporterCount: Number(result.rows[0]?.supporter_count || 0),
    };
  });
}

export async function ensureMultiTenantMigration() {
  const store = getStore();
  const existingMigration = await store.getJSON(MIGRATION_KEY);
  if (existingMigration?.completedAt) {
    // Older fresh local runs could persist a zero-campaign marker even though
    // prepare:assets had produced a usable demo dataset. Repair only that exact
    // development state; never seed a configured PostgreSQL database.
    if (!usesPostgresCampaignStore() && existingMigration.migratedCampaigns === 0 && !(await listCampaigns()).length) {
      const legacyDataset = await readLegacyDataset();
      if (legacyDataset) {
        const entry = await buildFreshLocalDemoEntry(legacyDataset);
        await persistMigratedCampaign(entry, null, legacyDataset);
        const repaired = {
          ...existingMigration,
          activeCampaignId: entry.campaign.id,
          migratedOrganizations: 1,
          migratedCampaigns: 1,
          localDemoSeeded: true,
          repairedAt: isoNow(),
        };
        await store.setJSON(MIGRATION_KEY, repaired);
        return repaired;
      }
    }
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
  if (!parsedLegacy.entries.length && !usesPostgresCampaignStore() && legacyDataset) {
    const entry = await buildFreshLocalDemoEntry(legacyDataset);
    parsedLegacy.entries.push(entry);
    parsedLegacy.activeCampaignId = entry.campaign.id;
  }

  const migratedOrganizations = new Map();
  let migratedCampaigns = 0;

  for (const entry of parsedLegacy.entries) {
    migratedOrganizations.set(entry.organization.id, entry.organization);
    await persistMigratedCampaign(entry, legacySource, legacyDataset);
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

function projectDateRange(startAt = "", endAt = "") {
  const startDate = String(startAt || "").slice(0, 10);
  const endDate = String(endAt || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || startDate > endDate) {
    return [];
  }
  const dates = [];
  const cursor = new Date(`${startDate}T12:00:00.000Z`);
  const last = new Date(`${endDate}T12:00:00.000Z`);
  while (cursor <= last && dates.length < 730) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

export function applyConfiguredProjectWindow(dataset, config = {}, campaign = {}) {
  const baseDataset = dataset && typeof dataset === "object" ? dataset : {};
  const storedMeta = baseDataset.meta && typeof baseDataset.meta === "object" ? baseDataset.meta : {};
  const storedProjectDates = Array.isArray(storedMeta.projectDates)
    ? storedMeta.projectDates.map((value) => String(value || "").slice(0, 10)).filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))
    : [];
  // The browser dashboard uses the project window stored alongside its dataset.
  // Prefer it when it exists so server consumers (including Ask the Data) cannot
  // silently switch to unrelated draft dates from Campaign Builder.
  if (storedProjectDates.length) {
    return {
      ...baseDataset,
      meta: {
        ...storedMeta,
        projectDates: storedProjectDates,
        defaultFrom: String(storedMeta.defaultFrom || storedProjectDates[0]).slice(0, 10),
        defaultTo: String(storedMeta.defaultTo || storedProjectDates.at(-1)).slice(0, 10),
        minDate: String(storedMeta.minDate || storedProjectDates[0]).slice(0, 10),
        maxDate: String(storedMeta.maxDate || storedProjectDates.at(-1)).slice(0, 10),
        projectWindowLabel: String(storedMeta.projectWindowLabel || `${storedProjectDates[0]} עד ${storedProjectDates.at(-1)}`),
      },
    };
  }
  const basics = config?.basics && typeof config.basics === "object" ? config.basics : {};
  const startAt = basics.startDate
    ? buildDateTimeIso(basics.startDate, basics.startTime, "")
    : String(campaign.startAt || "");
  const endAt = basics.endDate
    ? buildDateTimeIso(basics.endDate, basics.endTime, "")
    : String(campaign.endAt || "");
  const projectDates = projectDateRange(startAt, endAt);
  if (!projectDates.length) {
    return dataset;
  }
  return {
    ...baseDataset,
    meta: {
      ...(baseDataset.meta || {}),
      projectDates,
      defaultFrom: projectDates[0],
      defaultTo: projectDates[projectDates.length - 1],
      minDate: projectDates[0],
      maxDate: projectDates[projectDates.length - 1],
      projectWindowLabel: `${projectDates[0]} עד ${projectDates[projectDates.length - 1]}`,
    },
  };
}

export async function buildCampaignContext(organizationId, campaignId, { includeOperationalData = true } = {}) {
  let organization;
  let campaign;
  let config;
  let source;
  let dataset;
  if (usesPostgresCampaignStore()) {
    const row = await withPostgresClient(async (client) => {
      const result = await client.query(`
        WITH selected_organization AS (
          SELECT * FROM goodraise.organizations
          WHERE app_id = $1 OR slug = $2
          ORDER BY CASE WHEN app_id = $1 THEN 0 ELSE 1 END, updated_at DESC
          LIMIT 1
        ), selected_campaign AS (
          SELECT c.* FROM goodraise.campaigns c
          JOIN selected_organization o ON o.id = c.organization_id
          WHERE c.app_id = $3 OR c.slug = $4
          ORDER BY CASE WHEN c.app_id = $3 THEN 0 ELSE 1 END, c.updated_at DESC
          LIMIT 1
        )
        SELECT to_jsonb(o) AS organization,
          to_jsonb(c) || jsonb_build_object('organization_app_id', o.app_id, 'organization_slug', o.slug) AS campaign,
          cfg.payload AS config,
          ${includeOperationalData ? "src.payload AS source, ds.payload AS dataset" : "NULL AS source, NULL AS dataset"}
        FROM selected_organization o
        JOIN selected_campaign c ON c.organization_id = o.id
        LEFT JOIN goodraise.campaign_configs cfg ON cfg.campaign_id = c.id
        ${includeOperationalData ? `LEFT JOIN goodraise.campaign_sources src ON src.campaign_id = c.id
        LEFT JOIN goodraise.campaign_datasets ds ON ds.campaign_id = c.id` : ""}
      `, [
        normalizeStableId(organizationId, DEFAULT_PLATFORM_ORGANIZATION_ID),
        normalizeSlug(organizationId, DEFAULT_PLATFORM_ORGANIZATION_SLUG),
        normalizeStableId(campaignId, "campaign"), normalizeSlug(campaignId, "campaign"),
      ]);
      return result.rows[0];
    });
    if (!row) return null;
    organization = mapOrganizationRow(row.organization);
    campaign = mapCampaignRow(row.campaign);
    config = row.config;
    source = row.source ? normalizeSourceConfig(row.source) : null;
    dataset = row.dataset ? createCampaignDatasetRecord(row.dataset, { organizationId, campaignId }) : null;
  } else {
    organization = await getOrganization(organizationId);
    campaign = await getCampaign(organizationId, campaignId);
    if (organization && campaign) {
      [config, source, dataset] = await Promise.all([
        getCampaignConfig(organizationId, campaignId),
        includeOperationalData ? getCampaignSource(organizationId, campaignId) : null,
        includeOperationalData ? getCampaignDataset(organizationId, campaignId) : null,
      ]);
    }
  }
  if (!organization || !campaign) {
    return null;
  }
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
    dataset: applyConfiguredProjectWindow(dataset || createCampaignDatasetRecord({}, { organizationId, campaignId }), config, campaign),
    meta: config?.meta || {},
  };
}

export async function listCampaignSummaries({ auth = null, organizationId = "" } = {}) {
  const canRead = (organization, campaign) =>
    (!organizationId || campaign.organizationId === organizationId)
    && (!auth || authorize(auth, "campaign_view", organization, campaign).ok);
  if (usesPostgresCampaignStore()) {
    return withPostgresClient(async (client) => {
      const identities = await client.query(`
        SELECT c.id::text AS database_id, to_jsonb(o) AS organization,
          to_jsonb(c) || jsonb_build_object('organization_app_id', o.app_id, 'organization_slug', o.slug) AS campaign
        FROM goodraise.campaigns c
        JOIN goodraise.organizations o ON o.id = c.organization_id
        ORDER BY c.updated_at DESC, c.created_at DESC
      `);
      const allowed = identities.rows.map((row) => ({
        databaseId: row.database_id,
        // Match listOrganizations' existing treatment of legacy rows without app_id.
        organization: row.organization.app_id !== null ? mapOrganizationRow(row.organization) : null,
        campaign: mapCampaignRow(row.campaign),
      })).filter((entry) => canRead(entry.organization, entry.campaign));
      if (!allowed.length) return [];

      // Keep the established JavaScript number conversion and summation order.
      // Fetch only amounts and summary metadata, never full donor/config payloads.
      // Restrict this read to authorized IDs before expanding any dataset rows.
      const result = await client.query(`
        SELECT c.id::text AS database_id,
          CASE WHEN ds.payload IS NULL THEN NULL ELSE jsonb_build_object(
            'generatedAt', ds.payload->'generatedAt', 'updatedAt', ds.payload->'updatedAt',
            'rows', COALESCE((SELECT jsonb_agg(jsonb_build_object('amount', item.value->'amount') ORDER BY item.ordinality)
              FROM jsonb_array_elements(CASE WHEN jsonb_typeof(ds.payload->'rows') = 'array'
                THEN ds.payload->'rows' ELSE '[]'::jsonb END) WITH ORDINALITY AS item(value, ordinality)), '[]'::jsonb)
          ) END AS dataset,
          jsonb_build_object('basics', jsonb_build_object('target', cfg.payload #> '{basics,target}')) AS config
        FROM goodraise.campaigns c
        LEFT JOIN goodraise.campaign_datasets ds ON ds.campaign_id = c.id
        LEFT JOIN goodraise.campaign_configs cfg ON cfg.campaign_id = c.id
        WHERE c.id = ANY($1::uuid[])
      `, [allowed.map((entry) => entry.databaseId)]);
      const payloads = new Map(result.rows.map((row) => [row.database_id, row]));
      return allowed.map(({ databaseId, organization, campaign }) => {
        const payload = payloads.get(databaseId);
        return buildCampaignSummary({
          organization, campaign, config: payload?.config,
          dataset: payload?.dataset ? createCampaignDatasetRecord(payload.dataset) : null,
        });
      });
    });
  }
  const organizations = await listOrganizations();
  const organizationMap = new Map(organizations.map((item) => [item.id, item]));
  const campaigns = await listCampaigns();
  const summaries = [];
  for (const campaign of campaigns) {
    const organization = organizationMap.get(campaign.organizationId) || null;
    if (!canRead(organization, campaign)) continue;
    const dataset = await getCampaignDataset(campaign.organizationId, campaign.id);
    const config = await getCampaignConfig(campaign.organizationId, campaign.id);
    summaries.push(
      buildCampaignSummary({
        organization,
        campaign,
        dataset,
        config,
      }),
    );
  }
  return summaries;
}
