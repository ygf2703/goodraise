import { authorize } from "./authorization.mjs";
import {
  ROLE_CAMPAIGN_MANAGER,
  ROLE_PLATFORM_ADMIN,
  ROLE_VIEWER,
  isoNow,
  normalizeRole,
  normalizeStableId,
  normalizeSourceConfig,
} from "./multi-tenant-model.mjs";
import { jsonResponse, requireManagerAccess, resolveScopedAccess } from "./auth-store.mjs";
import {
  appendAuditEvent,
  buildCampaignContext,
  ensureMultiTenantMigration,
  getCampaign,
  getOrganization,
  listCampaignSummaries,
  saveCampaign,
  saveCampaignConfig,
  saveCampaignDataset,
  saveCampaignSource,
  saveOrganization,
} from "./campaign-repositories.mjs";

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function normalizeSnapshotScope(snapshot = {}, fallback = {}) {
  const organization = snapshot.organization && typeof snapshot.organization === "object" ? snapshot.organization : {};
  const basics = snapshot.basics && typeof snapshot.basics === "object" ? snapshot.basics : {};
  const organizationId = String(
    fallback.organizationId ||
      organization.id ||
      basics.organizationId ||
      "",
  ).trim();
  const campaignId = String(
    fallback.campaignId ||
      basics.id ||
      "",
  ).trim();
  return {
    organizationId,
    campaignId,
    organizationName: String(organization.name || basics.organizationName || "").trim(),
    organizationSlug: String(organization.slug || basics.organizationSlug || "").trim(),
    campaignName: String(basics.campaignName || "").trim(),
    campaignSlug: String(basics.slug || "").trim(),
    status: String(basics.status || "draft").trim().toLowerCase() || "draft",
    startAt: String(basics.startAt || "").trim() || (basics.startDate ? `${basics.startDate}T${String(basics.startTime || "00:00").trim()}:00` : ""),
    endAt: String(basics.endAt || "").trim() || (basics.endDate ? `${basics.endDate}T${String(basics.endTime || "23:59").trim()}:00` : ""),
    target: Number(snapshot?.goals?.campaignGoal || basics.target || 0) || 0,
    currency: String(basics.currency || "ILS").trim().toUpperCase() || "ILS",
  };
}

function extractActiveSnapshot(rawConfig, fallback = {}) {
  const candidate = rawConfig && typeof rawConfig === "object" ? rawConfig : {};
  const campaigns = Array.isArray(candidate.campaigns) ? candidate.campaigns : [];
  const activeCampaignId = String(candidate.activeCampaignId || fallback.campaignId || "").trim();
  const targetEntry = campaigns.find((item) => String(item?.id || "").trim() === activeCampaignId) || campaigns[0] || null;
  const snapshot = targetEntry?.config && typeof targetEntry.config === "object" ? cloneJson(targetEntry.config) : cloneJson(candidate);
  return {
    candidate,
    campaigns,
    activeCampaignId,
    targetEntry,
    snapshot,
  };
}

function buildRegistryFromContexts(contexts, activeCampaignId) {
  const campaigns = contexts.map((context) => {
    const config = cloneJson(context.config || {});
    config.organization = {
      id: context.organization.id,
      slug: context.organization.slug,
      name: context.organization.name,
      status: context.organization.status,
    };
    config.basics = {
      ...(config.basics || {}),
      id: context.campaign.id,
      organizationId: context.organization.id,
      organizationSlug: context.organization.slug,
      organizationName: context.organization.name,
      slug: context.campaign.slug,
      campaignName: context.campaign.name,
      status: context.campaign.status,
      target: context.campaign.target,
      currency: context.campaign.currency,
    };
    config.meta = {
      ...(config.meta || {}),
      lastSavedAt: config.meta?.lastSavedAt || context.campaign.updatedAt || "",
      lastSavedBy: config.meta?.lastSavedBy || "",
    };
    return {
      id: context.campaign.id,
      name: context.campaign.name,
      slug: context.campaign.slug,
      updatedAt: config.meta.lastSavedAt || context.campaign.updatedAt || "",
      updatedBy: config.meta.lastSavedBy || "",
      config,
    };
  });

  return {
    version: 2,
    activeCampaignId: campaigns.some((item) => item.id === activeCampaignId) ? activeCampaignId : campaigns[0]?.id || "",
    campaigns,
  };
}

