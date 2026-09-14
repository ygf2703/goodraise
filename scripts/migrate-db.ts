import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { normalizePostgresConnectionString } from "../backend/services/postgres-connection.mjs";
import type { CodeMigration } from "./migration-types.ts";

const connectionString = normalizePostgresConnectionString(
  process.env.GOODRAISE_MIGRATION_DATABASE_URL
  || process.env.GOODRAISE_DATABASE_URL
  || process.env.DATABASE_URL,
);
if (!connectionString) throw new Error("Set GOODRAISE_MIGRATION_DATABASE_URL or GOODRAISE_DATABASE_URL before running database migrations.");
const client = new pg.Client({ connectionString });
await client.connect();
try {
  await client.query("SELECT pg_advisory_lock(hashtext('goodraise:schema-migrations'))");
  await client.query("CREATE SCHEMA IF NOT EXISTS goodraise; CREATE TABLE IF NOT EXISTS goodraise.schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())");
  const directory = resolve(import.meta.dirname, "../db/migrations");
  for (const name of (await readdir(directory)).filter((name) => /^\d+_.+\.(sql|ts)$/.test(name)).sort()) {
    const path = resolve(directory, name);
    const source = await readFile(path, "utf8");
    const checksum = createHash("sha256").update(source).digest("hex");
    const applied = await client.query<{ checksum: string }>("SELECT checksum FROM goodraise.schema_migrations WHERE name = $1", [name]);
    if (applied.rowCount) {
      if (applied.rows[0].checksum !== checksum) throw new Error(`Applied migration ${name} has changed. Add a new migration instead.`);
      continue;
    }
    await client.query("BEGIN");
    try {
      let notices: string[] = [];
      if (name.endsWith(".sql")) {
        await client.query(source);
      } else {
        const migration: CodeMigration = await import(pathToFileURL(path).href);
        notices = await migration.up(client, {
          connectionString,
          credentialsDirectory: resolve(process.env.GOODRAISE_MIGRATION_CREDENTIALS_DIR || resolve(import.meta.dirname, "../work/private/admin-credentials")),
        });
      }
      await client.query("INSERT INTO goodraise.schema_migrations(name, checksum) VALUES ($1, $2)", [name, checksum]);
      await client.query("COMMIT");
      console.log(`Applied ${name}`);
      for (const notice of notices) console.log(notice);
    } catch (error) { await client.query("ROLLBACK"); throw error; }
  }
} finally { await client.end(); }
