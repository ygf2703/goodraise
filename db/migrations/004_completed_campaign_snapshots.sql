-- Completed campaigns are served from a sanitized, immutable public snapshot.
-- Public requests never need to scan transactions or load private datasets.
CREATE TABLE IF NOT EXISTS goodraise.campaign_public_snapshots (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES goodraise.organizations(id) ON DELETE CASCADE,
    campaign_id UUID NOT NULL REFERENCES goodraise.campaigns(id) ON DELETE CASCADE,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    completed_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (campaign_id)
);

CREATE INDEX IF NOT EXISTS idx_campaign_public_snapshots_completed
    ON goodraise.campaign_public_snapshots(completed_at DESC);
