# GoodRaise Architecture

Updated: 2026-08-12

## System Position

GoodRaise is now architected as a multi-campaign operations platform with a clear hierarchy:

`Platform -> Organization -> Campaign -> Dataset / Source / Users / Ambassadors / Intelligence`

The canonical hosted path is the Netlify Functions stack plus record-oriented persistence. The public browser shell and the protected manager shell consume campaign-scoped resources rather than a single global dataset/config blob.

## Canonical Tenancy Model

### Organization

Required identity:

- `id`
- `slug`
- `name`
- `status`
- `createdAt`
- `updatedAt`

### Campaign

Required identity:

- `id`
- `organizationId`
- `slug`
- `name`
- `status`
- `startAt`
- `endAt`
- `target`
- `currency`
- `createdAt`
- `updatedAt`

Every campaign-owned record is stored or resolved by:

- `organizationId`
- `campaignId`

This now applies to:

- campaign config
- source config
- protected dataset
- ambassadors
- teams
- prizes
- audit events

## Persistence Boundaries

The canonical persistence boundary is implemented in:

- [netlify/lib/platform-store.mjs](C:\Users\noamf\Documents\Codex\2026-07-27\mu\netlify\lib\platform-store.mjs)
- [netlify/lib/campaign-repositories.mjs](C:\Users\noamf\Documents\Codex\2026-07-27\mu\netlify\lib\campaign-repositories.mjs)

Repository responsibilities:

- `OrganizationRepository` behavior
- `CampaignRepository` behavior
- `CampaignConfigRepository` behavior
- `CampaignDatasetRepository` behavior
- `CampaignSourceRepository` behavior

Current storage backends:

- Netlify Blobs in hosted mode
- local JSON dev store in verification/local hosted emulation

The UI and intelligence layer do not need to know whether data is coming from Blobs today or SQL/Postgres later.

## Record Key Strategy

The old monolithic registry blob is no longer the canonical persistence unit.

Current record keys:

- `organization:{organizationId}`
- `campaign:{organizationId}:{campaignId}`
- `campaign-config:{organizationId}:{campaignId}`
- `campaign-source:{organizationId}:{campaignId}`
- `campaign-dataset:{organizationId}:{campaignId}`
- `audit:{timestamp}:{random}`

This prevents `Campaign A` updates from rewriting `Campaign B`.

## Main Runtime Components

### Dashboard Build Layer

- [work/build_yellow_dashboard.py](C:\Users\noamf\Documents\Codex\2026-07-27\mu\work\build_yellow_dashboard.py)

Responsibilities:

- build public/static shell
- inject browser runtime
- prepare sanitized public payload
- load the protected manager shell
- derive campaign duration from actual campaign dates instead of a fixed 10-day assumption

### Intelligence Layer

- [work/frontend/goodraise-intelligence.js](C:\Users\noamf\Documents\Codex\2026-07-27\mu\work\frontend\goodraise-intelligence.js)

Responsibilities:

- health
- forecast
- velocity
- ambassador state
- intervention priorities
- attention-now
- fingerprint

This layer now fails fast when `organizationId` or `campaignId` is missing from the invocation context.

### Hosted Manager Runtime

- [netlify/functions/auth.mjs](C:\Users\noamf\Documents\Codex\2026-07-27\mu\netlify\functions\auth.mjs)
- [netlify/lib/auth-store.mjs](C:\Users\noamf\Documents\Codex\2026-07-27\mu\netlify\lib\auth-store.mjs)
- [netlify/lib/campaign-store.mjs](C:\Users\noamf\Documents\Codex\2026-07-27\mu\netlify\lib\campaign-store.mjs)
- [netlify/lib/source-store.mjs](C:\Users\noamf\Documents\Codex\2026-07-27\mu\netlify\lib\source-store.mjs)
- [netlify/lib/source-security.mjs](C:\Users\noamf\Documents\Codex\2026-07-27\mu\netlify\lib\source-security.mjs)

Responsibilities:

- auth
- password setup
- password change
- session persistence
- scoped campaign config read/write
- scoped source config read/write
- scoped source refresh
- scoped dataset delivery
- organization campaign listing
- campaign creation
- audit trail

## Request Model

Canonical protected routes are organization/campaign scoped:

- `GET /api/organizations/:orgId/campaigns`
- `POST /api/organizations/:orgId/campaigns`
- `GET /api/organizations/:orgId/campaigns/:campaignId`
- `POST|PUT /api/organizations/:orgId/campaigns/:campaignId`
- `GET /api/organizations/:orgId/campaigns/:campaignId/dataset`
- `GET /api/organizations/:orgId/campaigns/:campaignId/source`
- `POST|PUT /api/organizations/:orgId/campaigns/:campaignId/source`
- `POST /api/organizations/:orgId/campaigns/:campaignId/source/refresh`

Legacy `/api/admin/*` endpoints still exist as compatibility adapters, but the core logic now resolves an explicit organization/campaign scope.

## Authorization Model

Canonical authorization entrypoint:

- [netlify/lib/authorization.mjs](C:\Users\noamf\Documents\Codex\2026-07-27\mu\netlify\lib\authorization.mjs)

Canonical access resolver:

- [netlify/lib/auth-store.mjs](C:\Users\noamf\Documents\Codex\2026-07-27\mu\netlify\lib\auth-store.mjs)

`resolveScopedAccess()` now behaves as follows:

- anonymous -> `401`
- explicit forbidden scope -> `403`
- explicit unknown scope -> `404`
- implicit scope -> first accessible campaign only when no explicit scope was requested

This closes the previous security bug where a forbidden request could silently fall back to another accessible campaign.

## Campaign Data Flow

1. Manager authenticates.
2. Session status returns accessible campaign summaries.
3. Browser runtime resolves active `organizationId/campaignId`.
4. Runtime fetches:
   - campaign config
   - source config
   - protected dataset
5. Runtime recomputes intelligence only for that campaign.
6. Campaign switching reloads target campaign data rather than reusing the previous dataset.

## Migration

Migration from the legacy campaign registry is handled by:

- [netlify/lib/campaign-repositories.mjs](C:\Users\noamf\Documents\Codex\2026-07-27\mu\netlify\lib\campaign-repositories.mjs)

Behavior:

- detect legacy registry blob
- create organization and campaign records
- copy source config per campaign
- copy legacy protected dataset per campaign when present
- preserve active campaign marker where possible
- retain legacy artifacts after successful migration
- write a migration marker to prevent duplicate migration

## Security Boundaries

### Protected Dataset

There is no longer one canonical global protected dataset.

Hosted canonical access is campaign-scoped and returned by:

- `GET /api/organizations/:orgId/campaigns/:campaignId/dataset`

### Source Secrets

Source secrets remain server-side. Browser responses only return redacted config:

- `hasBearerToken: true|false`
- `bearerToken: ""`

### Source Connector Hardening

The hosted source connector now blocks:

- `file://`
- `ftp://`
- localhost
- private IPv4 ranges
- loopback
- link-local
- metadata endpoints
- internal hostnames
- unsafe redirects

It also enforces:

- timeout
- response size limit
- redirect limit

## Transitional Areas

The hosted multi-tenant path is now the canonical architecture.

The local Python backend remains a transitional fallback and is not yet fully aligned with the record-oriented hosted persistence model. It should not be treated as the long-term source of truth for multi-tenant production hosting.
