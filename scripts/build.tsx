import { copyFile, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { renderToString } from "react-dom/server";
import { build } from "vite";
import { ApplicationRouter } from "../apps/web/src/ApplicationRouter";

await build();
const path = resolve(import.meta.dirname, "../dist/index.html");
const html = await readFile(path, "utf8");
await writeFile(resolve(import.meta.dirname, "../dist/app.html"), html.replace("<!--app-html-->", renderToString(<ApplicationRouter />)));
await copyFile(resolve(import.meta.dirname, "../dist/goodraise/index.html"), path);
console.log("Built the landing homepage and rendered the separate React application shell.");
