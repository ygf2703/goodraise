import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildCampaignInsightContext } from "../netlify/lib/insight-assistant.mjs";

test("insight assistant sends aggregate campaign data without donor personal details", () => {
  const context = buildCampaignInsightContext({
    campaign: { name: "קמפיין בדיקה", status: "live", target: 1000, currency: "ILS" },
    dataset: {
      updatedAt: "2026-09-01T10:00:00.000Z",
      meta: { projectDates: ["2026-09-01"] },
      rows: [
        {
          status: "success",
          amount: 200,
          ambassador: "שגריר א",
          date: "2026-09-01",
          hour: 10,
          donor: "תורם סודי",
          email: "donor@example.com",
          phone: "0500000000",
          city: "תל אביב",
        },
        { status: "failed", amount: 300, ambassador: "שגריר ב", date: "2026-09-01", hour: 11 },
      ],
    },
  });

  assert.deepEqual(context.metrics, {
    totalRaised: 200,
    successfulTransactions: 1,
    averageDonation: 200,
    activeAmbassadors: 1,
    targetPercent: 20,
  });
  assert.deepEqual(context.topAmbassadors, [{ label: "שגריר א", total: 200 }]);
  assert.deepEqual(context.dailyTotals, [{ label: "2026-09-01", total: 200 }]);
  assert.deepEqual(context.hourlyTotals, [{ label: "10:00", total: 200 }]);

  const serialized = JSON.stringify(context);
  assert.doesNotMatch(serialized, /תורם סודי|donor@example\.com|0500000000|תל אביב/);
});

test("insight question endpoint is campaign-scoped and manager-authorized", async () => {
  const authFunction = await readFile(new URL("../netlify/functions/auth.mjs", import.meta.url), "utf8");
  const authorization = await readFile(new URL("../netlify/lib/authorization.mjs", import.meta.url), "utf8");

  assert.match(authFunction, /matchScopedCampaignRoute\(pathname, "\/insights\/questions"\)/);
  assert.match(authFunction, /answerCampaignInsightQuestion\(request, payload, scopedInsightQuestion\)/);
  assert.match(authorization, /insight_query: ROLE_CAMPAIGN_MANAGER/);
});

test("dashboard places the insight assistant beneath the summary metric bar", async () => {
  const template = await readFile(new URL("../work/build_yellow_dashboard.py", import.meta.url), "utf8");
  const metricIndex = template.indexOf('<section id="metrics-grid"');
  const assistantIndex = template.indexOf('id="insight-assistant-form"');
  const goalsIndex = template.indexOf("<h3>יעדים מול ביצוע</h3>");

  assert.ok(metricIndex >= 0 && assistantIndex > metricIndex && goalsIndex > assistantIndex);
  assert.match(template, /buildScopedAdminEndpoint\("insight-question", scope\)/);
});
