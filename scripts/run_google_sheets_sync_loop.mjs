import { runScheduledGoogleSheetsSync } from "../netlify/lib/source-sync.mjs";

const intervalMinutes = Math.max(Number.parseInt(String(process.env.GOODRAISE_GOOGLE_SHEETS_SYNC_MINUTES || "2"), 10) || 2, 1);
const intervalMs = intervalMinutes * 60 * 1000;

async function runOnce() {
  const startedAt = new Date().toISOString();
  try {
    const summary = await runScheduledGoogleSheetsSync({
      triggeredBy: "local-google-sheets-sync-loop",
    });
    console.log(JSON.stringify({ startedAt, ...summary }, null, 2));
  } catch (error) {
    console.error(
      JSON.stringify(
        {
          startedAt,
          ok: false,
          message: error instanceof Error ? error.message : "local_google_sheets_sync_failed",
        },
        null,
        2,
      ),
    );
  }
}

await runOnce();
setInterval(runOnce, intervalMs);
