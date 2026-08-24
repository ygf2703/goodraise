import { runScheduledGoogleSheetsSync } from "../lib/source-sync.mjs";

export default async () => {
  const summary = await runScheduledGoogleSheetsSync({
    triggeredBy: "netlify-google-sheets-cron",
  });
  return new Response(JSON.stringify(summary, null, 2), {
    status: summary.ok ? 200 : 500,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
};

export const config = {
  // GoodRaise keeps live campaign dashboards current without requiring a manager action.
  schedule: "*/2 * * * *",
};
