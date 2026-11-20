# Step 5 share implementation clarifications

The source of truth is OptiMenu_Projection_Review_v4.xlsx: Category Model,
Dish Baselines, Dish Model v4 and Dish Nights. Model major 4, the registered
approved-workbook-v4 identity and existing versioned settings remain unchanged.
There is no new policy, threshold, SQL, scheduling or consumer integration.

Category and dish windows and share weights use the last complete source night
from Step 4, equivalent to workbook Inputs B7. The category base stays at
base_window_weeks; only dish baselines extend toward minimum_clean_dish_nights,
in whole weeks up to maximum_dish_lookback_weeks. A missing night is not a zero.
The existing shared volume eligibility rule applies first, including the explicit
first-data cutoff. Recommended and sold-out nights remain in category demand.

The category LY target interval starts at the Monday of the target week, shifted
by year_alignment_days and by half the odd smoothing window. It spans whole
weeks, inclusively. Its category share is unweighted. The shifted base category
share is recency weighted against the shifted last-complete endpoint. An own
ratio of zero is valid when its denominator is positive; clamp it normally.
Without own evidence, pooled input is unavailable in this step. Public enabled
uses the explicitly labeled neutral Google proxy ratio 1.0 and
1 + google_trends_strength * (ratio - 1); public disabled uses neutral 1.0.
The workbook's own-LY checkbox is on in the approved fixture. There is no
registered own-LY-disable setting, so this step introduces no new switch.

Dish Nights J treats only true recommendation or sold-out flags as exclusions.
Null is clean, with unknown flags recorded in the trace. Clean selection removes
the same night from the dish numerator and its category denominator. Adjustment
uses C / (1 + assumed_recommendation_lift) for recommended dish units only; the
category denominator stays unadjusted and sold-out nights remain excluded.
New-dish n and O always use clean evidence since the current launch, regardless
of the existing-dish fallback or adjustment method.

Returning-season evidence follows the workbook's exact [last removal - 27 days,
last removal] interval, inclusive of the last removal date. This clarifies the
requirement's phrase '28 days before removal'. It uses unweighted eligible units
and category units, including recommendation and sold-out nights, multiplied by
last_season_category_count. Own launch indexes are averaged by style category,
not by the target dish. Clamp that average after averaging. Precedence is
returning season, own launches, unavailable pooled launches, default_launch_index.
The workbook calls the final default source EVEN SPLIT; retain that trace label.

Weekday mix uses clean selected-window evidence and weekday_mix_prior_nights.
Share trend uses the supplied per-dish weekly trend from workbook Inputs K,
multiplied by the target-to-last-complete horizon, exactly as Dish Model P does.
A blank trend is zero. Both optional paths remain off by default. The workbook's
owner-prior math remains for compatibility, but owner_estimates_enabled stays
false. Projections take no owner input. Do not build any flow to populate
owner_prior_weight.

The snapshot supplies the three style codes, raw scoped dishes and facts, raw
launch-history versions, an explicit-offset snapshotAt, and the verified Step 4
output with its source history and resolved settings. Step 4 is recomputed only
to verify snapshot consistency, without changing its formulas. Launch versions
must be observed before asOf and created by snapshotAt. Resolve supersession
within that historical snapshot; reject missing parents, branches and cycles.
The caller must supply the actual historical capture instant during backtests.
All arrays must be complete. Preserve explicit zero facts and source revisions.

Supplemental dish snapshot attributes are last_season_removed_date,
owner_prior_weight and share_trend_per_week. These are not new database columns.
Step 10 must obtain the previous season endpoint from explicit availability
history and supply any reviewed trends. It must not request or populate owner
weights. Missing prior season evidence falls through to the next prior source;
missing compatibility weights or trends are zero, matching blank workbook cells.
Current projection_dishes fields, the recommended/sold_out columns of
projection_nightly_dish_facts, and raw projection_launch_history supply the other
fields. Flag population is later work;
there is no Tonight's recommendations integration here.

Approved amendment to v4: apply maximum_new_dish_share only when an active
existing dish has a positive normalized share in the category. Otherwise, for an
active category, set the new-dish total to 1 and allocate each new dish its
proposed share divided by the sum of proposals. Record
cap_skipped_no_existing: true in the category trace and cap_applied: false on
the dishes. Existing dishes with zero shares do not prevent this exception.
Do not invent equal shares when the proposal sum is zero.

Share checks never throw for the whole run. An active category that still cannot
allocate receives status needs_baseline and a reason. Its active dish quantities
and overall shares are null; healthy categories retain their calculated outputs.
The affected night receives status needs_baseline, preserves the Step 4 status
in volume_status, lists the category reason, and reports checks.conserved false.
Other nights are evaluated independently. Closed nights remain closed with zero
quantities; unavailable-volume nights remain null. Inactive dishes are always
zero. The trace and check sums retain the attempted allocation for review.

The golden fixture is a lossless compressed export of cached workbook inputs and
all requested Category E-O, Baseline E-P and Dish Model E-W values: 24, 10 and 80
rows respectively. No expected values are computed by the JavaScript engine.
Compression uses only Node's built-in zlib; it adds no dependency. The test checks
every exported cell and conservation across all eight nights. The original
volume fixtures and assertions remain unchanged.

No repository database objects, archive writes, cron jobs, owner flows, waste
risk, recommendation, financial, uplift or OptiScore formulas are changed.