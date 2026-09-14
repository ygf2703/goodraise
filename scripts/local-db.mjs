import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import pg from "pg";
import { normalizePostgresConnectionString } from "../backend/services/postgres-connection.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const composeFile = join(repositoryRoot, "compose.yaml");
const backupDirectory = join(repositoryRoot, "work", "database-backups");
const postgresImage = "postgres:18-alpine";
const excludedTableData = [
  "goodraise.admin_users",
  "goodraise.admin_sessions",
  "goodraise.admin_memberships",
  "goodraise.campaign_applications",
  "goodraise.campaign_application_events",
  "goodraise.campaign_sources",
];
const localDatabase = process.env.GOODRAISE_LOCAL_DB_NAME || "goodraise";
const localUser = process.env.GOODRAISE_LOCAL_DB_USER || "goodraise";
const localPassword = process.env.GOODRAISE_LOCAL_DB_PASSWORD || "goodraise-local-only";
const localPort = process.env.GOODRAISE_LOCAL_DB_PORT || "55432";
const localDatabaseUrl = process.env.GOODRAISE_LOCAL_DATABASE_URL
  || `postgresql://${encodeURIComponent(localUser)}:${encodeURIComponent(localPassword)}@127.0.0.1:${localPort}/${encodeURIComponent(localDatabase)}`;
const composeEnvironment = {
  ...process.env,
  GOODRAISE_LOCAL_DB_NAME: localDatabase,
  GOODRAISE_LOCAL_DB_USER: localUser,
  GOODRAISE_LOCAL_DB_PASSWORD: localPassword,
  GOODRAISE_LOCAL_DB_PORT: localPort,
};

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      env: options.env || process.env,
      stdio: options.stdio || "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} exited with ${code ?? signal}`));
    });
  });
}

function runResult(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      env: options.env || process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => resolvePromise({ code, stdout, stderr }));
  });
}

function compose(...args) {
  return run("docker", ["compose", "--file", composeFile, ...args], { env: composeEnvironment });
}

function composeResult(...args) {
  return runResult("docker", ["compose", "--file", composeFile, ...args], { env: composeEnvironment });
}

async function waitUntilReady() {
  for (let attempt = 0; attempt < 45; attempt += 1) {
    const result = await composeResult("exec", "-T", "postgres", "pg_isready", "-U", localUser, "-d", localDatabase);
    if (result.code === 0) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000));
  }
  throw new Error("Local PostgreSQL did not become ready within 45 seconds.");
}

async function startLocalDatabase() {
  await mkdir(backupDirectory, { recursive: true, mode: 0o700 });
  await chmod(backupDirectory, 0o700);
  await compose("up", "-d", "postgres");
  await waitUntilReady();
  console.log(`Local PostgreSQL is ready on 127.0.0.1:${localPort}.`);
}

async function queryDatabase(connectionString, text, parameters = []) {
  const client = new pg.Client({ connectionString: normalizePostgresConnectionString(connectionString) });
  await client.connect();
  try {
    return await client.query(text, parameters);
  } finally {
    await client.end();
  }
}

async function databaseSummary(connectionString) {
  const result = await queryDatabase(connectionString, `
    SELECT table_name,
      (xpath('/row/count/text()', query_to_xml(format('SELECT COUNT(*) AS count FROM goodraise.%I', table_name), false, true, '')))[1]::text::bigint AS row_count
    FROM information_schema.tables
    WHERE table_schema = 'goodraise' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);
  return Object.fromEntries(result.rows.map((row) => [row.table_name, Number(row.row_count)]));
}

async function printStatus() {
  const ready = await composeResult("exec", "-T", "postgres", "pg_isready", "-U", localUser, "-d", localDatabase);
  if (ready.code !== 0) {
    console.log("Local PostgreSQL is not running.");
    return;
  }
  const counts = await databaseSummary(localDatabaseUrl).catch(() => ({}));
  const migrations = await queryDatabase(localDatabaseUrl, `
    SELECT name FROM goodraise.schema_migrations ORDER BY name
  `).catch(() => ({ rows: [] }));
  console.log(JSON.stringify({
    connection: `postgresql://${localUser}:***@127.0.0.1:${localPort}/${localDatabase}`,
    migrations: migrations.rows.map((row) => row.name),
    tables: counts,
  }, null, 2));
}

