import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { traceQueries } from "./postgres-authorization-queries.mjs";

export async function verifyEmailNormalizationMigration(client) {
  const sql = await readFile(new URL("../../db/migrations/003_normalize_admin_email.sql", import.meta.url), "utf8");
  await client.query("BEGIN");
  try {
    await client.query("ALTER TABLE goodraise.admin_users DROP CONSTRAINT admin_users_email_normalized");
    const legacy = await client.query(`INSERT INTO goodraise.admin_users(id, email, password_hash)
      VALUES (gen_random_uuid(), ' Legacy.User@Example.org ', 'preserved-hash') RETURNING id::text`);
    const id = legacy.rows[0].id;
    await client.query(`INSERT INTO goodraise.admin_sessions(token,admin_user_id,expires_at)
      VALUES ('legacy-normalization-test', $1, NOW() + interval '1 day')`, [id]);
    await client.query(`INSERT INTO goodraise.admin_users(id,email) VALUES (gen_random_uuid(), 'legacy.user@example.org')`);
    await client.query("SAVEPOINT collision_check");
    await assert.rejects(client.query(sql), /collisions/, "case-colliding accounts must never be merged automatically");
    await client.query("ROLLBACK TO SAVEPOINT collision_check");
    assert.equal((await client.query("SELECT email FROM goodraise.admin_users WHERE id=$1", [id])).rows[0].email, " Legacy.User@Example.org ");
    await client.query("DELETE FROM goodraise.admin_users WHERE email='legacy.user@example.org'");
    await client.query(sql);
    const normalized = (await client.query("SELECT id::text,email,password_hash FROM goodraise.admin_users WHERE id=$1", [id])).rows[0];
    assert.deepEqual(normalized, { id, email: "legacy.user@example.org", password_hash: "preserved-hash" });
    assert.equal((await client.query("SELECT admin_user_id::text FROM goodraise.admin_sessions WHERE token='legacy-normalization-test'")).rows[0].admin_user_id, id);
    await client.query("SAVEPOINT constraint_check");
    await assert.rejects(client.query(`INSERT INTO goodraise.admin_users(id,email) VALUES (gen_random_uuid(),'Upper@Example.org')`), /admin_users_email_normalized/);
    await client.query("ROLLBACK TO SAVEPOINT constraint_check");
  } finally {
    await client.query("ROLLBACK");
  }
}

