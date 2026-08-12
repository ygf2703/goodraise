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

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "");
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value ?? {}));
}

function createCampaignId(value, fallbackIndex = 1) {
  return normalizeSlug(value) || `campaign-${fallbackIndex}`;
}

function normalizeCampaignRegistry(value) {
  const candidate = value && typeof value === "object" && !Array.isArray(value) ? value : {};
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

  const campaigns = [];
  const seenIds = new Set();
  const seenSlugs = new Set();

  rawCampaigns.forEach((item, index) => {
    const entry = item && typeof item === "object" ? item : {};
    const snapshotSource = entry?.config && typeof entry.config === "object" ? entry.config : entry;
    const snapshot = cloneJson(snapshotSource);
    const basics = snapshot?.basics && typeof snapshot.basics === "object" ? snapshot.basics : {};
    let slug = normalizeSlug(entry.slug || basics.slug || basics.campaignName || `campaign-${index + 1}`) || `campaign-${index + 1}`;
    const slugBase = slug;
    let slugSuffix = 2;
    while (seenSlugs.has(slug)) {
      slug = `${slugBase}-${slugSuffix}`;
      slugSuffix += 1;
    }
    seenSlugs.add(slug);

    let id = createCampaignId(entry.id || slug, index + 1);
    const idBase = id;
    let idSuffix = 2;
    while (seenIds.has(id)) {
      id = `${idBase}-${idSuffix}`;
      idSuffix += 1;
    }
    seenIds.add(id);

    const name = String(entry.name || basics.campaignName || `Campaign ${index + 1}`).trim() || `Campaign ${index + 1}`;
    const meta = snapshot?.meta && typeof snapshot.meta === "object" ? snapshot.meta : {};
    const updatedAt = String(entry.updatedAt || meta.lastSavedAt || "").trim();
    const updatedBy = normalizeEmail(entry.updatedBy || meta.lastSavedBy || "");

    snapshot.basics = {
      ...basics,
      slug,
      campaignName: name,
    };
    snapshot.meta = {
      ...meta,
      lastSavedAt: updatedAt,
      lastSavedBy: updatedBy,
    };

    campaigns.push({
      id,
      name,
      slug,
      updatedAt,
      updatedBy,
      config: snapshot,
    });
  });

  if (!campaigns.length) {
    campaigns.push({
      id: "campaign-1",
      name: "Campaign 1",
      slug: "campaign-1",
      updatedAt: "",
      updatedBy: "",
      config: {
        basics: {
          campaignName: "Campaign 1",
          slug: "campaign-1",
        },
        meta: {
          lastSavedAt: "",
          lastSavedBy: "",
        },
      },
    });
  }

  const activeCampaignId = campaigns.some((item) => item.id === candidate.activeCampaignId)
    ? candidate.activeCampaignId
    : campaigns[0].id;

  return {
    version: 1,
    activeCampaignId,
    campaigns,
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
        message: "נדרשת התחברות מנהל כדי לטעון או לשמור את הגדרות הקמפיין.",
      }),
    };
  }

  return { email: auth.email };
}

async function saveStoredCampaignConfig(rawConfig, updatedBy) {
  const store = getPersistence();
  const normalized = normalizeCampaignRegistry(rawConfig);
  const timestamp = isoNow();
  const normalizedEmail = normalizeEmail(updatedBy);
  normalized.campaigns = normalized.campaigns.map((item) => {
    if (item.id !== normalized.activeCampaignId) {
      return item;
    }
    return {
      ...item,
      updatedAt: timestamp,
      updatedBy: normalizedEmail,
      config: {
        ...item.config,
        meta: {
          ...(item.config?.meta || {}),
          lastSavedAt: timestamp,
          lastSavedBy: normalizedEmail,
        },
      },
    };
  });
  const payload = {
    config: normalized,
    updatedAt: timestamp,
    updatedBy: normalizedEmail,
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
    config: normalizeCampaignRegistry(stored?.config || stored || {}),
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
