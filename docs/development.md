# Development and operations

Updated 2026-09-13. Use Node.js 24 for development, tests and deployment. Python, pandas, SQLite, and the old server/build scripts have been removed from the active toolchain.

## Install and run

```sh
npm ci
cp .env.example .env
# Migration 007 provisions the two site owners; MANAGER_EMAILS is optional for additional bootstrap accounts.
npm run db:local:up
npm run db:migrate
npm run dev
```

The default address is `http://127.0.0.1:8767`. Development uses Vite middleware and the shared Node API in one process/origin. Backend changes restart the Node watcher; frontend modules support Vite updates. The compatibility controller cleans up listeners, requests and timers at unmount. Run one local server per development data directory.

`npm run build` prepares private seed and public assets, checks TypeScript, builds the React client, renders its initial shell and checks release boundaries. `npm start` serves `dist/` with the same Node backend. Build output is disposable. The tracked planning material in `outputs/` is separate.

## Configuration

`.env` and `work/config/*.local.json` are ignored. Only explicit `VITE_` variables would be exposed by Vite; do not place secrets in them. Existing backend credentials stay server-side.

| Variable | Meaning |
| --- | --- |
| `PORT`, `HOST` | Node listen address, defaults `8767` and loopback |
| `GOODRAISE_MANAGER_EMAILS` | JSON manager emails or scoped role records |
| `GOODRAISE_ACCESS_CONTROL_JSON` | Optional manager allowlist file |
| `GOODRAISE_DATA_DIR` | Development key/value files; defaults `work/data` |
| `GOODRAISE_DATABASE_URL` / `DATABASE_URL` | PostgreSQL connection; first takes precedence |
| `GOODRAISE_MIGRATION_DATABASE_URL` | Optional direct owner connection used only by the ordered migration runner; takes precedence there |
| `GOODRAISE_MIGRATION_CREDENTIALS_DIR` | Private local directory for generated bootstrap passwords; defaults to Git-ignored `work/private/admin-credentials` |
| `GOODRAISE_LOCAL_DATABASE_URL` | Explicit replaceable local target used by the Docker database tooling |
| `GOODRAISE_LOCAL_DB_NAME`, `_USER`, `_PASSWORD`, `_PORT` | Local Docker PostgreSQL settings; safe development defaults are in `.env.example` |
| `GOODRAISE_SOURCE_DATABASE_URL` | Direct hosted PostgreSQL URL used only for an explicit backup/clone command; do not retain in source control |
| `GOODRAISE_RUN_RUNTIME_SCHEMA_MIGRATIONS` | Legacy runtime DDL escape hatch; leave false and run ordered migrations |
| `GOODRAISE_SOURCE_CSV` | Private build seed; otherwise `work/source.csv`, then synthetic sample |
| `GOODRAISE_PRIZES_XLSX`, `GOODRAISE_PRIZES_CSV` | Optional initial prize table; workbook takes precedence |
| `GOODRAISE_INGEST_API_KEY` | Server-side key for external ingest |
| `GOODRAISE_GOOGLE_SERVICE_ACCOUNT_JSON` / `_JSON_PATH` | Private Sheets credentials |
| `OPENAI_API_KEY`, `GOODRAISE_AI_MODEL` | Optional question provider; deterministic answers work without a key |
| `GOODRAISE_PRELAUNCH_RESET_ENABLED` | Keep false unless reset operation is deliberately configured |
| `GOODRAISE_PUBLIC_URL` | Canonical public origin used in verification, review and first-login email links |
| `GOODRAISE_EMAIL_MODE` | Optional `outbox` for local capture or `resend` for hosted delivery |
| `GOODRAISE_RESEND_API_KEY`, `GOODRAISE_EMAIL_FROM` | Server-only production transactional-email credentials/sender |

The old manager/source environment names are accepted through compatibility readers. New setup should use only the names above. Cookie transport uses HTTPS detection/Netlify runtime; local loopback development uses HTTP.

