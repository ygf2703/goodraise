import assert from "node:assert/strict";
import { createHash, pbkdf2Sync } from "node:crypto";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { up } from "../../db/migrations/007_site_admins.ts";

const emails = ["ranbo7@gmail.com", "noamfrostig@gmail.com"];
const migrationName = "007_site_admins.ts";
const rows = async (client) => (await client.query("SELECT * FROM goodraise.admin_users WHERE email = ANY($1::text[]) ORDER BY email", [emails])).rows;

function matchesPassword(password, hash) {
  const [algorithm, iterations, salt, digest] = hash.split("$");
  assert.equal(algorithm, "pbkdf2_sha256");
  return pbkdf2Sync(password, Buffer.from(salt, "base64url"), Number(iterations), 32, "sha256").toString("base64url") === digest;
}

async function readCredentials(directory) {
  const files = await readdir(directory);
  assert.equal(files.length, 1, "exactly one private credentials file per applied bootstrap");
  assert.match(files[0], /^\.env\.007-site-admins-.*\.json$/);
  const path = join(directory, files[0]);
  assert.equal((await stat(directory)).mode & 0o777, 0o700);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  return JSON.parse(await readFile(path, "utf8"));
}

export async function verifySiteAdminMigration({ client, run, directory }) {
  const credentialsDirectory = process.env.GOODRAISE_MIGRATION_CREDENTIALS_DIR;
  const credentials = await readCredentials(credentialsDirectory);
  assert.equal(credentials.migration, migrationName);
  assert.equal(credentials.target.host, "127.0.0.1");
  assert.equal(credentials.target.database, "goodraise_test");
  assert.deepEqual(credentials.accounts.map((item) => item.email).sort(), [...emails].sort());
  assert.equal(new Set(credentials.accounts.map((item) => item.password)).size, 2);
  const before = await rows(client);
  assert.equal(before.length, 2);
  for (const account of credentials.accounts) {
    assert.match(account.password, /^[A-Za-z0-9_-]{32}$/);
    const saved = before.find((row) => row.email === account.email);
    assert.equal(saved.role, "platform_admin");
    assert.equal(saved.is_active, true);
    assert.ok(saved.password_set_at);
    assert.equal(matchesPassword(account.password, saved.password_hash), true);
    assert.ok(!JSON.stringify(before).includes(account.password), "no plaintext passwords persisted to SQL");
  }
  const checksum = createHash("sha256").update(await readFile(new URL("../../db/migrations/007_site_admins.ts", import.meta.url))).digest("hex");
  assert.equal((await client.query("SELECT checksum FROM goodraise.schema_migrations WHERE name=$1", [migrationName])).rows[0].checksum, checksum);
  const repeated = await run(process.execPath, ["--import", "tsx", "scripts/migrate-db.ts"], { env: process.env });
  assert.deepEqual(await rows(client), before, "rerun preserves identities, passwords and timestamps");
  assert.deepEqual(await readCredentials(credentialsDirectory), credentials, "rerun does not overwrite passwords");
  for (const { password } of credentials.accounts) assert.ok(!`${repeated.stdout}${repeated.stderr}`.includes(password));

  // Exercise the upgrade case without changing the real integration fixtures.
  await client.query("BEGIN");
  try {
    const unrelated = (await client.query("INSERT INTO goodraise.admin_users(id,email,role,password_hash) VALUES(gen_random_uuid(),'unrelated-bootstrap@example.org','viewer','preserved-unrelated-hash') RETURNING *")).rows[0];
    const organization = (await client.query("INSERT INTO goodraise.organizations(id,slug,name) VALUES(gen_random_uuid(),'bootstrap-test','Bootstrap test') RETURNING id")).rows[0].id;
    const ran = before.find((row) => row.email === emails[0]);
    await client.query("UPDATE goodraise.admin_users SET role='viewer',is_active=FALSE WHERE id=$1", [ran.id]);
    await client.query("INSERT INTO goodraise.admin_memberships(id,admin_user_id,organization_id,role) VALUES(gen_random_uuid(),$1,$2,'organization_admin')", [ran.id, organization]);
    await client.query("INSERT INTO goodraise.admin_sessions(token,admin_user_id,expires_at) VALUES('bootstrap-old-session',$1,NOW()+interval '1 day')", [ran.id]);
    const context = { connectionString: process.env.GOODRAISE_DATABASE_URL, credentialsDirectory: join(directory, "upgrade-credentials") };
    await up(client, context);
    assert.deepEqual((await client.query("SELECT * FROM goodraise.admin_users WHERE id=$1", [unrelated.id])).rows[0], unrelated, "other accounts remain unchanged");
    const upgraded = (await rows(client)).find((row) => row.email === ran.email);
    assert.equal(upgraded.id, ran.id);
    assert.equal(upgraded.password_hash, ran.password_hash);
    assert.deepEqual(upgraded.password_set_at, ran.password_set_at);
    assert.equal(upgraded.role, "platform_admin");
    assert.equal(upgraded.is_active, true);
    assert.equal((await client.query("SELECT 1 FROM goodraise.admin_sessions WHERE token='bootstrap-old-session'")).rowCount, 0);
    assert.equal((await client.query("SELECT 1 FROM goodraise.admin_memberships WHERE admin_user_id=$1", [ran.id])).rowCount, 0);
    await assert.rejects(stat(context.credentialsDirectory), { code: "ENOENT" }, "no credentials file when both passwords already exist");
    await client.query("INSERT INTO goodraise.admin_sessions(token,admin_user_id,expires_at) VALUES('bootstrap-unchanged-session',$1,NOW()+interval '1 day')", [ran.id]);
    const stable = await rows(client);
    await up(client, context);
    assert.deepEqual(await rows(client), stable);
    assert.equal((await client.query("SELECT 1 FROM goodraise.admin_sessions WHERE token='bootstrap-unchanged-session'")).rowCount, 1);

    await client.query("UPDATE goodraise.admin_users SET password_hash=NULL,password_set_at=NULL WHERE email=$1", [emails[1]]);
    await up(client, context);
    const generated = await readCredentials(context.credentialsDirectory);
    assert.deepEqual(generated.accounts.map((account) => account.email), [emails[1]]);
    assert.deepEqual(generated.existingPasswordsPreserved, [emails[0]]);
    assert.equal(matchesPassword(generated.accounts[0].password, (await rows(client)).find((row) => row.email === emails[1]).password_hash), true);
  } finally { await client.query("ROLLBACK"); }
  assert.deepEqual(await rows(client), before, "rollback restores both original accounts");

  // A failed credential export must not leave accounts or a migration marker.
  await client.query("CREATE DATABASE goodraise_bootstrap_failure");
  const failureUrl = new URL(process.env.GOODRAISE_DATABASE_URL);
  failureUrl.pathname = "/goodraise_bootstrap_failure";
  const blockedDirectory = join(directory, "not-a-directory");
  await writeFile(blockedDirectory, "test", { mode: 0o600 });
  const failureEnv = { ...process.env,
    GOODRAISE_MIGRATION_DATABASE_URL: failureUrl.href,
    GOODRAISE_DATABASE_URL: "postgresql://wrong-target.invalid/must-not-connect",
    GOODRAISE_MIGRATION_CREDENTIALS_DIR: blockedDirectory,
  };
  await assert.rejects(run(process.execPath, ["--import", "tsx", "scripts/migrate-db.ts"], { env: failureEnv }));
  const failed = new pg.Client({ connectionString: failureUrl.href });
  await failed.connect();
  try {
    assert.equal((await failed.query("SELECT 1 FROM goodraise.admin_users")).rowCount, 0);
    assert.equal((await failed.query("SELECT 1 FROM goodraise.schema_migrations WHERE name=$1", [migrationName])).rowCount, 0);
    const retryDirectory = join(directory, "retried-credentials");
    const retry = await run(process.execPath, ["--import", "tsx", "scripts/migrate-db.ts"], {
      env: { ...failureEnv, GOODRAISE_MIGRATION_CREDENTIALS_DIR: retryDirectory },
    });
    const retryCredentials = await readCredentials(retryDirectory);
    assert.equal((await failed.query("SELECT 1 FROM goodraise.admin_users")).rowCount, 2);
    for (const { email, password } of retryCredentials.accounts) {
      assert.ok(!`${retry.stdout}${retry.stderr}`.includes(password), "credentials never printed");
      assert.notEqual(password, credentials.accounts.find((account) => account.email === email).password, "different databases get different credentials");
    }
    // Mirror the sanitized local-restore path: users excluded, history retained.
    await failed.query("DELETE FROM goodraise.admin_users");
    await failed.query("DELETE FROM goodraise.schema_migrations WHERE name = '007_site_admins.ts'");
    await run(process.execPath, ["--import", "tsx", "scripts/migrate-db.ts"], {
      env: { ...failureEnv, GOODRAISE_MIGRATION_CREDENTIALS_DIR: join(directory, "restored-credentials") },
    });
    assert.equal((await failed.query("SELECT 1 FROM goodraise.admin_users")).rowCount, 2);
  } finally { await failed.end(); }
  console.log("Site-admin migration: private per-database passwords, repeat safety, existing-password preservation, session revocation, rollback/retry and sanitized restore verified.");
  return credentials;
}

