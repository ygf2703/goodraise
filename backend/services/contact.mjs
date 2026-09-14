import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { CONTACT_LIMITS, CONTACT_TOPICS } from "../../shared/contact.mjs";
import { sendTransactionalEmail } from "./email-delivery.mjs";
import { createPlatformStore, isNetlifyRuntime } from "./platform-store.mjs";

const MAX_BODY_BYTES = 20_000;
const RATE_WINDOW_MS = 60 * 60 * 1000;
const EMAIL_PATTERN = /^[^\s@<>\x00-\x1f\x7f]+@[^\s@<>\x00-\x1f\x7f]+\.[^\s@<>\x00-\x1f\x7f]+$/;
const hash = (value) => createHash("sha256").update(value).digest("hex");
const respond = (status, payload, headers = {}) => Response.json(payload, { status, headers: { "cache-control": "no-store", ...headers } });

class ContactInputError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function readContactBody(request) {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    throw new ContactInputError(415, "יש לשלוח את הפנייה דרך הטופס באתר.");
  }
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) throw new ContactInputError(413, "הפנייה ארוכה מדי.");
  const reader = request.body?.getReader();
  if (!reader) throw new ContactInputError(400, "יש למלא את פרטי הפנייה.");
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new ContactInputError(413, "הפנייה ארוכה מדי.");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try {
    const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Invalid object");
    return payload;
  } catch { throw new ContactInputError(400, "פרטי הפנייה אינם תקינים. בדקו את הטופס ונסו שוב."); }
}

function validateContact(payload) {
  const field = (key, minimum, maximum) => {
    const value = typeof payload[key] === "string" ? payload[key].trim() : "";
    if (value.length < minimum || value.length > maximum || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) {
      throw new ContactInputError(400, "יש למלא שם, כתובת אימייל תקינה ותוכן פנייה באורך 10–4,000 תווים.");
    }
    return value;
  };
  if (payload.website) throw new ContactInputError(400, "לא ניתן לשלוח את הפנייה. נסו שוב דרך הטופס באתר.");
  const name = field("name", 2, CONTACT_LIMITS.name);
  const email = field("email", 3, CONTACT_LIMITS.email).toLowerCase();
  const message = field("message", 10, CONTACT_LIMITS.message);
  const topic = CONTACT_TOPICS.find((item) => item.value === payload.topic);
  if (!EMAIL_PATTERN.test(email) || /[\r\n\t]/.test(name) || !topic) throw new ContactInputError(400, "בדקו את השם, כתובת האימייל ונושא הפנייה.");
  if (payload.consentAccepted !== true) throw new ContactInputError(400, "נדרשת הסכמה לשימוש בפרטים לצורך טיפול בפנייה.");
  if (typeof payload.requestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payload.requestId)) {
    throw new ContactInputError(400, "יש לרענן את העמוד ולנסות לשלוח שוב.");
  }
  return { name, email, message, topic, requestId: payload.requestId };
}

// Serialize quota reservations within an instance, not slow email delivery.
// Persisted Blobs quotas are best-effort across simultaneous serverless instances;
// production edge rate limiting remains part of the launch checklist.
let rateReservation = Promise.resolve();
function reserveQuota(request, email) {
  const operation = rateReservation.catch(() => {}).then(async () => {
    const store = createPlatformStore({
      storeName: "goodraise-contact-limits",
      devStorePath: resolve(process.env.GOODRAISE_DATA_DIR || resolve(process.cwd(), "work/data"), "goodraise-contact-limits-dev.json"),
    });
    // The Node transport overwrites x-forwarded-for with the socket peer. Only
    // Netlify may supply its trusted client-IP header.
    const ip = (isNetlifyRuntime() ? request.headers.get("x-nf-client-connection-ip") : request.headers.get("x-forwarded-for")) || "unknown";
    const quotas = [{ key: `ip:${hash(ip.slice(0, 128))}`, limit: 5 }, { key: `email:${hash(email)}`, limit: 3 }];
    const now = Date.now();
    const records = await Promise.all(quotas.map(async (quota) => {
      const saved = await store.getJSON(quota.key);
      return saved?.expiresAt > now ? saved : { count: 0, expiresAt: now + RATE_WINDOW_MS };
    }));
    const exceeded = records.find((record, index) => record.count >= quotas[index].limit);
    if (exceeded) return Math.max(1, Math.ceil((exceeded.expiresAt - now) / 1000));
    await Promise.all(quotas.map((quota, index) => store.setJSON(quota.key, { ...records[index], count: records[index].count + 1 })));
    return 0;
  });
  rateReservation = operation;
  return operation;
}

export async function handleContactRequest(request) {
  if (request.method !== "POST") return respond(405, { message: "שיטת הבקשה אינה נתמכת." }, { allow: "POST" });
  try {
    const origin = request.headers.get("origin");
    const allowedOrigins = new Set([new URL(request.url).origin]);
    if (process.env.GOODRAISE_PUBLIC_URL) allowedOrigins.add(new URL(process.env.GOODRAISE_PUBLIC_URL).origin);
    if (origin && !allowedOrigins.has(origin)) return respond(403, { message: "יש לשלוח את הפנייה מתוך אתר גודרייז." });
    const contact = validateContact(await readContactBody(request));
    const retryAfter = await reserveQuota(request, contact.email);
    if (retryAfter) return respond(429, { message: "נשלחו מספר פניות בפרק זמן קצר. נסו שוב בעוד כשעה." }, { "retry-after": String(retryAfter) });
    const recipients = (process.env.GOODRAISE_CONTACT_EMAILS ?? "ranbo7@gmail.com,noamfrostig@gmail.com").split(",").map((email) => email.trim().toLowerCase()).filter(Boolean);
    if (!recipients.length || recipients.some((email) => email.length > CONTACT_LIMITS.email || !EMAIL_PATTERN.test(email))) throw new Error("Invalid contact recipient configuration");
    // Fixed recipients/from/subject: never an open relay. Plain text keeps user
    // markup inert. A changed message cannot reuse another message's provider key.
    const idempotencyKey = `contact:${hash(JSON.stringify(contact))}`;
    const delivery = await sendTransactionalEmail({
      to: recipients,
      replyTo: contact.email,
      subject: `פנייה חדשה מגודרייז — ${contact.topic.label}`,
      text: `שם: ${contact.name}\nאימייל: ${contact.email}\nנושא: ${contact.topic.label}\nמזהה פנייה: ${contact.requestId}\n\n${contact.message}`,
      idempotencyKey,
    });
    if (!delivery.id) throw new Error("Email provider did not confirm acceptance");
    return respond(200, { sent: true, development: delivery.provider === "development-outbox" });
  } catch (error) {
    if (error instanceof ContactInputError) return respond(error.status, { message: error.message });
    // No submitted content, address, credentials or provider diagnostics in logs.
    console.error("contact_delivery_failed", { name: error instanceof Error ? error.name : "UnknownError" });
    return respond(503, { message: "לא ניתן לאשר שהפנייה נשלחה. הפרטים נשארו בטופס — נסו שוב מאוחר יותר." });
  }
}
