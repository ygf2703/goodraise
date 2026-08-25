# GoodRaise

Campaign intelligence and operations platform for fundraising projects, with public campaign pages, protected manager analytics, explainable intervention models, and deployment support for either a local backend or a Netlify path.

## Project Goal

The app receives campaign export files and turns them into an active dashboard that helps campaign managers:

- analyze donations by date, exact date, hour, hour range, amount, ambassador, and donor
- monitor campaign movement across the actual campaign window
- identify peak activity windows with daily charts and heatmaps
- compare two campaign files and extract summary, facts, critical points, and insights
- display live prize standings based on a prize table and thresholds
- export filtered results for follow-up work
- understand campaign health, momentum, forecast, and who requires intervention now

## Current Capabilities

- Premium blue/yellow executive UI with both campaign and organization logos
- Explainable `GoodRaise Intelligence Layer` with:
  - `Campaign Health Score`
  - `What Needs Attention Now`
  - `Ambassador Intelligence`
  - `Who Should I Contact Now`
  - `Velocity Intelligence`
  - `Campaign Forecast`
  - `Campaign Fingerprint`
- Assistant typography and shared design-system classes across all pages
- Multi-page experience:
  - Public project and donation page
  - Public prizes and competition page
  - Public participation rules page
  - Public privacy page
  - Manager-only admin dashboard
- Fixed dual-brand header with manager status and page navigation
- Public project page with branded hero, flexible story content, configurable image or video, preset donation amounts, donor details, and handoff to an external payment provider
- Manager-side campaign designer for local styling control over colors, typography, hero media, CTAs, and preset donation cards
- Guided multi-step `Campaign Builder` with campaign basics, branding, donation setup, ambassadors, teams, goals, permissions, review, draft autosave, multi-campaign registry, active-campaign switching, and duplicate-campaign flow
- `Campaign Builder` can persist its setup layer in PostgreSQL when `GOODRAISE_DATABASE_URL` is configured, with JSON fallback for local/dev environments without a database
- Ambassador directory upload supports both the compact GoodRaise CSV and the Hebrew registration-form export. Registration records persist per campaign in PostgreSQL, including referral, phone, prior-ambassador status, registration source, age/terms acknowledgements, and registration timestamp. `nickname` is optional when an email exists; GoodRaise derives it from the portion before `@` and prevents duplicate personal-link slugs.
- Public prize page with podium, prize tiers, and live competition summary
- Public campaign snapshot hero with immediate KPI-style status cards
- Daily winners / "Olim LaDeshe" section across the configured campaign schedule
- Public participant view stays open without registration, with a direct manager entry point from the same page
- SaaS-style manager login screen with first-password setup and real session-based auth
- Safe-import behavior: invalid uploads do not replace the active dataset
- File upload for base campaign CSV
- Source-mode switch between manual file upload, a backend-managed external API connection, and Google Sheets synchronization
- Secure admin-side API connector with saved endpoint, method, response format, optional bearer token, custom headers, and JSON field mapping
- Campaign-scoped Google Sheets connector with public CSV mode or service-account mode, checksum-based change detection, and scheduled 2-minute sync into PostgreSQL
- Manager-only manual match entry: adds a clean `הכפלה - שם` donation row to the active campaign ledger and refreshes the dashboard immediately
- One-time prelaunch reset scheduler that can clear campaign donation data before go-live while preserving campaign setup
- Manual pull plus optional timed auto-refresh from the fundraising platform API while managers monitor the campaign
- File upload for comparison CSV
- Campaign-scoped prize management in `Campaign Builder` step "יעדים ופרסים", including a visible Excel/CSV upload that replaces only the active campaign's prize model and persists it with the campaign draft
- Filters for ambassador, project day, exact date, date range, exact hour, hour range, donor name, and amount range
- Local backend with SQLite admin table, first-password setup, login session, and logout
- Manager/user persistence can run from PostgreSQL when `GOODRAISE_DATABASE_URL` is configured, including first-password setup, stored password hashes, and active sessions
- Local backend role metadata with foundation roles for `platform_admin`, `organization_admin`, `campaign_manager`, `analyst`, and `viewer`
- Local backend parity for campaign-scoped `/api/organizations/:orgId/campaigns/:campaignId/*` routes with server-side scope enforcement
- Local password-change flow for authenticated managers
- Local audit log for auth and protected operational actions
- Local runtime health payload for application, persistence, and data-source status
- Local source connector hardening with blocked private/internal targets, redirect validation, timeout, and response-size limits
- Netlify deployment path with Functions-based auth and persistent manager/session storage
- Hosted multi-campaign / multi-organization isolation with campaign-scoped config, source, permissions, and protected datasets
- Hosted runtime health payload and protected dataset verification path
- Public HTML ships only a sanitized public dataset, while full donor-level admin data is loaded after authenticated manager login
- Login hardening with rate limiting, audit events, and stricter deployment security headers
- Manager-only graph mode controls for daily chart, heatmap, and ambassador movement views
- Executive summary cards and KPI blocks
- Grouped control center for data files, time filters, people, amounts, and goals
- Data quality and validation board
- Donor and transaction segmentation
- Ambassador movement view across campaign days
- Heatmap by day and hour
- Live prize board with current winners and next threshold visibility
- Daily winner logic with unique ambassador roll-down when the same ambassador already won another day
- Export of filtered rows to CSV

