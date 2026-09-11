# API contracts

Updated 2026-09-11. This is the shared Node contract, implemented by [route dispatch](../backend/http-handler.mjs) and [application boundary](../backend/app.ts), used by local and Netlify adapters. There is no OpenAPI specification or versioned API prefix.

## Conventions and access

Use JSON bodies and `Content-Type: application/json`. Session-protected browser requests use `credentials: "include"`. Successful auth sets `goodraise_admin_session`; the browser should not read or manage this HttpOnly cookie itself. JSON responses normally use `Cache-Control: no-store`.

In the table below, **C** means `/api/organizations/:organizationId/campaigns/:campaignId`. Prefer identifiers returned by auth/campaign APIs. The SQL ingestion resolver accepts UUIDs, application IDs, or slugs; do not assume identical identifier handling in every route.

Role ordering is `viewer < analyst < campaign_manager < organization_admin < platform_admin`. Roles below platform admin come from membership records and are evaluated for the requested organization/campaign; the same account may have different roles in different scopes. See [multi-tenancy](multi-tenancy.md). Ingest uses a configured API key instead of a user session.

Protected scoped routes validate the session and resolve the requested organization/campaign directly before reading operational data. This permission check does not load campaign summaries, configuration or donation datasets. Application IDs and slugs resolve to canonical identities; route scope takes precedence over query parameters. A missing explicit campaign returns `404`, and an existing campaign outside the user's permissions returns `403`, without falling back to another campaign. Legacy routes with incomplete scope select a viewable campaign from identity records, then enforce the requested action's role.

`/api/auth/status` still explicitly returns accessible campaign summaries. The campaign configuration endpoint still returns its portfolio/registry. Those response contracts are preserved. SQL summaries use identity filtering followed by a batch amount/metadata projection; configuration contexts omit operational datasets.

Account emails are case-insensitive: setup/login input is trimmed and lowercased, canonical storage is lowercase, and SQL lookups use indexed equality. SQL authentication requires migration `003_normalize_admin_email.sql` before this code is deployed. It preserves account IDs and credentials, but refuses case/whitespace collisions instead of merging accounts.

## Route inventory

| Method | Route | Access | Body / result |
| --- | --- | --- | --- |
| GET | `/api/health` | Public | Runtime/persistence counts and metadata; performs store reads/seeding |
| GET | `/api/public-context` | Viewer+ in an assigned scope | Legacy selected organization/campaign context |
| GET | `/api/public/campaigns?limit=8` | Public | Cached cards for completed campaigns; maximum 100 |
| GET | `/api/public/campaigns/:organization/:campaign` | Public | One cached, sanitized completed-campaign snapshot |
| POST | `/api/applications` | Public | Minimal campaign application; creates/refreshes an unverified request and sends the applicant verification message |
| POST | `/api/applications/verify` | Public with token | `{token}`; verifies the applicant email, moves the request to `submitted`, and notifies active site admins |
| GET | `/api/auth/status` | Public/session-aware | `authenticated`, identity/role/scope/accessible campaign metadata when signed in |
| POST | `/api/auth/login` | Approved active account | `{email, password}`; cookie or setup-required/error response |
| POST | `/api/auth/setup` | Allowed account without password | `{email, password, confirmPassword}`; creates password and session |
| POST | `/api/auth/logout` | Session-aware | Deletes session and expires cookie |
| POST | `/api/auth/change-password` | Signed-in account | `{currentPassword, newPassword, confirmPassword}` |
| GET | `/api/admin/accounts` | Site admin | Approved users, password/activity state, memberships and available organizations/campaigns |
| POST | `/api/admin/accounts` | Site admin | Creates or replaces an account's active/site-admin/membership state; new users set a password at first login |
| GET | `/api/admin/applications` | Site admin | Verified application review queue plus organizations available for optional attachment |
| POST | `/api/admin/applications/:id/decision` | Site admin | `{action: "approve" | "reject", reviewNote?, organizationId?}`; approval creates the campaign/account contract atomically in PostgreSQL |
| GET | `/api/organizations/:organizationId/campaigns` | Organization access | `{organizationId, campaigns}` |
| POST | `/api/organizations/:organizationId/campaigns` | Organization admin+ | Campaign snapshot or `{config: snapshot}`; `201`, registry-shaped config |
| GET | C | Campaign manager+ in scope | `{config: registry, activeCampaign, portfolio, updatedAt, updatedBy, message}` |
| POST, PUT | C | Campaign manager+; creation and lifecycle changes need organization admin+ | `{config: snapshotOrRegistry}`; save result |
| GET | C`/dataset` | Analyst+ in scope | Scoped rows/meta; analyst donor/contact fields are masked, managers receive full rows |
| GET | C`/public-dataset` | Viewer+ in scope | Viewer receives aggregate totals/ambassador totals and no donation rows; analyst+ receives redacted rows |
| GET | C`/source` | Campaign manager+ | Source config with dedicated bearer token redacted |
| POST, PUT | C`/source` | Campaign manager+ | `{config: sourceConfig}` |
| POST | C`/source/refresh` | Campaign manager+ | Fetches/persists data; returns summary, then client reads dataset |
| POST | C`/ambassadors/import` | Campaign manager+; SQL required | `{records: [...], sourceLabel?}`; counts and skipped row indices |
| POST | C`/manual-contributions` | Campaign manager+; SQL required | `{enteredBy, amount, attributedAt?, requestId?}`; `201` created / `200` existing |
| POST | C`/ingest` | Ingest API key; SQL required | Single donation record or wrapped record; `201` created / `200` duplicate |
| POST | C`/insights/questions` | Analyst+ | `{question}`; answer and server data scope |

