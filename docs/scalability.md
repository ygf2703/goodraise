# GoodRaise Scalability

Updated: 2026-08-12

## Goal

GoodRaise should support multiple organizations, multiple campaigns, multiple managers, and meaningful donation volumes without requiring a full rewrite.

## Current Scalability Posture

### Already in Place

- server-side campaign configuration persistence
- server-side source configuration persistence
- protected admin dataset separation from public output
- reusable intelligence module
- file mode and API mode as interchangeable data-source contracts
- role metadata added to manager identity records

### Still Intentionally Lightweight

- no heavy relational multi-tenant database yet
- no queue system
- no background analytics workers
- no distributed cache

This is deliberate. The target is `8/10`, not premature infrastructure complexity.

## Multi-Tenant Direction

The intended hierarchy is:

- Platform
- Organization
- Campaign
- Team
- Ambassador
- Donation

Current implementation status:

- role metadata supports future organization and campaign scoping
- campaign configuration is persisted independently from the browser
- source configuration is persisted independently from the browser
- intelligence logic is campaign-agnostic

## Multi-Campaign Readiness

Current repository readiness:

- campaign builder already stores campaign identity, slug, goals, teams, presets, branding, and ambassadors
- campaign scope metadata now exists in auth records
- config and source persistence are already separated from the static shell

Remaining gap:

- the runtime still works primarily with one active campaign context at a time
- a true campaign selector is still a next-phase item

## Data-Layer Strategy

Current persistence:

- local SQLite for local auth lifecycle
- local JSON for source/campaign config
- Netlify Blobs or local JSON fallback for hosted auth/config

Why this is acceptable now:

- business logic is not tightly coupled to one database technology
- the intelligence module is runtime-agnostic
- the source adapter path is already explicit

Recommended next replacement path:

1. move auth/config records into a structured database
2. keep endpoint contracts stable
3. keep intelligence input shape unchanged

## Large Dataset Testing

Synthetic benchmark executed on 2026-08-12 with `scripts/benchmark_intelligence.mjs`.

### Results

- `1,000` donations: `34.75ms`
- `10,000` donations: `219.54ms`
- `100,000` donations: `2354.03ms`

Additional outputs observed:

- stable health-score generation
- stable forecast generation
- stable intervention-priority generation
- stable campaign fingerprint generation

## Bottlenecks Identified

- the generated dashboard still carries a large browser shell
- very large raw datasets still pressure client-side rendering more than the intelligence module itself
- records table growth will eventually require pagination/query slicing instead of shipping all records

## Query / Pagination Direction

The system should continue toward:

- summary-first endpoints
- filtered record retrieval
- table pagination
- optional server-side precomputation for large datasets

This has not been fully implemented yet, but the architecture now points in the right direction.

## Cache Strategy

Current recommendation:

- do not introduce infrastructure cache yet
- precompute only where analytics become materially expensive
- invalidate derived intelligence whenever:
  - source data changes
  - campaign config changes
  - source mode changes

## Scalability Conclusion

GoodRaise is now materially more scalable because:

- intelligence is modular and reusable
- identity records carry role/scope metadata
- campaign/source configuration is persisted server-side
- data-source ingestion is adapter-oriented
- scale characteristics are benchmarked and documented

What remains is evolutionary work, not a structural reset.
