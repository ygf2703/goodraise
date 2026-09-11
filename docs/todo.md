# GoodRaise product and engineering TODO

Updated 2026-09-11. This is the current working backlog. Historical assessment documents may describe older limitations that have already been resolved; use this file for active work.

## Now: finish the current production rollout

- [ ] Take or confirm a recoverable production database snapshot before changing the schema.
- [ ] Apply migrations `004_completed_campaign_snapshots.sql`, `005_account_memberships.sql`, and `006_campaign_applications.sql` to the production Neon database.
- [ ] Verify both migration names and checksums in `goodraise.schema_migrations`.
- [ ] Verify `campaign_public_snapshots`, `admin_memberships`, `campaign_applications`, `campaign_application_events`, `admin_users.access_config_hash`, constraints, and indexes exist.
- [ ] Backfill public snapshots for real campaigns that are already completed.
- [ ] Keep the three scraped Giveback placeholder campaigns limited to development or staging; do not seed them into production.
- [ ] Verify production `/api/health`, `/api/auth/status`, `/api/public/campaigns`, login, project selection, and completed-campaign pages.
- [ ] Configure `GOODRAISE_PUBLIC_URL`, `GOODRAISE_EMAIL_MODE=resend`, `GOODRAISE_RESEND_API_KEY`, and `GOODRAISE_EMAIL_FROM`, then verify applicant, admin-notification, approval and rejection messages from a deploy preview.
- [ ] Add an explicit migration stage to deployment so application code is not published against an older schema. Keep migrations transactional, checksummed, rehearsed, and independently observable.

## Campaign application flow

The initial flow is implemented. The CTA remains separate from login, and submitting a project request does not create an approved management account.

### Product decisions

- [x] Allow anyone to submit a campaign application publicly; submitting does not create an account or grant access.
- [x] Require the applicant to verify their email before the application enters the admin review queue.
- [x] Keep the first version to one submission without a server-side applicant draft.
- [x] Collect only applicant contact, organization identity, campaign name/category/purpose/optional story, target, optional public links, external-provider readiness, and consent.
- [x] Do not accept document uploads in the first version; use optional public links and decide rejected-application retention separately.
- [x] Use `pending_email_verification → submitted → approved | rejected` in the first UI. The schema reserves later review/change/withdrawal states.
- [x] Limit the review queue and decisions to site admins.
- [x] Do not allow applicant editing after submission in the first version; a matching unverified resubmission refreshes the pending request and token.
- [ ] Add a secure applicant edit/resubmission link if `changes_requested` is introduced later.
- [x] Send applicant verification, post-verification admin notification, approval/first-login, and rejection emails.
- [x] Notify all active site admins when an applicant verifies their email and the application becomes `submitted`; do not notify them for unverified submissions.
- [ ] Define anti-spam, rate-limit, privacy, consent, and applicant identity-verification requirements.
- [x] Keep campaign timing out of the public application; choose exact start/end dates during post-approval onboarding.
- [x] Continue linking or synchronizing with an external donation provider rather than processing donations directly in GoodRaise.
- [ ] Define what must be completed before approval versus during onboarding: external payment/donation provider setup, donation source, branding, ambassadors, prizes, campaign dates, and publication readiness.

### Payment-provider integration

- [ ] Select a payment provider that can securely collect one-time and recurring donations from campaign supporters using a provider-hosted checkout; GoodRaise must not collect or store card details.
- [ ] Define the commercial and operational requirements: supported currencies/payment methods, Israeli receipts and tax needs, fees, payouts, refunds, cancellations, chargebacks, recurring donations, and supporter experience.
- [ ] Design campaign-to-provider account ownership and onboarding, including whether each organization connects its own provider account or GoodRaise operates a platform/marketplace account.
- [ ] Add server-side provider credentials and campaign/account mappings with encryption, rotation, revocation, least-privilege access, and no secrets in public forms or browser payloads.
- [ ] Create provider checkout sessions server-side with campaign, amount, recurrence and return URLs validated by GoodRaise; never trust totals or campaign ownership supplied by the browser.
- [ ] Add signed, replay-safe and idempotent provider webhooks for successful, failed, refunded, cancelled and disputed payments.
- [ ] Reconcile provider transactions, fees, refunds and payouts against the GoodRaise donation ledger, with an admin-visible exception queue and audit trail.
- [ ] Define consent, privacy, PCI-responsibility boundaries, terms, receipt ownership, data retention, monitoring and incident handling with legal/accounting review.
- [ ] Test checkout success/cancellation, duplicate and out-of-order webhooks, retries, recurring lifecycle events, refunds, chargebacks, cross-campaign isolation and provider outages in the provider sandbox before production.