## Repository Structure

- `work/build_yellow_dashboard.py`
  Dashboard builder script. Generates the interactive HTML output.
- `work/frontend/goodraise-intelligence.js`
  Reusable operational intelligence engine for health, velocity, forecast, priorities, and ambassador status modeling.
- `work/assets/achim-lasemel-logo.png`
  Organization logo for Achim LaSemel.
- `work/assets/osim-tov-betzahov-logo.png`
  Campaign logo asset for the current campaign running on GoodRaise.
- `work/assets/campaign-project-hero.jpeg`
  Default public-facing media asset for the project donation page.
- `work/content/project-page-default.md`
  Default markdown story shown on the public project page.
- Campaign Builder state is persisted server-side through `netlify/lib/campaign-repositories.mjs`, with PostgreSQL as the preferred backing store and a local JSON fallback for environments without a database URL.
- `work/samples/sample-source.csv`
  Synthetic sample dataset for portable builds and CI.
- `work/config/dashboard-access.example.json`
  Example schema for the admin email allowlist.
- `work/dashboard_backend.py`
  Local backend server logic for admin auth, session handling, dashboard delivery, and secured source-API configuration/refresh endpoints.
- `netlify/functions/auth.mjs`
  Netlify Function entrypoint for manager auth, setup, session status, campaign/source configuration persistence, logout, and health checks.
- `netlify/lib/auth-store.mjs`
  Shared auth storage and password/session logic for Netlify Functions, with local file fallback for verification.
- `netlify/lib/campaign-store.mjs`
  Shared campaign-builder persistence and organization-scoped campaign creation/update logic for Netlify Functions.
- `netlify/lib/source-store.mjs`
  Shared source-config persistence plus API / Google Sheets fetch adapters for Netlify Functions.
- `netlify/lib/source-sync.mjs`
  Campaign-scoped source synchronization orchestration, including manual refresh and scheduled Google Sheets sync.
- `netlify/lib/campaign-repositories.mjs`
  Record-oriented hosted persistence boundary for organizations, campaigns, configs, sources, datasets, and migration.
- `netlify/lib/source-security.mjs`
  SSRF and network-hardening rules for external source connectors.
- `netlify.toml`
  Netlify build, publish, functions, and route-rewrite configuration.
- `package.json`
  Node dependencies required for Netlify Blobs-backed auth.
- `scripts/run_dashboard_server.py`
  Starts the local backend and serves the dashboard with session-based auth.
- `scripts/run_dashboard_server.ps1`
  PowerShell helper that runs the backend with the bundled local Python runtime.
- `scripts/verify_netlify_auth.mjs`
  Local verification for the Netlify auth flow.
- `scripts/run_google_sheets_sync_once.mjs`
  Runs one full scheduled-source pass locally against campaigns configured with `google_sheets`.
