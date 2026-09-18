# Shared UI styling

All routes use the same responsive foundation, including the server-rendered
homepage. Change common behavior here before adding another page override:

- `work/assets/site-layout.css`: page gutters, compact workspace/card spacing,
  form text size, shrink-safe grid/flex children, media bounds and local report
  scrolling. It is imported by `main.tsx`, so production ships it in the
  fingerprinted Vite CSS bundle; the standalone landing template also loads it.
- `work/assets/buttons.css` and `components/Button.tsx`: action variants,
  dimensions, focus, disabled and busy states. See [button usage](buttons.md).
- `work/assets/site-header.css`: persistent header, RTL mobile menu and footer.
- `styles/dashboard.css`, `styles/help.css`, `work/assets/landing.css`:
  page-specific composition. Dashboard `--space-5/6/7` map to the shared
  card/panel/section tokens rather than defining separate mobile spacing.

The low-specificity foundation lets a component explicitly set its own minimum
width. Tables and wide chart canvases keep readable columns **inside** their
scroll containers; never fix overflow with `overflow-x: hidden` on the body.
Auto-fit card grids use `minmax(min(100%, <card minimum>), 1fr)` so their minimum
can fit a narrow parent. Long labels, emails and URLs wrap.

Chart tooltips use `chart-tooltip.ts` and coordinates from their positioned
frame. Hiding them clears the transform; moving invisible content thousands of
pixels left creates a huge scrollable area on RTL pages.
Charts publish their intrinsic width as `--chart-min-width` so axis labels are
not shrunk to unreadable text on phones. Report regions have accessible names,
keyboard focus and visible focus outlines as well as native touch scrolling.

For responsive changes, check loaded content (not only the loading overlay) at
320px, 390px, tablet and desktop widths. Inspect both page width and readability
inside cards, show/hide report tables, and test campaign navigation, management
tabs and the mobile menu. Do not save campaign/account data merely to test layout.
