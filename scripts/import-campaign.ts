import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { parseArgs } from "node:util";
import { parse } from "csv-parse/sync";
import { ingestCampaignRecords } from "../backend/services/postgres-ingest.mjs";
import { closeDatabasePool } from "../backend/database";

const { values } = parseArgs({ options: { file: { type: "string" }, organization: { type: "string" }, campaign: { type: "string" } } });
if (!values.file || !values.organization || !values.campaign) throw new Error("Usage: npm run import:campaign -- --file <csv> --organization <id-or-slug> --campaign <id-or-slug>");
const records: Record<string, string>[] = parse(await readFile(values.file, "utf8"), { columns: true, bom: true, skip_empty_lines: true });
try {
const result = await ingestCampaignRecords({
  organizationIdentifier: values.organization,
  campaignIdentifier: values.campaign,
  records,
  sourceLabel: basename(values.file),
  importedBy: "goodraise-cli",
  fetchedAt: new Date().toISOString(),
  replaceExternalSnapshot: false,
});
console.log(JSON.stringify({
  ok: result.ok,
  processedCount: result.processedCount,
  newRows: result.newRows,
  updatedRows: result.updatedRows,
  unchangedRows: result.unchangedRows,
  skippedInvalidRows: result.skippedInvalidRows,
  rowCount: result.dataset.rowCount,
}, null, 2));
} finally { await closeDatabasePool(); }
