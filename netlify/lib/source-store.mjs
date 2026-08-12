import { jsonResponse, resolveScopedAccess } from "./auth-store.mjs";
import { normalizeSourceConfig, redactSourceConfig } from "./multi-tenant-model.mjs";
import { appendAuditEvent, ensureMultiTenantMigration, getCampaignDataset, saveCampaignDataset, getCampaignSource, saveCampaignSource } from "./campaign-repositories.mjs";
import { safeFetchUrl } from "./source-security.mjs";

function normalizeMultilineText(value) {
  return String(value || "").replace(/\r\n/g, "\n").trim();
}

function parseHeadersText(text) {
  const headers = {};
  normalizeMultilineText(text)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const separatorIndex = line.indexOf(":");
      if (separatorIndex <= 0) {
        return;
      }
      const key = line.slice(0, separatorIndex).trim();
      const value = line.slice(separatorIndex + 1).trim();
      if (key && value) {
        headers[key] = value;
      }
    });
  return headers;
}

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (character === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  values.push(current);
  return values;
}

function parseCsv(text) {
  const lines = String(text || "")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  if (!lines.length) {
    return [];
  }
  const headers = parseCsvLine(lines[0]).map((value) => String(value || "").trim());
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    const record = {};
    headers.forEach((header, index) => {
      record[header] = String(cells[index] || "").trim();
    });
    return record;
  });
}

function getValueByPath(record, path) {
  return String(path || "")
    .split(".")
    .filter(Boolean)
    .reduce((current, segment) => {
      if (current && typeof current === "object") {
        return current[segment];
      }
      return undefined;
    }, record);
}

function parseBoolean(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function parseAmount(value) {
  const numeric = Number(String(value || "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(numeric) ? numeric : 0;
}

function parseCreatedAt(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return null;
  }
  const ddmmyy = raw.match(/^(\d{2})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})$/);
  if (ddmmyy) {
    const [, day, month, year, hour, minute] = ddmmyy;
    const fullYear = Number(year) >= 70 ? `19${year}` : `20${year}`;
    const isoCandidate = `${fullYear}-${month}-${day}T${hour}:${minute}:00`;
    return Number.isFinite(Date.parse(isoCandidate)) ? isoCandidate : null;
  }
  const isoCandidate = raw.includes("T") ? raw : raw.replace(" ", "T");
  return Number.isFinite(Date.parse(isoCandidate)) ? new Date(isoCandidate).toISOString().slice(0, 16) : null;
}

