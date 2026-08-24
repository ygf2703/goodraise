import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { defaultSourceConfig } from "../netlify/lib/multi-tenant-model.mjs";

test("Google Sheets sync is scheduled every two minutes by Netlify", async () => {
  const netlifyConfig = await readFile(fileURLToPath(new URL("../netlify.toml", import.meta.url)), "utf8");
  assert.match(netlifyConfig, /\[functions\."google-sheets-sync"\][\s\S]*?schedule\s*=\s*"\*\/2 \* \* \* \*"/);
  assert.equal(defaultSourceConfig().googleSheets.syncIntervalMinutes, 2);
  assert.equal(defaultSourceConfig().googleSheets.syncEnabled, true);
});
