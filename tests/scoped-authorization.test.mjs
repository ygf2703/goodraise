import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyScopedAuthorization } from "./helpers/scoped-authorization.mjs";

test("direct authorization and legacy selection preserve roles, tenant scope and session revocation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "goodraise-scope-test-"));
  const keys = ["GOODRAISE_DATABASE_URL", "DATABASE_URL", "NETLIFY", "NETLIFY_LOCAL", "SITE_ID", "URL", "SITE_NAME", "GOODRAISE_DATA_DIR"];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  try {
    for (const key of keys) delete process.env[key];
    process.env.GOODRAISE_DATA_DIR = directory;
    const repo = await import("../backend/services/campaign-repositories.mjs");
    const { handleRequest } = await import("../backend/app.ts");
    const { resolveScopedAccess, getAuthStatus } = await import("../backend/services/auth-store.mjs");
    await verifyScopedAuthorization({ repo, handleRequest, resolveScopedAccess, getAuthStatus });
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(directory, { recursive: true, force: true });
  }
});