- `scripts/run_google_sheets_sync_loop.mjs`
  Local loop runner for repeated Google Sheets sync checks every configured interval.
- `scripts/run_prelaunch_reset_once.mjs`
  Runs the prelaunch reset flow once locally, using the local reset config or environment variables.
- `scripts/benchmark_intelligence.mjs`
  Synthetic scale benchmark for the GoodRaise intelligence layer across 1k, 10k, and 100k donation scenarios.
- `scripts/setup_relational_campaign_db.py`
  Creates a relational PostgreSQL schema for GoodRaise and imports a campaign CSV into both raw CSV-parity storage and normalized campaign tables.
- `scripts/verify_repository_hygiene.py`
  Fails if sensitive local/config/data files slip back into git.
- `tests/goodraise-intelligence.test.mjs`
  Automated test coverage for the intelligence engine.
- `tests/multi-campaign-isolation.test.mjs`
  Automated multi-organization / multi-campaign authorization and isolation coverage.
- `tests/source-security.test.mjs`
  Automated source-connector SSRF and unsafe-endpoint coverage.
- `outputs/dashboard-backlog-priorities.md`
  Working backlog and upgrade notes.
- `docs/scorecard-baseline.md`
  Starting scorecard for the 8/10 upgrade program.
- `docs/architecture.md`
  System overview, boundaries, flows, and acquisition-readiness structure.
- `docs/intelligence-model.md`
  Documented GoodRaise product IP for health, velocity, forecast, and intervention logic.
- `docs/scalability.md`
  Current scaling posture, bottlenecks, and benchmark findings.
- `docs/multi-tenancy.md`
  Tenancy model, authorization rules, dataset/source isolation, and threat model.
- `docs/backup-and-recovery.md`
  Current backup/recovery posture and production gaps.
- `docs/production-readiness.md`
  Production checklist, config notes, and release gates.
- `docs/technical-due-diligence.md`
  Technical buyer/integration-facing assessment.
- `docs/final-scorecard.md`
  Final before/after scoring with evidence.
- `docs/go-live-checklist.md`
  Structured go-live checklist with completed repo tasks and external blockers.
- `outputs/yellow-project-dashboard.html`
  Wrapped preview output. Ignored from git.
- `outputs/yellow-project-dashboard-browser.html`
  Browser-friendly output. Ignored from git.

## Data Safety

This repository intentionally does not track live campaign data or generated dashboard outputs that may contain donor information.

Important:

- For a private Google Sheet in `service_account` mode, share the sheet with the configured Google service-account email as a Viewer. Sharing it only with a personal Google account does not grant the server permission to read it.

- Public participant views remain open without registration.
- Admin access is backed by a server-side session cookie.
- Regular users do not sign in. Only predefined managers can enter the admin dashboard from the public participant page.
- First login for each approved manager is a password-setup flow.
- The generated public HTML intentionally hides donor-identifying fields and does not embed the full admin dataset.
- Legacy `netlify/data/admin-dataset.json` is no longer the canonical hosted storage model. Protected hosted datasets are now persisted per campaign and served only after an authenticated admin session.
- In local mode, manager auth is stored in `work/data/dashboard-auth.sqlite3`.
- In local mode, source-API connection settings are stored in `work/data/dashboard-source-config.json`.
- In local mode without PostgreSQL, campaign-builder state falls back to `work/data/dashboard-campaign-config.json` and `work/data/goodraise-platform-dev.json`.
- When `GOODRAISE_DATABASE_URL` is configured, campaign-builder state is stored in PostgreSQL tables:
  - `goodraise.organizations`
  - `goodraise.campaigns`
  - `goodraise.campaign_configs`
  - `goodraise.campaign_sources`
  - `goodraise.campaign_datasets`
- When `GOODRAISE_DATABASE_URL` is configured, manager auth is also stored in PostgreSQL tables:
  - `goodraise.admin_users`
  - `goodraise.admin_sessions`
