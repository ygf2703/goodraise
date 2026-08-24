import { pbkdf2Sync, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { authorize } from "./authorization.mjs";
import {
  ROLE_ANALYST,
  ROLE_PLATFORM_ADMIN,
  ROLE_VIEWER,
  isoNow,
  normalizeEmail,
  normalizeRole,
  normalizeSlug,
  normalizeStableId,
} from "./multi-tenant-model.mjs";
import { createPlatformStore } from "./platform-store.mjs";
import { normalizePostgresConnectionString, shouldRunRuntimeSchemaMigrations } from "./postgres-connection.mjs";
import {
  appendAuditEvent,
  buildCampaignContext,
  ensureMultiTenantMigration,
  getCampaign,
  getOrganization,
  listCampaignSummaries,
} from "./campaign-repositories.mjs";

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEV_STORE_PATH = resolve(ROOT_DIR, "work", "data", "netlify-auth-dev.json");
const LOCAL_ACCESS_CONTROL_PATH = resolve(ROOT_DIR, "work", "config", "dashboard-access.local.json");
const EXAMPLE_ACCESS_CONTROL_PATH = resolve(ROOT_DIR, "work", "config", "dashboard-access.example.json");
const STORE_NAME = "yellow-dashboard-auth";
const SESSION_COOKIE_NAME = "yellow_dashboard_admin_session";
const SESSION_DURATION_HOURS = 24 * 30;
const PASSWORD_ITERATIONS = 200_000;
const MAX_AUTH_ATTEMPTS = 5;
const AUTH_WINDOW_MS = 15 * 60 * 1000;
const AUTH_LOCKOUT_MS = 20 * 60 * 1000;
const POSTGRES_AUTH_SCHEMA_SQL = `
CREATE SCHEMA IF NOT EXISTS goodraise;

CREATE TABLE IF NOT EXISTS goodraise.admin_users (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'platform_admin',
  organization_app_id TEXT NOT NULL DEFAULT '',
  organization_slug TEXT NOT NULL DEFAULT '',
  campaign_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  campaign_slugs JSONB NOT NULL DEFAULT '[]'::jsonb,
  password_hash TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  password_set_at TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS goodraise.admin_sessions (
  token TEXT PRIMARY KEY,
  admin_user_id UUID NOT NULL REFERENCES goodraise.admin_users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_users_role ON goodraise.admin_users(role);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_user ON goodraise.admin_sessions(admin_user_id);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires ON goodraise.admin_sessions(expires_at);
`;

let postgresPoolPromise = null;
let postgresSchemaPromise = null;

function getPersistence() {
  return createPlatformStore({
    storeName: STORE_NAME,
    devStorePath: DEV_STORE_PATH,
  });
}

function getDatabaseUrl() {
  return String(process.env.GOODRAISE_DATABASE_URL || process.env.DATABASE_URL || "").trim();
}

function usesPostgresAuthStore() {
  return Boolean(getDatabaseUrl());
}

async function getPostgresPool() {
  if (!postgresPoolPromise) {
    postgresPoolPromise = import("pg").then(({ Pool }) => {
      const connectionString = normalizePostgresConnectionString(getDatabaseUrl());
      if (!connectionString) {
        throw new Error("GOODRAISE_DATABASE_URL is not configured.");
      }
      return new Pool({
        connectionString,
        max: 4,
        idleTimeoutMillis: 10_000,
        connectionTimeoutMillis: 10_000,
      });
    });
  }
  return postgresPoolPromise;
}

async function ensurePostgresAuthSchema() {
  if (!usesPostgresAuthStore()) {
    return;
  }
  if (!postgresSchemaPromise) {
    postgresSchemaPromise = (async () => {
      const pool = await getPostgresPool();
      const client = await pool.connect();
      try {
        if (shouldRunRuntimeSchemaMigrations()) {
          await client.query(POSTGRES_AUTH_SCHEMA_SQL);
        } else {
          await client.query("SELECT 1");
        }
      } finally {
        client.release();
      }
    })();
  }
  return postgresSchemaPromise;
}

async function withPostgresClient(callback) {
  await ensurePostgresAuthSchema();
  const pool = await getPostgresPool();
  const client = await pool.connect();
  try {
    return await callback(client);
  } finally {
    client.release();
  }
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
      return parsed.map((value) => normalizeManagerRecord(value)).filter(Boolean);
    }
  } catch {
    return raw
      .split(",")
      .map((value) => normalizeManagerRecord(value))
      .filter(Boolean);
  }
  return [];
}

