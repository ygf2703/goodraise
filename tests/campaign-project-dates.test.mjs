import assert from "node:assert/strict";
import test from "node:test";

import { buildCampaignProjectDates } from "../netlify/lib/campaign-store.mjs";

test("builds the complete configured campaign window without a fixed duration", () => {
  assert.deepEqual(
    buildCampaignProjectDates("2026-08-23T09:00:00", "2026-09-01T22:00:00"),
    ["2026-08-23", "2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28", "2026-08-29", "2026-08-30", "2026-08-31", "2026-09-01"],
  );
});

test("rejects an invalid or reversed campaign window", () => {
  assert.deepEqual(buildCampaignProjectDates("", "2026-09-01T22:00:00"), []);
  assert.deepEqual(buildCampaignProjectDates("2026-09-02T09:00:00", "2026-09-01T22:00:00"), []);
});
