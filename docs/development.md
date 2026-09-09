# Development and operations

Updated 2026-09-08. Use Node.js 24 for development, tests and deployment. Python, pandas, SQLite, and the old server/build scripts have been removed from the active toolchain.

## Install and run

```sh
npm ci
cp .env.example .env
# Edit GOODRAISE_MANAGER_EMAILS before first login.
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
| `GOODRAISE_RUN_RUNTIME_SCHEMA_MIGRATIONS` | Legacy runtime DDL escape hatch; leave false and run ordered migrations |
| `GOODRAISE_SOURCE_CSV` | Private build seed; otherwise `work/source.csv`, then synthetic sample |
| `GOODRAISE_PRIZES_XLSX`, `GOODRAISE_PRIZES_CSV` | Optional initial prize table; workbook takes precedence |
| `GOODRAISE_INGEST_API_KEY` | Server-side key for external ingest |
| `GOODRAISE_GOOGLE_SERVICE_ACCOUNT_JSON` / `_JSON_PATH` | Private Sheets credentials |
| `OPENAI_API_KEY`, `GOODRAISE_AI_MODEL` | Optional question provider; deterministic answers work without a key |
| `GOODRAISE_PRELAUNCH_RESET_ENABLED` | Keep false unless reset operation is deliberately configured |

The old manager/source environment names are accepted through compatibility readers. New setup should use only the names above. Cookie transport uses HTTPS detection/Netlify runtime; local loopback development uses HTTP.

First login for an allowlisted email enters password setup. This preserves the existing onboarding policy; it does not prove mailbox ownership. Keep manager allowlists controlled. There is no unauthenticated local password-reset endpoint in the shared Node application.

## Database workflow

Set the database URL and run:

```sh
npm run db:migrate
```

`db/migrations/001_initial.sql` provides the baseline schema. `002_ingest_validation.sql` aligns the import-batch schema with Node validation counters. The runner locks migration execution, records checksums, applies each migration in a transaction, skips applied files, and fails if an applied file was edited. Add a new numbered SQL file for subsequent changes.

`003_normalize_admin_email.sql` also normalizes existing account emails to trimmed lowercase and adds a storage constraint. It preserves account UUIDs, password hashes and session references. Case/whitespace collisions cause the transaction to fail without merging accounts. The migration has a five-second lock timeout so it fails instead of waiting indefinitely on a busy account table.

Apply migration 003 **before deploying the updated SQL authentication code**. Rehearse against a restored database copy and retain a backup. New code refuses SQL authentication if the constraint is missing, preventing duplicate account seeding against legacy mixed-case records. The previous code already normalizes writes and accepts lowercase values, so the schema change can precede code deployment. If the migration reports a collision, resolve the account ownership explicitly; do not automatically merge credentials or permissions. The GoodRaise Neon production database was migrated on 2026-09-09 after a snapshot and rehearsal; see the [rollout record](database-rollout-2026-09-09.md). Other databases still require their own migration check.

Migrations do not migrate SQLite users, move Blobs into SQL, import donations, or reconcile campaign identities from existing deployments. Existing runtime SQL definitions remain for compatibility; do not rely on request-time DDL for routine deployment. The runtime DDL escape hatch does not apply migration 003.

With a configured database and existing campaign:

```sh
npm run import:campaign -- --file work/source.csv --organization example-org --campaign autumn-drive
```

This calls the same batch ingestion service used by the source pipeline, preserving event identities and updating the dashboard snapshot. The CLI is additive/updating; it does not delete records absent from the CSV. Sheets full-snapshot refresh has a separate replacement policy that preserves manual matches. Browser CSV and comparison uploads are temporary analysis inputs and do not invoke this CLI or persist the ledger.

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