Auth status returns memberships plus accessible campaign summaries carrying the effective `accessRole`. The browser uses them for direct single-project routing and for active/completed project sections. A campaign membership also permits the assigned campaign to appear in an organization campaign list; organization admins see every campaign in their organization.

There are no general delete endpoints, payment endpoint, hosted password-recovery endpoint, or paginated dataset query in this route inventory. Manual account approval at `/api/admin/accounts` remains site-admin-only and does not itself prove mailbox ownership; the campaign-application flow performs its own applicant email verification.

Public application input contains contact details, organization identity, campaign name/category/purpose/story, target, optional public links, external-provider readiness and consent. It deliberately excludes campaign dates, passwords and provider secrets. Verification tokens are random, stored only as hashes, expire after 24 hours and are consumed through a POST action from `/start/verify`. Unverified applications never appear in the admin queue. Public submissions have a hidden bot trap and a bounded per-email/client submission window; this is abuse mitigation, not a replacement for an edge/distributed rate limiter at higher traffic.

PostgreSQL approval locks the application row and creates or selects the organization, campaign/config/source/empty dataset, approved user and organization membership in one transaction. Repeated approval is idempotent. Existing users retain their password and other memberships. Rejection requires a reviewer note. Applicant verification, site-admin notification and decision mail use provider idempotency keys; provider failures are logged and surfaced through stored notification diagnostics or the decision response.

Completed-campaign endpoints are anonymous and aggregate-only. They return public cache headers, a Netlify CDN policy and an ETag; matching `If-None-Match` requests receive `304`. The index cache is refreshed from persisted snapshots at most every five minutes per Node instance. Detail requests use the same warmed in-memory snapshot and never fall back to the donation ledger.

## Campaign configuration

The snapshot contains nested areas such as `organization`, `basics`, `branding`, `donation`, `ambassadors`, `teams`, `goals`, `permissions`, `dataSource`, and `meta`. See `normalizeCampaignSnapshot()` and frontend snapshot helpers for defaults.

Example shape for creating a development campaign in an existing organization:

```json
{
  "config": {
    "organization": {"id": "example-org", "slug": "example-org", "name": "Example Organization"},
    "basics": {
      "id": "autumn-drive",
      "organizationId": "example-org",
      "slug": "autumn-drive",
      "campaignName": "Autumn Drive",
      "status": "draft",
      "target": 100000,
      "currency": "ILS",
      "startDate": "2026-09-01",
      "endDate": "2026-09-30"
    },
    "goals": {"campaignGoal": 100000}
  }
}
```

The config response is a registry with `activeCampaignId` and `campaigns`, not simply the saved snapshot. Existing clients should preserve this envelope. Config saving normalizes the supplied snapshot; it is not a generic JSON Merge Patch contract. A newly created campaign receives a separate source record and empty dataset. Existing configuration saves preserve operational source/data, while updating configured project-window metadata.

Changing lifecycle status requires organization admin or site admin. Once status is `completed`, ordinary manager saves can update only the campaign name and public branding/copy/media fields. Target, dates, source, donations, ambassador imports, goals and competition configuration remain frozen; operational write endpoints return `409`. Reopening is an explicit organization/site-admin lifecycle change.

## Source configuration and refresh

Source modes are `file`, `api`, and `google_sheets`. `api` holds `endpoint`, `method`, `responseFormat`, `authType`, `bearerToken`, `headersText`, `bodyText`, `recordsPath`, `fieldMapText`, and `autoRefreshMinutes`. Field maps are JSON encoded as a string, mapping canonical fields to source fields/paths.

