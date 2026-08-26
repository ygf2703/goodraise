import assert from "node:assert/strict";
import test from "node:test";

import { buildDatasetMeta, getDonationRecordValidationError, normalizeExternalRecord } from "../netlify/lib/postgres-ingest.mjs";

test("rejects a source row that only contains ambassador data", () => {
  assert.match(
    getDonationRecordValidationError({
      "Ambassador name": "Test Ambassador",
    }),
    /created_at/,
  );
});

test("accepts a complete donation record", () => {
  assert.equal(
    getDonationRecordValidationError({
      id: "demo-donation-001",
      created_at: "23/08/26 09:15",
      total: "180",
      full_name: "Test Donor",
      "Ambassador name": "Test Ambassador",
    }),
    "",
  );
});

test("normalizes formatted Hebrew Google Sheets donation rows", () => {
  const record = normalizeExternalRecord({
    "מספר עסקה": "sheet-001",
    "תאריך ושעה": "19.08.2026 14:34",
    "שם התורם": "תורם בדיקה",
    "שם השגריר": "שגריר בדיקה",
    "סכום תרומה": "₪ 1,250",
    "כתובת מייל": "donor@example.test",
  });

  assert.equal(record.id, "sheet-001");
  assert.equal(record.created_at, "19.08.2026 14:34");
  assert.equal(record.total, "₪ 1,250");
  assert.equal(record.full_name, "תורם בדיקה");
  assert.equal(record["Ambassador name"], "שגריר בדיקה");
  assert.equal(getDonationRecordValidationError(record), "");
});

test("normalizes the active Google Sheets transaction column names", () => {
  const record = normalizeExternalRecord({
    transaction_id: "live-sheet-001",
    transaction_datetime: "23/08/2026 09:10",
    transaction_amount: "730",
    ambassador_name: "שגריר בדיקה",
    ambassador_email: "ambassador@example.test",
  });

  assert.equal(record.id, "live-sheet-001");
  assert.equal(record.created_at, "23/08/2026 09:10");
  assert.equal(record.total, "730");
  assert.equal(record["Ambassador name"], "שגריר בדיקה");
  assert.equal(record.charged_success, "");
  assert.equal(getDonationRecordValidationError(record), "");
});

test("keeps the configured campaign date window when donations currently exist on one day", () => {
  const meta = buildDatasetMeta(
    [{ date: "2026-08-23" }],
    {
      campaign_starts_at: "2026-08-23T09:00:00.000Z",
      campaign_ends_at: "2026-09-01T22:59:00.000Z",
    },
  );

  assert.deepEqual(meta.uniqueDates, ["2026-08-23"]);
  assert.deepEqual(meta.projectDates, [
    "2026-08-23",
    "2026-08-24",
    "2026-08-25",
    "2026-08-26",
    "2026-08-27",
    "2026-08-28",
    "2026-08-29",
    "2026-08-30",
    "2026-08-31",
    "2026-09-01",
  ]);
  assert.equal(meta.defaultFrom, "2026-08-23");
  assert.equal(meta.defaultTo, "2026-09-01");
});

test("keeps a live campaign filter window through its configured end date", () => {
  const meta = buildDatasetMeta(
    [{ date: "2026-08-23" }],
    {
      campaign_starts_at: "2026-08-23T09:00:00.000Z",
      campaign_ends_at: "2026-09-01T22:59:00.000Z",
    },
    { fetchedAt: "2026-08-24T10:11:12.000Z" },
  );

  assert.deepEqual(meta.projectDates, [
    "2026-08-23",
    "2026-08-24",
    "2026-08-25",
    "2026-08-26",
    "2026-08-27",
    "2026-08-28",
    "2026-08-29",
    "2026-08-30",
    "2026-08-31",
    "2026-09-01",
  ]);
  assert.equal(meta.dataThroughAt, "2026-08-24T10:11:12.000Z");
});
