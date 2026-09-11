import type { Page } from "../../../shared/contracts/campaign";

export type PublicArchiveRoute =
  | { kind: "index" }
  | { kind: "detail"; organizationId: string; campaignId: string };

// Both transports expose exactly the same relative URLs and session cookie.
export const authConfig = {
  mode: "backend",
  baseUrl: "",
  enabled: true,
  provider: "node",
  statusEndpoint: "/api/auth/status",
  loginEndpoint: "/api/auth/login",
  setupEndpoint: "/api/auth/setup",
  logoutEndpoint: "/api/auth/logout",
  changePasswordEndpoint: "/api/auth/change-password",
  resetEndpoint: "",
  publicContextEndpoint: "/api/public-context",
  campaignViewEndpoint: "/api/campaign-view",
  datasetEndpoint: "/api/admin/dataset",
  campaignConfigEndpoint: "/api/admin/campaign-config",
  sourceConfigEndpoint: "/api/admin/source-config",
  sourceRefreshEndpoint: "/api/admin/source-refresh",
  accountsEndpoint: "/api/admin/accounts",
};

export function getCampaignViewEndpoint(address: string): string {
  const url = new URL(address);
  const query = new URLSearchParams();
  for (const key of ["organizationId", "campaignId", "organization"]) {
    if (url.searchParams.has(key)) query.set(key, url.searchParams.get(key)!);
  }
  const route = getCampaignRoute(address);
  if (!query.has("campaignId") && route.projectSlug) query.set("project", route.projectSlug);
  return `${authConfig.campaignViewEndpoint}${query.size ? `?${query}` : ""}`;
}

export function getInitialPage(pathname: string, authenticated = false): Page {
  const path = pathname.replace(/\/$/, "");
  if (path === "/login" || path === "/admin/users") return "admin";
  if (["/admin", "/rules", "/privacy", "/prizes", "/project"].includes(path)) {
    return path.slice(1) as Page;
  }
  return (!path || path === "/index.html") && authenticated ? "admin" : "project";
}

export function getPublicArchiveRoute(pathname: string): PublicArchiveRoute | null {
  const parts = pathname.replace(/\/$/, "").split("/").filter(Boolean).map(decodeURIComponent);
  if (parts.length === 1 && parts[0] === "campaigns") return { kind: "index" };
  if (parts.length === 3 && parts[0] === "campaigns") {
    return { kind: "detail", organizationId: parts[1], campaignId: parts[2] };
  }
  return null;
}

export function getPublicArchiveEndpoint(route: PublicArchiveRoute, limit = 100): string {
  return route.kind === "index"
    ? `/api/public/campaigns?limit=${Math.min(100, Math.max(1, limit))}`
    : `/api/public/campaigns/${encodeURIComponent(route.organizationId)}/${encodeURIComponent(route.campaignId)}`;
}

export function getCampaignRoute(address: string): { projectSlug: string; ambassadorSlug: string } {
  const url = new URL(address);
  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const reserved = new Set(["admin", "login", "start", "rules", "privacy", "prizes", "project", "campaigns", "goodraise", "index.html", "app.html"]);
  return {
    projectSlug: url.searchParams.get("project") || (reserved.has(parts[0]) ? "" : parts[0] || ""),
    ambassadorSlug: url.searchParams.get("ambassador") || url.searchParams.get("nickname") || parts[1] || "",
  };
}