### Approval and onboarding contract

- [x] Approval creates or selects the organization, creates the campaign, approves the applicant's email, and assigns the initial `organization_admin` membership atomically in PostgreSQL.
- [x] Generate collision-resistant organization/campaign identities from the application reference; preserve existing user passwords/memberships and let the reviewer attach an existing organization.
- [x] Send the approved applicant through first-login password setup; never accept a password in the public application form.
- [ ] Add a guided setup checklist for the new `draft` campaign; approval already creates and links the draft.
- [ ] Define the minimum conditions for moving from `draft` to `live`, who authorizes that transition, and whether a preview link is available before launch.
- [ ] Record reviewer decisions, approval side effects, invitations, and lifecycle transitions in an audit trail.

### Implementation after product approval

- [x] Add relational application and review-event records through migration `006_campaign_applications.sql`; attachments and standalone invitation records are not needed in the first version.
- [x] Add the public one-page application and validated submission API.
- [x] Add hashed, expiring email-verification tokens and a verification endpoint that atomically moves an application into the admin review queue.
- [x] Omit applicant drafts from the first version.
- [x] Add a site-admin review queue with application details and approve/reject actions.
- [x] Add transactional email delivery with provider idempotency keys, local outbox capture, failure logging, and admin-notification diagnostics.
- [x] Implement approval as one idempotent PostgreSQL transaction with row locking and explicit account/organization handling.
- [ ] Add external donation-provider onboarding and configuration without collecting provider credentials in the public application form.
- [x] Deliver the first-login link after approval; the existing first login performs password setup.
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

- [x] Use one shared, responsive footer across the homepage, public campaigns, campaign application, login, legal pages, and authenticated administration.
- [x] Add public תנאי שימוש, מדיניות פרטיות, and הצהרת נגישות links to that footer and add a first accessibility statement at `/accessibility`.
- [x] Add baseline accessibility improvements: skip-to-content navigation, semantic landmarks/headings, visible focus, accessible tab relationships/keyboard behavior, labelled authentication fields, table column scopes, reduced-motion support, and page-specific document titles.
- [ ] Add the real accessibility contact name, email, phone, and any physical-service accessibility arrangements to `/accessibility` before opening the service publicly.
- [ ] Run an independent Israeli Standard 5568 AA audit, including manual keyboard, screen-reader, zoom/reflow, mobile, form-error, chart/table, campaign-content and third-party payment-flow testing; record and remediate the findings.
- [ ] Add automated accessibility checks for representative public and authenticated journeys to CI; automated checks supplement rather than replace the manual audit.
- [ ] Replace full manager dataset downloads with paginated transaction APIs and server-side aggregate/read-model tables.
- [ ] Measure production cold/warm API latency, database connection time, query time, payload size, and browser main-thread work.
- [ ] Bind external ingestion credentials to explicit organizations/campaigns instead of relying on one server-wide key.
- [ ] Move remaining critical auxiliary state into explicitly owned durable storage and document recovery behavior.
- [ ] Add verified-email invitation delivery and expiry/revocation handling.
- [ ] Establish scheduled backups, restore rehearsals, production monitoring, alerting, and an incident runbook.
- [ ] Finalize organization-specific legal, privacy, participation, and data-retention content.
- [ ] Add campaign-specific social metadata/server rendering if public discovery and sharing require it.
- [ ] Continue extracting new UI behavior from the compatibility controller into typed React components.
