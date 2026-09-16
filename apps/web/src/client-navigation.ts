import { getCampaignRoute } from "./platform";

export function isAppDestination(address: string, origin: string) {
  const url = new URL(address, origin);
  if (url.origin !== origin) return false;
  const path = url.pathname.replace(/\/$/, "");
  if (["/login", "/admin", "/admin/users", "/admin/applications", "/project", "/prizes"].includes(path)) return true;
  // Preserve campaign/ambassador URLs, but do not hijack assets or public-site routes.
  return !url.pathname.includes(".") && Boolean(getCampaignRoute(url.href).projectSlug);
}

export function shouldHandleLink(event: Pick<MouseEvent, "defaultPrevented" | "button" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">, link: HTMLAnchorElement, current: string) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  if (link.hasAttribute("download") || (link.target && link.target !== "_self")) return false;
  const from = new URL(current), to = new URL(link.href, current);
  if (from.pathname === to.pathname && from.search === to.search && to.hash) return false;
  return isAppDestination(to.href, from.origin);
}
