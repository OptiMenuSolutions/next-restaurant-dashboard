import { projectionCalibrationKey } from './settings.js';
import { shiftProjectionDate } from './businessTime.js';
import { PROJECTION_UUID, projectionVolumeEligibility } from './eligibility.js';
import { holidayInstant, holidayVersion } from './holidayFactors.js';
import { projectRestaurantVolume } from './volume.js';
import { outlierEvidenceIndex } from './outlierEvidence.js';
import { projectionVolumeDigest, projectionDeepFreeze, projectionCanonicalJSON } from './volumeProvenance.js';

export function outlierError(message) {
  const error = new TypeError(message); error.code = 'PROJECTION_OUTLIER_INVALID'; throw error;
}
const finalStatus = value => ['one_off_event','confirmed_shift'].includes(value);
const equal = (a,b) => projectionCanonicalJSON(a) === projectionCanonicalJSON(b);
export const roundedOutlierRatio = (value,places) => Number(value.toFixed(places));

function dayOfArchives(rows,restaurantId,asOf,snapshotAt) {
  if (!Array.isArray(rows)) outlierError('Complete day-of archive history is required.');
  const versions = new Map(), parents = new Set(), originals = new Set();
  for (const row of rows) {
    if (row?.restaurant_id !== restaurantId) outlierError('Archives cross restaurants.');
    shiftProjectionDate(row.run_date,0); shiftProjectionDate(row.target_date,0);
    if (row.run_date !== row.target_date || row.run_date >= asOf || holidayInstant(row.issued_at) > holidayInstant(snapshotAt)) continue;
    if (!PROJECTION_UUID.test(row.id || '') || versions.has(row.id) || row.model_major !== 4) outlierError('Invalid day-of archive.');
    shiftProjectionDate(row.source_through,0);
    if (row.source_through >= row.run_date || !['available','closed','needs_baseline'].includes(row.availability) ||
      (row.expected !== null && (!Number.isFinite(row.expected) || row.expected < 0))) outlierError('Invalid forecast value or source cutoff.');
    versions.set(row.id,structuredClone(row));
  }
  for (const row of versions.values()) {
    if (!row.supersedes_id) {
      if (originals.has(row.run_date)) outlierError('Duplicate original day-of forecast.'); originals.add(row.run_date);
    } else {
      const parent = versions.get(row.supersedes_id);
      if (!parent || parent.run_date !== row.run_date || parents.has(parent.id) || holidayInstant(parent.issued_at)>holidayInstant(row.issued_at)) outlierError('Invalid forecast correction chain.');
      parents.add(parent.id);
    }
    const seen = new Set(); let cursor = row;
    while (cursor) { if (seen.has(cursor.id)) outlierError('Cyclic forecast history.'); seen.add(cursor.id); cursor = versions.get(cursor.supersedes_id); }
  }
  return new Map([...versions.values()].filter(row => !parents.has(row.id)).map(row => [row.run_date,row]));
}
function visibleDecisions(rows,restaurantId,asOf,snapshotAt) {
  if (!Array.isArray(rows)) outlierError('Complete final decision history is required.');
  const ids = new Set(), result = [];
  for (const row of rows) {
    if (row?.restaurant_id !== restaurantId) outlierError('Decisions cross restaurants.');
    shiftProjectionDate(row.decided_through,0);
    if (row.decided_through >= asOf || holidayInstant(row.created_at)>holidayInstant(snapshotAt)) continue;
    if (!PROJECTION_UUID.test(row.id || '') || ids.has(row.id) || row.model_major !== 4 || !finalStatus(row.decision) ||
      ![-1,1].includes(row.direction) || !Array.isArray(row.member_nights) || !row.member_nights.length ||
      new Set(row.member_nights).size !== row.member_nights.length || !Array.isArray(row.counterfactuals)) outlierError('Invalid final decision.');
    row.member_nights.forEach(date => { shiftProjectionDate(date,0); if (date>=row.decided_through) outlierError('Invalid final membership cutoff.'); });
    ids.add(row.id); result.push({...structuredClone(row),member_nights:[...row.member_nights].sort()});
  }
  return result.sort((a,b) => a.member_nights[0].localeCompare(b.member_nights[0]) || a.id.localeCompare(b.id));
}

