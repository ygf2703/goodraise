import { getCampaignRoute, getPublicHelpRoute, getPublicArchiveRoute, getCampaignApplicationRoute } from "./platform";
import { isLandingRequest } from "../../../shared/routes.mjs";

export function getApplicationRoute(address: string) {
  const url = new URL(address);
  if (isLandingRequest(url)) return { landingRoute: true };
  const helpRoute = getPublicHelpRoute(url.pathname);
  if (helpRoute) return { helpRoute };
  const archiveRoute = getPublicArchiveRoute(url.pathname);
  if (archiveRoute) return { archiveRoute };
  const applicationRoute = getCampaignApplicationRoute(url.pathname);
  return applicationRoute ? { applicationRoute } : {};
}

export function isAppDestination(address: string, origin: string) {
  const url = new URL(address, origin);
  if (url.origin !== origin) return false;
  const path = url.pathname.replace(/\/$/, "");
  if (isLandingRequest(url) || getPublicHelpRoute(path) || getPublicArchiveRoute(path) || getCampaignApplicationRoute(path)) return true;
  if (["/login", "/admin", "/admin/users", "/project", "/prizes", "/rules", "/privacy", "/accessibility"].includes(path)) return true;
  // Preserve campaign/ambassador URLs, but never hijack assets or external links.
  return !url.pathname.includes(".") && Boolean(getCampaignRoute(url.href).projectSlug);
}

export function shouldHandleLink(event: Pick<MouseEvent, "defaultPrevented" | "button" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">, link: HTMLAnchorElement, current: string) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  if (link.hasAttribute("download") || (link.target && link.target !== "_self")) return false;
  const from = new URL(current), to = new URL(link.href, current);
  if (from.pathname === to.pathname && from.search === to.search && to.hash) return false;
  return isAppDestination(to.href, from.origin);
}
