import { createHash, randomBytes, randomUUID } from "node:crypto";
import { resolve } from "node:path";

import { getDatabasePool } from "../database.ts";
import {
  getManagedAccounts,
  jsonResponse,
  listActiveSiteAdminEmails,
  requireManagerAccess,
  saveManagedAccount,
} from "./auth-store.mjs";
import { sendTransactionalEmail, getPublicBaseUrl } from "./email-delivery.mjs";
import {
  appendAuditEvent,
  getOrganization,
  listOrganizations,
  saveCampaign,
  saveCampaignConfig,
  saveCampaignDataset,
  saveCampaignSource,
  saveOrganization,
} from "./campaign-repositories.mjs";
import {
  ROLE_ORGANIZATION_ADMIN,
  ROLE_PLATFORM_ADMIN,
  ROLE_VIEWER,
  defaultSourceConfig,
  isoNow,
  normalizeEmail,
  normalizeRole,
} from "./multi-tenant-model.mjs";
import { createPlatformStore } from "./platform-store.mjs";

const DATA_DIR = process.env.GOODRAISE_DATA_DIR || resolve(process.cwd(), "work", "data");
const APPLICATION_DEV_STORE_PATH = resolve(DATA_DIR, "goodraise-applications-dev.json");
const APPLICATION_STORE_NAME = "goodraise-applications";
const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const SUBMISSION_WINDOW_MS = 60 * 60 * 1000;
const MAX_SUBMISSIONS_PER_WINDOW = 4;
const MAX_LINKS = 5;
const ORGANIZATION_TYPES = new Set(["private", "community", "nonprofit", "business", "other"]);
const PROVIDER_STATUSES = new Set(["existing", "needs_setup", "not_sure"]);
const REVIEWABLE_STATUSES = new Set(["submitted", "under_review"]);

let schemaCheckPromise = null;

class ApplicationInputError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "ApplicationInputError";
    this.status = status;
  }
}

function hasDatabase() {
  return Boolean(String(process.env.GOODRAISE_DATABASE_URL || process.env.DATABASE_URL || "").trim());
}

function getApplicationStore() {
  return createPlatformStore({
    storeName: APPLICATION_STORE_NAME,
    devStorePath: APPLICATION_DEV_STORE_PATH,
  });
}

async function ensureApplicationSchema() {
  if (!hasDatabase()) return;
  if (!schemaCheckPromise) {
    schemaCheckPromise = (async () => {
      const pool = getDatabasePool();
      const result = await pool.query(`
        SELECT
          to_regclass('goodraise.campaign_applications')::text AS applications,
          to_regclass('goodraise.campaign_application_events')::text AS events
      `);
      if (!result.rows[0]?.applications || !result.rows[0]?.events) {
        throw new Error("Apply database migration 006_campaign_applications.sql before using campaign applications.");
      }
    })();
  }
  return schemaCheckPromise;
}

function hashToken(token) {
  return createHash("sha256").update(String(token || "")).digest("hex");
}

function normalizeText(value, maxLength) {
  return String(value || "").replace(/\r\n?/g, "\n").trim().slice(0, maxLength);
}

function requireLength(value, label, min, max) {
  const normalized = normalizeText(value, max);
  if (normalized.length < min) throw new ApplicationInputError(`${label}: יש להזין לפחות ${min} תווים.`);
  return normalized;
}

function normalizeUrl(value) {
  const text = normalizeText(value, 500);
  if (!text) return "";
  let parsed;
  try { parsed = new URL(text); } catch { throw new ApplicationInputError("יש להזין קישור מלא ותקין, כולל https://."); }
  if (!["http:", "https:"].includes(parsed.protocol)) throw new ApplicationInputError("ניתן להזין רק קישורי http או https.");
  return parsed.toString();
}

function normalizeApplicationInput(raw = {}) {
  const applicantName = requireLength(raw.applicantName, "שם מלא", 2, 100);
  const applicantEmail = normalizeEmail(raw.applicantEmail).slice(0, 254);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(applicantEmail)) throw new ApplicationInputError("יש להזין כתובת מייל תקינה.");
  const applicantPhone = normalizeText(raw.applicantPhone, 30);
  if (!/^[+\d][\d\s().-]{6,29}$/.test(applicantPhone)) throw new ApplicationInputError("יש להזין מספר טלפון תקין.");

  const organizationType = normalizeText(raw.organizationType, 30).toLowerCase();
  if (!ORGANIZATION_TYPES.has(organizationType)) throw new ApplicationInputError("יש לבחור סוג התארגנות.");
  const externalProviderStatus = normalizeText(raw.externalProviderStatus, 30).toLowerCase() || "not_sure";
  if (!PROVIDER_STATUSES.has(externalProviderStatus)) throw new ApplicationInputError("יש לבחור מצב חיבור לספק התרומות.");

  const targetAmount = Number(raw.targetAmount);
  if (!Number.isFinite(targetAmount) || targetAmount <= 0 || targetAmount > 1_000_000_000) {
    throw new ApplicationInputError("יש להזין יעד גיוס חיובי ועד מיליארד ש״ח.");
  }
  const rawLinks = Array.isArray(raw.publicLinks) ? raw.publicLinks : [raw.publicLink];
  const publicLinks = [...new Set(rawLinks.map(normalizeUrl).filter(Boolean))].slice(0, MAX_LINKS);
  const providerUrl = normalizeUrl(raw.externalProviderUrl);
  if (externalProviderStatus === "existing" && !providerUrl) {
    throw new ApplicationInputError("אם כבר קיים עמוד תרומות, יש לצרף אליו קישור.");
  }
  if (raw.consentAccepted !== true) throw new ApplicationInputError("יש לאשר את תנאי הגשת הבקשה ומדיניות הפרטיות.");

  return {
    applicantName,
    applicantEmail,
    applicantPhone,
    organizationName: requireLength(raw.organizationName, "שם ההתארגנות", 2, 160),
    organizationType,
    organizationRegistrationNumber: normalizeText(raw.organizationRegistrationNumber, 80),
    campaignName: requireLength(raw.campaignName, "שם הקמפיין", 2, 120),
    category: requireLength(raw.category, "קטגוריה", 2, 80),
    purpose: requireLength(raw.purpose, "מטרת הקמפיין", 10, 240),
    story: normalizeText(raw.story, 5_000),
    targetAmount: Math.round(targetAmount * 100) / 100,
    currencyCode: "ILS",
    publicLinks,
    externalProviderStatus,
    externalProviderUrl: providerUrl,
    consentAcceptedAt: isoNow(),
  };
}

