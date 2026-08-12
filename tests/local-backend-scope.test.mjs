import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = fileURLToPath(new URL("../", import.meta.url));
const PLATFORM_STORE_PATH = fileURLToPath(new URL("../work/data/goodraise-platform-dev.json", import.meta.url));
const TEST_AUTH_DB_PATH = fileURLToPath(new URL("../work/data/dashboard-auth.test.sqlite3", import.meta.url));
const LEGACY_SOURCE_PATH = fileURLToPath(new URL("../work/data/dashboard-source-config.json", import.meta.url));
const LEGACY_CAMPAIGN_PATH = fileURLToPath(new URL("../work/data/dashboard-campaign-config.json", import.meta.url));

function detectPython() {
  const envPython = process.env.PYTHON_BIN || process.env.PYTHON;
  if (envPython) {
    return envPython;
  }
  if (process.platform === "win32") {
    const cached = join(process.env.USERPROFILE || "", ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "python", "python.exe");
    if (existsSync(cached)) {
      return cached;
    }
    return "python";
  }
  return "python3";
}

async function backupFiles(paths) {
  const backups = new Map();
  for (const path of paths) {
    try {
      backups.set(path, await readFile(path));
    } catch {
      backups.set(path, null);
    }
  }
  return backups;
}

async function restoreFiles(backups) {
  for (const [path, content] of backups.entries()) {
    await mkdir(dirname(path), { recursive: true });
    if (content === null) {
      await rm(path, { force: true });
    } else {
      await writeFile(path, content);
    }
  }
}

function buildCampaignConfig({ organizationId, organizationSlug, organizationName, campaignId, campaignSlug, campaignName, target }) {
  return {
    organization: {
      id: organizationId,
      slug: organizationSlug,
      name: organizationName,
      status: "active",
    },
    basics: {
      id: campaignId,
      organizationId,
      organizationSlug,
      organizationName,
      slug: campaignSlug,
      campaignName,
      status: "live",
      target,
      currency: "ILS",
    },
    goals: {
      campaignGoal: target,
      dailyGoal: Math.round(target / 10),
    },
    meta: {
      lastSavedAt: "2026-08-12T10:00:00.000Z",
      lastSavedBy: "seed@example.org",
    },
  };
}

