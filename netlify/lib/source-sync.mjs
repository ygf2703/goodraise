import { jsonResponse, resolveScopedAccess } from "./auth-store.mjs";
import { normalizeSourceConfig } from "./multi-tenant-model.mjs";
import {
  appendAuditEvent,
  ensureMultiTenantMigration,
  getCampaignSource,
  listCampaigns,
  saveCampaignDataset,
  saveCampaignSource,
} from "./campaign-repositories.mjs";
import { fetchConfiguredSource } from "./source-store.mjs";
import { hasConfiguredRelationalIngest, ingestCampaignRecords } from "./postgres-ingest.mjs";

function normalizeGoogleSheetsSyncState(config, patch = {}) {
  return normalizeSourceConfig(
    {
      ...config,
      googleSheets: {
        ...(config?.googleSheets || {}),
        ...patch,
      },
    },
    config,
  );
}

async function persistGoogleSheetsSyncState(organizationId, campaignId, config, patch = {}, updatedBy = "") {
  const nextConfig = normalizeGoogleSheetsSyncState(config, patch);
  await saveCampaignSource(organizationId, campaignId, nextConfig, updatedBy);
  return nextConfig;
}

function isGoogleSheetsSyncEnabled(config) {
  return config?.mode === "google_sheets" && config?.googleSheets?.syncEnabled !== false;
}

export async function syncCampaignSourceOnce({
  organizationId,
  campaignId,
  updatedBy = "",
  triggeredBy = "manual",
  force = false,
}) {
  await ensureMultiTenantMigration();
  const sourceConfig = await getCampaignSource(organizationId, campaignId);
  const normalized = normalizeSourceConfig(sourceConfig);
  if (normalized.mode === "file") {
    return {
      ok: false,
      skipped: true,
      reason: "file_mode",
      message: "מקור הנתונים הפעיל הוא קובץ ידני.",
    };
  }

  const fetched = await fetchConfiguredSource(normalized);

  if (
    normalized.mode === "google_sheets" &&
    !force &&
    String(normalized.googleSheets.lastChecksum || "").trim() &&
    String(normalized.googleSheets.lastChecksum || "").trim() === String(fetched.contentHash || "").trim()
  ) {
    await persistGoogleSheetsSyncState(
      organizationId,
      campaignId,
      normalized,
      {
        lastSyncedAt: fetched.fetchedAt,
        lastStatus: "unchanged",
        lastMessage: "לא זוהה שינוי חדש ב-Google Sheets.",
        lastSourceLabel: fetched.sourceLabel,
      },
      updatedBy,
    );
    return {
      ok: true,
      skipped: true,
      unchanged: true,
      sourceLabel: fetched.sourceLabel,
      fetchedAt: fetched.fetchedAt,
      rowCount: fetched.rows.length,
      message: "לא זוהה שינוי חדש ב-Google Sheets.",
    };
  }

  let syncResult = null;
  if (normalized.mode === "google_sheets" && hasConfiguredRelationalIngest()) {
    syncResult = await ingestCampaignRecords({
      organizationIdentifier: organizationId,
      campaignIdentifier: campaignId,
      sourceLabel: fetched.sourceLabel,
      importedBy: triggeredBy,
      requestReference: `${triggeredBy}:${fetched.fetchedAt}`,
      records: fetched.rawRows,
    });
  } else {
    await saveCampaignDataset(organizationId, campaignId, {
      organizationId,
      campaignId,
      rows: fetched.rows,
      meta: fetched.meta,
      sourceLabel: fetched.sourceLabel,
      generatedAt: fetched.fetchedAt,
      updatedAt: fetched.fetchedAt,
    });
    syncResult = {
      dataset: {
        rowCount: fetched.rows.length,
        sourceLabel: fetched.sourceLabel,
      },
      processedCount: fetched.rawRows.length,
    };
  }

  if (normalized.mode === "google_sheets") {
    await persistGoogleSheetsSyncState(
      organizationId,
      campaignId,
      normalized,
      {
        lastSyncedAt: fetched.fetchedAt,
        lastSuccessfulSyncAt: fetched.fetchedAt,
        lastChecksum: fetched.contentHash,
        lastRowCount: fetched.rows.length,
        lastStatus: "success",
        lastMessage: `סונכרנו ${fetched.rows.length} רשומות מ-Google Sheets.`,
        lastSourceLabel: fetched.sourceLabel,
      },
      updatedBy,
    );
  }

  return {
    ok: true,
    mode: normalized.mode,
    organizationId,
    campaignId,
    sourceLabel: fetched.sourceLabel,
    fetchedAt: fetched.fetchedAt,
    rowCount: fetched.rows.length,
    processedCount: syncResult?.processedCount ?? fetched.rawRows.length,
    dataset: syncResult?.dataset || {
      rowCount: fetched.rows.length,
      sourceLabel: fetched.sourceLabel,
    },
    message:
      normalized.mode === "google_sheets"
        ? `סונכרנו ${fetched.rows.length} רשומות מ-Google Sheets.`
        : "הנתונים נמשכו ונשמרו בהצלחה ממערכת המקור.",
  };
}

