# GoodRaise product and engineering TODO

Updated 2026-09-18. This is the current working backlog. Historical assessment documents may describe older limitations that have already been resolved; use this file for active work.

## Logged-in UX: one small change at a time

- [x] Clarify the current page: keep the post-login URL, browser title and active menu item aligned; separate My Projects from Users & Permissions. My Projects no longer requests the admin account list. Implemented locally; deployment pending.
- [x] Add shared spinner styling and pending labels to login/setup, logout and project-opening actions, prevent duplicate requests/navigation, restore retry after auth failures, and preserve new-tab/Back behavior. Implemented locally; deployment pending.
- [x] Apply a shared, centered loading overlay to login/logout, managed-page transitions, user saving and application decisions; block conflicting input, preserve failed-form values and distinguish successful saving from a failed list refresh. Implemented locally; deployment pending.
- [x] Keep managed navigation inside the current document; prepare the next view off-document, retain the previous page under the overlay and reveal the destination only after its data loads. Preserve native new-tab links and the existing single-request campaign/prize switch.
- [x] Keep the global header mounted across public and private routes; reserve action space during session lookup, use a fixed-width CTA and one font stylesheet, and avoid active-link font-weight shifts. Checked locally on desktop and narrow mobile screens; deployment pending.
- [x] Separate global navigation from campaign navigation: project cards expose role-appropriate actions; selected campaigns show their name, local management/project/prizes links and a working return to My Projects. Explicit portfolio links show the selector even with one project. Implemented locally; deployment pending.
- [ ] Review each authenticated page in order: My Projects → campaign dashboard → project/prizes → Users & Permissions → campaign applications. Include empty/error/loading states, keyboard navigation and mobile reflow.
- [ ] Measure cold/warm page loads before optimizing: session/portfolio requests, account/application requests, campaign payloads, database time and browser rendering. Remove duplicate work based on measurements.
- [ ] Correct the Node static-server cache rule: its broad hyphenated-name matcher treats stable `site-header.css`/`.js` filenames as immutable. Version shared assets and revalidate non-fingerprinted files; verify previously cached clients receive updates. Browser review encountered old header styles even after a normal reload.
- [x] Fix mobile overflow in My Projects, campaign management/design, project/prizes and Users & Permissions. Shared shrink-safe layout, wrapping status labels, contained charts/tables and in-bounds tooltips replace the overflowing RTL layout. Checked locally in Chrome at phone widths, with tablet/desktop regression checks; deployment pending.
- [x] Add one [shared responsive CSS foundation](ui-styles.md) for all pages, retaining shared buttons/header components and page-specific composition. Prize cards stack in rank order on mobile, winner amounts no longer squeeze names, and report regions support keyboard scrolling.
- [ ] Verify the application-review page with populated pending/approved/rejected cards at mobile widths; this pass verified the empty queue only. Also check real-device iOS Safari and Android Chrome, including touch scrolling, orientation and the on-screen keyboard.

## Now: finish the current production rollout

- [x] Take or confirm a recoverable production database snapshot before changing the schema. Manual snapshot created 2026-09-15 at 20:56:21 UTC; see the [rollout record](database-rollout-2026-09-16.md).
- [x] Apply migrations `004_completed_campaign_snapshots.sql`, `005_account_memberships.sql`, and `006_campaign_applications.sql` to the production Neon database.
- [x] Apply `007_site_admins.ts` through the Node migration runner and verify both owner accounts are active global site admins. Existing IDs/passwords were preserved; no new passwords were generated.
- [ ] Verify both owner accounts can log in and select projects using their existing production passwords.
- [x] Verify both migration names and checksums in `goodraise.schema_migrations`; rerun the runner to confirm it skips already-applied migrations.
- [x] Verify `campaign_public_snapshots`, `admin_memberships`, `campaign_applications`, `campaign_application_events`, `admin_users.access_config_hash`, constraints, and indexes exist.
- [ ] Backfill public snapshots for real campaigns that are already completed. The 2026-09-16 production check found zero campaigns with status `completed` and zero snapshots.
- [ ] Keep the three scraped Giveback placeholder campaigns limited to development or staging; do not seed them into production.
- [x] Verify production `/api/health`, `/api/auth/status`, and `/api/public/campaigns`: all returned HTTP 200 after migration; health reported `ok: true`.
- [ ] Verify production login, project selection, and completed-campaign pages end to end.
- [ ] Configure `GOODRAISE_PUBLIC_URL`, `GOODRAISE_EMAIL_MODE=resend`, `GOODRAISE_RESEND_API_KEY`, and `GOODRAISE_EMAIL_FROM`, then verify applicant, admin-notification, approval and rejection messages from a deploy preview.
- [ ] Confirm the contact recipients (`GOODRAISE_CONTACT_EMAILS`, defaults to Ran and Noam), verify real inbox delivery and Reply-To from a deploy preview, and confirm the inboxes are monitored. Local outbox tests do not verify real delivery.
- [ ] Before opening the public contact form broadly, add/verify edge-level abuse protection for `/api/contact` (the application quotas are best-effort across simultaneous Netlify instances) and define cleanup/retention for rate-limit metadata and received messages. Consider a privacy/accessibility-reviewed CAPTCHA only if needed.
- [ ] Add an explicit migration stage to deployment so application code is not published against an older schema. Keep migrations transactional, checksummed, rehearsed, and independently observable.
- [ ] Replace the hosted owner connection used by application functions with a least-privilege pooled runtime role; keep a direct owner URL only for migrations and protected backups.
- [ ] Give routine production inspection its own read-only database role/connection and test that it cannot write, change schema, or read credential-bearing configuration.
- [ ] Remove API bearer tokens and sensitive header values from `campaign_sources.payload`; resolve them from server-side managed secrets keyed by organization/campaign, then rotate the two currently stored credentials.
- [ ] Scope hosted database secrets by deploy context so production credentials are unavailable to previews and branch deploys unless explicitly required.

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

