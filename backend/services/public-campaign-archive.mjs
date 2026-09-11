import { createHash } from "node:crypto";

import {
  deleteCampaignPublicSnapshot,
  getCampaign,
  getCampaignConfig,
  getCampaignPublicSnapshot,
  getCampaignPublicTotals,
  getOrganization,
  listCampaignPublicSnapshots,
  listCampaigns,
  saveCampaignPublicSnapshot,
} from "./campaign-repositories.mjs";
import { isoNow } from "./multi-tenant-model.mjs";

const COMPLETED_STATUS = "completed";
const ARCHIVE_CACHE_TTL_MS = 5 * 60 * 1000;
// Each process hydrates lazily from persisted snapshots, which also suits serverless cold starts.
const snapshotsById = new Map();
const snapshotAliases = new Map();
let archiveCacheReady = false;
let archiveCacheLoadedAt = 0;
let archiveCachePromise = null;

function text(value) {
  return String(value || "").trim();
}

function cacheId(snapshot) {
  return `${snapshot.organization.id}:${snapshot.campaign.id}`;
}

function aliasId(organizationId, campaignId) {
  return `${String(organizationId || "").trim().toLowerCase()}:${String(campaignId || "").trim().toLowerCase()}`;
}

function removeCachedSnapshot(organizationId, campaignId) {
  for (const [id, snapshot] of snapshotsById) {
    const organizationMatches = [snapshot.organization.id, snapshot.organization.slug].includes(organizationId);
    const campaignMatches = [snapshot.campaign.id, snapshot.campaign.slug].includes(campaignId);
    if (organizationMatches && campaignMatches) snapshotsById.delete(id);
  }
  for (const [alias, snapshot] of snapshotAliases) {
    if (!snapshotsById.has(cacheId(snapshot))) snapshotAliases.delete(alias);
  }
}

function cacheSnapshot(snapshot) {
  if (!snapshot || snapshot.campaign?.status !== COMPLETED_STATUS) return;
  snapshotsById.set(cacheId(snapshot), snapshot);
  for (const organizationId of [snapshot.organization.id, snapshot.organization.slug]) {
    for (const campaignId of [snapshot.campaign.id, snapshot.campaign.slug]) {
      if (organizationId && campaignId) snapshotAliases.set(aliasId(organizationId, campaignId), snapshot);
    }
  }
}

function campaignCard(snapshot) {
  return {
    organization: snapshot.organization,
    campaign: {
      id: snapshot.campaign.id,
      slug: snapshot.campaign.slug,
      name: snapshot.campaign.name,
      status: snapshot.campaign.status,
      description: snapshot.campaign.description,
      mediaType: snapshot.campaign.mediaType,
      mediaUrl: snapshot.campaign.mediaUrl,
      mediaAlt: snapshot.campaign.mediaAlt,
      campaignLogoUrl: snapshot.campaign.campaignLogoUrl,
    },
    totals: snapshot.totals,
    startAt: snapshot.startAt,
    endAt: snapshot.endAt,
    completedAt: snapshot.completedAt,
    href: snapshot.href,
    revision: snapshot.revision,
    updatedAt: snapshot.updatedAt,
  };
}

export function buildCompletedCampaignSnapshot({ organization, campaign, config = {}, totals, existing = null, now = isoNow() }) {
  const basics = config?.basics && typeof config.basics === "object" ? config.basics : {};
  const branding = config?.branding && typeof config.branding === "object" ? config.branding : {};
  const target = Number(totals?.target ?? campaign?.target ?? basics.target ?? config?.goals?.campaignGoal ?? 0) || 0;
  const raised = Number(totals?.raised || 0) || 0;
  const organizationSlug = text(organization?.slug || organization?.id);
  const campaignSlug = text(campaign?.slug || campaign?.id);
  return {
    schemaVersion: 1,
    revision: Number(existing?.revision || 0) + 1,
    organization: {
      id: text(organization?.id),
      slug: organizationSlug,
      name: text(organization?.name),
      logoUrl: text(branding.organizationLogoUrl),
    },
    campaign: {
      id: text(campaign?.id),
      slug: campaignSlug,
      name: text(branding.title || campaign?.name || basics.campaignName),
      status: COMPLETED_STATUS,
      description: text(branding.subtitle),
      story: text(branding.storyMarkdown),
      mediaType: ["image", "video"].includes(text(branding.mediaType).toLowerCase()) ? text(branding.mediaType).toLowerCase() : "image",
      mediaUrl: text(branding.mediaUrl),
      mediaAlt: text(branding.mediaAlt),
      campaignLogoUrl: text(branding.campaignLogoUrl),
    },
    totals: {
      raised,
      target,
      progressPercent: target > 0 ? Number(((raised / target) * 100).toFixed(2)) : 0,
      supporterCount: Math.max(0, Number(totals?.supporterCount || 0) || 0),
      currency: text(totals?.currency || campaign?.currency || basics.currency || "ILS").toUpperCase() || "ILS",
    },
    startAt: text(campaign?.startAt || basics.startAt || (basics.startDate ? `${basics.startDate}T${basics.startTime || "00:00"}:00` : "")),
    endAt: text(campaign?.endAt || basics.endAt || (basics.endDate ? `${basics.endDate}T${basics.endTime || "23:59"}:00` : "")),
    completedAt: text(existing?.completedAt || campaign?.updatedAt || now),
    publishedAt: text(existing?.publishedAt || now),
    updatedAt: now,
    href: `/campaigns/${encodeURIComponent(organizationSlug)}/${encodeURIComponent(campaignSlug)}`,
  };
}

