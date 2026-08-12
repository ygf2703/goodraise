# GoodRaise Technical Due Diligence

Updated: 2026-08-12

## Executive Summary

GoodRaise is now materially stronger as a platform asset because the hosted runtime is no longer only "multi-campaign by configuration". It now includes:

- campaign-scoped datasets
- campaign-scoped source config
- record-oriented persistence
- explicit organization/campaign authorization
- source connector SSRF hardening
- migration from the legacy registry blob
- automated isolation tests

## What Improved In This Sprint

### Architecture

- hosted persistence moved to independent organization/campaign records
- campaign updates no longer depend on rewriting one giant registry blob
- campaign creation is supported as an organization-scoped server operation

### Security

- explicit forbidden scope now returns `403` instead of silently falling back to another accessible campaign
- source URLs are validated against unsafe schemes, localhost, private IP space and internal targets
- browser responses never return stored bearer tokens

### Product Credibility

- multiple live campaigns can coexist
- campaign switching is treated as a session/UI selection, not as a platform-wide singleton
- intelligence calculations now require explicit campaign identity

## Buyer / Integrator View

### Strengths

- clear fit as an "intelligence layer" on top of an existing crowdfunding platform
- low infrastructure complexity
- campaign-scoped data ownership is now explicit in the hosted path
- deterministic and explainable operational models
- CI now checks isolation and connector security rather than only rendering and auth basics

### Remaining Weaknesses

- the local Python backend is still transitional and not yet fully upgraded to the new hosted tenancy architecture
- the main dashboard build/runtime shell is still concentrated in a large Python builder file
- portfolio-level organization UI is still foundation-only, not a full executive workspace

## Security Posture

Implemented in the hosted canonical path:

- PBKDF2 password hashing
- session cookies
- login rate limiting
- audit events
- scoped authorization
- source secret redaction
- SSRF protections

Still recommended before full enterprise-grade rollout:

- secret scanning in CI
- production monitoring / alerting
- formal disaster recovery drill
- structured database migration beyond local JSON / Blobs fallback

## Data Governance View

What is improved:

- donor-level protected datasets are scoped per campaign
- public payload remains separate from admin payload
- source secrets do not return to the browser

What still needs business/legal completion:

- retention policy
- deletion policy
- incident response process

## Scale View

Measured on 2026-08-12:

- `1,000` donations: `33.51ms`
- `10,000` donations: `202.13ms`
- `100,000` donations: `2067.52ms`

Portfolio metadata selector benchmark:

- `10` campaigns: `0.03ms`
- `100` campaigns: `0.01ms`
- `1,000` campaigns: `0.12ms`

Interpretation:

- the intelligence layer remains fast enough for campaign operations
- the likely next ceiling remains browser rendering of large raw tables, not the intelligence math itself

## Acquisition Readiness Assessment

GoodRaise now credibly presents as:

`Multi-tenant Campaign Intelligence & Operations Platform`

This is a meaningful improvement over a campaign-specific dashboard shell because:

- tenancy boundaries exist in hosted persistence
- authorization is server-enforced
- intelligence is scoped and reusable
- migration exists for legacy campaign registry data

## Remaining Due-Diligence Questions

1. When will the local backend be aligned or retired as a canonical path?
2. What structured database will replace local JSON/Blobs fallback first?
3. What retention commitments can the product make contractually?
4. What incident-monitoring stack will exist in production?

## Conclusion

As of 2026-08-12, GoodRaise is materially closer to an integration-ready acquisition target. It is no longer just configurable for multiple campaigns; the hosted runtime now enforces campaign isolation in persistence, authorization and source access.