export async function verifySiteAdminLogin({ client, handleRequest, adminCredentials }) {
  const originalManagers = process.env.GOODRAISE_MANAGER_EMAILS;
  try {
    // Matching runtime bootstrap configuration must not undo the migration.
    process.env.GOODRAISE_MANAGER_EMAILS = JSON.stringify(emails);
    for (const { email, password } of adminCredentials.accounts) {
      const before = (await rows(client)).find((row) => row.email === email);
      const response = await handleRequest(new Request("http://localhost/api/auth/login", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }),
      }));
      assert.equal(response.status, 200);
      const identity = await response.json();
      assert.equal(identity.email, email);
      assert.equal(identity.role, "platform_admin");
      const cookie = response.headers.get("set-cookie");
      const status = await handleRequest(new Request("http://localhost/api/auth/status", { headers: { cookie } }));
      const auth = await status.json();
      assert.equal(auth.permissions.siteAdmin, true);
      assert.equal(auth.permissions.manageUsers, true);
      assert.equal((await handleRequest(new Request("http://localhost/api/admin/accounts", { headers: { cookie } }))).status, 200);
      assert.equal((await rows(client)).find((row) => row.email === email).password_hash, before.password_hash);
      await handleRequest(new Request("http://localhost/api/auth/logout", { method: "POST", headers: { cookie } }));
    }
  } finally { process.env.GOODRAISE_MANAGER_EMAILS = originalManagers; }
}
