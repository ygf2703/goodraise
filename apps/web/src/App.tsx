import { memo, useEffect, useState } from "react";
import { DashboardLayout } from "./components/DashboardLayout";
import bootstrap from "./generated/bootstrap.json";

// The adapter owns the empty chart/table containers inside this fixed layout.
// Memoization prevents React from reconciling those containers on status changes.
const CampaignLayout = memo(DashboardLayout);

export function App() {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  useEffect(() => {
    const abort = new AbortController();
    let dispose: (() => void) | undefined;
    void import("./compat/dashboard-controller.js").then(({ mountDashboard }) => {
      if (abort.signal.aborted) return;
      const root = document.getElementById("goodraise-root");
      if (!root) throw new Error("The application layout is missing.");
      dispose = mountDashboard(root, {
        bootstrap,
        signal: abort.signal,
        onReady: () => { if (!abort.signal.aborted) setStatus("ready"); },
        onError: () => { if (!abort.signal.aborted) setStatus("error"); },
      });
    }).catch((error: unknown) => {
      if (!abort.signal.aborted) {
        console.error("application_start_failed", error);
        setStatus("error");
      }
    });
    return () => { abort.abort(); dispose?.(); };
  }, []);

  return <>
    {status !== "ready" && <div className="application-status" role="status" dir="rtl">
      {status === "loading" ? "טוענים את נתוני הקמפיין…" : "טעינת הקמפיין נכשלה. אפשר לרענן את העמוד ולנסות שוב."}
    </div>}
    <CampaignLayout />
  </>;
}
