# Shared buttons

`work/assets/buttons.css` is the single appearance/state definition, loaded by both the React shell and the static homepage. React code uses `Button` and `ButtonLink` from `apps/web/src/components/Button.tsx`.

| Variant | Use | Appearance |
| --- | --- | --- |
| `primary` (default) | Main action: submit, save, continue | Blue background, white text |
| `secondary` | Alternative or supporting action | White background, blue border/text |
| `ghost` | Low-emphasis action: cancel, clear, show password | Transparent background, blue text; use on light surfaces |
| `danger` | Destructive/rejection action | White background, red border/text |

Choose `size="sm"` for compact/header actions (44 px minimum height), default `md` (48 px), or `lg` for prominent calls to action (52 px). Text wraps instead of overflowing. `icon` gives a square button using the same size; supply an accessible `aria-label`. Do not shrink icon targets with page CSS.

```tsx
<Button type="submit" busy={saving}>שמירה</Button>
<Button variant="ghost" onClick={cancel}>ביטול</Button>
<Button variant="danger" disabled={!canReject} onClick={reject}>דחיית הבקשה</Button>
<ButtonLink href="/contact" size="lg">בואו נדבר</ButtonLink>
```

`Button` defaults to `type="button"`, so incidental actions never submit forms. `busy` sets native `disabled` and `aria-busy`; disabled fieldsets are also respected. `ButtonLink` stays a real anchor for navigation and open-in-new-tab behavior. Its optional `disabled` removes the destination/tab stop and blocks click handling. Preserve IDs/data attributes used by the existing controllers. Native refs are forwarded as React 19 props.

The static homepage uses the same classes: `gr-button gr-button--primary gr-button--lg`. Existing dashboard templates may retain `button-primary`, `button-secondary`, `button-ghost`, and `action-button` (`secondary` modifier supported): these are aliases in the shared stylesheet, not separate designs. Use the component/classes above for new work.

Pages may control **placement** (width, margins, grid alignment), not button colors, border radius, padding, typography, hover/focus or disabled states. Normal prose-link rules must exclude `.gr-button`, e.g. `.help-main a:not(.gr-button)`. Do not fix clashes with `!important` or progressively stronger selectors. This prevents the FAQ regression where a more specific link selector made both label and background blue.

Hover, active, keyboard focus, disabled/busy, reduced-motion and forced-colors behavior live in the shared stylesheet. Enabled solid palettes are checked for at least 4.5:1 text contrast. Ghost buttons inherit their surface and should remain on a light background. Navigation tabs, segmented filters, amount cards and disclosure controls remain distinct selection/navigation components; they are not primary-action buttons.

Validation: `tests/buttons.test.ts` covers variants, native semantics, disabled/busy behavior, palette contrast, asset inclusion and the original link-selector regression. Also inspect **computed foreground/background colors** in the browser for the FAQ link, contact submit, header CTA, login, application form and a legacy dashboard action. Check keyboard focus, hover, disabled fieldsets, hidden controls and RTL layouts at 320/390 px; screenshot-only checks are not enough to catch a color cascade regression.
