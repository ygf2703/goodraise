import { performance } from "node:perf_hooks";
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

function buildSyntheticData(size) {
  const start = new Date("2026-08-23T08:00:00Z");
  const ambassadors = Array.from({ length: 80 }, (_value, index) => `שגריר ${index + 1}`);
  const rows = [];
  for (let index = 0; index < size; index += 1) {
    const createdAt = new Date(start.getTime() + index * 13 * 60 * 1000);
    const ambassador = ambassadors[index % ambassadors.length];
    rows.push({
      id: `donation-${index + 1}`,
      ambassador,
      donor: `תורם ${index + 1}`,
      amount: 54 + ((index * 37) % 1400),
      status: index % 17 === 0 ? "failed" : "success",
      createdIso: createdAt.toISOString().slice(0, 19),
      date: createdAt.toISOString().slice(0, 10),
      hour: createdAt.getUTCHours(),
    });
  }
  const dates = [...new Set(rows.map((row) => row.date))].sort();
  return {
    rows,
    context: {
      meta: {
        projectDates: dates,
        uniqueDates: dates,
      },
      goals: {
        total: size * 600,
        daily: Math.round((size * 600) / Math.max(1, dates.length)),
        ambassadorGoal: 15000,
      },
      prizeModel: {
        placePrizes: [{ place: 1, label: "מקום 1", prize: "Top" }],
        tierPrizes: [
          { threshold: 5000, prize: "Bronze" },
          { threshold: 10000, prize: "Silver" },
          { threshold: 20000, prize: "Gold" },
        ],
      },
      ambassadorDirectory: ambassadors.map((fullName, index) => ({
        fullName,
        personalTarget: 15000 + index * 20,
        team: `צוות ${index % 8}`,
        email: `ambassador-${index + 1}@example.org`,
        phone: `050000${String(index).padStart(4, "0")}`,
      })),
      campaignBuilder: {
        goals: {
          ambassadorGoal: 15000,
        },
      },
    },
  };
}

async function main() {
  const createEngine = await loadEngineFactory();
  const engine = createEngine({ groupBy, sumAmount, buildLeaderboard });
  const sizes = [1000, 10000, 100000];
  const results = [];

  for (const size of sizes) {
    const { rows, context } = buildSyntheticData(size);
    const startedAt = performance.now();
    const health = engine.buildHealthModel(rows, context);
    const forecast = engine.buildForecastModel(rows, context);
    const ambassadors = engine.buildAmbassadorModels(rows, context);
    const priorities = engine.buildPriorityList(rows, context);
    const attention = engine.buildAttentionNow(rows, context);
    const fingerprint = engine.buildFingerprint(rows, context);
    const durationMs = performance.now() - startedAt;
    results.push({
      donations: size,
      ambassadors: ambassadors.length,
      durationMs: Number(durationMs.toFixed(2)),
      healthScore: health.score,
      forecast: Math.round(forecast.projectedFinal),
      priorityCount: priorities.length,
      attentionCount: attention.length,
      fingerprintVelocity: Math.round(fingerprint.fundraisingVelocity),
    });
  }

  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
