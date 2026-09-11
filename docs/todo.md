# GoodRaise product and engineering TODO

Updated 2026-09-11. This is the current working backlog. Historical assessment documents may describe older limitations that have already been resolved; use this file for active work.

## Now: finish the current production rollout

- [ ] Take or confirm a recoverable production database snapshot before changing the schema.
- [ ] Apply migrations `004_completed_campaign_snapshots.sql` and `005_account_memberships.sql` to the production Neon database.
- [ ] Verify both migration names and checksums in `goodraise.schema_migrations`.
- [ ] Verify `campaign_public_snapshots`, `admin_memberships`, `admin_users.access_config_hash`, constraints, and indexes exist.
- [ ] Backfill public snapshots for real campaigns that are already completed.
- [ ] Keep the three scraped Giveback placeholder campaigns limited to development or staging; do not seed them into production.
- [ ] Verify production `/api/health`, `/api/auth/status`, `/api/public/campaigns`, login, project selection, and completed-campaign pages.
- [ ] Add an explicit migration stage to deployment so application code is not published against an older schema. Keep migrations transactional, checksummed, rehearsed, and independently observable.

## Next: define the “start a project” flow

This flow has not been implemented. The existing CTA is deliberately separate from login, and submitting a project request must not silently create an approved management account.

### Product decisions

- [ ] Decide who may submit: fully public applicants, invited applicants, or both.
- [ ] Decide whether an applicant can save a draft. If so, define access without turning the form into self-registration (for example, a time-limited email link).
- [ ] Define the minimum application fields: applicant/contact details, organization identity, campaign purpose, target, expected dates, source/payment needs, story, media, and consent.
- [ ] Decide which organization/legal documents may be uploaded, their allowed formats and sizes, and how long rejected applications are retained.
- [ ] Define application statuses and transitions. Proposed starting point: `draft → submitted → under_review → changes_requested → approved | rejected | withdrawn`.
- [ ] Define who can review, request changes, approve, reject, reopen, and view application history. Site admins remain above all organizations.
- [ ] Decide whether applicants can edit after submission and how resubmission/version history works.
- [ ] Define email notifications for submission, change requests, approval, rejection, and the first approved-user invitation.
- [ ] Define anti-spam, rate-limit, privacy, consent, and applicant identity-verification requirements.
- [ ] Define what must be completed before approval versus during onboarding: payment provider, donation source, branding, ambassadors, prizes, campaign dates, and publication readiness.

### Approval and onboarding contract

- [ ] Specify the exact atomic result of approval: create or select the organization, create the campaign, approve the applicant's email, and assign the initial `organization_admin` membership.
- [ ] Define duplicate handling when the organization, email, or proposed campaign already exists.
- [ ] Send the approved applicant through first-login password setup; never accept a password in the public application form.
- [ ] Open the new campaign in `draft` status and route the new organization admin to a guided setup checklist.
- [ ] Define the minimum conditions for moving from `draft` to `live`, who authorizes that transition, and whether a preview link is available before launch.
- [ ] Record reviewer decisions, approval side effects, invitations, and lifecycle transitions in an audit trail.

### Implementation after product approval

- [ ] Add relational application, applicant, review-event, attachment-metadata, and invitation records through a numbered migration.
- [ ] Add the public application page and validated submission API.
- [ ] Add applicant draft/resubmission access only if the selected product flow requires it.
- [ ] Add a site-admin review queue and application detail screen.
- [ ] Implement approval as one idempotent database transaction with explicit duplicate protection.
- [ ] Add invitation delivery and first-login onboarding.
- [ ] Add audit logging, retention/deletion jobs, monitoring, and operational documentation.
- [ ] Test authorization, state transitions, concurrent approval, retries, duplicate submissions, malicious input, attachment limits, and tenant isolation.
- [ ] Validate the complete public submission → admin review → approval → password setup → draft campaign journey in staging before production.

## Architecture decisions to formalize

- [ ] Record PostgreSQL as the source of truth for organizations, campaigns, memberships, donations, imports, applications, and lifecycle state.
- [ ] Keep flexible campaign presentation/settings in PostgreSQL JSONB, with validation and schema-versioning rules.
- [ ] Treat `campaign_datasets` as a rebuildable browser projection rather than a second donation source of truth.
- [ ] Keep completed-campaign snapshots sanitized and persisted in PostgreSQL; use CDN and per-process memory only as replaceable caches.
- [ ] Keep media binaries in object storage and store only metadata/URLs in PostgreSQL.
- [ ] Decide whether distributed rate limiting needs a dedicated KV/Redis service; do not use it for financial or authorization truth.
- [ ] Evaluate PostgreSQL row-level security as defense in depth for tenant isolation.

## Later platform hardening

- [ ] Replace full manager dataset downloads with paginated transaction APIs and server-side aggregate/read-model tables.
- [ ] Measure production cold/warm API latency, database connection time, query time, payload size, and browser main-thread work.
- [ ] Bind external ingestion credentials to explicit organizations/campaigns instead of relying on one server-wide key.
- [ ] Move remaining critical auxiliary state into explicitly owned durable storage and document recovery behavior.
- [ ] Add verified-email invitation delivery and expiry/revocation handling.
- [ ] Establish scheduled backups, restore rehearsals, production monitoring, alerting, and an incident runbook.
- [ ] Finalize organization-specific legal, privacy, participation, and data-retention content.
- [ ] Add campaign-specific social metadata/server rendering if public discovery and sharing require it.
- [ ] Continue extracting new UI behavior from the compatibility controller into typed React components.