function buildPlatformStore({
  alpha1SourceEndpoint = "https://api.alpha.example/a1",
} = {}) {
  const items = {
    "organization:org-alpha": {
      id: "org-alpha",
      slug: "alpha",
      name: "Organization Alpha",
      status: "active",
      createdAt: "2026-08-12T10:00:00.000Z",
      updatedAt: "2026-08-12T10:00:00.000Z",
    },
    "organization:org-beta": {
      id: "org-beta",
      slug: "beta",
      name: "Organization Beta",
      status: "active",
      createdAt: "2026-08-12T10:00:00.000Z",
      updatedAt: "2026-08-12T10:00:00.000Z",
    },
    "campaign:org-alpha:alpha-1": {
      id: "alpha-1",
      organizationId: "org-alpha",
      slug: "alpha-1",
      name: "Alpha 1",
      status: "live",
      startAt: "2026-08-23T00:00:00",
      endAt: "2026-09-01T23:59:00",
      target: 100000,
      currency: "ILS",
      createdAt: "2026-08-12T10:00:00.000Z",
      updatedAt: "2026-08-12T10:00:00.000Z",
      updatedBy: "seed@example.org",
    },
    "campaign:org-alpha:alpha-2": {
      id: "alpha-2",
      organizationId: "org-alpha",
      slug: "alpha-2",
      name: "Alpha 2",
      status: "live",
      startAt: "2026-08-23T00:00:00",
      endAt: "2026-09-01T23:59:00",
      target: 250000,
      currency: "ILS",
      createdAt: "2026-08-12T10:00:00.000Z",
      updatedAt: "2026-08-12T10:00:00.000Z",
      updatedBy: "seed@example.org",
    },
    "campaign:org-beta:beta-1": {
      id: "beta-1",
      organizationId: "org-beta",
      slug: "beta-1",
      name: "Beta 1",
      status: "live",
      startAt: "2026-08-23T00:00:00",
      endAt: "2026-09-01T23:59:00",
      target: 500000,
      currency: "ILS",
      createdAt: "2026-08-12T10:00:00.000Z",
      updatedAt: "2026-08-12T10:00:00.000Z",
      updatedBy: "seed@example.org",
    },
    "campaign-config:org-alpha:alpha-1": buildCampaignConfig({
      organizationId: "org-alpha",
      organizationSlug: "alpha",
      organizationName: "Organization Alpha",
      campaignId: "alpha-1",
      campaignSlug: "alpha-1",
      campaignName: "Alpha 1",
      target: 100000,
    }),
    "campaign-config:org-alpha:alpha-2": buildCampaignConfig({
      organizationId: "org-alpha",
      organizationSlug: "alpha",
      organizationName: "Organization Alpha",
      campaignId: "alpha-2",
      campaignSlug: "alpha-2",
      campaignName: "Alpha 2",
      target: 250000,
    }),
    "campaign-config:org-beta:beta-1": buildCampaignConfig({
      organizationId: "org-beta",
      organizationSlug: "beta",
      organizationName: "Organization Beta",
      campaignId: "beta-1",
      campaignSlug: "beta-1",
      campaignName: "Beta 1",
      target: 500000,
    }),
    "campaign-source:org-alpha:alpha-1": {
      mode: "api",
      api: {
        endpoint: alpha1SourceEndpoint,
        method: "GET",
        responseFormat: "json",
        authType: "bearer",
        bearerToken: "secret-a1",
        hasBearerToken: true,
        autoRefreshMinutes: 5,
        headersText: "",
        bodyText: "",
        fieldMapText: "{}",
      },
    },
    "campaign-source:org-alpha:alpha-2": {
      mode: "api",
      api: {
        endpoint: "https://api.alpha.example/a2",
        method: "POST",
        responseFormat: "csv",
        authType: "bearer",
        bearerToken: "secret-a2",
        hasBearerToken: true,
        autoRefreshMinutes: 15,
        headersText: "",
        bodyText: "",
        fieldMapText: "{}",
      },
    },
    "campaign-source:org-beta:beta-1": {
      mode: "file",
      api: {
        endpoint: "",
        method: "GET",
        responseFormat: "json",
        authType: "none",
        bearerToken: "",
        hasBearerToken: false,
        autoRefreshMinutes: 30,
        headersText: "",
        bodyText: "",
        fieldMapText: "{}",
      },
    },
    "campaign-dataset:org-alpha:alpha-1": {
      organizationId: "org-alpha",
      campaignId: "alpha-1",
      rows: [{ id: "a1-1", donor: "Alpha One", ambassador: "Dana A1", amount: 1000 }],
      meta: { rowCount: 1, projectDates: ["2026-08-23"], uniqueDates: ["2026-08-23"] },
      sourceLabel: "alpha-1.csv",
      generatedAt: "2026-08-12T10:00:00.000Z",
      updatedAt: "2026-08-12T10:00:00.000Z",
    },
    "campaign-dataset:org-alpha:alpha-2": {
      organizationId: "org-alpha",
      campaignId: "alpha-2",
      rows: [{ id: "a2-1", donor: "Alpha Two", ambassador: "Dana A2", amount: 2000 }],
      meta: { rowCount: 1, projectDates: ["2026-08-24"], uniqueDates: ["2026-08-24"] },
      sourceLabel: "alpha-2.csv",
      generatedAt: "2026-08-12T10:00:00.000Z",
      updatedAt: "2026-08-12T10:00:00.000Z",
    },
    "campaign-dataset:org-beta:beta-1": {
      organizationId: "org-beta",
      campaignId: "beta-1",
      rows: [{ id: "b1-1", donor: "Beta One", ambassador: "Dana B1", amount: 3000 }],
      meta: { rowCount: 1, projectDates: ["2026-08-25"], uniqueDates: ["2026-08-25"] },
      sourceLabel: "beta-1.csv",
      generatedAt: "2026-08-12T10:00:00.000Z",
      updatedAt: "2026-08-12T10:00:00.000Z",
    },
  };
  return { items };
}

