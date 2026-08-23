import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import authHandler from "../netlify/functions/auth.mjs";
import {
  buildCampaignContext,
  ensureMultiTenantMigration,
  getCampaign,
  getCampaignConfig,
  getCampaignDataset,
  getCampaignSource,
  getOrganization,
  listCampaignSummaries,
  saveCampaign,
  saveCampaignConfig,
  saveCampaignDataset,
  saveCampaignSource,
  saveOrganization,
} from "../netlify/lib/campaign-repositories.mjs";

const ROOT_DIR = fileURLToPath(new URL("../", import.meta.url));
const PLATFORM_STORE_PATH = fileURLToPath(new URL("../work/data/goodraise-platform-dev.json", import.meta.url));
const AUTH_STORE_PATH = fileURLToPath(new URL("../work/data/netlify-auth-dev.json", import.meta.url));
const LEGACY_CAMPAIGN_STORE_PATH = fileURLToPath(new URL("../work/data/netlify-campaign-config-dev.json", import.meta.url));
const LEGACY_SOURCE_STORE_PATH = fileURLToPath(new URL("../work/data/netlify-source-config-dev.json", import.meta.url));
const LEGACY_DATASET_PATH = fileURLToPath(new URL("../netlify/data/admin-dataset.json", import.meta.url));
const INTELLIGENCE_PATH = new URL("../work/frontend/goodraise-intelligence.js", import.meta.url);

function groupBy(rows, getKey) {
  const map = new Map();
  rows.forEach((row) => {
    const key = getKey(row);
    if (!map.has(key)) {
      map.set(key, []);
    }
    map.get(key).push(row);
  });
  return map;
}

function sumAmount(rows) {
  return rows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
}

function buildLeaderboard(rows) {
  return [...groupBy(rows.filter((row) => row.ambassador && row.ambassador !== "ללא שיוך"), (row) => row.ambassador).entries()]
    .map(([ambassador, items]) => ({
      ambassador,
      total: sumAmount(items),
      deals: items.length,
    }))
    .sort((left, right) => right.total - left.total || right.deals - left.deals || left.ambassador.localeCompare(right.ambassador, "he"));
}

async function loadEngineFactory() {
  const source = await readFile(INTELLIGENCE_PATH, "utf8");
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(`${source}\nthis.__factory = createGoodRaiseIntelligence;`, sandbox);
  return sandbox.__factory;
}

async function backupFiles(paths) {
  const backups = new Map();
  for (const path of paths) {
    try {
      backups.set(path, await readFile(path, "utf8"));
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
      await writeFile(path, content, "utf8");
    }
  }
}

async function resetStores() {
  await mkdir(dirname(PLATFORM_STORE_PATH), { recursive: true });
  await mkdir(dirname(AUTH_STORE_PATH), { recursive: true });
  await mkdir(dirname(LEGACY_CAMPAIGN_STORE_PATH), { recursive: true });
  await mkdir(dirname(LEGACY_SOURCE_STORE_PATH), { recursive: true });
  await mkdir(dirname(LEGACY_DATASET_PATH), { recursive: true });
  await writeFile(PLATFORM_STORE_PATH, JSON.stringify({ items: {} }, null, 2), "utf8");
  await writeFile(AUTH_STORE_PATH, JSON.stringify({ items: {} }, null, 2), "utf8");
  await writeFile(LEGACY_CAMPAIGN_STORE_PATH, JSON.stringify({ items: {} }, null, 2), "utf8");
  await writeFile(LEGACY_SOURCE_STORE_PATH, JSON.stringify({ items: {} }, null, 2), "utf8");
  await rm(LEGACY_DATASET_PATH, { force: true });
}

