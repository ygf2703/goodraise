import assert from "node:assert/strict";
import test from "node:test";

import publicContextHandler from "../netlify/functions/public-context.mjs";

test("public context function returns JSON without a manager session", async () => {
  const response = await publicContextHandler(new Request("http://localhost/api/public-context"));
  const payload = await response.json();

  assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
  assert.ok([200, 404].includes(response.status));
  if (response.status === 200) {
    assert.ok(payload.organizationId);
    assert.ok(payload.campaignId);
  }
});