- [x] Record PostgreSQL as the source of truth for organizations, campaigns, memberships, donations, imports, applications, and lifecycle state; provider-specific features must not enter the domain or migration contract.
- [x] Add a persistent local PostgreSQL workflow, protected hosted-data backup/restore, separate local/source connection variables, and ordered portable migrations.
- [ ] Provision and rehearse a separate Netlify Database, restore a protected GoodRaise backup into it, and verify migrations/data/API behavior before any production cutover.
- [ ] Define the Netlify Database cutover and rollback window: freeze writes, take a final source backup, restore/verify, change only the hosted `GOODRAISE_DATABASE_URL`, monitor, and retain Neon until rollback is no longer needed.
- [ ] Consolidate the remaining Netlify Blobs state (auth limits/audits, campaign audits and job markers) into PostgreSQL before calling the platform single-database; preserve expiry, idempotency and audit semantics.
- [ ] Keep flexible campaign presentation/settings in PostgreSQL JSONB, with validation and schema-versioning rules.
- [ ] Treat `campaign_datasets` as a rebuildable browser projection rather than a second donation source of truth.
- [ ] Keep completed-campaign snapshots sanitized and persisted in PostgreSQL; use CDN and per-process memory only as replaceable caches.
- [ ] Keep media binaries in object storage and store only metadata/URLs in PostgreSQL.
- [ ] Decide whether distributed rate limiting needs a dedicated KV/Redis service; do not use it for financial or authorization truth.
- [ ] Evaluate PostgreSQL row-level security as defense in depth for tenant isolation.

## Later platform hardening

- [x] Use one shared, responsive footer across the homepage, public campaigns, campaign application, login, legal pages, and authenticated administration.
- [x] Replace the FAQ/contact placeholders with public `/faq` and `/contact` pages, remove the partners footer item everywhere, and send contact messages through the existing email service with validation, local outbox capture and delivery-failure feedback.
- [x] Add public תנאי שימוש, מדיניות פרטיות, and הצהרת נגישות links to that footer and add a first accessibility statement at `/accessibility`.
- [x] Add baseline accessibility improvements: skip-to-content navigation, semantic landmarks/headings, visible focus, accessible tab relationships/keyboard behavior, labelled authentication fields, table column scopes, reduced-motion support, and page-specific document titles.
- [ ] Confirm with the business/legal owner whether GoodRaise must appoint an accessibility coordinator and whether any statutory exemption applies; document the decision without treating an exemption as a product-quality target.
- [ ] Assign an internal accessibility owner and publish a real contact name, monitored email, phone or another accessible contact route, and the expected process for acknowledging and resolving accessibility reports.
- [ ] Confirm whether GoodRaise provides reception or service at a physical location. Publish the relevant accessibility arrangements—or clearly state that there is no public reception—on `/accessibility`.
- [ ] Inventory downloadable files and generated exports. Bring public PDFs and other digital documents into scope under SI 5568 Part 2, or provide an equivalent accessible HTML alternative where permitted.
- [ ] Define accessible campaign-content requirements for administrators: meaningful image alternative text, decorative-image handling, captions/transcripts for time-based media, descriptive links, readable copy, and no flashing content.
- [ ] Include accessibility as a blocking payment-provider selection criterion and verify the complete hosted checkout, authentication challenge, error, cancellation, refund and recurring-payment journeys with keyboard and a screen reader.
- [ ] Run an independent Israeli Standard 5568 AA audit across representative public and authenticated roles, including keyboard-only use, a current screen reader, 200% text resizing, narrow reflow, orientation, focus order, form errors, dialogs, charts/tables, campaign content and third-party flows.
- [ ] Record every audit finding with severity and ownership, remediate it, retest it, and keep the public statement honest until the blocking findings are closed.
- [ ] Add automated accessibility checks for representative homepage, archive, application, login, legal and authenticated journeys to CI; test keyboard focus and accessible names as well as static markup.
- [ ] Add accessibility acceptance criteria to new-feature reviews and campaign publishing, including regression checks whenever shared navigation, templates, forms or provider integrations change.
- [ ] Test and record the supported browser/screen-reader combinations, known limitations and available alternatives, then update the accessibility statement and its last-reviewed date after each material accessibility change and at a scheduled interval.
- [ ] Replace full manager dataset downloads with paginated transaction APIs and server-side aggregate/read-model tables.
- [ ] Measure production cold/warm API latency, database connection time, query time, payload size, and browser main-thread work.
- [ ] Bind external ingestion credentials to explicit organizations/campaigns instead of relying on one server-wide key.
- [ ] Move remaining critical auxiliary state into explicitly owned durable storage and document recovery behavior.
- [ ] Add verified-email invitation delivery and expiry/revocation handling.
- [ ] Establish scheduled backups, restore rehearsals, production monitoring, alerting, and an incident runbook.
- [ ] Finalize organization-specific legal, privacy, participation, and data-retention content.
- [ ] Add campaign-specific social metadata/server rendering if public discovery and sharing require it.
- [ ] Continue extracting new UI behavior from the compatibility controller into typed React components.
