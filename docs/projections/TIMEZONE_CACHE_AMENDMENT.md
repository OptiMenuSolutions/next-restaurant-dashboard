Step 12.0: indexed timezone membership

Replace pg_timezone_names membership scans with a private table keyed by name.
Populate it from the installed PostgreSQL catalog, including aliases and POSIX
names. Do not trim, case-fold, infer names, or change business-boundary logic.

The two pos_source_clock checks retain operational timezone, Shift4 timezone,
then America/New_York fallback precedence. The four strict context validators
retain their existing failures; this change adds no fallback to those callers.
Settings resolution, cutoff precedence, DST handling and returned JSON remain
unchanged. No projection formulas, settings versions or calibration keys change.

Only the service role and privileged database functions can read the cache.
Frontend access and service-role writes are blocked. After a PostgreSQL timezone
data upgrade, refresh its membership through a new migration from that server's
pg_timezone_names before relying on newly added or removed names.

The disposable source-clock validation imports the existing benchmark database
harness and runs its 25 checks plus five cache and performance checks. Thresholds
use database EXPLAIN ANALYZE times, not CLI startup or network latency.

Record the connected production EXPLAIN ANALYZE timing after this migration is
applied. Do not describe a pre-migration measurement as the optimized result.
The read-only monitoring module follows this prerequisite separately.