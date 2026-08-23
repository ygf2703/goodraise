import test from "node:test";
import assert from "node:assert/strict";

import { selectPrelaunchResetCandidates } from "../netlify/lib/prelaunch-reset.mjs";

const campaigns = [
  {
    organizationId: "org-alpha",
    id: "alpha-1",
    status: "live",
    startAt: "2026-08-23T00:00:00+03:00",
  },
  {
    organizationId: "org-alpha",
    id: "alpha-2",
    status: "draft",
    startAt: "2026-08-23T00:00:00+03:00",
  },
  {
    organizationId: "org-beta",
    id: "beta-1",
    status: "live",
    startAt: "2026-09-01T00:00:00+03:00",
  },
];

test("prelaunch reset selects only live campaigns for the scheduled start date", () => {
  const result = selectPrelaunchResetCandidates(
    {
      targetStartDate: "2026-08-23",
      onlyLiveCampaigns: true,
    },
    campaigns,
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].id, "alpha-1");
});

test("prelaunch reset can target an explicit organization/campaign pair", () => {
  const result = selectPrelaunchResetCandidates(
    {
      explicitTarget: {
        organizationId: "org-alpha",
        campaignId: "alpha-2",
      },
    },
    campaigns,
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].id, "alpha-2");
});

test("prelaunch reset returns no candidates when the date does not match", () => {
  const result = selectPrelaunchResetCandidates(
    {
      targetStartDate: "2026-08-25",
      onlyLiveCampaigns: true,
    },
    campaigns,
  );
  assert.equal(result.length, 0);
});
