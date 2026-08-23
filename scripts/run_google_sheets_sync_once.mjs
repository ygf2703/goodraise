import { runScheduledGoogleSheetsSync } from "../netlify/lib/source-sync.mjs";

const summary = await runScheduledGoogleSheetsSync({
  triggeredBy: "local-google-sheets-sync-once",
});

console.log(JSON.stringify(summary, null, 2));
process.exit(summary.ok ? 0 : 1);