First login for an approved email without a password enters password setup. Migration 007 provisions the two site owners with generated passwords; additional initial site admins can be seeded through `GOODRAISE_MANAGER_EMAILS`. After login they approve additional users and assign memberships at `/admin/users`. Approval does not prove mailbox ownership, so keep the account list controlled. There is no unauthenticated local password-reset endpoint in the shared Node application.

## Database workflow

### Local PostgreSQL and hosted-data copy

`compose.yaml` provides a persistent PostgreSQL 18 database bound only to `127.0.0.1:55432`. Start and inspect it with:

```sh
npm run db:local:up
npm run db:migrate
npm run db:local:status
```

`GOODRAISE_DATABASE_URL` is the application connection. `GOODRAISE_MIGRATION_DATABASE_URL` is the optional owner connection used only by the migration runner, while `GOODRAISE_LOCAL_DATABASE_URL` is deliberately separate and is the only database the restore command can replace. Hosted Netlify should set the runtime URL as a server-side environment variable; never expose it with a `VITE_` prefix. Use a restricted pooled role for runtime and a direct owner connection for controlled migrations and backups.

To make a local development copy from Neon, use the direct connection URL rather than a pooled runtime URL:

```sh
GOODRAISE_SOURCE_DATABASE_URL='postgresql://…' npm run db:local:clone -- --replace-local
```

This creates an ignored, mode-`0600` custom-format backup in `work/database-backups`, drops and restores only the local `goodraise` schema, and then runs every ordered repository migration. Authentication, membership, application-review, and source-configuration rows are excluded, so production password hashes, active sessions, verification tokens, and source credentials never enter the retained backup. Campaign and donor records are still private production data; keep the backup on an encrypted workstation and do not upload or commit it. Because a sanitized backup retains migration history but omits users, local restore removes only the `007_site_admins.ts` history entry and reapplies it to create local owner accounts with fresh passwords. Other migration records are retained. Additional configured `GOODRAISE_MANAGER_EMAILS` accounts are seeded locally when the application starts.

Recreate the same local database later without connecting to Neon:

```sh
npm run db:local:restore -- work/database-backups/goodraise-neon-<timestamp>.dump --replace-local
```

Stop PostgreSQL without deleting its named volume using `npm run db:local:down`.

For DBeaver, create a PostgreSQL connection named `GoodRaise Local (owner)` with host `127.0.0.1`, port `55432`, database/user `goodraise`, and the local-only password from `.env`. SSL is unnecessary for this loopback-only connection. Do not reuse this connection profile for a hosted database. A normal production-inspection profile must be read-only and use verified TLS; keep the direct owner URL limited to migrations, backups, and time-bounded administrative work.

### Ordered schema migrations

Set the database URL and run:

```sh
npm run db:migrate
```

The runner uses `GOODRAISE_MIGRATION_DATABASE_URL` first when present, then falls back to `GOODRAISE_DATABASE_URL` or `DATABASE_URL`. In hosted environments, this allows the application to use a restricted pooled runtime role while migrations use a direct owner connection. Both remain server-only secrets. Ordered `.sql` and `.ts` migrations share the same lock, checksum validation, transaction and history table; TypeScript migrations use the runner's client and must not commit independently.

`db/migrations/001_initial.sql` provides the baseline schema. `002_ingest_validation.sql` aligns the import-batch schema with Node validation counters. The runner locks migration execution, records checksums, applies each migration in a transaction, skips applied files, and fails if an applied file was edited. Add a new numbered SQL file for subsequent changes.

`003_normalize_admin_email.sql` also normalizes existing account emails to trimmed lowercase and adds a storage constraint. It preserves account UUIDs, password hashes and session references. Case/whitespace collisions cause the transaction to fail without merging accounts. The migration has a five-second lock timeout so it fails instead of waiting indefinitely on a busy account table.

`004_completed_campaign_snapshots.sql` adds the sanitized, persisted read model used by the public completed-campaign archive. Apply it before running the archive backfill or deploying the public archive routes.