function normalizeCampaignScope(values) {
  if (Array.isArray(values)) {
    return values.map((value) => normalizeStableId(value)).filter(Boolean);
  }
  if (typeof values === "string" && values.trim()) {
    return values
      .split(",")
      .map((value) => normalizeStableId(value))
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
      organizationId: "",
      organizationSlug: "",
      campaignIds: [],
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

  const organizationSlug = normalizeSlug(value.organizationSlug || value.organizationId || "");
  const organizationId = normalizeStableId(value.organizationId || organizationSlug || "");
  const campaignIds = normalizeCampaignScope(value.campaignIds || value.campaignSlugs);
  const campaignSlugs = Array.isArray(value.campaignSlugs)
    ? value.campaignSlugs.map((item) => normalizeSlug(item)).filter(Boolean)
    : typeof value.campaignSlugs === "string"
      ? value.campaignSlugs.split(",").map((item) => normalizeSlug(item)).filter(Boolean)
      : [];

  return {
    email,
    role: normalizeRole(value.role, ROLE_PLATFORM_ADMIN),
    organizationId,
    organizationSlug,
    campaignIds,
    campaignSlugs,
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
    return candidateDigest.length === expectedDigest.length && timingSafeEqual(candidateDigest, expectedDigest);
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
  const sameWindow = existing && now - toMillis(existing.windowStartedAt) <= AUTH_WINDOW_MS;
  const windowStartedAt = sameWindow ? existing.windowStartedAt : new Date(now).toISOString();
  const count = sameWindow ? Number(existing.count || 0) + 1 : 1;
  const blockedUntil = count >= MAX_AUTH_ATTEMPTS ? new Date(now + AUTH_LOCKOUT_MS).toISOString() : existing?.blockedUntil || "";
  await store.setJSON(key, {
    email: normalizeEmail(email),
    clientAddress,
    count,
    windowStartedAt,
    blockedUntil,
  });
  return { count, blockedUntil };
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
      { code: "rate_limited", retryAfterSeconds },
      { "retry-after": String(retryAfterSeconds) },
    );
  }
  return null;
}

async function ensureAdminSeed(store) {
  if (usesPostgresAuthStore()) {
    const createdAt = isoNow();
    const managers = await loadManagerRecords();
    await withPostgresClient(async (client) => {
      for (const manager of managers) {
        await client.query(
          `
            INSERT INTO goodraise.admin_users (
              id,
              email,
              role,
              organization_app_id,
              organization_slug,
              campaign_ids,
              campaign_slugs,
              is_active,
              created_at,
              updated_at
            )
            VALUES ($1::uuid, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10)
            ON CONFLICT (email) DO UPDATE SET
              role = EXCLUDED.role,
              organization_app_id = EXCLUDED.organization_app_id,
              organization_slug = EXCLUDED.organization_slug,
              campaign_ids = EXCLUDED.campaign_ids,
              campaign_slugs = EXCLUDED.campaign_slugs,
              is_active = EXCLUDED.is_active,
              updated_at = EXCLUDED.updated_at
          `,
          [
            randomUUID(),
            manager.email,
            manager.role,
            manager.organizationId || "",
            manager.organizationSlug || "",
            JSON.stringify(manager.campaignIds || []),
            JSON.stringify(manager.campaignSlugs || []),
            manager.isActive !== false,
            createdAt,
            createdAt,
          ],
        );
      }
    });
    return;
  }
  const createdAt = isoNow();
  for (const manager of await loadManagerRecords()) {
    const existing = await store.getJSON(adminKey(manager.email));
    await store.setJSON(adminKey(manager.email), {
      email: manager.email,
      role: manager.role,
      organizationId: manager.organizationId,
      organizationSlug: manager.organizationSlug,
      campaignIds: manager.campaignIds,
      campaignSlugs: manager.campaignSlugs,
      isActive: manager.isActive,
      createdAt: existing?.createdAt || createdAt,
      passwordHash: existing?.passwordHash || "",
      passwordSetAt: existing?.passwordSetAt || "",
      lastLoginAt: existing?.lastLoginAt || "",
    });
  }
}

