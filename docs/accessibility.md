# Accessibility implementation record

GoodRaise treats accessibility as an application requirement, not as a toolbar or overlay. The implementation target is Israeli Standard SI 5568 Part 1 at level AA. WCAG 2.2 AA is used as an additional engineering target where it strengthens the current baseline.

## Official references

- The Commission for Equal Rights of Persons with Disabilities: [Making websites and applications accessible](https://www.gov.il/he/pages/website_accessibility?chapterIndex=6).
- The Commission's [guidance for an accessibility statement and accessibility arrangements](https://www.gov.il/he/pages/declaration_website_accessibility?chapterIndex=1), updated 15 April 2026.
- The Standards Institution of Israel: [SI 5568 Part 1](https://www.sii.org.il/lobby/standardization/standard-page/?id=6751), published 28 September 2023.
- W3C: [WCAG 2.2](https://www.w3.org/TR/WCAG22/) and [testing guidance](https://www.w3.org/WAI/test-evaluate/).

## Implemented baseline

- Hebrew language and right-to-left document direction are declared in both HTML entry documents.
- Every page has a descriptive title, semantic header/main/footer regions, one visible page heading, and a keyboard-focusable skip-to-content target.
- Navigation, forms, authentication, campaign application, archive cards, admin tabs and dialogs use native controls or explicit accessible relationships.
- Keyboard focus is visible; the mobile menu exposes its expanded state and closes with Escape; admin tabs support arrow, Home and End keys.
- Meaningful media has alternative text, decorative graphics are hidden from assistive technology, data tables identify column headers, and charts expose textual summaries or accessible names.
- Core text colours meet the AA contrast target, form and menu boundaries have at least 3:1 contrast, browser text resizing is not disabled, layouts reflow on smaller screens, and reduced-motion preferences are respected.
- A public accessibility statement is available at `/accessibility`, linked from the shared footer on every public and authenticated page.

## Required before public launch

- Publish a real accessibility contact name and working email/phone or another monitored accessible contact route. Include coordinator details if GoodRaise is legally required to appoint one.
- Confirm and publish any physical-service accessibility arrangements if GoodRaise begins receiving the public at a physical location.
- Commission an independent SI 5568 AA audit covering keyboard-only use, a current screen reader, 200% text resizing and narrow reflow, form errors, data visualizations, uploaded campaign media, and the chosen third-party payment journey.
- Record and remediate audit findings. Automated/static checks are useful regression protection but cannot establish conformance by themselves.

The current statement deliberately says that the site is still being tested; it must not be changed to claim full conformance until the independent audit and contact requirements above are complete.
