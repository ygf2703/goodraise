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
  dataset_view: ROLE_ANALYST,
  source_view: ROLE_CAMPAIGN_MANAGER,
  source_update: ROLE_CAMPAIGN_MANAGER,
  source_refresh: ROLE_CAMPAIGN_MANAGER,
  campaign_update: ROLE_CAMPAIGN_MANAGER,
  campaign_create: ROLE_ORGANIZATION_ADMIN,
  campaign_duplicate: ROLE_CAMPAIGN_MANAGER,
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

export function authorize(auth, action, organization, campaign = null) {
  const minimumRole = ACTION_POLICY[action] || ROLE_VIEWER;
  if (!auth?.authenticated || !auth?.email) {
    return { ok: false, status: 401, message: "נדרשת התחברות מנהל." };
  }

  if (!hasRequiredRole(auth.role, minimumRole)) {
    return { ok: false, status: 403, message: "אין הרשאה מספקת לביצוע הפעולה המבוקשת." };
  }

  if (normalizeRole(auth.role) === ROLE_PLATFORM_ADMIN) {
    return { ok: true };
  }

  const organizationSlug = String(organization?.slug || "").trim().toLowerCase();
  const authOrganizationSlug = String(auth.organizationSlug || "").trim().toLowerCase();
  const organizationId = normalizeStableId(organization?.id || "");
  const authOrganizationId = normalizeStableId(auth.organizationId || "");
  const sameOrganization =
    (organizationId && authOrganizationId && organizationId === authOrganizationId) ||
    (organizationSlug && authOrganizationSlug && organizationSlug === authOrganizationSlug);
  if (!sameOrganization) {
    return { ok: false, status: 403, message: "אין הרשאה לארגון המבוקש." };
  }

  if (normalizeRole(auth.role) === ROLE_ORGANIZATION_ADMIN) {
    return { ok: true };
  }

  if (!campaign) {
    return { ok: false, status: 403, message: "נדרש קמפיין מפורש לבקשה זו." };
  }

  if (!matchesAssignedCampaign(auth, campaign)) {
    return { ok: false, status: 403, message: "אין הרשאה לקמפיין המבוקש." };
  }

  return { ok: true };
}