async function listAccessibleCampaignSummariesForAuth(auth) {
  const summaries = await listCampaignSummaries();
  const contexts = [];
  for (const summary of summaries) {
    const organization = await getOrganization(summary.organizationId);
    const campaign = await getCampaign(summary.organizationId, summary.campaignId);
    if (!organization || !campaign) {
      continue;
    }
    const authorization = authorize(
      {
        ...auth,
        authenticated: Boolean(auth?.authenticated ?? auth?.email),
      },
      "campaign_view",
      organization,
      campaign,
    );
    if (authorization.ok) {
      contexts.push(summary);
    }
  }
  return contexts;
}

async function buildAccessibleRegistry(access, preferredCampaignId = "") {
  const summaries = access.accessibleCampaigns || await listAccessibleCampaignSummariesForAuth(access.auth);
  const contexts = [];
  for (const summary of summaries) {
    const context = await buildCampaignContext(summary.organizationId, summary.campaignId);
    if (context) {
      contexts.push(context);
    }
  }
  return buildRegistryFromContexts(contexts, preferredCampaignId || access.campaign?.id || "");
}

async function requireOrganizationAccess(request, organizationId, action, unauthorizedMessage) {
  await ensureMultiTenantMigration();
  const baseAccess = await requireManagerAccess(request, ROLE_VIEWER, unauthorizedMessage);
  if (baseAccess.error) {
    return baseAccess;
  }

  const organization = await getOrganization(organizationId);
  if (!organization) {
    return {
      auth: baseAccess.auth,
      error: jsonResponse(404, { message: "הארגון המבוקש אינו קיים." }),
    };
  }

  const authorization = authorize(
    {
      ...baseAccess.auth,
      authenticated: true,
    },
    action,
    organization,
    null,
  );
  if (!authorization.ok) {
    return {
      auth: baseAccess.auth,
      error: jsonResponse(authorization.status, { message: authorization.message }),
    };
  }

  return {
    auth: baseAccess.auth,
    organization,
  };
}

async function createOrUpdateScopedCampaign({ auth, organization, campaignId, snapshot, existingCampaign = null }) {
  const normalizedScope = normalizeSnapshotScope(snapshot, {
    organizationId: organization.id,
    campaignId,
  });
  const effectiveCampaignId = normalizeStableId(campaignId || normalizedScope.campaignId || normalizedScope.campaignSlug || "campaign");
  const now = isoNow();

  snapshot.organization = {
    ...(snapshot.organization || {}),
    id: organization.id,
    slug: normalizedScope.organizationSlug || organization.slug,
    name: normalizedScope.organizationName || organization.name,
    status: organization.status,
  };
  snapshot.basics = {
    ...(snapshot.basics || {}),
    id: effectiveCampaignId,
    organizationId: organization.id,
    organizationSlug: normalizedScope.organizationSlug || organization.slug,
    organizationName: normalizedScope.organizationName || organization.name,
    slug: normalizedScope.campaignSlug || existingCampaign?.slug || effectiveCampaignId,
    campaignName: normalizedScope.campaignName || existingCampaign?.name || effectiveCampaignId,
    status: normalizedScope.status || existingCampaign?.status || "draft",
    target: normalizedScope.target || existingCampaign?.target || 0,
    currency: normalizedScope.currency || existingCampaign?.currency || "ILS",
  };

  await saveOrganization({
    id: organization.id,
    slug: snapshot.organization.slug,
    name: snapshot.organization.name,
    status: snapshot.organization.status || organization.status,
    createdAt: organization.createdAt,
    updatedAt: now,
  });

  const savedCampaign = await saveCampaign({
    id: effectiveCampaignId,
    organizationId: organization.id,
    slug: snapshot.basics.slug,
    name: snapshot.basics.campaignName,
    status: snapshot.basics.status,
    startAt: normalizedScope.startAt || existingCampaign?.startAt || "",
    endAt: normalizedScope.endAt || existingCampaign?.endAt || "",
    target: snapshot.basics.target,
    currency: snapshot.basics.currency,
    createdAt: existingCampaign?.createdAt || now,
    updatedAt: now,
  });

  const savedConfig = await saveCampaignConfig(organization.id, savedCampaign.id, snapshot, auth.email);
  // Campaign settings are saved independently from operational data. Updating
  // design, copy or goals must never reset a configured source or its dataset.
  // New campaigns still receive an initial source and an empty isolated dataset.
  if (!existingCampaign) {
    await saveCampaignSource(organization.id, savedCampaign.id, normalizeSourceConfig(snapshot.dataSource || snapshot.source || {}));
    await saveCampaignDataset(organization.id, savedCampaign.id, {
      organizationId: organization.id,
      campaignId: savedCampaign.id,
      rows: [],
      meta: {},
      sourceLabel: "",
      generatedAt: now,
      updatedAt: now,
    });
  }

  return {
    campaign: savedCampaign,
    config: savedConfig,
  };
}