`005_account_memberships.sql` adds per-user organization/campaign memberships and an access-configuration hash used to avoid rewriting unchanged configured accounts on each session read. It backfills legacy single-scope roles. Apply it before deploying the account selector or site-admin user management.

`006_campaign_applications.sql` adds the public application record, hashed and expiring email-verification state, approval references, notification diagnostics and append-only review events. Apply it before exposing `/start` or `/admin/applications`. Local development writes messages to `work/data/goodraise-email-outbox-dev.json`; production requires the configured email provider and never returns verification URLs in the public response.

### Site-admin bootstrap: migration 007

`007_site_admins.ts` creates or promotes `ranbo7@gmail.com` and `noamfrostig@gmail.com` to active, global `platform_admin` accounts. Run it with the normal `npm run db:migrate` command, not by pasting the TypeScript file into a SQL editor. Existing account IDs, set passwords and password timestamps are preserved. New/passwordless accounts receive distinct cryptographically random passwords, hashed with the application's PBKDF2-SHA256 format; plaintext never enters SQL or command output. Scoped memberships are removed for these global admins, and sessions are revoked only when an account's access/credentials change. Other users are untouched.

The generated-password JSON is stored **on the machine running the migration**, not on the database server. Its directory must have mode `0700`; each file is created exclusively with mode `0600`, synced before database writes, and never overwritten. Filenames start with `.env.007-site-admins-` so Vite's development filesystem server also denies them. The file identifies the target database without its connection credentials. A successful migration prints the file path. If both accounts already have passwords, no password file is created. Do not copy this directory into `dist`, upload it as a CI artifact, or commit it. Transfer the passwords securely and change them after first login.

To apply all pending migrations to production from your workstation, first confirm a recoverable snapshot and save the **direct** owner URL as `GOODRAISE_MIGRATION_DATABASE_URL` in a private, ignored `.env.production.local` file. Require verified TLS (`sslmode=verify-full`). Then run:

```sh
node --env-file=.env.production.local --import tsx scripts/migrate-db.ts
```

This command deliberately does not load the local `.env`, avoiding its local migration URL. It applies missing migrations 004–006 before 007 and independently generates production passwords where needed; local passwords are not copied into production. It does not change Netlify's runtime connection variable or deploy code. Verify `/api/health` and both authenticated admin accounts afterward. If either email is also in the hosted `GOODRAISE_MANAGER_EMAILS`, keep its role `platform_admin` and active; runtime configuration remains authoritative and can otherwise override the migration.

Rerunning the command skips an applied 007 and does not reset passwords, reactivate subsequently disabled users, or revoke fresh sessions. A credential-write failure rolls back account changes and leaves 007 unapplied. An interrupted/rolled-back attempt may leave a private candidate-password file: it is **not evidence of success**. Check the migration record and login before using that file. Keep candidate files if the commit result is uncertain; a committed password cannot be recovered from its hash. Never delete the migration marker to reset a live account's password.

```sql
SELECT name, checksum, applied_at FROM goodraise.schema_migrations ORDER BY name;
SELECT email, role, is_active,
       (password_hash IS NOT NULL AND length(password_hash) > 0) AS password_set
FROM goodraise.admin_users
WHERE email IN ('ranbo7@gmail.com', 'noamfrostig@gmail.com');
```

### Migration safeguards and operational imports

Apply migration 003 **before deploying the updated SQL authentication code**. Rehearse against a restored database copy and retain a backup. New code refuses SQL authentication if the constraint is missing, preventing duplicate account seeding against legacy mixed-case records. The previous code already normalizes writes and accepts lowercase values, so the schema change can precede code deployment. If the migration reports a collision, resolve the account ownership explicitly; do not automatically merge credentials or permissions. The GoodRaise Neon production database was migrated on 2026-09-09 after a snapshot and rehearsal; see the [rollout record](database-rollout-2026-09-09.md). Other databases still require their own migration check.

Migrations do not migrate SQLite users, move Blobs into SQL, import donations, or reconcile campaign identities from existing deployments. Existing runtime SQL definitions remain for compatibility; do not rely on request-time DDL for routine deployment. The runtime DDL escape hatch is not a replacement for running migrations 003–006 during deployment.

