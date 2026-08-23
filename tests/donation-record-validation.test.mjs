import assert from "node:assert/strict";
import test from "node:test";

import { getDonationRecordValidationError, normalizeExternalRecord } from "../netlify/lib/postgres-ingest.mjs";

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
