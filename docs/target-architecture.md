# Target architecture and current implementation

Decision: standardize on **Node.js + React + TypeScript**, with PostgreSQL as the intended canonical business database. Keep Netlify as the current deployment adapter. This direction was authorized for implementation on 2026-09-08.

## Implemented platform consolidation

- One Node backend runs locally and behind Netlify, with the same route, auth, source, ingestion and question services.
- React/TypeScript defines the application entry point and page layouts; Vite builds external assets and Node renders the initial React shell.
- TypeScript covers the new API client, application/HTTP boundary, shared contracts, database pool and build/import/migration tooling.
- Existing JavaScript business services and chart/designer controls are reused as modules.
- Python build/server/import/check commands and dependencies are removed. One npm workflow covers installation through validation.
- Generic GoodRaise names replace campaign-specific platform identifiers; old identifiers survive only in compatibility readers and their tests.
- Ordered SQL migrations and a disposable PostgreSQL suite verify the Node ledger and snapshot flow.

See the [migration record](platform-migration.md) for verification and compatibility details.

## Remaining architectural work

The platform change does not imply a complete React component rewrite or a live database cutover.

| Area | Current | Next step |
| --- | --- | --- |
| Dynamic UI | Existing imperative controller owns charts, tables, project rendering and designer internals | Move one workflow at a time into React state/components with typed contracts and behavior checks |
| Established services | JavaScript ES modules reused under Node | Add types at service/repository boundaries before broader conversion; do not replace proven logic with unchecked `any` |
| Business persistence | SQL plus Blobs/development JSON compatibility | Inventory deployed records, migrate auxiliary auth/audit/job state into SQL, verify tenant identities and totals |
| Schema | Ordered migrations plus existing opt-in runtime DDL | Remove runtime DDL after deployed baselines are confirmed |
| Read performance | Saved-data-first startup and shared pool; summary enumeration/full snapshots remain | Measure query counts/timing, server aggregates and pagination before changing topology |
| Public rendering | Static React shell and live API data | Decide campaign-specific metadata/SSR requirements; retain one React frontend |

A future data cutover requires a backup, a rehearsal and verified source ownership. Changing the database URL is not a substitute for migrating records. Compare users/roles, organizations/campaigns, source secrets, ledger counts, snapshot amounts and runtime flags. Preserve a compatible writer and rollback path.

New features should be implemented in the chosen Node/React path. Do not recreate the Python backend or introduce a second frontend platform.
