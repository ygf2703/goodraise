import { runScheduledPrelaunchReset } from "../backend/services/prelaunch-reset.mjs";

const summary = await runScheduledPrelaunchReset({
  triggeredBy: "local-prelaunch-reset-once",
});

console.log(JSON.stringify(summary, null, 2));
