import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("contact HTTP route is public and independent of campaign database initialization", async () => {
  const directory = await mkdtemp(join(tmpdir(), "goodraise-contact-route-"));
  const keys = ["GOODRAISE_DATABASE_URL", "DATABASE_URL", "GOODRAISE_DATA_DIR", "GOODRAISE_EMAIL_MODE", "GOODRAISE_CONTACT_EMAILS", "GOODRAISE_PUBLIC_URL", "NETLIFY", "NETLIFY_LOCAL", "SITE_ID", "URL", "SITE_NAME"];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  try {
    for (const key of keys) delete process.env[key];
    process.env.GOODRAISE_DATABASE_URL = "postgresql://invalid:invalid@127.0.0.1:1/invalid?connect_timeout=1";
    process.env.GOODRAISE_DATA_DIR = directory;
    process.env.GOODRAISE_EMAIL_MODE = "outbox";
    process.env.GOODRAISE_CONTACT_EMAILS = "admin@example.org";
    const { handleRequest } = await import("../backend/app.ts");
    const response = await handleRequest(new Request("http://localhost/api/contact", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Local Visitor", email: "visitor@example.org", topic: "account", message: "The campaign database is unavailable.", consentAccepted: true, requestId: randomUUID() }),
    }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { sent: true, development: true });
  } finally {
    for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await rm(directory, { recursive: true, force: true });
  }
});
