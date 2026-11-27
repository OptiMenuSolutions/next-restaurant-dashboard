Waste-risk projection integration — Stages 1 and 2

The calculation and service-only persistence layer are implemented. Nothing
calls them from a scheduler, client dashboard, inventory write, recommendation,
financial metric or OptiScore flow yet. Those integrations remain later stages.

For ingredient i on business night D:
  demand(i,D) = archived night low × sum(archived overall dish share ×
                                         converted standard-recipe portion).
Never sum dish lower bounds or renormalize the remaining shares. Closed nights
contribute zero. Use by D includes D's service, ending at the next business
boundary (normally 4 a.m. local).

Recipe coverage

Ignore dishes with archived share zero. Credit demand from complete linked
recipes. Record every uncovered dish and its archived share on each night.
Within the versioned waste_recipe_uncovered_share_max (initially 0.10), compute
from the covered recipes and disclose “may be overstated”: missing recipes
understate expected use and overstate risk. Above the limit, or when an
uncovered dish's share is unknown, return recipe_coverage_incomplete. A known
recipe using the ingredient with an unavailable forecast still makes that
ingredient unavailable. An unrelated dish with a complete recipe does not.
Freeze coverage, the limit and the settings identity with the demand evidence.
Historical settings without the new key remain readable by the projection
engine; new waste assessments explicitly require a stored version with it.

Freezing and exact values

Freeze only when quantity − allowance > 1e-9 × max(1, quantity). The same
comparison controls visibility. Smaller residuals produce risk zero and never
create a permanent case.

The first positive batch fixes one demand per ingredient/night for all batches.
Later freezes cannot replace it. Newly covered nights use the latest valid
archive. Batch cases retain first-positive identity and coverage; each demand
retains an independent copy of its original owning case. Missing records inside
saved coverage are unavailable, never replaced by a newer forecast.

JSONB stores quantities, lows, shares, portions, conversion evidence and digests
without decimal rounding or numeric(p,s) casts. A database round trip must
preserve JS double values exactly, including quantity === night_low ×
weighted_portion. Typed UUID/date columns are indexes and scope checks, not
rounded copies of the calculation. Digests check integrity, not authorization.

FIFO, cutoffs and overdue stock

One ingredient-wide FIFO pass uses received business date then stable source
batch ID. Include competing stock outside the card window. A batch can receive
allowance only on/before its own use-by. Cap allowance at remaining stock;
release unused future capacity FIFO after depletion, counts or disposal. Remove
elapsed allowance nights first, so a shortfall is never counted on two batches.

Actual inventory keeps consuming an older overdue batch until disposal is
confirmed. Forecast allowance stops at use-by. Example: Monday A has 10 lb
(use-by Monday), B has 20 lb (use-by Wednesday), with demand 8 lb/night. After
Monday consumes 8, Tuesday starts with A 2 overdue and B 20; B's risk is 4.
Tuesday's 8 actual lb consume A 2 and B 6. Wednesday B has 14 with allowance 8:
B's risk rises to 6, while A's 2 lb overdue risk disappears. Combined risk stays
6. Confirming actual disposal removes stock through the existing inventory
flow; this layer never records disposal or changes physical stock itself.

Assess daily using inventory through the latest completed business date. Use
only allowance nights after that cutoff. Separately retain each archive's run
ID, issued_at, source_through and age. A missed forecast can use remaining dates
in the latest publication; missing tail dates remain unavailable. Existing
freezes work without a new forecast. Never use calendar sale_date as a substitute
for inventory business dates. Modifier-aware actual use versus standard-recipe
allowance remains a known gap.

Persistence and controlled corrections

waste_projection_state fences concurrent writes with a restaurant version.
waste_projection_assessments keeps immutable assessment metadata, the
SHA-256 digest of the normalized input, and a compact result with forecast
and settings provenance. Version 2 keeps current-window items and overdue
items with a use-by date at most seven business dates before the assessment
date, inclusive. It keeps unavailable estimates in needs_review with their
source stock quantity and unit. Other batches contribute counts, known
risk value and an unvalued count in omitted_by_status. The 30-day payload
keeps the complete item list, allocation details and per-night demand traces.
waste_projection_demands and waste_projection_cases retain append-only version
chains. waste_projection_corrections records the actor, database authorization
time, allowlisted reason, source-event reference and explicit affected scope.
All six tables have RLS and no frontend or direct service writes. Restricted
service-role RPCs read or commit the assessment state. Account purge removes
all six tables' tenant rows and records the counts in the existing hashed
purge log.

waste_projection_assessment_payloads keeps the full normalized input and
detailed result for 30 days (720 hours from the database save time). Loaded
frozen state and the resulting frozen state are represented by the separate
append-only case and demand records. The service-only expiration RPC deletes
up to 100 expired payloads per call. Stage 3 will invoke it from scheduled
maintenance with bounded batches, including for disabled restaurants. The
assessment, input digest, compact result, corrections and frozen records
survive expiration. Retries keep working through the retained digest and
correction record.