- In local mode, audit events are appended to `work/data/dashboard-audit-log.jsonl`.
- In Netlify mode, manager auth is stored through Netlify Functions plus Netlify Blobs persistence.
- In Netlify mode, campaign-builder and source-API configuration are also persisted server-side and are not exposed in the public app shell.
- If PostgreSQL is available in Netlify, the same campaign setup records use PostgreSQL as the source of truth instead of the local JSON/blob development store.
- Netlify deploys include CSP, frame protection, content-type hardening, referrer policy, and basic auth rate limiting.
- External real-time ingestion into PostgreSQL is available through a campaign-scoped `POST /api/organizations/:orgId/campaigns/:campaignId/ingest` endpoint protected by an API key.
- Authenticated campaign managers can import ambassador registration rows through `POST /api/organizations/:orgId/campaigns/:campaignId/ambassadors/import`; the import is campaign-scoped and deduplicates by email or nickname.
- Google Sheets private access can be supplied through `GOODRAISE_GOOGLE_SERVICE_ACCOUNT_JSON` or `GOODRAISE_GOOGLE_SERVICE_ACCOUNT_JSON_PATH`. Public published sheets can work without credentials through CSV export mode.
- Prelaunch reset scheduling can be configured through `work/config/prelaunch-reset.local.json` locally or the matching `GOODRAISE_PRELAUNCH_RESET_*` environment variables in deployment.
- Recommended local override file: `work/config/dashboard-access.local.json` (ignored from git).
- Recommended local ingest key file: `work/config/goodraise-ingest.local.json` (ignored from git). If no ingest key is configured in env, the local backend creates this file automatically on startup and loads the key from it.
- Real manager emails are intentionally excluded from tracked source. Supply them through `work/config/dashboard-access.local.json` locally or `YELLOW_DASHBOARD_MANAGER_EMAILS` in deployment.

Ignored from git:

- `work/source.csv`
- `work/prizes.xlsx`
- `work/data/`
- `netlify/data/`
- `node_modules/`
- `outputs/index.html`
- `outputs/yellow-project-dashboard.html`
- `outputs/yellow-project-dashboard-browser.html`

## Local Run

Build only:

```powershell
& "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" work/build_yellow_dashboard.py
& "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" scripts/verify_dashboard_release.py
& "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" scripts/verify_repository_hygiene.py
& "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" --test tests/goodraise-intelligence.test.mjs
& "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" --test tests/source-security.test.mjs
& "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" --test tests/multi-campaign-isolation.test.mjs
& "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" scripts/benchmark_intelligence.mjs
```

Run the local backend with admin auth:

```powershell
.\scripts\run_dashboard_server.ps1
```

After startup, open:

- `http://127.0.0.1:8767/`

Optional browser preview with shared auth backend:

- `http://127.0.0.1:8766/yellow-project-dashboard-browser.html`

Notes:

- If `work/source.csv` is missing, the build falls back to `work/samples/sample-source.csv`.
- If the Codex visualize renderer is unavailable, the script still produces standalone HTML outputs.
- Release verification is available through `scripts/verify_dashboard_release.py`.
- The backend seeds the admin table from `work/config/dashboard-access.local.json` or `YELLOW_DASHBOARD_MANAGER_EMAILS`.
- On first login with an approved email, the manager is prompted to define a personal password.
- The preview on `8766` can authenticate against the local backend on `8767` through the configured local cross-origin auth flow.
- If you place the local backend behind HTTPS, set `YELLOW_DASHBOARD_SECURE_COOKIES=1` to force `Secure` cookies.
- The admin Control Center now supports switching the active source from file mode to API mode, saving the connector, and pulling data directly from the fundraising platform.
- The same Control Center now supports a `Google Sheets` source mode, with sheet link / spreadsheet ID / gid / sheet / range settings saved per campaign.
- The admin runtime now returns role metadata and session-expiry metadata through `/api/auth/status`.
- The local backend supports manager password change and emits audit events for protected actions.
- For local source-sync tests, you can run:

```powershell
& "$env:USERPROFILE\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\bin\\node.exe" scripts/run_google_sheets_sync_once.mjs
& "$env:USERPROFILE\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\bin\\node.exe" scripts/run_google_sheets_sync_loop.mjs
& "$env:USERPROFILE\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\bin\\node.exe" scripts/run_prelaunch_reset_once.mjs
```

