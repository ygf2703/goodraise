# GoodRaise Multi-Tenancy

Updated: 2026-08-12

## Tenancy Model

GoodRaise now operates on four explicit levels:

1. Platform
2. Organization
3. Campaign
4. Campaign-owned records

Campaign-owned records include:

- config
- source configuration
- protected dataset
- ambassadors
- teams
- prizes
- audit events

## Identity Rules

### Organization

- `id` is the stable internal identifier
- `slug` is presentation and routing friendly
- `name` is display-only

### Campaign

- `id` is the stable internal identifier
- `organizationId` binds campaign ownership
- `slug` is presentation and routing friendly
- `name` is display-only

GoodRaise does not rely on slugs alone for storage or authorization decisions.

## Persistence Strategy

Canonical record keys:

- `organization:{organizationId}`
- `campaign:{organizationId}:{campaignId}`
- `campaign-config:{organizationId}:{campaignId}`
- `campaign-source:{organizationId}:{campaignId}`
- `campaign-dataset:{organizationId}:{campaignId}`

This means:

- updating one campaign does not rewrite another
- source settings are isolated per campaign
- datasets are isolated per campaign
- concurrency risk from one global registry blob is reduced

## Authorization Rules

Server-side authorization is mandatory for every protected operation.

Roles:

- `platform_admin`
- `organization_admin`
- `campaign_manager`
- `analyst`
- `viewer`

Rules:

- `platform_admin` can access all organizations and campaigns
- `organization_admin` can access all campaigns in the assigned organization only
- `campaign_manager` can access only explicitly assigned campaigns
- `analyst` is read-only within explicit scope
- `viewer` is limited read-only scope

Protected explicit-scope requests now return:

- `401` when unauthenticated
- `403` when the scope exists but is outside the user scope
- `404` when the explicit scope does not exist

## Dataset Isolation

Canonical dataset route:

- `GET /api/organizations/:orgId/campaigns/:campaignId/dataset`

Dataset isolation guarantees:

- A1 dataset never contains A2 rows
- A1 dataset never contains B1 rows
- switching active campaign must fetch a new scoped dataset
- intelligence calculations receive explicit campaign context

## Source Isolation

Canonical source routes:

- `GET /api/organizations/:orgId/campaigns/:campaignId/source`
- `POST|PUT /api/organizations/:orgId/campaigns/:campaignId/source`
- `POST /api/organizations/:orgId/campaigns/:campaignId/source/refresh`

Each campaign can maintain different:

- endpoint
- auth type
- headers
- body
- field mapping
- response format
- refresh cadence

## Secret Handling

Bearer tokens and sensitive source credentials remain server-side.

Browser-facing responses expose only redacted metadata:

```json
{
  "endpoint": "https://example.org/api",
  "authType": "bearer",
  "hasBearerToken": true,
  "bearerToken": ""
}
```

## Threat Model

### Primary Risks Addressed

- cross-campaign data leakage
- cross-organization access leakage
- unsafe API connector URLs
- redirect-based SSRF bypass
- browser retrieval of stored API tokens
- stale overwrite from giant shared registry writes

### Current Controls

- record-oriented persistence
- explicit campaign scope
- server-side authorization
- audit events
- source URL validation
- secret redaction
- isolation tests in CI

## Migration Model

Legacy registry migration:

- detects old registry structure
- writes independent organization/campaign/config/source/dataset records
- preserves campaign state where practical
- retains legacy artifacts after success
- writes a migration marker to avoid duplicate migration

## Known Transitional Gap

The Netlify/hosted path is the canonical multi-tenant runtime.

The local Python backend has not yet been fully migrated to the same record-oriented tenancy model, so local hosted-emulation validation should prefer the Netlify Functions path for authoritative isolation testing.