function validateSourceUrl(value) {
  if (!value) {
    throw new Error("Set GOODRAISE_SOURCE_DATABASE_URL to the direct source PostgreSQL URL for this one command.");
  }
  const url = new URL(value);
  if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error("The source URL must be a PostgreSQL URL.");
  if (["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    throw new Error("The source URL points to the local machine; refusing to treat it as the remote source database.");
  }
  if (url.hostname.includes("-pooler")) {
    throw new Error("Use Neon's direct (non-pooler) URL for backup and migration operations.");
  }
  return url;
}

function timestamp() {
  return new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function createBackup(sourceUrl) {
  validateSourceUrl(sourceUrl);
  await mkdir(backupDirectory, { recursive: true, mode: 0o700 });
  await chmod(backupDirectory, 0o700);
  const filename = `goodraise-neon-${timestamp()}.dump`;
  const backupPath = join(backupDirectory, filename);
  const environmentDirectory = await mkdtemp(join(tmpdir(), "goodraise-db-source-"));
  const environmentFile = join(environmentDirectory, "postgres.env");
  await writeFile(environmentFile, `PGSOURCE_URL=${sourceUrl}\n`, { mode: 0o600 });
  try {
    await run("docker", [
      "run", "--rm",
      "--env-file", environmentFile,
      "--volume", `${backupDirectory}:/backups`,
      postgresImage,
      "sh", "-ceu",
      `exec pg_dump --dbname="$PGSOURCE_URL" --format=custom --compress=9 --file=/backups/${filename} --schema=goodraise --no-owner --no-privileges ${excludedTableData.map((table) => `--exclude-table-data=${table}`).join(" ")}`,
    ]);
  } finally {
    await rm(environmentDirectory, { recursive: true, force: true });
  }
  await chmod(backupPath, 0o600);
  const source = new URL(sourceUrl);
  const metadata = {
    createdAt: new Date().toISOString(),
    sourceHost: source.hostname,
    sourceDatabase: source.pathname.slice(1),
    backup: filename,
    sha256: await sha256(backupPath),
    excludedData: excludedTableData,
  };
  await writeFile(join(backupDirectory, `${filename}.json`), `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o600 });
  console.log(`Created protected local backup: work/database-backups/${filename}`);
  console.log("Production authentication, application-review, and source-credential rows were excluded from the backup.");
  return backupPath;
}

async function latestBackup() {
  const files = (await readdir(backupDirectory).catch(() => []))
    .filter((name) => name.endsWith(".dump"))
    .sort()
    .reverse();
  if (!files.length) throw new Error("No database backup exists under work/database-backups.");
  return join(backupDirectory, files[0]);
}

async function restoreBackup(path) {
  if (!process.argv.includes("--replace-local")) {
    throw new Error("Restoring replaces the local goodraise schema. Re-run with --replace-local.");
  }
  const resolvedPath = resolve(repositoryRoot, path || await latestBackup());
  if (!resolvedPath.startsWith(`${backupDirectory}/`) || !resolvedPath.endsWith(".dump")) {
    throw new Error("Restore files must be .dump files under work/database-backups.");
  }
  await readFile(resolvedPath);
  await startLocalDatabase();
  await compose(
    "exec", "-T", "postgres", "psql", "-v", "ON_ERROR_STOP=1", "-U", localUser, "-d", localDatabase,
    "-c", "DROP SCHEMA IF EXISTS goodraise CASCADE;",
  );
  await compose(
    "exec", "-T", "postgres", "pg_restore", "--exit-on-error", "--no-owner", "--no-privileges",
    "-U", localUser, "-d", localDatabase, `/backups/${basename(resolvedPath)}`,
  );
  // Sanitized backups retain migration history but deliberately omit users.
  // Reapply only the account bootstrap; it preserves any existing passwords.
  await compose(
    "exec", "-T", "postgres", "psql", "-v", "ON_ERROR_STOP=1", "-U", localUser, "-d", localDatabase,
    "-c", "DELETE FROM goodraise.schema_migrations WHERE name = '007_site_admins.ts';",
  );
  await run(process.execPath, ["--import", "tsx", "scripts/migrate-db.ts"], {
    env: {
      ...process.env,
      GOODRAISE_DATABASE_URL: localDatabaseUrl,
      GOODRAISE_MIGRATION_DATABASE_URL: localDatabaseUrl,
      DATABASE_URL: "",
      GOODRAISE_RUN_RUNTIME_SCHEMA_MIGRATIONS: "false",
    },
  });
  console.log(`Restored ${basename(resolvedPath)} and applied all repository migrations.`);
  await printStatus();
}

async function main() {
  const [command, possiblePath] = process.argv.slice(2).filter((argument) => argument !== "--replace-local");
  if (command === "up") return startLocalDatabase();
  if (command === "down") return compose("down");
  if (command === "status") return printStatus();
  if (command === "backup") return createBackup(process.env.GOODRAISE_SOURCE_DATABASE_URL);
  if (command === "restore") return restoreBackup(possiblePath);
  if (command === "clone") {
    const backupPath = await createBackup(process.env.GOODRAISE_SOURCE_DATABASE_URL);
    return restoreBackup(backupPath);
  }
  throw new Error("Usage: local-db.mjs <up|down|status|backup|restore|clone> [backup.dump] [--replace-local]");
}

await main();
