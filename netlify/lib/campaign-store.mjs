import { getStore } from "@netlify/blobs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { getAuthStatus, jsonResponse } from "./auth-store.mjs";

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEV_STORE_PATH = resolve(ROOT_DIR, "work", "data", "netlify-campaign-config-dev.json");
const STORE_NAME = "yellow-dashboard-campaign-config";
const CONFIG_KEY = "campaign-config";

function isoNow() {
  return new Date().toISOString();
}

function normalizeCampaignConfig(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return JSON.parse(JSON.stringify(value));
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
        message: "נדרשת התחברות מנהל כדי לטעון או לשמור את הגדרות הקמפיין.",
      }),
    };
  }

  return { email: auth.email };
}

async function saveStoredCampaignConfig(rawConfig, updatedBy) {
  const store = getPersistence();
  const normalized = normalizeCampaignConfig(rawConfig);
  const payload = {
    config: normalized,
    updatedAt: isoNow(),
    updatedBy: String(updatedBy || "").trim().toLowerCase(),
  };
  await store.setJSON(CONFIG_KEY, payload);
  return payload;
}

export async function getAdminCampaignConfig(request) {
  const auth = await ensureAuthenticatedAdmin(request);
  if (auth.error) {
    return auth.error;
  }

  const store = getPersistence();
  const stored = await store.getJSON(CONFIG_KEY);
  return jsonResponse(200, {
    config: normalizeCampaignConfig(stored?.config || stored || {}),
    updatedAt: stored?.updatedAt || "",
    updatedBy: stored?.updatedBy || "",
    message: "הגדרות הקמפיין נטענו מהשרת.",
  });
}

export async function saveAdminCampaignConfig(request, rawConfig) {
  const auth = await ensureAuthenticatedAdmin(request);
  if (auth.error) {
    return auth.error;
  }

  const saved = await saveStoredCampaignConfig(rawConfig, auth.email);
  return jsonResponse(200, {
    config: saved.config,
    updatedAt: saved.updatedAt,
    updatedBy: saved.updatedBy,
    saved: true,
    message: "הגדרות הקמפיין נשמרו בשרת.",
  });
}