prepareWasteRiskAssessment reads stored settings and frozen state and calculates
an envelope; commitWasteRiskAssessment atomically stores it. Keep the same
request UUID/envelope for transport retries. PT409 means reload and recalculate;
never submit the rejected state as an override. Concurrent first freezes are
serialized by the restaurant advisory lock and checked against the read version.
New freezes must reference that restaurant's archived lows and dish shares.

The trusted server caller must supply the complete normalized inventory,
archive and nightly recipe snapshot. These RPCs are not browser endpoints and
do not authenticate an arbitrary owner-supplied snapshot. Stage 3 will build the
source reader and connect existing verified correction events; source_event_id
is an audit reference, not a substitute for that event verification.

Allowed reassessments: invoice quantity/date correction, physical count,
confirmed disposal, storage/shelf-life change, dish removal, confirmed closure.
Count/disposal/quantity changes retain fixed demand and recalculate reservations.
Date/shelf-life changes retain existing ingredient/night freezes; only newly
covered nights can freeze from a newer valid archive. If a forecast is missing,
that already-authorized extension may finish covering its nights later.
Closure replaces the scoped night's low with zero. Dish removal subtracts only
its scoped contributions without reallocating shares. Both retain the original
archive identity and append a new record; neither edits the original decision.
Other reasons never reset a freeze. Actor must be the restaurant owner or a
stored admin, as independently checked by the service-only commit RPC.

Normalized input contract

assessProjectedWasteRisk accepts restaurantId, assessmentDate, assessedAt,
timeZone, cutoffMinutes, inventoryCutoff, inventoryComplete:true, ingredients,
batches, forecast, recipes, resolvedSettings and frozen:{demands,cases}.
Use canonical lowercase UUIDs, explicit-offset timestamps, YYYY-MM-DD business
dates, numeric values and explicit nulls for unknown fields.

Ingredients include tracked unit and approved conversion metadata. Batches use
stable invoice-item or count-lot IDs, never rebuild-generated inventory row IDs;
include received_date, use_by_date, remaining_qty, unit and batch unit_cost.
Forecasts supply eight archived nights and all active dish shares/statuses.
Recipes enumerate active dishes, including incomplete/unlinked recipes.
Return all statuses, positive visible items, review reasons, recipe coverage,
daily demand/allocation traces, new proposals and the next frozen state.

Unlinked lines need ingredient linking. Unknown age, FIFO ordering, conversions
or forecast evidence remain unavailable. Quantity can be available with unknown
dollars; otherwise dollars equal risk × batch cost in the canonical unit.

Acceptance checks

80 × (0.6 × 0.25 lb + 0.4 × 0.125 lb) = 16 lb conservative expected use.
60 − 30 = 30 lb risk; after actual 10 versus allowance 8: 50 − 22 = 28 lb,
worth $126 at $4.50/lb. A 2 lb shortfall changes combined risk by 2 lb once.
With 20 future lb, correcting older A from 12 to 6 lets newer B 24 reserve 14:
risk 10. Discarding A releases all 20 to B: risk 4. A Thursday freeze of 8 lb
stays 8 for a batch joining Wednesday despite a fresh Thursday forecast of 10.

Rollout boundary

Keep the legacy card exactly unchanged until projections are enabled and a
completed assessment activates the new view. No Estimate unavailable merely
because projections are off. Later scheduling follows each restaurant's
business clock after publication, with a separate missed-run path, never the
09:00 UTC waste cron. An assessment failure cannot undo a published forecast.

Echo Tap: last invoice 2026-07-29, last POS sale 2026-07-17, no POS connection.
Real validation requires POS reconnection, resumed invoices, projection setup,
backfill and an inventory rebuild. Maple supports plumbing checks only.

### Shift4 ticket completeness

The read-only Maple sandbox probe for November 17–18, 2026 returned 29
tickets in one response. The top-level fields were `meta` and `results`.
The only observed `meta` key was `count`, with value `29`. No next link
appeared.

