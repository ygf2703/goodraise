import assert from "node:assert/strict";
import test from "node:test";

import { IngestHttpError, buildManualContributionRecord } from "../netlify/lib/postgres-ingest.mjs";

test("builds a clean manual match donation row", () => {
  const record = buildManualContributionRecord({
    enteredBy: "  נעם   פרוסטיג ",
    amount: "1,250.50",
    createdAt: "2026-08-25T10:00:00.000Z",
    id: "test-match-001",
  });

  assert.equal(record.id, "manual-match-test-match-001");
  assert.equal(record.created_at, "2026-08-25T10:00:00.000Z");
  assert.equal(record.full_name, "הכפלה - נעם פרוסטיג");
  assert.equal(record.total, "1250.5");
  assert.equal(record.currencyname, "ILS");
  assert.equal(record.charge_result, "manual_match");
  assert.equal(record.sourceLabel, "manual-match");
});

test("rejects a manual match without a name or positive amount", () => {
  assert.throws(
    () => buildManualContributionRecord({ enteredBy: "", amount: "50" }),
    (error) => error instanceof IngestHttpError && error.status === 400,
  );
  assert.throws(
    () => buildManualContributionRecord({ enteredBy: "מנהל", amount: "0" }),
    (error) => error instanceof IngestHttpError && error.status === 400,
  );
});
