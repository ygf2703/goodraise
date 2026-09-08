CREATE SCHEMA IF NOT EXISTS goodraise;

CREATE TABLE IF NOT EXISTS goodraise.organizations (
    id UUID PRIMARY KEY,
    app_id TEXT,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS goodraise.campaigns (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES goodraise.organizations(id) ON DELETE CASCADE,
    app_id TEXT,
    slug TEXT NOT NULL,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    target_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
    updated_by TEXT NOT NULL DEFAULT '',
    source_filename TEXT,
    source_checksum_sha256 TEXT,
    starts_at TIMESTAMPTZ,
    ends_at TIMESTAMPTZ,
    currency_code TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, slug)
);

CREATE TABLE IF NOT EXISTS goodraise.currencies (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS goodraise.import_batches (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES goodraise.organizations(id) ON DELETE CASCADE,
    campaign_id UUID NOT NULL REFERENCES goodraise.campaigns(id) ON DELETE CASCADE,
    source_filename TEXT NOT NULL,
    source_checksum_sha256 TEXT NOT NULL,
    raw_fieldnames JSONB NOT NULL,
    raw_row_count INTEGER NOT NULL DEFAULT 0,
    imported_row_count INTEGER NOT NULL DEFAULT 0,
    skipped_blank_rows INTEGER NOT NULL DEFAULT 0,
    imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    imported_by TEXT NOT NULL DEFAULT 'codex',
    notes TEXT,
    UNIQUE (campaign_id, source_checksum_sha256)
);

CREATE TABLE IF NOT EXISTS goodraise.donors (
    id UUID PRIMARY KEY,
    donor_key TEXT NOT NULL UNIQUE,
    full_name TEXT,
    phone TEXT,
    email TEXT,
    email_normalized TEXT,
    shipping_name TEXT,
    delivery_comment TEXT,
    google_address_line TEXT,
    city TEXT,
    zip TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS goodraise.ambassadors (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES goodraise.organizations(id) ON DELETE CASCADE,
    campaign_id UUID NOT NULL REFERENCES goodraise.campaigns(id) ON DELETE CASCADE,
    ambassador_key TEXT NOT NULL,
    full_name TEXT,
    email TEXT,
    email_normalized TEXT,
    phone TEXT,
    nickname TEXT,
    referred_by TEXT,
    was_ambassador_before BOOLEAN,
    registration_source TEXT,
    is_over_18 BOOLEAN,
    understands_not_packing BOOLEAN,
    terms_accepted BOOLEAN,
    registered_at TIMESTAMPTZ,
    registered_at_raw TEXT,
    registration_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (campaign_id, ambassador_key)
);

CREATE TABLE IF NOT EXISTS goodraise.rewards (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES goodraise.organizations(id) ON DELETE CASCADE,
    campaign_id UUID NOT NULL REFERENCES goodraise.campaigns(id) ON DELETE CASCADE,
    reward_key TEXT NOT NULL,
    reward_name TEXT,
    unit_price NUMERIC(12, 2),
    quantity INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (campaign_id, reward_key)
);

CREATE TABLE IF NOT EXISTS goodraise.transactions (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES goodraise.organizations(id) ON DELETE CASCADE,
    campaign_id UUID NOT NULL REFERENCES goodraise.campaigns(id) ON DELETE CASCADE,
    import_batch_id UUID NOT NULL REFERENCES goodraise.import_batches(id) ON DELETE CASCADE,
    source_row_number INTEGER NOT NULL,
    source_id TEXT,
    source_transaction_key TEXT NOT NULL,
    canonical_event_key TEXT,
    donor_id UUID REFERENCES goodraise.donors(id),
    ambassador_id UUID REFERENCES goodraise.ambassadors(id),
    reward_id UUID REFERENCES goodraise.rewards(id),
    occurred_at TIMESTAMPTZ,
    occurred_at_raw TEXT,
    total_amount NUMERIC(12, 2),
    currency_code TEXT REFERENCES goodraise.currencies(code),
    charged_success BOOLEAN,
    charge_result_code TEXT,
    direct_debit BOOLEAN,
    direct_debit_active BOOLEAN,
    raw_payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (campaign_id, source_transaction_key)
);

CREATE TABLE IF NOT EXISTS goodraise.transactions_csv_raw (
    import_batch_id UUID NOT NULL REFERENCES goodraise.import_batches(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES goodraise.organizations(id) ON DELETE CASCADE,
    campaign_id UUID NOT NULL REFERENCES goodraise.campaigns(id) ON DELETE CASCADE,
    transaction_id UUID REFERENCES goodraise.transactions(id) ON DELETE SET NULL,
    source_row_number INTEGER NOT NULL,
    "id" TEXT,
    "created_at" TEXT,
    "full_name" TEXT,
    "reward" TEXT,
    "price" TEXT,
    "quantity" TEXT,
    "total" TEXT,
    "currencyname" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "Ambassador name" TEXT,
    "Ambassador email" TEXT,
    "shipping_name" TEXT,
    "delivery_comment" TEXT,
    "google_address_line" TEXT,
    "city" TEXT,
    "zip" TEXT,
    "charged_success" TEXT,
    "charge_result" TEXT,
    "direct_debit" TEXT,
    "direct debit active" TEXT,
    imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (import_batch_id, source_row_number)
);

CREATE TABLE IF NOT EXISTS goodraise.campaign_configs (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES goodraise.organizations(id) ON DELETE CASCADE,
    campaign_id UUID NOT NULL REFERENCES goodraise.campaigns(id) ON DELETE CASCADE,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    revision BIGINT NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by TEXT NOT NULL DEFAULT '',
    UNIQUE (campaign_id)
);

CREATE TABLE IF NOT EXISTS goodraise.campaign_sources (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES goodraise.organizations(id) ON DELETE CASCADE,
    campaign_id UUID NOT NULL REFERENCES goodraise.campaigns(id) ON DELETE CASCADE,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    has_secret BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by TEXT NOT NULL DEFAULT '',
    UNIQUE (campaign_id)
);

CREATE TABLE IF NOT EXISTS goodraise.campaign_datasets (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES goodraise.organizations(id) ON DELETE CASCADE,
    campaign_id UUID NOT NULL REFERENCES goodraise.campaigns(id) ON DELETE CASCADE,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    row_count INTEGER NOT NULL DEFAULT 0,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (campaign_id)
);

CREATE TABLE IF NOT EXISTS goodraise.admin_users (
    id UUID PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL DEFAULT 'platform_admin',
    organization_app_id TEXT NOT NULL DEFAULT '',
    organization_slug TEXT NOT NULL DEFAULT '',
    campaign_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    campaign_slugs JSONB NOT NULL DEFAULT '[]'::jsonb,
    password_hash TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    password_set_at TIMESTAMPTZ,
    last_login_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS goodraise.admin_sessions (
    token TEXT PRIMARY KEY,
    admin_user_id UUID NOT NULL REFERENCES goodraise.admin_users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_campaigns_org ON goodraise.campaigns(organization_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_organizations_app_id ON goodraise.organizations(app_id) WHERE app_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_campaigns_org_app_id ON goodraise.campaigns(organization_id, app_id) WHERE app_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_import_batches_campaign ON goodraise.import_batches(campaign_id);
CREATE INDEX IF NOT EXISTS idx_ambassadors_campaign ON goodraise.ambassadors(campaign_id);
CREATE INDEX IF NOT EXISTS idx_rewards_campaign ON goodraise.rewards(campaign_id);
CREATE INDEX IF NOT EXISTS idx_transactions_campaign_time ON goodraise.transactions(campaign_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_transactions_donor ON goodraise.transactions(donor_id);
CREATE INDEX IF NOT EXISTS idx_transactions_ambassador ON goodraise.transactions(ambassador_id);
CREATE INDEX IF NOT EXISTS idx_raw_campaign ON goodraise.transactions_csv_raw(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_configs_campaign ON goodraise.campaign_configs(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_sources_campaign ON goodraise.campaign_sources(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_datasets_campaign ON goodraise.campaign_datasets(campaign_id);
CREATE INDEX IF NOT EXISTS idx_admin_users_role ON goodraise.admin_users(role);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_user ON goodraise.admin_sessions(admin_user_id);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires ON goodraise.admin_sessions(expires_at);
ALTER TABLE goodraise.transactions ADD COLUMN IF NOT EXISTS canonical_event_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_transactions_campaign_canonical_event_key ON goodraise.transactions(campaign_id, canonical_event_key);
ALTER TABLE goodraise.ambassadors ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE goodraise.ambassadors ADD COLUMN IF NOT EXISTS nickname TEXT;
ALTER TABLE goodraise.ambassadors ADD COLUMN IF NOT EXISTS referred_by TEXT;
ALTER TABLE goodraise.ambassadors ADD COLUMN IF NOT EXISTS was_ambassador_before BOOLEAN;
ALTER TABLE goodraise.ambassadors ADD COLUMN IF NOT EXISTS registration_source TEXT;
ALTER TABLE goodraise.ambassadors ADD COLUMN IF NOT EXISTS is_over_18 BOOLEAN;
ALTER TABLE goodraise.ambassadors ADD COLUMN IF NOT EXISTS understands_not_packing BOOLEAN;
ALTER TABLE goodraise.ambassadors ADD COLUMN IF NOT EXISTS terms_accepted BOOLEAN;
ALTER TABLE goodraise.ambassadors ADD COLUMN IF NOT EXISTS registered_at TIMESTAMPTZ;
ALTER TABLE goodraise.ambassadors ADD COLUMN IF NOT EXISTS registered_at_raw TEXT;
ALTER TABLE goodraise.ambassadors ADD COLUMN IF NOT EXISTS registration_payload JSONB NOT NULL DEFAULT '{}'::jsonb;
