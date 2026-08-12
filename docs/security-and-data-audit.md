# Security And Data Audit

Updated: 2026-08-12

## Summary

This document tracks repository-level security and data-handling findings discovered during acquisition-readiness work.

## Findings

### Critical

1. Real manager emails existed in tracked source code.
   - Affected areas at discovery:
     - `work/dashboard_backend.py`
     - `netlify/lib/auth-store.mjs`
   - Remediation direction:
     - move allowlist to ignored local config or environment variables
     - fail closed when no manager configuration is supplied

2. Local protected dataset file existed on disk with donor PII.
   - Path:
     - `netlify/data/admin-dataset.json`
   - Status:
     - not tracked by git at audit time
     - must remain ignored and never be used as committed fixture data

3. Historical commits still contain manager emails.
   - Evidence:
     - commits matched by history scan for `noamfrostig@gmail.com`
   - Status:
     - unresolved in git history
     - requires explicit approval before history rewrite

### High

1. Public repo still contains campaign-specific business coupling.
2. Single-role manager model is not sufficient for enterprise due diligence.
3. Protected dataset is staged as a file artifact instead of being isolated behind a dedicated service boundary.

### Medium

1. No production-grade password recovery flow.
2. No tenant isolation layer.
3. API connector secrets depend on deployment/runtime storage discipline.

## Repository Scan Notes

Tracked-source email scan found:

- placeholder/demo emails in:
  - `work/samples/sample-source.csv`
  - `work/config/dashboard-access.example.json`
- organizational/public contact string in legal content output generation:
  - `work/build_yellow_dashboard.py`

No committed API keys or bearer tokens were found in tracked source during the keyword scan performed on 2026-08-12.

## Required Manual Follow-Up

1. Decide whether to rewrite git history to remove historical manager emails.
2. Rotate any credentials if future audits reveal they were ever committed.
3. Validate that deployment storage never serializes protected donor datasets into public artifacts or logs.
