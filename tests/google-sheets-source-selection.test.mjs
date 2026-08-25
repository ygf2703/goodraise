import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { selectGoogleSheetCandidate } from "../netlify/lib/source-store.mjs";

test("selects the newest valid Google Sheets transactions tab over a larger historic tab", () => {
  const headers = ["Transaction ID", "Created At", "Total", "Ambassador"];
  const selected = selectGoogleSheetCandidate([
    {
      sheetName: "Archive",
      values: [headers, ["old-1", "23.08.2026 10:00", "100", "Dana"], ["old-2", "23.08.2026 11:00", "150", "Dana"]],
    },
    {
      sheetName: "Live donations",
      values: [headers, ["live-1", "25.08.2026 08:00", "200", "Noam"]],
    },
  ]);

  assert.equal(selected.sheetName, "Live donations");
});

test("discovers Google Sheets tabs with one batch request instead of sequential requests", async () => {
  const source = await readFile(new URL("../netlify/lib/source-store.mjs", import.meta.url), "utf8");
  assert.match(source, /values:batchGet/);
  assert.match(source, /fetchValuesBatch\(sheetRanges\)/);
  assert.doesNotMatch(source, /for \(const sheetName of sheetNames\)\s*\{\s*const candidate = await fetchValues/);
});
