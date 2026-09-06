import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildCampaignInsightContext, getDeterministicInsightAnswer } from "../netlify/lib/insight-assistant.mjs";
import { applyConfiguredProjectWindow } from "../netlify/lib/campaign-repositories.mjs";

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
    maximumSingleDonation: 200,
    minimumSingleDonation: 200,
    activeAmbassadors: 1,
    targetPercent: 20,
  });
  assert.deepEqual(context.ambassadorTotals, [{ label: "שגריר א", total: 200 }]);
  assert.equal(context.ambassadorTotalsTruncated, false);
  assert.deepEqual(context.dailyTotals, [{ label: "2026-09-01", total: 200 }]);
  assert.deepEqual(context.hourlyTotals, [{ label: "10:00", total: 200 }]);

  const serialized = JSON.stringify(context);
  assert.doesNotMatch(serialized, /תורם סודי|donor@example\.com|0500000000|תל אביב/);
});

test("insight assistant uses the configured campaign window and answers maximum donation deterministically", () => {
  const context = buildCampaignInsightContext({
    campaign: { currency: "ILS" },
    dataset: {
      meta: { defaultFrom: "2026-09-01", defaultTo: "2026-09-02" },
      rows: [
        { status: "success", amount: 100, ambassador: "א", date: "2026-08-31" },
        { status: "success", amount: 720, ambassador: "ב", date: "2026-09-01" },
        { status: "success", amount: 180, ambassador: "ג", date: "2026-09-02" },
        { status: "success", amount: 5000, ambassador: "ד", date: "2026-09-03" },
      ],
    },
  });

  assert.deepEqual(context.metrics, {
    totalRaised: 900,
    successfulTransactions: 2,
    averageDonation: 450,
    maximumSingleDonation: 720,
    minimumSingleDonation: 180,
    activeAmbassadors: 2,
    targetPercent: null,
  });
  assert.match(getDeterministicInsightAnswer("מה סכום התרומה הגדול ביותר שנכנסה?", context), /720/);
  assert.match(getDeterministicInsightAnswer("מה סך הגיוס?", context), /900/);
  assert.match(getDeterministicInsightAnswer("כמה תרומות נכנסו?", context), /2/);
  assert.match(getDeterministicInsightAnswer("כמה שגרירים פעילים?", context), /2/);
  assert.match(getDeterministicInsightAnswer("מי השגריר המוביל?", context), /ב/);
  assert.match(getDeterministicInsightAnswer("איזה יום היה יום השיא?", context), /2026-09-01/);
  assert.match(getDeterministicInsightAnswer("מה טווח תאריכי הקמפיין?", context), /2026-09-01 עד 2026-09-02/);
});

test("server campaign context preserves the dashboard dataset window over stale builder draft dates", () => {
  const dataset = applyConfiguredProjectWindow(
    {
      meta: {
        projectDates: ["2026-08-23", "2026-08-24"],
        defaultFrom: "2026-08-23",
        defaultTo: "2026-08-24",
      },
      rows: [],
    },
    { basics: { startDate: "2026-03-15", endDate: "2026-03-24" } },
    {},
  );

  assert.equal(dataset.meta.defaultFrom, "2026-08-23");
  assert.equal(dataset.meta.defaultTo, "2026-08-24");
});

test("insight assistant includes the full ambassador totals list for fundraising range questions", () => {
  const rows = Array.from({ length: 20 }, (_, index) => ({
    status: "success",
    amount: index + 1,
    ambassador: `שגריר ${index + 1}`,
    date: "2026-09-01",
    hour: 12,
  }));
  const context = buildCampaignInsightContext({ dataset: { rows } });

  assert.equal(context.ambassadorTotals.length, 20);
  assert.deepEqual(context.ambassadorTotals.at(-1), { label: "שגריר 1", total: 1 });
  assert.equal(context.ambassadorTotalsTruncated, false);
});

test("insight question endpoint is campaign-scoped and manager-authorized", async () => {
  const authFunction = await readFile(new URL("../netlify/functions/auth.mjs", import.meta.url), "utf8");
  const authorization = await readFile(new URL("../netlify/lib/authorization.mjs", import.meta.url), "utf8");

  assert.match(authFunction, /matchScopedCampaignRoute\(pathname, "\/insights\/questions"\)/);
  assert.match(authFunction, /answerCampaignInsightQuestion\(request, payload, scopedInsightQuestion\)/);
  assert.match(authorization, /insight_query: ROLE_CAMPAIGN_MANAGER/);
});

test("dashboard places the insight assistant beneath the campaign summary and before manual matching", async () => {
  const template = await readFile(new URL("../work/build_yellow_dashboard.py", import.meta.url), "utf8");
  const summaryIndex = template.indexOf('id="hero-badges"');
  const assistantIndex = template.indexOf('id="insight-assistant-form"');
  const manualContributionIndex = template.indexOf('id="add-manual-contribution"');

  assert.ok(summaryIndex >= 0 && assistantIndex > summaryIndex && manualContributionIndex > assistantIndex);
  assert.match(template, /buildScopedAdminEndpoint\("insight-question", scope\)/);
  assert.match(template, /התשובה תופיע כאן לאחר שליחת השאלה/);
});

test("insight assistant classifies provider failures without exposing provider payloads", async () => {
  const moduleSource = await readFile(new URL("../netlify/lib/insight-assistant.mjs", import.meta.url), "utf8");

  assert.match(moduleSource, /OPENAI_AUTH_FAILED/);
  assert.match(moduleSource, /OPENAI_RATE_LIMITED/);
  assert.match(moduleSource, /OPENAI_TIMEOUT/);
  assert.match(moduleSource, /providerStatus: error\?\.providerStatus \|\| null/);
});
