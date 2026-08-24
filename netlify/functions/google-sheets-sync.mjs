import { runScheduledGoogleSheetsSync } from "../lib/source-sync.mjs";

export default async () => {
  const startedAt = new Date().toISOString();
  console.info("[goodraise][google-sheets-sync] started", { startedAt });
  try {
    const summary = await runScheduledGoogleSheetsSync({
      triggeredBy: "netlify-google-sheets-cron",
    });
    console.info("[goodraise][google-sheets-sync] completed", {
      processedCampaigns: summary.processedCampaigns,
      syncedCampaigns: summary.syncedCampaigns,
      skippedCampaigns: summary.skippedCampaigns,
      errorCount: summary.errors.length,
    });
    return new Response(JSON.stringify(summary, null, 2), {
      status: summary.ok ? 200 : 500,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    // Keep credentials out of logs while making an unexpected scheduler failure actionable.
    console.error("[goodraise][google-sheets-sync] failed", {
      message: error instanceof Error ? error.message : "scheduled_sync_failed",
    });
    return new Response(JSON.stringify({ ok: false, message: "scheduled_sync_failed" }), {
      status: 500,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }
};
