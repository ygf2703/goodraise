import { memo, useEffect, useRef, useState } from "react";
import { DashboardLayout } from "./components/DashboardLayout";
import bootstrap from "./generated/bootstrap.json";
import { mountAuthGate, requestSession } from "./auth-gate";
import { getCampaignViewEndpoint, getInitialPage } from "./platform";
import { requestJson } from "./api";
import { PublicArchivePage } from "./components/PublicArchivePage";
import type { PublicArchiveRoute } from "./platform";
import type { CampaignApplicationRoute } from "./platform";
import { CampaignApplicationPage, CampaignApplicationVerificationPage } from "./components/CampaignApplicationPage";
import { AdminApplicationsPage } from "./components/AdminApplicationsPage";
import { PublicHelpPage } from "./components/HelpPages";
import type { PublicHelpRoute } from "./platform";
import { getSitePage, setSitePage } from "../../../work/assets/site-header.js";
import { useRouteLifecycle } from "./route-lifecycle";
import { LandingPage } from "./components/LandingPage";

// The adapter owns the empty chart/table containers inside this fixed layout.
// Memoization prevents React from reconciling those containers on status changes.
const CampaignLayout = memo(DashboardLayout);

function ManagerApplication({ sessionRequest }: { sessionRequest?: ReturnType<typeof requestSession> } = {}) {
  const container = useRef<HTMLDivElement>(null);
  const route = useRouteLifecycle();
  const [status, setStatus] = useState<"loading" | "ready" | "error">("ready");
  useEffect(() => {
    if (route.paused) return;
    const abort = new AbortController();
    const gate = new AbortController();
    let dispose: (() => void) | undefined;
    const root = container.current?.querySelector<HTMLElement>("#goodraise-root");
    if (!root) throw new Error("The application layout is missing.");
    const disposeGate = mountAuthGate(root, {
      signal: gate.signal,
      sessionRequest: sessionRequest || requestSession(abort.signal),
      onReady: () => { if (!abort.signal.aborted) { setStatus("ready"); route.ready(); } },
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
          onReady: () => { if (!abort.signal.aborted) { root.setAttribute("data-campaign-ready", ""); setStatus("ready"); route.ready(); } },
          onError: () => { if (!abort.signal.aborted) { setStatus("error"); route.ready(); } },
        });
      },
    });
    return () => { root.removeAttribute("data-campaign-ready"); disposeGate(); gate.abort(); abort.abort(); dispose?.(); };
  }, [sessionRequest, route.paused, route.ready]);

  return <div ref={container}>
    {status === "error" && <div className="application-status" role="status" dir="rtl">
      טעינת הקמפיין נכשלה. אפשר לרענן את העמוד ולנסות שוב.
    </div>}
    <CampaignLayout />
  </div>;
}

export interface AppProps {
  sessionRequest?: ReturnType<typeof requestSession>;
  archiveRoute?: PublicArchiveRoute;
  applicationRoute?: CampaignApplicationRoute;
  helpRoute?: PublicHelpRoute;
  landingRoute?: boolean;
}

export function App({ sessionRequest, archiveRoute, applicationRoute, helpRoute, landingRoute }: AppProps = {}) {
  const route = useRouteLifecycle();
  useEffect(() => {
    if (route.paused) return;
    setSitePage(getSitePage(window.location.href));
    if (helpRoute || applicationRoute === "start" || applicationRoute === "verify") route.ready();
  }, [archiveRoute, applicationRoute, helpRoute, landingRoute, route.paused, route.ready]);

  if (landingRoute) return <LandingPage />;
  if (helpRoute) return <PublicHelpPage route={helpRoute} />;
  if (archiveRoute) return <PublicArchivePage route={archiveRoute} />;
  if (applicationRoute === "start") return <CampaignApplicationPage />;
  if (applicationRoute === "verify") return <CampaignApplicationVerificationPage />;
  if (applicationRoute === "admin") return <AdminApplicationsPage />;
  return <ManagerApplication sessionRequest={sessionRequest} />;
}
