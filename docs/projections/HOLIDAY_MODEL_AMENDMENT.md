# Step 7 holiday learning implementation

Model major 4, existing settings, and all volume/share formulas are retained.
There are no new thresholds or learned-factor bounds.

## Factors

A single holiday blends its effective Step 3 default with exact-key observations:
(default + sum of ratios) / (1 + n). A combination's prior is the product of its
components' learned single-holiday factors. Blend that prior with exact-combination
observations. Closed wins; early close uses only its separately learned factor.
Reopened Thanksgiving and Christmas retain their neutral 1.0 starting defaults.

The full-service concept fallback, dated-answer precedence and optional owner
experience remain Step 3's responsibility. Step 7 retains those classifications.

## Learning and provenance

Each usable past business date contributes one observation. Early-close dated
answers select the reserved early_close key; otherwise use the full sorted set of
calendar holiday keys. Complete, covered, POS-open nights are required. Missing or
zero L and needs-baseline nights are skipped with their reason, never turned into
an observation with an invented ratio.

Normal L is the day-of Step 4 recent.L, excluding that date's service. Reconstruct
Step 4 asOf that date until a day-of archive exists. Reconstruction applies the
explicit supplied v4 settings to the earlier history and records that provenance.
An available archive takes precedence; an unavailable archived baseline is not
silently replaced. Store archived Step 4 night output at forecast_nights.trace.volume
in Step 10, retaining its recent.L, source nights and per-night provenance.

Only projection_store_holidays inserts service-role observations. The tenant lock,
source-context digest, immutable supersession chain and unique original per date
provide retries and corrections. Existing account purge covers the table.
An old observation whose current source is no longer usable remains in immutable
history but is excluded from the current factor snapshot. No fake zero ratio or
history deletion is used. Backtests must supply historical source snapshots;
a capture timestamp cannot reconstruct earlier mutable source facts.

## Integration

Step 4 optionally verifies and consumes a holiday snapshot. It exposes base_volume,
calendar_default_factor and selected_factor separately. The selected factor only
changes adjusted volume. Step 5 forwards that same snapshot when recomputing Step 4.
The holiday and share snapshots must have the same capture time.
Without it, existing outputs and golden fixtures are unchanged.

Read source context, save learning, then reload with a new snapshotAt before
archiving forecasts that should include those observations. Step 10 owns this
orchestration; Step 7 adds no cron, dashboard, waste-risk or recommendation flow.
The reader uses the existing Gregorian calendar preparation and still requires a
published Super Bowl date when the forecast horizon intersects February.

## Workbook fixture

The exported fixture records the v4 workbook SHA and all cached rows, grouping
identical arithmetic cases. It covers 90 Holiday Calendar rows, 89 Holiday Dates
rows and Holiday Learning F-G plus B28. The workbook's static summary tables use
the full six-row observation sample even on earlier calendar dates. Golden tests
check that arithmetic; runtime tests separately enforce observation-date and
created-at cutoffs. B28 is 0.62: (0.60 + 0.60 + 0.66) / 3. The 0.60 setting is the
starting early-close factor, not that sample's learned result.