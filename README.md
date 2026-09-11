# GoodRaise

GoodRaise is a platform for organizations running fundraising campaigns: campaign pages, ambassador links and prizes, manager dashboards, source imports, campaign intelligence, and a public archive of completed campaigns. Private project pages require an approved account; completed campaign summaries are also public and read-only.

The application uses **one Node.js backend and one React frontend**. TypeScript covers the React components, application/API boundary, database pool, and new tooling. Existing JavaScript services and campaign controls are reused. Python is no longer required to build, run, test, or import data.

## Start locally

Use Node.js 24 (`.nvmrc`; validated with 24.20.0).

```sh
npm ci
cp .env.example .env
# Set GOODRAISE_MANAGER_EMAILS in .env to the initial authorized site admins.
npm run dev
```

Open [http://127.0.0.1:8767](http://127.0.0.1:8767) for the Hebrew landing page, also available at `/goodraise/`. Its template is `work/goodraise-landing.html`; placeholder copy and image areas can be replaced there. React and the API share this origin. `/start`, `/login`, `/admin`, `/admin/users`, `/admin/applications`, `/campaigns`, `/rules`, `/privacy`, `/accessibility`, `/prizes`, campaign slugs, and existing query-based campaign and ambassador links load directly into the application.

The build writes the landing page to `dist/index.html` as the default homepage. The React application shell is `dist/app.html`; application routes rewrite to this file. Legacy campaign query links at `/` and `/index.html` use a query-aware rewrite to preserve their campaign and ambassador context.

All pages share the landing-page header and footer, including direct links to the terms, privacy policy, and accessibility statement. The [accessibility implementation record](docs/accessibility.md) maps the current baseline and pre-launch gaps to the official Israeli guidance. See the [navigation migration map](docs/navigation-migration.md) for the existing destinations retained during the gradual page migration.

Accounts cannot self-register. A site admin approves the email and assigns one or more organization/campaign memberships; the user's first login then enters password setup. `/admin` opens the assigned-project selector when there are multiple projects, opens the only project directly when there is one, and shows a clear no-project state when there are none. Active and completed projects are separated. Site admins manage approvals and memberships at `/admin/users`.

Anyone may submit the one-page campaign application at `/start`. It creates only a pending application. The application enters `/admin/applications` and triggers the site-admin notification only after the applicant verifies their email. Approval creates or selects the organization, opens an isolated draft campaign, approves the applicant account with `organization_admin` access, and emails the first-login link. No payment-provider credentials or exact campaign timing are collected publicly.

Roles are scoped per membership: `viewer`, `analyst`, `campaign_manager`, and organization-wide `organization_admin`; `platform_admin` is global. One account can have different roles in different organizations or projects. Without a database URL, the same Node services use local JSON files for a development/demo dataset. PostgreSQL is required for ledger ingestion, manual contributions, and relational ambassador registration imports. There is no separate local backend implementation.

## PostgreSQL

Set `GOODRAISE_DATABASE_URL` in `.env`, then initialize or upgrade the schema:

```sh
npm run db:migrate
```

Migrations are ordered, checksummed, and transactional. They do not transfer deployed Blobs/SQLite data. An existing campaign can receive a CSV through the canonical Node ingestion pipeline:

```sh
npm run import:campaign -- --file work/source.csv --organization example-org --campaign autumn-drive
```

The import updates the ledger and its dashboard snapshot; duplicate event IDs are not added again. Browser CSV uploads remain local analysis inputs. See [development](docs/development.md) for the distinction and deployment configuration.

After migrations 004 and 005, create persisted public snapshots for campaigns that were already completed before this feature was deployed. Migration 006 adds campaign applications, review state, hashed email-verification tokens, and application events:

```sh
npm run backfill:completed-campaigns
```

New snapshots are created automatically when an organization or site admin changes a campaign to `completed`. The homepage carousel and `/campaigns` archive read only these sanitized snapshots. Completed totals, source data and competition data are frozen; campaign managers may still update public copy and media.

For local UI development, seed the three tracked Giveback-based placeholder snapshots without touching PostgreSQL:

```sh
npm run seed:completed-placeholders
```

## Build and validate

```sh
npm run build
npm test
npm run verify:auth
npm run test:postgres
npm run verify:hygiene
npm start
```

`build` prepares assets/private seed data, typechecks, builds with Vite, renders the React shell, and checks the public release. `test:postgres` creates a disposable local PostgreSQL cluster; it does not use your configured database. `npm start` serves `dist/` and the same API as development and Netlify.

## R&D documentation

Start with the [active product and engineering TODO](docs/todo.md) and [engineering guide](docs/README.md), then [architecture](docs/architecture.md), [data model](docs/data-model.md), [API](docs/api.md), and [development](docs/development.md). The [migration record](docs/platform-migration.md) explains compatibility and validation. The [performance investigation](docs/performance-investigation.md) records the measured baseline and the changes made during migration.

## Code map

```text
apps/web/src/components/   React page layouts and forms
apps/web/src/compat/       Existing campaign controls and chart/table renderers
apps/web/src/api.ts        Typed, same-origin session client
apps/web/src/styles/       Application CSS
backend/app.ts            Shared Request → Response boundary
backend/http-handler.mjs  Route dispatch
backend/services/         Auth, authorization, campaign repositories, imports, jobs
backend/database.ts       One bounded PostgreSQL pool per process
netlify/functions/        Thin deployment adapters and job entry points
shared/                   TypeScript contracts and deterministic intelligence
scripts/                  Node build, development, migration, import and checks
db/migrations/            Ordered SQL migrations
tests/                    Unit, HTTP integration and disposable PostgreSQL checks
work/assets/              Platform and existing campaign media
work/samples/             Synthetic seed CSV
```

Netlify publishes `dist/` using `npm run build`. GitHub Actions validates the same Node workflow. Scheduled campaign jobs remain disabled. No live deployment or data cutover is part of this local migration.
