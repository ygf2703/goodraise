# Production Readiness

This project is still a local-first campaign dashboard, but it now includes a cleaner path toward production.

## Implemented In This Iteration

- Relative and environment-driven build paths in `work/build_yellow_dashboard.py`
- Fallback local sample dataset for safe out-of-the-box builds
- Optional external admin access config via `work/config/dashboard-access.local.json`
- Browser-friendly standalone HTML output even when Codex render tooling is unavailable
- GitHub Actions build workflow
- Stronger documentation for local-to-production handoff

## Recommended Release Gates

Before a real public launch, complete the following:

1. Move admin authentication to a secure backend flow.
2. Replace file-only ingestion with a persistent data source such as Notion or a database.
3. Add server-side authorization, audit logs, and role separation.
4. Approve the legal text for rules and privacy.
5. Add error monitoring and deployment health checks.
6. Define backup, retention, and deletion policies for donor data.
7. Run a full staging QA pass with real structure and sanitized data.

## Local Config

Optional local admin config file:

- `work/config/dashboard-access.local.json`

Expected shape:

```json
{
  "managerEmails": ["manager@example.org"],
  "adminPasswordHash": "sha256-hash"
}
```

Environment overrides are also supported:

- `YELLOW_DASHBOARD_MANAGER_EMAILS`
- `YELLOW_DASHBOARD_ADMIN_PASSWORD_HASH`
- `YELLOW_DASHBOARD_SOURCE_CSV`
- `YELLOW_DASHBOARD_PRIZES_XLSX`
- `YELLOW_DASHBOARD_PRIZES_CSV`
- `YELLOW_DASHBOARD_OUTPUT_DIR`
- `YELLOW_DASHBOARD_RENDER_SCRIPT`
- `YELLOW_DASHBOARD_PYTHON_EXE`

## Build Outputs

- `outputs/yellow-project-dashboard-browser.html`
  Standalone browser-ready output.
- `outputs/yellow-project-dashboard.html`
  Rendered shell output when the Codex visualize renderer exists, otherwise a standalone fallback copy.
