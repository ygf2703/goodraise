import { getStore } from "@netlify/blobs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { getAuthStatus, jsonResponse } from "./auth-store.mjs";

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEV_STORE_PATH = resolve(ROOT_DIR, "work", "data", "netlify-source-config-dev.json");
const STORE_NAME = "yellow-dashboard-source-config";
const CONFIG_KEY = "source-config";

const DEFAULT_FIELD_MAP = {
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

function defaultSourceConfig() {
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
      fieldMapText: JSON.stringify(DEFAULT_FIELD_MAP, null, 2),
    },
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
    return JSON.stringify(DEFAULT_FIELD_MAP, null, 2);
  }

  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return JSON.stringify(parsed, null, 2);
    }
  } catch {
    return JSON.stringify(DEFAULT_FIELD_MAP, null, 2);
  }

  return JSON.stringify(DEFAULT_FIELD_MAP, null, 2);
}

function normalizeSourceConfig(rawConfig, existingConfig = null) {
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

function redactSourceConfig(config) {
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

async function readDevStore() {
  try {
    const content = await readFile(DEV_STORE_PATH, "utf8");
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === "object" && parsed.items && typeof parsed.items === "object") {
      return parsed;
    }
  } catch {
    return { items: {} };
  }

  return { items: {} };
}

async function writeDevStore(store) {
  await mkdir(dirname(DEV_STORE_PATH), { recursive: true });
  await writeFile(DEV_STORE_PATH, JSON.stringify(store, null, 2), "utf8");
}

function createFileStore() {
  return {
    async getJSON(key) {
      const store = await readDevStore();
      return store.items[key] ?? null;
    },
    async setJSON(key, value) {
      const store = await readDevStore();
      store.items[key] = value;
      await writeDevStore(store);
    },
  };
}

function createBlobStore() {
  const store = getStore(STORE_NAME);
  return {
    async getJSON(key) {
      return (await store.get(key, { type: "json" })) ?? null;
    },
    async setJSON(key, value) {
      await store.setJSON(key, value);
    },
  };
}

function isNetlifyRuntime() {
  return Boolean(
    process.env.NETLIFY_LOCAL ||
      process.env.NETLIFY ||
      process.env.SITE_ID ||
      process.env.URL ||
      process.env.SITE_NAME,
  );
}

function getPersistence() {
  return isNetlifyRuntime() ? createBlobStore() : createFileStore();
}

async function ensureAuthenticatedAdmin(request) {
  const auth = await getAuthStatus(request);
  if (!auth?.authenticated || !auth?.email) {
    return {
      error: jsonResponse(401, {
        message: "נדרשת התחברות מנהל כדי לנהל חיבורי API של מקור הנתונים.",
      }),
    };
  }

  return { email: auth.email };
}

async function loadStoredSourceConfig() {
  const store = getPersistence();
  const stored = await store.getJSON(CONFIG_KEY);
  return normalizeSourceConfig(stored);
}

async function saveStoredSourceConfig(rawConfig) {
  const store = getPersistence();
  const existing = await store.getJSON(CONFIG_KEY);
  const normalized = normalizeSourceConfig(rawConfig, existing);
  await store.setJSON(CONFIG_KEY, normalized);
  return normalized;
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

  const response = await fetch(endpoint, {
    method: normalized.api.method,
    headers,
    body,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `המערכת החיצונית החזירה שגיאה ${response.status}${detail ? `: ${detail.slice(0, 180)}` : ""}`,
    );
  }

  const payload =
    normalized.api.responseFormat === "json"
      ? await response.json()
      : await response.text();

  return {
    mode: normalized.mode,
    sourceLabel: `API · ${endpoint}`,
    fetchedAt: new Date().toISOString(),
    format: normalized.api.responseFormat,
    payload,
    recordsPath: normalized.api.recordsPath,
    fieldMapText: normalized.api.fieldMapText,
    autoRefreshMinutes: normalized.api.autoRefreshMinutes,
  };
}

export async function getAdminSourceConfig(request) {
  const auth = await ensureAuthenticatedAdmin(request);
  if (auth.error) {
    return auth.error;
  }

  const config = await loadStoredSourceConfig();
  return jsonResponse(200, {
    config: redactSourceConfig(config),
    message: "הגדרות מקור הנתונים נטענו.",
  });
}

export async function saveAdminSourceConfig(request, rawConfig) {
  const auth = await ensureAuthenticatedAdmin(request);
  if (auth.error) {
    return auth.error;
  }

  const normalized = await saveStoredSourceConfig(rawConfig);
  return jsonResponse(200, {
    saved: true,
    config: redactSourceConfig(normalized),
    message: normalized.mode === "api" ? "חיבור ה-API נשמר בשרת." : "מצב מקור הנתונים נשמר על טעינת קובץ.",
  });
}

export async function refreshAdminSource(request) {
  const auth = await ensureAuthenticatedAdmin(request);
  if (auth.error) {
    return auth.error;
  }

  try {
    const config = await loadStoredSourceConfig();
    if (config.mode !== "api") {
      return jsonResponse(409, {
        message: "מקור הנתונים הפעיל מוגדר כרגע כקובץ, לא כ-API.",
      });
    }

    const payload = await fetchConfiguredSource(config);
    return jsonResponse(200, {
      ok: true,
      ...payload,
      message: "הנתונים נמשכו בהצלחה מהמערכת החיצונית.",
    });
  } catch (error) {
    return jsonResponse(502, {
      message: error instanceof Error ? error.message : "משיכת הנתונים ממערכת המקור נכשלה.",
    });
  }
}
