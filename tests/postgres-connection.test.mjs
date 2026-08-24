import assert from "node:assert/strict";
import test from "node:test";

import { normalizePostgresConnectionString } from "../netlify/lib/postgres-connection.mjs";

test("normalizes legacy sslmode aliases to verify-full", () => {
  const result = normalizePostgresConnectionString("postgresql://user:secret@example.test/db?sslmode=require");
  assert.match(result, /sslmode=verify-full/);
  assert.doesNotMatch(result, /sslmode=require/);
});
