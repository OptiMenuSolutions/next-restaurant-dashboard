# Projection build handover amendment — November 20, 2026

This is the calendar-specific update to the approved build handover. Read
`ENGINE_SPEC_AMENDMENT.md` before implementing or reviewing Steps 3, 7, or 10.
It replaces requirements for recurring owner holiday answers or blocking setup.

- Use three concepts: full service, bar/pub, quick service. Onboarding saves the
  optional concept and normally closed weekdays through a verified owner server
  route using the service role. Admin concept edits use verified admin/MFA auth.
- Missing concept uses full service with a recorded fallback and admin follow-up.
  No projection requires the owner to answer a question.
- Keep settings history. Store holiday answers and popup claims by date with
  immutable history and purge support. A popup is optional, dismissible, and
  claimed once per holiday/year. GET requests do not claim popups.
- Keep owner diagnostics private. An owner-facing setup flag is informational.
- JavaScript and SQL must use the same policy, including POS-only past nights,
  four complete covered weekday occurrences, date-specific popup precedence,
  last-year same-holiday evidence, and default fallback.
- Optional onboarding setup must save before a timezone exists. Forecasting
  still requires a valid operational timezone and restaurant-local business date.
- Preserve the independent projection scope: no waste-risk, recommendation,
  financial, uplift, or OptiScore formula integration in this change.

## Step 10 orchestration notes

1. Ingest before applying calendar flags. Reapply flags to recent past dates.
2. The Shift4 reader filters calendar dates; request D through D+1 to cover a
   business night. Check Shift4 timezone against the operational timezone.
3. Without a closeout, ingest again after the 60-minute quiet period; one nightly
   attempt is insufficient to complete newly observed nights immediately.
4. Reingest affected past nights after mapping or menu-date corrections.
5. Check `projection_pos_source_repairs` and retry or report outstanding repairs.
6. Sales are assigned by item-added timestamps; POS close-time reports can differ.
7. Preserve per-restaurant isolation, stale previous forecasts on failures,
   append-only archives, and explicit reruns. Missing answers are not failures.

## Migration discipline

`20261119222523_projection_foundation.sql` and
`20261120142918_projection_ingestion.sql` are applied and frozen. Any further
change to their installed objects must be introduced by a later migration.

`20261120171521_projection_calendar.sql` remains editable only while unapplied.
After applying and verifying a migration on the intended branch, record it with
`supabase migration repair --status applied <version>` using that same database
target, verify migration history, and freeze the file. A repair records history;
it does not execute the migration or replace installation checks.

Delivery remains manual: exact Find/Replace edits and full new-file contents in
chat. The assistant does not edit, commit, push, deploy, or mutate connected data.