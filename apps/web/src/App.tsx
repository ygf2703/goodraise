import { memo, useEffect, useState } from "react";
import { DashboardLayout } from "./components/DashboardLayout";
import bootstrap from "./generated/bootstrap.json";
import { mountAuthGate, requestSession } from "./auth-gate";
import { getCampaignViewEndpoint, getInitialPage } from "./platform";
import { requestJson } from "./api";
import { PublicArchivePage } from "./components/PublicArchivePage";
import type { PublicArchiveRoute } from "./platform";

// The adapter owns the empty chart/table containers inside this fixed layout.
// Memoization prevents React from reconciling those containers on status changes.
const CampaignLayout = memo(DashboardLayout);

function ManagerApplication({ sessionRequest }: { sessionRequest?: ReturnType<typeof requestSession> } = {}) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("ready");
  useEffect(() => {
    const abort = new AbortController();
    const gate = new AbortController();
    let dispose: (() => void) | undefined;
    const root = document.getElementById("goodraise-root");
    if (!root) throw new Error("The application layout is missing.");
    const disposeGate = mountAuthGate(root, {
      signal: gate.signal,
      sessionRequest: sessionRequest || requestSession(abort.signal),
      onReady: () => { if (!abort.signal.aborted) setStatus("ready"); },
      onAuthenticated: async (session) => {
        setStatus("loading");
        const page = getInitialPage(window.location.pathname, true);
        const [{ mountDashboard }, campaignData] = await Promise.all([
          import("./compat/dashboard-controller.js"),
          page === "project" || page === "prizes"
            ? requestJson(getCampaignViewEndpoint(window.location.href), {}, abort.signal)
            : Promise.resolve(null),
        ]);
        if (abort.signal.aborted) return;
        if (campaignData && !campaignData.response.ok) throw new Error(String(campaignData.payload.message || "הקמפיין אינו זמין או שאין לך הרשאה לצפות בו."));
        gate.abort();
        dispose = mountDashboard(root, {
          bootstrap,
          session,
          initialCampaignData: campaignData?.payload,
          signal: abort.signal,
          onReady: () => { if (!abort.signal.aborted) setStatus("ready"); },
          onError: () => { if (!abort.signal.aborted) setStatus("error"); },
        });
      },
    });
    return () => { disposeGate(); gate.abort(); abort.abort(); dispose?.(); };
  }, [sessionRequest]);

  return <>
    {status !== "ready" && <div className="application-status" role="status" dir="rtl">
      {status === "loading" ? "טוענים את נתוני הקמפיין…" : "טעינת הקמפיין נכשלה. אפשר לרענן את העמוד ולנסות שוב."}
    </div>}
    <CampaignLayout />
  </>;
}

export function App({ sessionRequest, archiveRoute }: {
  sessionRequest?: ReturnType<typeof requestSession>;
  archiveRoute?: PublicArchiveRoute;
} = {}) {
  return archiveRoute
    ? <PublicArchivePage route={archiveRoute} />
    : <ManagerApplication sessionRequest={sessionRequest} />;
}