async function requestJson(url, { method = "GET", body, cookie } = {}) {
  const headers = {};
  if (body !== undefined) {
    headers["content-type"] = "application/json";
  }
  if (cookie) {
    headers.cookie = cookie;
  }
  const response = await authHandler(
    new Request(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  return {
    response,
    payload: await response.json(),
    cookie: response.headers.get("set-cookie") || "",
  };
}

async function setupManager(email) {
  const { response, payload, cookie } = await requestJson("http://localhost/api/auth/setup", {
    method: "POST",
    body: {
      email,
      password: "Secret123!",
      confirmPassword: "Secret123!",
    },
  });
  assert.equal(response.status, 200, `setup should succeed for ${email}`);
  assert.equal(payload.authenticated, true);
  assert.match(cookie, /yellow_dashboard_admin_session=/);
  return cookie;
}

function seedRows(prefix, ambassador, amountStart, count, date) {
  return Array.from({ length: count }, (_value, index) => ({
    id: `${prefix}-${index + 1}`,
    createdIso: `${date}T${String(9 + index).padStart(2, "0")}:00`,
    date,
    hour: 9 + index,
    donor: `${prefix.toUpperCase()} donor ${index + 1}`,
    email: `${prefix}-${index + 1}@example.org`,
    ambassador,
    amount: amountStart + index * 100,
    city: "Tel Aviv",
    status: "success",
    chargeResult: "approved",
  }));
}

function buildConfig({ organizationId, organizationSlug, organizationName, campaignId, campaignSlug, campaignName, target, dailyGoal, ambassadors, placePrize }) {
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
      startDate: "2026-08-23",
      startTime: "00:00",
      endDate: "2026-09-01",
      endTime: "23:59",
    },
    goals: {
      campaignGoal: target,
      dailyGoal,
      placePrizes: [{ place: 1, label: "מקום 1", prize: placePrize }],
      tierPrizes: [{ threshold: Math.round(target * 0.25), prize: "Tier" }],
    },
    ambassadors: {
      records: ambassadors.map((fullName, index) => ({
        fullName,
        nickname: `${campaignSlug}-${index + 1}`,
        email: `${campaignSlug}-${index + 1}@example.org`,
        phone: `0500000${index + 1}`,
        personalTarget: Math.round(target / Math.max(1, ambassadors.length)),
        team: `Team ${index + 1}`,
      })),
    },
    meta: {
      lastSavedAt: "2026-08-12T09:00:00.000Z",
      lastSavedBy: "seed@example.org",
    },
  };
}

