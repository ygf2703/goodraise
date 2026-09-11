CREATE TABLE goodraise.campaign_applications (
    id UUID PRIMARY KEY,
    reference_code TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending_email_verification',
    applicant_name TEXT NOT NULL,
    applicant_email TEXT NOT NULL,
    applicant_phone TEXT NOT NULL,
    organization_name TEXT NOT NULL,
    organization_type TEXT NOT NULL,
    organization_registration_number TEXT NOT NULL DEFAULT '',
    campaign_name TEXT NOT NULL,
    category TEXT NOT NULL,
    purpose TEXT NOT NULL,
    story TEXT NOT NULL DEFAULT '',
    target_amount NUMERIC(14, 2) NOT NULL,
    currency_code TEXT NOT NULL DEFAULT 'ILS',
    public_links JSONB NOT NULL DEFAULT '[]'::jsonb,
    external_provider_status TEXT NOT NULL DEFAULT 'not_sure',
    external_provider_url TEXT NOT NULL DEFAULT '',
    consent_accepted_at TIMESTAMPTZ NOT NULL,
    email_verification_token_hash TEXT,
    email_verification_expires_at TIMESTAMPTZ,
    email_verified_at TIMESTAMPTZ,
    admin_notified_at TIMESTAMPTZ,
    notification_attempted_at TIMESTAMPTZ,
    notification_error TEXT NOT NULL DEFAULT '',
    reviewed_by UUID REFERENCES goodraise.admin_users(id) ON DELETE SET NULL,
    review_note TEXT NOT NULL DEFAULT '',
    approved_organization_id UUID REFERENCES goodraise.organizations(id) ON DELETE SET NULL,
    approved_campaign_id UUID REFERENCES goodraise.campaigns(id) ON DELETE SET NULL,
    approved_admin_user_id UUID REFERENCES goodraise.admin_users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT campaign_applications_status CHECK (
      status IN ('pending_email_verification', 'submitted', 'under_review', 'changes_requested', 'approved', 'rejected', 'withdrawn')
    ),
    CONSTRAINT campaign_applications_email_normalized CHECK (applicant_email = LOWER(BTRIM(applicant_email))),
    CONSTRAINT campaign_applications_target_positive CHECK (target_amount > 0),
    CONSTRAINT campaign_applications_public_links_array CHECK (jsonb_typeof(public_links) = 'array')
);

CREATE UNIQUE INDEX uq_campaign_applications_verification_token
  ON goodraise.campaign_applications(email_verification_token_hash)
  WHERE email_verification_token_hash IS NOT NULL;

CREATE INDEX idx_campaign_applications_review_queue
  ON goodraise.campaign_applications(status, created_at DESC);

CREATE INDEX idx_campaign_applications_email
  ON goodraise.campaign_applications(applicant_email, created_at DESC);

CREATE TABLE goodraise.campaign_application_events (
    id UUID PRIMARY KEY,
    application_id UUID NOT NULL REFERENCES goodraise.campaign_applications(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    actor_email TEXT NOT NULL DEFAULT '',
    detail JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_campaign_application_events_application
  ON goodraise.campaign_application_events(application_id, created_at);
