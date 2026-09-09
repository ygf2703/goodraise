import assert from "node:assert/strict";
import test from "node:test";

import publicContextHandler from "../netlify/functions/public-context.ts";

test("legacy public context function requires a manager session", async () => {
  const response = await publicContextHandler(new Request("http://localhost/api/public-context"));
  const payload = await response.json();

  assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal(response.status, 401);
  assert.ok(payload.message);
  assert.equal(payload.campaignId, undefined);
});
