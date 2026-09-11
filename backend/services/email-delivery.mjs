import { resolve } from "node:path";

import { createPlatformStore } from "./platform-store.mjs";

const DATA_DIR = process.env.GOODRAISE_DATA_DIR || resolve(process.cwd(), "work", "data");
const OUTBOX_PATH = resolve(DATA_DIR, "goodraise-email-outbox-dev.json");

export class EmailDeliveryError extends Error {
  constructor(message, cause = null) {
    super(message, cause ? { cause } : undefined);
    this.name = "EmailDeliveryError";
  }
}

function getOutbox() {
  return createPlatformStore({
    storeName: "goodraise-email-outbox",
    devStorePath: OUTBOX_PATH,
  });
}

function shouldUseDevelopmentOutbox() {
  const mode = String(process.env.GOODRAISE_EMAIL_MODE || "").trim().toLowerCase();
  if (mode === "outbox") return true;
  if (mode === "resend") return false;
  return process.env.NETLIFY !== "true" && process.env.NODE_ENV !== "production";
}

export function getPublicBaseUrl(requestUrl = "") {
  const configured = String(process.env.GOODRAISE_PUBLIC_URL || "").trim().replace(/\/$/, "");
  if (configured) return configured;
  try {
    return new URL(requestUrl).origin;
  } catch {
    return "http://127.0.0.1:8767";
  }
}

/**
 * Deliver one transactional message. Development writes a deterministic local
 * outbox record; production uses Resend's HTTPS API and idempotency header.
 */
export async function sendTransactionalEmail({ to, subject, text, html = "", idempotencyKey }) {
  const recipients = [...new Set((Array.isArray(to) ? to : [to]).map((value) => String(value || "").trim().toLowerCase()).filter(Boolean))];
  if (!recipients.length) throw new EmailDeliveryError("No email recipients were configured.");
  if (!subject || !text || !idempotencyKey) throw new EmailDeliveryError("Email subject, text and idempotency key are required.");

  if (shouldUseDevelopmentOutbox()) {
    const outbox = getOutbox();
    const key = `email:${idempotencyKey}`;
    const existing = await outbox.getJSON(key);
    if (existing) return { id: existing.id, provider: "development-outbox", duplicate: true };
    const record = {
      id: idempotencyKey,
      to: recipients,
      subject: String(subject),
      text: String(text),
      html: String(html || ""),
      createdAt: new Date().toISOString(),
    };
    await outbox.setJSON(key, record);
    console.info("transactional_email_stored_in_development_outbox", {
      idempotencyKey,
      recipientCount: recipients.length,
      subject: record.subject,
    });
    return { id: record.id, provider: "development-outbox", duplicate: false };
  }

  const apiKey = String(process.env.GOODRAISE_RESEND_API_KEY || "").trim();
  const from = String(process.env.GOODRAISE_EMAIL_FROM || "").trim();
  if (!apiKey || !from) {
    throw new EmailDeliveryError("Production email is not configured. Set GOODRAISE_RESEND_API_KEY and GOODRAISE_EMAIL_FROM.");
  }

  let response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "idempotency-key": String(idempotencyKey).slice(0, 256),
        "user-agent": "GoodRaise/1.0",
      },
      body: JSON.stringify({ from, to: recipients, subject, text, ...(html ? { html } : {}) }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    throw new EmailDeliveryError("The email provider could not be reached.", error);
  }

  const body = await response.text();
  let payload = {};
  try { payload = body ? JSON.parse(body) : {}; } catch { /* Provider diagnostics remain in the generic error below. */ }
  if (!response.ok) {
    throw new EmailDeliveryError(`Email provider rejected the request (HTTP ${response.status}): ${String(payload?.message || "delivery failed").slice(0, 300)}`);
  }
  return { id: String(payload?.id || ""), provider: "resend", duplicate: false };
}
