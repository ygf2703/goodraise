import { createRoot, hydrateRoot } from "react-dom/client";
import { App } from "./App";
import "./styles/dashboard.css";
import { requestSession } from "./auth-gate";
import { getCampaignApplicationRoute, getPublicArchiveRoute } from "./platform";

const archiveRoute = getPublicArchiveRoute(window.location.pathname);
const applicationRoute = getCampaignApplicationRoute(window.location.pathname);
// Public archive pages never wait for or request a manager session.
const sessionRequest = archiveRoute || applicationRoute ? undefined : requestSession();
const fonts = document.getElementById("site-fonts") as HTMLLinkElement | null;
if (fonts) {
  if (fonts.sheet) fonts.media = "all";
  else fonts.addEventListener("load", () => { fonts.media = "all"; }, { once: true });
}

const root = document.getElementById("app");
if (!root) throw new Error("The application root is missing.");
if (archiveRoute) createRoot(root).render(<App archiveRoute={archiveRoute} />);
else if (applicationRoute) createRoot(root).render(<App applicationRoute={applicationRoute} />);
else hydrateRoot(root, <App sessionRequest={sessionRequest} />);
