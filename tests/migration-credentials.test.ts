import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { isFileLoadingAllowed, resolveConfig } from "vite";

test("the dev server blocks generated admin credential files even through its filesystem route", async () => {
  const config = await resolveConfig({ configLoader: "native" }, "serve");
  assert.equal(isFileLoadingAllowed(config, resolve("package.json")), true);
  assert.equal(isFileLoadingAllowed(config, resolve("work/private/admin-credentials/.env.007-site-admins-test.json")), false);
});