export async function refreshAdminSource(request, scope = {}) {
  await ensureMultiTenantMigration();
  const access = await resolveScopedAccess(request, {
    action: "source_refresh",
    organizationId: scope.organizationId,
    campaignId: scope.campaignId,
    unauthorizedMessage: "נדרשת התחברות מנהל כדי למשוך נתונים ממערכת המקור.",
  });
  if (access.error) {
    return access.error;
  }

  try {
    const result = await syncCampaignSourceOnce({
      organizationId: access.organization.id,
      campaignId: access.campaign.id,
      updatedBy: access.auth.email,
      triggeredBy: "manager-refresh",
      force: true,
    });
    await appendAuditEvent({
      user: access.auth.email,
      role: access.auth.role,
      organizationId: access.organization.id,
      campaignId: access.campaign.id,
      action: "source_refresh",
      outcome: "success",
      detail: {
        mode: result.mode || "unknown",
        processedCount: result.processedCount || 0,
      },
    });
    return jsonResponse(200, {
      ok: true,
      organizationId: access.organization.id,
      campaignId: access.campaign.id,
      sourceLabel: result.sourceLabel,
      fetchedAt: result.fetchedAt,
      rows: [],
      meta: {},
      dataset: result.dataset,
      rowCount: result.rowCount || 0,
      processedCount: result.processedCount || 0,
      message: result.message,
    });
  } catch (error) {
    const config = await getCampaignSource(access.organization.id, access.campaign.id);
    if (config?.mode === "google_sheets") {
      await persistGoogleSheetsSyncState(
        access.organization.id,
        access.campaign.id,
        config,
        {
          lastSyncedAt: new Date().toISOString(),
          lastStatus: "error",
          lastMessage: error instanceof Error ? error.message : "google_sheets_sync_failed",
        },
        access.auth.email,
      );
    }
    await appendAuditEvent({
      user: access.auth.email,
      role: access.auth.role,
      organizationId: access.organization.id,
      campaignId: access.campaign.id,
      action: "source_refresh",
      outcome: "error",
      detail: { message: error instanceof Error ? error.message : "refresh_failed" },
    });
    return jsonResponse(502, {
      message: error instanceof Error ? error.message : "משיכת הנתונים ממערכת המקור נכשלה.",
    });
  }
}

export async function runScheduledGoogleSheetsSync({ triggeredBy = "scheduled-google-sheets-sync" } = {}) {
  await ensureMultiTenantMigration();
  const campaigns = await listCampaigns();
  const summary = {
    ok: true,
    triggeredBy,
    processedCampaigns: 0,
    skippedCampaigns: 0,
    syncedCampaigns: 0,
    errors: [],
  };

  for (const campaign of campaigns) {
    const sourceConfig = await getCampaignSource(campaign.organizationId, campaign.id);
    const normalized = normalizeSourceConfig(sourceConfig);
    if (!isGoogleSheetsSyncEnabled(normalized)) {
      summary.skippedCampaigns += 1;
      continue;
    }
    summary.processedCampaigns += 1;
    try {
      const result = await syncCampaignSourceOnce({
        organizationId: campaign.organizationId,
        campaignId: campaign.id,
        updatedBy: "",
        triggeredBy,
        force: false,
      });
      if (!result.skipped) {
        summary.syncedCampaigns += 1;
      }
      await appendAuditEvent({
        user: "",
        role: "platform_admin",
        organizationId: campaign.organizationId,
        campaignId: campaign.id,
        action: "scheduled_google_sheets_sync",
        outcome: "success",
        detail: {
          skipped: Boolean(result.skipped),
          unchanged: Boolean(result.unchanged),
          rowCount: result.rowCount || 0,
        },
      });
    } catch (error) {
      summary.errors.push({
        organizationId: campaign.organizationId,
        campaignId: campaign.id,
        message: error instanceof Error ? error.message : "scheduled_sync_failed",
      });
      await appendAuditEvent({
        user: "",
        role: "platform_admin",
        organizationId: campaign.organizationId,
        campaignId: campaign.id,
        action: "scheduled_google_sheets_sync",
        outcome: "error",
        detail: {
          message: error instanceof Error ? error.message : "scheduled_sync_failed",
        },
      });
    }
  }

  if (summary.errors.length) {
    summary.ok = false;
  }
  return summary;
}
