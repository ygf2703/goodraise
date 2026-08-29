import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  IngestHttpError,
  buildManualContributionRecord,
  selectCampaignRecordsForUpsert,
} from "../netlify/lib/postgres-ingest.mjs";

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

test("attributes a manual match to the selected report date and time", () => {
  const record = buildManualContributionRecord({
    enteredBy: "נעם פרוסטיג",
    amount: "30000",
    attributedAt: "2026-08-28T20:30:00+03:00",
    id: "manual-attribution-001",
  });

  assert.equal(record.created_at, "2026-08-28T17:30:00.000Z");
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
  assert.throws(
    () => buildManualContributionRecord({ enteredBy: "מנהל", amount: "50", attributedAt: "not-a-date" }),
    (error) => error instanceof IngestHttpError && error.status === 400,
  );
});

test("saves manual matches through the same relational batch ingestion path as Google Sheets", async () => {
  const source = await readFile(new URL("../netlify/lib/postgres-ingest.mjs", import.meta.url), "utf8");
  const manualContribution = source.slice(source.indexOf("export async function ingestManualContribution"));
  assert.match(manualContribution, /ingestCampaignRecords\(/);
  assert.match(manualContribution, /sourceLabel: "manual-match"/);
  assert.match(manualContribution, /records: \[record\]/);
  assert.match(manualContribution, /requestId = ""/);
  assert.match(manualContribution, /attributedAt = ""/);
  assert.match(manualContribution, /id: requestId \|\| randomUUID\(\)/);
});

test("commits a new ledger row and its dataset snapshot atomically", async () => {
  const source = await readFile(new URL("../netlify/lib/postgres-ingest.mjs", import.meta.url), "utf8");
  const ingestion = source.slice(source.indexOf("export async function ingestCampaignRecords"));
  const upsertAt = ingestion.indexOf("await bulkUpsertCampaignRecords");
  const snapshotAt = ingestion.indexOf("await rebuildCampaignDatasetSnapshotWithClient", upsertAt);
  const commitAt = ingestion.indexOf('await client.query("COMMIT")', snapshotAt);

  assert.ok(upsertAt >= 0);
  assert.ok(snapshotAt > upsertAt);
  assert.ok(commitAt > snapshotAt);
});

test("resolves the operational scope using stable app IDs as well as UUIDs and slugs", async () => {
  const source = await readFile(new URL("../netlify/lib/postgres-ingest.mjs", import.meta.url), "utf8");
  const scopeResolver = source.slice(
    source.indexOf("async function resolveScope"),
    source.indexOf("async function backfillExistingCanonicalEventKeys"),
  );

  assert.match(scopeResolver, /LOWER\(o\.app_id\) = LOWER\(\$1\)/);
  assert.match(scopeResolver, /LOWER\(c\.app_id\) = LOWER\(\$2\)/);
});

test("updates an existing Sheets transaction when its amount is corrected", () => {
  const existingRecord = {
    id: "transaction-100",
    created_at: "2026-08-25T09:00:00.000Z",
    full_name: "תורם בדיקה",
    total: "100",
    currencyname: "ILS",
  };
  const correctedRecord = { ...existingRecord, total: "10100" };

  const selection = selectCampaignRecordsForUpsert(
    [correctedRecord],
    [{ raw_payload: existingRecord }],
  );

  assert.equal(selection.recordsToWrite.length, 1);
  assert.equal(selection.newRows, 0);
  assert.equal(selection.updatedRows, 1);
  assert.equal(selection.unchangedRows, 0);
});
