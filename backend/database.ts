import pg from "pg";
import { normalizePostgresConnectionString } from "./services/postgres-connection.mjs";

let pool: pg.Pool | undefined;

/** One bounded pool per Node process/function instance, shared by every service. */
export function getDatabasePool(): pg.Pool {
  if (!pool) {
    const connectionString = normalizePostgresConnectionString(process.env.GOODRAISE_DATABASE_URL || process.env.DATABASE_URL);
    if (!connectionString) throw new Error("GOODRAISE_DATABASE_URL is not configured.");
    pool = new pg.Pool({ connectionString, max: 4, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 10_000 });
    pool.on("error", (error: Error) => console.error("postgres_idle_connection_failed", { message: error.message }));
  }
  return pool;
}

export async function closeDatabasePool(): Promise<void> {
  const active = pool;
  pool = undefined;
  await active?.end();
}
