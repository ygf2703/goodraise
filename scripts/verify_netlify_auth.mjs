import authHandler from "../netlify/functions/auth.mjs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  saveCampaign,
  saveCampaignConfig,
  saveCampaignDataset,
  saveOrganization,
} from "../netlify/lib/campaign-repositories.mjs";

const PLATFORM_STORE_PATH = fileURLToPath(new URL("../work/data/goodraise-platform-dev.json", import.meta.url));
const AUTH_STORE_PATH = fileURLToPath(new URL("../work/data/netlify-auth-dev.json", import.meta.url));
const LEGACY_CAMPAIGN_STORE_PATH = fileURLToPath(new URL("../work/data/netlify-campaign-config-dev.json", import.meta.url));
const LEGACY_SOURCE_STORE_PATH = fileURLToPath(new URL("../work/data/netlify-source-config-dev.json", import.meta.url));
const LEGACY_DATASET_PATH = fileURLToPath(new URL("../netlify/data/admin-dataset.json", import.meta.url));

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function readJson(response) {
  return response.json();
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
  await writeFile(PLATFORM_STORE_PATH, JSON.stringify({ items: {} }, null, 2), "utf8");
  await writeFile(AUTH_STORE_PATH, JSON.stringify({ items: {} }, null, 2), "utf8");
  await writeFile(LEGACY_CAMPAIGN_STORE_PATH, JSON.stringify({ items: {} }, null, 2), "utf8");
  await writeFile(LEGACY_SOURCE_STORE_PATH, JSON.stringify({ items: {} }, null, 2), "utf8");
  await rm(LEGACY_DATASET_PATH, { force: true });
}

