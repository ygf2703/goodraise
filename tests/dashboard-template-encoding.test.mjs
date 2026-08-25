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