function normalizeAdminRecord(record) {
  if (!record) {
    return null;
  }
  return {
    email: normalizeEmail(record.email),
    role: normalizeRole(record.role, ROLE_PLATFORM_ADMIN),
    organizationId: normalizeStableId(record.organizationAppId || record.organizationId || ""),
    organizationSlug: normalizeSlug(record.organizationSlug || ""),
    campaignIds: Array.isArray(record.campaignIds) ? record.campaignIds.map((item) => normalizeStableId(item)).filter(Boolean) : [],
    campaignSlugs: Array.isArray(record.campaignSlugs) ? record.campaignSlugs.map((item) => normalizeSlug(item)).filter(Boolean) : [],
    isActive: record.isActive !== false,
    createdAt: record.createdAt || "",
    updatedAt: record.updatedAt || "",
    passwordHash: String(record.passwordHash || ""),
    passwordSetAt: record.passwordSetAt || "",
    lastLoginAt: record.lastLoginAt || "",
  };
}

async function getAdminRecord(store, email) {
  await ensureAdminSeed(store);
  if (usesPostgresAuthStore()) {
    return withPostgresClient(async (client) => {
      const result = await client.query(
        `
          SELECT
            email,
            role,
            organization_app_id,
            organization_slug,
            campaign_ids,
            campaign_slugs,
            password_hash,
            is_active,
            created_at,
            updated_at,
            password_set_at,
            last_login_at
          FROM goodraise.admin_users
          WHERE lower(email) = lower($1)
          LIMIT 1
        `,
        [normalizeEmail(email)],
      );
      const row = result.rows[0];
      if (!row) {
        return null;
      }
      return normalizeAdminRecord({
        email: row.email,
        role: row.role,
        organizationAppId: row.organization_app_id,
        organizationSlug: row.organization_slug,
        campaignIds: row.campaign_ids || [],
        campaignSlugs: row.campaign_slugs || [],
        passwordHash: row.password_hash || "",
        isActive: row.is_active !== false,
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at || ""),
        updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at || ""),
        passwordSetAt: row.password_set_at instanceof Date ? row.password_set_at.toISOString() : String(row.password_set_at || ""),
        lastLoginAt: row.last_login_at instanceof Date ? row.last_login_at.toISOString() : String(row.last_login_at || ""),
      });
    });
  }
  return store.getJSON(adminKey(email));
}

async function saveAdminRecord(store, record) {
  if (usesPostgresAuthStore()) {
    const normalized = normalizeAdminRecord(record);
    if (!normalized) {
      return;
    }
    await withPostgresClient(async (client) => {
      await client.query(
        `
          UPDATE goodraise.admin_users
          SET role = $2,
              organization_app_id = $3,
              organization_slug = $4,
              campaign_ids = $5::jsonb,
              campaign_slugs = $6::jsonb,
              password_hash = $7,
              is_active = $8,
              updated_at = $9,
              password_set_at = NULLIF($10, '')::timestamptz,
              last_login_at = NULLIF($11, '')::timestamptz
          WHERE lower(email) = lower($1)
        `,
        [
          normalized.email,
          normalized.role,
          normalized.organizationId || "",
          normalized.organizationSlug || "",
          JSON.stringify(normalized.campaignIds || []),
          JSON.stringify(normalized.campaignSlugs || []),
          normalized.passwordHash || null,
          normalized.isActive !== false,
          isoNow(),
          normalized.passwordSetAt || "",
          normalized.lastLoginAt || "",
        ],
      );
    });
    return;
  }
  await store.setJSON(adminKey(record.email), record);
}

