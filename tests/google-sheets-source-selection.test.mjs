import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { mapSourceRecordsToCanonicalFields, parseGoogleValues, selectGoogleSheetCandidate } from "../netlify/lib/source-store.mjs";
import { summarizeGoogleSheetsRecords } from "../netlify/lib/source-sync.mjs";

test("keeps Redash transaction fields aligned when an empty header is absent from a data row", () => {
  const [row] = parseGoogleValues([
    [
      "זמן עדכון",
      "proidd",
      "ambassador_name",
      "ambassador_email",
      "ambassador_phone",
      "ambassador_target_amount",
      "ambassador_total_funded",
      "ambassador_total_remaining",
      "ambassador_funding_pct",
      "ambassador_total_unique_donors",
      "",
      "transaction_datetime",
      "transaction_id",
      "transaction_amount",
      "is_first_donation_to_ambassador",
    ],
    [
      "2026-08-26 09:20:00",
      "91745",
      "שגריר בדיקה",
      "ambassador@example.test",
      "",
      "800000",
      "1000",
      "799000",
      "0.12",
      "4",
      "26/08/26 09:20",
      "5423858",
      "51.77",
      "TRUE",
      "",
    ],
  ]);

  assert.equal(row.transaction_datetime, "26/08/26 09:20");
  assert.equal(row.transaction_id, "5423858");
  assert.equal(row.transaction_amount, "51.77");
  assert.equal(row.is_first_donation_to_ambassador, "TRUE");

  const [mapped] = mapSourceRecordsToCanonicalFields([row], {
    mode: "google_sheets",
    googleSheets: { fieldMapText: "{}" },
  });
  assert.equal(mapped.charged_success, "TRUE");
  assert.deepEqual(summarizeGoogleSheetsRecords([mapped]), { rowCount: 1, total: 51.77, invalidRows: 0, unchargedRows: 0 });
});

test("applies configured Google Sheets columns before relational import", () => {
  const [record] = mapSourceRecordsToCanonicalFields(
    [{ "Transaction ID": "t-1", "Donation total": "225000", "Payment approved": "TRUE" }],
    {
      mode: "google_sheets",
      googleSheets: {
        fieldMapText: JSON.stringify({
          id: "Transaction ID",
          total: "Donation total",
          charged_success: "Payment approved",
        }),
      },
    },
  );

  assert.equal(record.id, "t-1");
  assert.equal(record.total, "225000");
  assert.equal(record.charged_success, "TRUE");
});

test("detects a boolean payment column when a legacy Google Sheet lacks a field map", () => {
  const rows = mapSourceRecordsToCanonicalFields(
    [
      { "Payment approved": "TRUE", "Direct debit active": "TRUE" },
      { "Payment approved": "FALSE", "Direct debit active": "TRUE" },
    ],
    { mode: "google_sheets", googleSheets: { fieldMapText: "{}" } },
  );

  assert.deepEqual(
    rows.map((row) => row.charged_success),
    ["TRUE", "FALSE"],
  );
});

test("uses a sole opaque boolean column as the legacy payment status", () => {
  const rows = mapSourceRecordsToCanonicalFields(
    [{ "Column N": "TRUE" }, { "Column N": "FALSE" }],
    { mode: "google_sheets", googleSheets: { fieldMapText: "{}" } },
  );

  assert.deepEqual(
    rows.map((row) => row.charged_success),
    ["TRUE", "FALSE"],
  );
});

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
