# Multi-tenancy and access

Updated 2026-09-08 after platform consolidation. Sources: [authorization](../backend/services/authorization.mjs), [auth store](../backend/services/auth-store.mjs), [domain model](../backend/services/multi-tenant-model.mjs), and [shared Node server](../backend/server.ts).

## Tenant identity

Organizations group campaigns. Application records use stable string `id` plus presentation/routing `slug`; SQL records use UUID primary keys, with `app_id`/slug mapping at the repository boundary. Campaign operations resolve both organization and campaign.

Node records are stored under organization/campaign-specific keys or scoped SQL rows. The browser receives accessible campaign summaries, selects a scope, and requests its dataset/config/source. Switching campaigns reloads data. Browser state and draft configuration are not permission authorities.

The relational donor table is global. Campaign isolation is enforced on transactions and application requests; there is no checked-in PostgreSQL row-level security policy or separate database per tenant.

## Role policy

| Role | Scope | Main permitted operations |
| --- | --- | --- |
| `viewer` | Assigned campaigns in assigned organization | Campaign configuration view; no protected donation dataset |
| `analyst` | Assigned campaigns in assigned organization | Viewer operations plus protected dataset |
| `campaign_manager` | Assigned campaigns in assigned organization | Dataset, campaign/source updates, source refresh, registrations, manual contributions, questions |
| `organization_admin` | All campaigns in assigned organization | Manager operations plus campaign creation |
| `platform_admin` | All organizations and campaigns | All implemented operations |

The policy first checks role threshold, then organization membership, then explicit campaign assignments for non-admin roles. Organization match can use ID or slug; campaign assignment can use ID or slug. Missing assignments do not imply access to every campaign.

The action table lists `campaign_duplicate`, but there is no dedicated duplicate endpoint. Creating a new campaign still reaches creation authorization. The organization campaign-list route checks an organization with no campaign, so lower roles can be rejected even though the action's minimum role is viewer; their auth status still supplies accessible campaigns.

An explicit forbidden scope never silently selects another campaign. Missing scope on legacy routes can select the first accessible campaign. Anonymous requests return 401; denied requests generally return 403. An unknown campaign under an existing organization may also return 403; the current resolver does not universally distinguish that case as 404.

## Authentication lifecycle

Manager records come from `GOODRAISE_MANAGER_EMAILS`, a local access file, or explicitly enabled example managers. A string email is normalized to **platform_admin**. Use object records with explicit roles for scoped access:

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

The initial setup route checks that the email is an active allowed account without a password, matches confirmation, and has a password of at least eight characters. It then stores a salted PBKDF2-SHA256 hash and issues a session. Node uses 200,000 iterations, a 16-byte salt, and a 32-byte digest; comparison uses a timing-safe check.

**There is no email-ownership verification or invitation token in first-password setup.** Knowing an unclaimed allowed email is sufficient to attempt account setup. This is a concrete lifecycle gap, not a verified invitation system.

Node sessions use random tokens and a 30-day lifetime. Cookies are HttpOnly, SameSite=Lax, Path=/, and Secure for HTTPS/Netlify. Password change invalidates prior sessions and issues a replacement; logout removes the current session. Node auth rate limiting tracks email/client-address attempts: five failed attempts within a 15-minute window lead to a 20-minute lockout.

The former unauthenticated local password-reset route has been removed. Both local and hosted access now use the Node password/session policy. Generic cookies and auth-store names accept legacy reads as described in the [migration record](platform-migration.md).

Manager seed configuration and stored admin records are separate state. This review does not establish that removing an email from configuration revokes every previously persisted account/session; access removal requires explicit verification of stored state.

## Public-data boundary

The static shell contains no donor rows. The public dataset API blanks donor email, donor name, city, and charge-result details. Its rows still expose transaction IDs, timestamps, amounts, ambassador names, and status. Calling these payloads anonymous aggregate data would be inaccurate.

The public config response whitelists campaign basics, branding, donation settings, and goals/prizes. The hosted `getPublicDataset()` checks campaign existence, but has no explicit `status === "live"` publication gate. `getPublicContext()` ranks campaigns primarily by data availability/count and update time; it does not restrict selection to live campaigns. Draft status alone should not be treated as a privacy boundary.

The payment handoff places donor fields in a configured provider URL's query string. Those fields leave GoodRaise's browser application for that provider. The optional question assistant excludes donor fields from its computed context, but includes ambassador labels and the raw manager question; see [intelligence](intelligence-model.md#question-assistant).

## Source credentials and network access

Dedicated `api.bearerToken` values remain server-side in the source record; redacted responses return an empty token plus `hasBearerToken`. A blank incoming token preserves the existing token unless the explicit clear flag is used. Custom `headersText` and `bodyText` are not generically secret-redacted, so the dedicated token field's guarantee must not be generalized to every configurable string.

Node source fetching enforces scheme checks, listed internal/private targets, DNS inspection, redirect checks, a default 15-second timeout per request, a 5 MiB response cap, and a default three redirects. These are implemented controls, not a complete security certification. DNS validation and the actual fetch are separate operations, and redirect requests retain configured headers; assess those details before broadening connector access.

External ingest API keys are server-wide strings, not tenant-bound credentials. They authorize ingestion into any resolvable campaign selected in the path. Tests for manager scope do not prove integration-key tenant isolation.

## Verification boundary

The existing multi-campaign tests exercise several users and organizations using development stores. Local-backend tests launch the shared Node server and check scope plus unsafe-source behavior. Public-projection and assistant tests check selected data redaction properties.

These tests do not establish production database isolation, first-user identity verification, complete connector resistance, or deployed access configuration. See the [assessment](engineering-assessment.md) for follow-up priorities and actual test results.
