import {
  changeManagerPassword,
  getAdminDataset,
  getAuthStatus,
  getPublicContext,
  getPublicDataset,
  getRuntimeHealth,
  jsonResponse,
  loginManager,
  logoutManager,
  resolveScopedAccess,
  setupManagerPassword,
} from "../lib/auth-store.mjs";
import {
  createOrganizationCampaign,
  getAdminCampaignConfig,
  getOrganizationCampaignList,
  saveAdminCampaignConfig,
} from "../lib/campaign-store.mjs";
import {
  appendAuditEvent,
  ensureMultiTenantMigration,
  listCampaignSummaries,
} from "../lib/campaign-repositories.mjs";
import {
  getAdminSourceConfig,
  saveAdminSourceConfig,
} from "../lib/source-store.mjs";
import { refreshAdminSource } from "../lib/source-sync.mjs";
import {
  IngestHttpError,
  importAmbassadorRegistrations,
  ingestCampaignRecord,
  ingestManualContribution,
  validateIngestApiKey,
} from "../lib/postgres-ingest.mjs";

const JSON_METHODS = new Set(["POST", "PUT", "PATCH"]);

// Audit history is useful, but an unavailable audit store must never block a
// successful database operation such as importing an ambassador directory.
async function appendAuditEventSafely(event) {
  try {
    await appendAuditEvent(event);
  } catch (error) {
    console.error("audit_event_write_failed", {
      action: event.action,
      outcome: event.outcome,
      organizationId: event.organizationId,
      campaignId: event.campaignId,
      message: error instanceof Error ? error.message : "Unknown audit error",
    });
  }
}

function matchScopedCampaignRoute(pathname, suffix = "") {
  const escapedSuffix = suffix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const expression = new RegExp(`^/api/organizations/([^/]+)/campaigns/([^/]+)${escapedSuffix}$`);
  const match = pathname.match(expression);
  if (!match) {
    return null;
  }
  return {
    organizationId: decodeURIComponent(match[1]),
    campaignId: decodeURIComponent(match[2]),
  };
}

function matchOrganizationRoute(pathname, suffix = "") {
  const escapedSuffix = suffix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const expression = new RegExp(`^/api/organizations/([^/]+)${escapedSuffix}$`);
  const match = pathname.match(expression);
  if (!match) {
    return null;
  }
  return {
    organizationId: decodeURIComponent(match[1]),
  };
}

