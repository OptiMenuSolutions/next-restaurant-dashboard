import { projectionInstant, shiftProjectionDate } from './businessTime.js';
import { PROJECTION_UUID, projectionVolumeEligibility } from './eligibility.js';
import { projectRestaurantVolume } from './volume.js';
import { holidayError,holidayKeys,holidayInstant,holidayVersion } from './holidayFactors.js';
import { projectionSettingsDigest } from './settings.js';
import { projectionVolumeDigest,projectionDeepFreeze } from './volumeProvenance.js';

function archivesAt(rows,restaurantId,asOf,snapshotAt) {
  if (!Array.isArray(rows)) holidayError('Complete day-of archive history is required.');
  const captured=holidayInstant(snapshotAt), versions=new Map(), children=new Set(), originals=new Set();
  for(const row of rows){
    if(row?.restaurant_id!==restaurantId)holidayError('Holiday archives cross restaurants.');
    shiftProjectionDate(row.run_date,0);shiftProjectionDate(row.target_date,0);
    if(row.run_date!==row.target_date || row.run_date>=asOf || holidayInstant(row.issued_at)>captured)continue;
    if(!PROJECTION_UUID.test(row.id||'') || versions.has(row.id))holidayError('Invalid or duplicate day-of archive.');
    shiftProjectionDate(row.source_through,0);
    if(row.source_through>=row.run_date || !['available','needs_baseline','closed'].includes(row.availability))holidayError('Invalid day-of archive bounds.');
    versions.set(row.id,structuredClone(row));
  }
  for(const row of versions.values()){
    if(!row.supersedes_id){if(originals.has(row.run_date))holidayError('Duplicate original day-of archive.');originals.add(row.run_date);continue;}
    const parent=versions.get(row.supersedes_id);
    if(!parent || parent.run_date!==row.run_date || children.has(parent.id) || holidayInstant(parent.issued_at)>holidayInstant(row.issued_at))holidayError('Incomplete or branching day-of archives.');
    children.add(parent.id);
  }
  for(const row of versions.values()){
    const seen=new Set();let cursor=row;
    while(cursor){if(seen.has(cursor.id))holidayError('Cyclic day-of archive.');seen.add(cursor.id);cursor=versions.get(cursor.supersedes_id);}
  }
  return new Map([...versions.values()].filter(row=>!children.has(row.id)).map(row=>[row.run_date,row]));
}
export function buildHolidayLearning(input) {
  const {restaurantId,asOf,snapshotAt,resolvedSettings,modelVersion,firstDataDate,history,holidays,holidayAnswers,archives=[],closureThresholdUnits}=input;
  if(!PROJECTION_UUID.test(restaurantId||''))holidayError('Restaurant context is required.');
  const settings=holidayVersion(resolvedSettings,restaurantId);shiftProjectionDate(asOf,0);projectionInstant(snapshotAt);
  if(firstDataDate!=null){shiftProjectionDate(firstDataDate,0);if(firstDataDate>asOf)holidayError('First data date is in the future.');}
  if(!Number.isFinite(closureThresholdUnits)||closureThresholdUnits<0)holidayError('The Step 3 closure policy is required.');
  if(![history,holidays,holidayAnswers].every(Array.isArray))holidayError('Complete holiday learning inputs are required.');
  const nights=new Map(),answers=new Map(),keysByDate=new Map();
  for(const row of history){
    if(row?.restaurant_id!==restaurantId)holidayError('Holiday history crosses restaurants.');
    shiftProjectionDate(row.business_date,0);if(row.business_date>=asOf)continue;
    projectionVolumeEligibility(row,{restaurantId,asOf});
    if(nights.has(row.business_date))holidayError('Duplicate source night.');nights.set(row.business_date,structuredClone(row));
  }
  for(const row of holidays){
    shiftProjectionDate(row.holiday_date,0);
    if(row.restaurant_id!=null)holidayError('Holiday dates must be global.');
    const keys=holidayKeys([row.holiday_key]);if(keys[0]==='early_close')holidayError('Early close is not a calendar holiday.');
    if(!keysByDate.has(row.holiday_date))keysByDate.set(row.holiday_date,[]);
    if(keysByDate.get(row.holiday_date).includes(row.holiday_key))holidayError('Duplicate calendar holiday.');
    keysByDate.get(row.holiday_date).push(row.holiday_key);
  }
  const answerIds=new Set();
  for(const row of holidayAnswers){
    if(row?.restaurant_id!==restaurantId)holidayError('Holiday answers cross restaurants.');
    shiftProjectionDate(row.business_date,0);
    if(holidayInstant(row.recorded_at)>holidayInstant(snapshotAt))continue;
    const key=`${row.business_date}:${row.revision}`;
    if(!Number.isSafeInteger(row.revision)||row.revision<1||answerIds.has(key)||!['open','closed','early_close'].includes(row.answer))holidayError('Invalid dated holiday answer.');
    answerIds.add(key);
    if(!answers.has(row.business_date)||answers.get(row.business_date).revision<row.revision)answers.set(row.business_date,structuredClone(row));
  }
  const selectedArchives=archivesAt(archives,restaurantId,asOf,snapshotAt),observations=[],skipped=[];
  const orderedHistory=[...nights.values()].sort((a,b)=>a.business_date.localeCompare(b.business_date));
  for(const night of orderedHistory){
    const date=night.business_date,answer=answers.get(date),keys=holidayKeys(keysByDate.get(date)||[]);
    if(!keys.length && answer?.answer!=='early_close')continue;
    const reject=reason=>skipped.push({business_date:date,reason});
    if(firstDataDate==null){reject('first_data_date_unavailable');continue;}
    if(date<firstDataDate){reject('before_first_data');continue;}
    if(!night.complete){reject('incomplete');continue;}
    if(!night.source_covered){reject('not_pos_covered');continue;}
    if(night.closed || night.total_units<=closureThresholdUnits){reject('closed');continue;}
    if(night.early_close || JSON.stringify(holidayKeys(night.holiday_keys))!==JSON.stringify(keys)){reject('calendar_flags_require_refresh');continue;}
    let baseline,baselineSource,baselineProvenance,sourceDates,archiveId=null;
    const archived=selectedArchives.get(date);
    if(archived){
      baselineSource='archived';archiveId=archived.id;
      const value=archived.volume;
      if(archived.availability==='needs_baseline' || !value || value.status==='needs_baseline' || value.recent?.L==null){reject('archived_baseline_unavailable');continue;}
      if(value.business_date!==date || value.provenance?.model_major!==4 || archived.model_version?.model_major!==4 ||
        archived.model_version.logic_revision!=='approved-workbook-v4' || value.provenance.global_version_id!==archived.global_version_id ||
        archived.settings_digest!==projectionSettingsDigest(archived.settings_snapshot))holidayError('Invalid archived normal L provenance.');
      baseline=value.recent.L;
      sourceDates=(value.recent.nights||[]).map(row=>row.business_date);
      if(sourceDates.some(day=>{shiftProjectionDate(day,0);return day>=date;}))holidayError('Archived normal L contains future source dates.');
      baselineProvenance={model_version:archived.model_version,global_version_id:archived.global_version_id,
        restaurant_version_id:archived.restaurant_version_id,settings_digest:archived.settings_digest};
    }else{
      baselineSource='reconstructed';
      const calendar=Array.from({length:settings.horizon_days},(_,i)=>({restaurant_id:restaurantId,business_date:shiftProjectionDate(date,i),
        closed:false,early_close:false,holiday_keys:[],default_factor:1,configuration_revision:0,context_digest:projectionVolumeDigest({date,restaurantId})}));
      const volume=projectRestaurantVolume({restaurantId,asOf:date,firstDataDate,resolvedSettings,modelVersion,history:orderedHistory,calendar});
      if(volume.nights[0].status==='needs_baseline'||!volume.nights[0].recent){reject('reconstructed_baseline_unavailable');continue;}
      baseline=volume.nights[0].recent.L;sourceDates=volume.nights[0].recent.nights.map(row=>row.business_date);
      baselineProvenance={model_version:volume.provenance.model_version,global_version_id:resolvedSettings.global_version_id,
        restaurant_version_id:resolvedSettings.restaurant_version_id,settings_digest:resolvedSettings.settings_digest};
    }
    if(!Number.isFinite(baseline)||baseline<0)holidayError('Normal L must be finite and nonnegative.');
    if(baseline===0){reject('zero_normal_L');continue;}
    const observationKeys=answer?.answer==='early_close'?['early_close']:keys,ratio=night.total_units/baseline;
    if(!Number.isFinite(ratio))holidayError('Holiday learning overflow.');
    const evidence={restaurant_id:restaurantId,business_date:date,holiday_keys:observationKeys,night,answer:answer??null,
      normal_L:baseline,L_source:baselineSource,archive_id:archiveId,source_dates:sourceDates,baseline_provenance:baselineProvenance};
    observations.push({restaurant_id:restaurantId,business_date:date,holiday_keys:observationKeys,observed_ratio:ratio,
      trace:{actual_units:night.total_units,normal_L:baseline,L_source:baselineSource,archive_id:archiveId,source_dates:sourceDates,
        model_major:4,ratio,baseline_provenance:baselineProvenance,inputs_digest:projectionVolumeDigest(evidence)}});
  }
  const result={restaurant_id:restaurantId,as_of:asOf,snapshot_at:snapshotAt,source_context_digest:input.context_digest??null,observations,skipped};
  result.inputs_digest=projectionVolumeDigest(result);return projectionDeepFreeze(result);
}