With a configured database and existing campaign:

```sh
npm run import:campaign -- --file work/source.csv --organization example-org --campaign autumn-drive
```

This calls the same batch ingestion service used by the source pipeline, preserving event identities and updating the dashboard snapshot. The CLI is additive/updating; it does not delete records absent from the CSV. Sheets full-snapshot refresh has a separate replacement policy that preserves manual matches. Browser CSV and comparison uploads are temporary analysis inputs and do not invoke this CLI or persist the ledger.

After applying migration 004, backfill public archive snapshots for campaigns already in `completed` status:

```sh
npm run backfill:completed-campaigns
```

The command skips existing snapshots. Pass `-- --rebuild-financials` only when an authorized site operator deliberately wants to replace frozen amounts and unique-supporter totals. New completed campaigns are snapshotted automatically when an organization/site admin closes them. The archive cache is warmed during application initialization and updated immediately when a campaign closes or its allowed public copy/media changes.

Build preparation writes full seed rows to `netlify/data/admin-dataset.json` outside `dist/`. Public bootstrap rows are empty. Existing campaign records prevent automatic legacy seed initialization from replacing their datasets.

## Validation

```sh
npm run build
npm test
npm run verify:auth
npm run test:postgres
npm run verify:hygiene
```

Tests that open HTTP or PostgreSQL ports need permission to bind to loopback in restricted sandboxes. The PostgreSQL suite uses `embedded-postgres`, creates its own temporary cluster, sets its own database URL, exercises migrations/imports/auth/reset, closes the shared pool, and deletes the cluster. It never connects to a configured production database. Install scripts for its native packages must be enabled; the repository includes explicit npm approvals for the supported macOS/Linux development and CI architectures.

The general regression suite uses development fixtures and restores files it changes. Run it with production database/Netlify environment markers unset. Test commands do not automatically load `.env`. Do not run multiple copies of fixture suites against the same directory.

Scoped authorization cases run against both development storage and the disposable PostgreSQL database. The SQL suite also asserts that permission-check query counts remain constant from 2 to 50 campaigns, that authorization reads no campaign datasets, and that the scoped dataset response reads only one dataset. See the [performance investigation](performance-investigation.md#direct-authorization-validation) for the measured counts and remaining work.

The SQL suite also checks joined-context and projected-summary parity, configuration-only reads, migration collision rollback, mixed-case account input, the existing plain-email index, skipped unchanged account updates, immediate assignment changes and session expiry/password changes.

Browser verification uses synthetic campaigns to check public pages, first-login setup, saved-data loading, campaign selection, source settings, designer and legal routes. The implementation record distinguishes these manual browser checks from automated tests.

## Deployment and jobs

Netlify builds with Node 24 and `npm run build`, publishes `dist/`, and bundles thin TypeScript functions that call `backend/app.ts`. Existing `/api` and campaign URLs remain supported. Configure server secrets in Netlify, apply database migrations before releasing code that requires them, and validate a preview against a safe dataset. Nothing here deploys the local changes automatically.

GitHub Actions runs build/typecheck, Node tests, auth verification, disposable PostgreSQL integration and repository hygiene. The workflow validates; it has no explicit deployment step.

Scheduled campaign jobs remain absent from `netlify.toml`. Existing `sync:google-sheets:once`, `sync:google-sheets:loop`, and `reset:prelaunch:once` commands call the canonical Node jobs. A manager session can still refresh sources on its configured interval. Review actual source schedules and data ownership before enabling any unattended job.

## Recovery

Preserve the database, existing Blobs stores, development files where relevant, private source inputs and campaign media. A code rollback alone is not a data rollback. Browser draft migration copies values without replacing newer generic keys. Auth migration reads the legacy store and writes the generic store; deletions use tombstones to prevent revoked legacy sessions from reappearing. Rolling back that store migration requires reconciling session revocations and newly changed passwords.

See [platform migration](platform-migration.md) for exactly what was changed and what still requires a deployment/data cutover.
