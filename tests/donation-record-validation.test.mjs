import assert from "node:assert/strict";
import test from "node:test";

import { getDonationRecordValidationError } from "../netlify/lib/postgres-ingest.mjs";

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
