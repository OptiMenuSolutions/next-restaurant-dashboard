# Projection calendar amendment — November 20, 2026

This amendment supersedes conflicting calendar and owner-input provisions in the
Projection Engine Specification, its revisions, and the v4 calendar assumptions.
It does not change the volume/share formulas, calibration weights, ranges, or the
scope separating projections from waste risk and Tonight's recommendations.

Owner input is always optional. Forecasts never wait for setup answers or a
holiday reply. POS completeness, source quality, timezone, and baseline checks
still apply; missing data is never converted into an invented sales forecast.

The concepts are `full_service`, `bar_pub`, and `quick_service`. Missing concept
uses `full_service`, records `concept_fallback`, and produces an admin-only
monitoring follow-up. Cuisine is separate and unchanged.

Normally closed weekdays are an optional onboarding hint. For today and future
dates, use the latest four earlier occurrences of that weekday that are complete
and covered by a timestamped POS source window. If all four sold at most two
forecastable dish units, classify the weekday as closed; otherwise open. Until
four such observations exist, use the optional onboarding hint, defaulting open.

Holiday answers are per business date, never recurring annual settings. The six
optional popup holidays are Thanksgiving Day, Christmas Eve, Christmas Day,
New Year's Day, Easter, and July 4. On a dashboard visit, group every eligible
unseen holiday within ten calendar days before or on its date into one optional
popup, using the restaurant business date. Show friendly weekday/month/day labels. Each date has
Open, Closed, and Closing early choices; save any selected subset atomically.
One Not now dismisses the whole displayed group without saving answers. Dates
newly entering the window later may form another group. Each listed date is
claimed at most once per restaurant, holiday key, and year across devices. An
interrupted claim may go unseen; it never causes repeated or mandatory work.

For an upcoming owner holiday, use its dated answer first, then the same holiday
last year only when its weekday was normally open, then the concept rule's
default answer. To establish that prior weekday as normally open, require all
four exact same-weekday dates 7, 14, 21, and 28 days before last year's holiday
to be complete and source-covered, with at least one above two forecastable
dish units. Missing, incomplete, uncovered, or all-low evidence skips last year's
result and uses the default. When eligible, last-year complete totals of at most
two imply closed; totals above two imply open. An incomplete low holiday total
uses the default. Match the holiday identity and calendar date, not a 364-day
shift. No answer carries into another year.

A dated Open or Early close answer is an exception to the weekday schedule,
including a closure inferred from four empty occurrences. Only that explicit
dated popup answer may reopen a normally closed weekday; last-year observed
Open and default Open rules cannot do so. Early close comes only from a
dated popup answer; without one, reduced expected volume uses the multiplier.
Overlapping holiday keys remain separate and their ordinary factors multiply.

Past dates use POS only: a complete night with at most two units is closed; a
complete night above two is open. An incomplete past night is not marked closed
and remains excluded by completeness. Optional schedules, popups, and default
answers never change this past classification. Past nonclosed calendar factors
are neutral, and past early-close flags are false. Holiday identity is retained
for the separate holiday-learning stage.

Disagreements with an explicit dated answer or an optional closed-weekday hint
are stored in internal calendar diagnostics. They are never returned to owners.
The owner API's `setup_required` means only that optional setup could be offered
again; it is not a prerequisite for a projection.

Calendar policy revision 3 records these rules. The database derives and saves
its own classifications and rejects mismatching worker output. Reads and writes
retain restaurant scoping, complete history, stale-context fencing, and atomicity.
Versioned setup, dated answers, and prompt views are append-only except during
an authorized permanent account purge.