import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("public contact validates input, limits abuse and confirms email handoff", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "goodraise-contact-"));
  const keys = ["GOODRAISE_DATA_DIR", "GOODRAISE_EMAIL_MODE", "GOODRAISE_CONTACT_EMAILS", "GOODRAISE_PUBLIC_URL", "GOODRAISE_RESEND_API_KEY", "GOODRAISE_EMAIL_FROM", "NETLIFY", "NETLIFY_LOCAL", "SITE_ID", "URL", "SITE_NAME"];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  try {
    for (const key of keys) delete process.env[key];
    process.env.GOODRAISE_DATA_DIR = directory;
    process.env.GOODRAISE_EMAIL_MODE = "outbox";
    process.env.GOODRAISE_CONTACT_EMAILS = "owner-one@example.org,owner-two@example.org";
    const { handleContactRequest } = await import("../backend/services/contact.mjs");
    let sequence = 0;
    const input = (changes = {}) => ({ name: "Test Visitor", email: `visitor-${++sequence}@example.org`, topic: "general", message: "Please help me with this campaign.", consentAccepted: true, requestId: randomUUID(), ...changes });
    const request = (body, headers = {}, method = "POST") => new Request("http://localhost/api/contact", {
      method, headers: { "content-type": "application/json", origin: "http://localhost", "x-forwarded-for": `192.0.2.${++sequence}`, ...headers },
      ...(method === "POST" ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
    });
    const outbox = async () => Object.values(JSON.parse(await readFile(join(directory, "goodraise-email-outbox-dev.json"), "utf8")).items);

    await t.test("anonymous delivery has fixed recipients and visitor reply-to; retries deduplicate", async () => {
      const body = input({ email: "Visitor@Example.org", message: "<script>alert('test')</script> Please help.", to: "attacker@example.org", from: "attacker@example.org" });
      const first = await handleContactRequest(request(body));
      assert.equal(first.status, 200);
      assert.equal(first.headers.get("cache-control"), "no-store");
      assert.deepEqual(await first.json(), { sent: true, development: true });
      assert.equal((await handleContactRequest(request(body))).status, 200);
      const messages = await outbox();
      assert.equal(messages.length, 1);
      assert.deepEqual(messages[0].to, ["owner-one@example.org", "owner-two@example.org"]);
      assert.equal(messages[0].replyTo, "visitor@example.org");
      assert.equal(messages[0].subject, "פנייה חדשה מגודרייז — שאלה כללית");
      assert.equal(messages[0].html, "");
      assert.match(messages[0].text, /<script>/);
      assert.equal(messages[0].text.includes("attacker@example.org"), false);
    });

    await t.test("rejects invalid fields and honeypots before sending", async () => {
      for (const invalid of [
        { name: "x" }, { name: "Bad\nName" }, { name: "x".repeat(101) }, { email: "not-email" }, { email: "a@b.com\r\nBcc: victim@b.com" },
        { message: "short" }, { message: "x".repeat(4001) }, { message: "invalid\u0000message" }, { topic: "invented" },
        { website: "bot" }, { consentAccepted: false }, { consentAccepted: "true" }, { requestId: "invalid" },
      ]) assert.equal((await handleContactRequest(request(input(invalid)))).status, 400, JSON.stringify(invalid));
      assert.equal((await outbox()).length, 1);
    });

    await t.test("rejects malformed, oversized, cross-origin and unsupported requests", async () => {
      for (const body of ["{", "[]", "null", "42"]) assert.equal((await handleContactRequest(request(body))).status, 400);
      assert.equal((await handleContactRequest(request(input(), { "content-type": "text/plain" }))).status, 415);
      assert.equal((await handleContactRequest(request(input(), { origin: "https://evil.example" }))).status, 403);
      assert.equal((await handleContactRequest(request(input(), { "content-length": "25000" }))).status, 413);
      assert.equal((await handleContactRequest(request(" ".repeat(20001)))).status, 413, "Size checked even without content-length");
      const unsupported = await handleContactRequest(request(null, {}, "GET"));
      assert.equal(unsupported.status, 405);
      assert.equal(unsupported.headers.get("allow"), "POST");
    });

    await t.test("per-email quota prevents changing IP from bypassing limits", async () => {
      const responses = await Promise.all(Array.from({ length: 4 }, () => handleContactRequest(request(input({ email: "limited@example.org" })))));
      assert.equal(responses.filter((response) => response.status === 200).length, 3);
      const rejected = responses.find((response) => response.status === 429);
      assert.ok(Number(rejected.headers.get("retry-after")) > 0);
    });

    await t.test("per-IP quota resists parallel requests and forged Netlify IP headers locally", async () => {
      const responses = await Promise.all(Array.from({ length: 6 }, (_, index) => handleContactRequest(request(input(), {
        "x-forwarded-for": "198.51.100.1", "x-nf-client-connection-ip": `203.0.113.${index}`,
      }))));
      assert.equal(responses.filter((response) => response.status === 200).length, 5);
      assert.equal(responses.filter((response) => response.status === 429).length, 1);
      const limits = await readFile(join(directory, "goodraise-contact-limits-dev.json"), "utf8");
      assert.doesNotMatch(limits, /limited@example|198\.51\.100|Test Visitor|Please help/);
    });

    await t.test("production uses server sender/recipients and reply_to; no real network", async (context) => {
      process.env.GOODRAISE_EMAIL_MODE = "resend";
      process.env.GOODRAISE_RESEND_API_KEY = "test-only-key";
      process.env.GOODRAISE_EMAIL_FROM = "GoodRaise <support@example.org>";
      const calls = [];
      context.mock.method(globalThis, "fetch", async (url, options) => {
        calls.push({ url, options });
        return Response.json({ id: "test-provider-id" });
      });
      const body = input();
      const response = await handleContactRequest(request(body));
      assert.deepEqual(await response.json(), { sent: true, development: false });
      assert.equal(calls[0].url, "https://api.resend.com/emails");
      const sent = JSON.parse(calls[0].options.body);
      assert.equal(sent.from, "GoodRaise <support@example.org>");
      assert.equal(sent.reply_to, body.email);
      assert.deepEqual(sent.to, ["owner-one@example.org", "owner-two@example.org"]);
      await handleContactRequest(request(body));
      assert.equal(calls[0].options.headers["idempotency-key"], calls[1].options.headers["idempotency-key"]);
      await handleContactRequest(request({ ...body, message: "An updated message with more detail." }));
      assert.notEqual(calls[0].options.headers["idempotency-key"], calls[2].options.headers["idempotency-key"]);
    });

    await t.test("provider failures, malformed acceptance and missing config never report sent", async (context) => {
      const mocked = context.mock.method(globalThis, "fetch");
      for (const providerResponse of [() => Response.json({ message: "private diagnostic" }, { status: 500 }), () => Response.json({}), () => { throw new Error("network failed"); }]) {
        mocked.mock.mockImplementation(providerResponse);
        const response = await handleContactRequest(request(input()));
        assert.equal(response.status, 503);
        const payload = await response.json();
        assert.equal(payload.sent, undefined);
        assert.doesNotMatch(JSON.stringify(payload), /private diagnostic|test-only-key|network failed/);
      }
      delete process.env.GOODRAISE_RESEND_API_KEY;
      assert.equal((await handleContactRequest(request(input()))).status, 503);
      process.env.GOODRAISE_CONTACT_EMAILS = "";
      assert.equal((await handleContactRequest(request(input()))).status, 503);
    });
  } finally {
    for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await rm(directory, { recursive: true, force: true });
  }
});
