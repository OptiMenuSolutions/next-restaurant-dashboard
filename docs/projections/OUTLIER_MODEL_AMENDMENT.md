# Step 8 outlier runs and permanent decisions

This implements major 4, Revision 2 and the handover clarification. The existing
outlier_ratio_min/max settings are the lower/upper bounds (0.65/1.35). No new
thresholds, settings or model major are introduced.

## Observation and runs

Compare complete, covered, open, regular-night units with the stored day-of
expected volume, where run_date equals target_date. This is not the next-day
forecast, L, or a forecast refitted after seeing the actual. Select only visible
archive versions with source_through before that service date.

Without a positive available stored forecast, keep unchecked, diagnose
no_stored_forecast and retain normal eligibility. This observed unflagged night
ends a run. Incomplete, uncovered, closed, holiday and early-close nights are
untested and skipped. Recommendation and sold-out flags never remove volume.

Same-direction flagged tested nights form runs. A normal or opposite-direction
tested night ends one; the latter starts a separate run. Provisional, isolated,
short, pending and one-off nights are excluded. Active runs and confirmed shifts
are included. All nonfinal classifications are recomputed from raw sources.

## Counterfactual replay

For an ended run at least shift_run_nights long, test the first post_run_nights
observed nights, beginning with the terminating night. For each, replay the
historical statuses before that target, force the tested run out, then call the
unchanged Step 4 with asOf equal to the target. Retain the complete-source cutoff,
full volume trace, source dates and historical status snapshot. An optional
sourceThrough input anchors the existing Step 4 windows and weights to the last
complete source night. Its default preserves every existing Step 4 output; Step 5
forwards it when verifying such a snapshot. Test targets are
regular nights, so their calendar factor is 1, applied through Step 4 normally.
No target or future units enter that target's fit. A flagged post-run night is
excluded from the subsequent tests while provisional. Earlier final decisions
are visible only after their decided_through date and within snapshotAt.

Wait for every ratio. Missing context, missing baseline and nonpositive forecast
leave pending_review with missing_run_free_forecast_context. Round ratios only
for comparison, using comparison_decimal_places. Any breach in the run direction
confirms a shift; none makes a one-off event, including opposite-side breaches.
Unrounded forecast and ratio values remain in the trace.

## Persistence

The single service-only writer saves final decisions and all replayed nightly
flags atomically under the restaurant ingestion lock. It fences source changes
and refuses an older replay overwriting a newer one. The existing ingestion
function may still reset status to unchecked when its source revision changes.
All other direct status changes are blocked.

Permanent decisions never update or supersede. Saved membership forms a fixed
block. Conflicting membership is excluded with duplicate_final_decisions; the
membership primary key prevents storing such conflicts. If corrected data gives
a different candidate, retain the original and expose
saved_decision_retained_candidate_differs, including in saved flag diagnostics.
A saved trace records source revisions, ingestion generations, archive IDs, units
and night flags for its members, tests, interval and counterfactual dependencies.
Settings, model identity and first_data_date stay in the immutable decision trace,
not in this source-only evidence. Rechecks use that frozen decision context.

projection_run_decision_reviews stores append-only review outcomes and candidate
summaries. A supersession chain and current view provide one current row per
decision. Compare the current source digest with the latest visible review, or
with the original decision evidence if there is no review. Matching digests skip
replay and retain the cached diagnostic. A new digest triggers one comparison;
the existing restricted writer appends its outcome under the restaurant lock.
A successful save establishes the new comparison point. Identical and concurrent
retries append no duplicate review. reviewed_at limits historical visibility.

Ingestion generations come from projection_ingestion_state, not flag updated_at;
outlier flag writes therefore do not invalidate evidence. Legacy decision evidence
is compared without its old context field; absent evidence is conservatively
reviewed once. saved_decision_rechecks counts actual candidate comparisons.
Account purge removes reviews before decision members and decisions and records
the deleted review count. The immutable decision is never rewritten.

Backtests use decisions with decided_through < asOf and created_at <= snapshotAt.
They must supply the historical source snapshot: mutable source facts cannot be
recovered from a capture timestamp alone. Archive selection and final decisions
are time-filtered; no day-of archive is manufactured for backfilled POS history.

The cached workbook fixture includes every Nightly History H-P row, all populated
Run Review A-AD rows, enabled Counterfactual Model E-AO rows and Final Decisions.
Dates and numbers come from workbook caches, not generated engine expectations.
The static sheet's KEEP maps to normal or unchecked according to archive presence;
CLOSED/HOLIDAY/INCOMPLETE remain source diagnostics rather than outlier statuses.

Step 10 will orchestrate reads, saves, subsequent forecasts and archive writes.
This step adds no cron, UI, waste-risk or recommendation integration.