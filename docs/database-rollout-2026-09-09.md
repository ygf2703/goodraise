# Database rollout: 2026-09-09

Migrations 001–003 were applied to the GoodRaise Neon project's `production` branch, database `neondb`, on 2026-09-09 at 06:35:40 UTC (09:35:40 Asia/Jerusalem), before publishing the query-performance code. This records a database rollout; application deployment on Netlify was not verified because deployment access was unavailable.

## Preflight and recovery

- Existing account emails were already trimmed and lowercase. No normalized-email collisions were found.
- The existing database had the ingest counter from migration 002, but no `goodraise.schema_migrations` history table.
- A manual production snapshot was created at **2026-09-09 06:28:52 UTC** in Neon's **Backup & Restore** page. The console showed no expiry for this snapshot. It is a one-time recovery point, not a scheduled backup system.
- An isolated production copy, `verify-email-migration-20260909`, was created for rehearsal. Neon configured it to expire on 2026-09-10 at 06:30 UTC. This temporary branch is separate from the retained snapshot.

## Execution and verification

The repository's three SQL files were executed through the authenticated Neon SQL Editor. A single transactional `DO` block checked each file's SHA-256 against the local file before executing it, used the migration runner's advisory-lock key, and recorded matching checksums in `schema_migrations`. The idempotent baseline SQL was executed rather than marking unexecuted migrations as applied. A five-second lock timeout bounded lock acquisition.

The wrapper locked account and session writes while comparing their complete records before and after execution. Any difference would have raised an exception and rolled back the whole operation, because preflight established that this database needed no email backfill. This additional guard was specific to this rollout; the standard migration still supports normalizing legacy emails in other databases.

The rehearsal succeeded, and a second run skipped all previously recorded migrations. The same bundle then succeeded on production. A separate read confirmed:

- Migration names and checksums match the repository files.
- `admin_users_email_normalized` exists and is validated.
- All account and session records were preserved exactly, including IDs, credentials and permissions.
- No noncanonical account emails remain.
- Campaign, transaction and dataset counts match the rehearsal copy. These migrations do not rewrite donation payloads.

| Migration | SHA-256 |
| --- | --- |
| `001_initial.sql` | `353ce95a3fa42dcfddf392d3bdfe69bef1a7db2d4c9b4abb8b56ca2c75bc90e0` |
| `002_ingest_validation.sql` | `0fad01ccb50c840f972a18ce5dfeb1dda216838c87e34dcd7ad7c6a6b19b096c` |
| `003_normalize_admin_email.sql` | `ab553dc23eab49e7a4755faf4bb9f6340e03d0de5b69df39795833fbd57f62aa` |

Future deployments can use `npm run db:migrate`; its checksum records now agree with this database. Other branches and databases require separate verification.

## Rollback considerations

The previous application code accepts normalized account emails and is compatible with the added constraint. An application rollback therefore does not require restoring the database. Keep the constraint and migration history when rolling back only the code.

If a database recovery becomes necessary, inspect the manual snapshot above in Neon and restore to a separate branch first. Reconcile subsequent production writes before replacing live state. Restoring the entire production branch would also revert unrelated data written after the snapshot; it is not the default response to an application problem.