async function seedSyntheticPlatform() {
  await saveOrganization({
    id: "org-alpha",
    slug: "alpha",
    name: "Organization Alpha",
    status: "active",
    createdAt: "2026-08-12T09:00:00.000Z",
    updatedAt: "2026-08-12T09:00:00.000Z",
  });
  await saveOrganization({
    id: "org-beta",
    slug: "beta",
    name: "Organization Beta",
    status: "active",
    createdAt: "2026-08-12T09:00:00.000Z",
    updatedAt: "2026-08-12T09:00:00.000Z",
  });

  const campaigns = [
    {
      organizationId: "org-alpha",
      campaignId: "alpha-1",
      slug: "alpha-1",
      name: "Alpha-1",
      target: 100000,
      dailyGoal: 12000,
      ambassadors: ["Dana A1", "Roi A1"],
      rows: seedRows("a1", "Dana A1", 1000, 3, "2026-08-23"),
      source: {
        mode: "api",
        api: {
          endpoint: "https://api.alpha.example/a1",
          method: "GET",
          responseFormat: "json",
          authType: "bearer",
          bearerToken: "secret-a1",
          hasBearerToken: true,
          autoRefreshMinutes: 5,
          headersText: "",
          bodyText: "",
          fieldMapText: JSON.stringify({}),
        },
      },
      prize: "Alpha Prize 1",
    },
    {
      organizationId: "org-alpha",
      campaignId: "alpha-2",
      slug: "alpha-2",
      name: "Alpha-2",
      target: 250000,
      dailyGoal: 18000,
      ambassadors: ["Dana A2", "Roi A2"],
      rows: seedRows("a2", "Dana A2", 2000, 2, "2026-08-24"),
      source: {
        mode: "api",
        api: {
          endpoint: "https://api.alpha.example/a2",
          method: "POST",
          responseFormat: "csv",
          authType: "bearer",
          bearerToken: "secret-a2",
          hasBearerToken: true,
          autoRefreshMinutes: 15,
          headersText: "X-Test: alpha-2",
          bodyText: '{"campaign":"alpha-2"}',
          fieldMapText: JSON.stringify({}),
        },
      },
      prize: "Alpha Prize 2",
    },
    {
      organizationId: "org-beta",
      campaignId: "beta-1",
      slug: "beta-1",
      name: "Beta-1",
      target: 500000,
      dailyGoal: 30000,
      ambassadors: ["Dana B1", "Roi B1", "Tamar B1"],
      rows: seedRows("b1", "Dana B1", 3000, 4, "2026-08-25"),
      source: {
        mode: "file",
        api: {
          endpoint: "https://api.beta.example/b1",
          method: "GET",
          responseFormat: "json",
          authType: "none",
          bearerToken: "",
          hasBearerToken: false,
          autoRefreshMinutes: 30,
          headersText: "",
          bodyText: "",
          fieldMapText: JSON.stringify({}),
        },
      },
      prize: "Beta Prize 1",
    },
  ];

  for (const campaign of campaigns) {
    const organization = await getOrganization(campaign.organizationId);
    await saveCampaign({
      id: campaign.campaignId,
      organizationId: campaign.organizationId,
      slug: campaign.slug,
      name: campaign.name,
      status: "live",
      startAt: "2026-08-23T00:00:00",
      endAt: "2026-09-01T23:59:00",
      target: campaign.target,
      currency: "ILS",
      createdAt: "2026-08-12T09:00:00.000Z",
      updatedAt: "2026-08-12T09:00:00.000Z",
    });
    await saveCampaignConfig(
      campaign.organizationId,
      campaign.campaignId,
      buildConfig({
        organizationId: campaign.organizationId,
        organizationSlug: organization.slug,
        organizationName: organization.name,
        campaignId: campaign.campaignId,
        campaignSlug: campaign.slug,
        campaignName: campaign.name,
        target: campaign.target,
        dailyGoal: campaign.dailyGoal,
        ambassadors: campaign.ambassadors,
        placePrize: campaign.prize,
      }),
      "seed@example.org",
    );
    await saveCampaignSource(campaign.organizationId, campaign.campaignId, campaign.source);
    await saveCampaignDataset(campaign.organizationId, campaign.campaignId, {
      organizationId: campaign.organizationId,
      campaignId: campaign.campaignId,
      rows: campaign.rows,
      meta: {
        uniqueDates: [campaign.rows[0].date],
        projectDates: [campaign.rows[0].date],
        defaultFrom: campaign.rows[0].date,
        defaultTo: campaign.rows[0].date,
        minDate: campaign.rows[0].date,
        maxDate: campaign.rows[0].date,
        rowCount: campaign.rows.length,
        projectWindowLabel: `${campaign.rows[0].date} עד ${campaign.rows[0].date}`,
      },
      sourceLabel: `${campaign.campaignId}.csv`,
      generatedAt: "2026-08-12T09:00:00.000Z",
      updatedAt: "2026-08-12T09:00:00.000Z",
    });
  }
}

