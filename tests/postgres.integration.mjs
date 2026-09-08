import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import EmbeddedPostgres from 'embedded-postgres';

const directory = await mkdtemp(join(tmpdir(), 'goodraise-postgres-'));
const port = await new Promise((resolve, reject) => {
  const server = createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)); });
});
const database = new EmbeddedPostgres({
  databaseDir: join(directory, 'database'), user: 'postgres', password: 'local-test-only', port,
  persistent: false, createPostgresUser: false, postgresFlags: ['-h', '127.0.0.1', '-k', directory],
  initdbFlags: ['--locale=C', '--encoding=UTF8'], onLog: () => {}, onError: () => {},
});
let client;
try {
  await database.initialise();
  await database.start();
  await database.createDatabase('goodraise_test');
  for (const key of ['NETLIFY', 'NETLIFY_LOCAL', 'SITE_ID', 'URL', 'SITE_NAME', 'DATABASE_URL', 'OPENAI_API_KEY']) delete process.env[key];
  process.env.GOODRAISE_DATABASE_URL = `postgresql://postgres:local-test-only@127.0.0.1:${port}/goodraise_test`;
  process.env.GOODRAISE_DATA_DIR = join(directory, 'state');
  process.env.GOODRAISE_MANAGER_EMAILS = '[{"email":"sql-manager@example.org","role":"platform_admin"}]';
  process.env.GOODRAISE_RUN_RUNTIME_SCHEMA_MIGRATIONS = 'false';
  const run = promisify(execFile);
  for (let index = 0; index < 2; index += 1) await run(process.execPath, ['--import', 'tsx', 'scripts/migrate-db.ts'], { env: process.env });
  client = database.getPgClient('goodraise_test');
  await client.connect();
  const migrations = await client.query('SELECT name FROM goodraise.schema_migrations');
  assert.equal(migrations.rowCount, 2);
  const repo = await import('../backend/services/campaign-repositories.mjs');
  const ingest = await import('../backend/services/postgres-ingest.mjs');
  await repo.saveOrganization({ id: 'org-sql', slug: 'sql', name: 'SQL Organization' });
  for (const campaign of ['alpha', 'beta']) {
    await repo.saveCampaign({ id: campaign, slug: campaign, organizationId: 'org-sql', name: campaign, startAt: '2026-08-23T00:00:00Z', endAt: '2026-09-01T23:59:00Z', target: 1000 });
    await repo.saveCampaignConfig('org-sql', campaign, { basics: { id: campaign, campaignName: campaign }, goals: {} });
  }
  const record = (id, total) => ({ id, total: String(total), created_at: '23/08/26 10:00', full_name: 'Synthetic Donor', email: `${id}@example.org`, charged_success: 'true', currencyname: 'ILS', 'Ambassador name': 'Synthetic Ambassador' });
  const scope = { organizationIdentifier: 'org-sql', campaignIdentifier: 'alpha' };
  await ingest.ingestCampaignRecords({ ...scope, records: [record('a', 100)], sourceLabel: 'test.csv' });
  await ingest.ingestCampaignRecords({ ...scope, records: [record('a', 100)], sourceLabel: 'test.csv' });
  await ingest.ingestCampaignRecords({ ...scope, campaignIdentifier: 'beta', records: [record('b', 200)] });
  const importPath = join(directory, 'repeat.csv');
  await writeFile(importPath, 'id,total,created_at,full_name,email,charged_success,currencyname\nb,200,23/08/26 10:00,Synthetic Donor,b@example.org,true,ILS\n');
  const cli = await run(process.execPath, ['--import', 'tsx', 'scripts/import-campaign.ts', '--file', importPath, '--organization', 'org-sql', '--campaign', 'beta'], { env: process.env });
  assert.equal(JSON.parse(cli.stdout).rowCount, 1);
  const registration = await ingest.importAmbassadorRegistrations({ ...scope, records: [{ full_name: 'Registered Ambassador', email: 'ambassador@example.org', nickname: 'registered' }] });
  assert.equal(registration.importedCount, 1);
  assert.equal((await repo.getCampaignDataset('org-sql', 'alpha')).rows.length, 1);
  await ingest.ingestManualContribution({ ...scope, enteredBy: 'Test Operator', amount: 50, attributedAt: '2026-08-23T11:00', requestId: 'manual-test' });
  await ingest.ingestManualContribution({ ...scope, enteredBy: 'Test Operator', amount: 50, attributedAt: '2026-08-23T11:00', requestId: 'manual-test' });
  await ingest.ingestCampaignRecords({ ...scope, records: [record('a', 120)], replaceExternalSnapshot: true });
  let dataset = await repo.getCampaignDataset('org-sql', 'alpha');
  assert.equal(dataset.rows.reduce((sum, row) => sum + row.amount, 0), 170);
  await ingest.ingestCampaignRecord({ ...scope, payload: record('c', 30) });
  dataset = await repo.getCampaignDataset('org-sql', 'alpha');
  assert.equal(dataset.rows.reduce((sum, row) => sum + row.amount, 0), 200);
  const { handleRequest } = await import('../backend/app.ts');
  const setup = await handleRequest(new Request('http://localhost/api/auth/setup', { method: 'POST', body: JSON.stringify({ email: 'sql-manager@example.org', password: 'DatabaseTest123!', confirmPassword: 'DatabaseTest123!' }) }));
  assert.equal(setup.status, 200);
  const cookie = setup.headers.get('set-cookie');
  const response = await handleRequest(new Request('http://localhost/api/organizations/org-sql/campaigns/alpha/dataset', { headers: { cookie } }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).rows.length, 3);
  await ingest.clearCampaignOperationalData({ ...scope });
  assert.equal((await repo.getCampaignDataset('org-sql', 'alpha')).rows.length, 0);
  assert.equal((await repo.getCampaignDataset('org-sql', 'beta')).rows[0].amount, 200);
  console.log('PostgreSQL integration passed: migrations twice, scoped datasets, idempotent imports, manual matching, source replacement, single ingest, SQL login and scoped reset.');
} finally {
  const { closeDatabasePool } = await import('../backend/database.ts');
  await closeDatabasePool();
  await client?.end();
  await database.stop();
  await rm(directory, { recursive: true, force: true });
}
