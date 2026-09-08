import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  appendAuditEvent,
  ensureMultiTenantMigration,
  getCampaignSource,
  getRuntimeFlag,
  listCampaigns,
  saveCampaignSource,
  saveRuntimeFlag,
} from "./campaign-repositories.mjs";
import { normalizeSourceConfig } from "./multi-tenant-model.mjs";
import { clearCampaignOperationalData, hasConfiguredRelationalIngest } from "./postgres-ingest.mjs";

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const LOCAL_RESET_CONFIG_PATH = resolve(ROOT_DIR, "work", "config", "prelaunch-reset.local.json");

function normalizeBoolean(value, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeDateOnly(value) {
  const normalized = normalizeText(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : "";
}

function readLocalResetConfig() {
  if (!existsSync(LOCAL_RESET_CONFIG_PATH)) {
    return {};
  }
  try {
    const raw = JSON.parse(readFileSync(LOCAL_RESET_CONFIG_PATH, "utf8"));
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

function parseExplicitTarget(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }
  const parts = normalized.split(/[/:]/).map((item) => normalizeText(item)).filter(Boolean);
  if (parts.length < 2) {
    return null;
  }
  return {
    organizationId: parts[0],
    campaignId: parts[1],
  };
}

function parseResetConfig() {
  const localConfig = readLocalResetConfig();
  const explicitTarget =
    parseExplicitTarget(process.env.GOODRAISE_PRELAUNCH_RESET_TARGET) ||
    parseExplicitTarget(localConfig.target);
  const scheduledAt =
    normalizeText(process.env.GOODRAISE_PRELAUNCH_RESET_AT) ||
    normalizeText(localConfig.scheduledAt);
  const targetStartDate =
    normalizeDateOnly(process.env.GOODRAISE_PRELAUNCH_RESET_START_DATE) ||
    normalizeDateOnly(localConfig.targetStartDate) ||
    (scheduledAt ? normalizeDateOnly(scheduledAt.slice(0, 10)) : "");
  return {
    enabled: normalizeBoolean(
      process.env.GOODRAISE_PRELAUNCH_RESET_ENABLED,
      normalizeBoolean(localConfig.enabled, false),
    ),
    scheduledAt,
    ownerEmail:
      normalizeText(process.env.GOODRAISE_PRELAUNCH_RESET_OWNER_EMAIL) ||
      normalizeText(localConfig.ownerEmail),
    explicitTarget,
    targetStartDate,
    onlyLiveCampaigns: normalizeBoolean(
      process.env.GOODRAISE_PRELAUNCH_RESET_ONLY_LIVE,
      normalizeBoolean(localConfig.onlyLiveCampaigns, true),
    ),
  };
}

export function selectPrelaunchResetCandidates(config, campaigns) {
  const items = Array.isArray(campaigns) ? campaigns : [];
  if (config?.explicitTarget?.organizationId && config?.explicitTarget?.campaignId) {
    return items.filter(
      (campaign) =>
        String(campaign.organizationId || "").trim().toLowerCase() ===
          String(config.explicitTarget.organizationId || "").trim().toLowerCase() &&
        String(campaign.id || "").trim().toLowerCase() ===
          String(config.explicitTarget.campaignId || "").trim().toLowerCase(),
    );
  }
  return items.filter((campaign) => {
    if (config?.onlyLiveCampaigns && String(campaign.status || "").trim().toLowerCase() !== "live") {
      return false;
    }
    const startDate = normalizeDateOnly(String(campaign.startAt || "").slice(0, 10));
    return Boolean(config?.targetStartDate) && startDate === config.targetStartDate;
  });
}

async function resetSourceSyncState(campaign) {
  const current = await getCampaignSource(campaign.organizationId, campaign.id);
  const normalized = normalizeSourceConfig(current);
  const nextConfig = normalizeSourceConfig(
    {
      ...normalized,
      googleSheets: {
        ...(normalized.googleSheets || {}),
        lastSyncedAt: "",
        lastSuccessfulSyncAt: "",
        lastChecksum: "",
        lastRowCount: 0,
        lastStatus: "idle",
        lastMessage: "Prelaunch reset completed before go-live.",
        lastSourceLabel: "",
      },
    },
    normalized,
  );
  await saveCampaignSource(campaign.organizationId, campaign.id, nextConfig, "scheduled-prelaunch-reset");
  return nextConfig;
}

function buildMarkerId(config, campaign) {
  return [
    normalizeText(config.scheduledAt),
    normalizeText(campaign.organizationId),
    normalizeText(campaign.id),
  ].join("|");
}

export async function runScheduledPrelaunchReset({
  now = new Date(),
  triggeredBy = "scheduled-prelaunch-reset",
} = {}) {
  await ensureMultiTenantMigration();
  const config = parseResetConfig();
  const summary = {
    ok: true,
    enabled: config.enabled,
    scheduledAt: config.scheduledAt,
    ownerEmail: config.ownerEmail,
    triggeredBy,
    status: "idle",
    targetCount: 0,
    resetCount: 0,
    skippedReason: "",
    results: [],
  };

  if (!config.enabled) {
    summary.status = "skipped";
    summary.skippedReason = "disabled";
    return summary;
  }
  if (!config.scheduledAt) {
    summary.status = "skipped";
    summary.skippedReason = "missing_schedule";
    return summary;
  }
  const scheduledAtDate = new Date(config.scheduledAt);
  if (Number.isNaN(scheduledAtDate.getTime())) {
    summary.status = "skipped";
    summary.skippedReason = "invalid_schedule";
    return summary;
  }
  if (now.getTime() < scheduledAtDate.getTime()) {
    summary.status = "skipped";
    summary.skippedReason = "not_due_yet";
    return summary;
  }

  const campaigns = await listCampaigns();
  const candidates = selectPrelaunchResetCandidates(config, campaigns);
  summary.targetCount = candidates.length;

  if (!candidates.length) {
    summary.status = "skipped";
    summary.skippedReason = "no_matching_campaign";
    return summary;
  }

  if (!config.explicitTarget && candidates.length > 1) {
    summary.status = "skipped";
    summary.skippedReason = "ambiguous_target";
    summary.results = candidates.map((campaign) => ({
      organizationId: campaign.organizationId,
      campaignId: campaign.id,
      status: "ambiguous_candidate",
    }));
    return summary;
  }

  for (const campaign of candidates) {
    const markerId = buildMarkerId(config, campaign);
    const existingMarker = await getRuntimeFlag("prelaunch-reset", markerId);
    if (existingMarker?.completedAt) {
      summary.results.push({
        organizationId: campaign.organizationId,
        campaignId: campaign.id,
        status: "already_reset",
        completedAt: existingMarker.completedAt,
      });
      continue;
    }

    if (!hasConfiguredRelationalIngest()) {
      summary.results.push({
        organizationId: campaign.organizationId,
        campaignId: campaign.id,
        status: "skipped_no_database",
      });
      continue;
    }

    const resetResult = await clearCampaignOperationalData({
      organizationIdentifier: campaign.organizationId,
      campaignIdentifier: campaign.id,
      resetSourceLabel: "מאופס לפני עלייה לאוויר",
      clearedBy: triggeredBy,
    });
    await resetSourceSyncState(campaign);
    const marker = await saveRuntimeFlag("prelaunch-reset", markerId, {
      completedAt: resetResult.clearedAt,
      ownerEmail: config.ownerEmail,
      organizationId: campaign.organizationId,
      campaignId: campaign.id,
      scheduledAt: config.scheduledAt,
      triggeredBy,
      result: resetResult,
    });
    await appendAuditEvent({
      user: config.ownerEmail || "",
      role: "platform_admin",
      organizationId: campaign.organizationId,
      campaignId: campaign.id,
      action: "prelaunch_reset",
      outcome: "success",
      detail: {
        scheduledAt: config.scheduledAt,
        completedAt: marker.completedAt,
        countsBefore: resetResult.countsBefore,
      },
    });
    summary.resetCount += 1;
    summary.results.push({
      organizationId: campaign.organizationId,
      campaignId: campaign.id,
      status: "reset",
      completedAt: marker.completedAt,
      countsBefore: resetResult.countsBefore,
    });
  }

  summary.status = summary.resetCount > 0 ? "completed" : "skipped";
  if (!summary.resetCount && !summary.skippedReason) {
    summary.skippedReason = "already_completed";
  }
  return summary;
}
