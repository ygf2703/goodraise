import assert from "node:assert/strict";
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
