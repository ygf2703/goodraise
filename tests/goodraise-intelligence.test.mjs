import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

function groupBy(rows, getKey) {
  const map = new Map();
  rows.forEach((row) => {
    const key = getKey(row);
    if (!map.has(key)) {
      map.set(key, []);
    }
    map.get(key).push(row);
  });
  return map;
}

function sumAmount(rows) {
  return rows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
}

function buildLeaderboard(rows) {
  return [...groupBy(rows.filter((row) => row.ambassador && row.ambassador !== "ללא שיוך"), (row) => row.ambassador).entries()]
    .map(([ambassador, items]) => ({
      ambassador,
      total: sumAmount(items),
      deals: items.length,
    }))
    .sort((left, right) => right.total - left.total || right.deals - left.deals || left.ambassador.localeCompare(right.ambassador, "he"));
}

async function loadEngineFactory() {
  const source = await readFile(new URL("../work/frontend/goodraise-intelligence.js", import.meta.url), "utf8");
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(`${source}\nthis.__factory = createGoodRaiseIntelligence;`, sandbox);
  return sandbox.__factory;
}

function buildRows() {
  return [
    { ambassador: "דנה", amount: 250, status: "success", createdIso: "2026-08-01T08:00:00", date: "2026-08-01", hour: 8, donor: "תורם 1" },
    { ambassador: "דנה", amount: 300, status: "success", createdIso: "2026-08-01T11:00:00", date: "2026-08-01", hour: 11, donor: "תורם 2" },
    { ambassador: "רועי", amount: 500, status: "success", createdIso: "2026-08-01T10:00:00", date: "2026-08-01", hour: 10, donor: "תורם 3" },
    { ambassador: "רועי", amount: 100, status: "failed", createdIso: "2026-08-01T12:00:00", date: "2026-08-01", hour: 12, donor: "תורם 4" },
    { ambassador: "תמר", amount: 600, status: "success", createdIso: "2026-08-02T09:00:00", date: "2026-08-02", hour: 9, donor: "תורם 5" },
    { ambassador: "תמר", amount: 200, status: "success", createdIso: "2026-08-02T13:00:00", date: "2026-08-02", hour: 13, donor: "תורם 6" },
    { ambassador: "ללא שיוך", amount: 180, status: "success", createdIso: "2026-08-02T14:00:00", date: "2026-08-02", hour: 14, donor: "תורם 7" },
  ];
}

function buildContext() {
  return {
    organizationId: "org-alpha",
    campaignId: "campaign-alpha-1",
    meta: {
      projectDates: ["2026-08-01", "2026-08-02", "2026-08-03"],
      uniqueDates: ["2026-08-01", "2026-08-02", "2026-08-03"],
    },
    goals: {
      total: 5000,
      daily: 1500,
      ambassadorGoal: 1200,
    },
    prizeModel: {
      placePrizes: [{ place: 1, label: "מקום 1", prize: "פרס גדול" }],
      tierPrizes: [
        { threshold: 1000, prize: "Silver" },
        { threshold: 2000, prize: "Gold" },
      ],
    },
    ambassadorDirectory: [
      { fullName: "דנה", personalTarget: 1200, team: "מרכז", email: "dana@example.org", phone: "0500000001" },
      { fullName: "רועי", personalTarget: 1000, team: "דרום", email: "roi@example.org", phone: "0500000002" },
      { fullName: "תמר", personalTarget: 1500, team: "צפון", email: "tamar@example.org", phone: "0500000003" },
      { fullName: "יעל", personalTarget: 900, team: "ירושלים", email: "yael@example.org", phone: "0500000004" },
    ],
    campaignBuilder: {
      goals: {
        ambassadorGoal: 1200,
      },
    },
  };
}

test("GoodRaise intelligence engine returns explainable health, forecast, priorities, and fingerprint", async () => {
  const createEngine = await loadEngineFactory();
  const engine = createEngine({ groupBy, sumAmount, buildLeaderboard });
  const rows = buildRows();
  const context = buildContext();

  const health = engine.buildHealthModel(rows, context);
  const forecast = engine.buildForecastModel(rows, context);
  const ambassadors = engine.buildAmbassadorModels(rows, context);
  const priorities = engine.buildPriorityList(rows, context);
  const attention = engine.buildAttentionNow(rows, context);
  const fingerprint = engine.buildFingerprint(rows, context);

  assert.ok(health.score >= 0 && health.score <= 100);
  assert.ok(["Excellent", "Healthy", "Needs Attention", "At Risk", "Critical"].includes(health.label));
  assert.ok(Array.isArray(health.reasons) && health.reasons.length > 0);
  assert.ok(Number.isFinite(forecast.projectedFinal));
  assert.ok(["low", "medium", "high"].includes(forecast.confidence));
  assert.equal(ambassadors.length, 4);
  assert.ok(ambassadors.some((item) => item.ambassador === "יעל" && item.status === "Inactive"));
  assert.ok(priorities.length > 0);
  assert.ok(priorities[0].reason);
  assert.ok(attention.length > 0);
  assert.ok(fingerprint.ambassadorCount === 4);
});

test("GoodRaise intelligence engine fails fast when campaign scope is missing", async () => {
  const createEngine = await loadEngineFactory();
  const engine = createEngine({ groupBy, sumAmount, buildLeaderboard });
  const rows = buildRows();
  const context = buildContext();
  delete context.organizationId;

  assert.throws(() => engine.buildHealthModel(rows, context), /organizationId and campaignId context/);
});
