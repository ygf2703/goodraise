import { randomBytes } from "node:crypto";

export const ROLE_PLATFORM_ADMIN = "platform_admin";
export const ROLE_ORGANIZATION_ADMIN = "organization_admin";
export const ROLE_CAMPAIGN_MANAGER = "campaign_manager";
export const ROLE_ANALYST = "analyst";
export const ROLE_VIEWER = "viewer";

export const KNOWN_ROLES = new Set([
  ROLE_PLATFORM_ADMIN,
  ROLE_ORGANIZATION_ADMIN,
  ROLE_CAMPAIGN_MANAGER,
  ROLE_ANALYST,
  ROLE_VIEWER,
]);

export const ROLE_ORDER = {
  [ROLE_VIEWER]: 1,
  [ROLE_ANALYST]: 2,
  [ROLE_CAMPAIGN_MANAGER]: 3,
  [ROLE_ORGANIZATION_ADMIN]: 4,
  [ROLE_PLATFORM_ADMIN]: 5,
};

export const DEFAULT_PLATFORM_ORGANIZATION_ID = "default-org";
export const DEFAULT_PLATFORM_ORGANIZATION_SLUG = "default-org";

export function isoNow() {
  return new Date().toISOString();
}

export function cloneJson(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

export function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

export function normalizeSlug(value, fallback = "") {
  const cleaned = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || fallback;
}

export function normalizeStableId(value, fallback = "") {
  const cleaned = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "");
  return cleaned || fallback;
}

export function normalizeRole(value, fallback = ROLE_PLATFORM_ADMIN) {
  const candidate = String(value || "").trim().toLowerCase();
  return KNOWN_ROLES.has(candidate) ? candidate : fallback;
}

export function normalizeCampaignScope(values) {
  if (Array.isArray(values)) {
    return values.map((value) => normalizeStableId(value)).filter(Boolean);
  }
  if (typeof values === "string" && values.trim()) {
    return values
      .split(",")
      .map((value) => normalizeStableId(value))
      .filter(Boolean);
  }
  return [];
}

export function normalizeTimestamp(value, fallback = "") {
  const candidate = String(value || "").trim();
  return candidate || fallback;
}

export function buildDateTimeIso(dateValue, timeValue, fallback = "") {
  const dateText = String(dateValue || "").trim();
  if (!dateText) {
    return fallback;
  }
  const timeText = String(timeValue || "").trim() || "00:00";
  const candidate = `${dateText}T${timeText}:00`;
  return Number.isFinite(Date.parse(candidate)) ? candidate : fallback;
}

export function createOrganizationRecord(value = {}, fallback = {}) {
  const fallbackName = String(fallback.name || "Default Organization").trim() || "Default Organization";
  const name = String(value.name || fallback.name || fallbackName).trim() || fallbackName;
  const slug = normalizeSlug(value.slug || fallback.slug || name, DEFAULT_PLATFORM_ORGANIZATION_SLUG);
  const id = normalizeStableId(value.id || fallback.id || slug, DEFAULT_PLATFORM_ORGANIZATION_ID);
  const createdAt = normalizeTimestamp(value.createdAt || fallback.createdAt, isoNow());
  const updatedAt = normalizeTimestamp(value.updatedAt || fallback.updatedAt, createdAt);
  return {
    id,
    slug,
    name,
    status: String(value.status || fallback.status || "active").trim().toLowerCase() || "active",
    createdAt,
    updatedAt,
  };
}

export function createCampaignRecord(value = {}, organization = null, fallback = {}) {
  const organizationId = normalizeStableId(
    value.organizationId || fallback.organizationId || organization?.id,
    DEFAULT_PLATFORM_ORGANIZATION_ID,
  );
  const fallbackName = String(fallback.name || "Campaign").trim() || "Campaign";
  const name = String(value.name || fallback.name || fallbackName).trim() || fallbackName;
  const slug = normalizeSlug(value.slug || fallback.slug || name, "campaign");
  const id = normalizeStableId(value.id || fallback.id || slug, slug || "campaign");
  const createdAt = normalizeTimestamp(value.createdAt || fallback.createdAt, isoNow());
  const updatedAt = normalizeTimestamp(value.updatedAt || fallback.updatedAt, createdAt);
  return {
    id,
    organizationId,
    slug,
    name,
    status: String(value.status || fallback.status || "draft").trim().toLowerCase() || "draft",
    startAt: normalizeTimestamp(value.startAt || fallback.startAt, ""),
    endAt: normalizeTimestamp(value.endAt || fallback.endAt, ""),
    target: Number(value.target ?? fallback.target ?? 0) || 0,
    currency: String(value.currency || fallback.currency || "ILS").trim().toUpperCase() || "ILS",
    createdAt,
    updatedAt,
  };
}

export function createAuditRecord(value = {}) {
  return {
    id: `${Date.now()}-${randomBytes(6).toString("hex")}`,
    timestamp: isoNow(),
    user: normalizeEmail(value.user || ""),
    role: normalizeRole(value.role, ROLE_VIEWER),
    organizationId: normalizeStableId(value.organizationId || ""),
    campaignId: normalizeStableId(value.campaignId || ""),
    action: String(value.action || "").trim() || "unknown_action",
    outcome: String(value.outcome || "success").trim().toLowerCase() || "success",
    detail: value.detail && typeof value.detail === "object" ? cloneJson(value.detail) : {},
  };
}

