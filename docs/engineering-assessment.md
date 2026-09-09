# Engineering assessment

Updated 2026-09-08 after the Node.js/React migration. GoodRaise now has a consistent runtime/toolchain. Remaining work is primarily component ownership, data consistency, onboarding and read efficiency.

## What the migration resolved

| Finding | Resolution |
| --- | --- |
| Separate Python and Node backends drifted | Local and hosted adapters now call one Node application |
| UI and tooling were embedded in Python | React layouts, standalone CSS/JS modules, Node build/import/check scripts |
| Manager bootstrap forced external refresh | Read saved dataset/configuration first; refresh remains an explicit/timed operation |
| Large inline public output | Rendered HTML shell and separately cached assets; no embedded donor rows or base64 brand images |
| Three independent SQL pools | One bounded pool shared by auth/repositories/ingestion, with graceful shutdown |
| Missing snapshot-helper imports in single ingest/reset | Correct imports; those paths now pass against a real disposable PostgreSQL database |
| Initial SQL setup omitted an ingest counter | Ordered baseline and follow-up migration; applied twice in integration checks |
| Generic source save accepted unsafe URLs | Shared repository validates before persisting; refresh also validates existing configuration |
| Parallel settings loads could apply stale source mode | Builder loads before the authoritative source response |
| Concurrent JSON writes could lose records | Per-file mutation serialization and atomic replacement in a single development process |
| Old scheduling/date assertions contradicted current behavior | Tests now preserve disabled schedules and snapshot-window precedence |
| Public context ignored the campaign URL | Explicit campaign lookup and unknown/ambiguous responses; attribution applied after hydration |
| Platform inherited one campaign's identity | Generic defaults and identifiers; prize exclusions are per-campaign configuration |

## Current limitations

- The React application still embeds the established imperative controller for dynamic chart/table/project/designer content. It is isolated behind a lifecycle adapter, not fully converted into React state and components.
- Existing backend/domain modules remain JavaScript. New TypeScript is strictly checked; JavaScript modules are included for interoperability without claiming full static type coverage.
- Scoped authorization now checks session and campaign identities directly. SQL context loading uses one joined query; summaries use two reads with amounts projected only for accessible campaigns. Summary calculations still process every stored amount, and manager datasets/browser analytics remain unpaginated. These are the next scaling limits to profile.
- PostgreSQL is not the only state owner yet. Auxiliary auth/rate-limit/audit/job state still uses Blobs or files; non-SQL modes cannot use relational ingest/manual matching.
- Application authorization enforces tenant access; donors are still globally keyed and SQL does not enforce row-level tenancy.
- Allowlists authorize first password setup but do not prove mailbox ownership. Public campaign selection/projection policy also needs an explicit product/security decision.
- Browser CSV/comparison uploads are temporary analysis; generic API refresh can write snapshots without the ledger. Those paths are not equivalent to canonical ingestion.
- Single-record ingestion commits the ledger before its separate snapshot update. The missing-helper defect is fixed, but atomicity across those steps remains a design limitation.
- Development JSON locking protects one process. Blobs and concurrent configuration editing retain their previous consistency limits.
- Generic legal draft pages require campaign-specific approved content. Removing the original organization's rules does not create an approved policy for every organization.

## Verification record

The migration is checked with the Node 24 deployment baseline and a disposable PostgreSQL cluster. See [platform migration](platform-migration.md#validation) for the final command results and browser checks. Tests include executable domain behavior, HTTP scope checks and some inherited source assertions; passing them is not evidence of production load capacity or third-party integration availability.

## Next R&D priorities

1. Verify migration 003 before deploying this code to each database; the GoodRaise Neon production rollout is [complete](database-rollout-2026-09-09.md). Resolve any legacy case collisions explicitly in other environments. Measure the hosted request chain with SQL timings, payload sizes and browser profiling; consider stored aggregates/pagination where measurements point.
2. Convert dynamic frontend workflows into typed React components, keeping row populations, date scope and money calculations unchanged.
3. Inventory deployed state and rehearse a SQL consolidation with record/totals/role parity checks.
4. Improve manager onboarding, public publication rules, concurrency and tenant data boundaries based on explicit product requirements.

Changing backend language again is not supported by the evidence gathered here. Source latency, query structure, payloads and browser computation must be measured separately.
