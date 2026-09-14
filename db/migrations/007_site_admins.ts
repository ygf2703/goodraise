import { createHash, pbkdf2Sync, randomBytes, randomUUID } from "node:crypto";
import { lstat, mkdir, open } from "node:fs/promises";
import { join } from "node:path";
import type pg from "pg";
import type { MigrationContext } from "../../scripts/migration-types.ts";

const emails = ["ranbo7@gmail.com", "noamfrostig@gmail.com"];
const migrationName = "007_site_admins.ts";

// Freeze the current authentication contract in this checksummed migration.
// A later application password-policy change must not change this file.
function hashPassword(password: string) {
  const salt = randomBytes(16);
  const iterations = 200_000;
  const digest = pbkdf2Sync(password, salt, iterations, 32, "sha256");
  return `pbkdf2_sha256$${iterations}$${salt.toString("base64url")}$${digest.toString("base64url")}`;
}

const accessHash = createHash("sha256").update(JSON.stringify({
  role: "platform_admin", organizationId: "", organizationSlug: "",
  campaignIds: [], campaignSlugs: [], memberships: [], isActive: true,
})).digest("hex");

interface ExistingAccount {
  email: string;
  password_hash: string | null;
  password_set_at: Date | null;
}

export async function up(client: pg.Client, context: MigrationContext): Promise<string[]> {
  await client.query("SET LOCAL lock_timeout = '5s'");
  // Serialize against runtime seeding/password setup, including absent emails.
  await client.query("LOCK TABLE goodraise.admin_users IN SHARE ROW EXCLUSIVE MODE");
  const existing = await client.query<ExistingAccount>(
    "SELECT email, password_hash, password_set_at FROM goodraise.admin_users WHERE email = ANY($1::text[])", [emails],
  );
  const records = emails.map((email) => {
    const account = existing.rows.find((row) => row.email === email);
    const password = account?.password_hash ? "" : randomBytes(24).toString("base64url");
    return {
      email, password,
      hash: password ? hashPassword(password) : account!.password_hash!,
      passwordSetAt: password ? new Date() : account!.password_set_at,
    };
  });
  const generated = records.filter((record) => record.password).map(({ email, password }) => ({ email, password }));
  const notices: string[] = [];
  if (generated.length) {
    // Save before changing credentials. An unwritable destination aborts the
    // transaction. Unique files preserve recovery even if COMMIT is ambiguous.
    await mkdir(context.credentialsDirectory, { recursive: true, mode: 0o700 });
    const directory = await lstat(context.credentialsDirectory);
    if (!directory.isDirectory() || directory.isSymbolicLink() || (directory.mode & 0o077) !== 0) {
      throw new Error("The migration credentials directory must be a private, non-symlink directory (mode 0700).");
    }
    const url = new URL(context.connectionString);
    const target = { host: url.hostname, port: url.port || "5432", database: decodeURIComponent(url.pathname.slice(1)) };
    const targetId = createHash("sha256").update(JSON.stringify(target)).digest("hex").slice(0, 12);
    // The .env prefix also matches Vite's filesystem denylist in development.
    const filePath = join(context.credentialsDirectory, `.env.007-site-admins-${targetId}-${randomUUID()}.json`);
    const file = await open(filePath, "wx", 0o600);
    try {
      await file.writeFile(`${JSON.stringify({
        migration: migrationName, createdAt: new Date().toISOString(), target,
        note: "These passwords are active only after this migration commits successfully. Interrupted attempts can leave inactive candidate files. Store securely; do not commit or upload.",
        accounts: generated,
        existingPasswordsPreserved: records.filter((record) => !record.password).map((record) => record.email),
      }, null, 2)}\n`);
      await file.sync();
    } finally { await file.close(); }
    notices.push(`New admin passwords saved locally (0600): ${filePath}`);
  }
  for (const record of records) {
    const changed = await client.query<{ id: string }>(`
      INSERT INTO goodraise.admin_users AS existing (
        id, email, role, organization_app_id, organization_slug, campaign_ids,
        campaign_slugs, password_hash, password_set_at, is_active, access_config_hash
      ) VALUES (gen_random_uuid(), $1, 'platform_admin', '', '', '[]'::jsonb,
        '[]'::jsonb, $2, $3, TRUE, $4)
      ON CONFLICT (email) DO UPDATE SET
        role = EXCLUDED.role, organization_app_id = '', organization_slug = '',
        campaign_ids = EXCLUDED.campaign_ids, campaign_slugs = EXCLUDED.campaign_slugs,
        password_hash = EXCLUDED.password_hash, password_set_at = EXCLUDED.password_set_at,
        is_active = TRUE, access_config_hash = EXCLUDED.access_config_hash, updated_at = NOW()
      WHERE (existing.role, existing.organization_app_id, existing.organization_slug,
        existing.campaign_ids, existing.campaign_slugs, existing.password_hash,
        existing.is_active, existing.access_config_hash)
        IS DISTINCT FROM (EXCLUDED.role, '', '', EXCLUDED.campaign_ids,
          EXCLUDED.campaign_slugs, EXCLUDED.password_hash, TRUE, EXCLUDED.access_config_hash)
      RETURNING id::text
    `, [record.email, record.hash, record.passwordSetAt, accessHash]);
    const memberships = await client.query(`
      DELETE FROM goodraise.admin_memberships
      WHERE admin_user_id IN (SELECT id FROM goodraise.admin_users WHERE email = $1)
    `, [record.email]);
    if (changed.rowCount || memberships.rowCount) {
      await client.query(`DELETE FROM goodraise.admin_sessions
        WHERE admin_user_id IN (SELECT id FROM goodraise.admin_users WHERE email = $1)`, [record.email]);
    }
    notices.push(`${record.email}: active platform_admin; ${record.password ? "new password generated" : "existing password preserved"}.`);
  }
  return notices;
}
