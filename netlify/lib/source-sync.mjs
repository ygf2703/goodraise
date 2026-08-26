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
import { fetchConfiguredSource, mapSourceRecordsToCanonicalFields } from "./source-store.mjs";
import {
  getCampaignLedgerSummary,
  getDonationRecordValidationError,
  hasConfiguredRelationalIngest,
  ingestCampaignRecords,
  isChargedSuccess,
  markCampaignDatasetSnapshotFresh,
  normalizeExternalRecord,
} from "./postgres-ingest.mjs";

// Bump this only when accepted source formats change. It makes a previously
// rejected but unchanged sheet eligible for one safe re-processing pass.
const GOOGLE_SHEETS_NORMALIZER_VERSION = "2026-08-26-payment-status-discovery-v8";

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

export function buildResolvedGoogleSheetsConfigPatch(config, fetched = {}) {
  if (config?.mode !== "google_sheets") {
    return {};
  }
  const current = config.googleSheets || {};
  const sheetName = String(fetched.resolvedSheetName || current.sheetName || "").trim();
  const range = String(fetched.resolvedRange || current.range || (sheetName ? `${sheetName}!A:ZZ` : "")).trim();
  return {
    ...(sheetName ? { sheetName } : {}),
    ...(range ? { range } : {}),
  };
}

function getDetectedSourceColumns(rows) {
  const columnNames = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    for (const key of Object.keys(row || {})) {
      const label = String(key || "").trim();
      if (label) columnNames.add(label);
      if (columnNames.size >= 32) return [...columnNames];
    }
  }
  return [...columnNames];
}

function parseSourceAmount(value) {
  const raw = String(value ?? "")
    .trim()
    .replace(/[\s\u00A0]/g, "")
    .replace(/[^0-9,.-]/g, "")
    .replace(/,/g, "");
  const amount = Number(raw);
  return Number.isFinite(amount) ? amount : 0;
}

export function summarizeGoogleSheetsRecords(rawRows = []) {
  const keys = new Set();
  let total = 0;
  let invalidRows = 0;
  let unchargedRows = 0;
  for (const rawRow of Array.isArray(rawRows) ? rawRows : []) {
    const record = normalizeExternalRecord(rawRow || {});
    if (getDonationRecordValidationError(record)) {
      invalidRows += 1;
      continue;
    }
    if (!isChargedSuccess(record.charged_success)) {
      unchargedRows += 1;
      continue;
    }
    const key = String(record.id || `${record.created_at}|${record.total}|${record.email}|${record.full_name}`).trim();
    if (keys.has(key)) continue;
    keys.add(key);
    total += parseSourceAmount(record.total);
  }
  return { rowCount: keys.size, total: Number(total.toFixed(2)), invalidRows, unchargedRows };
}

