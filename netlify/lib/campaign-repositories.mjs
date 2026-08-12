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

export async function appendAuditEvent(event) {
  const store = getStore();
  const record = createAuditRecord(event);
  await store.setJSON(auditKey(), record);
  return record;
}

export async function listOrganizations() {
  const store = getStore();
  const items = await store.listJSON("organization:");
  return items.map((item) => createOrganizationRecord(item.value));
}

export async function getOrganization(organizationId) {
  const store = getStore();
  const value = await store.getJSON(organizationKey(organizationId));
  return value ? createOrganizationRecord(value) : null;
}

export async function saveOrganization(record) {
  const store = getStore();
  const normalized = createOrganizationRecord(record);
  await store.setJSON(organizationKey(normalized.id), normalized);
  return normalized;
}

export async function listCampaigns(organizationId = "") {
  const store = getStore();
  const prefix = organizationId ? `campaign:${organizationId}:` : "campaign:";
  const items = await store.listJSON(prefix);
  return items.map((item) => createCampaignRecord(item.value));
}

export async function getCampaign(organizationId, campaignId) {
  const store = getStore();
  const value = await store.getJSON(campaignKey(organizationId, campaignId));
  return value ? createCampaignRecord(value) : null;
}

export async function saveCampaign(record) {
  const store = getStore();
  const organization = await getOrganization(record.organizationId);
  const normalized = createCampaignRecord(record, organization || createOrganizationRecord({ id: record.organizationId }));
  await store.setJSON(campaignKey(normalized.organizationId, normalized.id), normalized);
  return normalized;
}

export async function getCampaignConfig(organizationId, campaignId) {
  const store = getStore();
  return (await store.getJSON(campaignConfigKey(organizationId, campaignId))) || null;
}

export async function saveCampaignConfig(organizationId, campaignId, config, updatedBy = "") {
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

export async function getCampaignSource(organizationId, campaignId) {
  const store = getStore();
  const value = await store.getJSON(campaignSourceKey(organizationId, campaignId));
  return value ? normalizeSourceConfig(value) : normalizeSourceConfig(defaultSourceConfig());
}

export async function saveCampaignSource(organizationId, campaignId, sourceConfig) {
  const store = getStore();
  const existing = await getCampaignSource(organizationId, campaignId);
  const normalized = normalizeSourceConfig(sourceConfig, existing);
  await store.setJSON(campaignSourceKey(organizationId, campaignId), normalized);
  return normalized;
}

export async function getCampaignDataset(organizationId, campaignId) {
  const store = getStore();
  const value = await store.getJSON(campaignDatasetKey(organizationId, campaignId));
  return value ? createCampaignDatasetRecord(value, { organizationId, campaignId }) : null;
}

export async function saveCampaignDataset(organizationId, campaignId, dataset) {
  const store = getStore();
  const normalized = createCampaignDatasetRecord(dataset, { organizationId, campaignId });
  await store.setJSON(campaignDatasetKey(organizationId, campaignId), normalized);
  return normalized;
}

export async function listCampaignDatasets(organizationId = "") {
  const store = getStore();
  const prefix = organizationId ? `campaign-dataset:${organizationId}:` : "campaign-dataset:";
  const items = await store.listJSON(prefix);
  return items.map((item) => createCampaignDatasetRecord(item.value));
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
    await store.setJSON(organizationKey(entry.organization.id), entry.organization);
    await store.setJSON(campaignKey(entry.organization.id, entry.campaign.id), entry.campaign);
    await store.setJSON(campaignConfigKey(entry.organization.id, entry.campaign.id), entry.config);
    await store.setJSON(
      campaignSourceKey(entry.organization.id, entry.campaign.id),
      normalizeSourceConfig(legacySource || defaultSourceConfig()),
    );
    if (legacyDataset) {
      await store.setJSON(
        campaignDatasetKey(entry.organization.id, entry.campaign.id),
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
