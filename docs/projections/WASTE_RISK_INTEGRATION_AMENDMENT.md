Waste-risk projection integration — Stage 1

Scope

This stage adds a pure calculation module and acceptance tests. It has no
network, database, scheduler, environment-variable or implicit clock reads.
No existing caller uses it yet. Physical inventory, waste snapshots, client
cards, recommendations, financial metrics and OptiScore retain their meaning.
Persistence, authorized corrections, job integration and UI activation follow
in later stages.

Demand and freezing

For ingredient i on business night D:
  demand(i,D) = archived night low × sum(archived overall dish share ×
                                         converted standard-recipe portion).
Do not sum dish lower bounds, damp this result again, or renormalize partial
category shares. Closed nights contribute zero. An unavailable forecast for
any active dish using i makes i's estimate unavailable for that night.

The first positive batch case fixes the ingredient/night demand for every
batch of that ingredient. Fixed values, night lows, shares, portions and
conversion evidence are returned as records with integrity digests.
Newly covered nights use the provided latest valid archived forecast.
A later freeze never replaces a fixed night, including after the original
batch is depleted or hidden. Cases record the initial inventory cutoff.
A missing frozen record inside a saved case's coverage is unavailable,
never filled from a newer forecast.

Digests are deterministic integrity checks, not authorization. The later
service-only persistence writer must verify provenance and atomically resolve
concurrent first freezes under the restaurant lock. No caller may supply an
arbitrary forecast or replace saved state on behalf of a restaurant owner.

FIFO and expiry

One ingredient-wide FIFO pass allocates each night's demand once. Delivery
business date then stable batch ID determine order. Every competing batch is
included, including batches outside the card's display window. A batch receives
no allowance after its own use-by business date. Use by D includes D's service,
ending at the next business boundary (normally 4 a.m. local).

Allocations are capped at remaining stock. Depletion, disposal and downward
corrections release unused future capacity to later batches. Elapsed nights
are removed first, so their fulfilled or expired allowance is never released
again. Actual inventory remains authoritative and is not mutated by this model.
Expiry alone does not record disposal. Overdue stock has no future allowance.

Cutoffs and archived runs

Inputs require explicit assessment time, operational timezone, configured
cutoff and the latest complete inventory business date. Only allowance nights
after the inventory cutoff are used, through each batch's use-by date.
The current inventory cutoff is independent of the archived run's historical
source_through. Store both, plus run ID, issued_at, run date and age. Output
also lists the original sources actually used by frozen demand nights.

A missed forecast may use remaining dates from the latest published archive.
Missing tail dates are unavailable, never extrapolated. Existing fixed demand
continues to work without a new forecast. A newer forecast trained beyond the
inventory cutoff cannot supply provisional demand for that assessment.

Normalized input contract

assessProjectedWasteRisk accepts restaurantId, assessmentDate, assessedAt,
timeZone, cutoffMinutes, inventoryCutoff, inventoryComplete:true, ingredients,
batches, forecast, recipes and frozen:{demands,cases}. Use canonical lowercase
UUIDs, actual numeric values and explicit nulls for unknown optional fields.
Dates are YYYY-MM-DD business dates; timestamps require explicit offsets.

Ingredients include restaurant_id, id, name, tracked unit and the existing
approved conversion metadata. Batches include restaurant_id, stable source id,
ingredient_id, received_date, use_by_date, remaining_qty, unit and unit_cost.
A source id represents an invoice item or count lot, not a rebuild-generated
current_inventory row id. Only stock present at inventoryCutoff is eligible.

The forecast is an authorized archived run with id, restaurant_id, run_date,
issued_at, source_through, model_major, calibration_key and eight ordered nights.
Each night supplies business_date, availability, low and dishes. Each dish
supplies dish_id, active, status and overall share. The later reader derives
these fields from archive rows and their saved traces, without refitting.

Recipes enumerate all active dishes for each night, including dishes whose
forecast is unavailable or absent. Each record supplies restaurant_id,
business_date, dish_id, active, complete and portions. Portions supply
ingredient_id, quantity and unit. Do not filter incomplete or unlinked recipes
out of the snapshot. An unknown recipe can affect any ingredient; it therefore
blocks consumption credit rather than silently becoming a zero portion.

The function returns all item statuses, strictly positive visible_items,
needs_review, daily demand/allocation traces, new freeze proposals and the next
frozen state. Inputs are unchanged; results are deeply frozen and deterministic.
The caller must persist the accepted state; ignoring it would lose freezing.

Unavailable data and correction boundary

Unlinked invoice lines return link_ingredient. Missing age, ordering, recipe,
forecast or conversion data is unavailable, not zero demand or full-stock risk.
Uncertain competing inventory blocks allocations it could affect. Quantity risk
may be available while dollar value remains null when batch cost is unknown.
Dollar value uses batch cost converted into the same unit as stock quantity.

This module has no reset operation. Changes to a frozen batch's ingredient,
tracked unit, received date or use-by date require reassessment. The later
persistence stage permits only: invoice quantity/date correction, physical
count, confirmed disposal, storage/shelf-life change, dish removal, or newly
confirmed closure. Record actor, time and reason. Stock-quantity reconciliation
here does not infer a disposal, count correction, successful sale or attribution
from a balance change alone. Modifier-aware actual usage versus standard-recipe
allowances remains a known gap and must be disclosed.

Rollout and scheduling requirements for later stages

Keep the existing card exactly as it is until projections are enabled and a
completed assessment activates the new view. Projections being off must not
produce Estimate unavailable. Zero-risk quantities disappear in the new view.
Assess daily per restaurant after projection publication, with a separate
missed-run path using eligible older forecasts. Do not put this in the 09:00 UTC
waste cron. A risk-assessment failure must not undo forecast publication.

Echo Tap readiness: last invoice 2026-07-29, last POS sale 2026-07-17, and no
POS connection. Real validation requires reconnecting POS and resuming invoices,
then projection setup, backfill and an inventory rebuild. Maple is plumbing-only
sparse test data and supports no accuracy conclusions.

Acceptance examples

80 lower-volume dishes × (0.6 × 0.25 lb + 0.4 × 0.125 lb) = 16 lb.
60 lb stock less 30 lb allowance = 30 lb risk; after 10 lb used against 8 lb
allowed, 50 lb less 22 lb remaining allowance = 28 lb, worth $126 at $4.50/lb.
A two-pound daily shortfall increases combined batch risk once by two pounds.
Correcting the older 12-pound batch to six releases six of the 20-pound future
budget to the newer 24-pound batch: 24−14=10 lb risk. Removing the older batch
entirely leaves 24−20=4 lb risk. Sales depletion releases future reservations
only, not the allowance of the completed night.
A Monday freeze of Thursday demand at 8 lb remains 8 lb for a batch freezing
Wednesday even when the newer Thursday forecast says 10 lb.