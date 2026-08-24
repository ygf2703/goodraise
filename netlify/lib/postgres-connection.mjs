export function normalizePostgresConnectionString(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  try {
    const url = new URL(raw);
    const sslMode = String(url.searchParams.get("sslmode") || "").toLowerCase();
    if (["require", "prefer", "verify-ca"].includes(sslMode)) {
      // Neon provides a public certificate. Use an explicit secure mode so pg
      // does not emit a warning for every serverless invocation.
      url.searchParams.set("sslmode", "verify-full");
    }
    return url.toString();
  } catch {
    return raw;
  }
}

export function shouldRunRuntimeSchemaMigrations() {
  return String(process.env.GOODRAISE_RUN_RUNTIME_SCHEMA_MIGRATIONS || "").trim().toLowerCase() === "true";
}
