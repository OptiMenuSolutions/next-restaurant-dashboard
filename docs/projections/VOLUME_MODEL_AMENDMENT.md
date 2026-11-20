# Step 4 volume implementation clarifications

The source of truth is OptiMenu_Projection_Review_v4.xlsx, specifically Volume
Model v4 and LY Level. The implementation uses the registered major 4 model,
approved-workbook-v4, and its existing resolved versioned settings. There is no
separate volume policy, new major, SQL migration or activation in this step.

The history origin is the first complete POS-covered source night on or after
the first-data cutoff. History weeks are (last complete date - first complete
date + 1) / 7. No complete source nights means zero history. A calculation
snapshot must include its origin source row even when it lies outside the fit
windows; the first-data cutoff must not be substituted for that row.

Below minimum_history_weeks there is no baseline. A current slope requires a
history span at least minimum_trend_weeks and at least two eligible weekday
observations. Otherwise its level is the weighted mean and its slope is zero.
minimum_trend_weeks is a duration, never an eligible-observation count.

LY Level uses no own level with zero eligible base nights. With fewer than
minimum_ly_weekday_nights it uses the weighted mean and records LY level from
average. At or above that threshold it uses the fitted endpoint at the latest
eligible LY night. Own LY is usable when L_LY is positive and its centered target
window contains at least one eligible observation. own_seasonality_weeks affects
only the tier label and never gates this availability. cold_start_weeks also
only affects labels here; its range effect belongs to Step 9.

When own LY is unavailable, enabled public benchmarks supply the neutral ratio
1.0 until Step 11. Apply census_strength, the seasonal bounds, A = L * S, and the
configured blend. With public benchmarks disabled and no pooled input available,
use R alone. A pooled-data switch does not establish that pooled data exists.
L_LY = 0 follows the same fallback path; there is no special neutral-denominator
flag. Own LY remains usable when public benchmarks are disabled.

Intentional difference from the workbook: the spec requires extending the
current window in whole weeks toward minimum_weekday_nights, up to
maximum_volume_lookback_weeks. Keep that extension. After reaching the maximum,
one eligible night still supplies a weighted level, as v4 requires; zero eligible
nights means needs_baseline. Below minimum_history_weeks remains needs_baseline.
Missing source nights never become zero sales.

Windows use restaurant business dates before the explicit as-of date. The LY
base shifts the chosen window and latest eligible endpoint by
year_alignment_days. Centering the time axis at the latest eligible night is
algebraically equivalent to the workbook origin and improves numerical stability.
Full precision, calendar-factor separation, closed-target handling, shared
eligibility, deterministic digests and JavaScript-only calculations remain.

The original eight-night golden assertions and expected fixture remain unchanged.
Its input helper additionally includes the workbook's cached first complete
source row, outside the fit windows, so the observed span also matches v4.
The limited-history fixture now checks L, R, raw slope, horizon and observation
counts for all eight targets, including one-point weekdays. It also checks the
supplied factors and cached closed-target output. Remaining cached seasonal and
nonclosed final-volume differences come from that case's non-neutral Census
proxy ratios; Step 4 deliberately supplies neutral ratios. Cached workbook values
are preserved rather than regenerated from JavaScript outputs.

No scheduling, archive writes, ranges, recommendation or waste-risk consumer is
connected. Applied migrations and the existing housekeeping fixes remain unchanged.