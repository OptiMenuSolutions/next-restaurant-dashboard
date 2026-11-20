# Step 4 volume implementation clarifications

The implementation uses the existing registered model major 4,
`approved-workbook-v4`, and its resolved versioned settings. This document does
not supersede the approved v4 rules. There is no separate volume-policy record,
new model major, database migration or activation requirement for Step 4.

History duration is the inclusive calendar span from the supplied first data
date to the latest complete, POS-covered date before the as-of business date,
divided by seven. Source failures do not advance that endpoint. The first data
date is retained from ingestion/backfill and need not occur in a truncated
calculation snapshot.

The settings-based tiers are: below minimum_history_weeks, needs baseline;
below minimum_trend_weeks, weighted levels without a trend; below
cold_start_weeks, a cold-start trend; below own_seasonality_weeks, normal trend
with benchmark seasonality; thereafter, own LY seasonality where usable.
A slope also requires minimum_trend_weeks eligible same-weekday observations.
Own LY requires minimum_ly_weekday_nights eligible base observations. The
centered LY target mean uses the eligible observations present in its configured
window; an empty window is unavailable.

When own LY is unavailable, the neutral benchmark input is 1.0. Apply the Census
strength transformation, seasonal bounds, A = L * S and the configured blend
without changing formulas. The trace identifies this as a used neutral
placeholder, not measured public data. A disabled public-data switch prevents
public data use but does not remove this neutral assumption. Step 11 will
provide real benchmark inputs through the same calculation.

Current windows cover [asOf - 7 * weeks, asOf), extending in whole weeks only
until minimum_weekday_nights is met or maximum_volume_lookback_weeks is reached.
Missing nights never become zero sales. The LY base shifts the selected current
window and latest eligible endpoint by year_alignment_days. Centering the
regression time axis at its latest eligible date is algebraically equivalent to
using the first data date and improves numerical stability. Calculations retain
full precision.

Calendar factors remain separate from base volumes and are applied once.
Closed targets return adjusted zero; unavailable open targets return null.
The shared eligibility rule, target handling and pure JavaScript design remain
unchanged. No scheduling, archive writes, recommendation or waste-risk consumer
is connected here. Applied migrations remain frozen.

The original eight-night v4 golden fixture and test are unchanged. A second
fixture exports the saved results/missing_cf_history.xlsx case: fourteen source
nights and eight cached calculation rows. That case uses non-neutral Census
proxy ratios and permits one-observation weekday estimates. Its component
golden compares cached L and R where minimum_weekday_nights is met; separate
tests assert the required neutral blend and needs-baseline behavior. It does not
claim that neutral outputs equal the case's non-neutral cached final volumes.
No workbook values are regenerated from the JavaScript engine.