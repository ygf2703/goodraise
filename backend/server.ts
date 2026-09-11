import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { serveApi } from "./transport";
import { closeDatabasePool } from "./database";
import { isLandingRequest } from "../shared/routes.mjs";

const output = resolve(import.meta.dirname, "../dist");
const types: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml", ".webp": "image/webp", ".woff2": "font/woff2", ".ico": "image/x-icon" };

export function createApplicationServer() {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", "http://localhost");
      const path = decodeURIComponent(url.pathname);
      if (path.startsWith("/api/")) { await serveApi(request, response); return; }
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.writeHead(405); response.end(); return;
      }
      const pageDocument = isLandingRequest(url) ? "index.html" : "app.html";
      let file = path === "/" || path === "/index.html" ? resolve(output, pageDocument) : resolve(output, `.${path}`);
      if (!file.startsWith(output + sep) && file !== output) { response.writeHead(403); response.end(); return; }
      const entry = await stat(file).catch(() => null);
      if (entry?.isDirectory()) file = resolve(file, "index.html");
      else if (!entry && (/^\/(?:[^/.]+(?:\/[^/.]+)?\/?)?$/.test(path) || /^\/campaigns\/[^/.]+\/[^/.]+\/?$/.test(path))) file = resolve(output, pageDocument);
      const content = await readFile(file).catch(() => null);
      if (!content) { response.writeHead(404); response.end("Not found"); return; }
      response.writeHead(200, {
        "content-type": types[extname(file)] || "application/octet-stream",
        "cache-control": /\/assets\/.*-[\w-]+\.(js|css)$/.test(file) ? "public, max-age=31536000, immutable" : "no-cache",
        "x-content-type-options": "nosniff",
        "x-frame-options": "DENY",
        "referrer-policy": "strict-origin-when-cross-origin",
      });
      response.end(request.method === "HEAD" ? undefined : content);
    } catch (error) {
      console.error("http_request_failed", error);
      if (!response.headersSent) response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ message: "Request failed." }));
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const port = Number(process.env.PORT || 8767);
  const host = process.env.HOST || "127.0.0.1";
  const server = createApplicationServer();
  server.listen(port, host, () => console.log(`GoodRaise: http://${host}:${port}`));
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => server.close(() => {
    void closeDatabasePool().finally(() => process.exit(0));
  }));
}