async function seedScopedCampaignDataset() {
  const now = new Date().toISOString();
  await saveOrganization({
    id: "verify-org",
    slug: "verify-org",
    name: "Verification Org",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  await saveCampaign({
    id: "verify-campaign",
    organizationId: "verify-org",
    slug: "verify-campaign",
    name: "Verification Campaign",
    status: "live",
    startAt: "2026-08-23T00:00:00",
    endAt: "2026-09-01T23:59:00",
    target: 50000,
    currency: "ILS",
    createdAt: now,
    updatedAt: now,
  });
  await saveCampaignConfig(
    "verify-org",
    "verify-campaign",
    {
      organization: {
        id: "verify-org",
        slug: "verify-org",
        name: "Verification Org",
      },
      basics: {
        id: "verify-campaign",
        organizationId: "verify-org",
        organizationSlug: "verify-org",
        organizationName: "Verification Org",
        slug: "verify-campaign",
        campaignName: "Verification Campaign",
        status: "live",
        target: 50000,
        currency: "ILS",
      },
      goals: {
        campaignGoal: 50000,
      },
      meta: {
        lastSavedAt: now,
        lastSavedBy: "verify@example.org",
      },
    },
    "verify@example.org",
  );
  await saveCampaignDataset("verify-org", "verify-campaign", {
    organizationId: "verify-org",
    campaignId: "verify-campaign",
    rows: [{ id: "demo-1", donor: "חסוי", ambassador: "שגריר בדיקה", amount: 123, createdIso: "2026-08-23T09:00", date: "2026-08-23", hour: 9, status: "success" }],
    meta: {
      uniqueDates: ["2026-08-23"],
      projectDates: ["2026-08-23"],
      defaultFrom: "2026-08-23",
      defaultTo: "2026-08-23",
      minDate: "2026-08-23",
      maxDate: "2026-08-23",
      rowCount: 1,
      projectWindowLabel: "2026-08-23 עד 2026-08-23",
    },
    sourceLabel: "protected-test-source.csv",
    generatedAt: now,
    updatedAt: now,
  });
}

async function main() {
  const uniqueEmail = `qa-admin-${Date.now()}@example.org`;
  process.env.YELLOW_DASHBOARD_MANAGER_EMAILS = JSON.stringify([
    {
      email: uniqueEmail,
      role: "platform_admin",
    },
  ]);

  const backups = await backupFiles([
    PLATFORM_STORE_PATH,
    AUTH_STORE_PATH,
    LEGACY_CAMPAIGN_STORE_PATH,
    LEGACY_SOURCE_STORE_PATH,
    LEGACY_DATASET_PATH,
  ]);

  try {
    await resetStores();
    await seedScopedCampaignDataset();

    const statusBefore = await authHandler(new Request("http://localhost/api/auth/status"));
    const statusBeforePayload = await readJson(statusBefore);
    assert(statusBeforePayload.authenticated === false, "Status before setup should be logged out.");

    const datasetBefore = await authHandler(new Request("http://localhost/api/admin/dataset"));
    const datasetBeforePayload = await readJson(datasetBefore);
    assert(datasetBefore.status === 401, "Admin dataset should be blocked before login.");
    assert(Boolean(datasetBeforePayload.message), "Unauthorized dataset response should return a message.");

    const firstLogin = await authHandler(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: uniqueEmail, password: "Secret123!" }),
      }),
    );
    assert(firstLogin.status === 409, "First login should require password setup.");

    const setupResponse = await authHandler(
      new Request("http://localhost/api/auth/setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: uniqueEmail,
          password: "Secret123!",
          confirmPassword: "Secret123!",
        }),
      }),
    );
    const setupPayload = await readJson(setupResponse);
    const setupCookie = setupResponse.headers.get("set-cookie") || "";
    assert(setupResponse.status === 200, "Setup should succeed.");
    assert(setupPayload.authenticated === true, "Setup should authenticate the manager.");
    assert(setupCookie.includes("yellow_dashboard_admin_session="), "Setup should return a session cookie.");

    const statusAfter = await authHandler(
      new Request("http://localhost/api/auth/status", {
        headers: { cookie: setupCookie },
      }),
    );
    const statusAfterPayload = await readJson(statusAfter);
    assert(statusAfterPayload.authenticated === true, "Status after setup should be authenticated.");
    assert(statusAfterPayload.email === uniqueEmail, "Status should return the seeded manager email.");
    assert(Array.isArray(statusAfterPayload.accessibleCampaigns), "Status should expose accessible campaigns.");
    assert(statusAfterPayload.accessibleCampaigns.length === 1, "Status should expose the seeded verification campaign.");

    const datasetAfter = await authHandler(
      new Request("http://localhost/api/admin/dataset", {
        headers: { cookie: setupCookie },
      }),
    );
    const datasetAfterPayload = await readJson(datasetAfter);
    assert(datasetAfter.status === 200, "Admin dataset should load after authentication.");
    assert(Array.isArray(datasetAfterPayload.rows), "Admin dataset should return rows.");
    assert(datasetAfterPayload.rows.length === 1, "Admin dataset test fixture should be returned.");
    assert(datasetAfterPayload.sourceLabel === "protected-test-source.csv", "Admin dataset should expose the protected source label.");
    assert(datasetAfterPayload.organizationId === "verify-org", "Admin dataset should be campaign scoped.");
    assert(datasetAfterPayload.campaignId === "verify-campaign", "Admin dataset should return the verification campaign scope.");

    const logoutResponse = await authHandler(
      new Request("http://localhost/api/auth/logout", {
        method: "POST",
        headers: { cookie: setupCookie },
      }),
    );
    const logoutPayload = await readJson(logoutResponse);
    assert(logoutResponse.status === 200, "Logout should succeed.");
    assert(logoutPayload.loggedOut === true, "Logout payload should confirm logout.");

    const secondLogin = await authHandler(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: uniqueEmail, password: "Secret123!" }),
      }),
    );
    const secondLoginPayload = await readJson(secondLogin);
    assert(secondLogin.status === 200, "Login after setup should succeed.");
    assert(secondLoginPayload.authenticated === true, "Login after setup should authenticate.");

    console.log("Netlify auth flow verification passed.");
  } finally {
    delete process.env.YELLOW_DASHBOARD_MANAGER_EMAILS;
    await restoreFiles(backups);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