async function readRequestPayload(request) {
  if (!JSON_METHODS.has(request.method)) {
    return {};
  }

  try {
    const parsed = await request.json();
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function importCampaignAmbassadors(request, payload, scope) {
  const access = await resolveScopedAccess(request, {
    action: "ambassador_import",
    organizationId: scope.organizationId,
    campaignId: scope.campaignId,
    unauthorizedMessage: "נדרשת התחברות מנהל כדי לייבא שגרירים.",
  });
  if (access.error) {
    return access.error;
  }
  try {
    const result = await importAmbassadorRegistrations({
      organizationIdentifier: access.organization.id,
      campaignIdentifier: access.campaign.id,
      records: payload.records,
      importedBy: access.auth.email,
      sourceLabel: payload.sourceLabel || "ambassador-registration-csv",
    });
    await appendAuditEventSafely({
      user: access.auth.email,
      role: access.auth.role,
      organizationId: access.organization.id,
      campaignId: access.campaign.id,
      action: "ambassador_import",
      outcome: "success",
      detail: {
        importedCount: result.importedCount,
        duplicateRows: result.duplicateRows,
        skippedRows: result.skippedRows.length,
      },
    });
    return jsonResponse(200, result);
  } catch (error) {
    const status = error instanceof IngestHttpError ? error.status : 500;
    const message = error instanceof IngestHttpError ? error.message : "ייבוא השגרירים נכשל.";
    await appendAuditEventSafely({
      user: access.auth.email,
      role: access.auth.role,
      organizationId: access.organization.id,
      campaignId: access.campaign.id,
      action: "ambassador_import",
      outcome: "error",
      detail: { reason: message },
    });
    return jsonResponse(status, { message });
  }
}

async function addCampaignManualContribution(request, payload, scope) {
  const access = await resolveScopedAccess(request, {
    action: "campaign_update",
    organizationId: scope.organizationId,
    campaignId: scope.campaignId,
    unauthorizedMessage: "נדרשת התחברות מנהל כדי להוסיף הכפלה ידנית.",
  });
  if (access.error) {
    return access.error;
  }

  try {
    const result = await ingestManualContribution({
      organizationIdentifier: access.organization.id,
      campaignIdentifier: access.campaign.id,
      enteredBy: payload.enteredBy,
      amount: payload.amount,
      requestId: payload.requestId,
    });
    await appendAuditEventSafely({
      user: access.auth.email,
      role: access.auth.role,
      organizationId: access.organization.id,
      campaignId: access.campaign.id,
      action: "manual_contribution_create",
      outcome: "success",
      detail: {
        transactionId: result.transaction.id,
        amount: result.transaction.totalAmount,
        source: "manual-match",
      },
    });
    return jsonResponse(result.created === false ? 200 : 201, {
      ...result,
      message: result.created === false ? "ההכפלה כבר קיימת ברשומות." : "ההכפלה נוספה לסכום הקמפיין.",
    });
  } catch (error) {
    console.error("manual_contribution_write_failed", {
      organizationId: access.organization.id,
      campaignId: access.campaign.id,
      message: error instanceof Error ? error.message : "Unknown ingestion error",
    });
    const status = error instanceof IngestHttpError ? error.status : 500;
    const message = error instanceof IngestHttpError ? error.message : "שמירת ההכפלה נכשלה.";
    await appendAuditEventSafely({
      user: access.auth.email,
      role: access.auth.role,
      organizationId: access.organization.id,
      campaignId: access.campaign.id,
      action: "manual_contribution_create",
      outcome: "error",
      detail: { reason: message },
    });
    return jsonResponse(status, { message });
  }
}

export default async (request) => {
  await ensureMultiTenantMigration();
  const url = new URL(request.url);
  const { pathname } = url;

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "cache-control": "no-store",
      },
    });
  }

  if (pathname === "/api/health" && request.method === "GET") {
    const payload = await getRuntimeHealth();
    return jsonResponse(payload.ok ? 200 : 503, payload);
  }

  if (pathname === "/api/public-context" && request.method === "GET") {
    return getPublicContext();
  }

  if (pathname === "/api/auth/status" && request.method === "GET") {
    const status = await getAuthStatus(request);
    return jsonResponse(200, {
      mode: "backend",
      ...status,
    });
  }

  if (pathname === "/api/auth/login" && request.method === "POST") {
    const payload = await readRequestPayload(request);
    return loginManager({
      email: payload.email,
      password: payload.password,
      request,
    });
  }

  if (pathname === "/api/auth/setup" && request.method === "POST") {
    const payload = await readRequestPayload(request);
    return setupManagerPassword({
      email: payload.email,
      password: payload.password,
      confirmPassword: payload.confirmPassword,
      request,
    });
  }

  if (pathname === "/api/auth/logout" && request.method === "POST") {
    return logoutManager(request);
  }

  if (pathname === "/api/auth/change-password" && request.method === "POST") {
    const payload = await readRequestPayload(request);
    return changeManagerPassword({
      request,
      currentPassword: payload.currentPassword,
      newPassword: payload.newPassword,
      confirmPassword: payload.confirmPassword,
    });
  }

  if (pathname === "/api/admin/dataset" && request.method === "GET") {
    return getAdminDataset(request);
  }

  if (pathname === "/api/admin/source-config" && request.method === "GET") {
    return getAdminSourceConfig(request);
  }

  if (pathname === "/api/admin/campaign-config" && request.method === "GET") {
    return getAdminCampaignConfig(request);
  }

  if (pathname === "/api/admin/source-config" && request.method === "POST") {
    const payload = await readRequestPayload(request);
    return saveAdminSourceConfig(request, payload.config || {});
  }

  if (pathname === "/api/admin/campaign-config" && request.method === "POST") {
    const payload = await readRequestPayload(request);
    return saveAdminCampaignConfig(request, payload.config || {});
  }

  if (pathname === "/api/admin/source-refresh" && request.method === "POST") {
    return refreshAdminSource(request);
  }

  const scopedManualContribution = matchScopedCampaignRoute(pathname, "/manual-contributions");
  if (scopedManualContribution && request.method === "POST") {
    const payload = await readRequestPayload(request);
    return addCampaignManualContribution(request, payload, scopedManualContribution);
  }

  const scopedIngest = matchScopedCampaignRoute(pathname, "/ingest");
  if (scopedIngest && request.method === "POST") {
    const apiKeyValidation = validateIngestApiKey(request);
    if (!apiKeyValidation.ok) {
      await appendAuditEvent({
        action: "external_ingest",
        outcome: "denied",
        detail: {
          reason: apiKeyValidation.message,
          organizationId: scopedIngest.organizationId,
          campaignId: scopedIngest.campaignId,
        },
      });
      return jsonResponse(apiKeyValidation.status, { message: apiKeyValidation.message });
    }
    try {
      const payload = await readRequestPayload(request);
      const result = await ingestCampaignRecord({
        organizationIdentifier: scopedIngest.organizationId,
        campaignIdentifier: scopedIngest.campaignId,
        payload,
      });
      await appendAuditEvent({
        action: "external_ingest",
        outcome: "success",
        organizationId: result.organization.id,
        campaignId: result.campaign.id,
        detail: {
          importBatchId: result.importBatch.id,
          transactionId: result.transaction.id,
          sourceTransactionKey: result.transaction.sourceTransactionKey,
          sourceLabel: result.importBatch.sourceLabel,
        },
      });
      return jsonResponse(result.created === false ? 200 : 201, result);
    } catch (error) {
      const status = error instanceof IngestHttpError ? error.status : 500;
      const message = error instanceof IngestHttpError ? error.message : "Failed to ingest the external record.";
      await appendAuditEvent({
        action: "external_ingest",
        outcome: "error",
        detail: {
          reason: message,
          organizationId: scopedIngest.organizationId,
          campaignId: scopedIngest.campaignId,
        },
      });
      return jsonResponse(status, { message });
    }
  }

  const scopedPublicDataset = matchScopedCampaignRoute(pathname, "/public-dataset");
  if (scopedPublicDataset && request.method === "GET") {
    return getPublicDataset(scopedPublicDataset);
  }

  const scopedDataset = matchScopedCampaignRoute(pathname, "/dataset");
  if (scopedDataset && request.method === "GET") {
    return getAdminDataset(request, scopedDataset);
  }

  const scopedSource = matchScopedCampaignRoute(pathname, "/source");
  if (scopedSource && request.method === "GET") {
    return getAdminSourceConfig(request, scopedSource);
  }
  if (scopedSource && ["POST", "PUT"].includes(request.method)) {
    const payload = await readRequestPayload(request);
    return saveAdminSourceConfig(request, payload.config || {}, scopedSource);
  }

  const scopedRefresh = matchScopedCampaignRoute(pathname, "/source/refresh");
  if (scopedRefresh && request.method === "POST") {
    return refreshAdminSource(request, scopedRefresh);
  }

  const scopedAmbassadorImport = matchScopedCampaignRoute(pathname, "/ambassadors/import");
  if (scopedAmbassadorImport && request.method === "POST") {
    const payload = await readRequestPayload(request);
    return importCampaignAmbassadors(request, payload, scopedAmbassadorImport);
  }

  const scopedCampaign = matchScopedCampaignRoute(pathname, "");
  if (scopedCampaign && request.method === "GET") {
    return getAdminCampaignConfig(request, scopedCampaign);
  }
  if (scopedCampaign && ["POST", "PUT"].includes(request.method)) {
    const payload = await readRequestPayload(request);
    return saveAdminCampaignConfig(request, payload.config || {}, scopedCampaign);
  }

  const orgCampaigns = matchOrganizationRoute(pathname, "/campaigns");
  if (orgCampaigns && request.method === "GET") {
    return getOrganizationCampaignList(request, orgCampaigns.organizationId);
  }

  if (orgCampaigns && request.method === "POST") {
    const payload = await readRequestPayload(request);
    return createOrganizationCampaign(request, orgCampaigns.organizationId, payload.config || payload);
  }

  return jsonResponse(404, { message: "הנתיב המבוקש לא נמצא." });
};

export const config = {
  path: [
    "/api/health",
    "/api/public-context",
    "/api/auth/status",
    "/api/auth/login",
    "/api/auth/setup",
    "/api/auth/logout",
    "/api/auth/change-password",
    "/api/admin/dataset",
    "/api/admin/campaign-config",
    "/api/admin/source-config",
    "/api/admin/source-refresh",
    "/api/organizations/*",
  ],
};
