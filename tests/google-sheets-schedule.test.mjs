import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { defaultSourceConfig } from "../backend/services/multi-tenant-model.mjs";

test("automatic hosted campaign schedules stay disabled", async () => {
  const netlifyConfig = await readFile(fileURLToPath(new URL("../netlify.toml", import.meta.url)), "utf8");
  assert.doesNotMatch(netlifyConfig, /schedule\s*=/);
  assert.equal(defaultSourceConfig().googleSheets.syncIntervalMinutes, 2);
  assert.equal(defaultSourceConfig().googleSheets.syncEnabled, true);
});
