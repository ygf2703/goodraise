import { backfillCompletedCampaignSnapshots } from "../backend/services/public-campaign-archive.mjs";
import { closeDatabasePool } from "../backend/database.ts";

try {
  const rebuildFinancials = process.argv.includes("--rebuild-financials");
  const result = await backfillCompletedCampaignSnapshots({ rebuildFinancials });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
} finally {
  await closeDatabasePool();
}
