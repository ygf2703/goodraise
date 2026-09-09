# GoodRaise R&D guide

Updated 2026-09-08 for the implemented Node.js/React migration. Start here to understand architecture, domain rules, development and remaining research/engineering work. The repository has one Node backend, a React frontend, and TypeScript for the new application boundaries and tooling.

## Reading order

1. [Architecture](architecture.md): system diagram, stack, modules and frontend ownership.
2. [Data model](data-model.md): organizations/campaigns, ledger, snapshots and persistence.
3. [Multi-tenancy](multi-tenancy.md): role and campaign access boundaries.
4. [API contracts](api.md): routes, payloads and errors shared locally and on Netlify.
5. [Intelligence model](intelligence-model.md): scoring, forecasts and question-provider boundaries.
6. [Development](development.md): install, build, database migrations, imports, tests and hosting.
7. [Platform migration](platform-migration.md): changes, compatibility and validation.
8. [Engineering assessment](engineering-assessment.md): current limitations and next work.

The [target architecture](target-architecture.md) records the chosen direction and remaining component/data migration work. The [performance investigation](performance-investigation.md) preserves the measured pre-migration baseline alongside current changes. The [2026-09-09 database rollout](database-rollout-2026-09-09.md) records the production migration, rehearsal and recovery snapshot.

## Concepts

| Concept | Meaning |
| --- | --- |
| Organization | Tenant grouping campaigns and manager access |
| Campaign | Its own brand, goals, dates, source, prizes and dataset |
| Ledger | Relational transactions and donor/ambassador/reward relationships |
| Dataset snapshot | Denormalized rows/meta read by the browser |
| Builder draft | Campaign configuration, separate from donations and source state |
| Intelligence engine | Deterministic calculations, shared as an ES module |
| Question assistant | Server aggregates and deterministic answers, optionally a model call |

## Change map

| Task | Entry point |
| --- | --- |
| Layout/forms | `apps/web/src/components/` |
| Existing filters/charts/import controls | `apps/web/src/compat/dashboard-controller.js` |
| Browser API behavior | `apps/web/src/api.ts` |
| Forecast or intervention rules | `shared/intelligence/engine.mjs` |
| Route/authorization | `backend/http-handler.mjs`, `backend/services/authorization.mjs` |
| Campaign configuration | `campaign-store.mjs`, repository mapping and browser snapshot helpers |
| Stale totals | Source mapping → ingestion ledger → snapshot → dataset API → browser date/filter scope |
| SQL schema | New numbered file in `db/migrations/` |
| Local/hosted backend behavior | The same `backend/` services; adapters stay thin |

## Historical material

August 2026 assessments are retained as historical context, not current deployment evidence or acceptance criteria: [technical baseline](technical-baseline.md), [scorecard baseline](scorecard-baseline.md), [acquisition scorecard](acquisition-readiness-scorecard.md), [final scorecard](final-scorecard.md), [production readiness](production-readiness.md), [go-live checklist](go-live-checklist.md), [backup/recovery](backup-and-recovery.md), [scalability](scalability.md), [technical due diligence](technical-due-diligence.md), [security audit](security-and-data-audit.md), and [IP/provenance](ip-and-provenance.md).

The [product backlog](../outputs/dashboard-backlog-priorities.md) is planning material. Update current guides whenever a change affects routes, persisted data, source mapping, roles, deployment configuration or formulas. Record measured behavior separately from desired architecture.
