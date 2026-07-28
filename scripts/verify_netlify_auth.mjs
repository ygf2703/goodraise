import authHandler from "../netlify/functions/auth.mjs";

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

  const statusBefore = await authHandler(new Request("http://localhost/api/auth/status"));
  const statusBeforePayload = await readJson(statusBefore);
  assert(statusBeforePayload.authenticated === false, "Status before setup should be logged out.");

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
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
