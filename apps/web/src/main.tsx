import { createRoot, hydrateRoot } from "react-dom/client";
import { ApplicationRouter } from "./ApplicationRouter";
import "../../../work/assets/site-layout.css";
import "./styles/dashboard.css";
import "./styles/help.css";
import "../../../work/assets/page-feedback.css";
import "../../../work/assets/landing.css";
import { requestSession } from "./auth-gate";
import { getCampaignApplicationRoute, getPublicArchiveRoute, getPublicHelpRoute } from "./platform";
import { getApplicationRoute } from "./client-navigation";

const archiveRoute = getPublicArchiveRoute(window.location.pathname);
const applicationRoute = getCampaignApplicationRoute(window.location.pathname);
const helpRoute = getPublicHelpRoute(window.location.pathname);
const route = getApplicationRoute(window.location.href);
// Public content never waits for the header's lightweight session check.
const sessionRequest = route.landingRoute || archiveRoute || applicationRoute || helpRoute ? undefined : requestSession();

const root = document.getElementById("app");
if (!root) throw new Error("The application root is missing.");
const app = <ApplicationRouter {...route} sessionRequest={sessionRequest} />;
if (archiveRoute || applicationRoute || helpRoute) createRoot(root).render(app);
else hydrateRoot(root, app);
