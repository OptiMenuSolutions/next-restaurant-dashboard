import { PROJECTION_UUID } from './eligibility.js';
import { holidayInstant } from './holidayFactors.js';
import { projectionVolumeDigest } from './volumeProvenance.js';

function fail(message) {
  const error=new TypeError(message);error.code='PROJECTION_OUTLIER_INVALID';throw error;
}
export function outlierEvidenceDigest(evidence) {
  if(!evidence)return null;
  // Older decision traces stored identity in context. It is not source evidence.
  const {context,...source}=evidence;
  return projectionVolumeDigest(source);
}
export function currentOutlierReviews(rows,restaurantId,decisions,snapshotAt) {
  if(!Array.isArray(rows))fail('Complete decision review history is required.');
  const allowed=new Set(decisions.map(d=>d.id)),versions=new Map(),parents=new Set(),originals=new Set();
  for(const row of rows){
    if(row?.restaurant_id!==restaurantId)fail('Decision reviews cross restaurants.');
    if(!allowed.has(row.decision_id)||holidayInstant(row.reviewed_at)>holidayInstant(snapshotAt))continue;
    if(!PROJECTION_UUID.test(row.id||'')||versions.has(row.id)||!/^[a-f0-9]{64}$/.test(row.evidence_digest||'')||
      !['matches','candidate_differs'].includes(row.outcome)||!row.candidate_summary||
      typeof row.candidate_summary!=='object'||Array.isArray(row.candidate_summary))fail('Invalid decision review.');
    versions.set(row.id,structuredClone(row));
  }
  for(const row of versions.values()){
    if(!row.supersedes_id){
      if(originals.has(row.decision_id))fail('Duplicate original decision review.');originals.add(row.decision_id);
    }else{
      const parent=versions.get(row.supersedes_id);
      if(!parent||parent.decision_id!==row.decision_id||parents.has(parent.id)||
        holidayInstant(parent.reviewed_at)>holidayInstant(row.reviewed_at))fail('Incomplete or branching decision reviews.');
      parents.add(parent.id);
    }
    const seen=new Set();let cursor=row;
    while(cursor){if(seen.has(cursor.id))fail('Cyclic decision reviews.');seen.add(cursor.id);cursor=versions.get(cursor.supersedes_id);}
  }
  return new Map([...versions.values()].filter(r=>!parents.has(r.id)).sort((a,b)=>a.decision_id.localeCompare(b.decision_id)).map(r=>[r.decision_id,r]));
}
export function outlierCandidateSummary(candidate,digest) {
  if(!candidate)return {status:'not_found',inputs_digest:null};
  return {start:candidate.start,last_flagged:candidate.last_flagged,ended_at:candidate.ended_at,
    direction:candidate.direction,members:[...candidate.members],status:candidate.status,
    decided_through:candidate.decided_through,inputs_digest:digest,
    counterfactuals:candidate.counterfactuals.map(c=>({business_date:c.business_date,forecast:c.forecast,
      ratio:c.ratio,comparison_ratio:c.comparison_ratio}))};
}
export function frozenOutlierDecisionInput(input,decision) {
  const t=decision.trace||{};
  if(!t.settings_snapshot||!t.model_version)return input;
  return {...input,firstDataDate:Object.hasOwn(t,'first_data_date')?t.first_data_date:
    t.review_evidence?.context?.first_data_date??input.firstDataDate,
    modelVersion:t.model_version,resolvedSettings:{...input.resolvedSettings,model_major:t.model_version.model_major,
      settings:t.settings_snapshot,settings_digest:t.settings_digest,calibration_key:t.calibration_key,
      global_version_id:t.global_version_id,restaurant_version_id:t.restaurant_version_id}};
}