export async function getOrganizationCampaignList(request, organizationId) {
  const access = await requireOrganizationAccess(
    request,
    organizationId,
    "campaign_list",
    "נדרשת התחברות מנהל כדי לטעון את רשימת הקמפיינים.",
  );
  if (access.error) {
    return access.error;
  }

  const accessibleCampaigns = await listAccessibleCampaignSummariesForAuth({
    ...access.auth,
    authenticated: true,
  });
  return jsonResponse(200, {
    organizationId: access.organization.id,
    campaigns: accessibleCampaigns.filter((item) => item.organizationId === access.organization.id),
  });
}

export async function createOrganizationCampaign(request, organizationId, rawConfig = {}) {
  const access = await requireOrganizationAccess(
    request,
    organizationId,
    "campaign_create",
    "נדרשת התחברות מנהל כדי ליצור קמפיין חדש.",
  );
  if (access.error) {
    return access.error;
  }

  const { targetEntry, snapshot } = extractActiveSnapshot(rawConfig, { organizationId });
  const requestedCampaignId = normalizeStableId(targetEntry?.id || snapshot?.basics?.id || snapshot?.basics?.slug || "campaign");
  const existingCampaign = await getCampaign(access.organization.id, requestedCampaignId);
  if (existingCampaign) {
    return jsonResponse(409, { message: "כבר קיים קמפיין עם המזהה המבוקש בארגון זה." });
  }

  const saved = await createOrUpdateScopedCampaign({
    auth: access.auth,
    organization: access.organization,
    campaignId: requestedCampaignId,
    snapshot,
    existingCampaign: null,
  });

  await appendAuditEvent({
    user: access.auth.email,
    role: access.auth.role,
    organizationId: access.organization.id,
    campaignId: saved.campaign.id,
    action: "campaign_created",
    outcome: "success",
  });

  const accessibleCampaigns = await listAccessibleCampaignSummariesForAuth({
    ...access.auth,
    authenticated: true,
  });
  const registry = await buildAccessibleRegistry(
    {
      auth: access.auth,
      accessibleCampaigns,
      campaign: saved.campaign,
    },
    saved.campaign.id,
  );

  return jsonResponse(201, {
    config: registry,
    activeCampaign: {
      organizationId: access.organization.id,
      campaignId: saved.campaign.id,
    },
    updatedAt: saved.config.meta?.lastSavedAt || saved.campaign.updatedAt || "",
    updatedBy: saved.config.meta?.lastSavedBy || access.auth.email,
    saved: true,
    created: true,
    message: "הקמפיין נוצר ונשמר בשרת.",
  });
}

