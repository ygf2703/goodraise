// Keep older query-based campaign and ambassador links in the application.
/** @param {URL} url */
export function isLandingRequest(url) {
  const path = url.pathname.replace(/\/$/, "");
  return ["/goodraise", "/goodraise/index.html"].includes(path) || (["", "/index.html"].includes(path) &&
    !["project", "ambassador", "nickname"].some((key) => url.searchParams.has(key)));
}