async function waitForHealth(url, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Server did not become healthy at ${url}`);
}

async function requestJson(url, { method = "GET", body, cookie } = {}) {
  const headers = {};
  if (cookie) {
    headers.cookie = cookie;
  }
  if (body !== undefined) {
    headers["content-type"] = "application/json";
  }
  const response = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  return {
    response,
    payload: await response.json(),
    cookie: response.headers.get("set-cookie") || "",
  };
}

async function allocatePort(host = "127.0.0.1") {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to allocate a local test port.")));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

async function setupManager(baseUrl, email) {
  const result = await requestJson(`${baseUrl}/api/auth/setup`, {
    method: "POST",
    body: {
      email,
      password: "Secret123!",
      confirmPassword: "Secret123!",
    },
  });
  assert.equal(result.response.status, 200);
  assert.match(result.cookie, /yellow_dashboard_admin_session=/);
  return result.cookie;
}

test("local backend enforces campaign scope and returns scoped payloads", { concurrency: false }, async () => {
  const backups = await backupFiles([
    PLATFORM_STORE_PATH,
    LEGACY_SOURCE_PATH,
    LEGACY_CAMPAIGN_PATH,
  ]);

  const port = await allocatePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  let serverProcess = null;

  try {
    await mkdir(dirname(PLATFORM_STORE_PATH), { recursive: true });
    await writeFile(PLATFORM_STORE_PATH, JSON.stringify(buildPlatformStore(), null, 2), "utf8");
    await rm(TEST_AUTH_DB_PATH, { force: true });
    await rm(LEGACY_SOURCE_PATH, { force: true });
    await rm(LEGACY_CAMPAIGN_PATH, { force: true });

    const python = detectPython();
    serverProcess = spawn(
      python,
      ["scripts/run_dashboard_server.py", "--skip-build", "--host", "127.0.0.1", "--port", String(port)],
      {
        cwd: ROOT_DIR,
        env: {
          ...process.env,
          YELLOW_DASHBOARD_AUTH_DB_PATH: TEST_AUTH_DB_PATH,
          YELLOW_DASHBOARD_MANAGER_EMAILS: JSON.stringify([
            { email: "local-org-admin@example.org", role: "organization_admin", organizationSlug: "alpha" },
            { email: "local-a1-manager@example.org", role: "campaign_manager", organizationSlug: "alpha", campaignSlugs: ["alpha-1"] },
          ]),
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    await waitForHealth(`${baseUrl}/api/health`);

    const orgAdminCookie = await setupManager(baseUrl, "local-org-admin@example.org");
    const managerCookie = await setupManager(baseUrl, "local-a1-manager@example.org");

    const orgAdminStatus = await requestJson(`${baseUrl}/api/auth/status`, { cookie: orgAdminCookie });
    assert.equal(orgAdminStatus.response.status, 200);
    assert.equal(orgAdminStatus.payload.authenticated, true);
    assert.equal(orgAdminStatus.payload.accessibleCampaigns.length, 2);

    const managerStatus = await requestJson(`${baseUrl}/api/auth/status`, { cookie: managerCookie });
    assert.equal(managerStatus.response.status, 200);
    assert.equal(managerStatus.payload.accessibleCampaigns.length, 1);

    const a1Dataset = await requestJson(`${baseUrl}/api/organizations/org-alpha/campaigns/alpha-1/dataset`, { cookie: managerCookie });
    const a2Forbidden = await requestJson(`${baseUrl}/api/organizations/org-alpha/campaigns/alpha-2/dataset`, { cookie: managerCookie });
    const b1Forbidden = await requestJson(`${baseUrl}/api/organizations/org-beta/campaigns/beta-1/dataset`, { cookie: managerCookie });
    assert.equal(a1Dataset.response.status, 200);
    assert.equal(a1Dataset.payload.campaignId, "alpha-1");
    assert.equal(a1Dataset.payload.rows[0].id, "a1-1");
    assert.equal(a2Forbidden.response.status, 403);
    assert.equal(b1Forbidden.response.status, 403);

    const sourceConfig = await requestJson(`${baseUrl}/api/organizations/org-alpha/campaigns/alpha-1/source`, { cookie: managerCookie });
    assert.equal(sourceConfig.response.status, 200);
    assert.equal(sourceConfig.payload.config.api.hasBearerToken, true);
    assert.equal(sourceConfig.payload.config.api.bearerToken, "");

    const campaignConfig = await requestJson(`${baseUrl}/api/organizations/org-alpha/campaigns/alpha-1`, { cookie: managerCookie });
    assert.equal(campaignConfig.response.status, 200);
    assert.equal(campaignConfig.payload.activeCampaign.campaignId, "alpha-1");
    assert.equal(campaignConfig.payload.config.activeCampaignId, "alpha-1");
  } finally {
    if (serverProcess && !serverProcess.killed) {
      serverProcess.kill("SIGTERM");
      await new Promise((resolve) => setTimeout(resolve, 500));
      if (!serverProcess.killed) {
        serverProcess.kill("SIGKILL");
      }
    }
    await rm(TEST_AUTH_DB_PATH, { force: true });
    await restoreFiles(backups);
  }
});

test("local backend blocks unsafe source endpoints on save and refresh", { concurrency: false }, async () => {
  const backups = await backupFiles([
    PLATFORM_STORE_PATH,
    LEGACY_SOURCE_PATH,
    LEGACY_CAMPAIGN_PATH,
  ]);

  const port = await allocatePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  let serverProcess = null;

  try {
    await mkdir(dirname(PLATFORM_STORE_PATH), { recursive: true });
    await writeFile(
      PLATFORM_STORE_PATH,
      JSON.stringify(buildPlatformStore({ alpha1SourceEndpoint: "http://127.0.0.1:8080/private-feed" }), null, 2),
      "utf8",
    );
    await rm(TEST_AUTH_DB_PATH, { force: true });
    await rm(LEGACY_SOURCE_PATH, { force: true });
    await rm(LEGACY_CAMPAIGN_PATH, { force: true });

    const python = detectPython();
    serverProcess = spawn(
      python,
      ["scripts/run_dashboard_server.py", "--skip-build", "--host", "127.0.0.1", "--port", String(port)],
      {
        cwd: ROOT_DIR,
        env: {
          ...process.env,
          YELLOW_DASHBOARD_AUTH_DB_PATH: TEST_AUTH_DB_PATH,
          YELLOW_DASHBOARD_MANAGER_EMAILS: JSON.stringify([
            { email: "local-a1-manager@example.org", role: "campaign_manager", organizationSlug: "alpha", campaignSlugs: ["alpha-1"] },
          ]),
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    await waitForHealth(`${baseUrl}/api/health`);

    const managerCookie = await setupManager(baseUrl, "local-a1-manager@example.org");

    const blockedSave = await requestJson(`${baseUrl}/api/organizations/org-alpha/campaigns/alpha-1/source`, {
      method: "POST",
      cookie: managerCookie,
      body: {
        config: {
          mode: "api",
          api: {
            endpoint: "https://localhost/internal-feed",
            method: "GET",
            responseFormat: "json",
            authType: "none",
          },
        },
      },
    });
    assert.equal(blockedSave.response.status, 400);
    assert.match(blockedSave.payload.message, /פנימי|מורשה|https|http/i);

    const blockedRefresh = await requestJson(`${baseUrl}/api/organizations/org-alpha/campaigns/alpha-1/source/refresh`, {
      method: "POST",
      cookie: managerCookie,
    });
    assert.equal(blockedRefresh.response.status, 400);
    assert.match(blockedRefresh.payload.message, /פנימי|מורשה|local|private/i);
  } finally {
    if (serverProcess && !serverProcess.killed) {
      serverProcess.kill("SIGTERM");
      await new Promise((resolve) => setTimeout(resolve, 500));
      if (!serverProcess.killed) {
        serverProcess.kill("SIGKILL");
      }
    }
    await rm(TEST_AUTH_DB_PATH, { force: true });
    await restoreFiles(backups);
  }
});
