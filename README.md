# Osim Tov BeTzahov

Interactive local-first dashboard for campaign management, donation analysis, ambassador tracking, prize visibility, and file-to-file comparison.

## Project Goal

The app receives campaign export files and turns them into an active dashboard that helps campaign managers:

- analyze donations by date, exact date, hour, hour range, amount, ambassador, and donor
- monitor campaign movement across the ten campaign days
- identify peak activity windows with daily charts and heatmaps
- compare two campaign files and extract summary, facts, critical points, and insights
- display live prize standings based on a prize table and thresholds
- export filtered results for follow-up work

## Current Capabilities

- Premium blue/yellow executive UI with both campaign and organization logos
- Assistant typography and shared design-system classes across all pages
- Multi-page experience:
  - Public prizes and competition page
  - Public participation rules page
  - Public privacy page
  - Manager-only admin dashboard
- Sticky dual-brand header with manager status and page navigation
- Public prize page with podium, prize tiers, and live competition summary
- Public campaign snapshot hero with immediate KPI-style status cards
- Daily winners / "Olim LaDeshe" section across the 10 campaign days
- Public participant view stays open without registration, with a direct manager entry point from the same page
- SaaS-style manager login screen with real local backend auth
- Safe-import behavior: invalid uploads do not replace the active dataset
- File upload for base campaign CSV
- File upload for comparison CSV
- File upload for prize model from Excel or CSV
- Filters for ambassador, project day, exact date, date range, exact hour, hour range, donor name, and amount range
- Local backend with SQLite admin table, first-password setup, login session, and logout
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
- `work/assets/achim-lasemel-logo.png`
  Organization logo for Achim LaSemel.
- `work/assets/osim-tov-betzahov-logo.png`
  Campaign logo for Osim Tov BeTzahov.
- `work/samples/sample-source.csv`
  Synthetic sample dataset for portable builds and CI.
- `work/config/dashboard-access.example.json`
  Example admin email allowlist config.
- `work/dashboard_backend.py`
  Local backend server logic for admin auth, session handling, and dashboard delivery.
- `scripts/run_dashboard_server.py`
  Starts the local backend and serves the dashboard with session-based auth.
- `scripts/run_dashboard_server.ps1`
  PowerShell helper that runs the backend with the bundled local Python runtime.
- `outputs/dashboard-backlog-priorities.md`
  Working backlog and upgrade notes.
- `docs/production-readiness.md`
  Production checklist, config notes, and release gates.
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
- Admin access is now backed by a local SQLite database and a server-side session cookie.
- Regular users do not sign in. Only predefined managers can enter the admin dashboard from the public participant page.
- First login for each approved manager is a password-setup flow.
- Before any public deployment, this local backend must still be hardened with HTTPS, managed secrets, reset/recovery flow, and production hosting controls.
- Recommended local override file: `work/config/dashboard-access.local.json` (ignored from git).

Ignored from git:

- `work/source.csv`
- `work/prizes.xlsx`
- `work/data/`
- `outputs/yellow-project-dashboard.html`
- `outputs/yellow-project-dashboard-browser.html`

## Local Run

Build only:

```powershell
& "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" work/build_yellow_dashboard.py
& "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" scripts/verify_dashboard_release.py
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
- The backend seeds the admin table from `work/config/dashboard-access.local.json` or the built-in manager list.
- On first login with an approved email, the manager is prompted to define a personal password.
- The preview on `8766` can authenticate against the local backend on `8767` through the configured local cross-origin auth flow.

## Git Workflow

From July 28, 2026 onward, every upgrade should follow this flow:

1. Implement locally.
2. Verify the dashboard builds successfully.
3. Commit only safe code and assets.
4. Push to `main` in `ygf2703/osimtovbetzahov`.

Repository:

- [ygf2703/osimtovbetzahov](https://github.com/ygf2703/osimtovbetzahov)

## Recommended Next Steps

- Add year-over-year comparison mode by campaign day and hour
- Add alerting for slow hours, failed charges, and ambassador drop-offs
- Add target forecasting and end-of-campaign projection
- Add deeper donor analysis: new vs returning, large donors, retention
- Add password reset / recovery flow and role-based authorization
- Move from file-based local mode to a structured persistent data layer
- Prepare deployment flow after design and product specification are finalized
