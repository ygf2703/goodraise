# GoodRaise

GoodRaise is a platform for organizations running fundraising campaigns: public campaign pages, ambassador links and prizes, manager dashboards, source imports, and campaign intelligence.

The application uses **one Node.js backend and one React frontend**. TypeScript covers the React components, application/API boundary, database pool, and new tooling. Existing JavaScript services and campaign controls are reused. Python is no longer required to build, run, test, or import data.

## Start locally

Use Node.js 24 (`.nvmrc`; validated with 24.20.0).

```sh
npm ci
cp .env.example .env
# Set GOODRAISE_MANAGER_EMAILS in .env to your authorized manager email.
npm run dev
```

Open [http://127.0.0.1:8767](http://127.0.0.1:8767). React and the API share this origin. `/admin`, `/rules`, `/privacy`, `/prizes`, campaign slugs, and ambassador links load directly. `/goodraise/` serves the marketing page.

First login for an allowlisted manager enters password setup. Without a database URL, the same Node services use local JSON files for a development/demo dataset. PostgreSQL is required for ledger ingestion, manual contributions, and relational ambassador registration imports. There is no separate local backend implementation.

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

Start with the [engineering guide](docs/README.md), then [architecture](docs/architecture.md), [data model](docs/data-model.md), [API](docs/api.md), and [development](docs/development.md). The [migration record](docs/platform-migration.md) explains compatibility, validation, and remaining work. The [performance investigation](docs/performance-investigation.md) records the measured baseline and the changes made during migration.

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
