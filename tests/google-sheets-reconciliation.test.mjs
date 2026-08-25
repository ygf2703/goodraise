import assert from "node:assert/strict";
import test from "node:test";

import { normalizeSourceConfig } from "../netlify/lib/multi-tenant-model.mjs";
import { summarizeGoogleSheetsRecords } from "../netlify/lib/source-sync.mjs";

test("restores the canonical field map when a Google Sheets config contains an empty object", () => {
  const config = normalizeSourceConfig({
    mode: "google_sheets",
    googleSheets: { fieldMapText: "{}" },
  });

  assert.deepEqual(JSON.parse(config.googleSheets.fieldMapText), {
    id: "id",
    created_at: "created_at",
    full_name: "full_name",
    email: "email",
    "Ambassador name": "Ambassador name",
    total: "total",
    city: "city",
    charged_success: "charged_success",
    charge_result: "charge_result",
  });
});

test("summarizes unique valid Google Sheets donation records", () => {
  const summary = summarizeGoogleSheetsRecords([
    { id: "a-1", created_at: "25/08/26 10:00", total: "₪10,000" },
    { id: "a-2", created_at: "25/08/26 10:01", total: "250.50" },
    { id: "a-2", created_at: "25/08/26 10:01", total: "250.50" },
    { id: "bad", created_at: "", total: "100" },
  ]);

  assert.deepEqual(summary, { rowCount: 2, total: 10250.5, invalidRows: 1 });
});