export function getDefaultSourceFieldMap() {
  return {
    id: "id",
    created_at: "created_at",
    full_name: "full_name",
    email: "email",
    "Ambassador name": "Ambassador name",
    total: "total",
    city: "city",
    charged_success: "charged_success",
    charge_result: "charge_result",
  };
}

function normalizePositiveInteger(value, fallback) {
  const numeric = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : fallback;
}

function normalizeMultilineText(value) {
  return String(value || "").replace(/\r\n/g, "\n").trim();
}

function normalizeFieldMapText(value) {
  const text = String(value || "").trim();
  if (!text) {
    return JSON.stringify(getDefaultSourceFieldMap(), null, 2);
  }

  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return JSON.stringify(parsed, null, 2);
    }
  } catch {}

  return JSON.stringify(getDefaultSourceFieldMap(), null, 2);
}

export function defaultSourceConfig() {
  return {
    mode: "file",
    api: {
      endpoint: "",
      method: "GET",
      responseFormat: "csv",
      recordsPath: "",
      authType: "none",
      bearerToken: "",
      hasBearerToken: false,
      autoRefreshMinutes: 5,
      headersText: "",
      bodyText: "",
      fieldMapText: JSON.stringify(getDefaultSourceFieldMap(), null, 2),
    },
  };
}

export function normalizeSourceConfig(rawConfig, existingConfig = null) {
  const defaults = defaultSourceConfig();
  const candidate = rawConfig && typeof rawConfig === "object" ? rawConfig : {};
  const existingApi = existingConfig?.api && typeof existingConfig.api === "object" ? existingConfig.api : defaults.api;
  const apiCandidate = candidate.api && typeof candidate.api === "object" ? candidate.api : {};
  const incomingToken = String(apiCandidate.bearerToken || "").trim();
  const clearBearerToken = Boolean(apiCandidate.clearBearerToken);
  const preservedToken = clearBearerToken ? "" : incomingToken || String(existingApi.bearerToken || "").trim();
  return {
    mode: candidate.mode === "api" ? "api" : "file",
    api: {
      endpoint: String(apiCandidate.endpoint || "").trim(),
      method: String(apiCandidate.method || defaults.api.method).trim().toUpperCase() === "POST" ? "POST" : "GET",
      responseFormat: String(apiCandidate.responseFormat || defaults.api.responseFormat).trim().toLowerCase() === "json" ? "json" : "csv",
      recordsPath: String(apiCandidate.recordsPath || "").trim(),
      authType: String(apiCandidate.authType || defaults.api.authType).trim().toLowerCase() === "bearer" ? "bearer" : "none",
      bearerToken: preservedToken,
      hasBearerToken: Boolean(preservedToken),
      autoRefreshMinutes: normalizePositiveInteger(apiCandidate.autoRefreshMinutes, defaults.api.autoRefreshMinutes),
      headersText: normalizeMultilineText(apiCandidate.headersText),
      bodyText: normalizeMultilineText(apiCandidate.bodyText),
      fieldMapText: normalizeFieldMapText(apiCandidate.fieldMapText),
    },
  };
}

export function redactSourceConfig(config) {
  const normalized = normalizeSourceConfig(config);
  return {
    ...normalized,
    api: {
      ...normalized.api,
      bearerToken: "",
      hasBearerToken: Boolean(normalized.api.hasBearerToken),
    },
  };
}

export function createCampaignDatasetRecord(value = {}, scope = {}) {
  const rows = Array.isArray(value.rows) ? cloneJson(value.rows) : [];
  const meta = value.meta && typeof value.meta === "object" ? cloneJson(value.meta) : {};
  return {
    organizationId: normalizeStableId(value.organizationId || scope.organizationId, DEFAULT_PLATFORM_ORGANIZATION_ID),
    campaignId: normalizeStableId(value.campaignId || scope.campaignId, "campaign"),
    rows,
    meta,
    sourceLabel: String(value.sourceLabel || "").trim(),
    generatedAt: normalizeTimestamp(value.generatedAt, isoNow()),
    updatedAt: normalizeTimestamp(value.updatedAt, isoNow()),
    recordCount: rows.length,
  };
}

export function buildCampaignSummary({ organization, campaign, dataset, config }) {
  const rows = Array.isArray(dataset?.rows) ? dataset.rows : [];
  const totalRaised = rows.reduce((sum, row) => sum + Number(row?.amount || 0), 0);
  const target = Number(campaign?.target || config?.basics?.target || 0);
  const targetPercent = target > 0 ? Number(((totalRaised / target) * 100).toFixed(2)) : 0;
  const latestUpdate = dataset?.generatedAt || dataset?.updatedAt || campaign?.updatedAt || "";
  return {
    organizationId: organization?.id || campaign?.organizationId || "",
    organizationSlug: organization?.slug || "",
    organizationName: organization?.name || "",
    campaignId: campaign?.id || "",
    campaignName: campaign?.name || "",
    campaignSlug: campaign?.slug || "",
    status: campaign?.status || "draft",
    target,
    currency: campaign?.currency || "ILS",
    raised: totalRaised,
    targetPercent,
    lastUpdated: latestUpdate,
    startAt: campaign?.startAt || "",
    endAt: campaign?.endAt || "",
    rowCount: rows.length,
  };
}
