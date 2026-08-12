import { getStore } from "@netlify/blobs";
import { pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEV_STORE_PATH = resolve(ROOT_DIR, "work", "data", "netlify-auth-dev.json");
const LOCAL_ACCESS_CONTROL_PATH = resolve(ROOT_DIR, "work", "config", "dashboard-access.local.json");
const EXAMPLE_ACCESS_CONTROL_PATH = resolve(ROOT_DIR, "work", "config", "dashboard-access.example.json");
const ADMIN_DATASET_PATH = resolve(ROOT_DIR, "netlify", "data", "admin-dataset.json");
const STORE_NAME = "yellow-dashboard-auth";
const SESSION_COOKIE_NAME = "yellow_dashboard_admin_session";
const SESSION_DURATION_HOURS = 24 * 30;
const PASSWORD_ITERATIONS = 200_000;
const MAX_AUTH_ATTEMPTS = 5;
const AUTH_WINDOW_MS = 15 * 60 * 1000;
const AUTH_LOCKOUT_MS = 20 * 60 * 1000;
const ROLE_PLATFORM_ADMIN = "platform_admin";
const ROLE_ORGANIZATION_ADMIN = "organization_admin";
const ROLE_CAMPAIGN_MANAGER = "campaign_manager";
const ROLE_ANALYST = "analyst";
const ROLE_VIEWER = "viewer";
const KNOWN_ROLES = new Set([
  ROLE_PLATFORM_ADMIN,
  ROLE_ORGANIZATION_ADMIN,
  ROLE_CAMPAIGN_MANAGER,
  ROLE_ANALYST,
  ROLE_VIEWER,
]);
const ROLE_ORDER = {
  [ROLE_VIEWER]: 1,
  [ROLE_ANALYST]: 2,
  [ROLE_CAMPAIGN_MANAGER]: 3,
  [ROLE_ORGANIZATION_ADMIN]: 4,
  [ROLE_PLATFORM_ADMIN]: 5,
};

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeSlug(value, fallback = "default") {
  const cleaned = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || fallback;
}

function normalizeRole(value, fallback = ROLE_PLATFORM_ADMIN) {
  const candidate = String(value || "").trim().toLowerCase();
  return KNOWN_ROLES.has(candidate) ? candidate : fallback;
}

function normalizeCampaignScope(values) {
  if (Array.isArray(values)) {
    return values.map((value) => normalizeSlug(value)).filter(Boolean);
  }
  if (typeof values === "string" && values.trim()) {
    return values.split(",").map((value) => normalizeSlug(value)).filter(Boolean);
  }
  return [];
}

function isoNow() {
  return new Date().toISOString();
}

function toMillis(value) {
  const timestamp = Date.parse(value || "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function adminKey(email) {
  return `admin:${normalizeEmail(email)}`;
}

function sessionKey(token) {
  return `session:${token}`;
}

function rateLimitKey(email, clientAddress) {
  return `ratelimit:${normalizeEmail(email)}:${clientAddress || "unknown"}`;
}

function auditKey() {
  return `audit:${Date.now()}:${randomBytes(6).toString("hex")}`;
}

function parseManagerRecords(rawValue) {
  const raw = String(rawValue || "").trim();
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .map((value) => normalizeManagerRecord(value))
        .filter(Boolean);
    }
  } catch {
    return raw
      .split(",")
      .map((value) => normalizeManagerRecord(value))
      .filter(Boolean);
  }

  return [];
}

