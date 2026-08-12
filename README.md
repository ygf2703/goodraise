# GoodRaise

Campaign intelligence and operations platform for fundraising projects, with public campaign pages, protected manager analytics, explainable intervention models, and deployment support for either a local backend or a Netlify path.

## Project Goal

The app receives campaign export files and turns them into an active dashboard that helps campaign managers:

- analyze donations by date, exact date, hour, hour range, amount, ambassador, and donor
- monitor campaign movement across the ten campaign days
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
- Guided multi-step `Campaign Builder` with campaign basics, branding, donation setup, ambassadors, teams, goals, permissions, review, draft autosave, and duplicate-campaign flow
- Ambassador directory upload (`full_name`, `email`, `phone`, `nickname`) with personal GoodRaise-style links in the format `https://goodraise.netlify.app/{projectSlug}/{nickname}`
- Public prize page with podium, prize tiers, and live competition summary
- Public campaign snapshot hero with immediate KPI-style status cards
- Daily winners / "Olim LaDeshe" section across the 10 campaign days
- Public participant view stays open without registration, with a direct manager entry point from the same page
- SaaS-style manager login screen with first-password setup and real session-based auth
- Safe-import behavior: invalid uploads do not replace the active dataset
- File upload for base campaign CSV
- Source-mode switch between manual file upload and a backend-managed external API connection
- Secure admin-side API connector with saved endpoint, method, response format, optional bearer token, custom headers, and JSON field mapping
- Manual pull plus optional timed auto-refresh from the fundraising platform API while managers monitor the campaign
- File upload for comparison CSV
- File upload for prize model from Excel or CSV
- Filters for ambassador, project day, exact date, date range, exact hour, hour range, donor name, and amount range
- Local backend with SQLite admin table, first-password setup, login session, and logout
- Local backend role metadata with foundation roles for `platform_admin`, `organization_admin`, `campaign_manager`, `analyst`, and `viewer`
- Local password-change flow for authenticated managers
- Local audit log for auth and protected operational actions
- Local runtime health payload for application, persistence, and data-source status
- Netlify deployment path with Functions-based auth and persistent manager/session storage
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
- Ambassador link generation is configured from the manager-side Design & Media tab and stored locally in the browser until a backend persistence layer is added.
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
  Shared campaign-builder configuration persistence for Netlify Functions, with local file fallback for development.
- `netlify/lib/source-store.mjs`
  Shared source-API config persistence and protected refresh logic for Netlify Functions.
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
- `scripts/benchmark_intelligence.mjs`
  Synthetic scale benchmark for the GoodRaise intelligence layer across 1k, 10k, and 100k donation scenarios.
- `scripts/verify_repository_hygiene.py`
  Fails if sensitive local/config/data files slip back into git.
- `tests/goodraise-intelligence.test.mjs`
  Automated test coverage for the intelligence engine.
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

- Public participant views remain open without registration.
- Admin access is backed by a server-side session cookie.
- Regular users do not sign in. Only predefined managers can enter the admin dashboard from the public participant page.
- First login for each approved manager is a password-setup flow.
- The generated public HTML intentionally hides donor-identifying fields and does not embed the full admin dataset.
- The full admin dataset is generated into `netlify/data/admin-dataset.json`, is ignored from git, and is served only after an authenticated admin session.
- In local mode, manager auth is stored in `work/data/dashboard-auth.sqlite3`.
- In local mode, source-API connection settings are stored in `work/data/dashboard-source-config.json`.
- In local mode, campaign-builder state is stored in `work/data/dashboard-campaign-config.json`.
- In local mode, audit events are appended to `work/data/dashboard-audit-log.jsonl`.
- In Netlify mode, manager auth is stored through Netlify Functions plus Netlify Blobs persistence.
- In Netlify mode, campaign-builder and source-API configuration are also persisted server-side and are not exposed in the public app shell.
- Netlify deploys include CSP, frame protection, content-type hardening, referrer policy, and basic auth rate limiting.
- Recommended local override file: `work/config/dashboard-access.local.json` (ignored from git).
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
- The admin runtime now returns role metadata and session-expiry metadata through `/api/auth/status`.
- The local backend supports manager password change and emits audit events for protected actions.

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

```powershell
& "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" work/build_yellow_dashboard.py
& "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" scripts/verify_dashboard_release.py
& "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" scripts/verify_netlify_auth.mjs
& "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" --test tests/goodraise-intelligence.test.mjs
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
- Add explicit multi-campaign selector and organization-scoped management UI
- Move long-term persistence from transitional file/blob storage to a structured database layer
- Add external monitoring and operational alerting
- Add deeper donor analysis and year-over-year normalized benchmarking