export async function warmPublicCampaignArchiveCache({ force = false } = {}) {
  if (archiveCacheReady && !force && Date.now() - archiveCacheLoadedAt < ARCHIVE_CACHE_TTL_MS) return snapshotsById.size;
  if (archiveCachePromise && !force) return archiveCachePromise;
  archiveCachePromise = (async () => {
    const stored = await listCampaignPublicSnapshots();
    snapshotsById.clear();
    snapshotAliases.clear();
    stored.forEach(cacheSnapshot);
    archiveCacheReady = true;
    archiveCacheLoadedAt = Date.now();
    return snapshotsById.size;
  })();
  try {
    return await archiveCachePromise;
  } finally {
    archiveCachePromise = null;
  }
}

export async function publishCompletedCampaignSnapshot(organizationId, campaignId, { rebuildFinancials = false } = {}) {
  const [organization, campaign, config, existing] = await Promise.all([
    getOrganization(organizationId),
    getCampaign(organizationId, campaignId),
    getCampaignConfig(organizationId, campaignId),
    getCampaignPublicSnapshot(organizationId, campaignId),
  ]);
  if (!organization || !campaign) throw new Error(`Campaign not found: ${organizationId}/${campaignId}.`);
  if (campaign.status !== COMPLETED_STATUS) throw new Error(`Campaign is not completed: ${organizationId}/${campaignId}.`);
  const totals = existing && !rebuildFinancials ? existing.totals : await getCampaignPublicTotals(organization.id, campaign.id);
  const snapshot = buildCompletedCampaignSnapshot({ organization, campaign, config, totals, existing });
  const saved = await saveCampaignPublicSnapshot(organization.id, campaign.id, snapshot);
  cacheSnapshot(saved);
  return saved;
}

export async function unpublishCompletedCampaignSnapshot(organizationId, campaignId) {
  await deleteCampaignPublicSnapshot(organizationId, campaignId);
  removeCachedSnapshot(organizationId, campaignId);
}

export async function backfillCompletedCampaignSnapshots({ rebuildFinancials = false } = {}) {
  const campaigns = (await listCampaigns()).filter((campaign) => campaign.status === COMPLETED_STATUS);
  const result = { completedCampaigns: campaigns.length, created: 0, refreshed: 0, errors: [] };
  for (const campaign of campaigns) {
    try {
      const existing = await getCampaignPublicSnapshot(campaign.organizationId, campaign.id);
      if (existing && !rebuildFinancials) continue;
      await publishCompletedCampaignSnapshot(campaign.organizationId, campaign.id, { rebuildFinancials });
      if (existing) result.refreshed += 1;
      else result.created += 1;
    } catch (error) {
      result.errors.push({
        organizationId: campaign.organizationId,
        campaignId: campaign.id,
        message: error instanceof Error ? error.message : "Snapshot generation failed.",
      });
    }
  }
  await warmPublicCampaignArchiveCache({ force: true });
  return { ...result, ok: result.errors.length === 0 };
}

export async function listPublicCompletedCampaigns(limit = 8) {
  await warmPublicCampaignArchiveCache();
  const normalizedLimit = Math.min(100, Math.max(1, Number(limit) || 8));
  const all = [...snapshotsById.values()].sort((left, right) =>
    String(right.completedAt || "").localeCompare(String(left.completedAt || "")));
  return {
    items: all.slice(0, normalizedLimit).map(campaignCard),
    total: all.length,
    hasMore: all.length > normalizedLimit,
  };
}

export async function getPublicCompletedCampaign(organizationId, campaignId) {
  await warmPublicCampaignArchiveCache();
  return snapshotAliases.get(aliasId(organizationId, campaignId)) || null;
}

function publicJsonResponse(request, payload, { maxAge, sharedMaxAge }) {
  const serialized = JSON.stringify(payload);
  const etag = `"${createHash("sha256").update(serialized).digest("base64url")}"`;
  const headers = new Headers({
    "cache-control": `public, max-age=${maxAge}, s-maxage=${sharedMaxAge}, stale-while-revalidate=86400`,
    "content-type": "application/json; charset=utf-8",
    etag,
    "netlify-cdn-cache-control": `public, durable, s-maxage=${sharedMaxAge}, stale-while-revalidate=86400`,
  });
  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  return new Response(serialized, { status: 200, headers });
}

export async function getPublicCompletedCampaignIndexResponse(request) {
  const url = new URL(request.url);
  const payload = await listPublicCompletedCampaigns(url.searchParams.get("limit") || 8);
  return publicJsonResponse(request, payload, { maxAge: 60, sharedMaxAge: 300 });
}

export async function getPublicCompletedCampaignResponse(request, organizationId, campaignId) {
  const snapshot = await getPublicCompletedCampaign(organizationId, campaignId);
  if (!snapshot) {
    return new Response(JSON.stringify({ message: "הקמפיין ההיסטורי המבוקש אינו זמין." }), {
      status: 404,
      headers: { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" },
    });
  }
  return publicJsonResponse(request, snapshot, { maxAge: 3600, sharedMaxAge: 86400 });
}
