import assert from "node:assert/strict";
import pg from "pg";

export async function traceQueries(run) {
  const statements = [];
  const original = pg.Client.prototype.query;
  pg.Client.prototype.query = function (query, ...args) {
    statements.push({ text: typeof query === "string" ? query : query.text, values: args[0] });
    return original.call(this, query, ...args);
  };
  try {
    return { result: await run(), statements };
  } finally {
    pg.Client.prototype.query = original;
  }
}

export async function verifyPostgresAuthorizationQueries({ repo, handleRequest, resolveScopedAccess, cookie }) {
  const request = () => new Request("http://localhost/api/organizations/org-sql/campaigns/alpha/dataset", { headers: { cookie } });
  const scope = { organizationId: "org-sql", campaignId: "alpha", action: "dataset_view" };
  const measure = async () => {
    const trace = await traceQueries(() => resolveScopedAccess(request(), scope));
    assert.equal(trace.result.error, undefined);
    assert.equal(trace.result.campaign.id, "alpha");
    assert.ok(!trace.statements.some(({ text }) => /goodraise\.(?:campaign_datasets|campaign_configs|campaign_sources|transactions)\b/.test(text)), "authorization must not query campaign payloads or donations");
    const identities = trace.statements.filter(({ text }) => /FROM goodraise\.(?:organizations|campaigns)\b/.test(text));
    assert.equal(identities.length, 2, "one organization lookup and one campaign lookup");
    assert.ok(identities.every(({ text }) => /WHERE\b/.test(text) && /LIMIT 1/.test(text)), "identity lookups must be bounded");
    return trace.statements.length;
  };
  const beforeCount = (await repo.listCampaigns()).length;
  const beforeQueries = await measure();
  for (let index = beforeCount; index < 50; index += 1) {
    await repo.saveCampaign({ id: `unrelated-${index}`, slug: `unrelated-${index}`, organizationId: "org-sql", name: `Unrelated ${index}` });
  }
  const afterQueries = await measure();
  assert.equal(afterQueries, beforeQueries, "authorization query count must not grow with unrelated campaigns");

  const dataset = await traceQueries(() => handleRequest(request()));
  assert.equal(dataset.result.status, 200);
  assert.equal((await dataset.result.json()).rows.length, 3);
  const reads = dataset.statements.filter(({ text }) => /(?:FROM|JOIN) goodraise\.campaign_datasets\b/.test(text));
  assert.equal(reads.length, 1, "a scoped dataset response reads just the requested dataset once");
  assert.match(reads[0].text, /ds\.campaign_id = c\.id/);

  const identity = await traceQueries(() => handleRequest(new Request("http://localhost/api/auth/status?includeCampaigns=false", { headers: { cookie } })));
  assert.equal(identity.result.status, 200);
  assert.equal((await identity.result.json()).permissions.campaignPages, true);
  assert.ok(!identity.statements.some(({ text }) => /goodraise\.(?:campaigns|campaign_datasets|campaign_configs|campaign_sources|transactions)\b/.test(text)), "header/login identity checks do not read campaigns or payloads");
  const view = await traceQueries(() => handleRequest(new Request("http://localhost/api/campaign-view?organizationId=org-sql&campaignId=alpha", { headers: { cookie } })));
  assert.equal(view.result.status, 200);
  const viewPayload = await view.result.json();
  assert.equal(viewPayload.rows.length, 3);
  assert.equal(viewPayload.rows[0].email, undefined);
  assert.equal(view.statements.filter(({ text }) => /(?:FROM|JOIN) goodraise\.campaign_datasets\b/.test(text)).length, 1, "campaign view reads one selected dataset without portfolio passes");

  const anonymous = await traceQueries(() => resolveScopedAccess(new Request(request().url), scope));
  assert.equal(anonymous.result.error.status, 401);
  assert.equal(anonymous.statements.length, 0, "no SQL scope lookups before authentication");

  const fallback = await traceQueries(() => resolveScopedAccess(new Request("http://localhost/api/admin/dataset?campaignId=alpha", { headers: { cookie } }), { action: "dataset_view" }));
  assert.equal(fallback.result.campaign.id, "alpha");
  assert.ok(!fallback.statements.some(({ text }) => /goodraise\.(?:campaign_datasets|campaign_configs|campaign_sources|transactions)\b/.test(text)), "legacy selection must only enumerate identities");

  console.log(`Scoped authorization: ${beforeQueries} SQL statements with ${beforeCount} campaigns and ${afterQueries} with 50; 2 bounded identity lookups, 0 dataset reads. Scoped dataset endpoint: 1 dataset read.`);
}
