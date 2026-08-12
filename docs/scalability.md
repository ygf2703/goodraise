# GoodRaise Scalability

Updated: 2026-08-12

## Goal

GoodRaise must scale across:

- multiple organizations
- multiple live campaigns at the same time
- per-campaign datasets
- per-campaign source connectors
- per-scope manager access

without forcing a rewrite of the intelligence layer.

## Current Scalability Posture

### Now Implemented

- record-oriented hosted persistence
- organization/campaign-scoped routes
- campaign-scoped source configuration
- campaign-scoped dataset storage
- explicit campaign context for intelligence
- automated isolation tests

### Still Intentionally Lightweight

- no distributed cache
- no background worker fleet
- no queue system
- no multi-service architecture

This remains intentional. GoodRaise is aiming for production-credible focus, not premature infrastructure expansion.

## Multi-Campaign Scale Direction

The canonical model is now:

- many organizations
- many campaigns per organization
- many live campaigns simultaneously
- one selected campaign per UI session

`activeCampaignId` means the session-selected campaign, not a platform-wide singleton.

## Data-Layer Scale Strategy

GoodRaise now avoids the previous giant shared registry write pattern.

Benefits:

- updating Campaign A does not rewrite Campaign B
- concurrency risk is lower
- migration to structured SQL/Postgres later is straightforward because record boundaries already exist

## Browser Loading Strategy

The browser should not load all donation rows for all campaigns at once.

Current direction:

- load campaign summaries for accessible campaigns
- load full dataset only for the selected campaign
- switch datasets on campaign change
- recompute intelligence only for the selected campaign

This is the correct shape for future portfolio growth.

## Benchmark Results

### Intelligence

Measured with [scripts/benchmark_intelligence.mjs](C:\Users\noamf\Documents\Codex\2026-07-27\mu\scripts\benchmark_intelligence.mjs):

- `1,000` donations: `33.51ms`
- `10,000` donations: `202.13ms`
- `100,000` donations: `2067.52ms`

### Portfolio Metadata

- `10` campaigns: `0.03ms`
- `100` campaigns: `0.01ms`
- `1,000` campaigns: `0.12ms`

Interpretation:

- metadata-only portfolio selection is inexpensive
- intelligence math remains acceptable for current operational usage
- the next performance pressure point is still record-table rendering and raw data transfer volume

## Known Bottlenecks

- the browser shell remains large
- raw record tables are still client-rendered
- the local Python backend is not yet aligned with the hosted multi-tenant persistence model

## Next Scale Steps

Recommended order:

1. keep hosted scoped persistence as the canonical path
2. add filtered/paginated record retrieval for very large datasets
3. precompute or cache only if real workloads justify it
4. move from dev JSON/Blobs fallback to structured database when live organization count grows

## Scalability Conclusion

GoodRaise is now structurally more scalable because the tenancy model, storage model and runtime fetch model are aligned around `organizationId + campaignId`. The main remaining scale work is evolutionary rather than architectural reset.