function getClientAddress(request) {
  const forwarded = request.headers.get("x-forwarded-for") || request.headers.get("x-nf-client-connection-ip") || "";
  return forwarded.split(",")[0].trim() || "unknown";
}

async function enforceSubmissionRateLimit(request, email) {
  const store = getApplicationStore();
  const identity = hashToken(`${getClientAddress(request)}:${normalizeEmail(email)}`).slice(0, 32);
  const key = `rate:${identity}`;
  const now = Date.now();
  const existing = await store.getJSON(key);
  const record = existing && Number(existing.expiresAt || 0) > now
    ? existing
    : { count: 0, expiresAt: now + SUBMISSION_WINDOW_MS };
  if (Number(record.count || 0) >= MAX_SUBMISSIONS_PER_WINDOW) {
    throw new ApplicationInputError("נשלחו יותר מדי בקשות בזמן קצר. אפשר לנסות שוב בעוד שעה.", 429);
  }
  await store.setJSON(key, { count: Number(record.count || 0) + 1, expiresAt: record.expiresAt });
}

function referenceCode() {
  return `GR-${randomBytes(5).toString("hex").toUpperCase()}`;
}

function verificationMaterial() {
  const token = randomBytes(32).toString("base64url");
  return {
    token,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + VERIFICATION_TTL_MS).toISOString(),
  };
}

function mapApplicationRow(row) {
  if (!row) return null;
  const timestamp = (value) => value instanceof Date ? value.toISOString() : String(value || "");
  return {
    id: String(row.id || ""),
    referenceCode: String(row.reference_code || row.referenceCode || ""),
    status: String(row.status || "pending_email_verification"),
    applicantName: String(row.applicant_name || row.applicantName || ""),
    applicantEmail: normalizeEmail(row.applicant_email || row.applicantEmail),
    applicantPhone: String(row.applicant_phone || row.applicantPhone || ""),
    organizationName: String(row.organization_name || row.organizationName || ""),
    organizationType: String(row.organization_type || row.organizationType || ""),
    organizationRegistrationNumber: String(row.organization_registration_number || row.organizationRegistrationNumber || ""),
    campaignName: String(row.campaign_name || row.campaignName || ""),
    category: String(row.category || ""),
    purpose: String(row.purpose || ""),
    story: String(row.story || ""),
    targetAmount: Number(row.target_amount ?? row.targetAmount ?? 0),
    currencyCode: String(row.currency_code || row.currencyCode || "ILS"),
    publicLinks: Array.isArray(row.public_links || row.publicLinks) ? (row.public_links || row.publicLinks) : [],
    externalProviderStatus: String(row.external_provider_status || row.externalProviderStatus || "not_sure"),
    externalProviderUrl: String(row.external_provider_url || row.externalProviderUrl || ""),
    consentAcceptedAt: timestamp(row.consent_accepted_at || row.consentAcceptedAt),
    emailVerificationTokenHash: String(row.email_verification_token_hash || row.emailVerificationTokenHash || ""),
    emailVerificationExpiresAt: timestamp(row.email_verification_expires_at || row.emailVerificationExpiresAt),
    emailVerifiedAt: timestamp(row.email_verified_at || row.emailVerifiedAt),
    adminNotifiedAt: timestamp(row.admin_notified_at || row.adminNotifiedAt),
    notificationAttemptedAt: timestamp(row.notification_attempted_at || row.notificationAttemptedAt),
    notificationError: String(row.notification_error || row.notificationError || ""),
    reviewNote: String(row.review_note || row.reviewNote || ""),
    approvedOrganizationId: String(row.approved_organization_app_id || row.approvedOrganizationId || row.approved_organization_id || ""),
    approvedCampaignId: String(row.approved_campaign_app_id || row.approvedCampaignId || row.approved_campaign_id || ""),
    reviewedAt: timestamp(row.reviewed_at || row.reviewedAt),
    createdAt: timestamp(row.created_at || row.createdAt),
    updatedAt: timestamp(row.updated_at || row.updatedAt),
  };
}

function adminApplication(application) {
  const { emailVerificationTokenHash: _tokenHash, ...safe } = application;
  return safe;
}

async function appendLocalEvent(applicationId, eventType, actorEmail = "", detail = {}) {
  await getApplicationStore().setJSON(`event:${applicationId}:${Date.now()}:${randomUUID()}`, {
    id: randomUUID(), applicationId, eventType, actorEmail: normalizeEmail(actorEmail), detail, createdAt: isoNow(),
  });
}