## Netlify Deployment

This repository now includes the minimum files Netlify needs in order to actually show the app and keep manager passwords/sessions after deploy:

- `netlify.toml` runs the Python build and publishes `outputs/`
- the build now creates `outputs/index.html`
- `netlify/functions/auth.mjs` serves:
  - `/api/health`
  - `/api/admin/dataset`
  - `/api/admin/campaign-config`
  - `/api/admin/source-config`
  - `/api/admin/source-refresh`
  - `/api/auth/status`
  - `/api/auth/login`
  - `/api/auth/setup`
  - `/api/auth/logout`
- `netlify/functions/google-sheets-sync.mjs` runs every 2 minutes and syncs all campaigns whose source mode is `google_sheets` and `syncEnabled=true`
- `netlify/functions/prelaunch-reset.mjs` runs every 5 minutes and executes a one-time reset when the configured launch-reset window arrives
- the build writes the protected admin dataset to `netlify/data/admin-dataset.json` for authenticated manager fetches
- manager passwords and sessions are persisted with Netlify Blobs
- login attempts are rate-limited and written to a lightweight audit trail in the auth store
- intelligence tests run in CI before merge
- `/admin`, `/rules`, and `/privacy` are rewritten to the dashboard app shell

Before the first real deploy, verify in Netlify:

1. Build command is taken from `netlify.toml`.
2. Publish directory is `outputs`.
3. Functions directory is `netlify/functions`.
4. Define `YELLOW_DASHBOARD_MANAGER_EMAILS` in the Netlify UI as a JSON array or comma-separated string.
5. Keep the default security headers from `netlify.toml`, and deploy only on HTTPS domains.

Useful local verification commands:

## Google Sheets Sync

Google Sheets sync is now modeled as a campaign-scoped source provider.

Recommended flow for the next project:

1. Set the campaign source mode to `Google Sheets`.
2. Save either:
   - a published/public Google Sheets link
   - or a spreadsheet ID plus `service_account` mode for a private sheet
3. Keep the Google sheet columns aligned with the known CSV field names already used by GoodRaise.
4. Let the scheduled sync pull every 2 minutes into PostgreSQL.
5. The dashboard then reflects the data from the stored campaign dataset snapshot, which is rebuilt from the database-backed sync process.

Important behavior:

- the sync is campaign-scoped, not global
- unchanged sheet content is skipped by checksum
- duplicate donations are still blocked by the existing campaign-scoped dedupe logic in PostgreSQL
- for the upcoming project, this flow replaces the current external live-ingest pull as the primary refresh source

## Prelaunch Reset

GoodRaise can now clear campaign donation data automatically before a campaign goes live, without deleting the campaign setup itself.

Configuration options:

- local file: `work/config/prelaunch-reset.local.json`
- or deployment env vars:
  - `GOODRAISE_PRELAUNCH_RESET_ENABLED`
  - `GOODRAISE_PRELAUNCH_RESET_AT`
  - `GOODRAISE_PRELAUNCH_RESET_OWNER_EMAIL`
  - `GOODRAISE_PRELAUNCH_RESET_TARGET`
  - `GOODRAISE_PRELAUNCH_RESET_START_DATE`
  - `GOODRAISE_PRELAUNCH_RESET_ONLY_LIVE`

Behavior:

- clears relational donation data, import batches, raw imported rows, and the protected dataset snapshot
- preserves campaign branding, permissions, goals, ambassadors configured in Campaign Builder, and other setup metadata
- clears the stored Google Sheets sync checksum/status so the first live sync starts clean
- runs once only and stores a runtime marker so it does not wipe the campaign again on later scheduler ticks
- if no explicit target is defined and the scheduler finds more than one matching campaign, it skips rather than resetting the wrong campaign

## Relational PostgreSQL Import

GoodRaise can also persist campaign exports into a relational PostgreSQL database.

What the importer does:

- preserves the CSV structure in `goodraise.transactions_csv_raw` with the exact source columns
- creates normalized relational tables for `organizations`, `campaigns`, `import_batches`, `donors`, `ambassadors`, `rewards`, and `transactions`
- links every imported transaction to an organization, campaign, donor, ambassador, reward, and import batch where relevant
- shares the same database with the campaign setup layer, so builder configuration and transactional campaign data can live under one relational source of truth

