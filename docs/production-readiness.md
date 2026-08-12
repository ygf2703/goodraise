# Production Readiness

This project is still a campaign dashboard that can run locally, but it now also includes a real Netlify deployment path for manager authentication and page delivery.

## Implemented In This Iteration

- Relative and environment-driven build paths in `work/build_yellow_dashboard.py`
- Fallback local sample dataset for safe out-of-the-box builds
- Optional local admin access config via `work/config/dashboard-access.local.json`
- Local backend auth with SQLite manager table and server-side session cookie
- First-password setup flow for approved manager emails
- Local backend runner scripts for browser delivery through a single origin
- Netlify build configuration with a published `index.html`
- Netlify Functions auth endpoint mapped to `/api/auth/*`
- Netlify Blobs persistence for approved manager passwords and sessions after deploy
- Public dashboard output sanitized so donor-identifying fields are not embedded in the public HTML payload
- Protected admin dataset generated separately and fetched only after authenticated manager login
- Auth rate limiting and lightweight audit-event persistence for the Netlify login flow
- Security headers added for Netlify delivery and local backend responses
- Browser-friendly standalone HTML output even when Codex render tooling is unavailable
- GitHub Actions build workflow
- Release verification script for generated HTML outputs
- Local verification script for the Netlify auth flow
- Repository hygiene verification for ignored data/config paths
- Stronger documentation for local-to-production handoff
- Explainable GoodRaise Intelligence Layer separated into `work/frontend/goodraise-intelligence.js`
- Synthetic intelligence scale benchmarks for `1,000`, `10,000`, and `100,000` donations
- Local backend role metadata and role-aware access gates for protected manager actions
- Structured local audit log in `work/data/dashboard-audit-log.jsonl`
- Runtime health payload for the local backend and the Netlify auth function
- Manager password-change support in the local backend

## Recommended Release Gates

Before a real public launch, complete the following:

1. Add a real password recovery flow for hosted deployments.
2. Complete server-side role enforcement across every hosted persistence path, not only the local backend.
3. Replace transitional file/blob persistence with a structured database when live multi-organization rollout begins.
4. Approve the legal text for rules, privacy, retention, and deletion.
5. Add external monitoring and alerting around health, auth failures, and deployment issues.
6. Validate backup and restore drills for hosted state.
7. Run a full staging QA pass with sanitized data and real manager onboarding.
8. Configure final Netlify secrets and validate the deployed first-login flow end-to-end.

## Local Config

Optional local admin config file:

- `work/config/dashboard-access.local.json`
  Optional local manager override for the Python backend.

Optional Netlify runtime override:

- `YELLOW_DASHBOARD_MANAGER_EMAILS`
  JSON array or comma-separated manager email list for deployed auth.

The repository intentionally does not keep real manager emails in tracked source. Local development should use the ignored `work/config/dashboard-access.local.json` file, and deployed environments should use `YELLOW_DASHBOARD_MANAGER_EMAILS`.

Expected shape:

```json
{
  "managerEmails": ["manager@example.org"]
}
```

Environment overrides are also supported:

- `YELLOW_DASHBOARD_MANAGER_EMAILS`
- `YELLOW_DASHBOARD_AUTH_DB_PATH`
- `YELLOW_DASHBOARD_SECURE_COOKIES`
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
- `netlify/data/admin-dataset.json`
  Protected admin-only dataset generated during build, bundled for authenticated backend access, and ignored from git. Never commit real donor data here.

## Verified Locally On 2026-08-12

Commands executed:

```powershell
& "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" -m py_compile work\build_yellow_dashboard.py work\dashboard_backend.py
& "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" scripts\verify_dashboard_release.py
& "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" --test tests\goodraise-intelligence.test.mjs
& "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" scripts\benchmark_intelligence.mjs
```

Results:

- Python compile: passed
- Release verification: passed
- Intelligence test suite: passed
- Intelligence scale benchmark: passed
