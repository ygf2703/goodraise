import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

test("saves manual matches through the same relational batch ingestion path as Google Sheets", async () => {
  const source = await readFile(new URL("../netlify/lib/postgres-ingest.mjs", import.meta.url), "utf8");
  const manualContribution = source.slice(source.indexOf("export async function ingestManualContribution"));
  assert.match(manualContribution, /ingestCampaignRecords\(/);
  assert.match(manualContribution, /sourceLabel: "manual-match"/);
  assert.match(manualContribution, /records: \[record\]/);
  assert.match(manualContribution, /requestId = ""/);
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
