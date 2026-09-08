# Intelligence and question model

Updated 2026-09-08; formulas were retained during platform migration. Sources: [browser engine](../shared/intelligence/engine.mjs), [browser caller](../apps/web/src/compat/dashboard-controller.js), and [question service](../backend/services/insight-assistant.mjs).

## Two separate systems

The browser intelligence engine computes health, velocity, forecast, ambassador state, intervention lists, and a campaign fingerprint using deterministic rules. It does not call a model provider.

The hosted question service computes aggregates from the saved server dataset, answers recognized questions with rules, and calls a model provider for other questions when configured. It is not a training pipeline, retrieval index, or predictive machine-learning service.

## Engine contract and time reference

`createGoodRaiseIntelligence({groupBy, sumAmount, buildLeaderboard})` receives helper dependencies and returns calculation functions. Functions require explicit `organizationId` and `campaignId` in context; missing either throws. Context also supplies dataset `meta`, `goals.total`, `goals.daily`, personal targets/directory, prize rules, and builder settings.

Calculations operate on the rows the caller supplies. They do not universally filter unsuccessful payments. The general dashboard passes filtered browser rows, whereas prize rendering and SQL-built snapshots have additional success filtering. Preserve that distinction when interpreting a score.

The reference time is the **latest donation timestamp in the supplied rows**, not the wall clock. Bounds combine configured project dates, known dataset dates, and row dates; start is midnight of the earliest date and end is 23:59:59 of the latest. Elapsed hours have a minimum of one. No new donations means the reference time need not advance: these are dataset-relative metrics, not reliable idle-time monitoring.

## Velocity

The engine reports last hour, last three hours, preceding three hours, recent/previous twelve hours, latest donation date, previous observed date, and campaign averages.

- Campaign amount/hour = total amount ÷ elapsed hours.
- Recent amount/hour = last-three-hour amount ÷ 3.
- Three-hour change = (recent amount − preceding amount) ÷ preceding amount; returns zero when the preceding amount is zero.
- “Today” means the latest donation's date. “Previous date” means the previous date with rows, not necessarily yesterday.

Windows are anchored to the latest row and use timestamp comparisons. Date parsing uses JavaScript date semantics; an organization timezone is not supplied to the engine.

## Forecast

```text
if previous-three-hour amount > 0:
    trajectory = 0.6 × recent amount/hour + 0.4 × campaign amount/hour
else:
    trajectory = campaign amount/hour

projected final = current total + trajectory × remaining campaign hours
projected target ratio = projected final / goal, when goal > 0
gap or surplus = projected final - goal, when goal > 0
```

Confidence is a heuristic label: high at 120+ rows and 35%+ elapsed time; medium at 40+ rows and 20%+ elapsed time; otherwise low. It is not a probability, statistical interval, or measured forecast accuracy.

## Campaign health

The score starts at 100, applies the adjustments below, then rounds and clamps to 0–100. Pace gap = amount/total-goal minus elapsed-time ratio.

| Trigger | Adjustment |
| --- | --- |
| Pace gap below −10 percentage points | Subtract rounded absolute gap × 100, capped at 25 |
| Pace gap above +8 points | Add 4 |
| Three-hour amount change below −15% | Subtract 15 |
| Three-hour amount change above +8% | Add 5 |
| Inactive ambassadors | Subtract 2 each, capped at 18 |
| Ambassadors needing attention | Subtract 1 each, capped at 10 |
| Failed-row rate above 8% | Subtract 12 |
| Daily target shortfall | Subtract rounded shortfall ratio × 10, capped at 12 |

Labels are Excellent ≥85, Healthy ≥70, Needs Attention ≥55, At Risk ≥35, otherwise Critical. At most four explanation entries are returned, in calculation order.

A success-only SQL snapshot cannot show a failed-payment penalty even if failures exist in the raw ledger. Missing goals and an empty/limited dataset also affect how informative the score is; the label is not a production-health signal.

## Ambassador state and intervention design

Ambassadors come from both the configured directory and names in supplied donations, matched by display name. The engine computes totals, target progress, donation counts/average, first/last donation, inactivity hours, recent six-hour velocity, recent-versus-previous six-hour trend, rank movement, and the next prize threshold.

State precedence is:

1. Target Reached if a positive target is met.
2. Inactive if no donations exist.
3. Needs Attention if no activity for at least 12 dataset-relative hours, or recent six-hour amount is zero after positive preceding activity.
4. Hot if recent six-hour activity exists and target progress is at least 60%.
5. Active otherwise.

The contact-priority rules assign: 100 for never started; 85 for near personal target (within max of 500 or 10% of target); 78 for within 500 of a prize; 72 for 10+ inactive hours after starting; 64 for falling six-hour trend. The list is sorted and capped at eight. One ambassador may appear for multiple reasons.

“Attention now” combines unstarted ambassadors, declining velocity, daily gap, near-prize opportunities, recent failed rows, and attention states; it returns the top six rule-weighted issues. It does not send messages or trigger outreach automatically.

The fingerprint is a summary of duration, target, ambassador participation, counts, average donation, velocity, target progress, and inactivity. There is no cross-tenant benchmark database behind it.

## Question assistant

The hosted route authorizes `insight_query`, loads `buildCampaignContext()`, and calls `buildCampaignInsightContext()`. Only successful rows within the dataset's `defaultFrom/defaultTo` window enter these aggregates. Current browser filters or a temporary CSV upload are not sent to this service.

The context includes campaign name/status/target/currency/dates/freshness, donation totals/count/min/max/average, active ambassadors, and grouped totals. It keeps up to 500 ambassador totals, the top 20 dates by amount, and 24 hourly buckets. Only ambassador truncation is explicitly flagged. Longer campaigns can therefore have incomplete daily detail in model context.

Common Hebrew questions about total, count, average, min/max donation, goal progress, active/top ambassadors, best date/hour, and date range have deterministic answers. These work without a provider key. Other questions use the implementation's configured Responses API call:

- Key: server-side `OPENAI_API_KEY`.
- Model: `GOODRAISE_AI_MODEL`, falling back to the source default `gpt-4.1-mini`.
- Request timeout: 20 seconds.
- Maximum output tokens: 700.
- Question length: 3–500 characters.
- Response: answer, deterministic/AI source, and dataset scope/freshness.

This documents the checked-in request; it does not verify model availability or external service configuration.

The aggregate builder excludes donor names, email, phone, city, and raw donation rows. **Ambassador names remain in grouped labels and the manager's free-text question is transmitted unchanged.** Thus “no personal information can ever leave the server” would be too broad. Deterministic answers do not need a provider request.

## Tests and change guidance

Run `npm run test:intelligence` for rule-engine coverage. The broader suite also covers question context, deterministic answers, placement/catalog, and route/policy source assertions. `npm run benchmark:intelligence` generates synthetic workloads; historical benchmark timings are not an end-to-end service capacity guarantee.

For a change, identify the intended row population, date window, and time reference before adjusting a formula. Add behavior-focused cases for altered business rules, including empty data, missing goals, failed transactions, stale timestamps, and campaign switching where relevant.
