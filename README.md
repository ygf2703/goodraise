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
- Public participant view stays open without registration, with a direct manager entry point from the same page
- SaaS-style manager login screen for local pilot access
- Safe-import behavior: invalid uploads do not replace the active dataset
- File upload for base campaign CSV
- File upload for comparison CSV
- File upload for prize model from Excel or CSV
- Filters for ambassador, project day, exact date, date range, exact hour, hour range, donor name, and amount range
- Admin login gate with predefined manager emails and password-based access for local pilot use
- Manager-only graph mode controls for daily chart, heatmap, and ambassador movement views
- Executive summary cards and KPI blocks
- Grouped control center for data files, time filters, people, amounts, and goals
- Data quality and validation board
- Donor and transaction segmentation
- Ambassador movement view across campaign days
- Heatmap by day and hour
- Live prize board with current winners and next threshold visibility
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
  Example admin access config.
- `outputs/dashboard-backlog-priorities.md`
  Working backlog and upgrade notes.
- `docs/production-readiness.md`
  Production checklist, config notes, and release gates.
- `outputs/yellow-project-dashboard.html`
  Wrapped preview output. Ignored from git.
- `outputs/yellow-project-dashboard-browser.html`
  Browser-friendly output. Ignored from git.

## Data Safety

This repository intentionally does not track live campaign data or generated dashboard outputs that may contain donor information.

Important:

- The current admin access layer is a local pilot gate implemented in the client.
- Regular users do not sign in. Only predefined managers can enter the admin dashboard from the public participant page.
- Before any public deployment, authentication must move to a secure server-side flow.
- Recommended local override file: `work/config/dashboard-access.local.json` (ignored from git).

Ignored from git:

- `work/source.csv`
- `work/prizes.xlsx`
- `outputs/yellow-project-dashboard.html`
- `outputs/yellow-project-dashboard-browser.html`

## Local Run

Current local build command:

```powershell
python work/build_yellow_dashboard.py
```

After build, open:

- `outputs/yellow-project-dashboard-browser.html`

Notes:

- If `work/source.csv` is missing, the build falls back to `work/samples/sample-source.csv`.
- If the Codex visualize renderer is unavailable, the script still produces standalone HTML outputs.

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
- Move from file-based local mode to a structured persistent data layer
- Prepare deployment flow after design and product specification are finalized
