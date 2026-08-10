import { getStore } from "@netlify/blobs";
import { pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEV_STORE_PATH = resolve(ROOT_DIR, "work", "data", "netlify-auth-dev.json");
const ADMIN_DATASET_PATH = resolve(ROOT_DIR, "netlify", "data", "admin-dataset.json");
const STORE_NAME = "yellow-dashboard-auth";
const SESSION_COOKIE_NAME = "yellow_dashboard_admin_session";
const SESSION_DURATION_HOURS = 24 * 30;
const PASSWORD_ITERATIONS = 200_000;
const MAX_AUTH_ATTEMPTS = 5;
const AUTH_WINDOW_MS = 15 * 60 * 1000;
const AUTH_LOCKOUT_MS = 20 * 60 * 1000;
const DEFAULT_MANAGER_EMAILS = [
  "noamfrostig@gmail.com",
  "themoti@gmail.com",
  "Moranmta@gmail.com",
  "4337579@gmail.com",
  "rasherov@gmail.com",
  "ranbo7@gmail.com",
  "shaywolf251996@gmail.com",
  "Dinofek@gmail.com",
  "Yafit.neveshalev@gmail.com",
  "Yovelk11@gmail.com",
  "Lalobenny@gmail.com",
  "aharonayal@gmail.com",
];

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
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

function parseManagerEmails(rawValue) {
  const raw = String(rawValue || "").trim();
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((value) => normalizeEmail(value)).filter(Boolean);
    }
  } catch {
    return raw
      .split(",")
      .map((value) => normalizeEmail(value))
      .filter(Boolean);
  }

  return [];
}

function uniqueEmails(emails) {
  return Array.from(new Set(emails.map((value) => normalizeEmail(value)).filter(Boolean)));
}

export function loadManagerEmails() {
  const envEmails = parseManagerEmails(process.env.YELLOW_DASHBOARD_MANAGER_EMAILS);
  if (envEmails.length > 0) {
    return uniqueEmails(envEmails);
  }

  return uniqueEmails(DEFAULT_MANAGER_EMAILS);
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
      "יותר מדי ניסיונות התחברות. נסו שוב בעוד מספר דקות.",
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
  for (const email of loadManagerEmails()) {
    const key = adminKey(email);
    const existing = await store.getJSON(key);
    if (!existing) {
      await store.setJSON(key, {
        email,
        isActive: true,
        createdAt,
        passwordHash: "",
        passwordSetAt: "",
        lastLoginAt: "",
      });
    }
  }
}

async function getAdminRecord(store, email) {
  await ensureAdminSeed(store);
  return store.getJSON(adminKey(email));
}

async function saveAdminRecord(store, record) {
  await store.setJSON(adminKey(record.email), record);
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
  const authenticatedEmail = session ? normalizeEmail(session.adminEmail) : "";

  return {
    authenticated: Boolean(authenticatedEmail),
    email: authenticatedEmail,
    setupSupported: true,
  };
}

export async function getAdminDataset(request) {
  const store = getPersistence();
  const token = getSessionToken(request);
  const session = await getSessionRecord(store, token);
  if (!session?.adminEmail) {
    return failureResponse(401, "נדרשת התחברות מנהל כדי לטעון את הנתונים הניהוליים.");
  }

  const payload = await loadAdminDatasetPayload();
  if (!payload) {
    return failureResponse(404, "מאגר הנתונים הניהולי לא זמין כרגע. אפשר להעלות קובץ עסקאות ידנית לאחר הכניסה.");
  }

  return jsonResponse(200, {
    rows: Array.isArray(payload.rows) ? payload.rows : [],
    meta: payload.meta && typeof payload.meta === "object" ? payload.meta : {},
    sourceLabel: payload.sourceLabel || "קובץ בסיס מאובטח",
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
    return failureResponse(400, "יש למלא גם מייל וגם סיסמה.");
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
    return failureResponse(403, "המייל שהוזן אינו מורשה לגישה לפאנל הניהול.");
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
      "זו כניסה ראשונה עבור המייל הזה. יש להגדיר סיסמה אישית לפני כניסה.",
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
    return failureResponse(401, "הסיסמה שגויה. נסו שוב.");
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
      message: "הכניסה הצליחה. הדשבורד הניהולי נפתח.",
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
    return failureResponse(400, "יש למלא מייל, סיסמה ואימות סיסמה.");
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
    return failureResponse(403, "המייל שהוזן אינו מורשה להגדיר גישת מנהל.");
  }

  if (password !== confirmPassword) {
    return failureResponse(400, "אימות הסיסמה לא תואם.");
  }

  if (password.length < 8) {
    return failureResponse(400, "יש לבחור סיסמה באורך 8 תווים לפחות.");
  }

  if (admin.passwordHash) {
    return failureResponse(409, "כבר הוגדרה סיסמה עבור המייל הזה. ניתן לעבור למסך הכניסה הרגיל.");
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
      message: "הסיסמה נשמרה והגישה לפאנל הניהול נפתחה.",
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