function buildMeta(rows) {
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

function normalizeDatasetRows(rawRows, sourceConfig) {
  const fieldMapText = sourceConfig?.api?.fieldMapText || "{}";
  let fieldMap = {};
  try {
    fieldMap = JSON.parse(fieldMapText);
  } catch {
    fieldMap = {};
  }
  return rawRows
    .map((record, index) => {
      const id = getValueByPath(record, fieldMap.id || "id") || `row-${index + 1}`;
      const createdAt = parseCreatedAt(getValueByPath(record, fieldMap.created_at || "created_at"));
      if (!createdAt) {
        return null;
      }
      const createdDate = new Date(createdAt);
      return {
        id: String(id).trim(),
        createdIso: createdAt.slice(0, 16),
        date: createdAt.slice(0, 10),
        hour: createdDate.getHours(),
        email: String(getValueByPath(record, fieldMap.email || "email") || "").trim().toLowerCase(),
        donor: String(getValueByPath(record, fieldMap.full_name || "full_name") || "").trim() || "ללא שם",
        ambassador: String(getValueByPath(record, fieldMap["Ambassador name"] || "Ambassador name") || "").trim() || "ללא שיוך",
        amount: parseAmount(getValueByPath(record, fieldMap.total || "total")),
        city: String(getValueByPath(record, fieldMap.city || "city") || "").trim() || "ללא עיר",
        status: parseBoolean(getValueByPath(record, fieldMap.charged_success || "charged_success")) ? "success" : "failed",
        chargeResult: String(getValueByPath(record, fieldMap.charge_result || "charge_result") || "").trim(),
      };
    })
    .filter(Boolean);
}

function resolveJsonRows(payload, sourceConfig) {
  if (Array.isArray(payload?.rows)) {
    return payload.rows;
  }
  if (Array.isArray(payload)) {
    return payload;
  }
  const path = String(sourceConfig?.api?.recordsPath || "").trim();
  if (!path) {
    return [];
  }
  const resolved = path.split(".").filter(Boolean).reduce((current, segment) => (current && typeof current === "object" ? current[segment] : undefined), payload);
  return Array.isArray(resolved) ? resolved : [];
}

async function fetchConfiguredSource(config) {
  const normalized = normalizeSourceConfig(config);
  const endpoint = normalized.api.endpoint;
  if (!endpoint) {
    throw new Error("יש להגדיר קודם כתובת API תקפה לפני משיכת נתונים.");
  }

  const headers = {
    Accept: normalized.api.responseFormat === "json" ? "application/json, text/plain, */*" : "text/csv, text/plain, */*",
    ...parseHeadersText(normalized.api.headersText),
  };

  if (normalized.api.authType === "bearer" && normalized.api.bearerToken) {
    headers.Authorization = `Bearer ${normalized.api.bearerToken}`;
  }

  let body;
  if (normalized.api.method === "POST" && normalized.api.bodyText) {
    body = normalized.api.bodyText;
    if (!Object.keys(headers).some((key) => key.toLowerCase() === "content-type")) {
      headers["Content-Type"] = normalized.api.bodyText.trim().startsWith("{") ? "application/json" : "text/plain; charset=utf-8";
    }
  }

  const { response, text, finalUrl } = await safeFetchUrl(endpoint, {
    method: normalized.api.method,
    headers,
    body,
    timeoutMs: 15000,
    maxBytes: 5 * 1024 * 1024,
    maxRedirects: 3,
  });

  if (!response.ok) {
    throw new Error(`המערכת החיצונית החזירה שגיאה ${response.status}.`);
  }

  const payload = normalized.api.responseFormat === "json" ? JSON.parse(text || "{}") : text;
  const rawRows = normalized.api.responseFormat === "json" ? resolveJsonRows(payload, normalized) : parseCsv(payload);
  const rows = normalizeDatasetRows(rawRows, normalized);
  const meta = buildMeta(rows);

  return {
    mode: normalized.mode,
    sourceLabel: `API · ${finalUrl}`,
    fetchedAt: new Date().toISOString(),
    format: normalized.api.responseFormat,
    payload,
    rows,
    meta,
  };
}

export async function getAdminSourceConfig(request, scope = {}) {
  await ensureMultiTenantMigration();
  const access = await resolveScopedAccess(request, {
    action: "source_view",
    organizationId: scope.organizationId,
    campaignId: scope.campaignId,
    unauthorizedMessage: "נדרשת התחברות מנהל כדי לנהל חיבורי API של מקור הנתונים.",
  });
  if (access.error) {
    return access.error;
  }

  const config = await getCampaignSource(access.organization.id, access.campaign.id);
  return jsonResponse(200, {
    organizationId: access.organization.id,
    campaignId: access.campaign.id,
    config: redactSourceConfig(config),
    message: "הגדרות מקור הנתונים נטענו.",
  });
}

export async function saveAdminSourceConfig(request, rawConfig, scope = {}) {
  await ensureMultiTenantMigration();
  const access = await resolveScopedAccess(request, {
    action: "source_update",
    organizationId: scope.organizationId,
    campaignId: scope.campaignId,
    unauthorizedMessage: "נדרשת התחברות מנהל כדי לנהל חיבורי API של מקור הנתונים.",
  });
  if (access.error) {
    return access.error;
  }

  const normalized = await saveCampaignSource(access.organization.id, access.campaign.id, rawConfig);
  await appendAuditEvent({
    user: access.auth.email,
    role: access.auth.role,
    organizationId: access.organization.id,
    campaignId: access.campaign.id,
    action: "source_update",
    outcome: "success",
  });
  return jsonResponse(200, {
    saved: true,
    organizationId: access.organization.id,
    campaignId: access.campaign.id,
    config: redactSourceConfig(normalized),
    message: normalized.mode === "api" ? "חיבור ה-API נשמר בשרת." : "מצב מקור הנתונים נשמר על טעינת קובץ.",
  });
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
    const config = await getCampaignSource(access.organization.id, access.campaign.id);
    if (config.mode !== "api") {
      return jsonResponse(409, {
        message: "מקור הנתונים הפעיל מוגדר כרגע כקובץ, לא כ-API.",
      });
    }

    const payload = await fetchConfiguredSource(config);
    const existingDataset = await getCampaignDataset(access.organization.id, access.campaign.id);
    await saveCampaignDataset(access.organization.id, access.campaign.id, {
      organizationId: access.organization.id,
      campaignId: access.campaign.id,
      rows: payload.rows,
      meta: payload.meta,
      sourceLabel: payload.sourceLabel,
      generatedAt: payload.fetchedAt,
      updatedAt: payload.fetchedAt,
      previousGeneratedAt: existingDataset?.generatedAt || "",
    });
    await appendAuditEvent({
      user: access.auth.email,
      role: access.auth.role,
      organizationId: access.organization.id,
      campaignId: access.campaign.id,
      action: "source_refresh",
      outcome: "success",
    });
    return jsonResponse(200, {
      ok: true,
      organizationId: access.organization.id,
      campaignId: access.campaign.id,
      sourceLabel: payload.sourceLabel,
      fetchedAt: payload.fetchedAt,
      rows: payload.rows,
      meta: payload.meta,
      message: "הנתונים נמשכו בהצלחה ממערכת המקור ונשמרו עבור הקמפיין.",
    });
  } catch (error) {
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
