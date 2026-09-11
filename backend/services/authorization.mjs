import {
  ROLE_ANALYST,
  ROLE_CAMPAIGN_MANAGER,
  ROLE_ORGANIZATION_ADMIN,
  ROLE_ORDER,
  ROLE_PLATFORM_ADMIN,
  ROLE_VIEWER,
  normalizeRole,
  normalizeStableId,
} from "./multi-tenant-model.mjs";

export const ACTION_POLICY = {
  platform_overview: ROLE_VIEWER,
  campaign_list: ROLE_VIEWER,
  campaign_view: ROLE_VIEWER,
  campaign_page_view: ROLE_VIEWER,
  campaign_config_view: ROLE_CAMPAIGN_MANAGER,
  dataset_view: ROLE_ANALYST,
  insight_query: ROLE_ANALYST,
  source_view: ROLE_CAMPAIGN_MANAGER,
  source_update: ROLE_CAMPAIGN_MANAGER,
  source_refresh: ROLE_CAMPAIGN_MANAGER,
  campaign_update: ROLE_CAMPAIGN_MANAGER,
  campaign_lifecycle_update: ROLE_ORGANIZATION_ADMIN,
  ambassador_import: ROLE_CAMPAIGN_MANAGER,
  campaign_create: ROLE_ORGANIZATION_ADMIN,
  campaign_duplicate: ROLE_ORGANIZATION_ADMIN,
};

export function hasRequiredRole(role, minimumRole) {
  return (ROLE_ORDER[normalizeRole(role, ROLE_VIEWER)] || 0) >= (ROLE_ORDER[normalizeRole(minimumRole, ROLE_PLATFORM_ADMIN)] || 0);
}

function matchesAssignedCampaign(auth, campaign) {
  const assigned = [
    ...(Array.isArray(auth?.campaignIds) ? auth.campaignIds : []),
    ...(Array.isArray(auth?.campaignSlugs) ? auth.campaignSlugs : []),
  ]
    .map((value) => normalizeStableId(value))
    .filter(Boolean);
  if (!assigned.length) {
    return false;
  }
  const candidates = new Set([
    normalizeStableId(campaign?.id || ""),
    normalizeStableId(campaign?.slug || ""),
  ]);
  return assigned.some((value) => candidates.has(value));
}

function matchesOrganization(membership, organization) {
  const membershipIds = [membership?.organizationId, membership?.organizationSlug]
    .map((value) => normalizeStableId(value || ""))
    .filter(Boolean);
  const organizationIds = [organization?.id, organization?.slug]
    .map((value) => normalizeStableId(value || ""))
    .filter(Boolean);
  return membershipIds.some((value) => organizationIds.includes(value));
}

function matchesCampaign(membership, campaign) {
  const membershipIds = [membership?.campaignId, membership?.campaignSlug]
    .map((value) => normalizeStableId(value || ""))
    .filter(Boolean);
  const campaignIds = [campaign?.id, campaign?.slug]
    .map((value) => normalizeStableId(value || ""))
    .filter(Boolean);
  return membershipIds.some((value) => campaignIds.includes(value));
}

function legacyMembershipRole(auth, organization, campaign) {
  const organizationSlug = String(organization?.slug || "").trim().toLowerCase();
  const authOrganizationSlug = String(auth?.organizationSlug || "").trim().toLowerCase();
  const organizationId = normalizeStableId(organization?.id || "");
  const authOrganizationId = normalizeStableId(auth?.organizationId || "");
  const sameOrganization =
    (organizationId && authOrganizationId && organizationId === authOrganizationId) ||
    (organizationSlug && authOrganizationSlug && organizationSlug === authOrganizationSlug);
  if (!sameOrganization) return "";
  const role = normalizeRole(auth?.role, ROLE_VIEWER);
  if (role === ROLE_ORGANIZATION_ADMIN) return role;
  if (campaign && matchesAssignedCampaign(auth, campaign)) return role;
  if (!campaign && matchesAssignedCampaign(auth, { id: auth?.campaignIds?.[0], slug: auth?.campaignSlugs?.[0] })) return role;
  return "";
}

export function getEffectiveRole(auth, organization, campaign = null) {
  if (normalizeRole(auth?.role, ROLE_VIEWER) === ROLE_PLATFORM_ADMIN) return ROLE_PLATFORM_ADMIN;
  const memberships = Array.isArray(auth?.memberships) ? auth.memberships : null;
  if (memberships) {
    let effectiveRole = "";
    for (const membership of memberships) {
      if (!matchesOrganization(membership, organization)) continue;
      const role = normalizeRole(membership?.role, ROLE_VIEWER);
      const organizationWide = role === ROLE_ORGANIZATION_ADMIN && !membership?.campaignId && !membership?.campaignSlug;
      const campaignMatches = campaign ? matchesCampaign(membership, campaign) : Boolean(membership?.campaignId || membership?.campaignSlug);
      if (!organizationWide && !campaignMatches) continue;
      if ((ROLE_ORDER[role] || 0) > (ROLE_ORDER[effectiveRole] || 0)) effectiveRole = role;
    }
    return effectiveRole;
  }
  return legacyMembershipRole(auth, organization, campaign);
}

export function authorize(auth, action, organization, campaign = null) {
  const minimumRole = ACTION_POLICY[action] || ROLE_VIEWER;
  if (!auth?.authenticated || !auth?.email) {
    return { ok: false, status: 401, message: "נדרשת התחברות מנהל." };
  }

  const effectiveRole = getEffectiveRole(auth, organization, campaign);
  if (!effectiveRole) {
    return { ok: false, status: 403, message: "אין הרשאה לארגון המבוקש." };
  }
  if (!hasRequiredRole(effectiveRole, minimumRole)) {
    return { ok: false, status: 403, message: "אין הרשאה מספקת לביצוע הפעולה המבוקשת.", effectiveRole };
  }
  return { ok: true, effectiveRole };
}
