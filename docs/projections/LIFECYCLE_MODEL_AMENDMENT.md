# Step 6 lifecycle clarification and approved setting extension

Model major 4 and the five-key v4 calibration identity are unchanged.

## Approved setting

`minimum_return_gap_days` is a positive safe integer, approved at 28 days.
The migration appends a complete global settings version containing this key.
It does not rewrite old settings versions or the registered model template.
SQL and the general JavaScript settings validator retain the original shape of
older versions. Steps 4 and 5 can resolve those versions without adding this key.
Step 6 alone requires an effective version that explicitly contains it.
Do not substitute today's setting into a historical settings snapshot.

## Initial menu and identity

The onboarding boundary is restaurants.onboarding_completed_at. A dish created
on or before that instant is existing, including later recipe publications and
multiple onboarding upload batches. While onboarding is unfinished, no dish is
a launch. Initial availability starts at first_data_date, or is unbounded.
A first data date is required before passing initial dishes to Step 5.

A later addition launches on its restaurant business date, unless positive
mapped POS sales on an eligible earlier night prove it already existed.
Such proof moves its initial origin to the first eligible sale and records
inferred_existing_from_prior_sales. Mapping validity windows still apply;
zero sales never prove removal. A POS button change never changes dish identity.

## Physical availability versus launch episodes

Physical windows are half-open [valid_from,valid_until). A gap shorter than the
versioned minimum belongs to the original launch episode and retains its launch
date/new-age clock. The gap remains unavailable and supplies no dish evidence.
A gap at least the minimum starts a returning launch. The prior category count
uses availability at removal, including the departing dish on that date.
A known category cannot be changed after facts or launch observations exist.

Step 5 accepts optional explicit availability. Missing facts inside availability
still fail; missing facts outside it are excluded, not fabricated as zeros.
Existing formulas, launch-index precedence, cap behavior and golden fixtures
are unchanged. Owner estimates remain disabled.

## Launch observations and storage

The first four weeks mean launch through launch+27 inclusive. All open nights
must be complete and POS-covered, and the window must end before as_of.
An episode ending inside it skips learning. Short gaps within an episode exclude
off-menu nights as unavailable and learning continues from its available nights.
Shared eligibility plus dish recommendation and sold-out flags selects clean nights; null flags remain clean but disclosed.
The unweighted dish/category unit ratio times (existing non-new dishes+1) is
stored without clamping. Simultaneous launches are not existing dishes.

Only projection_store_launches can insert service-role launch observations.
A per-restaurant lock fences the context, identical retries do nothing, and
changed observation digests append a superseding version. Raw versions are
returned for Step 5's existing observed_through/as_of and created_at/snapshotAt
filters. Source snapshots supplied for backtests must themselves be historical;
a snapshot timestamp does not reconstruct past mutable POS/fact rows.

## Tracking, repairs and later orchestration

The nonblocking menu trigger preserves primary menu edits and queues failed
transitions. Repair replay is explicit and tenant-scoped. It continues past a
failure while preserving order within each dish. Pending repairs quarantine only
their dishes and categories; other categories continue. Original failure times
and attempt counts, error codes and error messages are retained. The existing
service monitor alerts on repairs older than 24 hours using its existing consecutive-check and recovery flow.
Business-clock fallback is audited for tracking; normal context reads still require a valid operational
timezone. The migration backfills known menus and extends account purge.
New dish identities start forecastable=false with no invented category.

Step 10 must replay repairs, re-ingest nights affected by mappings or corrected
availability, then reload lifecycle context before producing shares. Missing or
stale facts and reconciliation differences put each affected launch in pending
with facts_require_reingestion and its dates; they do not throw away the run.
Callers pass plan.dishes, plan.availability and plan.launch_history to Step 5. Nightly
scheduling, setup/category classification, waste risk and recommendations are
outside Step 6. No financial or inventory formulas change.

Prior-sales inference returns one aggregated earliest eligible sale date per
post-onboarding dish, before its added business date. Effective clock segments
reuse Step 2's boundary function, including settings transitions and DST, without
calling the clock for every POS line. Category totals retain measured facts while
a repair is pending; unreconciled nights are excluded from share evidence rather
than filled with invented units. Other share formulas and golden tests stay unchanged.