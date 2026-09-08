# Node.js / React migration record

Implemented on 2026-09-08 at the user's request. This record describes the repository changes and local validation. Production data migration remains a separate step.

## Result

The standard toolchain is Node.js 24, React and TypeScript. Local development, standalone serving and Netlify share `backend/app.ts` and the same business services. Vite builds the frontend; React renders/hydrates the page shell. Python builders, servers, schema/import helpers, verification scripts and dependencies have been removed.

The frontend preserves the public campaign, prizes, rules/privacy, manager login/setup, insights/filters, design, source configuration, CSV/workbook controls, ambassador links and payment handoff. Established interactive behavior remains in the explicitly named `compat/dashboard-controller.js`; this is a platform migration with reused JavaScript, not a complete component rewrite. New TypeScript files use strict checking.

## Performance changes

Manager startup reads the saved dataset instead of forcing an external source refresh before showing data. Navigation binds before network requests finish. Builder settings load before the canonical source configuration, preventing a stale builder source copy from changing the active connector. Source refresh remains available manually and on the configured manager-session timer; hosted schedules remain disabled.

Images are file URLs rather than embedded base64. CSS and JavaScript are separate bundled assets, with the controller dynamically loaded. The generated React HTML shell is about 38 KB versus the earlier 1.24 MB dashboard document. This is a build-artifact comparison, not an end-to-end performance claim. Asset transfer, database/query time, provider latency and browser work still matter.

Auth, repositories and ingestion share one pool capped at four SQL connections per process/function instance. Serverless concurrency can still multiply total connections. Development file writes are serialized and atomic within a single process.

## Generic platform naming

New names use GoodRaise:

- DOM root: `goodraise-root`.
- Session cookie: `goodraise_admin_session`.
- Auth Blob store: `goodraise-auth`.
- Browser draft/preference prefix: `goodraise.`.
- Environment settings: `GOODRAISE_*`.
- Standard commands: `npm run dev`, `npm run build`, `npm start`, `npm run db:migrate`, `npm run import:campaign`.

The default organization logos/story, dated competition rules and hardcoded excluded ambassadors from the original campaign are no longer platform defaults. Campaign-specific exclusions are stored in `goals.excludedAmbassadors` and edited under goals/prizes. Existing campaign media files remain to keep saved URLs valid. Before releasing an existing campaign that relied on the former global prize exclusions, set those names explicitly in its goals/prizes settings; the platform no longer applies another campaign’s policy globally.

## Compatibility and cutover

Browser storage copies old prefixed values only when a new value does not exist. Existing session cookies remain readable, while new logins use the generic cookie. Session-changing responses expire the old browser cookie, preventing it from restoring a previous session after logout. The generic auth store reads legacy records on demand; deletions leave tombstones so old revoked sessions cannot reappear. Manager allowlist/source environment aliases are accepted for transition. Old physical names are confined to compatibility code and migration tests.

Persisted campaign identifiers, source secret handling, scoped URLs, external ingest IDs and ledger keys are retained. PostgreSQL schema migrations use existing table names and add the missing validation counter. The new import CLI calls the canonical batch ingestion pipeline and rebuilds snapshots.

This does not migrate old Python SQLite users into Node auth, move all Blobs data into PostgreSQL, or update a deployed site. Local users previously registered only in SQLite must be allowlisted in Node and set a password there. A production data cutover requires an inventory/rehearsal. Auxiliary audit/rate-limit/job state and non-SQL compatibility modes remain as documented in the [data model](data-model.md).

## Validation

- Node.js 24.20.0 used for the final build and regression validation.
- Production React build, strict TypeScript check and release boundary checks.
- 67 automated domain/API/migration tests pass, including real local HTTP authorization, source-security and storage-concurrency checks.
- Authentication verification across public, protected and scoped routes.
- Disposable PostgreSQL: migrations applied twice; duplicate imports, manual-match idempotency, source replacement preserving manual rows, single-event snapshot update, SQL password setup/read, and reset isolation.
- Browser: public campaign rendering, first-login setup, manager dashboard, campaign selection, designer and request inspection. Saved-data login issues no forced source-refresh request. Direct campaign context honors the requested slug, and unknown campaigns do not fall back to another campaign.
- No live Sheets, external donation transaction or model-provider request was used for these checks.

The [engineering assessment](engineering-assessment.md) lists remaining component, security, storage and scale work. The [development guide](development.md) gives reproducible commands.
