# Database rollout: 2026-09-16

Migrations 004–007 were applied to the GoodRaise Neon project's `production` branch, database `neondb`, at **2026-09-15 21:05:46–48 UTC** (**2026-09-16 00:05:46–48 Asia/Jerusalem**). No application deployment was required for this database rollout.

## Recovery and execution

- Confirmed through the Chrome extension that Netlify's `GOODRAISE_DATABASE_URL` points to this production branch.
- Created a manual Neon recovery snapshot at **2026-09-15 20:56:21 UTC**. The console lists it with no expiry. This is not a scheduled-backup configuration; restoration was not rehearsed in this rollout.
- Used the repository's unchanged Node migration runner against the direct owner connection, with `sslmode=verify-full`, advisory locking, checksum validation, and a transaction per migration.
- Transferred only the required connection string to the local runner using an ephemeral RSA-OAEP encrypted handoff. The database password and private key were held in memory, not saved to a connection file or committed.
- Left the separate DBeaver profile, `GoodRaise Production (Neon owner)`, configured as production with read-only browsing. This client-side guard is not a least-privilege database role; the underlying role is still the database owner.

## Verification

- All seven migration names and SHA-256 checksums match the repository. A second runner invocation skipped them all successfully.
- An independent Neon SQL Editor query confirmed the four new tables, `admin_users.access_config_hash`, the expected indexes, and validated constraints.
- Ran and Noam (`ranbo7@gmail.com`, `noamfrostig@gmail.com`) are active, globally scoped `platform_admin` accounts. Their existing IDs and password hashes were preserved. No new passwords or password file were generated. Actual owner sign-in/project-selection tests remain to be performed with their existing credentials.
- Before/after counts and row fingerprints matched for organizations, campaigns, configs, donors, transactions, ambassadors, rewards, campaign sources, import batches, raw imports, and all 14 unrelated admin accounts (excluding only the newly added access-hash column).
- Relevant preserved counts: 4 organizations, 6 campaigns, 2,535 donors, 2,722 transactions, 410 import batches, and 45,034 raw import rows.
- Live `/api/health` returned HTTP 200 with `ok: true`; `/api/auth/status` returned HTTP 200 with an anonymous, unauthenticated response; `/api/public/campaigns` returned HTTP 200.
- The follow-up query found zero campaigns with status `completed` and zero public snapshots. No completed-campaign backfill or development placeholder seed was run.

| Migration | SHA-256 |
| --- | --- |
| `004_completed_campaign_snapshots.sql` | `e438e92605bc7c4e07e89d81573f467dfab1f23406cb345f46120a93edad3248` |
| `005_account_memberships.sql` | `83f8248474c08baa2b2b2851e631cfe439a45036cd4ea738cf57f4d527adc90d` |
| `006_campaign_applications.sql` | `231fffca264a5a94d2e847a1a0f40d761da0d73a444779d0ace5205905610a2c` |
| `007_site_admins.ts` | `3eb46caf5c8635135573e63b55be1cebe982a4f7cde5e3a8d498e166cadbc6f7` |

The deployment migration stage, restricted runtime/inspection roles, context-scoped secrets, scheduled backups, real email delivery, and remaining end-to-end journeys are still tracked in [TODO](todo.md). Do not restore the production snapshot directly without accounting for writes since its creation; inspect a separate restored branch first.
