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

- Blue/yellow branded dashboard with the Achim LaSemel logo
- File upload for base campaign CSV
- File upload for comparison CSV
- File upload for prize model from Excel or CSV
- Filters for ambassador, project day, exact date, date range, exact hour, hour range, donor name, and amount range
- Executive summary cards and KPI blocks
- Data quality and validation board
- Donor and transaction segmentation
- Ambassador movement view across campaign days
- Heatmap by day and hour
- Live prize board with current winners and next threshold visibility
- Export of filtered rows to CSV

## Repository Structure

- `work/build_yellow_dashboard.py`
  Dashboard builder script. Generates the interactive HTML output.
- `work/brand-logo.png`
  Desktop branding asset.
- `outputs/dashboard-backlog-priorities.md`
  Working backlog and upgrade notes.
- `outputs/yellow-project-dashboard.html`
  Wrapped preview output. Ignored from git.
- `outputs/yellow-project-dashboard-browser.html`
  Browser-friendly output. Ignored from git.

## Data Safety

This repository intentionally does not track live campaign data or generated dashboard outputs that may contain donor information.

Ignored from git:

- `work/source.csv`
- `work/prizes.xlsx`
- `outputs/yellow-project-dashboard.html`
- `outputs/yellow-project-dashboard-browser.html`

## Local Run

Current local build command:

```powershell
& "C:\Users\noamf\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" work/build_yellow_dashboard.py
```

After build, open:

- `outputs/yellow-project-dashboard-browser.html`

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
