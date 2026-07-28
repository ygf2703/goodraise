import authHandler from "../netlify/functions/auth.mjs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DATASET_PATH = fileURLToPath(new URL("../netlify/data/admin-dataset.json", import.meta.url));

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function readJson(response) {
  return response.json();
}

async function main() {
  const uniqueEmail = `qa-admin-${Date.now()}@example.org`;
  process.env.YELLOW_DASHBOARD_MANAGER_EMAILS = uniqueEmail;
  await mkdir(dirname(DATASET_PATH), { recursive: true });
  let previousDatasetContent = null;
  try {
    previousDatasetContent = await readFile(DATASET_PATH, "utf8");
  } catch {}
  await writeFile(
    DATASET_PATH,
    JSON.stringify(
      {
        rows: [{ id: "demo-1", donor: "חסוי", ambassador: "שגריר בדיקה", amount: 123 }],
        meta: { totalAmount: 123, totalTransactions: 1 },
        sourceLabel: "protected-test-source.csv",
        generatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    "utf8",
  );

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

  if (previousDatasetContent !== null) {
    await writeFile(DATASET_PATH, previousDatasetContent, "utf8");
  }

  console.log("Netlify auth flow verification passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
