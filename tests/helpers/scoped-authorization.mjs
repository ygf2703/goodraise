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
    {
      email: "scope-multi@example.org",
      role: "analyst",
      memberships: [
        { organizationId: "scope-org-a", campaignId: "scope-campaign-a", role: "analyst" },
        { organizationId: "scope-org-b", campaignId: "scope-campaign-b", role: "viewer" },
      ],
    },
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
    await repo.saveCampaignDataset("scope-org-a", "scope-campaign-a", {
      rows: [{ id: "scope-row", date: "2026-09-01", createdIso: "2026-09-01T10:00", hour: 10, donor: "Private donor", email: "private@example.org", city: "Private city", ambassador: "Test ambassador", amount: 120, status: "success" }],
      meta: { uniqueDates: ["2026-09-01"], projectDates: ["2026-09-01"], defaultFrom: "2026-09-01", defaultTo: "2026-09-01" },
    });
    await repo.saveCampaignConfig("scope-org-a", "scope-campaign-a", {
      basics: { slug: "shared-slug", timeZone: "Asia/Jerusalem" },
      branding: { campaignLogoUrl: "/campaign-logo.png" },
      ambassadors: { records: [{ fullName: "Test ambassador", nickname: "test", personalTarget: 1000, team: "A", email: "ambassador@example.org", phone: "private" }] },
      dataSource: { secret: "private" },
    });
    for (const manager of managers) {
      const setup = await handleRequest(new Request("http://localhost/api/auth/setup", {
        method: "POST",
        body: JSON.stringify({ email: manager.email, password: "ScopeTest123!", confirmPassword: "ScopeTest123!" }),
      }));
      assert.equal(setup.status, 200, `setup ${manager.email}`);
      const identity = await setup.json();
      assert.equal(identity.role, manager.role, "login/setup supplies the checked identity without another status request");
      assert.equal(identity.permissions.campaignPages, manager.email !== "scope-unassigned@example.org");
      assert.equal(identity.accessibleCampaigns, undefined, "login does not enumerate the portfolio");
      cookies.set(manager.email, setup.headers.get("set-cookie"));
    }

    assert.equal((await scoped(null)).error.status, 401);
    const pageRequest = (email, path) => handleRequest(new Request(`http://localhost${path}`, {
      headers: email ? { cookie: cookies.get(email) || "" } : {},
    }));
    const pageDataset = "/api/organizations/scope-org-a/campaigns/scope-campaign-a/public-dataset";
    const campaignView = "/api/campaign-view?organizationId=scope-org-a&campaignId=scope-campaign-a";
    for (const path of ["/api/public-context", pageDataset, campaignView]) {
      assert.equal((await pageRequest(null, path)).status, 401, `anonymous page data ${path}`);
      for (const email of ["scope-platform@example.org", "scope-org@example.org", "scope-manager@example.org", "scope-slug@example.org", "scope-analyst@example.org", "scope-viewer@example.org", "scope-multi@example.org"]) {
        assert.equal((await pageRequest(email, path)).status, 200, `authorized page data ${email} ${path}`);
        assert.equal((await getAuthStatus(request(email))).permissions.campaignPages, true);
      }
    }
    assert.equal((await getAuthStatus(request(null))).permissions.campaignPages, false);
    const lightweightStatus = await (await pageRequest("scope-manager@example.org", "/api/auth/status?includeCampaigns=false")).json();
    assert.equal(lightweightStatus.permissions.campaignPages, true);
    assert.equal(lightweightStatus.accessibleCampaigns, undefined);
    const compactView = await (await pageRequest("scope-manager@example.org", campaignView)).json();
    assert.equal(compactView.rows[0].amount, 120);
    for (const key of ["email", "donor", "city"]) assert.equal(compactView.rows[0][key], undefined, `campaign view excludes ${key}`);
    assert.ok(compactView.campaignConfig);
    assert.deepEqual(compactView.campaignConfig.ambassadors.records, [{ fullName: "Test ambassador", nickname: "test", personalTarget: 1000, team: "A" }]);
    assert.equal(compactView.campaignConfig.branding.campaignLogoUrl, "/campaign-logo.png");
    assert.equal(compactView.campaignConfig.dataSource, undefined);
    assert.equal(compactView.source, undefined);
    const viewerCampaignView = await (await pageRequest("scope-viewer@example.org", campaignView)).json();
    assert.deepEqual(viewerCampaignView.rows, [], "viewer responses do not expose donation-level rows");
    assert.equal(viewerCampaignView.summary.raised, 120);
    assert.equal(viewerCampaignView.summary.supporterCount, 1);
    assert.deepEqual(viewerCampaignView.summary.ambassadorTotals, [{ ambassador: "Test ambassador", amount: 120, donationCount: 1 }]);
    assert.equal(viewerCampaignView.sourceLabel, "נתוני קמפיין מצטברים");
    const analystDataset = await pageRequest("scope-analyst@example.org", "/api/organizations/scope-org-a/campaigns/scope-campaign-a/dataset");
    assert.equal(analystDataset.status, 200);
    const analystPayload = await analystDataset.json();
    assert.equal(analystPayload.rows[0].donor, "מוסתר לפי הרשאה");
    assert.equal(analystPayload.rows[0].email, "");
    assert.equal(analystPayload.rows[0].city, "");
    assert.equal((await pageRequest("scope-viewer@example.org", "/api/organizations/scope-org-a/campaigns/scope-campaign-a/dataset")).status, 403);
    for (const email of ["scope-platform@example.org", "scope-org@example.org"]) {
      const legacySelection = await (await pageRequest(email, "/api/public-context")).json();
      const selection = await (await pageRequest(email, "/api/campaign-view")).json();
      assert.equal(selection.campaignId, legacySelection.campaignId, "unscoped navigation preserves campaign selection");
      assert.equal(selection.organizationId, legacySelection.organizationId);
    }
    assert.equal((await pageRequest("scope-platform@example.org", "/api/campaign-view?project=shared-slug")).status, 409, "ambiguous slugs require an organization");
    assert.equal((await pageRequest("scope-manager@example.org", "/api/campaign-view?organizationId=scope-org-b&campaignId=scope-campaign-b")).status, 403);
    assert.equal((await pageRequest("scope-manager@example.org", "/api/organizations/scope-org-b/campaigns/scope-campaign-b/public-dataset")).status, 403);
    assert.equal((await pageRequest("scope-unassigned@example.org", pageDataset)).status, 403);
    const managerContext = await (await pageRequest("scope-manager@example.org", "/api/public-context?project=shared-slug")).json();
    assert.equal(managerContext.organizationId, "scope-org-a", "context only resolves campaigns assigned to the manager");
    assert.equal((await pageRequest("scope-manager@example.org", "/api/public-context?organizationId=scope-org-b&campaignId=scope-campaign-b")).status, 404);
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
    assert.equal((await scoped("scope-multi@example.org")).auth.role, "analyst");
    assert.equal((await scoped("scope-multi@example.org", { organizationId: "scope-org-b", campaignId: "scope-campaign-b", action: "campaign_view" })).auth.role, "viewer");
    assert.equal((await scoped("scope-multi@example.org", { organizationId: "scope-org-b", campaignId: "scope-campaign-b" })).error.status, 403);
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

    const platformCookie = cookies.get("scope-platform@example.org");
    const accountsRequest = (method = "GET", body) => handleRequest(new Request("http://localhost/api/admin/accounts", {
      method,
      headers: { cookie: platformCookie, ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }));
    assert.equal((await accountsRequest()).status, 200, "site admins can list approved accounts");
    assert.equal((await pageRequest("scope-manager@example.org", "/api/admin/accounts")).status, 403, "campaign managers cannot manage accounts");
    const invite = await accountsRequest("POST", {
      user: {
        email: "scope-invited@example.org",
        isActive: true,
        siteAdmin: false,
        memberships: [{ organizationId: "scope-org-b", campaignId: "scope-campaign-b", role: "viewer" }],
      },
    });
    assert.equal(invite.status, 201);
    assert.equal((await invite.json()).user.passwordSet, false);
    const invitedSetup = await handleRequest(new Request("http://localhost/api/auth/setup", {
      method: "POST",
      body: JSON.stringify({ email: "scope-invited@example.org", password: "InvitedTest123!", confirmPassword: "InvitedTest123!" }),
    }));
    assert.equal(invitedSetup.status, 200, "an approved user chooses a password on first login");
    const invitedCookie = invitedSetup.headers.get("set-cookie");
    const invitedStatus = await getAuthStatus(new Request("http://localhost/api/auth/status", { headers: { cookie: invitedCookie } }));
    assert.equal(invitedStatus.accessibleCampaigns.length, 1);
    assert.equal(invitedStatus.accessibleCampaigns[0].campaignId, "scope-campaign-b");
    assert.equal(invitedStatus.accessibleCampaigns[0].accessRole, "viewer");
    const selfDemotion = await accountsRequest("POST", {
      user: { email: "scope-platform@example.org", isActive: true, siteAdmin: false, memberships: [] },
    });
    assert.equal(selfDemotion.status, 400, "a site admin cannot remove their own site-admin access");

    const managerConfigPath = "/api/organizations/scope-org-a/campaigns/scope-campaign-a";
    const completedConfig = {
      basics: { id: "scope-campaign-a", organizationId: "scope-org-a", slug: "shared-slug", campaignName: "Campaign A", status: "completed", target: 1000, currency: "ILS" },
      branding: { title: "Campaign A", subtitle: "Original public copy", storyMarkdown: "Original story", mediaType: "image", mediaUrl: "/original.jpg" },
      goals: { campaignGoal: 1000 },
      dataSource: { secret: "original" },
    };
    assert.equal((await handleRequest(new Request(`http://localhost${managerConfigPath}`, {
      method: "POST", headers: { cookie: cookies.get("scope-manager@example.org"), "content-type": "application/json" }, body: JSON.stringify({ config: completedConfig }),
    }))).status, 403, "campaign managers cannot close campaigns");
    assert.equal((await handleRequest(new Request(`http://localhost${managerConfigPath}`, {
      method: "POST", headers: { cookie: cookies.get("scope-org@example.org"), "content-type": "application/json" }, body: JSON.stringify({ config: completedConfig }),
    }))).status, 200, "organization admins can close campaigns");
    const completedEdit = structuredClone(completedConfig);
    completedEdit.basics.campaignName = "Updated public name";
    completedEdit.basics.target = 999999;
    completedEdit.goals.campaignGoal = 999999;
    completedEdit.branding.subtitle = "Updated public copy";
    completedEdit.dataSource.secret = "changed";
    assert.equal((await handleRequest(new Request(`http://localhost${managerConfigPath}`, {
      method: "POST", headers: { cookie: cookies.get("scope-manager@example.org"), "content-type": "application/json" }, body: JSON.stringify({ config: completedEdit }),
    }))).status, 200, "campaign managers can still edit completed public copy");
    const frozenCampaign = await repo.getCampaign("scope-org-a", "scope-campaign-a");
    const frozenConfig = await repo.getCampaignConfig("scope-org-a", "scope-campaign-a");
    assert.equal(frozenCampaign.target, 1000, "completed targets remain frozen");
    assert.equal(frozenCampaign.name, "Updated public name");
    assert.equal(frozenConfig.branding.subtitle, "Updated public copy");
    assert.equal(frozenConfig.dataSource.secret, "original", "completed source configuration cannot change through a campaign save");
    assert.equal((await handleRequest(new Request(`http://localhost${managerConfigPath}/source`, {
      method: "POST", headers: { cookie: cookies.get("scope-manager@example.org"), "content-type": "application/json" }, body: JSON.stringify({ config: { mode: "file" } }),
    }))).status, 409, "completed source settings are locked");

    const manager = managers.find((item) => item.email === "scope-manager@example.org");
    manager.campaignIds = ["scope-other-a"];
    process.env.GOODRAISE_MANAGER_EMAILS = JSON.stringify(managers);
    assert.equal((await scoped(manager.email)).error.status, 403, "changed assignments apply on the next request");
    assert.equal((await pageRequest(manager.email, pageDataset)).status, 403, "campaign page access follows reassignment");
    assert.equal((await pageRequest(manager.email, campaignView)).status, 403);
    manager.isActive = false;
    process.env.GOODRAISE_MANAGER_EMAILS = JSON.stringify(managers);
    assert.equal((await scoped(manager.email, { campaignId: "scope-other-a" })).error.status, 401, "disabled managers cannot retain session access");
    assert.equal((await pageRequest(manager.email, pageDataset)).status, 401);

    const logout = await handleRequest(new Request("http://localhost/api/auth/logout", {
      method: "POST", headers: { cookie: cookies.get("scope-slug@example.org") },
    }));
    assert.equal(logout.status, 200);
    assert.equal((await scoped("scope-slug@example.org")).error.status, 401, "revoked sessions cannot retain access");
    assert.equal((await pageRequest("scope-slug@example.org", pageDataset)).status, 401);
    assert.equal((await pageRequest("scope-slug@example.org", campaignView)).status, 401);
    assert.equal((await getAuthStatus(request("scope-slug@example.org"))).permissions.campaignPages, false);
  } finally {
    if (previousManagers === undefined) delete process.env.GOODRAISE_MANAGER_EMAILS;
    else process.env.GOODRAISE_MANAGER_EMAILS = previousManagers;
  }
}
