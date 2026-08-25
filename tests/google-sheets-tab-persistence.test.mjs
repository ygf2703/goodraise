import assert from "node:assert/strict";
import test from "node:test";

import { buildResolvedGoogleSheetsConfigPatch } from "../netlify/lib/source-sync.mjs";

test("persists the resolved Google Sheets tab and range after automatic discovery", () => {
  const patch = buildResolvedGoogleSheetsConfigPatch(
    { mode: "google_sheets", googleSheets: { sheetName: "", range: "A:ZZ" } },
    { resolvedSheetName: "Redash Data", resolvedRange: "Redash Data!A:ZZ" },
  );

  assert.deepEqual(patch, {
    sheetName: "Redash Data",
    range: "Redash Data!A:ZZ",
  });
});

test("does not alter non-Google source configuration", () => {
  assert.deepEqual(buildResolvedGoogleSheetsConfigPatch({ mode: "file" }, {}), {});
});
