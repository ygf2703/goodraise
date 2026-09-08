import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { renderToString } from "react-dom/server";
import { build } from "vite";
import { App } from "../apps/web/src/App";

await build();
const path = resolve(import.meta.dirname, "../dist/index.html");
const html = await readFile(path, "utf8");
await writeFile(path, html.replace("<!--app-html-->", renderToString(<App />)));
console.log("Rendered the React application shell for direct page loads.");
