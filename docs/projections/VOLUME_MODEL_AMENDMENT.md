# Step 4 volume model amendment — November 20, 2026

This step delivers pure JavaScript calculations and tests only. It does not
connect consumers, schedule jobs, write archives, change customer pages, or
integrate waste risk or Tonight's recommendations. The applied foundation,
ingestion and calendar migrations remain frozen. No migration is needed now.

The approved Step 4 policy keeps the 0.75–1.33 seasonal bounds. Two eligible
same-weekday observations use a recency-weighted mean; three permit a weighted
fit. This applies to the current and LY base series. LY seasonality requires
at least two eligible base observations and two eligible target-window weeks.
If it is unavailable, use R alone. Benchmark ratios are diagnostic neutral
placeholders until Step 11; they are never reported as used in a calculation.
A zero LY denominator uses a flagged neutral ratio, as the handover requires.

These changes supersede the four-week volume trend tier, the LY averaging
threshold of four, and the neutral-benchmark blend for missing seasonal evidence.
Other settings remain unchanged. The existing minimum_trend_weeks and
minimum_ly_weekday_nights fields are not the Step 4 fit thresholds; the explicit
volume-policy parameters govern this calculation. No old snapshot is rewritten.

The new logic revision is volume-points-recent-only-v1 and requires model major
5. PROJECTION_VOLUME_POLICY_SEED is a reviewed seed, not a runtime default.
A caller must supply a complete policy version with its own ID, effective date,
restaurant scope and parameters, together with resolved versioned settings.
Step 10 must register the new major and persist/load reviewed policy versions
before activating or archiving this calculation. Nothing in Step 4 registers,
releases or enables a database model version. Policy identity, full parameters
and their digest must be retained in the immutable archive trace.

The as-of argument is the restaurant business date already resolved upstream.
Only earlier dates enter the snapshot. Current history covers [asOf−7w, asOf),
extending by whole weeks until the baseline minimum is met or the maximum is
reached. Missing observations never become zero sales. Weights use the preceding
business date as their age anchor and the versioned volume half-life.
The fit centers its time axis at the latest eligible night for numerical
stability; this is algebraically equivalent to using the first data date.
The raw fitted level is floored at zero before the signed slope cap is applied.

The LY base uses the chosen current window shifted by year_alignment_days and
ends at the current latest eligible weekday shifted by that same amount.
Its fitted endpoint is the latest eligible LY night at or before that endpoint;
there is no extrapolation across a missing LY endpoint. Target smoothing uses
the centered same-weekday dates. R uses the capped slope and damped horizon
from the latest eligible current night. A uses L, never R.

Calendar snapshots must carry the restaurant ID, configuration revision and
calendar-context digest alongside each Step 3 night. Step 10 should attach those
from the verified calendar context rather than accepting client-supplied flags.
The engine preserves base volume and the supplied factor separately. A closed
target returns adjusted zero even without a baseline; its counterfactual base
can remain null. Unavailable open-night volumes remain null for dash display.

The v4 fixture contains 239 source dates and eight cached sets of intermediate
and final results exported from the approved workbook with SHA-256
97e91fb3cf46e6b4726cb121f00f8b70f3fcb42eb914059fdf8fa40a6865b882.
Synthetic workbook rows are treated as POS-covered fixture inputs. Existing
outlier flags are fixture inputs; Step 8 classification is not implemented here.
The golden test supplies the workbook's cached calendar factors, including its
learned Thanksgiving Eve factor, to test multiplication without implementing
Step 7 learning. Operational callers will supply Step 3 factors until Step 7.
Original workbook values are never regenerated from the JavaScript engine.