`googleSheets` includes `spreadsheetUrl`, `spreadsheetId`, `gid`, `sheetName`, `range`, `accessMode` (`public_csv` or `service_account`), `fieldMapText`, sync enablement/interval, and last-sync/checksum/reconciliation metadata. Service-account credentials are server environment/file configuration, not part of this browser payload.

Hosted refresh returns a summary shaped like:

```json
{
  "ok": true,
  "organizationId": "example-org",
  "campaignId": "autumn-drive",
  "sourceLabel": "example-source",
  "fetchedAt": "2026-09-01T10:35:00.000Z",
  "rows": [],
  "meta": {},
  "dataset": {"rowCount": 120, "sourceLabel": "example-source"},
  "rowCount": 120,
  "processedCount": 3,
  "message": "..."
}
```

The empty `rows` is intentional: fetch C`/dataset` after refresh. `processedCount` can mean changed records rather than total current donations. See [data paths](data-model.md#different-ingestion-paths) for how API and Sheets refresh differ.

## External donation ingestion

Provide `X-GoodRaise-API-Key: <configured secret>` or `Authorization: Bearer <configured secret>`. Keys are checked against server configuration and are not associated with a particular campaign. The path supplies the target scope.

```json
{
  "sourceLabel": "example-provider",
  "requestId": "event-001",
  "record": {
    "id": "donation-001",
    "created_at": "01/09/26 10:30",
    "full_name": "Example Donor",
    "total": "180.00",
    "currencyname": "ILS",
    "email": "donor@example.org",
    "Ambassador name": "Example Ambassador",
    "charged_success": "true",
    "charge_result": "000"
  }
}
```

The response contains `ok`, `created`, `duplicate`, organization/campaign identity, transaction identity/amount/key, and, for a new record, import-batch/dataset details. Preserve source donation IDs across retries. The single-record path commits SQL before updating the snapshot; a reported error does not always mean nothing was stored.

Manual contributions use their own manager-authenticated endpoint. `enteredBy` is the entered display name; audit events separately record the authenticated manager. `amount` must be positive; `attributedAt` is optional date/time; a stable `requestId` supplies retry identity. The resulting row has `charge_result: "manual_match"`, an `ILS` currency, and a synthetic source ID.

## Ambassador registrations

`records` accepts normalized objects including `fullName`, `email`, optional `nickname`, `phone`, `referredBy`, `wasAmbassadorBefore`, `registrationSource`, `isOver18`, `understandsNotPacking`, `termsAccepted`, and `registeredAt`. The Node normalizer also supports registration-export aliases. A name and email/nickname identity are needed; nickname can be derived from email. Responses include `importedCount`, `duplicateRows`, and `skippedRows`.

## Questions

Questions must be 3–500 characters. The server reads the stored campaign snapshot and computes its own aggregates; it does not accept browser totals as authoritative. The response includes:

```json
{
  "answer": "...",
  "answerSource": "deterministic",
  "dataScope": {
    "sourceUpdatedAt": "2026-09-01T10:35:00.000Z",
    "successfulTransactions": 120,
    "totalRaised": 24000
  }
}
```

`answerSource` can also be `ai`. Deterministic questions work without `OPENAI_API_KEY`; provider-dependent questions return a service error if it is missing. See the [intelligence model](intelligence-model.md).

Public context accepts `?project=<campaign-id-or-slug>` and optional `&organization=<organization-id-or-slug>`. An explicit unknown project returns `404`; an ambiguous slug returns `409`. Without a project it retains default selection. This lets direct campaign URLs resolve their own scope instead of displaying the default campaign.

## Errors and compatibility

Typical statuses are `400` invalid input, `401` unauthenticated, `403` denied scope/role, `404` missing resource, `409` conflict, `429` auth lockout, and `500`/`502`/`503` persistence or provider/configuration failure. Responses generally include `message`. Malformed JSON is converted to `{}` by the Node dispatcher rather than uniformly returning a JSON parse error.

Explicit scope does not fall back to another accessible campaign. One current detail: an unknown campaign under an existing organization can return `403`, because the resolver treats either existing organization or campaign as an existing resource. Do not promise a universal nonexistent-campaign `404` contract.

Legacy adapters remain: GET `/api/admin/dataset`; GET/POST `/api/admin/campaign-config`; GET/POST `/api/admin/source-config`; POST `/api/admin/source-refresh`. Missing scope can select the first accessible campaign. New integration code should use scoped routes.

Local and hosted adapters use this same contract. The old local password-reset endpoint is removed. Unsafe API source URLs return `400` on save and refresh; existing invalid configuration is not fetched. The Node adapter enforces a 6 MB request-body ceiling, in line with the hosted buffered request limit.
