Step 12: internal projection monitoring

Admin/MFA GET routes read stored business dates, immutable forecasts, completed
facts, flags, jobs and repairs. No monitor read calls the ingestion or forecasting
pipeline, source clock, lifecycle context or per-row timezone conversion. Dates
are not assigned again. Timezone is used only to format issue timestamps for the
admin. Job states come from saved jobs; the interface labels their business date
rather than inventing today's job when none has been dispatched.

The selected forecast is the latest visible whole-run leaf in its supersedes
chain. Earlier revisions stay linked with issue times. Missing vintages say
No forecast. Display lead 1 as day-of, and leads 2 through 8 as 1–7 days ahead.
Model major, calibration identity and interval coverage targets remain separate.

Actuals are mapped forecastable food units from the ingestion facts, which
already exclude non-sales lines. Reconcile fact totals and revisions against
the complete source night. Missing or stale facts are unavailable, not zero.
Pending source repairs without a stored affected interval make comparisons
unavailable; monitoring does not guess a business date by running a source clock.

A dish's primary comparator conditions its archived share on the categories
available in that archived night. Sum shares of those categories, sum their
actual dish units, then expected = scoped actual units × archived dish share /
scoped archived share. Disclose partial scope. Unclassified positive actuals,
missing scoped facts or zero scoped actual volume make share scoring unavailable.
Never infer historical category membership from today's menu classification.
Menu labels are current display names; archived dish IDs and categories govern
all scoring. Archived quantities and ranges remain separately visible.

MAPE averages valid observation-level |actual-expected|/actual with actual>0.
Show zero-actual exclusions beside every MAPE. WAPE is total absolute unit error /
total actual units; zero-actual unit errors remain in its numerator. A zero total
denominator is unavailable. Restaurant-level dish MAPE pools dish-night
observations equally; dish WAPE weights by actual unit volume. MAE, scored and
excluded counts are visible. Partial Monday-start weeks retain their actual
sample sizes within the selected inclusive 4-, 8- or 12-week date window.

Coverage uses original unrounded archived quantity limits, inclusive on both
ends, with its own eligible count and configured target. It is not coverage of
the volume-adjusted share comparator. All-complete versus regular-night filters
are explicit. Regular-night flags match the existing shared volume eligibility;
recommended and sold-out outcomes do not acquire a new calibration exclusion.

Bias is the exact Step 9 result saved in the selected latest archived run,
with its original issue date and source cutoff. Monitoring never recalculates
bias under current settings or feeds evaluation results back into the model.
Source corrections can change current actuals and error summaries while the
forecast and saved bias review remain immutable.

Bounded reporting queries return a compact, column-oriented snapshot. The pure
JavaScript monitor helper computes normalization and reporting aggregates;
SQL does not refit the model or redefine its formulas. Generated archive
category/status columns avoid repeatedly expanding large trace JSON. The exact
binary run UUID and stored date form a lossless indexed night key without
conversion to timestamps or a hash. Stable read functions use one statement
snapshot. Inspect individual dish traces on demand rather than transferring
every complete trace in a large archive response. Constant numeric columns are
transmitted once and expanded by the decoder; varied columns retain every value
and null position. This is lossless transport compression, with no rounding or
change to observation counts, scoring, archived quantities or archive storage.

The bounded report function uses query-local work_mem=64MB and JIT disabled;
these are database execution controls, not model settings. No scheduler, new
evaluation table, client feature, waste risk or recommendation integration is
introduced. Existing archive purge and frontend access restrictions still apply.

Performance validation uses a disposable synthetic restaurant with 365 completed
nights, 300 dishes and 365 eight-night forecast runs. SELECT execution and the
read-plus-JavaScript-scoring checks must remain below one second for overview,
service and 12-week accuracy reads.

Record production read timings after deployment. Maple is only an integration
check for benchmark 50dc184f-b99e-4299-b5cc-2e860d5f67ea and its curve digest;
its sparse sandbox observations support no accuracy conclusions.