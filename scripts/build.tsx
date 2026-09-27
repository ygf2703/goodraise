import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { renderToString } from "react-dom/server";
import { build } from "vite";
import { ApplicationRouter } from "../apps/web/src/ApplicationRouter";

await build();
const path = resolve(import.meta.dirname, "../dist/index.html");
let html = await readFile(path, "utf8");
for (const asset of ["site-header.css", "buttons.css"]) {
  const url = `/assets/${asset}`;
  if (!html.includes(`href="${url}"`)) throw new Error(`Missing shared stylesheet ${url}`);
  const revision = createHash("sha256").update(await readFile(resolve(import.meta.dirname, `../dist${url}`))).digest("hex").slice(0, 12);
  html = html.replaceAll(`href="${url}"`, `href="${url}?v=${revision}"`);
}
await writeFile(resolve(import.meta.dirname, "../dist/app.html"), html.replace("<!--app-html-->", renderToString(<ApplicationRouter />)));
const landing = html.replace("<!--app-html-->", renderToString(<ApplicationRouter landingRoute />))
  .replace(' data-app-booting', '')
  .replace(/\s*<meta name="robots"[^>]*>/, '')
  .replace(/<title>.*?<\/title>/, '<title>גודרייז | יחד, עושים יותר טוב</title>')
  .replace(/<meta name="description"[^>]*>/, '<meta name="description" content="גודרייז — מחברים אנשים למטרות טובות. מקום אחד לסיפור שלכם, לקהילה שלכם ולקמפיין הבא שלכם." />');
await writeFile(path, landing);
await writeFile(resolve(import.meta.dirname, "../dist/goodraise/index.html"), landing);
console.log("Built the server-rendered homepage and application with one persistent site shell.");
