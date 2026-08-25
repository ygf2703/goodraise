import assert from "node:assert/strict";
import test from "node:test";

import { buildCampaignProjectDates } from "../netlify/lib/campaign-store.mjs";
import { applyConfiguredProjectWindow } from "../netlify/lib/campaign-repositories.mjs";

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

test("uses builder dates for the response even when a stored campaign timestamp is stale", () => {
  const dataset = applyConfiguredProjectWindow(
    { rows: [], meta: { projectDates: ["2026-03-15"], defaultTo: "2026-03-15" } },
    { basics: { startDate: "2026-08-23", startTime: "09:00", endDate: "2026-09-01", endTime: "22:00" } },
    { startAt: "2026-03-15T00:00:00", endAt: "2026-03-24T23:59:00" },
  );

  assert.equal(dataset.meta.defaultFrom, "2026-08-23");
  assert.equal(dataset.meta.defaultTo, "2026-09-01");
  assert.equal(dataset.meta.projectDates.length, 10);
});
