import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, resolve } from "node:path";
import { parse } from "csv-parse/sync";
import { buildDatasetMeta, buildDatasetRow, normalizeExternalRecord, getDonationRecordValidationError } from "../backend/services/postgres-ingest.mjs";
import type { BootstrapData, DonationRow, PrizeModel } from "../shared/contracts/campaign";
import { readSetting } from "../backend/services/legacy-compat.mjs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Header } from "../apps/web/src/components/Header";
import { SiteFooter } from "../apps/web/src/components/SiteFooter";

const root = resolve(import.meta.dirname, "..");
const source = readSetting("SOURCE_CSV");
const sourcePath = source ? resolve(source) : existsSync(resolve(root, "work/source.csv"))
  ? resolve(root, "work/source.csv") : resolve(root, "work/samples/sample-source.csv");

export function parsePrizeTable(table: unknown[][]): PrizeModel {
  const prizes: PrizeModel = { placePrizes: [], tierPrizes: [], tierRuleNote: "", sprintPrize: "", excludedAmbassadors: [] };
  let inTiers = false;
  table.forEach((row, index) => {
    const left = String(row[0] ?? "").trim();
    const right = String(row[1] ?? "").trim();
    if (!left) return;
    if (left === "מדרגות פרס") { inTiers = true; return; }
    if (inTiers) {
      if (/^\d+(\.\d+)?$/.test(left) && right) prizes.tierPrizes.push({ threshold: Math.trunc(Number(left)), prize: right });
      else if (left.includes("לא ניתן לקבל יותר מפרס אחד")) prizes.tierRuleNote = left;
    } else if (right && (index === 0 || left.startsWith("מקום"))) {
      const place = index === 0 ? 1 : Number(left.replace(/\D/g, ""));
      if (place > 0) prizes.placePrizes.push({ place, label: left, prize: right });
    }
  });
  prizes.placePrizes.sort((a, b) => a.place - b.place);
  prizes.tierPrizes.sort((a, b) => a.threshold - b.threshold);
  return prizes;
}

export async function prepareAssets(): Promise<void> {
  const records: Record<string, string>[] = parse(await readFile(sourcePath, "utf8"), { columns: true, bom: true, skip_empty_lines: true });
  const rows: DonationRow[] = [];
  for (const input of records) {
    const record = normalizeExternalRecord(input);
    const error = getDonationRecordValidationError(record);
    if (error) throw new Error(`Invalid source CSV at record ${rows.length + 1}: ${error}`);
    rows.push(buildDatasetRow(record) as DonationRow);
  }
  const meta = buildDatasetMeta(rows);
  await mkdir(resolve(root, "netlify/data"), { recursive: true });
  await writeFile(resolve(root, "netlify/data/admin-dataset.json"), JSON.stringify({ rows, meta, sourceLabel: basename(sourcePath), generatedAt: new Date().toISOString() }));
  // Campaign data, including prizes, is loaded only after server authorization.
  const bootstrap: BootstrapData = { rows: [], meta: buildDatasetMeta([]), sourceLabel: "", prizes: parsePrizeTable([]) };
  await mkdir(resolve(root, "apps/web/src/generated"), { recursive: true });
  await writeFile(resolve(root, "apps/web/src/generated/bootstrap.json"), JSON.stringify(bootstrap));
  await mkdir(resolve(root, "apps/web/public/assets"), { recursive: true });
  await cp(resolve(root, "work/assets"), resolve(root, "apps/web/public/assets"), { recursive: true });
  let landing = await readFile(resolve(root, "work/goodraise-landing.html"), "utf8");
  landing = landing.replace("__SITE_HEADER__", renderToStaticMarkup(createElement(Header)));
  landing = landing.replace("__SITE_FOOTER__", renderToStaticMarkup(createElement(SiteFooter)));
  const images: Record<string, string> = {
    __GOODRAISE_LOGO_DATA_URI__: "goodraise-logo-transparent.png",
    __LANDING_HERO_IMAGE_DATA_URI__: "landing-hero-campaign.png",
    __LANDING_STATUS_IMAGE_DATA_URI__: "landing-campaign-status.png",
    __LANDING_LEADERBOARD_IMAGE_DATA_URI__: "landing-leaderboard.png",
    __LANDING_QUESTION_IMAGE_DATA_URI__: "landing-data-question.png",
    __LANDING_INTELLIGENCE_IMAGE_DATA_URI__: "landing-intelligence.png",
  };
  for (const [placeholder, filename] of Object.entries(images)) landing = landing.replaceAll(placeholder, `/assets/${filename}`);
  await mkdir(resolve(root, "apps/web/public/goodraise"), { recursive: true });
  await writeFile(resolve(root, "apps/web/public/goodraise/index.html"), landing);
  console.log(`Prepared application assets and protected seed (${rows.length} records).`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) await prepareAssets();
