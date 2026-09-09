import assert from "node:assert/strict";
import pg from "pg";
import { buildCampaignSummary } from "../../backend/services/multi-tenant-model.mjs";
import { traceQueries } from "./postgres-authorization-queries.mjs";

// Reference the previous read flow to catch changes to totals, dates, defaults
// and response fields, rather than merely asserting the new SQL's shape.
async function previousSummaries(repo) {
  const organizations = new Map((await repo.listOrganizations()).map((item) => [item.id, item]));
  const summaries = [];
  for (const campaign of await repo.listCampaigns()) {
    summaries.push(buildCampaignSummary({
      organization: organizations.get(campaign.organizationId) || null, campaign,
      dataset: await repo.getCampaignDataset(campaign.organizationId, campaign.id),
      config: await repo.getCampaignConfig(campaign.organizationId, campaign.id),
    }));
  }
  return summaries;
}

export async function verifyPostgresReadQueries({ repo, handleRequest, cookie }) {
  await repo.saveOrganization({ id: "read-org", slug: "read-organization", name: "Read tests" });
  for (const [id, target] of [["read-campaign", 0], ["empty-campaign", 100], ["missing-config", 50]]) {
    await repo.saveCampaign({ id, slug: `${id}-slug`, organizationId: "read-org", name: id, target, startAt: "2026-09-01T00:00:00Z", endAt: "2026-09-10T23:59:00Z" });
  }
  await repo.saveCampaignConfig("read-org", "read-campaign", {
    basics: { target: 100, startDate: "2020-01-01", endDate: "2020-01-02" },
    goals: { placePrizes: [{ place: 1, prize: "Sample" }] },
    ambassadors: { records: [{ fullName: "Synthetic ambassador" }] },
    branding: { story: "A long campaign story ".repeat(100) },
  });
  await repo.saveCampaignSource("read-org", "read-campaign", { mode: "file" });
  const rows = [
    { amount: 0.1 }, { amount: 0.2 }, { amount: "15.25" }, { amount: -5 },
    { amount: "" }, { amount: null }, {}, null,
    ...Array.from({ length: 1000 }, (_, index) => ({ id: `synthetic-${index}`, amount: 1, donor: "PRIVATE_DONOR_".repeat(30), email: "private@example.org", city: "Synthetic city" })),
  ];
  await repo.saveCampaignDataset("read-org", "read-campaign", {
    rows, meta: { projectDates: ["2026-09-01", "2026-09-02"], defaultFrom: "2026-09-01", defaultTo: "2026-09-02" },
    generatedAt: "2026-09-09T00:00:00.000Z", updatedAt: "2026-09-09T00:00:00.000Z", sourceLabel: "synthetic.csv",
  });
  await repo.saveCampaignDataset("read-org", "missing-config", { rows: [{ amount: 8 }], generatedAt: "2026-09-09T00:00:00.000Z" });

  const original = await previousSummaries(repo);
  let summaryBytes = 0;
  const originalQuery = pg.Client.prototype.query;
  pg.Client.prototype.query = function (query, ...args) {
    const text = typeof query === "string" ? query : query.text;
    const result = originalQuery.call(this, query, ...args);
    if (text.includes("jsonb_agg(jsonb_build_object('amount'")) {
      return result.then((response) => {
        const serialized = JSON.stringify(response.rows);
        assert.ok(!serialized.includes("PRIVATE_DONOR_") && !serialized.includes("private@example.org") && !serialized.includes("A long campaign story"), "summary SQL must not return donor fields or full configuration");
        summaryBytes += Buffer.byteLength(serialized);
        return response;
      });
    }
    return result;
  };
  let summaries;
  try { summaries = await traceQueries(() => repo.listCampaignSummaries()); }
  finally { pg.Client.prototype.query = originalQuery; }
  assert.deepEqual(summaries.result, original, "summaries must exactly match the previous data and summation semantics");
  assert.equal(summaries.statements.length, 2, "portfolio summaries must use two reads independent of campaign count");
  const fullDatasetBytes = Buffer.byteLength(JSON.stringify(await repo.getCampaignDataset("read-org", "read-campaign")));
  assert.ok(summaryBytes < fullDatasetBytes / 3, "projecting amounts substantially reduces transfer even across all campaigns");

  const context = await traceQueries(() => repo.buildCampaignContext("read-org", "read-campaign"));
  assert.equal(context.statements.length, 1, "campaign context should use one joined read");
  assert.deepEqual(context.result.organization, await repo.getOrganization("read-org"));
  assert.deepEqual(context.result.campaign, await repo.getCampaign("read-org", "read-campaign"));
  assert.deepEqual(context.result.config, await repo.getCampaignConfig("read-org", "read-campaign"));
  assert.deepEqual(context.result.source, await repo.getCampaignSource("read-org", "read-campaign"));
  assert.deepEqual(context.result.dataset, repo.applyConfiguredProjectWindow(await repo.getCampaignDataset("read-org", "read-campaign"), context.result.config, context.result.campaign));
  assert.deepEqual(context.result.dataset.meta.projectDates, ["2026-09-01", "2026-09-02"], "stored window still wins over builder dates");
  const alias = await repo.buildCampaignContext("read-organization", "read-campaign-slug");
  assert.deepEqual(alias.campaign, context.result.campaign);
  assert.deepEqual(alias.dataset, context.result.dataset);
  const empty = await repo.buildCampaignContext("read-org", "empty-campaign");
  assert.deepEqual(empty.config, {});
  assert.deepEqual(empty.dataset.rows, []);
  assert.equal(await repo.buildCampaignContext("read-org", "missing"), null);
  assert.equal(await repo.buildCampaignContext("org-sql", "read-campaign"), null, "joined reads must not cross organizations");
  assert.equal(await repo.buildCampaignContext("missing", "read-campaign"), null);

  const configOnly = await traceQueries(() => repo.buildCampaignContext("read-org", "read-campaign", { includeOperationalData: false }));
  assert.equal(configOnly.statements.length, 1);
  assert.ok(!configOnly.statements.some(({ text }) => /goodraise\.(campaign_datasets|campaign_sources)/.test(text)));
  assert.deepEqual(configOnly.result.config, context.result.config);

  const auth = { authenticated: true, email: "scoped-summary@example.org", role: "campaign_manager", organizationId: "read-org", campaignIds: ["read-campaign"] };
  const scoped = await traceQueries(() => repo.listCampaignSummaries({ auth }));
  assert.deepEqual(scoped.result, original.filter((summary) => summary.campaignId === "read-campaign"));
  const restrictedRead = scoped.statements.find(({ text }) => text.includes("WHERE c.id = ANY($1::uuid[])"));
  assert.equal(restrictedRead.values[0].length, 1, "donation amounts may only be fetched for allowed campaigns");
  assert.deepEqual(await repo.listCampaignSummaries({ auth: { ...auth, authenticated: false } }), []);
  assert.deepEqual(await repo.listCampaignSummaries({ auth, organizationId: "org-sql" }), []);

  const organizationList = await traceQueries(() => handleRequest(new Request("http://localhost/api/organizations/org-sql/campaigns", { headers: { cookie } })));
  assert.equal(organizationList.result.status, 200);
  const organizationPayload = await organizationList.result.json();
  assert.ok(organizationPayload.campaigns.every((item) => item.organizationId === "org-sql"));
  assert.equal(organizationList.statements.find(({ text }) => text.includes("WHERE c.id = ANY($1::uuid[])" )).values[0].length, organizationPayload.campaigns.length);

  const configuration = await traceQueries(() => handleRequest(new Request("http://localhost/api/organizations/org-sql/campaigns/alpha", { headers: { cookie } })));
  assert.equal(configuration.result.status, 200);
  const payload = await configuration.result.json();
  assert.equal(payload.activeCampaign.campaignId, "alpha");
  assert.ok(payload.portfolio.length > 1 && payload.config.campaigns.length === payload.portfolio.length);
  assert.equal(configuration.statements.filter(({ text }) => /JOIN goodraise.campaign_datasets/.test(text)).length, 1, "registry should only query the amount projection, with no full-dataset context reads");
  console.log(`Campaign reads: context 1 query; summaries 2 queries for ${original.length} campaigns; summary payload ${summaryBytes} bytes versus ${fullDatasetBytes} bytes for one full synthetic dataset; totals/date/scope parity verified.`);
}
