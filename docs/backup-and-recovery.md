# Backup And Recovery

Updated: 2026-08-12

## Current State

GoodRaise does not yet implement a full automated backup system.

This document describes what currently exists, what can be backed up manually, and what still requires implementation before a high-trust production rollout.

## What Exists Today

### Local Mode

Important persisted local files:

- `work/data/dashboard-auth.sqlite3`
- `work/data/dashboard-source-config.json`
- `work/data/dashboard-campaign-config.json`
- `work/data/dashboard-audit-log.jsonl`

These files can be copied while the local backend is stopped.

### Netlify Mode

Important hosted state:

- auth/session/config state in Netlify Blobs
- protected admin dataset generated during build

## Current Recovery Capability

### Supported Today

- restore local auth/config/audit files from a manual file backup
- redeploy static app shell from Git
- regenerate dashboard outputs from sanitized source files

### Not Fully Implemented Yet

- automated scheduled backups
- one-click Netlify Blob snapshot restore
- point-in-time restore
- audit-log archival rotation
- validated disaster-recovery runbook

## Manual Backup Procedure

### Local

1. Stop the local backend.
2. Copy the full `work/data/` directory to a secure offline location.
3. If required, also copy sanitized source/prize inputs from outside the repository.

### Hosted

1. Export or snapshot Netlify Blobs state through the platform capability used in deployment.
2. Preserve deployment configuration and manager-email allowlist configuration.
3. Preserve sanitized source files needed to rebuild the protected dataset.

## Restore Procedure

### Local

1. Stop the local backend.
2. Restore the saved `work/data/` files.
3. Rebuild the dashboard outputs.
4. Start the backend and verify:
   - `/api/health`
   - manager login
   - protected dataset access
   - campaign/source config visibility

### Hosted

1. Restore the persisted auth/config state.
2. Redeploy the site from Git.
3. Rebuild the protected dataset from sanitized inputs.
4. Verify the same manager workflows end-to-end.

## Data-Retention Notes

- donor data retention policy: `LEGAL DECISION REQUIRED`
- admin-session retention policy: `LEGAL DECISION REQUIRED`
- audit-log retention policy: `LEGAL DECISION REQUIRED`
- protected dataset rebuild frequency: operational decision, not yet automated

## Production Gap

Before a wider production launch, GoodRaise should add:

1. documented scheduled backup ownership
2. hosted-state export/restore procedure validation
3. restore drill execution record
4. retention and deletion policy approval
