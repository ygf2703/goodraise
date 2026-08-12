# GoodRaise Scorecard Baseline

Updated: 2026-08-12

This baseline reflects the repository before the current 8/10 upgrade pass was completed. It captures the starting point used for the improvement program.

## 1. Product Idea

- Current score: `9/10`
- Evidence: The repository already delivered a campaign-facing product with public project pages, admin dashboard, file ingestion, prize logic, comparisons, exports, and campaign-builder controls.
- Reason for score: The product concept was already strong, clear, and aligned to a real campaign operations problem.
- Blockers preventing a higher score: None material. Additional complexity would risk diluting focus.
- Required work: Preserve the current product focus.

## 2. Strategic Fit with Giveback

- Current score: `9/10`
- Evidence: The product already operated as a shadow intelligence layer around campaign data instead of replacing payments, clearing, or fundraising infrastructure.
- Reason for score: GoodRaise complemented a crowdfunding stack rather than competing directly with it.
- Blockers preventing a higher score: None material.
- Required work: Keep integrations adapter-based and avoid platform-coupled payment logic.

## 3. UX / Product Thinking

- Current score: `8/10`
- Evidence: The dashboard already supported public/private separation, manager login, campaign builder, visual KPI areas, public leaders, daily winners, and donation-page management.
- Reason for score: The product exposed meaningful workflows, not only raw charts.
- Blockers preventing a higher score: Some executive insight areas still depended on generic summaries instead of operational intelligence.
- Required work: Promote intervention-oriented insights without breaking existing UX.

## 4. MVP Functionality

- Current score: `8/10`
- Evidence: CSV import, comparison file import, prize import, manager auth, public project view, public prizes page, exports, filters, API-source configuration, and campaign-page customization already existed.
- Reason for score: The system already solved a real operational problem end-to-end.
- Blockers preventing a higher score: Operational monitoring and explainable intelligence were still incomplete.
- Required work: Keep all current capabilities stable while adding intelligence and architecture hardening.

## 5. Differentiation

- Current score: `7/10`
- Evidence: The system already had stronger dashboards than a simple donation report, but its value was still heavily tied to analytics presentation.
- Reason for score: It showed campaign data well, but did not yet consistently tell managers what to do next.
- Blockers preventing a higher score: Missing health score, intervention priority model, contact-now logic, explicit ambassador states, and deterministic forecasting layer.
- Required work: Introduce a reusable GoodRaise Intelligence Layer with explainable rules.

## 6. Architecture for Acquisition

- Current score: `5/10`
- Evidence: `work/build_yellow_dashboard.py` still held large amounts of rendering, analytics, and interaction logic in one generator file.
- Reason for score: Another engineering team could inherit the product, but not without paying a high onboarding tax.
- Blockers preventing a higher score: Giant-file dependency, weak module separation, implicit campaign assumptions, and limited system documentation.
- Required work: Separate analytics/intelligence responsibilities, document architecture clearly, and introduce explicit service boundaries.

## 7. Production Readiness

- Current score: `5/10`
- Evidence: Session auth, first-password setup, Netlify path, and sanitized public output existed, but operational controls were still incomplete.
- Reason for score: The system could be demonstrated, but still needed stronger health visibility, role semantics, audit coverage, and manager lifecycle controls.
- Blockers preventing a higher score: Minimal health endpoint, partial audit coverage, single-tier admin model, and incomplete password-management lifecycle.
- Required work: Strengthen auth/session metadata, add health monitoring, improve authorization semantics, and document operational controls.

## 8. Scalability

- Current score: `4/10`
- Evidence: Campaign configuration persistence existed, but the repository still behaved primarily like one campaign deployed for one organization.
- Reason for score: The product had early persistence but weak multi-campaign/multi-tenant structure and no documented scale envelope.
- Blockers preventing a higher score: Single active campaign mindset, no benchmark documentation, and limited separation between source data, configuration, and analytics reuse.
- Required work: Add benchmark coverage, normalize campaign metadata, document scaling boundaries, and harden toward reusable campaign objects.

## 9. Current Moat

- Current score: `4/10`
- Evidence: The repository had strong UX and analytics presentation, but very little documented reusable campaign intelligence IP.
- Reason for score: The moat was still more in execution quality than in codified models.
- Blockers preventing a higher score: No explicit health model, no published intervention logic, no standardized campaign fingerprint, and no explainable intelligence framework.
- Required work: Codify GoodRaise models into deterministic, reusable operational intelligence.

## 10. Potential Moat

- Current score: `9/10`
- Evidence: The product already had a natural path toward benchmarking, operational playbooks, multi-campaign intelligence, and integration with major fundraising platforms.
- Reason for score: The direction was strong even if implementation maturity lagged behind it.
- Blockers preventing a higher score: None material.
- Required work: Preserve the benchmark-ready direction while avoiding premature ML complexity.

## 11. Strategic Acquisition Potential

- Current score: `8/10`
- Evidence: The product already fit the profile of a platform-adjacent analytics and operations layer rather than a full crowdfunding replacement.
- Reason for score: It could already interest a larger platform, but needed stronger transferability and operational maturity.
- Blockers preventing a higher score: Architecture concentration, missing intelligence documentation, and limited production controls.
- Required work: Improve transferability, operational trust, and codified product IP.