export async function getAdminCampaignConfig(request, scope = {}) {
  await ensureMultiTenantMigration();
  const access = await resolveScopedAccess(request, {
    action: "campaign_view",
    organizationId: scope.organizationId,
    campaignId: scope.campaignId,
    unauthorizedMessage: "נדרשת התחברות מנהל כדי לטעון את הגדרות הקמפיין.",
  });
  if (access.error) {
    return access.error;
  }

  const registry = await buildAccessibleRegistry(access, access.campaign.id);
  return jsonResponse(200, {
    config: registry,
    activeCampaign: {
      organizationId: access.organization.id,
      campaignId: access.campaign.id,
    },
    portfolio: access.accessibleCampaigns,
    updatedAt: access.campaign.updatedAt || "",
    updatedBy: registry.campaigns.find((item) => item.id === access.campaign.id)?.updatedBy || "",
    message: "הגדרות הקמפיין נטענו מהשרת.",
  });
}

function extractRequestedScope(rawConfig, fallback = {}) {
  const { targetEntry, snapshot } = extractActiveSnapshot(rawConfig, fallback);
  return normalizeSnapshotScope(snapshot, {
    organizationId: fallback.organizationId,
    campaignId: targetEntry?.id || fallback.campaignId,
  });
}

export async function saveAdminCampaignConfig(request, rawConfig, scope = {}) {
  await ensureMultiTenantMigration();
  const requestedScope = extractRequestedScope(rawConfig, scope);
  const requestedOrganizationId = requestedScope.organizationId || scope.organizationId;
  const requestedCampaignId = requestedScope.campaignId || scope.campaignId;
  const existingCampaign =
    requestedOrganizationId && requestedCampaignId
      ? await getCampaign(requestedOrganizationId, requestedCampaignId)
      : null;

  if (!existingCampaign && requestedOrganizationId && requestedCampaignId) {
    return createOrganizationCampaign(request, requestedOrganizationId, rawConfig);
  }

  const access = await resolveScopedAccess(request, {
    action: "campaign_update",
    organizationId: requestedOrganizationId,
    campaignId: requestedCampaignId,
    unauthorizedMessage: "נדרשת התחברות מנהל כדי לשמור את הגדרות הקמפיין.",
  });
  if (access.error) {
    return access.error;
  }
  if (!access.auth || !access.campaign) {
    return jsonResponse(403, { message: "אין הרשאה מספקת לשמירת הקמפיין." });
  }
  if (["viewer", "analyst"].includes(normalizeRole(access.auth.role, ROLE_VIEWER))) {
    return jsonResponse(403, { message: "אין הרשאת כתיבה לקמפיין המבוקש." });
  }

  const { candidate, campaigns } = extractActiveSnapshot(rawConfig, {
    organizationId: access.organization.id,
    campaignId: access.campaign.id,
  });
  const activeCampaignId = String(candidate.activeCampaignId || access.campaign.id).trim();
  const targetEntry = campaigns.find((item) => String(item?.id || "").trim() === activeCampaignId) || campaigns[0] || null;
  const snapshot = targetEntry?.config && typeof targetEntry.config === "object" ? cloneJson(targetEntry.config) : cloneJson(candidate);
  const saved = await createOrUpdateScopedCampaign({
    auth: access.auth,
    organization: access.organization,
    campaignId: access.campaign.id,
    snapshot,
    existingCampaign: access.campaign,
  });

  await appendAuditEvent({
    user: access.auth.email,
    role: access.auth.role,
    organizationId: access.organization.id,
    campaignId: access.campaign.id,
    action: "campaign_update",
    outcome: "success",
  });

  const registry = await buildAccessibleRegistry(
    {
      ...access,
      campaign: saved.campaign,
    },
    saved.campaign.id,
  );

  return jsonResponse(200, {
    config: registry,
    activeCampaign: {
      organizationId: access.organization.id,
      campaignId: saved.campaign.id,
    },
    updatedAt: saved.config.meta?.lastSavedAt || saved.campaign.updatedAt || "",
    updatedBy: saved.config.meta?.lastSavedBy || access.auth.email,
    saved: true,
    message: "הגדרות הקמפיין נשמרו בשרת.",
  });
}
