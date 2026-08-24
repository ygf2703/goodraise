import assert from "node:assert/strict";
import test from "node:test";

import { config as googleSheetsSyncSchedule } from "../netlify/functions/google-sheets-sync.mjs";
import { defaultSourceConfig } from "../netlify/lib/multi-tenant-model.mjs";

test("Google Sheets sync is scheduled every two minutes by default", () => {
  assert.equal(googleSheetsSyncSchedule.schedule, "*/2 * * * *");
  assert.equal(defaultSourceConfig().googleSheets.syncIntervalMinutes, 2);
  assert.equal(defaultSourceConfig().googleSheets.syncEnabled, true);
});
