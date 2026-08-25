import { createHash, createSign } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { jsonResponse, resolveScopedAccess } from "./auth-store.mjs";
import { normalizeSourceConfig, redactSourceConfig } from "./multi-tenant-model.mjs";
import { appendAuditEvent, ensureMultiTenantMigration, getCampaignSource, saveCampaignSource } from "./campaign-repositories.mjs";
import { safeFetchUrl } from "./source-security.mjs";

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const LOCAL_GOOGLE_SERVICE_ACCOUNT_PATH = resolve(ROOT_DIR, "work", "config", "goodraise-google-service-account.local.json");
const GOOGLE_TOKEN_AUDIENCE = "https://oauth2.googleapis.com/token";
const GOOGLE_SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";

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

function parseGoogleValues(values) {
  if (!Array.isArray(values) || !values.length || !Array.isArray(values[0])) {
    return [];
  }
  const headers = values[0].map((value) => String(value || "").trim());
  return values.slice(1).map((row) => {
    const record = {};
    headers.forEach((header, index) => {
      record[header] = String(row?.[index] || "").trim();
    });
    return record;
  });
}

function normalizeGoogleHeader(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("he-IL")
    .replace(/["'`]/g, "")
    .replace(/[()/:\\_-]+/g, " ")
    .replace(/\s+/g, " ");
}

function scoreGoogleSheetValues(values) {
  const headers = Array.isArray(values?.[0]) ? values[0].map(normalizeGoogleHeader) : [];
  const contains = (...needles) => needles.some((needle) => headers.some((header) => header === needle || header.includes(needle)));
  let score = 0;
  if (contains("id", "transaction", "עסקה", "תרומה", "הזמנה")) score += 2;
  if (contains("date", "created", "תאריך", "מועד")) score += 4;
  if (contains("amount", "total", "סכום")) score += 4;
  if (contains("ambassador", "שגריר")) score += 2;
  if (contains("donor", "תורם", "שם מלא")) score += 1;
  return score;
}

function getGoogleSheetLatestTimestamp(values) {
  const headers = Array.isArray(values?.[0]) ? values[0].map((value) => String(value || "").trim()) : [];
  const dateColumn = headers.findIndex((header) => {
    const normalized = normalizeGoogleHeader(header);
    return normalized.includes("date") || normalized.includes("created") || normalized.includes("תאריך") || normalized.includes("מועד");
  });
  if (dateColumn < 0) {
    return 0;
  }
  return values.slice(1).reduce((latest, row) => {
    const parsed = parseCreatedAt(row?.[dateColumn]);
    const timestamp = parsed ? Date.parse(parsed) : 0;
    return Number.isFinite(timestamp) ? Math.max(latest, timestamp) : latest;
  }, 0);
}

export function selectGoogleSheetCandidate(candidates = []) {
  return candidates
    .map((candidate) => ({
      ...candidate,
      score: scoreGoogleSheetValues(candidate.values),
      latestTimestamp: getGoogleSheetLatestTimestamp(candidate.values),
      rowCount: Array.isArray(candidate.values) ? Math.max(0, candidate.values.length - 1) : 0,
    }))
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.latestTimestamp - left.latestTimestamp ||
        right.rowCount - left.rowCount,
    )[0] || null;
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
  const localizedDate = raw.match(/^(\d{2})[./-](\d{2})[./-](\d{2}|\d{4})(?:\s+(\d{2}):(\d{2}))?$/);
  if (localizedDate) {
    const [, day, month, suppliedYear, hour = "00", minute = "00"] = localizedDate;
    const fullYear = suppliedYear.length === 4 ? suppliedYear : Number(suppliedYear) >= 70 ? `19${suppliedYear}` : `20${suppliedYear}`;
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

function resolveFieldMapText(sourceConfig) {
  if (sourceConfig?.mode === "google_sheets") {
    return sourceConfig?.googleSheets?.fieldMapText || "{}";
  }
  return sourceConfig?.api?.fieldMapText || "{}";
}

function normalizeDatasetRows(rawRows, sourceConfig) {
  const fieldMapText = resolveFieldMapText(sourceConfig);
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
  const resolved = path
    .split(".")
    .filter(Boolean)
    .reduce((current, segment) => (current && typeof current === "object" ? current[segment] : undefined), payload);
  return Array.isArray(resolved) ? resolved : [];
}

function extractSpreadsheetId(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  const match = text.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/i);
  if (match?.[1]) {
    return match[1];
  }
  if (/^[a-zA-Z0-9-_]+$/.test(text)) {
    return text;
  }
  return "";
}

function extractSpreadsheetGid(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  try {
    const parsed = new URL(text);
    const hashMatch = String(parsed.hash || "").match(/gid=([0-9]+)/i);
    if (hashMatch?.[1]) {
      return hashMatch[1];
    }
    const searchGid = parsed.searchParams.get("gid");
    return searchGid ? String(searchGid).trim() : "";
  } catch {
    return "";
  }
}

function buildGoogleSheetsSourceLabel(config, resolvedSheetName = "") {
  const sheetName = String(resolvedSheetName || config?.sheetName || "").trim();
  const spreadsheetId = String(config?.spreadsheetId || "").trim() || extractSpreadsheetId(config?.spreadsheetUrl);
  if (sheetName) {
    return `Google Sheets · ${sheetName}`;
  }
  if (spreadsheetId) {
    return `Google Sheets · ${spreadsheetId}`;
  }
  return "Google Sheets";
}

function buildGoogleSheetsCsvExportUrl(config) {
  const spreadsheetUrl = String(config?.spreadsheetUrl || "").trim();
  const spreadsheetId = String(config?.spreadsheetId || "").trim() || extractSpreadsheetId(spreadsheetUrl);
  if (!spreadsheetId) {
    throw new Error("יש להגדיר קודם קישור או Spreadsheet ID של Google Sheets.");
  }
  const gid = String(config?.gid || "").trim() || extractSpreadsheetGid(spreadsheetUrl);
  const exportUrl = new URL(`https://docs.google.com/spreadsheets/d/${spreadsheetId}/export`);
  exportUrl.searchParams.set("format", "csv");
  if (gid) {
    exportUrl.searchParams.set("gid", gid);
  }
  return {
    spreadsheetId,
    gid,
    url: exportUrl.toString(),
  };
}

function encodeBase64Url(value) {
  return Buffer.from(value).toString("base64url");
}

async function loadGoogleServiceAccountCredentials() {
  const rawEnv = String(process.env.GOODRAISE_GOOGLE_SERVICE_ACCOUNT_JSON || "").trim();
  const pathEnv = String(process.env.GOODRAISE_GOOGLE_SERVICE_ACCOUNT_JSON_PATH || "").trim();
  const rawText =
    rawEnv ||
    (pathEnv ? await readFile(pathEnv, "utf8") : "") ||
    (await readFile(LOCAL_GOOGLE_SERVICE_ACCOUNT_PATH, "utf8").catch(() => ""));
  if (!rawText) {
    throw new Error("לא הוגדרו פרטי service account עבור Google Sheets.");
  }
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error("קובץ ה-service account של Google Sheets אינו JSON תקין.");
  }
  if (!parsed?.client_email || !parsed?.private_key) {
    throw new Error("חסרים client_email או private_key בהגדרת Google Sheets service account.");
  }
  return parsed;
}

async function getGoogleServiceAccountAccessToken() {
  const credentials = await loadGoogleServiceAccountCredentials();
  const now = Math.floor(Date.now() / 1000);
  const jwtHeader = encodeBase64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const jwtPayload = encodeBase64Url(
    JSON.stringify({
      iss: credentials.client_email,
      scope: GOOGLE_SHEETS_SCOPE,
      aud: GOOGLE_TOKEN_AUDIENCE,
      exp: now + 3600,
      iat: now,
    }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${jwtHeader}.${jwtPayload}`);
  signer.end();
  const signature = signer.sign(credentials.private_key, "base64url");
  const assertion = `${jwtHeader}.${jwtPayload}.${signature}`;

  const response = await fetch(GOOGLE_TOKEN_AUDIENCE, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.access_token) {
    const detail = [payload?.error, payload?.error_description]
      .map((value) => String(value || "").replace(/[\r\n]+/g, " ").trim())
      .filter(Boolean)
      .join(" - ")
      .slice(0, 280);
    throw new Error(
      `המערכת לא הצליחה לקבל access token מ-Google עבור קריאת ה-sheet.${detail ? ` ${detail}` : ""}`,
    );
  }
  return String(payload.access_token);
}

async function fetchGoogleSheetsByServiceAccount(config) {
  const spreadsheetUrl = String(config?.spreadsheetUrl || "").trim();
  const spreadsheetId = String(config?.spreadsheetId || "").trim() || extractSpreadsheetId(spreadsheetUrl);
  const configuredSheetName = String(config?.sheetName || "").trim();
  const configuredRange = String(config?.range || "").trim();
  const range = configuredRange || (configuredSheetName ? `${configuredSheetName}!A:ZZ` : "A:ZZ");
  if (!spreadsheetId) {
    throw new Error("יש להגדיר Spreadsheet ID או קישור תקין ל-Google Sheets.");
  }
  const token = await getGoogleServiceAccountAccessToken();
  const requestHeaders = {
    Accept: "application/json, text/plain, */*",
    Authorization: `Bearer ${token}`,
  };
  const fetchValues = async (requestedRange) => {
    const endpoint = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(requestedRange)}?majorDimension=ROWS`;
    const { response, text, finalUrl } = await safeFetchUrl(endpoint, {
      method: "GET",
      headers: requestHeaders,
      timeoutMs: 15000,
      maxBytes: 5 * 1024 * 1024,
      maxRedirects: 1,
    });
    if (!response.ok) {
      throw new Error(`Google Sheets API החזיר שגיאה ${response.status}.`);
    }
    return { payload: JSON.parse(text || "{}"), finalUrl };
  };

  let selectedRange = range;
  let resolvedSheetName = configuredSheetName;
  let { payload, finalUrl } = await fetchValues(selectedRange);

  // If the campaign owner did not select a tab, stay within the approved
  // spreadsheet and select the tab that actually contains transaction headers.
  if (!configuredSheetName && !configuredRange.includes("!")) {
    try {
      const metadataEndpoint = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties(title,index)`;
      const metadataResponse = await safeFetchUrl(metadataEndpoint, {
        method: "GET",
        headers: requestHeaders,
        timeoutMs: 10000,
        maxBytes: 128 * 1024,
        maxRedirects: 1,
      });
      const metadata = metadataResponse.response.ok ? JSON.parse(metadataResponse.text || "{}") : {};
      const sheetNames = Array.isArray(metadata?.sheets)
        ? metadata.sheets.map((sheet) => String(sheet?.properties?.title || "").trim()).filter(Boolean).slice(0, 20)
        : [];
      const candidates = [{ values: payload?.values || [], finalUrl, sheetName: "" }];
      for (const sheetName of sheetNames) {
        const candidate = await fetchValues(`${sheetName}!A:ZZ`);
        candidates.push({ values: candidate.payload?.values || [], finalUrl: candidate.finalUrl, sheetName });
      }
      const best = selectGoogleSheetCandidate(candidates);
      const defaultScore = scoreGoogleSheetValues(payload?.values || []);
      const defaultLatestTimestamp = getGoogleSheetLatestTimestamp(payload?.values || []);
      const defaultRowCount = Array.isArray(payload?.values) ? Math.max(0, payload.values.length - 1) : 0;
      if (
        best &&
        best.sheetName &&
        (best.score > defaultScore ||
          (best.score === defaultScore &&
            (best.latestTimestamp > defaultLatestTimestamp ||
              (best.latestTimestamp === defaultLatestTimestamp && best.rowCount > defaultRowCount))))
      ) {
        payload = { values: best.values };
        finalUrl = best.finalUrl;
        resolvedSheetName = best.sheetName;
        selectedRange = `${best.sheetName}!A:ZZ`;
      }
    } catch (error) {
      // The normal default-tab request above remains a safe fallback, but the
      // scheduler log must show why automatic tab discovery was unavailable.
      console.warn("[goodraise][google-sheets-sync] tab discovery failed", {
        message: error instanceof Error ? error.message : "tab_discovery_failed",
      });
    }
  }
  const rawRows = parseGoogleValues(payload?.values || []);
  return {
    payload,
    rawRows,
    finalUrl,
    resolvedSheetName,
    resolvedRange: selectedRange,
    contentHash: sha256(stableStringify(payload?.values || [])),
  };
}

async function fetchGoogleSheetsByPublicCsv(config) {
  const { url, spreadsheetId } = buildGoogleSheetsCsvExportUrl(config);
  const { response, text, finalUrl } = await safeFetchUrl(url, {
    method: "GET",
    headers: {
      Accept: "text/csv, text/plain, */*",
    },
    timeoutMs: 15000,
    maxBytes: 5 * 1024 * 1024,
    maxRedirects: 3,
  });
  if (!response.ok) {
    throw new Error(`Google Sheets export החזיר שגיאה ${response.status}.`);
  }
  return {
    payload: text,
    rawRows: parseCsv(text),
    finalUrl,
    spreadsheetId,
    contentHash: sha256(text || ""),
  };
}

async function fetchApiSource(normalized) {
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
  return {
    payload,
    rawRows,
    finalUrl,
    contentHash: sha256(normalized.api.responseFormat === "json" ? stableStringify(payload) : text || ""),
  };
}

export async function fetchConfiguredSource(config) {
  const normalized = normalizeSourceConfig(config);
  let fetchedSource = null;
  let format = "csv";
  let sourceLabel = "";

  if (normalized.mode === "api") {
    fetchedSource = await fetchApiSource(normalized);
    format = normalized.api.responseFormat;
    sourceLabel = `API · ${fetchedSource.finalUrl}`;
  } else if (normalized.mode === "google_sheets") {
    fetchedSource =
      normalized.googleSheets.accessMode === "service_account"
        ? await fetchGoogleSheetsByServiceAccount(normalized.googleSheets)
        : await fetchGoogleSheetsByPublicCsv(normalized.googleSheets);
    format = normalized.googleSheets.accessMode === "service_account" ? "json" : "csv";
    sourceLabel = buildGoogleSheetsSourceLabel(normalized.googleSheets, fetchedSource.resolvedSheetName);
  } else {
    throw new Error("מקור הנתונים הפעיל מוגדר כקובץ ידני ולא כמקור חיצוני.");
  }

  const rows = normalizeDatasetRows(fetchedSource.rawRows, normalized);
  const meta = buildMeta(rows);

  return {
    mode: normalized.mode,
    sourceLabel,
    fetchedAt: new Date().toISOString(),
    format,
    payload: fetchedSource.payload,
    rawRows: fetchedSource.rawRows,
    rows,
    meta,
    contentHash: fetchedSource.contentHash,
  };
}

export async function getAdminSourceConfig(request, scope = {}) {
  await ensureMultiTenantMigration();
  const access = await resolveScopedAccess(request, {
    action: "source_view",
    organizationId: scope.organizationId,
    campaignId: scope.campaignId,
    unauthorizedMessage: "נדרשת התחברות מנהל כדי לנהל את חיבור מקור הנתונים.",
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
    unauthorizedMessage: "נדרשת התחברות מנהל כדי לנהל את חיבור מקור הנתונים.",
  });
  if (access.error) {
    return access.error;
  }

  const normalized = await saveCampaignSource(access.organization.id, access.campaign.id, rawConfig, access.auth.email);
  await appendAuditEvent({
    user: access.auth.email,
    role: access.auth.role,
    organizationId: access.organization.id,
    campaignId: access.campaign.id,
    action: "source_update",
    outcome: "success",
    detail: {
      mode: normalized.mode,
      googleSheetsEnabled: normalized.mode === "google_sheets",
    },
  });
  return jsonResponse(200, {
    saved: true,
    organizationId: access.organization.id,
    campaignId: access.campaign.id,
    config: redactSourceConfig(normalized),
    message:
      normalized.mode === "google_sheets"
        ? "חיבור Google Sheets נשמר בשרת."
        : normalized.mode === "api"
          ? "חיבור ה-API נשמר בשרת."
          : "מצב מקור הנתונים נשמר על טעינת קובץ.",
  });
}