async function deleteSessionsForEmail(store, email) {
  if (usesPostgresAuthStore()) {
    await withPostgresClient(async (client) => {
      await client.query(
        `
          DELETE FROM goodraise.admin_sessions
          WHERE admin_user_id IN (
            SELECT id FROM goodraise.admin_users WHERE lower(email) = lower($1)
          )
        `,
        [normalizeEmail(email)],
      );
    });
    return;
  }
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
  if (usesPostgresAuthStore()) {
    return withPostgresClient(async (client) => {
      await client.query("DELETE FROM goodraise.admin_sessions WHERE expires_at <= NOW()");
      const result = await client.query(
        `
          SELECT s.token, u.email AS admin_email, s.created_at, s.expires_at
          FROM goodraise.admin_sessions s
          JOIN goodraise.admin_users u ON u.id = s.admin_user_id
          WHERE s.token = $1 AND u.is_active = TRUE
          LIMIT 1
        `,
        [token],
      );
      const row = result.rows[0];
      if (!row) {
        return null;
      }
      return {
        token: row.token,
        adminEmail: normalizeEmail(row.admin_email || ""),
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at || ""),
        expiresAt: row.expires_at instanceof Date ? row.expires_at.toISOString() : String(row.expires_at || ""),
      };
    });
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

async function createSessionRecord(store, email, token, createdAt, expiresAt) {
  if (usesPostgresAuthStore()) {
    await withPostgresClient(async (client) => {
      const result = await client.query(
        "SELECT id::text FROM goodraise.admin_users WHERE lower(email) = lower($1) LIMIT 1",
        [normalizeEmail(email)],
      );
      const adminUserId = result.rows[0]?.id;
      if (!adminUserId) {
        throw new Error(`Admin user not found for session creation: ${email}`);
      }
      await client.query(
        `
          INSERT INTO goodraise.admin_sessions (token, admin_user_id, created_at, expires_at)
          VALUES ($1, $2::uuid, $3, $4)
        `,
        [token, adminUserId, createdAt, expiresAt],
      );
    });
    return;
  }
  await store.setJSON(sessionKey(token), {
    token,
    adminEmail: normalizeEmail(email),
    createdAt,
    expiresAt,
  });
}

async function deleteSessionRecord(store, token) {
  if (!token) {
    return;
  }
  if (usesPostgresAuthStore()) {
    await withPostgresClient(async (client) => {
      await client.query("DELETE FROM goodraise.admin_sessions WHERE token = $1", [token]);
    });
    return;
  }
  await store.delete(sessionKey(token));
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
  return jsonResponse(status, { message, ...extraPayload }, extraHeaders);
}

function successResponse(payload, requestUrl, token) {
  return jsonResponse(200, payload, {
    "Set-Cookie": buildCookieValue(token, requestUrl, SESSION_DURATION_HOURS * 60 * 60),
  });
}

function filterAccessibleCampaignSummaries(auth, summaries) {
  if (!auth?.authenticated) {
    return [];
  }
  const role = normalizeRole(auth.role, ROLE_VIEWER);
  if (role === ROLE_PLATFORM_ADMIN) {
    return summaries;
  }
  const organizationSlug = String(auth.organizationSlug || "").trim().toLowerCase();
  const allowedCampaigns = new Set(
    [...(auth.campaignIds || []), ...(auth.campaignSlugs || [])]
      .map((value) => normalizeStableId(value))
      .filter(Boolean),
  );
  return summaries.filter((item) => {
    if (organizationSlug && String(item.organizationSlug || "").trim().toLowerCase() !== organizationSlug) {
      return false;
    }
    if (role === "organization_admin") {
      return true;
    }
    if (!allowedCampaigns.size) {
      return false;
    }
    return allowedCampaigns.has(normalizeStableId(item.campaignId)) || allowedCampaigns.has(normalizeStableId(item.campaignSlug));
  });
}

async function getAccessibleCampaignSummaries(auth) {
  const summaries = await listCampaignSummaries();
  return filterAccessibleCampaignSummaries(auth, summaries).map((item) => ({
    ...item,
    organizationSlug: item.organizationSlug || normalizeSlug(item.organizationName || ""),
  }));
}

export async function getAuthStatus(request) {
  const store = getPersistence();
  const token = getSessionToken(request);
  const session = await getSessionRecord(store, token);
  const admin = session?.adminEmail ? await getAdminRecord(store, session.adminEmail) : null;
  const authenticatedEmail = admin ? normalizeEmail(admin.email) : "";
  const auth = {
    authenticated: Boolean(authenticatedEmail),
    email: authenticatedEmail,
    role: admin?.role || "",
    organizationId: admin?.organizationId || "",
    organizationSlug: admin?.organizationSlug || "",
    campaignIds: Array.isArray(admin?.campaignIds) ? admin.campaignIds : [],
    campaignSlugs: Array.isArray(admin?.campaignSlugs) ? admin.campaignSlugs : [],
    sessionExpiresAt: session?.expiresAt || "",
    setupSupported: true,
  };
  if (!auth.authenticated) {
    return auth;
  }
  const accessibleCampaigns = await getAccessibleCampaignSummaries(auth);
  return {
    ...auth,
    accessibleCampaigns,
  };
}

export async function requireManagerAccess(request, minimumRole = ROLE_VIEWER, unauthorizedMessage = "נדרשת התחברות מנהל.") {
  const auth = await getAuthStatus(request);
  if (!auth?.authenticated || !auth?.email) {
    return {
      error: failureResponse(401, unauthorizedMessage),
      auth: null,
    };
  }
  if (normalizeRole(auth.role, ROLE_VIEWER) === ROLE_VIEWER && minimumRole !== ROLE_VIEWER) {
    return {
      error: failureResponse(403, "אין הרשאה מספקת לביצוע הפעולה המבוקשת."),
      auth,
    };
  }
  return { auth };
}

function resolveQueryScope(request) {
  const url = new URL(request.url);
  return {
    organizationId: normalizeStableId(url.searchParams.get("organizationId") || ""),
    campaignId: normalizeStableId(url.searchParams.get("campaignId") || ""),
  };
}

export async function resolveScopedAccess(request, options = {}) {
  await ensureMultiTenantMigration();
  const baseAccess = await requireManagerAccess(request, ROLE_VIEWER, options.unauthorizedMessage);
  if (baseAccess.error) {
    return baseAccess;
  }

  const auth = baseAccess.auth;
  const summaries = await getAccessibleCampaignSummaries(auth);
  const requestedOrganizationId = normalizeStableId(options.organizationId || resolveQueryScope(request).organizationId || "");
  const requestedCampaignId = normalizeStableId(options.campaignId || resolveQueryScope(request).campaignId || "");
  const hasExplicitScope = Boolean(requestedOrganizationId || requestedCampaignId);
  const matchedSummary =
    summaries.find((item) => {
      const campaignMatch = requestedCampaignId
        ? normalizeStableId(item.campaignId) === requestedCampaignId || normalizeStableId(item.campaignSlug) === requestedCampaignId
        : true;
      const organizationMatch = requestedOrganizationId
        ? normalizeStableId(item.organizationId) === requestedOrganizationId
        : true;
      return campaignMatch && organizationMatch;
    }) || null;
  const selectedSummary = matchedSummary || (!hasExplicitScope ? summaries[0] || null : null);

  if (hasExplicitScope && !matchedSummary) {
    const requestedOrganization = requestedOrganizationId ? await getOrganization(requestedOrganizationId) : null;
    const requestedCampaign = requestedOrganizationId && requestedCampaignId
      ? await getCampaign(requestedOrganizationId, requestedCampaignId)
      : null;
    const resourceExists = Boolean(requestedCampaign || requestedOrganization);
    return {
      error: failureResponse(resourceExists ? 403 : 404, resourceExists ? "אין הרשאה לקמפיין או לארגון המבוקש." : "הקמפיין המבוקש אינו קיים."),
      auth,
    };
  }

  if (!selectedSummary) {
    return {
      error: failureResponse(404, "לא נמצא קמפיין זמין עבור המשתמש המחובר."),
      auth,
    };
  }

  const organization = await getOrganization(selectedSummary.organizationId);
  const campaign = await getCampaign(selectedSummary.organizationId, selectedSummary.campaignId);
  if (!organization || !campaign) {
    return {
      error: failureResponse(404, "הקמפיין המבוקש אינו קיים."),
      auth,
    };
  }

  const authorization = authorize(auth, options.action || "campaign_view", organization, campaign);
  if (!authorization.ok) {
    await appendAuditEvent({
      user: auth.email,
      role: auth.role,
      organizationId: organization.id,
      campaignId: campaign.id,
      action: "unauthorized_campaign_access",
      outcome: "denied",
      detail: {
        requestedAction: options.action || "campaign_view",
      },
    });
    return {
      error: failureResponse(authorization.status, authorization.message),
      auth,
    };
  }

  return {
    auth,
    organization,
    campaign,
    accessibleCampaigns: summaries,
  };
}

export async function getRuntimeHealth() {
  const store = getPersistence();
  await ensureAdminSeed(store);
  const sessions = usesPostgresAuthStore()
    ? await withPostgresClient(async (client) => {
        const result = await client.query("SELECT COUNT(*)::int AS total FROM goodraise.admin_sessions WHERE expires_at > NOW()");
        return Array.from({ length: Number(result.rows[0]?.total || 0) }, () => null);
      })
    : await store.listJSON("session:");
  const managers = await loadManagerRecords();
  const summaries = await listCampaignSummaries();
  const migration = await ensureMultiTenantMigration();
  const liveCampaigns = summaries.filter((item) => item.status === "live").length;
  return {
    ok: true,
    service: "goodraise-multi-tenant-auth",
    application: {
      status: "ok",
      runtime: process.env.NETLIFY || process.env.NETLIFY_LOCAL ? "netlify" : "local-dev-store",
    },
    persistence: {
      status: "ok",
      managerSeedCount: managers.length,
      activeSessionCount: sessions.length,
      campaignCount: summaries.length,
      liveCampaignCount: liveCampaigns,
      organizationCount: new Set(summaries.map((item) => item.organizationId)).size,
    },
    migration,
    time: {
      checkedAt: isoNow(),
      sessionDurationHours: SESSION_DURATION_HOURS,
    },
  };
}

export async function getAdminDataset(request, scope = {}) {
  const store = getPersistence();
  const access = await resolveScopedAccess(request, {
    action: "dataset_view",
    organizationId: scope.organizationId,
    campaignId: scope.campaignId,
    unauthorizedMessage: "נדרשת התחברות מנהל כדי לטעון את הנתונים הניהוליים.",
  });
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

  const context = await buildCampaignContext(access.organization.id, access.campaign.id);
  if (!context?.dataset) {
    return failureResponse(404, "מאגר הנתונים הניהולי לקמפיין המבוקש אינו זמין כרגע.");
  }

  await recordAuditEvent(store, {
    type: "dataset_view",
    email: access.auth.email,
    clientAddress: getClientAddress(request),
    userAgent: getUserAgent(request),
    outcome: "success",
  });
  await appendAuditEvent({
    user: access.auth.email,
    role: access.auth.role,
    organizationId: access.organization.id,
    campaignId: access.campaign.id,
    action: "dataset_view",
    outcome: "success",
  });

  return jsonResponse(200, {
    organizationId: access.organization.id,
    campaignId: access.campaign.id,
    organization: access.organization,
    campaign: access.campaign,
    rows: Array.isArray(context.dataset.rows) ? context.dataset.rows : [],
    meta: context.dataset.meta && typeof context.dataset.meta === "object" ? context.dataset.meta : {},
    sourceLabel: context.dataset.sourceLabel || "קובץ בסיס מאובטח",
    generatedAt: context.dataset.generatedAt || "",
  });
}

function buildPublicDatasetRows(rows = []) {
  return rows.map((row) => ({
    id: row?.id || "",
    createdIso: row?.createdIso || "",
    date: row?.date || "",
    hour: Number(row?.hour || 0),
    email: "",
    donor: "מוסתר בצפייה ציבורית",
    ambassador: row?.ambassador || "",
    amount: Number(row?.amount || 0),
    city: "",
    status: row?.status || "",
    chargeResult: "",
  }));
}

export async function getPublicDataset(scope = {}) {
  const organizationId = normalizeStableId(scope.organizationId || "");
  const campaignId = normalizeStableId(scope.campaignId || "");
  if (!organizationId || !campaignId) {
    return failureResponse(400, "חסרים organizationId או campaignId לטעינת התצוגה הציבורית.");
  }

  const context = await buildCampaignContext(organizationId, campaignId);
  if (!context?.dataset) {
    return failureResponse(404, "מאגר הנתונים הציבורי לקמפיין המבוקש אינו זמין כרגע.");
  }

  return jsonResponse(200, {
    organizationId: context.organization.id,
    campaignId: context.campaign.id,
    organization: context.organization,
    campaign: context.campaign,
    rows: buildPublicDatasetRows(Array.isArray(context.dataset.rows) ? context.dataset.rows : []),
    meta: context.dataset.meta && typeof context.dataset.meta === "object" ? context.dataset.meta : {},
    sourceLabel: context.dataset.sourceLabel || "קובץ בסיס ציבורי",
    generatedAt: context.dataset.generatedAt || context.dataset.updatedAt || "",
  });
}

export async function getPublicContext() {
  const summaries = await listCampaignSummaries();
  if (!summaries.length) {
    return failureResponse(404, "לא נמצא קמפיין ציבורי פעיל להצגה כרגע.");
  }

  const ranked = [...summaries].sort((left, right) => {
    const leftHasData = Number(left?.datasetRecordCount || 0) > 0 ? 1 : 0;
    const rightHasData = Number(right?.datasetRecordCount || 0) > 0 ? 1 : 0;
    if (rightHasData !== leftHasData) {
      return rightHasData - leftHasData;
    }
    const countDiff = Number(right?.datasetRecordCount || 0) - Number(left?.datasetRecordCount || 0);
    if (countDiff !== 0) {
      return countDiff;
    }
    return String(right?.updatedAt || "").localeCompare(String(left?.updatedAt || ""));
  });

  const selected = ranked[0];
  const organizationId = normalizeStableId(selected.organizationId || selected.organizationSlug || "");
  const campaignId = normalizeStableId(selected.campaignId || selected.campaignSlug || "");
  if (!organizationId || !campaignId) {
    return failureResponse(404, "לא נמצא קמפיין ציבורי תקין להצגה כרגע.");
  }

  const [organization, campaign] = await Promise.all([
    getOrganization(organizationId),
    getCampaign(organizationId, campaignId),
  ]);

  return jsonResponse(200, {
    organizationId,
    campaignId,
    organization:
      organization || {
        id: organizationId,
        slug: normalizeSlug(selected.organizationSlug || organizationId, organizationId),
        name: selected.organizationName || organizationId,
        status: "active",
      },
    campaign:
      campaign || {
        id: campaignId,
        organizationId,
        slug: normalizeSlug(selected.campaignSlug || campaignId, campaignId),
        name: selected.campaignName || campaignId,
        status: selected.status || "draft",
        target: Number(selected.target || 0),
        currency: selected.currency || "ILS",
        startAt: selected.startAt || "",
        endAt: selected.endAt || "",
        updatedAt: selected.updatedAt || "",
      },
    datasetRecordCount: Number(selected.datasetRecordCount || 0),
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
  await createSessionRecord(store, normalizedEmail, token, now, expiresAt);
  await recordAuditEvent(store, {
    type: "login_success",
    email: normalizedEmail,
    clientAddress,
    userAgent,
    outcome: "success",
  });
  await appendAuditEvent({
    user: normalizedEmail,
    role: admin.role,
    organizationId: admin.organizationId || "",
    campaignId: "",
    action: "login_success",
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
  await createSessionRecord(store, normalizedEmail, token, now, expiresAt);
  await recordAuditEvent(store, {
    type: "setup_success",
    email: normalizedEmail,
    clientAddress,
    userAgent,
    outcome: "success",
  });
  await appendAuditEvent({
    user: normalizedEmail,
    role: admin.role,
    organizationId: admin.organizationId || "",
    campaignId: "",
    action: "password_setup",
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
    await deleteSessionRecord(store, token);
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
    { "Set-Cookie": buildCookieValue("", request.url, 0) },
  );
}

export async function changeManagerPassword({ request, currentPassword, newPassword, confirmPassword }) {
  const baseAccess = await requireManagerAccess(request, ROLE_VIEWER, "נדרשת התחברות כדי להחליף סיסמה.");
  if (baseAccess.error) {
    return baseAccess.error;
  }
  if (!currentPassword || !newPassword || !confirmPassword) {
    return failureResponse(400, "יש למלא סיסמה נוכחית, סיסמה חדשה ואימות סיסמה.");
  }
  if (newPassword !== confirmPassword) {
    return failureResponse(400, "אימות הסיסמה החדשה לא תואם.");
  }
  if (newPassword.length < 8) {
    return failureResponse(400, "הסיסמה החדשה חייבת לכלול לפחות 8 תווים.");
  }

  const store = getPersistence();
  const admin = await getAdminRecord(store, baseAccess.auth.email);
  if (!admin || !admin.passwordHash || !verifyPassword(currentPassword, admin.passwordHash)) {
    return failureResponse(401, "הסיסמה הנוכחית שגויה.");
  }
  admin.passwordHash = hashPassword(newPassword);
  admin.passwordSetAt = isoNow();
  await saveAdminRecord(store, admin);
  await deleteSessionsForEmail(store, baseAccess.auth.email);
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DURATION_HOURS * 60 * 60 * 1000).toISOString();
  await createSessionRecord(store, baseAccess.auth.email, token, isoNow(), expiresAt);
  await appendAuditEvent({
    user: baseAccess.auth.email,
    role: baseAccess.auth.role,
    organizationId: baseAccess.auth.organizationId || "",
    campaignId: "",
    action: "password_changed",
    outcome: "success",
  });
  return jsonResponse(
    200,
    { changed: true, message: "הסיסמה הוחלפה בהצלחה." },
    { "Set-Cookie": buildCookieValue(token, request.url, SESSION_DURATION_HOURS * 60 * 60) },
  );
}
