# Multi-tenancy and access

Updated 2026-09-10 for approved-user memberships and completed-project access. Sources: [authorization](../backend/services/authorization.mjs), [auth store](../backend/services/auth-store.mjs), [domain model](../backend/services/multi-tenant-model.mjs), and [shared Node server](../backend/server.ts).

## Tenant identity

Organizations group campaigns. Application records use stable string `id` plus presentation/routing `slug`; SQL records use UUID primary keys, with `app_id`/slug mapping at the repository boundary. Campaign operations resolve both organization and campaign.

Node records are stored under organization/campaign-specific keys or scoped SQL rows. The browser receives accessible campaign summaries, selects a scope, and requests its dataset/config/source. Switching campaigns reloads data. Browser state and draft configuration are not permission authorities.

The relational donor table is global. Campaign isolation is enforced on transactions and application requests; there is no checked-in PostgreSQL row-level security policy or separate database per tenant.

## Role policy

| Role | Scope | Main permitted operations |
| --- | --- | --- |
| `viewer` | Assigned campaigns | Project overview and read-only reports; receives aggregate campaign data, not donation rows or exports |
| `analyst` | Assigned campaigns | Viewer operations plus analytics/questions and transaction rows with donor/contact fields masked |
| `campaign_manager` | Assigned campaigns | Full dataset, public content/media, source, imports and operational campaign work |
| `organization_admin` | Entire assigned organization | Manager operations plus campaign creation and lifecycle transitions |
| `platform_admin` | Global | All organizations/campaigns plus user approval, memberships, deactivation and roles |

The policy resolves the effective role from the requested scope and then checks its threshold. One account can be an analyst in one project, a viewer in another, and an organization admin elsewhere. Organization match can use ID or slug; campaign assignment can use ID or slug. Missing assignments do not imply access to every campaign. Platform admins are the only global role.

The action table lists `campaign_duplicate`, but there is no dedicated duplicate endpoint. Creating or duplicating a new campaign still reaches organization-admin creation authorization. A campaign membership permits the assigned campaign to appear in its organization list; organization admins see all campaigns in that organization. Auth status supplies every accessible campaign with its effective `accessRole`.

An explicit forbidden scope never silently selects another campaign. Missing scope on legacy routes can select the first accessible campaign. Anonymous requests return 401; denied requests generally return 403. An unknown campaign under an existing organization may also return 403; the current resolver does not universally distinguish that case as 404.

## Authentication lifecycle

There is no self-registration. Initial accounts come from `GOODRAISE_MANAGER_EMAILS`, a local access file, or explicitly enabled example users. A string email is normalized to **platform_admin**. A signed-in site admin can then approve/deactivate users and replace memberships through `/admin/users` or `/api/admin/accounts`. New approved users have no password until their first login.

Legacy object records with one role/scope are still accepted and migrated:

```json
[
  {
    "email": "campaign-manager@example.org",
    "role": "campaign_manager",
    "organizationId": "example-org",
    "organizationSlug": "example-org",
    "campaignIds": ["autumn-drive"]
  }
]
```

New configuration can express multiple memberships:

```json
[
  {
    "email": "person@example.org",
    "role": "analyst",
    "memberships": [
      {"organizationId": "org-a", "campaignId": "campaign-a", "role": "analyst"},
      {"organizationId": "org-b", "campaignId": "campaign-b", "role": "viewer"},
      {"organizationId": "org-c", "role": "organization_admin"}
    ]
  }
]
```

The initial setup route checks that the email is an active allowed account without a password, matches confirmation, and has a password of at least eight characters. It then stores a salted PBKDF2-SHA256 hash and issues a session. Node uses 200,000 iterations, a 16-byte salt, and a 32-byte digest; comparison uses a timing-safe check.

**There is no email-ownership verification or invitation token in first-password setup.** Knowing an unclaimed approved email is sufficient to attempt account setup. Account approval is therefore an access-control mechanism, not a verified email invitation.

Node sessions use random tokens and a 30-day lifetime. Cookies are HttpOnly, SameSite=Lax, Path=/, and Secure for HTTPS/Netlify. Password change invalidates prior sessions and issues a replacement; logout removes the current session. Node auth rate limiting tracks email/client-address attempts: five failed attempts within a 15-minute window lead to a 20-minute lockout.

The former unauthenticated local password-reset route has been removed. Both local and hosted access now use the Node password/session policy. Generic cookies and auth-store names accept legacy reads as described in the [migration record](platform-migration.md).

Configured seed accounts are reconciled on access. Their access hash prevents unchanged memberships from being rewritten, while a changed configured assignment is applied on the next account lookup. Site-admin deactivation deletes that user's sessions; removing memberships leaves the account signed in but with a no-project state.

After login, an account with one campaign is sent directly to it; multiple campaigns show an account selector; no memberships show a no-project state. The selector separates active and completed campaigns. A removed membership immediately loses private access, while the anonymous sanitized public archive remains available.

Completed campaign totals and operational state are frozen. Campaign managers may update public copy/media, but source changes, source refresh, donation ingestion, manual contributions and ambassador imports return `409`. Only organization/site admins can close or reopen a campaign. Site operators can deliberately rebuild a frozen public snapshot through the backfill command.

## Public-data boundary

The static shell contains no donor rows. A viewer's campaign response contains aggregate totals and ambassador totals with an empty `rows` array. An analyst's protected dataset contains transaction details but masks donor name, email, city and charge result. Campaign managers and higher roles receive the full protected dataset. The campaign-page projection used by analyst/manager views redacts donor fields.

The campaign-page config response whitelists campaign basics, branding, donation settings, and goals/prizes. These pages require an assigned account, but have no explicit `status === "live"` gate. Draft status alone should not be treated as a privacy boundary. Separately, `/api/public/campaigns` exposes only sanitized snapshots of completed campaigns and never falls back to datasets or the ledger.

The payment handoff places donor fields in a configured provider URL's query string. Those fields leave GoodRaise's browser application for that provider. The optional question assistant excludes donor fields from its computed context, but includes ambassador labels and the raw manager question; see [intelligence](intelligence-model.md#question-assistant).

## Source credentials and network access

Dedicated `api.bearerToken` values remain server-side in the source record; redacted responses return an empty token plus `hasBearerToken`. A blank incoming token preserves the existing token unless the explicit clear flag is used. Custom `headersText` and `bodyText` are not generically secret-redacted, so the dedicated token field's guarantee must not be generalized to every configurable string.

Node source fetching enforces scheme checks, listed internal/private targets, DNS inspection, redirect checks, a default 15-second timeout per request, a 5 MiB response cap, and a default three redirects. These are implemented controls, not a complete security certification. DNS validation and the actual fetch are separate operations, and redirect requests retain configured headers; assess those details before broadening connector access.

External ingest API keys are server-wide strings, not tenant-bound credentials. They authorize ingestion into any resolvable non-completed campaign selected in the path. Tests for user scope do not prove integration-key tenant isolation.

## Verification boundary

The shared authorization cases run against both development storage and disposable PostgreSQL. They cover different roles for one account across two organizations, viewer aggregate-only responses, analyst masking, site-admin approval, first-login setup, self-demotion protection, campaign lifecycle rules, completed data locks, reassignment and session revocation. Local-backend tests launch the shared Node server and check scope plus unsafe-source behavior.

These tests do not establish production database isolation, first-user identity verification, complete connector resistance, or deployed access configuration. See the [assessment](engineering-assessment.md) for follow-up priorities and actual test results.