export async function verifySqlEmailAndSeeding({ client, handleRequest, getAuthStatus }) {
  const { getSessionToken } = await import("../../backend/services/auth-store.mjs");
  const originalManagers = process.env.GOODRAISE_MANAGER_EMAILS;
  const email = "mixed.case@example.org";
  const password = "MixedCaseTest123!";
  const request = (path, body, cookie = "") => handleRequest(new Request(`http://localhost${path}`, {
    method: "POST", headers: { cookie }, body: JSON.stringify(body),
  }));
  try {
    process.env.GOODRAISE_MANAGER_EMAILS = JSON.stringify([
      { email: " MiXeD.Case@Example.ORG ", role: "platform_admin" },
      ...Array.from({ length: 100 }, (_, index) => ({ email: `unrelated-manager-${index}@example.org`, role: "viewer" })),
    ]);
    const setup = await request("/api/auth/setup", { email: " MIXED.CASE@example.org ", password, confirmPassword: password });
    assert.equal(setup.status, 200);
    assert.equal((await setup.json()).email, email);
    const cookie = setup.headers.get("set-cookie");
    const row = async () => (await client.query("SELECT email, xmin::text AS version FROM goodraise.admin_users WHERE email=$1", [email])).rows[0];
    const before = await row();
    assert.equal(before.email, email);
    const authRequest = new Request("http://localhost/api/auth/status", { headers: { cookie } });
    const status = await traceQueries(() => getAuthStatus(authRequest));
    assert.equal(status.result.authenticated, true);
    assert.equal(status.result.email, email);
    assert.deepEqual(await row(), before, "an unchanged seeded account must not be rewritten");
    assert.equal(status.statements.filter(({ text }) => /INSERT INTO goodraise.admin_users/.test(text)).length, 1, "only seed the requested account even with 101 configured managers");
    assert.ok(!status.statements.some(({ text }) => /lower\(email\)/i.test(text)), "account queries must use the existing plain-email index");
    assert.equal((await client.query("SELECT count(*)::int AS count FROM goodraise.admin_users WHERE email LIKE 'unrelated-manager-%'")).rows[0].count, 0);

    await client.query(`INSERT INTO goodraise.admin_users(id,email)
      SELECT gen_random_uuid(), 'indexed-user-' || n || '@example.test' FROM generate_series(1,20000) AS n`);
    await client.query("ANALYZE goodraise.admin_users");
    const lookup = status.statements.find(({ text }) => /FROM goodraise.admin_users\s+WHERE email = \$1/.test(text));
    assert.ok(lookup);
    const plan = await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${lookup.text}`, lookup.values);
    assert.match(JSON.stringify(plan.rows), /admin_users_email_key/, "the existing unique email index serves the equality lookup");

    const secondSetup = await request("/api/auth/setup", { email: "mixed.CASE@EXAMPLE.ORG", password, confirmPassword: password });
    assert.equal(secondSetup.status, 409, "case variants cannot create another account");
    const login = await request("/api/auth/login", { email: "MIXED.CASE@EXAMPLE.ORG", password });
    assert.equal(login.status, 200);
    assert.equal((await login.json()).email, email);
    const change = await request("/api/auth/change-password", { currentPassword: password, newPassword: "NewMixedCase123!", confirmPassword: "NewMixedCase123!" }, login.headers.get("set-cookie"));
    assert.equal(change.status, 200);
    assert.equal((await getAuthStatus(authRequest)).authenticated, false, "password change revokes earlier sessions");
    const nextCookie = change.headers.get("set-cookie");
    const nextRequest = new Request("http://localhost/api/auth/status", { headers: { cookie: nextCookie } });
    assert.equal((await getAuthStatus(nextRequest)).authenticated, true);
    const token = getSessionToken(nextRequest);
    await client.query("UPDATE goodraise.admin_sessions SET expires_at=NOW()-interval '1 minute' WHERE token=$1", [token]);
    assert.equal((await getAuthStatus(nextRequest)).authenticated, false, "expired sessions still fail and are cleaned up");
    assert.equal((await client.query("SELECT token FROM goodraise.admin_sessions WHERE token=$1", [token])).rowCount, 0);
    console.log("Email checks: legacy normalization/collision rollback, mixed-case setup/login, indexed equality with 20,000 synthetic accounts, one seed attempt with 101 configured managers, unchanged-account writes skipped, password/session expiry behavior preserved.");
  } finally {
    if (originalManagers === undefined) delete process.env.GOODRAISE_MANAGER_EMAILS;
    else process.env.GOODRAISE_MANAGER_EMAILS = originalManagers;
  }
}

export async function verifyEmailMigrationGuard({ database, run }) {
  await database.createDatabase("email_guard");
  const client = database.getPgClient("email_guard");
  await client.connect();
  try {
    await client.query(await readFile(new URL("../../db/migrations/001_initial.sql", import.meta.url), "utf8"));
    await client.query(`INSERT INTO goodraise.admin_users(id,email,password_hash)
      VALUES (gen_random_uuid(),'Legacy.User@Example.org','preserved-hash')`);
    const url = new URL(process.env.GOODRAISE_DATABASE_URL);
    url.pathname = "/email_guard";
    await assert.rejects(run(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
      import { setupManagerPassword } from './backend/services/auth-store.mjs';
      import { closeDatabasePool } from './backend/database.ts';
      try {
        await setupManagerPassword({ email: 'legacy.user@example.org', password: 'Example123!', confirmPassword: 'Example123!', request: new Request('http://localhost/api/auth/setup') });
      } finally { await closeDatabasePool(); }
    `], { env: { ...process.env, GOODRAISE_DATABASE_URL: url.toString(), GOODRAISE_MANAGER_EMAILS: '["legacy.user@example.org"]' } }),
    (error) => error.stderr.includes("003_normalize_admin_email.sql required"));
    const users = await client.query("SELECT email,password_hash FROM goodraise.admin_users");
    assert.deepEqual(users.rows, [{ email: "Legacy.User@Example.org", password_hash: "preserved-hash" }], "missing migration must fail before another account can be seeded");
  } finally { await client.end(); }
}
