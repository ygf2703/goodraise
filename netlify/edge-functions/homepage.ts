import { isLandingRequest } from "../../shared/routes.mjs";

// Query-aware rewrites preserve campaign links even when tracking parameters
// are present; static Netlify query rules require an exact parameter set.
export default function rewriteHomepage(request: Request): URL | undefined {
  const url = new URL(request.url);
  if (isLandingRequest(url)) return;
  url.pathname = "/app.html";
  return url;
}
