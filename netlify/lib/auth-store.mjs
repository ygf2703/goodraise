import { getStore } from "@netlify/blobs";
import { pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEV_STORE_PATH = resolve(ROOT_DIR, "work", "data", "netlify-auth-dev.json");
const STORE_NAME = "yellow-dashboard-auth";
const SESSION_COOKIE_NAME = "yellow_dashboard_admin_session";
const SESSION_DURATION_HOURS = 12;
const PASSWORD_ITERATIONS = 200_000;
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

function getPersistence() {
  if (process.env.NETLIFY || process.env.NETLIFY_LOCAL) {
    return createBlobStore();
  }

  return createFileStore();
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

export async function loginManager({ email, password, requestUrl }) {
  const normalizedEmail = normalizeEmail(email);
  const store = getPersistence();
  const admin = await getAdminRecord(store, normalizedEmail);

  if (!normalizedEmail || !password) {
    return failureResponse(400, "יש למלא גם מייל וגם סיסמה.");
  }

  if (!admin || !admin.isActive) {
    return failureResponse(403, "המייל שהוזן אינו מורשה לגישה לפאנל הניהול.");
  }

  if (!admin.passwordHash) {
    return failureResponse(
      409,
      "זו כניסה ראשונה עבור המייל הזה. יש להגדיר סיסמה אישית לפני כניסה.",
      { code: "setup_required", setupRequired: true },
    );
  }

  if (!verifyPassword(password, admin.passwordHash)) {
    return failureResponse(401, "הסיסמה שגויה. נסו שוב.");
  }

  const now = isoNow();
  const expiresAt = new Date(Date.now() + SESSION_DURATION_HOURS * 60 * 60 * 1000).toISOString();
  const token = randomBytes(32).toString("base64url");
  admin.lastLoginAt = now;

  await saveAdminRecord(store, admin);
  await store.setJSON(sessionKey(token), {
    token,
    adminEmail: normalizedEmail,
    createdAt: now,
    expiresAt,
  });

  return successResponse(
    {
      authenticated: true,
      email: normalizedEmail,
      message: "הכניסה הצליחה. הדשבורד הניהולי נפתח.",
    },
    requestUrl,
    token,
  );
}

export async function setupManagerPassword({ email, password, confirmPassword, requestUrl }) {
  const normalizedEmail = normalizeEmail(email);
  const store = getPersistence();
  const admin = await getAdminRecord(store, normalizedEmail);

  if (!normalizedEmail || !password || !confirmPassword) {
    return failureResponse(400, "יש למלא מייל, סיסמה ואימות סיסמה.");
  }

  if (!admin || !admin.isActive) {
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

  await saveAdminRecord(store, admin);
  await store.setJSON(sessionKey(token), {
    token,
    adminEmail: normalizedEmail,
    createdAt: now,
    expiresAt,
  });

  return successResponse(
    {
      authenticated: true,
      email: normalizedEmail,
      message: "הסיסמה נשמרה והגישה לפאנל הניהול נפתחה.",
    },
    requestUrl,
    token,
  );
}

export async function logoutManager(request) {
  const token = getSessionToken(request);
  const store = getPersistence();

  if (token) {
    await store.delete(sessionKey(token));
  }

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

function failureResponse(status, message, extraPayload = {}) {
  return jsonResponse(status, {
    message,
    ...extraPayload,
  });
}

function successResponse(payload, requestUrl, token) {
  return jsonResponse(200, payload, {
    "Set-Cookie": buildCookieValue(token, requestUrl, SESSION_DURATION_HOURS * 60 * 60),
  });
}
