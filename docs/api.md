# API contracts

Updated 2026-09-08. This is the shared Node contract, implemented by [route dispatch](../backend/http-handler.mjs) and [application boundary](../backend/app.ts), used by local and Netlify adapters. There is no OpenAPI specification or versioned API prefix.

## Conventions and access

Use JSON bodies and `Content-Type: application/json`. Session-protected browser requests use `credentials: "include"`. Successful auth sets `goodraise_admin_session`; the browser should not read or manage this HttpOnly cookie itself. JSON responses normally use `Cache-Control: no-store`.

In the table below, **C** means `/api/organizations/:organizationId/campaigns/:campaignId`. Prefer identifiers returned by auth/campaign APIs. The SQL ingestion resolver accepts UUIDs, application IDs, or slugs; do not assume identical identifier handling in every route.

Role ordering is `viewer < analyst < campaign_manager < organization_admin < platform_admin`, with organization/campaign assignment checks in addition to role. See [multi-tenancy](multi-tenancy.md). Ingest uses a configured API key instead of a manager session.

## Route inventory

| Method | Route | Access | Body / result |
| --- | --- | --- | --- |
| GET | `/api/health` | Public | Runtime/persistence counts and metadata; performs store reads/seeding |
| GET | `/api/public-context` | Public | Selected organization/campaign and `datasetRecordCount` |
| GET | `/api/auth/status` | Public/session-aware | `authenticated`, identity/role/scope/accessible campaign metadata when signed in |
| POST | `/api/auth/login` | Allowed manager | `{email, password}`; cookie or setup-required/error response |
| POST | `/api/auth/setup` | Allowed account without password | `{email, password, confirmPassword}`; creates password and session |
| POST | `/api/auth/logout` | Session-aware | Deletes session and expires cookie |
| POST | `/api/auth/change-password` | Signed-in manager | `{currentPassword, newPassword, confirmPassword}` |
| GET | `/api/organizations/:organizationId/campaigns` | Organization access | `{organizationId, campaigns}` |
| POST | `/api/organizations/:organizationId/campaigns` | Organization admin+ | Campaign snapshot or `{config: snapshot}`; `201`, registry-shaped config |
| GET | C | Viewer+ in scope | `{config: registry, activeCampaign, portfolio, updatedAt, updatedBy, message}` |
| POST, PUT | C | Campaign manager+; creation needs organization admin+ | `{config: snapshotOrRegistry}`; save result |
| GET | C`/dataset` | Analyst+ in scope | Full scoped rows/meta and organization/campaign |
| GET | C`/public-dataset` | Public | Redacted rows/meta and whitelisted campaign presentation config |
| GET | C`/source` | Campaign manager+ | Source config with dedicated bearer token redacted |
| POST, PUT | C`/source` | Campaign manager+ | `{config: sourceConfig}` |
| POST | C`/source/refresh` | Campaign manager+ | Fetches/persists data; returns summary, then client reads dataset |
| POST | C`/ambassadors/import` | Campaign manager+; SQL required | `{records: [...], sourceLabel?}`; counts and skipped row indices |
| POST | C`/manual-contributions` | Campaign manager+; SQL required | `{enteredBy, amount, attributedAt?, requestId?}`; `201` created / `200` existing |
| POST | C`/ingest` | Ingest API key; SQL required | Single donation record or wrapped record; `201` created / `200` duplicate |
| POST | C`/insights/questions` | Campaign manager+ | `{question}`; answer and server data scope |

The role threshold for `campaign_list` is viewer, but the organization-level authorization call has no explicit campaign. Non-organization-admin roles can therefore be denied by the scope policy. For assigned-campaign navigation, the browser also receives accessible campaigns from auth status.

There are no general delete endpoints, manager invitation endpoint, payment endpoint, hosted password-recovery endpoint, or paginated dataset query in this route inventory.

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
