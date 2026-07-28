# Production Readiness

This project is still a campaign dashboard that can run locally, but it now also includes a real Netlify deployment path for manager authentication and page delivery.

## Implemented In This Iteration

- Relative and environment-driven build paths in `work/build_yellow_dashboard.py`
- Fallback local sample dataset for safe out-of-the-box builds
- Optional external admin access config via `work/config/dashboard-access.local.json`
- Local backend auth with SQLite manager table and server-side session cookie
- First-password setup flow for approved manager emails
- Local backend runner scripts for browser delivery through a single origin
- Netlify build configuration with a published `index.html`
- Netlify Functions auth endpoint mapped to `/api/auth/*`
- Netlify Blobs persistence for approved manager passwords and sessions after deploy
- Browser-friendly standalone HTML output even when Codex render tooling is unavailable
- GitHub Actions build workflow
- Release verification script for generated HTML outputs
- Local verification script for the Netlify auth flow
- Stronger documentation for local-to-production handoff

## Recommended Release Gates

Before a real public launch, complete the following:

1. Add password reset / recovery, audit logging, and stronger operational controls.
2. Add server-side authorization and role separation beyond the current single manager tier.
3. Replace file-only ingestion with a persistent campaign data source when live sync is required.
4. Approve the legal text for rules and privacy.
5. Add error monitoring and deployment health checks.
6. Define backup, retention, and deletion policies for donor data.
7. Run a full staging QA pass with real structure and sanitized data.
8. Configure the final Netlify project settings and validate the first deployed manager setup flow.

## Local Config

Optional local admin config file:

- `work/config/dashboard-access.local.json`
  Optional local manager override for the Python backend.

Optional Netlify runtime override:

- `YELLOW_DASHBOARD_MANAGER_EMAILS`
  JSON array or comma-separated manager email list for deployed auth.

Expected shape:

```json
{
  "managerEmails": ["manager@example.org"]
}
```

Environment overrides are also supported:

- `YELLOW_DASHBOARD_MANAGER_EMAILS`
- `YELLOW_DASHBOARD_AUTH_DB_PATH`
- `YELLOW_DASHBOARD_SOURCE_CSV`
- `YELLOW_DASHBOARD_PRIZES_XLSX`
- `YELLOW_DASHBOARD_PRIZES_CSV`
- `YELLOW_DASHBOARD_OUTPUT_DIR`
- `YELLOW_DASHBOARD_RENDER_SCRIPT`
- `YELLOW_DASHBOARD_PYTHON_EXE`

## Build Outputs

- `outputs/yellow-project-dashboard-browser.html`
  Standalone browser-ready output.
- `outputs/index.html`
  Netlify publish entrypoint generated from the same dashboard build.
- `outputs/yellow-project-dashboard.html`
  Rendered shell output when the Codex visualize renderer exists, otherwise a standalone fallback copy.
