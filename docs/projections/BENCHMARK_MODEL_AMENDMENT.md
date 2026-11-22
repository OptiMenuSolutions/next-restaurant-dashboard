Step 11 adds benchmark inputs to model major 4 without changing its
calibration key, base formulas, holiday priors, ranges or eligibility.

Seasonal source order is usable own LY, permitted pooled ratio without
damping, public proxy with versioned damping, then explicit neutral or
recent-only fallback. Apply the seasonal bounds after source selection.
Launch order remains returning season, own launch mean, pooled contributor
mean, then default. There is no pooled holiday prior.

Census uses FRED MRTSSM722USN and CUUR0000SEFV at an explicit real-time
vintage. Deflate monthly sales by CPI/100. Normalize using the sum of
fitted weekday weights across the actual month. Open weekday weights
average one; closed weekdays are zero. Preserve Step 3's last-four-night
closure rule. Monthly points use the midpoint between the first and last
dated observations. Interpolate daily, then average Monday-start weeks.
Do not bridge missing months or extrapolate. Align by 364 days and use
the exact R-fit recency weights in the denominator.

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

Keep previously applied migrations frozen. Review and apply the new
Step 11 migration separately. Add FRED_API_KEY to server environments,
redeploy, build a candidate, review all eight weeks and approve the first
version. This does not enable restaurant projections or pooling, and
does not connect projections to waste risk or recommendation selection.