[Shift4’s pagination documentation](https://conecto-api.shift4payments.com/docs/overview/queries.html#pagination)
defines `meta.count` as the total number of items matching the request.
The single-page Maple observation is consistent with that contract.
Live multi-page traversal for
[Retrieve Tickets](https://conecto-api.shift4payments.com/docs/pos/ticket-methods.html#retrieve-tickets)
remains unverified. The endpoint’s documented query parameters do not
include `offset` or `limit`, and the probe that supplied both received
HTTP 400.

The sync follows provider-issued next links and checks the collected
ticket count against the declared total before replacing sales. An empty
final page is accepted when the collected count equals the declared
total. An empty page before the total reconciles fails the pull.

Count reconciliation is the completeness guard for Retrieve Tickets.
Following provider-issued next links is defensive. If Shift4 confirms a
per-response cap, the planned remedy is to split the requested time
window and reconcile each smaller response before replacing sales.

### Stage 3 POS sync

The scheduled sync, manual sync and assessment worker share one POS sync
path. A restaurant-scoped database lease covers the provider pull, sales
replacement, raw-ticket save and POS usage. A competing invocation reports
a retryable conflict without replacing sales or changing connection status.
The six-minute lease is longer than the 300-second invocation limit.

### Stage 4 Tonight’s Dish

Keep Tonight’s Dish at 11:00 UTC. Both surfaces read the latest completed
compact schema-version-2 assessment available at read time, when projections
and the separate surface switch are enabled. An assessment for a prior
business date is marked stale. The card can display an older assessment.
Tonight’s Dish accepts the current or previous business date and records its
fallback reason when it uses the existing path. The generation summary and
saved briefing record the selected input. A new assessment may influence the
next generation. The saved staff briefing honors the NFC lock.
The dashboard checks the same assessment ID before showing projected waste
on a saved dish and drops the badge when the supporting batch is handled or
past its use-by date. An estimate with a use-by date equal to the target
service date is eligible for that service.
Individually retained overdue rows feed the card’s confirm-or-discard
prompts. The card can show a count and known at-risk value for older
overdue rows. Tonight’s Dish excludes overdue rows and any batch whose
use-by date precedes the target service business date, including when the
assessment is stale.

A disposal confirmed at or after the latest assessment’s inventory boundary
appears immediately as “Confirmed wasted · pending next assessment” on the
card. Individually matched batches are excluded from displayed at-risk
amounts. Summarized overdue disposals are shown as handled with the note
“Includes N confirmed wasted, updates after the next assessment.” The
permanent subtotal remains the saved assessment subtotal.

Per-restaurant local scheduling for Tonight’s Dish is a follow-up because
11:00 UTC can fall before the business cutoff west of Eastern time.

For the Stage 4 card, apply the same seven-business-date cutoff to
needs_review rows with a known past use-by date. Summarize older review
rows by reason. The card shows only aggregate counts and known risk value
for outside_risk_window batches.

Keep the surface switch off for all restaurants across the three Stage 4
deployments. Administrators can read or set it using the authenticated
waste-assessment-switch API. The switch controls the two consumer surfaces
independently of forecast and assessment processing. Maple is the only
restaurant eligible for launch activation after the Nov 28 commit review.

### Stage 3 correction sources

The verified sources are confirmed disposal and dated holiday closure.
The source save schedules a best-effort recording hook. The daily worker
recovers missing records and consumes eligible corrections in its leased
assessment. A restaurant owner or admin profile is required. Unauthorized
events receive a terminal disposition. Disposal uses inventory replay
with the strict confirmation timestamp cutoff. A verified closure records
closed_night for its unelapsed business date and retains archived forecast
provenance. If a later answer supersedes an applied closure, its original
assessment link stays in the source audit for review.

### Stage 5 controlled rollout

Maple is the internal pilot. Review its Nov 28 compact, multi-correction
assessment and the 11:00 UTC Tonight's Dish run before enabling it from
Projections admin. Check desktop and mobile card dates, quantities and
confirmations, and the source recorded by the next new recommendation
generation. Watch the first three daily cycles, including a stale or
fallback path when one occurs.

Echo is the first customer candidate. Verify live SkyTab syncing before
enabling projections in the background. Keep the owner-facing switch Off
during observation. Require at least two weeks of real sales coverage and
completed assessments. Extend the window for missing evidence. Review the
dated comparison and record approval before enabling the switch. All
customer switches stay Off through the Dec 2 launch.

The comparison joins dated invoice-batch snapshots to the assessment's
inventory cutoff. The snapshot schedule is 09:00 UTC. The saved observation
time and the restaurant's inventory boundary are shown separately. Legacy
snapshots lack historical units and count-only rows. Permanent assessment
summaries preserve counts and known values for omitted batches. Historical
batch identities are available where the compact result retains them.

Each successful generation saves shadow evidence with the daily briefing
for an enabled projection restaurant. It records the ingredient list used,
the projected alternative and its source or fallback reason, and legacy
evidence when available. The existing daily briefing cache retains the
latest saved generation for a date. Shadow evidence is collected after
selection and is excluded from the owner recommendation API response.

Review skips, failures, cutoff-to-save delay, commit RPC timings against
8 seconds, compact and payload bytes, fallback runs, review reasons and
pending disposals. Commit timings in the existing job records are
aggregated across the dispatcher run.

For rollback, capture the assessment ID, business date and symptom if
readily available. Turn the switch Off in Projections admin and check the
audit, refreshed legacy card, next generation's switch_off source and
continued background assessments. Check issued staff briefings under
the existing cache and NFC lock. Rollback needs no deploy. Local
scheduling for Tonight's Dish remains a separate follow-up.