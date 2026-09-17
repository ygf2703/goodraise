import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { renderToString } from "react-dom/server";
import { build } from "vite";
import { ApplicationRouter } from "../apps/web/src/ApplicationRouter";

await build();
const path = resolve(import.meta.dirname, "../dist/index.html");
const html = await readFile(path, "utf8");
await writeFile(resolve(import.meta.dirname, "../dist/app.html"), html.replace("<!--app-html-->", renderToString(<ApplicationRouter />)));
const landing = html.replace("<!--app-html-->", renderToString(<ApplicationRouter landingRoute />))
  .replace(' data-app-booting', '')
  .replace(/\s*<meta name="robots"[^>]*>/, '')
  .replace(/<title>.*?<\/title>/, '<title>גודרייז | יחד, עושים יותר טוב</title>')
  .replace(/<meta name="description"[^>]*>/, '<meta name="description" content="גודרייז — מחברים אנשים למטרות טובות. מקום אחד לסיפור שלכם, לקהילה שלכם ולקמפיין הבא שלכם." />');
await writeFile(path, landing);
await writeFile(resolve(import.meta.dirname, "../dist/goodraise/index.html"), landing);
console.log("Built the server-rendered homepage and application with one persistent site shell.");
