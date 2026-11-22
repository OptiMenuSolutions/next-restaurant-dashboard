# Step 10: nightly publication

This step publishes standalone projections. Waste risk and Tonight's
recommendation selection do not consume them. Approved v4 formulas and the
five-part calibration key are unchanged; owner projection inputs remain off.

## Timing and history

The new append-only global settings version adds publish_deadline_minutes=180:
three elapsed hours after the business-day cutoff (07:00 for the default 04:00).
The integer must exceed sync_buffer_minutes and be below 1440. Actual business
boundaries also reject deadlines beyond a DST-shortened day. Historical settings
remain readable without substituting this key; publication requires it.

The archive trigger assigns issued_at with clock_timestamp AFTER the settings
lock. That exact instant must belong to run_date's restaurant-local business day
and precede its deadline. Late jobs are missed, including forced reruns. An outage
never creates backdated forecasts. The reader returns the previous run as stale,
retaining its original target dates. Forced runs append supersedes revisions only
before the same deadline. Same-job retries return the previously saved run ID.

Restaurants start disabled. Initial backfill covers the earlier of the reviewed
first_data_date and onboarding business date through yesterday, using observe and
verify passes. Without closeouts, verification waits for source stability instead
of waiting for the next nightly cron. Mapping-incomplete nights stay unavailable.
Publication requires completed initial coverage; finish backfill before relying
on the first daily run. Otherwise that day's deadline can legitimately be missed.

## Worker and archive

Dispatcher: every 15 minutes. Messages: only job_id. Job key: restaurant, business
date, model major, kind. Forced kind is force:<request UUID>; repeat that UUID for
idempotency. Each restaurant has one seven-minute fenced lease. Checkpoints renew
it; queue retries and cron recover interrupted work. Backfill batches have seven
dates. Failed historical dates rotate through maintenance work instead of starving
other queued dates. Repairs affect only their relevant evidence.

Run order: ingestion; source/menu repairs and corrected-night ingestion; calendar
flags across changed history and the eight-night horizon; outlier replay/save;
holiday learning; lifecycle reload; freeze snapshot; forecast/ranges; validate;
atomic publish. Persisted POS, mapping, availability, source and calendar changes
queue historical re-ingestion. Dirty generations prevent stale acknowledgments.

Actual Shift4 location timezone, connection timezone and operational_timezone must
match. Missing/mismatched zones are setup errors. Provider authentication and rate
limits are source failures. The raw reader requests D through D+1, follows every
page and uses the existing privacy whitelist. Item timestamps assign demand nights.

Publication locks settings, calendar and restaurant ingestion, verifies lease and
current source digest, then inserts the run, eight nights and all dish rows in
one transaction. Failures leave no partial archive. Values stay unrounded.
Conservation: abs(a-b) <= 1e-9 * max(1,abs(a),abs(b)). Partial categories remain in
trace and confidence; night availability is available, needs_baseline or closed.

MFA-protected admin API /api/admin/projection-runs reads the latest run,
enables/disables with a reviewed history boundary and optional versioned deadline,
or enqueues a force request with request_id. Existing CRON_SECRET and Queue
identity are reused. No client projection display is added. Authorized account
purge includes jobs, leases, state and dirty nights; normal jobs cannot alter
permanent archive history.

## Rollout

1. Review/test the new migration on optimenu-development. Applied migrations are
   frozen; Step 10 uses only 20261122152757_projection_nightly_runs.sql.
2. In production, verify installed schemas, then record already-applied versions
   with `supabase migration repair --status applied`: 20261119222523,
   20261120142918, 20261121150312 and 20261121163437. Calendar 20261120171521
   is already recorded. Never mark an unapplied schema as applied.
3. Apply and record 20261121171724, then 20261122152757.
4. Set concept types for all 13 production restaurants. Review explicit timezones,
   usable first-data dates, onboarding dates and POS source windows.
5. Deploy the queue/cron registration, keeping restaurants disabled. Enable one at
   a time; verify completed backfill, local deadline, one run/eight nights, dish
   counts and missed/stale behavior before enabling the next.

CLI 3.2+ uses --remote. Substitute the existing securely stored production
PostgreSQL connection variable for this placeholder; never use the HTTP API URL:

    npx supabase migration repair --remote="$OPTIMENU_PRODUCTION_DATABASE_URL" --status applied --yes 20261119222523 20261120142918 20261121150312 20261121163437

Only after each remaining SQL file actually succeeds:

    npx supabase migration repair --remote="$OPTIMENU_PRODUCTION_DATABASE_URL" --status applied --yes 20261121171724
    npx supabase migration repair --remote="$OPTIMENU_PRODUCTION_DATABASE_URL" --status applied --yes 20261122152757


## Step 10 review corrections

Apply 20261122184115_projection_nightly_review.sql after 20261122152757.
Do not rerun an already-applied migration. Both are required before rollout.

There are no projection triggers on pos_tickets or pos_ticket_lines. Regular
runs re-read the last seven nights directly from Shift4. Automatic detection of
older POS-only corrections is deferred; a privileged maintenance operation can
queue a known affected date in projection_dirty_nights.

History changes queue only affected ranges. Range-only edits preserve dates
common to old and new ranges. No-op updates do nothing. Calendar versions queue
from effective_from, and holiday answers queue one date. Calendar-only changes
neither invalidate source coverage nor request a Shift4 read.

Each invocation has a 180-second work budget, leaving 120 seconds below the
platform limit. Successful source reads survive checkpoints. Requests accept
cancellation and have a 20-second per-request timeout. Repairs re-read only
outstanding source work. Expensive stages are checked before execution.

When a source retry or quiet wait would reach the last 30 minutes before the
publish deadline, publish using older complete history. Exclusions apply only
to the fenced job's snapshot; saved complete nights and facts remain intact.
The archive discloses source_through, last_complete_date, source_exclusions and
source_cutoff_status. Setup and technical failures still require recovery.

Dish confidence uses that dish's status, range method and clean-night count.
The latest reader reports pending before publication, stale after a miss/failure,
and disabled when rollout is turned off. Disabling mid-run publishes nothing.

Before enabling the first restaurant, run the read-only busy-night pagination
check with its existing server environment:

    node --env-file=.env.local scripts/check-shift4-projection-pagination.mjs RESTAURANT_UUID YYYY-MM-DD

It prints page counts and completion metadata, never raw tickets or credentials.
Declared totals must reconcile. A full page without a usable completion signal
fails. Exit code 2 means totals or multi-page traversal still need verification;
do not enable based on that result. No live response has been certified by unit
or disposable database tests.