test("multi-campaign isolation, authorization and campaign creation are enforced server-side", { concurrency: false }, async () => {
  const backups = await backupFiles([
    PLATFORM_STORE_PATH,
    AUTH_STORE_PATH,
    LEGACY_CAMPAIGN_STORE_PATH,
    LEGACY_SOURCE_STORE_PATH,
    LEGACY_DATASET_PATH,
  ]);

  try {
    process.env.YELLOW_DASHBOARD_MANAGER_EMAILS = JSON.stringify([
      { email: "platform-admin@example.org", role: "platform_admin" },
      { email: "orga-admin@example.org", role: "organization_admin", organizationId: "org-alpha", organizationSlug: "alpha" },
      { email: "a1-manager@example.org", role: "campaign_manager", organizationId: "org-alpha", organizationSlug: "alpha", campaignIds: ["alpha-1"], campaignSlugs: ["alpha-1"] },
      { email: "b1-analyst@example.org", role: "analyst", organizationId: "org-beta", organizationSlug: "beta", campaignIds: ["beta-1"], campaignSlugs: ["beta-1"] },
    ]);

    await resetStores();
    await seedSyntheticPlatform();

    const platformCookie = await setupManager("platform-admin@example.org");
    const orgAdminCookie = await setupManager("orga-admin@example.org");
    const a1ManagerCookie = await setupManager("a1-manager@example.org");
    const b1AnalystCookie = await setupManager("b1-analyst@example.org");

    const a1Dataset = await requestJson("http://localhost/api/organizations/org-alpha/campaigns/alpha-1/dataset", { cookie: platformCookie });
    const a2Dataset = await requestJson("http://localhost/api/organizations/org-alpha/campaigns/alpha-2/dataset", { cookie: platformCookie });
    const b1Dataset = await requestJson("http://localhost/api/organizations/org-beta/campaigns/beta-1/dataset", { cookie: platformCookie });
    assert.equal(a1Dataset.response.status, 200);
    assert.equal(a2Dataset.response.status, 200);
    assert.equal(b1Dataset.response.status, 200);
    assert.ok(a1Dataset.payload.rows.every((row) => String(row.id).startsWith("a1-")));
    assert.ok(a2Dataset.payload.rows.every((row) => String(row.id).startsWith("a2-")));
    assert.ok(b1Dataset.payload.rows.every((row) => String(row.id).startsWith("b1-")));

    const a1Source = await requestJson("http://localhost/api/organizations/org-alpha/campaigns/alpha-1/source", { cookie: platformCookie });
    const a2Source = await requestJson("http://localhost/api/organizations/org-alpha/campaigns/alpha-2/source", { cookie: platformCookie });
    assert.equal(a1Source.response.status, 200);
    assert.equal(a2Source.response.status, 200);
    assert.equal(a1Source.payload.config.api.endpoint, "https://api.alpha.example/a1");
    assert.equal(a2Source.payload.config.api.endpoint, "https://api.alpha.example/a2");
    assert.equal(a1Source.payload.config.api.hasBearerToken, true);
    assert.equal(a1Source.payload.config.api.bearerToken, "");

    const a2ConfigBefore = await getCampaignConfig("org-alpha", "alpha-2");
    const a1SourceBeforeCampaignSave = await getCampaignSource("org-alpha", "alpha-1");
    const a1DatasetBeforeCampaignSave = await getCampaignDataset("org-alpha", "alpha-1");
    await requestJson("http://localhost/api/organizations/org-alpha/campaigns/alpha-1", {
      method: "POST",
      cookie: platformCookie,
      body: {
        config: {
          ...(await getCampaignConfig("org-alpha", "alpha-1")),
          basics: {
            ...((await getCampaignConfig("org-alpha", "alpha-1")).basics || {}),
            target: 111111,
          },
          goals: {
            ...((await getCampaignConfig("org-alpha", "alpha-1")).goals || {}),
            campaignGoal: 111111,
          },
        },
      },
    });
    const a1ConfigAfter = await getCampaignConfig("org-alpha", "alpha-1");
    const a2ConfigAfter = await getCampaignConfig("org-alpha", "alpha-2");
    const a1SourceAfterCampaignSave = await getCampaignSource("org-alpha", "alpha-1");
    const a1DatasetAfterCampaignSave = await getCampaignDataset("org-alpha", "alpha-1");
    assert.equal(a1ConfigAfter.basics.target, 111111);
    assert.equal(a2ConfigAfter.basics.target, a2ConfigBefore.basics.target);
    assert.equal(a1SourceAfterCampaignSave.api.endpoint, a1SourceBeforeCampaignSave.api.endpoint);
    assert.deepEqual(a1DatasetAfterCampaignSave.rows, a1DatasetBeforeCampaignSave.rows);

    const orgAlphaList = await requestJson("http://localhost/api/organizations/org-alpha/campaigns", { cookie: orgAdminCookie });
    const orgBetaForbidden = await requestJson("http://localhost/api/organizations/org-beta/campaigns/beta-1/dataset", { cookie: orgAdminCookie });
    assert.equal(orgAlphaList.response.status, 200);
    assert.equal(orgAlphaList.payload.campaigns.length, 2);
    assert.equal(orgBetaForbidden.response.status, 403);

    const a1Allowed = await requestJson("http://localhost/api/organizations/org-alpha/campaigns/alpha-1/dataset", { cookie: a1ManagerCookie });
    const a2Forbidden = await requestJson("http://localhost/api/organizations/org-alpha/campaigns/alpha-2/dataset", { cookie: a1ManagerCookie });
    const b1Forbidden = await requestJson("http://localhost/api/organizations/org-beta/campaigns/beta-1/dataset", { cookie: a1ManagerCookie });
    assert.equal(a1Allowed.response.status, 200);
    assert.equal(a2Forbidden.response.status, 403);
    assert.equal(b1Forbidden.response.status, 403);

    const b1Read = await requestJson("http://localhost/api/organizations/org-beta/campaigns/beta-1/dataset", { cookie: b1AnalystCookie });
    const b1WriteForbidden = await requestJson("http://localhost/api/organizations/org-beta/campaigns/beta-1/source", {
      method: "POST",
      cookie: b1AnalystCookie,
      body: { config: { mode: "file" } },
    });
    assert.equal(b1Read.response.status, 200);
    assert.equal(b1WriteForbidden.response.status, 403);

    const duplicateResponse = await requestJson("http://localhost/api/organizations/org-alpha/campaigns", {
      method: "POST",
      cookie: orgAdminCookie,
      body: {
        config: {
          activeCampaignId: "alpha-1-copy",
          campaigns: [
            {
              id: "alpha-1-copy",
              name: "Alpha-1 Copy",
              slug: "alpha-1-copy",
              config: {
                ...(await getCampaignConfig("org-alpha", "alpha-1")),
                basics: {
                  ...((await getCampaignConfig("org-alpha", "alpha-1")).basics || {}),
                  id: "alpha-1-copy",
                  slug: "alpha-1-copy",
                  campaignName: "Alpha-1 Copy",
                },
              },
            },
          ],
        },
      },
    });
    assert.equal(duplicateResponse.response.status, 201);
    const duplicateCampaign = await getCampaign("org-alpha", "alpha-1-copy");
    const duplicateDataset = await getCampaignDataset("org-alpha", "alpha-1-copy");
    assert.ok(duplicateCampaign);
    assert.equal(duplicateCampaign.name, "Alpha-1 Copy");
    assert.equal(Array.isArray(duplicateDataset.rows), true);
    assert.equal(duplicateDataset.rows.length, 0);

    const summaries = await listCampaignSummaries();
    const liveCampaigns = summaries.filter((item) => item.status === "live");
    assert.ok(liveCampaigns.length >= 3);

    const createEngine = await loadEngineFactory();
    const engine = createEngine({ groupBy, sumAmount, buildLeaderboard });
    const contexts = await Promise.all([
      buildCampaignContext("org-alpha", "alpha-1"),
      buildCampaignContext("org-alpha", "alpha-2"),
      buildCampaignContext("org-beta", "beta-1"),
    ]);
    const healthScores = contexts.map((context) =>
      engine.buildHealthModel(context.dataset.rows, {
        organizationId: context.organization.id,
        campaignId: context.campaign.id,
        meta: context.dataset.meta,
        goals: {
          total: context.campaign.target,
          daily: context.config?.goals?.dailyGoal || 0,
          ambassadorGoal: 50000,
        },
        prizeModel: context.prizes,
        ambassadorDirectory: context.ambassadors,
        campaignBuilder: {
          goals: {
            ambassadorGoal: 50000,
          },
        },
      }).score,
    );
    assert.equal(new Set(healthScores).size >= 2, true);
  } finally {
    delete process.env.YELLOW_DASHBOARD_MANAGER_EMAILS;
    await restoreFiles(backups);
  }
});