// Pure replay: only supplied snapshots are read; no wall clock or database calls.
export function classifyProjectionOutliers(input) {
  const {restaurantId,asOf,snapshotAt,resolvedSettings,modelVersion,firstDataDate,history,archives,decisions=[]} = input;
  if (!PROJECTION_UUID.test(restaurantId || '')) outlierError('Restaurant context is required.');
  const s = holidayVersion(resolvedSettings,restaurantId); shiftProjectionDate(asOf,0); holidayInstant(snapshotAt);
  if (firstDataDate !== null) { shiftProjectionDate(firstDataDate,0); if (firstDataDate>asOf) outlierError('First data date is in the future.'); }
  if (modelVersion?.model_major!==4 || modelVersion.logic_revision!=='approved-workbook-v4' ||
    !/^[a-f0-9]{64}$/.test(modelVersion.reference_sha256||'') || holidayInstant(modelVersion.released_at)>holidayInstant(snapshotAt) ||
    resolvedSettings.calibration_key!==projectionCalibrationKey(4,s)) outlierError('Registered v4 model is required.');
  if (!Array.isArray(history)) outlierError('Complete nightly source history is required.');
  const seen = new Set(), source = history.filter(row => {
    if (row?.restaurant_id!==restaurantId) outlierError('Night history crosses restaurants.');
    shiftProjectionDate(row.business_date,0); if (row.business_date>=asOf) return false;
    if (seen.has(row.business_date)) outlierError('Duplicate nightly source.'); seen.add(row.business_date);
    projectionVolumeEligibility(row,{restaurantId,asOf}); return true;
  }).map(row => ({...structuredClone(row),outlier_status:'unchecked'})).sort((a,b)=>a.business_date.localeCompare(b.business_date));
  const stored = dayOfArchives(archives,restaurantId,asOf,snapshotAt);
  const saved = visibleDecisions(decisions,restaurantId,asOf,snapshotAt);
  const reviewEvidence=outlierEvidenceIndex(source,stored,{first_data_date:firstDataDate,
    settings_digest:resolvedSettings.settings_digest,global_version_id:resolvedSettings.global_version_id,
    restaurant_version_id:resolvedSettings.restaurant_version_id,model_major:modelVersion.model_major,
    logic_revision:modelVersion.logic_revision,reference_sha256:modelVersion.reference_sha256});
  const observations = source.map(row => {
    const reasons = projectionVolumeEligibility({...row,outlier_status:'unchecked'},{restaurantId,asOf}).reasons;
    const tested = reasons.length===0, archive = stored.get(row.business_date);
    const usable = archive?.availability==='available' && Number.isFinite(archive.expected) && archive.expected>0;
    const ratio = usable ? row.total_units/archive.expected : null;
    if (ratio!==null && !Number.isFinite(ratio)) outlierError('Outlier ratio overflow.');
    return {...row,tested,forecast_id:usable?archive.id:null,forecast:usable?archive.expected:null,ratio,
      direction:!tested||ratio===null?0:ratio>s.outlier_ratio_max?1:ratio<s.outlier_ratio_min?-1:0,
      diagnostics:tested?usable?[]:['no_stored_forecast']:[...reasons],outlier_status:tested&&usable?'normal':'unchecked'};
  });
  let previousDirection=0,forward=0;
  for (const n of observations) {
    if (n.tested) { forward=n.direction?previousDirection===n.direction?forward+1:1:0;previousDirection=n.direction; }
    n.run_trace={forward};
  }
  let nextDirection=0,backward=0;
  for (const n of [...observations].reverse()) {
    n.run_trace.next_direction=nextDirection;
    if (n.tested) { backward=n.direction?nextDirection===n.direction?backward+1:1:0;nextDirection=n.direction; }
    n.run_trace.backward=backward;n.run_trace.length=n.direction?n.run_trace.forward+backward-1:0;
  }
  const memo = new Map();
  function replay(cutoff) {
    if (memo.has(cutoff)) return memo.get(cutoff);
    const nights = observations.filter(n=>n.business_date<cutoff).map(n=>({...n,diagnostics:[...n.diagnostics],run_trace:{...n.run_trace}}));
    const finals = saved.filter(d=>d.decided_through<cutoff);
    const memberships = new Map();
    for (const d of finals) for (const date of d.member_nights) {
      if (!memberships.has(date)) memberships.set(date,[]); memberships.get(date).push(d);
    }
    const tested = nights.filter(n=>n.tested), groups=[]; let active=null;
    for (const n of nights) {
      if (memberships.has(n.business_date)) { if (active) {active.ended_at=n.business_date;active=null;} continue; }
      if (!n.tested) continue;
      if (active && n.direction!==active.direction) {active.ended_at=n.business_date;active=null;}
      if (!n.direction) continue;
      if (!active) { active={start:n.business_date,direction:n.direction,members:[],ended_at:null};groups.push(active); }
      active.members.push(n.business_date);
    }
    function evaluate(group) {
      const memberSet = new Set(group.members), post = group.ended_at ? tested.filter(n=>n.business_date>=group.ended_at).slice(0,s.post_run_nights) : [];
      const counterfactuals = [];
      let status = !group.ended_at ? group.members.length>=s.shift_run_nights?'active_run':'provisional' :
        group.members.length<s.shift_run_nights ? group.members.length===1?'isolated_outlier':'short_run' : 'pending_review';
      if (group.ended_at && group.members.length>=s.shift_run_nights) for (const target of post) {
        const past = replay(target.business_date).nights.map(n=>({...n,outlier_status:memberSet.has(n.business_date)?'excluded':n.outlier_status}));
        const completeThrough = past.filter(n=>n.complete&&n.source_covered).at(-1)?.business_date??null;
        let volume = null;
        if (firstDataDate!==null && firstDataDate<=target.business_date && completeThrough) {
          const calendar = Array.from({length:s.horizon_days},(_,i)=>({restaurant_id:restaurantId,business_date:shiftProjectionDate(target.business_date,i),
            closed:false,early_close:false,holiday_keys:[],default_factor:1,configuration_revision:0,context_digest:projectionVolumeDigest({target:target.business_date})}));
          volume = projectRestaurantVolume({restaurantId,asOf:target.business_date,firstDataDate,resolvedSettings,modelVersion,history:past,calendar,sourceThrough:completeThrough}).nights[0];
        }
        const forecast = volume?.status==='ok' && volume.adjusted_volume>0 ? volume.adjusted_volume : null;
        const ratio = forecast===null?null:target.total_units/forecast;
        if (ratio!==null&&!Number.isFinite(ratio)) outlierError('Counterfactual ratio overflow.');
        const used = volume ? [...volume.recent?.nights||[],...volume.seasonal?.base_window.eligible||[],...volume.seasonal?.target_window.eligible||[]] : [];
        const dates = [...new Set(used.map(n=>n.business_date))].sort();
        if (dates.some(date=>memberSet.has(date)||date>=target.business_date)) outlierError('Run or future night leaked into counterfactual.');
        counterfactuals.push({business_date:target.business_date,actual_units:target.total_units,forecast,ratio,
          comparison_ratio:ratio===null?null:roundedOutlierRatio(ratio,s.comparison_decimal_places),source_dates:dates,
          complete_through:completeThrough,volume,history_statuses:past.map(n=>({business_date:n.business_date,outlier_status:n.outlier_status}))});
      }
      if (counterfactuals.length===s.post_run_nights && counterfactuals.every(c=>c.comparison_ratio!==null)) {
        const breach = counterfactuals.some(c=>group.direction===1?c.comparison_ratio>s.outlier_ratio_max:c.comparison_ratio<s.outlier_ratio_min);
        status=breach?'confirmed_shift':'one_off_event';
      }
      return {...group,last_flagged:group.members.at(-1),status,counterfactuals,
        decided_through:finalStatus(status)?post.at(-1).business_date:null,
        diagnostics:status==='pending_review'?['missing_run_free_forecast_context']:[]};
    }
    const runs = groups.map(evaluate);
    for (const run of runs) for (const n of nights) if (run.members.includes(n.business_date)) n.outlier_status=run.status;
    for (const n of nights) {
      const owners=memberships.get(n.business_date)||[];
      if (owners.length>1) {n.outlier_status='excluded';n.diagnostics.push('duplicate_final_decisions');}
      else if (owners.length===1) n.outlier_status=owners[0].decision;
    }
    const result={nights,runs}; memo.set(cutoff,result); return result;
  }
  const state=replay(asOf), finalReviews=[];let rechecks=0;
  // Saved members remain a closed block. Candidate disagreement is diagnostic only.
  for (const decision of saved) {
    const members=decision.member_nights;
    const candidateHistory={...input,decisions:decisions.filter(d=>d.id!==decision.id)};
    // Recompute only when no other saved decision overlaps this block.
    const overlap=saved.some(d=>d.id!==decision.id&&d.member_nights.some(date=>members.includes(date)));
    const changed=!equal(decision.trace?.review_evidence,
      reviewEvidence(members,decision.counterfactuals,decision.decided_through));
    let candidate=null,candidateDigest=null,rechecked=false;
    if (!overlap && input.reviewSaved !== false && changed) {
      rechecked=true;rechecks++;
      const check=classifyProjectionOutliers({...candidateHistory,reviewSaved:false});
      candidate=check.runs.find(r=>r.start===members[0])??null;
      candidateDigest=check.candidates.find(c=>c.trace.run.start===members[0])?.trace.inputs_digest??null;
    }
    const differs=candidate && (decision.trace?.inputs_digest ? candidateDigest!==decision.trace.inputs_digest : candidate.status!==decision.decision || candidate.direction!==decision.direction || !equal(candidate.members,members) ||
      !equal(candidate.counterfactuals.map(c=>c.comparison_ratio),decision.counterfactuals.map(c=>roundedOutlierRatio(c.ratio,s.comparison_decimal_places))));
    finalReviews.push({decision_id:decision.id,members,effective_status:decision.decision,candidate,rechecked,
      diagnostics:overlap?['duplicate_final_decisions']:rechecked&&(differs||!candidate)?['saved_decision_retained_candidate_differs']:[]});
  }
  const provenance={restaurant_id:restaurantId,as_of:asOf,snapshot_at:snapshotAt,model_version:structuredClone(modelVersion),
    global_version_id:resolvedSettings.global_version_id,restaurant_version_id:resolvedSettings.restaurant_version_id,
    settings_snapshot:structuredClone(s),settings_digest:resolvedSettings.settings_digest,calibration_key:resolvedSettings.calibration_key};
  const candidates=state.runs.filter(r=>finalStatus(r.status)).map(run=>{
    const evidence={...provenance,run,member_forecasts:state.nights.filter(n=>run.members.includes(n.business_date)).map(n=>({business_date:n.business_date,
      forecast_id:n.forecast_id,forecast:n.forecast,actual_units:n.total_units,ratio:n.ratio,source_revision:n.source_revision}))};
    // Capture time and outer run date are not semantic inputs to a final decision.
    const {as_of,snapshot_at,...identity}=evidence;
    return {direction:run.direction,decision:run.status,decided_through:run.decided_through,member_nights:run.members,counterfactuals:run.counterfactuals,
      trace:{...evidence,review_evidence:reviewEvidence(run.members,run.counterfactuals,run.decided_through),inputs_digest:projectionVolumeDigest(identity),explanation:run.status==='one_off_event'?'No post-run ratio breaches in the run direction.':'A post-run ratio breaches in the run direction.'}};
  });
  const result={...provenance,nights:state.nights,runs:state.runs,saved_reviews:finalReviews,saved_decision_rechecks:rechecks,candidates,source_context_digest:input.context_digest??null};
  result.inputs_digest=projectionVolumeDigest({source,archives:[...stored.values()].sort((a,b)=>a.id.localeCompare(b.id)),decisions:saved,provenance});return projectionDeepFreeze(result);
}