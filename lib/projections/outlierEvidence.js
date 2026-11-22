import { shiftProjectionDate } from './businessTime.js';
import { canonicalProjectionHolidayKeys } from './holidayKeys.js';

// Index once per classification; each saved decision reads only its evidence.
export function outlierEvidenceIndex(source,archives) {
  const byDate=new Map(source.map(n=>[n.business_date,n]));
  const lowerBound=date=>{
    let lo=0,hi=source.length;
    while(lo<hi){const mid=(lo+hi)>>>1;if(source[mid].business_date<date)lo=mid+1;else hi=mid;}
    return lo;
  };
  const snapshot=date=>{
    shiftProjectionDate(date,0);
    const n=byDate.get(date),a=archives.get(date),generation=n?.ingestion_generation??null;
    if(generation!==null && (typeof generation!=='string'||!/^[1-9]\d*$/.test(generation))){
      const error=new TypeError('Invalid ingestion generation in decision evidence.');error.code='PROJECTION_OUTLIER_INVALID';throw error;
    }
    return {business_date:date,source_revision:n?.source_revision??null,ingestion_generation:generation,
      present:!!n,actual_units:n?.total_units??null,complete:n?.complete??null,source_covered:n?.source_covered??null,
      closed:n?.closed??null,early_close:n?.early_close??null,holiday_keys:n?[...canonicalProjectionHolidayKeys(n.holiday_keys)]:[],
      archive_id:a?.id??null,archive_expected:a?.expected??null,archive_availability:a?.availability??null};
  };
  return (members,tests,through)=>{
    const ordered=[...members].sort(),from=ordered[0];
    shiftProjectionDate(from,0);shiftProjectionDate(through,0);
    const range=[];
    for(let i=lowerBound(from);i<source.length && source[i].business_date<=through;i++)range.push(snapshot(source[i].business_date));
    const dependencies=[...new Set(tests.flatMap(t=>t.source_dates||[]))].sort();
    return {version:1,from,through,
      member_nights:ordered.map(snapshot),post_nights:tests.map(t=>snapshot(t.business_date)),
      range_nights:range,source_nights:dependencies.map(snapshot)};
  };
}