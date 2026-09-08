import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createServer as createViteServer } from "vite";
import { renderToString } from "react-dom/server";
import type { ComponentType } from "react";
import { serveApi } from "../backend/transport";
import { closeDatabasePool } from "../backend/database";

const port = Number(process.env.PORT || 8767);
const host = process.env.HOST || "127.0.0.1";
const server = createServer();
// Native config loading avoids Vite's generated config bundle being picked up by
// Node's module watcher and causing a restart loop on every server start.
const vite = await createViteServer({ configLoader: "native", server: { middlewareMode: true, hmr: { server } }, appType: "custom" });
server.on("request", (request, response) => {
  if (request.url?.startsWith("/api/")) {
    void serveApi(request, response).catch((error: unknown) => {
      console.error(error);
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
    return;
  }
  vite.middlewares(request, response, () => {
    void (async () => {
      const url = request.url || "/";
      if (/^\/goodraise\/?(?:\?.*)?$/.test(url)) {
        response.setHeader("content-type", "text/html; charset=utf-8");
        response.end(await readFile(resolve("apps/web/public/goodraise/index.html"))); return;
      }
      if (/\.[\w]+(?:\?.*)?$/.test(url) && !url.startsWith("/index.html")) { response.writeHead(404); response.end(); return; }
      const template = await readFile(resolve("apps/web/index.html"), "utf8");
      const html = await vite.transformIndexHtml(url, template);
      // Let Vite own frontend module invalidation. Importing App through Node
      // would make every React edit restart the API and race the HMR response.
      const { App } = await vite.ssrLoadModule("/src/App.tsx") as { App: ComponentType };
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(html.replace("<!--app-html-->", renderToString(<App />)));
    })().catch((error: unknown) => { console.error(error); response.writeHead(500); response.end(); });
  });
});
server.listen(port, host, () => console.log(`GoodRaise development: http://${host}:${port}`));
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => {
  void vite.close().finally(() => server.close(() => {
    void closeDatabasePool().finally(() => process.exit(0));
  }));
});