The same database can now also persist the GoodRaise setup layer in:

- `goodraise.organizations`
- `goodraise.campaigns`
- `goodraise.campaign_configs`
- `goodraise.campaign_sources`
- `goodraise.campaign_datasets`

Required environment variable:

```powershell
$env:GOODRAISE_DATABASE_URL="postgresql://username:password@host/database?sslmode=require"
$env:GOODRAISE_INGEST_API_KEY="replace-with-a-long-random-secret"
```

Install the Python dependencies:

```powershell
& "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" -m pip install -r requirements.txt
```

Run the importer:

```powershell
& "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" scripts/setup_relational_campaign_db.py `
  --csv "C:\path\to\campaign.csv" `
  --organization-slug "default-org" `
  --organization-name "GoodRaise Imported Organization" `
  --campaign-slug "imported-campaign" `
  --campaign-name "Imported Campaign" `
  --campaign-status "completed" `
  --imported-by "codex"
```

The script prints a JSON summary with the created organization, campaign, import batch, and campaign-level row counts.

## Real-Time External Ingestion Endpoint

GoodRaise can receive a single external donation row in real time and save it into the same relational PostgreSQL schema.

Endpoint:

```text
POST /api/organizations/:organizationId/campaigns/:campaignId/ingest
```

Authentication:

- header `X-GoodRaise-API-Key: <your-secret>`
- or `Authorization: Bearer <your-secret>`

Notes:

- `organizationId` and `campaignId` may be either the stable IDs or the slugs stored in PostgreSQL
- the route writes to both `goodraise.transactions` and `goodraise.transactions_csv_raw`
- duplicate records are blocked at the database layer through a campaign-scoped canonical event key, even if the same donation arrives later through a different source such as CSV import plus live event ingestion

Example `POST`:

```powershell
$headers = @{
  "Content-Type" = "application/json"
  "X-GoodRaise-API-Key" = "replace-with-a-long-random-secret"
}

$body = @"
{
  "sourceLabel": "giveback-live",
  "requestId": "evt-20260818-0001",
  "record": {
    "id": "live-10001",
    "created_at": "18/08/26 18:45",
    "full_name": "ישראל ישראלי",
    "total": "360.00",
    "currencyname": "ILS",
    "phone": "0501234567",
    "email": "donor@example.org",
    "Ambassador name": "נועם פרוסטיג",
    "Ambassador email": "noamfrostig@gmail.com",
    "city": "תל אביב",
    "charged_success": "true",
    "charge_result": "000",
    "direct_debit": "false"
  }
}
"@

Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:8767/api/organizations/goodraise-default/campaigns/osim-tov-betzahov-pesach-2026/ingest" `
  -Headers $headers `
  -Body $body
```

Successful response includes:

- organization and campaign identity
- created import-batch ID
- transaction ID
- campaign-scoped source transaction key

```powershell
& "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" work/build_yellow_dashboard.py
& "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" scripts/verify_dashboard_release.py
& "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" scripts/verify_netlify_auth.mjs
& "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" --test tests/goodraise-intelligence.test.mjs
& "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" --test tests/source-security.test.mjs
& "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" --test tests/multi-campaign-isolation.test.mjs
& "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" --test tests/local-backend-scope.test.mjs
& "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" scripts/benchmark_intelligence.mjs
& "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" scripts/verify_repository_hygiene.py
```

## Repository

- [ygf2703/goodraise](https://github.com/ygf2703/goodraise)

## Verified Upgrade Status

- Baseline and final scorecards exist and are documented
- Intelligence layer is modular and tested
- Release verification passes locally
- Netlify auth verification passes locally
- Synthetic scale benchmark passes locally

## Recommended Next Steps

- Complete hosted password reset and recovery flow
- Extend hosted RBAC enforcement across all protected config stores
- Move long-term persistence from transitional file/blob storage to a structured database layer
- Add external monitoring and operational alerting
- Add deeper donor analysis and year-over-year normalized benchmarking