function normalizeManagerRecord(value) {
  if (typeof value === "string") {
    const email = normalizeEmail(value);
    if (!email) {
      return null;
    }
    return {
      email,
      role: ROLE_PLATFORM_ADMIN,
      organizationSlug: "default-org",
      campaignSlugs: [],
      isActive: true,
    };
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const email = normalizeEmail(value.email);
  if (!email) {
    return null;
  }

  return {
    email,
    role: normalizeRole(value.role, ROLE_PLATFORM_ADMIN),
    organizationSlug: normalizeSlug(value.organizationSlug || "default-org"),
    campaignSlugs: normalizeCampaignScope(value.campaignSlugs),
    isActive: value.isActive !== false,
  };
}

function uniqueManagerRecords(records) {
  const seen = new Set();
  return records.filter((record) => {
    const email = normalizeEmail(record?.email);
    if (!email || seen.has(email)) {
      return false;
    }
    seen.add(email);
    return true;
  });
}

async function loadManagerRecordsFromFile(path) {
  try {
    const content = await readFile(path, "utf8");
    const parsed = JSON.parse(content);
    const records = [];
    if (Array.isArray(parsed?.managers)) {
      records.push(...parsed.managers.map((value) => normalizeManagerRecord(value)).filter(Boolean));
    }
    if (Array.isArray(parsed?.managerEmails)) {
      records.push(...parsed.managerEmails.map((value) => normalizeManagerRecord(value)).filter(Boolean));
    }
    return uniqueManagerRecords(records);
  } catch {}

  return [];
}

export async function loadManagerRecords() {
  const envRecords = parseManagerRecords(process.env.YELLOW_DASHBOARD_MANAGER_EMAILS);
  if (envRecords.length > 0) {
    return uniqueManagerRecords(envRecords);
  }

  const localRecords = await loadManagerRecordsFromFile(LOCAL_ACCESS_CONTROL_PATH);
  if (localRecords.length > 0) {
    return localRecords;
  }

  const allowExampleManagers = ["1", "true", "yes", "on"].includes(
    String(process.env.YELLOW_DASHBOARD_ALLOW_EXAMPLE_MANAGERS || "").trim().toLowerCase(),
  );
  if (allowExampleManagers) {
    return await loadManagerRecordsFromFile(EXAMPLE_ACCESS_CONTROL_PATH);
  }

  return [];
}

function hashPassword(password) {
  const salt = randomBytes(16);
  const digest = pbkdf2Sync(password, salt, PASSWORD_ITERATIONS, 32, "sha256");
  return `pbkdf2_sha256$${PASSWORD_ITERATIONS}$${salt.toString("base64url")}$${digest.toString("base64url")}`;
}

function verifyPassword(password, storedHash) {
  try {
    const [algorithm, iterationsText, saltBase64, digestBase64] = String(storedHash || "").split("$", 4);
    if (algorithm !== "pbkdf2_sha256") {
      return false;
    }
    const iterations = Number.parseInt(iterationsText, 10);
    if (!Number.isFinite(iterations) || iterations <= 0) {
      return false;
    }
    const salt = Buffer.from(saltBase64, "base64url");
    const expectedDigest = Buffer.from(digestBase64, "base64url");
    const candidateDigest = pbkdf2Sync(password, salt, iterations, expectedDigest.length, "sha256");
    return (
      candidateDigest.length === expectedDigest.length &&
      timingSafeEqual(candidateDigest, expectedDigest)
    );
  } catch {
    return false;
  }
}

function buildCookieValue(token, requestUrl, maxAgeSeconds) {
  const url = new URL(requestUrl);
  const parts = [
    `${SESSION_COOKIE_NAME}=${token || ""}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ];

  if (process.env.NETLIFY || process.env.NETLIFY_LOCAL || url.protocol === "https:") {
    parts.push("Secure");
  }

  return parts.join("; ");
}

function getClientAddress(request) {
  const forwarded = request.headers.get("x-forwarded-for") || request.headers.get("x-nf-client-connection-ip") || "";
  return forwarded.split(",")[0].trim() || "unknown";
}

function getUserAgent(request) {
  return request.headers.get("user-agent") || "";
}

async function loadAdminDatasetPayload() {
  try {
    const content = await readFile(ADMIN_DATASET_PATH, "utf8");
    const payload = JSON.parse(content);
    return payload && typeof payload === "object" ? payload : null;
  } catch {
    return null;
  }
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
    async delete(key) {
      const store = await readDevStore();
      delete store.items[key];
      await writeDevStore(store);
    },
    async listJSON(prefix) {
      const store = await readDevStore();
      return Object.entries(store.items)
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, value]) => ({ key, value }));
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
    async delete(key) {
      await store.delete(key);
    },
    async listJSON(prefix) {
      const items = [];
      let cursor;

      do {
        const page = await store.list(cursor ? { prefix, cursor } : { prefix });
        for (const blob of page.blobs || []) {
          const value = await store.get(blob.key, { type: "json" });
          if (value !== null) {
            items.push({ key: blob.key, value });
          }
        }
        cursor = page.cursor || undefined;
      } while (cursor);

      return items;
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
  if (isNetlifyRuntime()) {
    return createBlobStore();
  }

  return createFileStore();
}

async function recordAuditEvent(store, event) {
  await store.setJSON(auditKey(), {
    at: isoNow(),
    ...event,
  });
}

async function getRateLimitRecord(store, email, clientAddress) {
  return (await store.getJSON(rateLimitKey(email, clientAddress))) ?? null;
}

async function clearFailedAttempts(store, email, clientAddress) {
  await store.delete(rateLimitKey(email, clientAddress));
}

async function recordFailedAttempt(store, email, clientAddress) {
  const key = rateLimitKey(email, clientAddress);
  const now = Date.now();
  const existing = await getRateLimitRecord(store, email, clientAddress);
  const windowStartedAt =
    existing && now - toMillis(existing.windowStartedAt) <= AUTH_WINDOW_MS
      ? existing.windowStartedAt
      : new Date(now).toISOString();
  const count =
    existing && now - toMillis(existing.windowStartedAt) <= AUTH_WINDOW_MS
      ? Number(existing.count || 0) + 1
      : 1;
  const blockedUntil =
    count >= MAX_AUTH_ATTEMPTS ? new Date(now + AUTH_LOCKOUT_MS).toISOString() : existing?.blockedUntil || "";

  await store.setJSON(key, {
    email: normalizeEmail(email),
    clientAddress,
    count,
    windowStartedAt,
    blockedUntil,
  });

  return {
    count,
    blockedUntil,
  };
}

async function ensureNotRateLimited(store, email, clientAddress) {
  const record = await getRateLimitRecord(store, email, clientAddress);
  if (!record) {
    return null;
  }
  if (record.blockedUntil && toMillis(record.blockedUntil) > Date.now()) {
    const retryAfterSeconds = Math.max(1, Math.ceil((toMillis(record.blockedUntil) - Date.now()) / 1000));
    return failureResponse(
      429,
      "×™×•×ª×¨ ×ž×“×™ × ×™×¡×™×•× ×•×ª ×”×ª×—×‘×¨×•×ª. × ×¡×• ×©×•×‘ ×‘×¢×•×“ ×ž×¡×¤×¨ ×“×§×•×ª.",
      {
        code: "rate_limited",
        retryAfterSeconds,
      },
      {
        "retry-after": String(retryAfterSeconds),
      },
    );
  }
  return null;
}

async function ensureAdminSeed(store) {
  const createdAt = isoNow();
  for (const manager of await loadManagerRecords()) {
    const key = adminKey(manager.email);
    const existing = await store.getJSON(key);
    await store.setJSON(key, {
      email: manager.email,
      role: manager.role,
      organizationSlug: manager.organizationSlug,
      campaignSlugs: manager.campaignSlugs,
      isActive: manager.isActive,
      createdAt: existing?.createdAt || createdAt,
      passwordHash: existing?.passwordHash || "",
      passwordSetAt: existing?.passwordSetAt || "",
      lastLoginAt: existing?.lastLoginAt || "",
    });
  }
}

async function getAdminRecord(store, email) {
  await ensureAdminSeed(store);
  return store.getJSON(adminKey(email));
}

async function saveAdminRecord(store, record) {
  await store.setJSON(adminKey(record.email), record);
}

function hasRequiredRole(role, minimumRole) {
  return (ROLE_ORDER[normalizeRole(role, ROLE_VIEWER)] || 0) >= (ROLE_ORDER[normalizeRole(minimumRole, ROLE_PLATFORM_ADMIN)] || 0);
}

async function deleteSessionsForEmail(store, email) {
  const sessions = await store.listJSON("session:");
  for (const item of sessions) {
    if (normalizeEmail(item?.value?.adminEmail) === normalizeEmail(email)) {
      await store.delete(item.key);
    }
  }
}

async function getSessionRecord(store, token) {
  if (!token) {
    return null;
  }

  const record = await store.getJSON(sessionKey(token));
  if (!record) {
    return null;
  }

  if (toMillis(record.expiresAt) <= Date.now()) {
    await store.delete(sessionKey(token));
    return null;
  }

  return record;
}

export async function getAuthStatus(request) {
  const store = getPersistence();
  const token = getSessionToken(request);
  const session = await getSessionRecord(store, token);
  const admin = session?.adminEmail ? await getAdminRecord(store, session.adminEmail) : null;
  const authenticatedEmail = admin ? normalizeEmail(admin.email) : "";

  return {
    authenticated: Boolean(authenticatedEmail),
    email: authenticatedEmail,
    role: admin?.role || "",
    organizationSlug: admin?.organizationSlug || "",
    campaignSlugs: Array.isArray(admin?.campaignSlugs) ? admin.campaignSlugs : [],
    sessionExpiresAt: session?.expiresAt || "",
    setupSupported: true,
  };
}

export async function requireManagerAccess(request, minimumRole = ROLE_VIEWER, unauthorizedMessage = "× ×“×¨×©×ª ×”×ª×—×‘×¨×•×ª ×ž× ×”×œ.") {
  const auth = await getAuthStatus(request);
  if (!auth?.authenticated || !auth?.email) {
    return {
      error: failureResponse(401, unauthorizedMessage),
      auth: null,
    };
  }
  if (!hasRequiredRole(auth.role, minimumRole)) {
    return {
      error: failureResponse(403, "××™×Ÿ ×”×¨×©××” ×ž×¡×¤×§×ª ×œ×‘×™×¦×•×¢ ×”×¤×¢×•×œ×” ×”×ž×‘×•×§×©×ª."),
      auth,
    };
  }
  return { auth };
}

export async function getRuntimeHealth() {
  const store = getPersistence();
  await ensureAdminSeed(store);
  const dataset = await loadAdminDatasetPayload();
  const managers = await loadManagerRecords();
  const sessions = await store.listJSON("session:");
  return {
    ok: true,
    service: "yellow-dashboard-netlify-auth",
    application: {
      status: "ok",
      runtime: isNetlifyRuntime() ? "netlify" : "local-dev-store",
    },
    persistence: {
      status: "ok",
      managerSeedCount: managers.length,
      activeSessionCount: sessions.length,
    },
    dataSource: {
      adminDatasetReady: Boolean(dataset),
      adminDatasetRows: Array.isArray(dataset?.rows) ? dataset.rows.length : 0,
    },
    time: {
      checkedAt: isoNow(),
      sessionDurationHours: SESSION_DURATION_HOURS,
    },
  };
}

export async function getAdminDataset(request) {
  const store = getPersistence();
  const access = await requireManagerAccess(request, ROLE_ANALYST, "× ×“×¨×©×ª ×”×ª×—×‘×¨×•×ª ×ž× ×”×œ ×›×“×™ ×œ×˜×¢×•×Ÿ ××ª ×”× ×ª×•× ×™× ×”× ×™×”×•×œ×™×™×.");
  if (access.error) {
    await recordAuditEvent(store, {
      type: "dataset_denied",
      email: normalizeEmail(access.auth?.email || ""),
      clientAddress: getClientAddress(request),
      userAgent: getUserAgent(request),
      outcome: "denied",
    });
    return access.error;
  }

  const payload = await loadAdminDatasetPayload();
  if (!payload) {
    return failureResponse(404, "×ž××’×¨ ×”× ×ª×•× ×™× ×”× ×™×”×•×œ×™ ×œ× ×–×ž×™×Ÿ ×›×¨×’×¢. ××¤×©×¨ ×œ×”×¢×œ×•×ª ×§×•×‘×¥ ×¢×¡×§××•×ª ×™×“× ×™×ª ×œ××—×¨ ×”×›× ×™×¡×”.");
  }

  await recordAuditEvent(store, {
    type: "dataset_view",
    email: access.auth.email,
    clientAddress: getClientAddress(request),
    userAgent: getUserAgent(request),
    outcome: "success",
  });

  return jsonResponse(200, {
    rows: Array.isArray(payload.rows) ? payload.rows : [],
    meta: payload.meta && typeof payload.meta === "object" ? payload.meta : {},
    sourceLabel: payload.sourceLabel || "×§×•×‘×¥ ×‘×¡×™×¡ ×ž××•×‘×˜×—",
    generatedAt: payload.generatedAt || "",
  });
}

export async function loginManager({ email, password, request }) {
  const normalizedEmail = normalizeEmail(email);
  const store = getPersistence();
  const clientAddress = getClientAddress(request);
  const userAgent = getUserAgent(request);

  const rateLimitResponse = await ensureNotRateLimited(store, normalizedEmail, clientAddress);
  if (rateLimitResponse) {
    await recordAuditEvent(store, {
      type: "login_blocked",
      email: normalizedEmail,
      clientAddress,
      userAgent,
      outcome: "blocked",
    });
    return rateLimitResponse;
  }

  const admin = await getAdminRecord(store, normalizedEmail);

  if (!normalizedEmail || !password) {
    return failureResponse(400, "×™×© ×œ×ž×œ× ×’× ×ž×™×™×œ ×•×’× ×¡×™×¡×ž×”.");
  }

  if (!admin || !admin.isActive) {
    await recordFailedAttempt(store, normalizedEmail, clientAddress);
    await recordAuditEvent(store, {
      type: "login_denied",
      email: normalizedEmail,
      clientAddress,
      userAgent,
      outcome: "denied",
    });
    return failureResponse(403, "×”×ž×™×™×œ ×©×”×•×–×Ÿ ××™× ×• ×ž×•×¨×©×” ×œ×’×™×©×” ×œ×¤×× ×œ ×”× ×™×”×•×œ.");
  }

  if (!admin.passwordHash) {
    await recordAuditEvent(store, {
      type: "login_setup_required",
      email: normalizedEmail,
      clientAddress,
      userAgent,
      outcome: "setup_required",
    });
    return failureResponse(
      409,
      "×–×• ×›× ×™×¡×” ×¨××©×•× ×” ×¢×‘×•×¨ ×”×ž×™×™×œ ×”×–×”. ×™×© ×œ×”×’×“×™×¨ ×¡×™×¡×ž×” ××™×©×™×ª ×œ×¤× ×™ ×›× ×™×¡×”.",
      { code: "setup_required", setupRequired: true },
    );
  }

  if (!verifyPassword(password, admin.passwordHash)) {
    const failedAttempt = await recordFailedAttempt(store, normalizedEmail, clientAddress);
    await recordAuditEvent(store, {
      type: "login_failed",
      email: normalizedEmail,
      clientAddress,
      userAgent,
      outcome: "invalid_password",
      detail: failedAttempt.count >= MAX_AUTH_ATTEMPTS ? "locked" : "",
    });
    return failureResponse(401, "×”×¡×™×¡×ž×” ×©×’×•×™×”. × ×¡×• ×©×•×‘.");
  }

  const now = isoNow();
  const expiresAt = new Date(Date.now() + SESSION_DURATION_HOURS * 60 * 60 * 1000).toISOString();
  const token = randomBytes(32).toString("base64url");
  admin.lastLoginAt = now;

  await clearFailedAttempts(store, normalizedEmail, clientAddress);
  await saveAdminRecord(store, admin);
  await store.setJSON(sessionKey(token), {
    token,
    adminEmail: normalizedEmail,
    createdAt: now,
    expiresAt,
  });
  await recordAuditEvent(store, {
    type: "login_success",
    email: normalizedEmail,
    clientAddress,
    userAgent,
    outcome: "success",
  });

  return successResponse(
    {
      authenticated: true,
      email: normalizedEmail,
      message: "×”×›× ×™×¡×” ×”×¦×œ×™×—×”. ×”×“×©×‘×•×¨×“ ×”× ×™×”×•×œ×™ × ×¤×ª×—.",
    },
    request.url,
    token,
  );
}

export async function setupManagerPassword({ email, password, confirmPassword, request }) {
  const normalizedEmail = normalizeEmail(email);
  const store = getPersistence();
  const clientAddress = getClientAddress(request);
  const userAgent = getUserAgent(request);

  const rateLimitResponse = await ensureNotRateLimited(store, normalizedEmail, clientAddress);
  if (rateLimitResponse) {
    await recordAuditEvent(store, {
      type: "setup_blocked",
      email: normalizedEmail,
      clientAddress,
      userAgent,
      outcome: "blocked",
    });
    return rateLimitResponse;
  }

  const admin = await getAdminRecord(store, normalizedEmail);

  if (!normalizedEmail || !password || !confirmPassword) {
    return failureResponse(400, "×™×© ×œ×ž×œ× ×ž×™×™×œ, ×¡×™×¡×ž×” ×•××™×ž×•×ª ×¡×™×¡×ž×”.");
  }

  if (!admin || !admin.isActive) {
    await recordFailedAttempt(store, normalizedEmail, clientAddress);
    await recordAuditEvent(store, {
      type: "setup_denied",
      email: normalizedEmail,
      clientAddress,
      userAgent,
      outcome: "denied",
    });
    return failureResponse(403, "×”×ž×™×™×œ ×©×”×•×–×Ÿ ××™× ×• ×ž×•×¨×©×” ×œ×”×’×“×™×¨ ×’×™×©×ª ×ž× ×”×œ.");
  }

  if (password !== confirmPassword) {
    return failureResponse(400, "××™×ž×•×ª ×”×¡×™×¡×ž×” ×œ× ×ª×•××.");
  }

  if (password.length < 8) {
    return failureResponse(400, "×™×© ×œ×‘×—×•×¨ ×¡×™×¡×ž×” ×‘××•×¨×š 8 ×ª×•×•×™× ×œ×¤×—×•×ª.");
  }

  if (admin.passwordHash) {
    return failureResponse(409, "×›×‘×¨ ×”×•×’×“×¨×” ×¡×™×¡×ž×” ×¢×‘×•×¨ ×”×ž×™×™×œ ×”×–×”. × ×™×ª×Ÿ ×œ×¢×‘×•×¨ ×œ×ž×¡×š ×”×›× ×™×¡×” ×”×¨×’×™×œ.");
  }

  const now = isoNow();
  const expiresAt = new Date(Date.now() + SESSION_DURATION_HOURS * 60 * 60 * 1000).toISOString();
  const token = randomBytes(32).toString("base64url");

  admin.passwordHash = hashPassword(password);
  admin.passwordSetAt = now;
  admin.lastLoginAt = now;

  await clearFailedAttempts(store, normalizedEmail, clientAddress);
  await saveAdminRecord(store, admin);
  await store.setJSON(sessionKey(token), {
    token,
    adminEmail: normalizedEmail,
    createdAt: now,
    expiresAt,
  });
  await recordAuditEvent(store, {
    type: "setup_success",
    email: normalizedEmail,
    clientAddress,
    userAgent,
    outcome: "success",
  });

  return successResponse(
    {
      authenticated: true,
      email: normalizedEmail,
      message: "×”×¡×™×¡×ž×” × ×©×ž×¨×” ×•×”×’×™×©×” ×œ×¤×× ×œ ×”× ×™×”×•×œ × ×¤×ª×—×”.",
    },
    request.url,
    token,
  );
}

export async function logoutManager(request) {
  const token = getSessionToken(request);
  const store = getPersistence();
  const session = await getSessionRecord(store, token);

  if (token) {
    await store.delete(sessionKey(token));
  }
  await recordAuditEvent(store, {
    type: "logout",
    email: normalizeEmail(session?.adminEmail || ""),
    clientAddress: getClientAddress(request),
    userAgent: getUserAgent(request),
    outcome: "success",
  });

  return jsonResponse(
    200,
    { loggedOut: true },
    {
      "Set-Cookie": buildCookieValue("", request.url, 0),
    },
  );
}

export function getSessionToken(request) {
  const cookieHeader = request.headers.get("cookie") || "";
  const cookiePairs = cookieHeader.split(";").map((part) => part.trim()).filter(Boolean);
  for (const pair of cookiePairs) {
    const [name, ...rest] = pair.split("=");
    if (name === SESSION_COOKIE_NAME) {
      return rest.join("=");
    }
  }
  return "";
}

export function jsonResponse(status, payload, extraHeaders = {}) {
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...extraHeaders,
  });

  return new Response(JSON.stringify(payload), { status, headers });
}

function failureResponse(status, message, extraPayload = {}, extraHeaders = {}) {
  return jsonResponse(
    status,
    {
      message,
      ...extraPayload,
    },
    extraHeaders,
  );
}

function successResponse(payload, requestUrl, token) {
  return jsonResponse(200, payload, {
    "Set-Cookie": buildCookieValue(token, requestUrl, SESSION_DURATION_HOURS * 60 * 60),
  });
}
