import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { createApplicationServer } from "../backend/server";

test("stable shared assets revalidate and build assets remain immutable", async () => {
  const server = createApplicationServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const html = await fetch(base);
    assert.equal(html.headers.get("cache-control"), "no-cache");
    const document = await html.text();
    for (const name of ["site-header", "buttons"]) {
      const css = await readFile(new URL(`../dist/assets/${name}.css`, import.meta.url));
      const revision = createHash("sha256").update(css).digest("hex").slice(0, 12);
      const url = `/assets/${name}.css?v=${revision}`;
      assert.ok(document.includes(`href="${url}"`), `${name}.css must have a content-based URL`);
      const response = await fetch(new URL(url, base));
      assert.equal(response.headers.get("cache-control"), "no-cache");
      assert.equal(await response.text(), css.toString());
    }
    for (const name of ["site-header.js", "landing-carousel.js"]) {
      const response = await fetch(`${base}/assets/${name}`);
      assert.equal(response.headers.get("cache-control"), "no-cache");
    }
    const bundle = document.match(/src="(\/assets\/index-[^"]+\.js)"/)?.[1];
    assert.ok(bundle);
    const response = await fetch(new URL(bundle, base));
    assert.equal(response.headers.get("cache-control"), "public, max-age=31536000, immutable");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
