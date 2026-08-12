# Acquisition Readiness Scorecard

Updated: 2026-08-12

## Score

- Before current remediation pass: 4.5 / 10
- After current remediation pass: 6.5 / 10

## What Improved

- Personal manager emails removed from tracked source
- Manager allowlist moved toward ignored/env configuration
- Empty protected-data directories preserved without tracking live data
- Baseline, security, provenance, and environment docs added
- Repository now has a clearer due-diligence narrative

## What Still Blocks Buyer-Ready Status

### Critical

1. Git history still needs formal review and possible redaction.
2. Campaign-specific coupling is still present in naming, assets, and defaults.
3. Password reset and role separation remain incomplete.

### High

1. Multi-tenant boundaries are not implemented.
2. API connector governance is still single-project and manager-wide.
3. Protected dataset generation remains file-oriented.

### Medium

1. No full automated regression suite yet exists.
2. No dedicated SBOM/license report is generated.
3. No formal incident response or retention policy is versioned yet.

## Exit Criteria For 8.5+/10

1. Finish role model and password recovery.
2. Remove remaining campaign-specific defaults from runtime code paths.
3. Complete history remediation decision.
4. Add structured security review and dependency governance workflow.
5. Add integration and smoke tests for protected/public boundaries.
