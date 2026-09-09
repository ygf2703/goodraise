import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "parse5";

const output = resolve(import.meta.dirname, "../dist");
const html = await readFile(resolve(output, "app.html"), "utf8");
const document = parse(html);
const ids = new Set<string>();
function walk(node: { attrs?: { name: string; value: string }[]; childNodes?: unknown[] }) {
  const id = node.attrs?.find((attribute) => attribute.name === "id")?.value;
  if (id) { assert.ok(!ids.has(id), `Duplicate element ID: ${id}`); ids.add(id); }
  for (const child of node.childNodes || []) walk(child as Parameters<typeof walk>[0]);
}
walk(document);
for (const id of ["app", "goodraise-root", "page-project", "page-prizes", "page-rules", "page-privacy", "page-admin", "login-form", "csv-upload", "compare-upload", "prize-upload", "export-filtered"]) {
  assert.ok(ids.has(id), `Missing React workflow: ${id}`);
}
assert.doesNotMatch(html, /__INITIAL_|__AUTH_CONFIG__|data:image\/.*?;base64|yellow-dashboard/);
assert.match(html, /type="module"[^>]+src="\/assets\/.+\.js"/);
assert.ok(Buffer.byteLength(html) < 200_000, "The application shell unexpectedly exceeds 200 KB.");
const files = await readdir(output, { recursive: true });
assert.ok(!files.some((name) => /admin-dataset|source\.csv|\.local\.json|\.py$/.test(name)), "Private inputs are present in public output.");
const bootstrap = JSON.parse(await readFile(resolve(import.meta.dirname, "../apps/web/src/generated/bootstrap.json"), "utf8"));
assert.equal(bootstrap.rows.length, 0, "Donor rows must only be loaded through the scoped API.");
assert.equal(bootstrap.prizes.placePrizes.length + bootstrap.prizes.tierPrizes.length, 0, "Prize data must only be loaded after authorization.");
const landing = await readFile(resolve(output, "goodraise/index.html"), "utf8");
assert.doesNotMatch(landing, /__LANDING_|__GOODRAISE_|__SITE_HEADER__|data:image\/.*?;base64/);
const homepage = await readFile(resolve(output, "index.html"), "utf8");
assert.equal(homepage, landing, "The default index document must be the landing page.");
assert.match(homepage, /id="hero-title"/);
assert.doesNotMatch(homepage, /id="goodraise-root"/);
const appHeaders = html.match(/<header\b[\s\S]*?<\/header>/g) || [];
const homeHeaders = homepage.match(/<header\b[\s\S]*?<\/header>/g) || [];
assert.equal(appHeaders.length, 1, "The application must render one shared site header.");
assert.deepEqual(appHeaders, homeHeaders, "The homepage and application must use the same header.");
assert.ok(ids.has("session-status") && ids.has("logout-button"), "Manager account controls must remain available.");
assert.doesNotMatch(appHeaders[0], /topbar-campaign-logo|topbar-logo/);
for (const page of ["project", "prizes", "admin"]) {
  assert.match(appHeaders[0], new RegExp(`<a[^>]*data-site-audience="manager"[^>]*data-page-target="${page}"[^>]*hidden`), `Hide ${page} navigation until manager authorization.`);
}
const footer = html.match(/<footer\b[\s\S]*?<\/footer>/)?.[0] || "";
assert.doesNotMatch(footer, /data-page-target="(?:project|prizes|admin)"/);
assert.match(footer, /data-page-target="rules"/);
assert.match(footer, /href="\/privacy"/);
for (const asset of ["assets/site-header.css", "assets/site-header.js"]) {
  assert.ok(files.includes(asset), `Missing shared header asset: ${asset}`);
}
console.log(`Release verified: React shell ${Buffer.byteLength(html).toLocaleString()} bytes; protected data excluded.`);