test("legacy campaign registry migration preserves campaign and dataset records", { concurrency: false }, async () => {
  const backups = await backupFiles([
    PLATFORM_STORE_PATH,
    AUTH_STORE_PATH,
    LEGACY_CAMPAIGN_STORE_PATH,
    LEGACY_SOURCE_STORE_PATH,
    LEGACY_DATASET_PATH,
  ]);

  try {
    await resetStores();
    await writeFile(
      LEGACY_CAMPAIGN_STORE_PATH,
      JSON.stringify(
        {
          items: {
            "campaign-config": {
              activeCampaignId: "legacy-campaign",
              campaigns: [
                {
                  id: "legacy-campaign",
                  slug: "legacy-campaign",
                  name: "Legacy Campaign",
                  updatedAt: "2026-08-12T09:00:00.000Z",
                  updatedBy: "legacy@example.org",
                  config: {
                    organization: {
                      id: "legacy-org",
                      slug: "legacy-org",
                      name: "Legacy Org",
                    },
                    basics: {
                      id: "legacy-campaign",
                      organizationId: "legacy-org",
                      organizationSlug: "legacy-org",
                      organizationName: "Legacy Org",
                      slug: "legacy-campaign",
                      campaignName: "Legacy Campaign",
                      status: "live",
                      target: 90000,
                      currency: "ILS",
                      startDate: "2026-08-23",
                      startTime: "00:00",
                      endDate: "2026-09-01",
                      endTime: "23:59",
                    },
                    goals: {
                      campaignGoal: 90000,
                    },
                    ambassadors: {
                      records: [{ fullName: "Legacy Ambassador", nickname: "legacy-ambassador" }],
                    },
                    meta: {
                      lastSavedAt: "2026-08-12T09:00:00.000Z",
                      lastSavedBy: "legacy@example.org",
                    },
                  },
                },
              ],
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    await writeFile(
      LEGACY_SOURCE_STORE_PATH,
      JSON.stringify(
        {
          items: {
            "source-config": {
              mode: "api",
              api: {
                endpoint: "https://legacy.example/api",
                method: "GET",
                responseFormat: "json",
                authType: "bearer",
                bearerToken: "legacy-secret",
                hasBearerToken: true,
                autoRefreshMinutes: 10,
                headersText: "",
                bodyText: "",
                fieldMapText: "{}",
              },
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    await writeFile(
      LEGACY_DATASET_PATH,
      JSON.stringify(
        {
          rows: [{ id: "legacy-1", donor: "Legacy Donor", ambassador: "Legacy Ambassador", amount: 5000, createdIso: "2026-08-23T09:00", date: "2026-08-23", hour: 9, status: "success" }],
          meta: {
            uniqueDates: ["2026-08-23"],
            projectDates: ["2026-08-23"],
          },
          sourceLabel: "legacy.csv",
          generatedAt: "2026-08-12T09:00:00.000Z",
        },
        null,
        2,
      ),
      "utf8",
    );

    const migration = await ensureMultiTenantMigration();
    assert.equal(migration.migratedCampaigns, 1);
    const organization = await getOrganization("legacy-org");
    const campaign = await getCampaign("legacy-org", "legacy-campaign");
    const dataset = await getCampaignDataset("legacy-org", "legacy-campaign");
    const source = await getCampaignSource("legacy-org", "legacy-campaign");
    assert.ok(organization);
    assert.ok(campaign);
    assert.equal(dataset.rows[0].id, "legacy-1");
    assert.equal(source.api.endpoint, "https://legacy.example/api");
  } finally {
    await restoreFiles(backups);
  }
});
