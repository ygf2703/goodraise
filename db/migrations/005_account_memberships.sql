ALTER TABLE goodraise.admin_users
  ADD COLUMN IF NOT EXISTS access_config_hash TEXT NOT NULL DEFAULT '';

CREATE TABLE goodraise.admin_memberships (
    id UUID PRIMARY KEY,
    admin_user_id UUID NOT NULL REFERENCES goodraise.admin_users(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES goodraise.organizations(id) ON DELETE CASCADE,
    campaign_id UUID REFERENCES goodraise.campaigns(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT admin_memberships_role CHECK (role IN ('organization_admin', 'campaign_manager', 'analyst', 'viewer')),
    CONSTRAINT admin_memberships_scope CHECK (
      (role = 'organization_admin' AND campaign_id IS NULL)
      OR (role <> 'organization_admin' AND campaign_id IS NOT NULL)
    )
);

CREATE UNIQUE INDEX uq_admin_memberships_organization
  ON goodraise.admin_memberships(admin_user_id, organization_id)
  WHERE campaign_id IS NULL;

CREATE UNIQUE INDEX uq_admin_memberships_campaign
  ON goodraise.admin_memberships(admin_user_id, campaign_id)
  WHERE campaign_id IS NOT NULL;

CREATE INDEX idx_admin_memberships_user ON goodraise.admin_memberships(admin_user_id);
CREATE INDEX idx_admin_memberships_organization ON goodraise.admin_memberships(organization_id);
CREATE INDEX idx_admin_memberships_campaign ON goodraise.admin_memberships(campaign_id);

INSERT INTO goodraise.admin_memberships (id, admin_user_id, organization_id, campaign_id, role)
SELECT gen_random_uuid(), u.id, o.id, NULL, 'organization_admin'
FROM goodraise.admin_users u
JOIN goodraise.organizations o
  ON o.app_id = NULLIF(u.organization_app_id, '') OR o.slug = NULLIF(u.organization_slug, '')
WHERE u.role = 'organization_admin'
  AND NOT EXISTS (
    SELECT 1 FROM goodraise.admin_memberships m
    WHERE m.admin_user_id = u.id AND m.organization_id = o.id AND m.campaign_id IS NULL
  );

WITH legacy_campaign_scopes AS (
  SELECT u.id AS admin_user_id, u.role, u.organization_app_id, u.organization_slug,
    jsonb_array_elements_text(COALESCE(u.campaign_ids, '[]'::jsonb)) AS campaign_identifier
  FROM goodraise.admin_users u
  WHERE u.role IN ('campaign_manager', 'analyst', 'viewer')
  UNION
  SELECT u.id AS admin_user_id, u.role, u.organization_app_id, u.organization_slug,
    jsonb_array_elements_text(COALESCE(u.campaign_slugs, '[]'::jsonb)) AS campaign_identifier
  FROM goodraise.admin_users u
  WHERE u.role IN ('campaign_manager', 'analyst', 'viewer')
)
INSERT INTO goodraise.admin_memberships (id, admin_user_id, organization_id, campaign_id, role)
SELECT gen_random_uuid(), scope.admin_user_id, o.id, c.id, scope.role
FROM legacy_campaign_scopes scope
JOIN goodraise.organizations o
  ON o.app_id = NULLIF(scope.organization_app_id, '') OR o.slug = NULLIF(scope.organization_slug, '')
JOIN goodraise.campaigns c ON c.organization_id = o.id
  AND (c.app_id = scope.campaign_identifier OR c.slug = scope.campaign_identifier)
WHERE NOT EXISTS (
  SELECT 1 FROM goodraise.admin_memberships m
  WHERE m.admin_user_id = scope.admin_user_id AND m.campaign_id = c.id
);
