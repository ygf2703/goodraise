import { runScheduledPrelaunchReset } from "../lib/prelaunch-reset.mjs";

export async function handler() {
  try {
    const summary = await runScheduledPrelaunchReset({
      triggeredBy: "netlify-prelaunch-reset-cron",
    });
    return {
      statusCode: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify(summary),
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        ok: false,
        message: error instanceof Error ? error.message : "prelaunch_reset_failed",
      }),
    };
  }
}

export const config = {
  schedule: "*/5 * * * *",
};
