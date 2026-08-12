# GoodRaise Intelligence Model

Updated: 2026-08-12

This document defines the reusable product IP that turns GoodRaise from a dashboard into a campaign intelligence and operations platform.

## Design Principles

- deterministic, not opaque
- explainable, not magical
- campaign-relative, not calendar-only
- reusable across organizations and campaigns
- safe for benchmark-readiness without cross-tenant aggregation

## 1. Campaign Timeline Normalization

Every campaign should be analyzed using normalized progress references:

- campaign day
- elapsed hours
- elapsed campaign percentage

This allows comparisons between campaigns with different real-world dates.

## 2. Campaign Health Model

### Output

- numeric score: `0-100`
- label:
  - `Excellent`
  - `Healthy`
  - `Needs Attention`
  - `At Risk`
  - `Critical`
- reasons list

### Inputs

- fundraising vs target trajectory
- elapsed campaign time
- current velocity
- recent 3-hour velocity delta
- active ambassadors ratio
- inactive or unstarted ambassadors
- failed transaction rate
- daily goal gap

### Example Explanation

- pace is behind the target trajectory
- many ambassadors still have no first donation
- recent momentum improved over the last 3 hours

### Product Value

This creates a fast management answer to:

`What is the real state of the campaign right now?`

## 3. Velocity Model

### Outputs

- amount per hour
- donations per hour
- last hour
- last 3 hours
- today
- previous comparable period
- campaign average
- acceleration or deceleration indication

### Product Value

This model tells the manager whether the campaign is warming up, flattening, or dropping.

## 4. Forecast Model

### Outputs

- projected final amount
- projected target percentage
- surplus or gap versus target
- trajectory direction
- confidence band:
  - `low`
  - `medium`
  - `high`

### Rules

- deterministic weighted projection
- no fake statistical language
- confidence rises only when enough data exists

### Product Value

Forecasting creates an operations answer to:

`If we continue like this, where do we land?`

## 5. Ambassador State Model

### States

- `Hot`
- `Active`
- `Needs Attention`
- `Inactive`
- `Target Reached`

### Features Per Ambassador

- amount raised
- personal target
- target percentage
- donation count
- average donation
- first donation
- last donation
- hours since last activity
- fundraising velocity
- trend
- leaderboard rank
- rank change
- prize proximity
- team
- operational status

### Product Value

This model turns a flat leaderboard into a tactical management roster.

## 6. Intervention Priority Model

### Output

Ranked list of people or issues to address first.

### Reason Types

- has not started
- near personal target
- near prize threshold
- previously strong but now inactive
- recent sharp slowdown
- high-potential ambassador losing momentum

### Explainability Example

Good recommendation:

`Dana raised 4,200 yesterday, has had no donation for 11 hours, and is 600 short of her target.`

### Product Value

This is a direct management tool, not an analytics ornament.

## 7. What Needs Attention Now

This section summarizes the operational risks currently requiring action.

Each item should include:

- issue
- severity
- quantified evidence
- affected entity
- recommended action

Examples:

- ambassadors with no first donation
- hourly slowdown
- missing amount versus daily target
- ambassadors close to prize thresholds
- recent failed transactions

## 8. Campaign Fingerprint

### Purpose

Create a normalized summary object that can later support anonymous campaign benchmarking.

### Current Fields

- campaign duration
- target
- ambassador count
- active ambassador ratio
- donation count
- average donation
- fundraising velocity
- completion trajectory

### Product Value

This is foundational product IP for future benchmark products without requiring cross-tenant data pooling today.

## 9. Why This Is The Moat

GoodRaise's moat should not be chart styling.

The current moat comes from:

- documented health logic
- documented velocity logic
- documented intervention priorities
- explainable ambassador states
- reusable campaign fingerprint model

This is the part of the product that becomes difficult to copy well once refined over many campaigns.
