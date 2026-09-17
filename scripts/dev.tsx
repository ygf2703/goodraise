import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createServer as createViteServer } from "vite";
import { renderToString } from "react-dom/server";
import type { ComponentType } from "react";
import type { AppProps } from "../apps/web/src/App";
import { serveApi } from "../backend/transport";
import { closeDatabasePool } from "../backend/database";
import { isLandingRequest } from "../shared/routes.mjs";

const port = Number(process.env.PORT || 8767);
const host = process.env.HOST || "127.0.0.1";
const server = createServer();
// Native config loading avoids Vite's generated config bundle being picked up by
// Node's module watcher and causing a restart loop on every server start.
const vite = await createViteServer({ configLoader: "native", server: { middlewareMode: true, hmr: { server } }, appType: "custom" });
async function renderPage(url: string) {
  const template = await readFile(resolve("apps/web/index.html"), "utf8");
  let html = await vite.transformIndexHtml(url, template);
  const { ApplicationRouter } = await vite.ssrLoadModule("/src/ApplicationRouter.tsx") as { ApplicationRouter: ComponentType<AppProps> };
  // Match production: SSR homepage content or the generic application shell.
  // Public forms such as email verification initialize browser-only state on mount.
  const landingRoute = isLandingRequest(new URL(url, "http://localhost"));
  if (landingRoute) html = html.replace(' data-app-booting', '').replace(/\s*<meta name="robots"[^>]*>/, '');
  return html.replace("<!--app-html-->", renderToString(<ApplicationRouter landingRoute={landingRoute} />));
}
server.on("request", (request, response) => {
  if (request.url?.startsWith("/api/")) {
    void serveApi(request, response).catch((error: unknown) => {
      console.error(error);
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
    return;
  }
  if (isLandingRequest(new URL(request.url || "/", "http://localhost"))) {
    void renderPage(request.url || "/").then(html => { response.setHeader("content-type", "text/html; charset=utf-8"); response.end(html); })
      .catch((error: unknown) => { console.error(error); response.writeHead(500); response.end(); });
    return;
  }
  vite.middlewares(request, response, () => {
    void (async () => {
      const url = request.url || "/";
      if (/\.[\w]+(?:\?.*)?$/.test(url) && !["/index.html", "/app.html"].includes(new URL(url, "http://localhost").pathname)) { response.writeHead(404); response.end(); return; }
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(await renderPage(url));
    })().catch((error: unknown) => { console.error(error); response.writeHead(500); response.end(); });
  });
});
server.listen(port, host, () => console.log(`GoodRaise development: http://${host}:${port}`));
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => {
  void vite.close().finally(() => server.close(() => {
    void closeDatabasePool().finally(() => process.exit(0));
  }));
});
