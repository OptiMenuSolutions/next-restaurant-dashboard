Step 11 adds benchmark inputs to model major 4 without changing its
calibration key, base formulas, holiday priors, ranges or eligibility.

Seasonal source order is usable own LY, strictly positive permitted pooled
ratio without damping, then a usable public proxy with versioned damping.
Before any benchmark is published, volume retains the neutral 1.0 placeholder.
After publication, an unavailable volume ratio uses R alone and records the
reason. Categories retain their neutral 1.0 fallback. Census applies at every
forecastable history tier; there is no separate eight-week benchmark minimum.
Apply the seasonal bounds after source selection.
Launch order remains returning season, own launch mean, pooled contributor
mean, then default. There is no pooled holiday prior.

Census uses FRED MRTSSM722USN and CUUR0000SEFV at an explicit real-time
vintage. Deflate monthly sales by CPI/100. The v4 weekday-composition
adjustment removes the national weekday mix from national monthly totals;
it never uses the receiving restaurant's weekday levels or closed days.
Benchmark settings version 1 pins census_weekday_weights to
[1,1,1,1,1,1,1] in Monday-to-Sunday order: divide by calendar days as an
explicit interim until national weekday evidence supports different weights.
Changing the vector requires a new benchmark settings version and a new
benchmark version. The first publication of changed settings requires admin
review; later monthly versions with identical settings may publish automatically.

Compute the national monthly curve once per benchmark version, before the
restaurant loop. Store its unrounded points, settings and digest immutably.
Nightly runs and archived counterfactuals read that pinned curve; they never
rebuild it from restaurant levels or current settings. Record the national
weights, curve digest and exact restaurant baseline dates/recency weights
in forecast traces. Closed-weekday exclusion remains at the forecast and
preview level, never in the national monthly denominator.
Monthly points use the midpoint between the first and last calendar days.
Interpolate daily, then average Monday-start weeks. Do not bridge missing
sales months, multi-month CPI gaps, or extrapolate. Align by 364 days and
use the exact R-fit recency weights in the denominator. The old unpublished
restaurant-weighted candidate stays immutable and cannot be approved;
rebuild and review a new national-weighted candidate.

CPI normalization revision isolated-log-linear-v1 applies only to newly
captured CPI pulls carrying that version in query_metadata.cpi_gap_policy.
An isolated missing CPI month is sqrt(previous published CPI × next published
CPI), using its exact adjacent calendar months in the same pinned vintage.
Never chain interpolations or fill two consecutive missing months. Preserve
the raw FRED payload, including dots; store the derived month/value and
cpi_interpolated=true in query_metadata.cpi_interpolated and forecast traces.
Legacy pulls without the marker retain strict gap behavior. Archived runs
and counterfactuals use their original pull's rule and vintage.
Changing this normalization rule requires a new rule identifier and a new
benchmark version. Never rewrite existing pulls or archived forecasts.

Missing preview-day ratios remain null with applies=false and their reason;
the approval page displays dashes and reasons. After approval those forecast
days use R alone, as previously approved. A usable eight-week preview has
seven day entries per week and at least one finite positive applicable ratio
in each week. Some unavailable days are allowed. At least one restaurant
must have such a preview before manual or automatic publication.

The first published benchmark requires MFA-verified admin approval at
/admin/projections/benchmarks. Show eight Monday-start weeks for every
active restaurant, including explicit setup or baseline-unavailable
reasons. A candidate never enters forecasts before publication. Later
validated monthly versions can publish automatically. Failed refreshes
retain the last good version with stale/error status. Manual candidate
rebuilds append versions and require review.

Pooled donor baselines are frozen at monthly capture. Store one aligned
ratio per contributor/value, not sales levels. Each restaurant contributes
one mean launch index, regardless of its size or launch count. Select
concept × state, then the same concept nationally. Exclude the receiver
and require at least five actual usable contributors. Consent is required
for contribution and receiving. Pooling remains globally off by default.
Current consent and the privacy floor are checked when values are used.

Forecast archives contain aggregate pooled inputs, never donor identities.
Account purge deletes previews, raw contributions and receiver-owned
totals. Other previously computed aggregate-only totals may remain.
Purged contributions cannot enter subsequent calculations.

Dictionary v1 is effective 2026-11-22. Comfort/Heavy terms are soup, beef
stew, pot roast, mac and cheese. Light/Fresh terms are salad, grain bowl,
grilled vegetables, grilled fish. Neutral is deliberately 1.0. Requests
are separate per phrase, with pinned U.S. state, web search, category 0,
English and weekly data. Every target and weighted-base week must be
strictly positive for a term to qualify. Combine at least two usable
terms geometrically. Phrase/filter/topic changes require a new dictionary
and benchmark version. Live Trends remains neutral until an approved API
provider is available; this implementation contains no unofficial scraper.

FRED_API_KEY is server-only and never enters stored query metadata.
Historical snapshots cannot read future vintages or approvals.
Counterfactuals rebuild their run-free R baseline with the original
day-of archive's public vintage and aggregate pool inputs.

Keep previously applied migrations frozen. Review and apply the pending
Step 11 migration separately. Add FRED_API_KEY to server environments and
redeploy. The first candidate needs at least one completed backfill:

1. Enable projections for one restaurant using the Step 10 rollout control.
2. Let that restaurant's initial history backfill finish.
3. Build the candidate at /admin/projections/benchmarks.
4. Review the eight-week preview, including unavailable restaurants.
5. Approve the first benchmark version.

Pooling remains separately controlled and off by default. This does not
connect projections to waste risk or recommendation selection.