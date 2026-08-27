import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("dashboard template does not contain mojibake separators", async () => {
  const template = await readFile(new URL("../work/build_yellow_dashboard.py", import.meta.url), "utf8");
  assert.doesNotMatch(template, /Â|Ã/);
});

test("dashboard labels data freshness from the source snapshot rather than the latest donation", async () => {
  const template = await readFile(new URL("../work/build_yellow_dashboard.py", import.meta.url), "utf8");
  assert.match(template, /const datasetFreshnessAt = getDatasetFreshnessIso\(\);/);
  assert.match(template, /payload\.generatedAt \|\| payload\.meta\?\.fetchedAt/);
  assert.match(template, /עדכון נתונים אחרון/);
});

test("public prize navigation resolves the live campaign instead of keeping embedded demo data", async () => {
  const template = await readFile(new URL("../work/build_yellow_dashboard.py", import.meta.url), "utf8");
  const authStore = await readFile(new URL("../netlify/lib/auth-store.mjs", import.meta.url), "utf8");
  assert.match(template, /await fetchPublicContext\(\{ refresh: true \}\)/);
  assert.match(template, /await navigateToPage\(targetPage\)/);
  assert.match(authStore, /campaignConfig: buildPublicCampaignConfig\(context\.config\)/);
  assert.match(template, /state\.auth\.publicDatasetStatus === "unavailable"/);
});

test("prize rankings exclude campaign ambassadors who do not participate in the competition", async () => {
  const template = await readFile(new URL("../work/build_yellow_dashboard.py", import.meta.url), "utf8");
  assert.match(template, /מועדון הכדורגל מכבי תל אביב/);
  assert.match(template, /לזכרו של כליל קמחי/);
  assert.match(template, /function buildPrizeCompetitionLeaderboard\(rows\)/);
  assert.match(template, /const leaderboard = buildPrizeCompetitionLeaderboard\(referenceRows\);/);
  assert.match(template, /!isPrizeCompetitionEligibleAmbassador\(ambassador\)/);
});

test("manager dashboard provides filtered ambassador fundraising reports and CSV export", async () => {
  const template = await readFile(new URL("../work/build_yellow_dashboard.py", import.meta.url), "utf8");
  assert.match(template, /function buildAmbassadorFundraisingReport\(\)/);
  assert.match(template, /filterRows\(state\.rows, \{ includeAmbassador: false \}\)\.forEach/);
  assert.match(template, /buildAmbassadorPersonalUrl\(record\),\s*\n\s*record\.raisedAmount/);
  assert.match(template, /data-project-action="export-ambassador-report"/);
  assert.match(template, /data-project-action="export-zero-fundraising-ambassadors"/);
  assert.match(template, /ambassadors-zero-fundraising\.csv/);
  assert.match(template, /מייל<\/th><th>טלפון/);
});

test("prize dashboard calculates a sprint winner from a precise selected time window", async () => {
  const template = await readFile(new URL("../work/build_yellow_dashboard.py", import.meta.url), "utf8");
  assert.match(template, /id="time-from-filter"/);
  assert.match(template, /id="time-to-filter"/);
  assert.match(template, /function computeSprintStandings\(referenceRows\)/);
  assert.match(template, /תמונת מצב ספרינט/);
  assert.match(template, /חלון ספרינט:/);
});

test("prize rankings use every successful campaign donation and isolate only the sprint window", async () => {
  const template = await readFile(new URL("../work/build_yellow_dashboard.py", import.meta.url), "utf8");
  assert.match(template, /function getPrizeScopeRows\(\)/);
  assert.match(template, /row\.status !== "success"/);
  assert.match(template, /configuredDates\.has\(row\.date\)/);
  assert.match(template, /function getSprintScopeRows\(\)/);
  assert.match(template, /computeSprintStandings\(getSprintScopeRows\(\)\)/);
  assert.match(template, /if \(publicPage\) \{\s*await loadPublicDataset\(\)/);
});

test("campaign prize settings persist and display a sprint prize separately from uploaded prize tables", async () => {
  const template = await readFile(new URL("../work/build_yellow_dashboard.py", import.meta.url), "utf8");
  assert.match(template, /id="sprint-prize-input"/);
  assert.match(template, /sprintPrize: String\(model\.sprintPrize \|\| ""\)\.trim\(\)/);
  assert.match(template, /פרס הספרינט/);
  assert.match(template, /העלאת קובץ פרסים אינה מוחקת אותו/);
});
