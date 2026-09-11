import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  getCampaignPublicSnapshot,
  saveCampaignPublicSnapshot,
} from "../backend/services/campaign-repositories.mjs";

if (String(process.env.GOODRAISE_DATABASE_URL || process.env.DATABASE_URL || "").trim()) {
  throw new Error("Placeholder seeding is restricted to the local JSON development store.");
}

const fixturePath = resolve("work/samples/completed-campaign-placeholders.json");
const snapshots = JSON.parse(await readFile(fixturePath, "utf8"));
const force = process.argv.includes("--force");
const result = { created: 0, skipped: 0 };

for (const snapshot of snapshots) {
  if (snapshot?.campaign?.status !== "completed") {
    throw new Error(`Invalid completed-campaign placeholder in ${fixturePath}.`);
  }
  const organizationId = snapshot.organization.id;
  const campaignId = snapshot.campaign.id;
  const existing = await getCampaignPublicSnapshot(organizationId, campaignId);
  if (existing && !force) {
    result.skipped += 1;
    continue;
  }
  await saveCampaignPublicSnapshot(organizationId, campaignId, snapshot);
  result.created += 1;
}

console.log(JSON.stringify({ ...result, total: snapshots.length, ok: true }, null, 2));
