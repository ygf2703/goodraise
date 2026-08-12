import test from "node:test";
import assert from "node:assert/strict";

import { validateExternalUrl } from "../netlify/lib/source-security.mjs";

test("source security rejects localhost, private and unsafe schemes", async () => {
  await assert.rejects(() => validateExternalUrl("http://127.0.0.1:8080/feed"), /private|local|פנימי|מורשה/i);
  await assert.rejects(() => validateExternalUrl("https://localhost/feed"), /internal|פנימי|מורשה/i);
  await assert.rejects(() => validateExternalUrl("file:///etc/passwd"), /https|http/i);
  await assert.rejects(() => validateExternalUrl("ftp://example.org/feed"), /https|http/i);
  await assert.rejects(() => validateExternalUrl("https://metadata.google.internal/feed"), /פנימי|מורשה/i);
});

test("source security allows public https endpoints", async () => {
  const parsed = await validateExternalUrl("https://example.org/api/campaign");
  assert.equal(parsed.protocol, "https:");
  assert.equal(parsed.hostname, "example.org");
});
