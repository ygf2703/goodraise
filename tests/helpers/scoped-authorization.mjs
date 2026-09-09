import assert from "node:assert/strict";

// Run the same permission and selection cases against development storage and
// PostgreSQL. Fixtures deliberately reuse a campaign slug across organizations.
export async function verifyScopedAuthorization({ repo, handleRequest, resolveScopedAccess, getAuthStatus }) {
  const previousManagers = process.env.GOODRAISE_MANAGER_EMAILS;
  const managers = [
    { email: "scope-platform@example.org", role: "platform_admin" },
    { email: "scope-org@example.org", role: "organization_admin", organizationId: "scope-org-a" },
    { email: "scope-manager@example.org", role: "campaign_manager", organizationId: "scope-org-a", campaignIds: ["scope-campaign-a"] },
    { email: "scope-slug@example.org", role: "campaign_manager", organizationSlug: "scope-a", campaignSlugs: ["shared-slug"] },
    { email: "scope-analyst@example.org", role: "analyst", organizationSlug: "scope-a", campaignSlugs: ["shared-slug"] },
    { email: "scope-viewer@example.org", role: "viewer", organizationSlug: "scope-a", campaignSlugs: ["shared-slug"] },
    { email: "scope-unassigned@example.org", role: "campaign_manager", organizationSlug: "scope-a" },
  ];
  const cookies = new Map();
  const request = (email, query = "") => new Request(`http://localhost/api/admin/dataset${query}`, {
    headers: email ? { cookie: cookies.get(email) || "" } : {},
  });
  const scoped = (email, options = {}) => resolveScopedAccess(request(email), {
    organizationId: "scope-org-a", campaignId: "scope-campaign-a", action: "dataset_view", ...options,
  });
  try {
    process.env.GOODRAISE_MANAGER_EMAILS = JSON.stringify(managers);
    for (const suffix of ["a", "b"]) {
      await repo.saveOrganization({ id: `scope-org-${suffix}`, slug: `scope-${suffix}`, name: `Scope ${suffix}` });
      await repo.saveCampaign({ id: `scope-campaign-${suffix}`, slug: "shared-slug", organizationId: `scope-org-${suffix}`, name: `Campaign ${suffix}` });
    }
    await repo.saveCampaign({ id: "scope-other-a", slug: "other-a", organizationId: "scope-org-a", name: "Other campaign" });
    for (const manager of managers) {
      const setup = await handleRequest(new Request("http://localhost/api/auth/setup", {
        method: "POST",
        body: JSON.stringify({ email: manager.email, password: "ScopeTest123!", confirmPassword: "ScopeTest123!" }),
      }));
      assert.equal(setup.status, 200, `setup ${manager.email}`);
      cookies.set(manager.email, setup.headers.get("set-cookie"));
    }

    assert.equal((await scoped(null)).error.status, 401);
    for (const email of ["scope-platform@example.org", "scope-org@example.org", "scope-manager@example.org", "scope-slug@example.org", "scope-analyst@example.org"]) {
      const access = await scoped(email);
      assert.equal(access.error, undefined, `dataset access ${email}`);
      assert.equal(access.campaign.id, "scope-campaign-a");
      assert.equal(access.organization.id, "scope-org-a");
      assert.equal(access.accessibleCampaigns, undefined, "permission checks must not build a portfolio");
      const status = await getAuthStatus(request(email));
      assert.ok(status.accessibleCampaigns.some((item) => item.campaignId === "scope-campaign-a"), "status and direct access agree for ID and slug assignments");
    }
    assert.equal((await scoped("scope-platform@example.org", { organizationId: "scope-org-b", campaignId: "scope-campaign-b" })).error, undefined);
    assert.equal((await scoped("scope-org@example.org", { campaignId: "scope-other-a" })).error, undefined);
    assert.equal((await scoped("scope-manager@example.org", { campaignId: "scope-other-a" })).error.status, 403);
    for (const email of ["scope-org@example.org", "scope-manager@example.org", "scope-slug@example.org"]) {
      assert.equal((await scoped(email, { organizationId: "scope-org-b", campaignId: "shared-slug" })).error.status, 403, `cross-tenant slug ${email}`);
    }
    assert.equal((await scoped("scope-analyst@example.org", { action: "campaign_update" })).error.status, 403);
    assert.equal((await scoped("scope-viewer@example.org")).error.status, 403);
    assert.equal((await scoped("scope-viewer@example.org", { action: "campaign_view" })).error, undefined);
    assert.equal((await scoped("scope-unassigned@example.org")).error.status, 403);
    assert.equal((await scoped("scope-platform@example.org", { campaignId: "missing" })).error.status, 404);
    assert.equal((await scoped("scope-platform@example.org", { organizationId: "missing" })).error.status, 404);
    assert.equal((await scoped("scope-manager@example.org", { organizationId: "scope-a", campaignId: "shared-slug" })).campaign.id, "scope-campaign-a");

    for (const query of ["", "?organizationId=scope-org-a", "?campaignId=shared-slug", "?organizationId=scope-a&campaignId=shared-slug"]) {
      const access = await resolveScopedAccess(request("scope-slug@example.org", query), { action: "dataset_view" });
      assert.equal(access.error, undefined, `legacy selection ${query}`);
      assert.equal(access.campaign.id, "scope-campaign-a");
    }
    assert.equal((await resolveScopedAccess(request("scope-slug@example.org", "?organizationId=scope-org-b"))).error.status, 403);
    assert.equal((await resolveScopedAccess(request("scope-slug@example.org", "?campaignId=missing"))).error.status, 404);
    const explicit = await resolveScopedAccess(request("scope-platform@example.org", "?organizationId=scope-org-b&campaignId=scope-campaign-b"), {
      organizationId: "scope-org-a", campaignId: "scope-campaign-a",
    });
    assert.equal(explicit.campaign.id, "scope-campaign-a", "route scope takes precedence over query parameters");

    const manager = managers.find((item) => item.email === "scope-manager@example.org");
    manager.campaignIds = ["scope-other-a"];
    process.env.GOODRAISE_MANAGER_EMAILS = JSON.stringify(managers);
    assert.equal((await scoped(manager.email)).error.status, 403, "changed assignments apply on the next request");
    manager.isActive = false;
    process.env.GOODRAISE_MANAGER_EMAILS = JSON.stringify(managers);
    assert.equal((await scoped(manager.email, { campaignId: "scope-other-a" })).error.status, 401, "disabled managers cannot retain session access");

    const logout = await handleRequest(new Request("http://localhost/api/auth/logout", {
      method: "POST", headers: { cookie: cookies.get("scope-slug@example.org") },
    }));
    assert.equal(logout.status, 200);
    assert.equal((await scoped("scope-slug@example.org")).error.status, 401, "revoked sessions cannot retain access");
  } finally {
    if (previousManagers === undefined) delete process.env.GOODRAISE_MANAGER_EMAILS;
    else process.env.GOODRAISE_MANAGER_EMAILS = previousManagers;
  }
}
