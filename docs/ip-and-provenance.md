# IP And Provenance

Updated: 2026-08-12

## Ownership Notes

- Application code in this repository is custom project code.
- No open-source license file is published at repository root.
- Branded visual assets under `work/assets/` are campaign/organization assets and should be treated as proprietary unless separately licensed in writing.

## Third-Party Dependencies

### Python

- `pandas`
  - used for build-time spreadsheet/data handling
  - declared in `requirements.txt`

### Node

- `@netlify/blobs`
  - used for Netlify-side auth/session/config persistence
  - declared in `package.json`

## Bundled Content Requiring Business Review

- Legal text and campaign text generated through `work/build_yellow_dashboard.py`
- Markdown story content in `work/content/project-page-default.md`
- Campaign imagery and logos under `work/assets/`

## Provenance Gaps

1. No centralized asset provenance manifest yet exists for logos, backdrop media, and campaign hero imagery.
2. Campaign-specific text may need explicit approval before buyer sharing.
3. Historical repository state may still reflect private operating data outside the current tracked tree.

## Recommended Next Step

Add a lightweight asset manifest if this repository will be shared with external diligence reviewers.
