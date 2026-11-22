Step 9: ranges, bias and calibration under approved-workbook-v4

This implements Ranges, Checked Archive and Bias Review with the existing
versioned settings. No new setting, model major, migration, scheduler, archive
writer or product integration is introduced. Points from Steps 4 and 5 stay
unchanged. Step 10 supplies archive reads and nightly persistence.

Inputs are explicit restaurant/as-of/snapshot/complete-service context, sealed
Step 4 and Step 5 outputs, source history, dish facts and immutable archive run
revisions. Archive runs nest their forecast nights and dishes from the existing
three archive tables. Select the latest visible whole run through its complete
supersession chain. Never mix different run revisions or regenerate forecasts.
Wrong tenants, duplicate identities, invalid structures and broken chains fail.

Checked observations use the shared volume eligibility with Step 8 statuses,
an inclusive lookback ending at the last complete service, exact major 4 and
calibration key, and positive stored volume. Dish checks additionally require
positive stored dish units and a matching source revision. Recommended and
sold-out nights remain included. Missing dish actuals are visible exclusions,
never invented zeroes. A null complete-service cutoff permits no observations.

Empirical ranges require two checked nights, the configured span, that many
distinct Monday-start weeks and a positive median. Percentiles use inclusive
linear interpolation. Volume ratios are median-centred and clamped around 1;
e is calculated after those clamps. Defaults interpolate near/far widths over
the eight horizons, with cold-start widening only in the volume error.
Existing dishes can use their own empirical ratios with the random floor. New
dishes use the fallback, widened by 1+(maximum-1)*(1-lambda). Independent dish
endpoints need not sum to the volume endpoints. No intermediate rounding occurs.

Distinct checked weeks count only Monday-start buckets at offsets 0 through
empirical_lookback_weeks-1 from the week containing lastCompleteDate. An oldest
partial week outside those buckets still contributes its observations to the
inclusive date window, span and percentiles. The unchanged workbook fixture's
legacy thirteen-bucket diagnostic is capped to twelve in its week-count checks;
all other golden comparisons and the fixture itself are retained.

Bias medians use completed Monday-Sunday weeks preceding the week containing
the complete-service date, including when that date is Sunday. Only the latest
configured consecutive weeks decide the status. Any missing median means
INSUFFICIENT HISTORY; every absolute miss over the threshold means consistent
forecast bias, regardless of direction. The diagnostic never changes points.
Confidence copies Step 4's history tier. Closed points remain zero; unavailable
points remain null. Calibration identity and settings/model provenance remain
explicit; older-major or differently calibrated archives cannot train ranges.

Golden provenance

Original workbook SHA-256:
97e91fb3cf46e6b4726cb121f00f8b70f3fcb42eb914059fdf8fa40a6865b882

LibreOffice-recalculated calibration-copy SHA-256:
6eac1f41b0a70a51765727fdd3f687173807907d270d31ea86f64d990face698

The copy changes only Checked Archive AY to 4 and AZ to the current calibration
key on rows 6-677. Formula caches were cleared before LibreOffice recalculation.
The fixture exports both sets of cached ranges and bias medians, source actuals,
eligibility, stored volumes and fixed stored dish proportions. Every factorized
dish forecast is checked against its original cached value within 1e-10. The
eight stored volume values are encoded as first value and increment; every
expanded value is likewise checked against its original cache within 1e-10.
Fixture compression is lossless test data, not an alternative model formula.
The exporter records both hashes; reproducible numerical caches are the target,
since LibreOffice may change file metadata and hence its binary SHA on another run.

One deliberate precision clarification: Inputs B42 rounds the derived z to two
decimals (1.28 at 80%). The requested runtime calculation uses the unrounded
normal inverse, 1.2815515655446, unless range_z_override is configured. Golden
cache tests use the existing override with the workbook's cached 1.28 to reproduce
its numbers, including D1 15.6033695335066-30.8208822051734. Separate tests cover
the unrounded default and both worked examples. This difference does not change
the five-key calibration identity or the major-4 point forecasting formulas.