function buildLedgerReconciliation(source, ledger) {
  const delta = Number((source.total - ledger.sourceTotal).toFixed(2));
  return {
    sourceRowCount: source.rowCount,
    sourceTotal: source.total,
    ledgerRowCount: ledger.sourceRowCount,
    ledgerTotal: Number(ledger.sourceTotal.toFixed(2)),
    delta,
    matches: source.rowCount === ledger.sourceRowCount && Math.abs(delta) < 0.01,
  };
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
  const mappedSourceRows = mapSourceRecordsToCanonicalFields(fetched.rawRows, normalized);
  const detectedColumns = getDetectedSourceColumns(fetched.rawRows);
  const resolvedGoogleSheetsConfig = buildResolvedGoogleSheetsConfigPatch(normalized, fetched);
  const sourceSummary = normalized.mode === "google_sheets" ? summarizeGoogleSheetsRecords(mappedSourceRows) : null;
  const existingLedger =
    normalized.mode === "google_sheets" && hasConfiguredRelationalIngest()
      ? await getCampaignLedgerSummary({ organizationIdentifier: organizationId, campaignIdentifier: campaignId })
      : null;
  const existingReconciliation = sourceSummary && existingLedger ? buildLedgerReconciliation(sourceSummary, existingLedger) : null;

  if (
    normalized.mode === "google_sheets" &&
    !force &&
    String(normalized.googleSheets.lastChecksum || "").trim() &&
    String(normalized.googleSheets.lastChecksum || "").trim() === String(fetched.contentHash || "").trim() &&
    String(normalized.googleSheets.lastNormalizerVersion || "").trim() === GOOGLE_SHEETS_NORMALIZER_VERSION &&
    existingReconciliation?.matches
  ) {
    if (hasConfiguredRelationalIngest()) {
      await markCampaignDatasetSnapshotFresh({
        organizationIdentifier: organizationId,
        campaignIdentifier: campaignId,
        sourceLabel: fetched.sourceLabel,
        fetchedAt: fetched.fetchedAt,
      });
    }
    await persistGoogleSheetsSyncState(
      organizationId,
      campaignId,
      normalized,
      {
        ...resolvedGoogleSheetsConfig,
        lastSyncedAt: fetched.fetchedAt,
        lastStatus: "unchanged",
        lastMessage: `לא זוהה שינוי חדש ב-Google Sheets. ${existingReconciliation.sourceRowCount} רשומות, ₪${existingReconciliation.sourceTotal.toLocaleString("he-IL")}.`,
        lastSourceLabel: fetched.sourceLabel,
        lastRowCount: existingReconciliation.sourceRowCount,
        lastSourceTotal: existingReconciliation.sourceTotal,
        lastLedgerTotal: existingReconciliation.ledgerTotal,
        lastReconciliationDelta: existingReconciliation.delta,
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
      fetchedAt: fetched.fetchedAt,
      records: mappedSourceRows,
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

  if (syncResult?.skipped && syncResult?.reason === "sync_in_progress") {
    return {
      ok: true,
      skipped: true,
      reason: "sync_in_progress",
      sourceLabel: fetched.sourceLabel,
      fetchedAt: fetched.fetchedAt,
      rowCount: syncResult?.dataset?.rowCount || 0,
      message: "סנכרון אחר של אותו קמפיין כבר מתבצע.",
    };
  }

  const ledger =
    normalized.mode === "google_sheets" && hasConfiguredRelationalIngest()
      ? await getCampaignLedgerSummary({ organizationIdentifier: organizationId, campaignIdentifier: campaignId })
      : null;
  const reconciliation = sourceSummary && ledger ? buildLedgerReconciliation(sourceSummary, ledger) : null;
  if (reconciliation && !reconciliation.matches) {
    throw new Error(
      `פער התאמה מול Google Sheets: מקור ${reconciliation.sourceRowCount} רשומות / ₪${reconciliation.sourceTotal.toLocaleString("he-IL")}, לדג'ר ${reconciliation.ledgerRowCount} רשומות / ₪${reconciliation.ledgerTotal.toLocaleString("he-IL")}.`,
    );
  }

  if (normalized.mode === "google_sheets") {
    await persistGoogleSheetsSyncState(
      organizationId,
      campaignId,
      normalized,
      {
        ...resolvedGoogleSheetsConfig,
        lastSyncedAt: fetched.fetchedAt,
        lastSuccessfulSyncAt: fetched.fetchedAt,
        lastChecksum: fetched.contentHash,
        lastNormalizerVersion: GOOGLE_SHEETS_NORMALIZER_VERSION,
        // This is the source row count. The dashboard snapshot can also include
        // manual matches, so it must not be presented as a Sheets row count.
        lastRowCount: reconciliation?.sourceRowCount ?? fetched.rows.length,
        lastSourceTotal: reconciliation?.sourceTotal ?? 0,
        lastLedgerTotal: reconciliation?.ledgerTotal ?? 0,
        lastReconciliationDelta: reconciliation?.delta ?? 0,
        lastStatus: "success",
        lastMessage: syncResult?.skippedInvalidRows
          ? `סונכרנו ${syncResult.processedCount} תרומות מ-Google Sheets. ${syncResult.skippedInvalidRows} שורות ללא תאריך או סכום נדחו.${detectedColumns.length ? ` עמודות שזוהו: ${detectedColumns.join(", ")}.` : ""}`
          : `הסנכרון אומת: ${reconciliation?.sourceRowCount ?? fetched.rows.length} רשומות Google Sheets, ₪${(reconciliation?.sourceTotal ?? 0).toLocaleString("he-IL")}.`,
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
    rowCount: syncResult?.dataset?.rowCount ?? fetched.rows.length,
    processedCount: syncResult?.processedCount ?? fetched.rawRows.length,
    skippedInvalidRows: syncResult?.skippedInvalidRows ?? 0,
    reconciliation,
    detectedColumns,
    dataset: syncResult?.dataset || {
      rowCount: fetched.rows.length,
      sourceLabel: fetched.sourceLabel,
    },
    message:
      normalized.mode === "google_sheets"
        ? syncResult?.skippedInvalidRows
          ? `סונכרנו ${syncResult.processedCount} תרומות מ-Google Sheets. ${syncResult.skippedInvalidRows} שורות ללא תאריך או סכום נדחו.${detectedColumns.length ? ` עמודות שזוהו: ${detectedColumns.join(", ")}.` : ""}`
          : `סונכרנו ${syncResult?.processedCount ?? fetched.rows.length} רשומות מ-Google Sheets.`
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
      // Scheduled functions have no browser response. Persist the failure on the
      // campaign itself so a manager can immediately see why data is stale.
      await persistGoogleSheetsSyncState(
        campaign.organizationId,
        campaign.id,
        normalized,
        {
          lastSyncedAt: new Date().toISOString(),
          lastStatus: "error",
          lastMessage: error instanceof Error ? error.message : "google_sheets_sync_failed",
        },
      ).catch(() => {});
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