async function findLocalApplicationByTokenHash(tokenHash) {
  const items = await getApplicationStore().listJSON("application:");
  return items.map((item) => mapApplicationRow(item.value)).find((item) => item.emailVerificationTokenHash === tokenHash) || null;
}

async function saveLocalApplication(application) {
  const normalized = mapApplicationRow(application);
  await getApplicationStore().setJSON(`application:${normalized.id}`, normalized);
  return normalized;
}

async function createOrRefreshApplication(input, verification) {
  await ensureApplicationSchema();
  if (!hasDatabase()) {
    const items = await getApplicationStore().listJSON("application:");
    const reusable = items.map((item) => mapApplicationRow(item.value)).find((item) =>
      item.status === "pending_email_verification" &&
      item.applicantEmail === input.applicantEmail &&
      item.campaignName === input.campaignName &&
      Date.now() - Date.parse(item.createdAt) < VERIFICATION_TTL_MS);
    const now = isoNow();
    const application = await saveLocalApplication({
      ...(reusable || {}),
      ...input,
      id: reusable?.id || randomUUID(),
      referenceCode: reusable?.referenceCode || referenceCode(),
      status: "pending_email_verification",
      emailVerificationTokenHash: verification.tokenHash,
      emailVerificationExpiresAt: verification.expiresAt,
      emailVerifiedAt: "",
      adminNotifiedAt: "",
      notificationAttemptedAt: "",
      notificationError: "",
      reviewNote: "",
      approvedOrganizationId: "",
      approvedCampaignId: "",
      reviewedAt: "",
      createdAt: reusable?.createdAt || now,
      updatedAt: now,
    });
    await appendLocalEvent(application.id, reusable ? "verification_resent" : "application_created", input.applicantEmail);
    return application;
  }

  const pool = getDatabasePool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const reusable = await client.query(`
      SELECT * FROM goodraise.campaign_applications
      WHERE status = 'pending_email_verification'
        AND applicant_email = $1
        AND campaign_name = $2
        AND created_at > NOW() - INTERVAL '24 hours'
      ORDER BY created_at DESC
      LIMIT 1
      FOR UPDATE
    `, [input.applicantEmail, input.campaignName]);
    let result;
    let eventType;
    if (reusable.rowCount) {
      eventType = "verification_resent";
      result = await client.query(`
        UPDATE goodraise.campaign_applications SET
          applicant_name = $1, applicant_phone = $2, organization_name = $3,
          organization_type = $4, organization_registration_number = $5,
          category = $6, purpose = $7, story = $8, target_amount = $9,
          public_links = $10::jsonb, external_provider_status = $11,
          external_provider_url = $12, consent_accepted_at = $13,
          email_verification_token_hash = $14, email_verification_expires_at = $15,
          notification_error = '', updated_at = NOW()
        WHERE id = $16::uuid
        RETURNING *
      `, [input.applicantName, input.applicantPhone, input.organizationName, input.organizationType,
        input.organizationRegistrationNumber, input.category, input.purpose, input.story, input.targetAmount,
        JSON.stringify(input.publicLinks), input.externalProviderStatus, input.externalProviderUrl,
        input.consentAcceptedAt, verification.tokenHash, verification.expiresAt, reusable.rows[0].id]);
    } else {
      eventType = "application_created";
      result = await client.query(`
        INSERT INTO goodraise.campaign_applications (
          id, reference_code, status, applicant_name, applicant_email, applicant_phone,
          organization_name, organization_type, organization_registration_number,
          campaign_name, category, purpose, story, target_amount, currency_code,
          public_links, external_provider_status, external_provider_url,
          consent_accepted_at, email_verification_token_hash, email_verification_expires_at
        ) VALUES (
          $1::uuid, $2, 'pending_email_verification', $3, $4, $5, $6, $7, $8,
          $9, $10, $11, $12, $13, 'ILS', $14::jsonb, $15, $16, $17, $18, $19
        ) RETURNING *
      `, [randomUUID(), referenceCode(), input.applicantName, input.applicantEmail, input.applicantPhone,
        input.organizationName, input.organizationType, input.organizationRegistrationNumber,
        input.campaignName, input.category, input.purpose, input.story, input.targetAmount,
        JSON.stringify(input.publicLinks), input.externalProviderStatus, input.externalProviderUrl,
        input.consentAcceptedAt, verification.tokenHash, verification.expiresAt]);
    }
    await client.query(`
      INSERT INTO goodraise.campaign_application_events (id, application_id, event_type, actor_email)
      VALUES ($1::uuid, $2::uuid, $3, $4)
    `, [randomUUID(), result.rows[0].id, eventType, input.applicantEmail]);
    await client.query("COMMIT");
    return mapApplicationRow(result.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function verificationEmail(application, verificationUrl) {
  const text = [
    `שלום ${application.applicantName},`,
    "",
    `קיבלנו את הבקשה לפתיחת הקמפיין \"${application.campaignName}\".`,
    "כדי להעביר אותה לבדיקת צוות GoodRaise, יש לאמת את כתובת המייל בקישור:",
    verificationUrl,
    "",
    "הקישור תקף ל-24 שעות.",
    `מספר בקשה: ${application.referenceCode}`,
  ].join("\n");
  return {
    subject: `אימות בקשה לפתיחת קמפיין ${application.referenceCode}`,
    text,
    html: `<div dir="rtl" style="font-family:Arial,sans-serif;line-height:1.7"><h2>אימות בקשה לפתיחת קמפיין</h2><p>שלום ${escapeHtml(application.applicantName)},</p><p>קיבלנו את הבקשה לפתיחת הקמפיין <strong>${escapeHtml(application.campaignName)}</strong>.</p><p><a href="${escapeHtml(verificationUrl)}">אימות כתובת המייל והעברת הבקשה לבדיקה</a></p><p>הקישור תקף ל-24 שעות.</p><p>מספר בקשה: ${escapeHtml(application.referenceCode)}</p></div>`,
  };
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

export async function submitCampaignApplication(request, raw = {}) {
  if (normalizeText(raw.companyWebsite, 200)) {
    return jsonResponse(201, { submitted: true, message: "הבקשה התקבלה. שלחנו אליך מייל לאימות הכתובת." });
  }
  try {
    const input = normalizeApplicationInput(raw);
    await enforceSubmissionRateLimit(request, input.applicantEmail);
    const verification = verificationMaterial();
    const application = await createOrRefreshApplication(input, verification);
    const verificationUrl = `${getPublicBaseUrl(request.url)}/start/verify?token=${encodeURIComponent(verification.token)}`;
    const message = verificationEmail(application, verificationUrl);
    try {
      await sendTransactionalEmail({
        to: application.applicantEmail,
        ...message,
        idempotencyKey: `application-verification-${application.id}-${verification.tokenHash.slice(0, 12)}`,
      });
    } catch (error) {
      console.error("campaign_application_verification_email_failed", {
        applicationId: application.id,
        message: error instanceof Error ? error.message : "Unknown email error",
      });
      return jsonResponse(503, {
        submitted: false,
        referenceCode: application.referenceCode,
        message: "הבקשה נשמרה, אבל לא הצלחנו לשלוח את מייל האימות. אפשר לשלוח שוב את הטופס בעוד כמה דקות.",
      });
    }
    const developmentVerificationUrl = process.env.NETLIFY !== "true" && process.env.NODE_ENV !== "production"
      ? verificationUrl
      : undefined;
    return jsonResponse(201, {
      submitted: true,
      referenceCode: application.referenceCode,
      message: "הבקשה נשמרה. שלחנו אליך מייל לאימות הכתובת.",
      ...(developmentVerificationUrl ? { developmentVerificationUrl } : {}),
    });
  } catch (error) {
    if (error instanceof ApplicationInputError) return jsonResponse(error.status, { submitted: false, message: error.message });
    throw error;
  }
}

async function markNotificationResult(applicationId, errorMessage = "") {
  const now = isoNow();
  if (!hasDatabase()) {
    const application = mapApplicationRow(await getApplicationStore().getJSON(`application:${applicationId}`));
    if (!application) return;
    await saveLocalApplication({
      ...application,
      notificationAttemptedAt: now,
      adminNotifiedAt: errorMessage ? "" : now,
      notificationError: normalizeText(errorMessage, 500),
      updatedAt: now,
    });
    return;
  }
  await getDatabasePool().query(`
    UPDATE goodraise.campaign_applications SET
      notification_attempted_at = NOW(),
      admin_notified_at = CASE WHEN $2 = '' THEN NOW() ELSE admin_notified_at END,
      notification_error = $2,
      updated_at = NOW()
    WHERE id = $1::uuid
  `, [applicationId, normalizeText(errorMessage, 500)]);
}

async function notifySiteAdmins(application, requestUrl) {
  if (application.adminNotifiedAt) return { notified: true, duplicate: true };
  try {
    const recipients = await listActiveSiteAdminEmails();
    if (!recipients.length) throw new Error("No active site admins are configured.");
    const reviewUrl = `${getPublicBaseUrl(requestUrl)}/admin/applications`;
    await sendTransactionalEmail({
      to: recipients,
      subject: `בקשה חדשה לפתיחת קמפיין ${application.referenceCode}`,
      text: [
        "בקשה חדשה ומאומתת ממתינה לבדיקה.",
        `קמפיין: ${application.campaignName}`,
        `התארגנות: ${application.organizationName}`,
        `מגיש/ה: ${application.applicantName} (${application.applicantEmail})`,
        `יעד: ${application.targetAmount} ${application.currencyCode}`,
        reviewUrl,
      ].join("\n"),
      idempotencyKey: `application-admin-notification-${application.id}`,
    });
    await markNotificationResult(application.id);
    return { notified: true, duplicate: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown email error";
    await markNotificationResult(application.id, message);
    console.error("campaign_application_admin_notification_failed", { applicationId: application.id, message });
    return { notified: false, duplicate: false };
  }
}

async function verifyApplicationToken(tokenHash) {
  await ensureApplicationSchema();
  if (!hasDatabase()) {
    const application = await findLocalApplicationByTokenHash(tokenHash);
    if (!application) throw new ApplicationInputError("קישור האימות אינו תקין.", 404);
    if (application.status !== "pending_email_verification") return application;
    if (Date.parse(application.emailVerificationExpiresAt) <= Date.now()) throw new ApplicationInputError("קישור האימות פג. אפשר לשלוח את הטופס מחדש לקבלת קישור חדש.", 410);
    const now = isoNow();
    const verified = await saveLocalApplication({ ...application, status: "submitted", emailVerifiedAt: now, updatedAt: now });
    await appendLocalEvent(application.id, "email_verified", application.applicantEmail);
    return verified;
  }

  const pool = getDatabasePool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query("SELECT * FROM goodraise.campaign_applications WHERE email_verification_token_hash = $1 FOR UPDATE", [tokenHash]);
    if (!found.rowCount) throw new ApplicationInputError("קישור האימות אינו תקין.", 404);
    let row = found.rows[0];
    if (row.status === "pending_email_verification") {
      if (new Date(row.email_verification_expires_at).getTime() <= Date.now()) throw new ApplicationInputError("קישור האימות פג. אפשר לשלוח את הטופס מחדש לקבלת קישור חדש.", 410);
      const updated = await client.query(`
        UPDATE goodraise.campaign_applications
        SET status = 'submitted', email_verified_at = NOW(), updated_at = NOW()
        WHERE id = $1::uuid RETURNING *
      `, [row.id]);
      row = updated.rows[0];
      await client.query(`
        INSERT INTO goodraise.campaign_application_events (id, application_id, event_type, actor_email)
        VALUES ($1::uuid, $2::uuid, 'email_verified', $3)
      `, [randomUUID(), row.id, row.applicant_email]);
    }
    await client.query("COMMIT");
    return mapApplicationRow(row);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function verifyCampaignApplication(request, raw = {}) {
  const token = normalizeText(raw.token, 500);
  if (token.length < 32) return jsonResponse(400, { verified: false, message: "קישור האימות אינו תקין." });
  try {
    const application = await verifyApplicationToken(hashToken(token));
    const notification = await notifySiteAdmins(application, request.url);
    return jsonResponse(200, {
      verified: true,
      referenceCode: application.referenceCode,
      adminNotified: notification.notified,
      message: "כתובת המייל אומתה והבקשה הועברה לבדיקת צוות GoodRaise.",
    });
  } catch (error) {
    if (error instanceof ApplicationInputError) return jsonResponse(error.status, { verified: false, message: error.message });
    throw error;
  }
}

async function requireSiteAdmin(request) {
  const access = await requireManagerAccess(request, ROLE_PLATFORM_ADMIN, "נדרשת התחברות של מנהל/ת האתר.");
  if (access.error) return access;
  if (normalizeRole(access.auth.role, ROLE_VIEWER) !== ROLE_PLATFORM_ADMIN) {
    return { auth: access.auth, error: jsonResponse(403, { message: "רק מנהלי האתר יכולים לבדוק בקשות לפתיחת קמפיין." }) };
  }
  return access;
}

async function listApplications() {
  await ensureApplicationSchema();
  if (!hasDatabase()) {
    const items = await getApplicationStore().listJSON("application:");
    return items
      .map((item) => mapApplicationRow(item.value))
      .filter((application) => application.status !== "pending_email_verification")
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }
  const result = await getDatabasePool().query(`
    SELECT a.*, o.app_id AS approved_organization_app_id, c.app_id AS approved_campaign_app_id
    FROM goodraise.campaign_applications a
    LEFT JOIN goodraise.organizations o ON o.id = a.approved_organization_id
    LEFT JOIN goodraise.campaigns c ON c.id = a.approved_campaign_id
    WHERE a.status <> 'pending_email_verification'
    ORDER BY a.created_at DESC
    LIMIT 250
  `);
  return result.rows.map(mapApplicationRow);
}

export async function getCampaignApplications(request) {
  const access = await requireSiteAdmin(request);
  if (access.error) return access.error;
  const [applications, organizations] = await Promise.all([listApplications(), listOrganizations()]);
  return jsonResponse(200, {
    applications: applications.map(adminApplication),
    organizations: organizations.map((organization) => ({
      id: organization.id,
      slug: organization.slug,
      name: organization.name,
    })),
  });
}

function stableApprovalIds(application) {
  const suffix = application.referenceCode.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return {
    organizationId: `org-${suffix}`,
    organizationSlug: `org-${suffix}`,
    campaignId: `campaign-${suffix}`,
    campaignSlug: `campaign-${suffix}`,
  };
}

function buildApprovedCampaignConfig(application, ids, reviewerEmail, organizationName = application.organizationName) {
  const now = isoNow();
  return {
    organization: {
      id: ids.organizationId,
      slug: ids.organizationSlug,
      name: organizationName,
      status: "active",
    },
    basics: {
      id: ids.campaignId,
      organizationId: ids.organizationId,
      organizationSlug: ids.organizationSlug,
      organizationName,
      slug: ids.campaignSlug,
      campaignName: application.campaignName,
      category: application.category,
      status: "draft",
      target: application.targetAmount,
      currency: application.currencyCode,
    },
    branding: {
      eyebrow: application.category,
      title: application.campaignName,
      subtitle: application.purpose,
      storyMarkdown: application.story || application.purpose,
      primaryCtaLabel: "המשך לתרומה מאובטחת",
      secondaryCtaLabel: "צפייה במובילים ובזוכים",
      mediaType: "image",
      mediaUrl: "",
      mediaAlt: application.campaignName,
      campaignLogoUrl: "",
      organizationLogoUrl: "",
      fontFamily: "Assistant",
      theme: { primary: "#111D4A", secondary: "#24377C", accent: "#FFD629", surface: "#F6F7FA", text: "#090B10" },
    },
    donation: {
      presets: [54, 100, 180, 360, 500, 1000].map((value) => ({ value, label: "תמיכה בקמפיין", description: "כל תרומה עוזרת להתקדם אל היעד." })),
      showRecurring: true,
      externalDonationUrl: application.externalProviderUrl,
      trustNote: "התשלום והסליקה יתבצעו אצל ספק חיצוני מאובטח.",
      successHint: "לאחר לחיצה תועברו לעמוד התשלום של ספק התרומות החיצוני.",
    },
    goals: { campaignGoal: application.targetAmount },
    onboarding: {
      applicationReference: application.referenceCode,
      externalProviderStatus: application.externalProviderStatus,
      publicLinks: application.publicLinks,
    },
    meta: { lastSavedAt: now, lastSavedBy: reviewerEmail },
  };
}

async function getApplicationById(id) {
  if (!hasDatabase()) return mapApplicationRow(await getApplicationStore().getJSON(`application:${id}`));
  const result = await getDatabasePool().query(`
    SELECT a.*, o.app_id AS approved_organization_app_id, c.app_id AS approved_campaign_app_id
    FROM goodraise.campaign_applications a
    LEFT JOIN goodraise.organizations o ON o.id = a.approved_organization_id
    LEFT JOIN goodraise.campaigns c ON c.id = a.approved_campaign_id
    WHERE a.id = $1::uuid
  `, [id]);
  return mapApplicationRow(result.rows[0]);
}

async function approveLocalApplication(request, application, reviewerEmail, reviewNote, selectedOrganizationId = "") {
  if (application.status === "approved") return application;
  if (!REVIEWABLE_STATUSES.has(application.status)) throw new ApplicationInputError("ניתן לאשר רק בקשה שממתינה לבדיקה.", 409);
  const generatedIds = stableApprovalIds(application);
  const now = isoNow();
  const selectedOrganization = selectedOrganizationId ? await getOrganization(selectedOrganizationId) : null;
  if (selectedOrganizationId && !selectedOrganization) throw new ApplicationInputError("הארגון שנבחר אינו קיים.", 400);
  const organization = selectedOrganization || await saveOrganization({
    id: generatedIds.organizationId, slug: generatedIds.organizationSlug, name: application.organizationName,
    status: "active", createdAt: now, updatedAt: now,
  });
  const ids = {
    ...generatedIds,
    organizationId: organization.id,
    organizationSlug: organization.slug,
  };
  const campaign = await saveCampaign({
    id: ids.campaignId, organizationId: organization.id, slug: ids.campaignSlug,
    name: application.campaignName, status: "draft", target: application.targetAmount,
    currency: application.currencyCode, startAt: "", endAt: "", createdAt: now, updatedAt: now, updatedBy: reviewerEmail,
  });
  const config = buildApprovedCampaignConfig(application, ids, reviewerEmail, organization.name);
  await saveCampaignConfig(organization.id, campaign.id, config, reviewerEmail);
  await saveCampaignSource(organization.id, campaign.id, defaultSourceConfig(), reviewerEmail);
  await saveCampaignDataset(organization.id, campaign.id, {
    organizationId: organization.id, campaignId: campaign.id, rows: [], meta: {}, sourceLabel: "", generatedAt: now, updatedAt: now,
  });

  const accountsResponse = await getManagedAccounts(request);
  const accountsPayload = await accountsResponse.json();
  const existing = (accountsPayload.users || []).find((user) => user.email === application.applicantEmail);
  const memberships = existing?.siteAdmin ? [] : [
    ...(existing?.memberships || []),
    { organizationId: organization.id, organizationSlug: organization.slug, campaignId: "", campaignSlug: "", role: ROLE_ORGANIZATION_ADMIN },
  ];
  const accountResponse = await saveManagedAccount(request, {
    email: application.applicantEmail,
    isActive: true,
    siteAdmin: existing?.siteAdmin === true,
    memberships,
  });
  if (!accountResponse.ok) throw new Error(String((await accountResponse.json()).message || "Failed to approve applicant account."));

  const approved = await saveLocalApplication({
    ...application, status: "approved", reviewNote, approvedOrganizationId: organization.id,
    approvedCampaignId: campaign.id, reviewedAt: now, updatedAt: now,
  });
  await appendLocalEvent(application.id, "application_approved", reviewerEmail, { organizationId: organization.id, campaignId: campaign.id });
  return approved;
}

async function approvePostgresApplication(applicationId, reviewerEmail, reviewNote, selectedOrganizationId = "") {
  const pool = getDatabasePool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const locked = await client.query("SELECT * FROM goodraise.campaign_applications WHERE id = $1::uuid FOR UPDATE", [applicationId]);
    if (!locked.rowCount) throw new ApplicationInputError("הבקשה לא נמצאה.", 404);
    const application = mapApplicationRow(locked.rows[0]);
    if (application.status === "approved") {
      const identities = await client.query(`
        SELECT o.app_id AS organization_id, c.app_id AS campaign_id
        FROM goodraise.campaign_applications a
        LEFT JOIN goodraise.organizations o ON o.id = a.approved_organization_id
        LEFT JOIN goodraise.campaigns c ON c.id = a.approved_campaign_id
        WHERE a.id = $1::uuid
      `, [application.id]);
      await client.query("COMMIT");
      return {
        ...application,
        approvedOrganizationId: identities.rows[0]?.organization_id || application.approvedOrganizationId,
        approvedCampaignId: identities.rows[0]?.campaign_id || application.approvedCampaignId,
      };
    }
    if (!REVIEWABLE_STATUSES.has(application.status)) throw new ApplicationInputError("ניתן לאשר רק בקשה שממתינה לבדיקה.", 409);
    const generatedIds = stableApprovalIds(application);
    let organizationUuid = randomUUID();
    let organizationAppId = generatedIds.organizationId;
    let organizationSlug = generatedIds.organizationSlug;
    let organizationName = application.organizationName;
    if (selectedOrganizationId) {
      const selected = await client.query(`
        SELECT id::text, app_id, slug, name
        FROM goodraise.organizations
        WHERE app_id = $1 OR slug = $1 OR id::text = $1
        LIMIT 1
      `, [selectedOrganizationId]);
      if (!selected.rowCount) throw new ApplicationInputError("הארגון שנבחר אינו קיים.", 400);
      organizationUuid = selected.rows[0].id;
      organizationAppId = selected.rows[0].app_id || selected.rows[0].slug;
      organizationSlug = selected.rows[0].slug;
      organizationName = selected.rows[0].name;
    }
    const ids = { ...generatedIds, organizationId: organizationAppId, organizationSlug };
    const campaignUuid = randomUUID();
    const config = buildApprovedCampaignConfig(application, ids, reviewerEmail, organizationName);
    const source = defaultSourceConfig();
    const now = isoNow();

    if (!selectedOrganizationId) {
      await client.query(`
        INSERT INTO goodraise.organizations (id, app_id, slug, name, status, created_at, updated_at)
        VALUES ($1::uuid, $2, $3, $4, 'active', $5, $5)
      `, [organizationUuid, ids.organizationId, ids.organizationSlug, organizationName, now]);
    }
    await client.query(`
      INSERT INTO goodraise.campaigns (
        id, organization_id, app_id, slug, name, status, target_amount, currency_code, updated_by, created_at, updated_at
      ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, 'draft', $6, $7, $8, $9, $9)
    `, [campaignUuid, organizationUuid, ids.campaignId, ids.campaignSlug, application.campaignName,
      application.targetAmount, application.currencyCode, reviewerEmail, now]);
    await client.query(`
      INSERT INTO goodraise.campaign_configs (id, organization_id, campaign_id, payload, revision, updated_at, updated_by)
      VALUES ($1::uuid, $2::uuid, $3::uuid, $4::jsonb, 1, $5, $6)
    `, [randomUUID(), organizationUuid, campaignUuid, JSON.stringify(config), now, reviewerEmail]);
    await client.query(`
      INSERT INTO goodraise.campaign_sources (id, organization_id, campaign_id, payload, has_secret, updated_at, updated_by)
      VALUES ($1::uuid, $2::uuid, $3::uuid, $4::jsonb, FALSE, $5, $6)
    `, [randomUUID(), organizationUuid, campaignUuid, JSON.stringify(source), now, reviewerEmail]);
    await client.query(`
      INSERT INTO goodraise.campaign_datasets (id, organization_id, campaign_id, payload, row_count, generated_at, updated_at)
      VALUES ($1::uuid, $2::uuid, $3::uuid, $4::jsonb, 0, $5, $5)
    `, [randomUUID(), organizationUuid, campaignUuid, JSON.stringify({
      organizationId: ids.organizationId, campaignId: ids.campaignId, rows: [], meta: {}, sourceLabel: "", generatedAt: now, updatedAt: now, recordCount: 0,
    }), now]);

    const user = await client.query(`
      INSERT INTO goodraise.admin_users (
        id, email, role, organization_app_id, organization_slug, campaign_ids,
        campaign_slugs, password_hash, is_active, access_config_hash, created_at, updated_at
      ) VALUES ($1::uuid, $2, 'organization_admin', $3, $4, '[]'::jsonb, '[]'::jsonb, NULL, TRUE, '', $5, $5)
      ON CONFLICT (email) DO UPDATE SET
        role = CASE WHEN goodraise.admin_users.role = 'platform_admin' THEN 'platform_admin' ELSE 'organization_admin' END,
        is_active = TRUE,
        updated_at = EXCLUDED.updated_at
      RETURNING id::text, role
    `, [randomUUID(), application.applicantEmail, ids.organizationId, ids.organizationSlug, now]);
    if (user.rows[0].role !== ROLE_PLATFORM_ADMIN) {
      await client.query(`
        INSERT INTO goodraise.admin_memberships (id, admin_user_id, organization_id, campaign_id, role, created_at, updated_at)
        VALUES ($1::uuid, $2::uuid, $3::uuid, NULL, 'organization_admin', $4, $4)
        ON CONFLICT DO NOTHING
      `, [randomUUID(), user.rows[0].id, organizationUuid, now]);
    }
    const reviewer = await client.query("SELECT id::text FROM goodraise.admin_users WHERE email = $1", [reviewerEmail]);
    const updated = await client.query(`
      UPDATE goodraise.campaign_applications SET
        status = 'approved', review_note = $2, reviewed_by = $3::uuid,
        approved_organization_id = $4::uuid, approved_campaign_id = $5::uuid,
        approved_admin_user_id = $6::uuid, reviewed_at = NOW(), updated_at = NOW()
      WHERE id = $1::uuid RETURNING *
    `, [application.id, reviewNote, reviewer.rows[0]?.id || null, organizationUuid, campaignUuid, user.rows[0].id]);
    await client.query(`
      INSERT INTO goodraise.campaign_application_events (id, application_id, event_type, actor_email, detail)
      VALUES ($1::uuid, $2::uuid, 'application_approved', $3, $4::jsonb)
    `, [randomUUID(), application.id, reviewerEmail, JSON.stringify({ organizationId: ids.organizationId, campaignId: ids.campaignId })]);
    await client.query("COMMIT");
    return {
      ...mapApplicationRow(updated.rows[0]),
      approvedOrganizationId: ids.organizationId,
      approvedCampaignId: ids.campaignId,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function rejectApplication(application, reviewerEmail, reviewNote) {
  if (application.status === "rejected") return application;
  if (!REVIEWABLE_STATUSES.has(application.status)) throw new ApplicationInputError("ניתן לדחות רק בקשה שממתינה לבדיקה.", 409);
  const now = isoNow();
  if (!hasDatabase()) {
    const rejected = await saveLocalApplication({ ...application, status: "rejected", reviewNote, reviewedAt: now, updatedAt: now });
    await appendLocalEvent(application.id, "application_rejected", reviewerEmail, { reviewNote });
    return rejected;
  }
  const client = await getDatabasePool().connect();
  try {
    await client.query("BEGIN");
    const reviewer = await client.query("SELECT id::text FROM goodraise.admin_users WHERE email = $1", [reviewerEmail]);
    const result = await client.query(`
      UPDATE goodraise.campaign_applications SET
        status = 'rejected', review_note = $2, reviewed_by = $3::uuid, reviewed_at = NOW(), updated_at = NOW()
      WHERE id = $1::uuid AND status IN ('submitted', 'under_review')
      RETURNING *
    `, [application.id, reviewNote, reviewer.rows[0]?.id || null]);
    if (!result.rowCount) throw new ApplicationInputError("הבקשה השתנתה בזמן הבדיקה. יש לרענן את הרשימה.", 409);
    await client.query(`
      INSERT INTO goodraise.campaign_application_events (id, application_id, event_type, actor_email, detail)
      VALUES ($1::uuid, $2::uuid, 'application_rejected', $3, $4::jsonb)
    `, [randomUUID(), application.id, reviewerEmail, JSON.stringify({ reviewNote })]);
    await client.query("COMMIT");
    return mapApplicationRow(result.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function sendDecisionEmail(application, action, requestUrl) {
  const loginUrl = `${getPublicBaseUrl(requestUrl)}/login?email=${encodeURIComponent(application.applicantEmail)}`;
  const approved = action === "approve";
  const lines = approved
    ? [
        `הבקשה ${application.referenceCode} אושרה.`,
        `הקמפיין \"${application.campaignName}\" נפתח כטיוטה.`,
        "אפשר להיכנס עם כתובת המייל הזו ולהגדיר סיסמה בכניסה הראשונה:",
        loginUrl,
      ]
    : [
        `הבקשה ${application.referenceCode} לא אושרה בשלב זה.`,
        application.reviewNote ? `הערת הצוות: ${application.reviewNote}` : "אפשר ליצור קשר עם צוות GoodRaise לקבלת פרטים נוספים.",
      ];
  await sendTransactionalEmail({
    to: application.applicantEmail,
    subject: approved ? `בקשת הקמפיין ${application.referenceCode} אושרה` : `עדכון לגבי בקשת הקמפיין ${application.referenceCode}`,
    text: lines.join("\n\n"),
    idempotencyKey: `application-decision-${action}-${application.id}`,
  });
}

export async function decideCampaignApplication(request, applicationId, raw = {}) {
  const access = await requireSiteAdmin(request);
  if (access.error) return access.error;
  const action = normalizeText(raw.action, 30).toLowerCase();
  if (!["approve", "reject"].includes(action)) return jsonResponse(400, { message: "יש לבחור אישור או דחייה." });
  const reviewNote = normalizeText(raw.reviewNote, 2_000);
  const selectedOrganizationId = normalizeText(raw.organizationId, 160);
  if (action === "reject" && reviewNote.length < 3) return jsonResponse(400, { message: "יש להוסיף הסבר קצר לדחיית הבקשה." });
  try {
    let application = await getApplicationById(applicationId);
    if (!application) throw new ApplicationInputError("הבקשה לא נמצאה.", 404);
    application = action === "approve"
      ? hasDatabase()
        ? await approvePostgresApplication(application.id, access.auth.email, reviewNote, selectedOrganizationId)
        : await approveLocalApplication(request, application, access.auth.email, reviewNote, selectedOrganizationId)
      : await rejectApplication(application, access.auth.email, reviewNote);

    let emailDelivered = true;
    try { await sendDecisionEmail(application, action, request.url); }
    catch (error) {
      emailDelivered = false;
      console.error("campaign_application_decision_email_failed", {
        applicationId: application.id, action,
        message: error instanceof Error ? error.message : "Unknown email error",
      });
    }
    await appendAuditEvent({
      user: access.auth.email,
      role: ROLE_PLATFORM_ADMIN,
      organizationId: application.approvedOrganizationId,
      campaignId: application.approvedCampaignId,
      action: action === "approve" ? "campaign_application_approved" : "campaign_application_rejected",
      outcome: "success",
      detail: { applicationId: application.id, referenceCode: application.referenceCode, emailDelivered },
    });
    return jsonResponse(200, {
      application: adminApplication(application),
      emailDelivered,
      message: action === "approve"
        ? "הבקשה אושרה. הארגון, הקמפיין והגישה הראשונית נוצרו."
        : "הבקשה נדחתה וההחלטה נשמרה.",
    });
  } catch (error) {
    if (error instanceof ApplicationInputError) return jsonResponse(error.status, { message: error.message });
    throw error;
  }
}
