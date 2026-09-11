import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("public application is verified before admin review and approval creates scoped access", async () => {
  const directory = await mkdtemp(join(tmpdir(), "goodraise-applications-"));
  const environmentKeys = [
    "GOODRAISE_DATABASE_URL", "DATABASE_URL", "NETLIFY", "NETLIFY_LOCAL", "SITE_ID", "URL", "SITE_NAME",
    "GOODRAISE_DATA_DIR", "GOODRAISE_MANAGER_EMAILS", "GOODRAISE_EMAIL_MODE", "GOODRAISE_PUBLIC_URL",
  ];
  const previous = new Map(environmentKeys.map((key) => [key, process.env[key]]));
  try {
    for (const key of environmentKeys) delete process.env[key];
    process.env.GOODRAISE_DATA_DIR = directory;
    process.env.GOODRAISE_MANAGER_EMAILS = '[{"email":"site-admin@example.org","role":"platform_admin"}]';
    process.env.GOODRAISE_EMAIL_MODE = "outbox";
    process.env.GOODRAISE_PUBLIC_URL = "http://localhost";
    const { handleRequest } = await import("../backend/app.ts");
    const call = async (path, { method = "GET", body, cookie = "" } = {}) => {
      const response = await handleRequest(new Request(`http://localhost${path}`, {
        method,
        headers: { ...(body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }));
      return { response, payload: await response.json() };
    };

    const applicationInput = {
      applicantName: "Test Applicant",
      applicantEmail: "Applicant@Example.org",
      applicantPhone: "+972 50 123 4567",
      organizationName: "Test Community",
      organizationType: "community",
      organizationRegistrationNumber: "",
      campaignName: "Community Campaign",
      category: "קהילה ועזרה הדדית",
      purpose: "Supporting a local community project",
      story: "A concise campaign story.",
      targetAmount: 75000,
      publicLink: "https://example.org/community",
      externalProviderStatus: "needs_setup",
      externalProviderUrl: "",
      consentAccepted: true,
    };
    const submitted = await call("/api/applications", { method: "POST", body: applicationInput });
    assert.equal(submitted.response.status, 201);
    assert.equal(submitted.payload.submitted, true);
    assert.match(submitted.payload.referenceCode, /^GR-[A-F0-9]{10}$/);
    assert.match(submitted.payload.developmentVerificationUrl, /\/start\/verify\?token=/);

    const setupAdmin = await call("/api/auth/setup", {
      method: "POST",
      body: { email: "site-admin@example.org", password: "AdminPassword123!", confirmPassword: "AdminPassword123!" },
    });
    assert.equal(setupAdmin.response.status, 200);
    const adminCookie = setupAdmin.response.headers.get("set-cookie");

    const beforeVerification = await call("/api/admin/applications", { cookie: adminCookie });
    assert.equal(beforeVerification.response.status, 200);
    assert.equal(beforeVerification.payload.applications.length, 0);

    const token = new URL(submitted.payload.developmentVerificationUrl).searchParams.get("token");
    const verified = await call("/api/applications/verify", { method: "POST", body: { token } });
    assert.equal(verified.response.status, 200);
    assert.equal(verified.payload.verified, true);
    assert.equal(verified.payload.adminNotified, true);

    const queue = await call("/api/admin/applications", { cookie: adminCookie });
    assert.equal(queue.response.status, 200);
    assert.equal(queue.payload.applications.length, 1);
    assert.equal(queue.payload.applications[0].applicantEmail, "applicant@example.org");
    assert.equal("emailVerificationTokenHash" in queue.payload.applications[0], false);

    const approved = await call(`/api/admin/applications/${queue.payload.applications[0].id}/decision`, {
      method: "POST", cookie: adminCookie, body: { action: "approve", reviewNote: "Approved for onboarding" },
    });
    assert.equal(approved.response.status, 200);
    assert.equal(approved.payload.application.status, "approved");
    assert.ok(approved.payload.application.approvedOrganizationId);
    assert.ok(approved.payload.application.approvedCampaignId);

    const setupApplicant = await call("/api/auth/setup", {
      method: "POST",
      body: { email: "applicant@example.org", password: "ApplicantPassword123!", confirmPassword: "ApplicantPassword123!" },
    });
    assert.equal(setupApplicant.response.status, 200);
    assert.equal(setupApplicant.payload.authenticated, true);
    assert.equal(setupApplicant.payload.permissions.organizationManagement, true);
    const applicantSession = await call("/api/auth/status", { cookie: setupApplicant.response.headers.get("set-cookie") });
    assert.equal(applicantSession.payload.accessibleCampaigns.length, 1);
    assert.equal(applicantSession.payload.accessibleCampaigns[0].status, "draft");
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(directory, { recursive: true, force: true });
  }
});
