import test from 'node:test';
import assert from 'node:assert/strict';
import golden from './fixtures/projection-outliers-v4.js';
import { PROJECTION_DEFAULTS,resolveProjectionSettings } from '../lib/projections/settings.js';
import { shiftProjectionDate } from '../lib/projections/businessTime.js';
import { projectionDayNumber,projectionVolumeEligibility } from '../lib/projections/eligibility.js';
import { classifyProjectionOutliers,roundedOutlierRatio } from '../lib/projections/outliers.js';
import { projectRestaurantVolume } from '../lib/projections/volume.js';
import { readProjectionOutliers,storeProjectionOutliers } from '../lib/projections/outlierStore.js';

const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const REST=id(1),OTHER=id(2),DAY=golden.as_of,SNAP=DAY+'T12:00:00Z';
const near=(a,b,t=1e-8)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
const model={model_major:4,logic_revision:'approved-workbook-v4',reference_sha256:golden.sha256,released_at:'2020-01-01T00:00:00Z'};
const labels={isolated_outlier:'Isolated outlier',short_run:'Short run',provisional:'Provisional',active_run:'Active run',pending_review:'Pending review',one_off_event:'One-off event',confirmed_shift:'Confirmed shift'};
function input() {
  const history=golden.units.flat().map((total_units,i)=>{
    const f=golden.flags[i+6]||[1,0,0,null];return {restaurant_id:REST,business_date:shiftProjectionDate(golden.first,i),total_units,
      complete:!!f[0],source_covered:true,closed:!!f[1],early_close:!!f[2],holiday_keys:f[3]?['new_years_day']:[],
      outlier_status:'unchecked',source_revision:'fixture:'+i};
  });
  const archives=Object.entries(golden.forecasts).map(([r,expected])=>{const date=history[r-6].business_date;
    return {id:id(Number(r)),restaurant_id:REST,run_date:date,target_date:date,model_major:4,issued_at:date+'T06:00:00Z',
      source_through:shiftProjectionDate(date,-1),availability:'available',expected,supersedes_id:null};});
  return {restaurantId:REST,asOf:DAY,snapshotAt:SNAP,firstDataDate:golden.first,history,archives,decisions:[],modelVersion:model,
    resolvedSettings:resolveProjectionSettings({restaurantId:REST,at:SNAP,globalVersion:{id:id(2000),restaurant_id:null,
      model_major:4,effective_at:'2020-01-01T00:00:00Z',settings:PROJECTION_DEFAULTS}})};
}
function save(result,index=0){
  return {id:id(3000+index),restaurant_id:REST,model_major:4,created_at:'2026-11-11T06:00:00Z',...structuredClone(result.candidates[index])};
}
const run=data=>classifyProjectionOutliers(data??input());
const event=result=>result.runs.find(r=>r.start==='2026-11-05');
const row=(data,date)=>data.history.find(n=>n.business_date===date);
const sums=(nights,origin)=>['w','wx','wy','wxx','wxy'].map((key,i)=>nights.reduce((sum,n)=>{
  const x=(projectionDayNumber(n.business_date)-projectionDayNumber(origin))/7;
  return sum+n.weight*[1,x,n.total_units,x*x,x*n.total_units][i];
},0));

test('golden: all cached Nightly History H–P values match, including backfilled nights',()=>{
  const result=run();let checked=0;
  for(const [expected,rows] of golden.night_H_P)for(const r of rows){
    const n=result.nights[r-6],[H,I,J,K,L,M,N,O,P]=expected;
    if(H===null)assert.equal(n.ratio,null);else near(n.ratio,H);
    assert.deepEqual([n.direction,Number(n.tested),n.run_trace.forward,n.run_trace.backward,n.run_trace.next_direction,n.run_trace.length],[I,J,K,L,M,N]);
    const label=n.closed?'CLOSED':!n.complete?'INCOMPLETE':n.holiday_keys.length?'HOLIDAY':labels[n.outlier_status]||'KEEP';
    assert.equal(label,O);assert.equal(Number(['isolated_outlier','short_run','provisional','pending_review','one_off_event','excluded'].includes(n.outlier_status)),P);checked++;
  }
  assert.equal(checked,687);
});
test('golden: Counterfactual Model E–AO matches every cached enabled row',()=>{
  const data=input(),result=run(data),cf=event(result).counterfactuals;
  golden.counterfactuals.forEach((expected,i)=>{
    const c=cf[i],v=c.volume,r=v.recent,a=v.seasonal;
    const current=sums(r.nights,golden.first),lastyear=sums(a.fit.nights,golden.first);
    const x=(projectionDayNumber(r.latest_date)-projectionDayNumber(golden.first))/7;
    const lyx=(projectionDayNumber(a.fit.latest_date)-projectionDayNumber(golden.first))/7;
    const actual=[c.business_date,c.complete_through,v.calendar.weekday,r.nights.length,...current,r.latest_date,r.raw_slope,
      r.L-r.raw_slope*x,r.L,r.capped_slope,r.h,r.R,a.fit.nights.length,a.fit.latest_date,...lastyear,a.fit.raw_slope,
      a.fit.L-a.fit.raw_slope*lyx,a.fit.weighted_mean,a.fit.L,a.L_LY,a.target_window.eligible.length,a.target_mean,
      a.raw_ratio,a.source==='own_ly'?'OWN LY FIT':'OTHER',a.S,a.A,c.forecast,c.actual_units,c.ratio];
    assert.equal(actual.length,expected.length);
    actual.forEach((value,j)=>typeof expected[j]==='number'?near(value,expected[j],1e-6):assert.equal(value,expected[j]));
    assert.ok(!c.source_dates.some(date=>event(result).members.includes(date)||date>=c.business_date));
  });
});
test('golden: Run Review A–AD and Final Decisions reconcile with the calculated event',()=>{
  const data=input(),baseline=run(data);data.decisions=[save(baseline)];const saved=run(data);
  golden.run_review.forEach(([sourceRow,cells])=>{
    const r=baseline.runs.find(r=>r.start===cells[0]),posts=baseline.nights.filter(n=>n.tested&&n.business_date>=r.ended_at).slice(0,3);
    assert.equal(r.direction,cells[1]);assert.equal(r.members.length,cells[2]);assert.equal(r.last_flagged,cells[3]);assert.equal(r.ended_at,cells[4]);
    assert.equal(posts.length,cells[5]);
    for(let i=0;i<3;i++){
      assert.equal(posts[i].business_date,cells[6+i*3]);
      if(cells[7+i*3]!==null){near(r.counterfactuals[i].forecast,cells[7+i*3]);near(r.counterfactuals[i].ratio,cells[8+i*3]);}
    }
    assert.equal(labels[r.status],cells[15]);assert.equal(r.decided_through,cells[18]);
    assert.equal(data.history.findIndex(n=>n.business_date===r.start)+6,cells[20]);
    assert.equal(data.history.findIndex(n=>n.business_date===r.ended_at)+6,cells[21]);
    posts.forEach((p,i)=>assert.equal(data.history.findIndex(n=>n.business_date===p.business_date)+6,cells[22+i]));
    assert.equal(cells[25],'PASS');assert.equal(cells[29],0);
    const permanent=r.status==='one_off_event';assert.equal(cells[16],permanent?'One-off event':null);assert.equal(cells[17],labels[r.status]);
    assert.equal(cells[19],permanent?'PERMANENT SAVED INPUT':'RE-EVALUATE NIGHTLY');assert.equal(cells[26],Number(permanent));
    assert.equal(cells[27],permanent?6:0);assert.equal(cells[28],null);
    if(permanent)assert.equal(saved.saved_reviews[0].diagnostics.length,0);
  });
  const final=golden.final_decisions[0],r=event(baseline);
  assert.deepEqual([r.start,r.last_flagged,r.ended_at,r.direction,labels[r.status],r.decided_through],[...final.slice(0,6)]);
  assert.equal(final[6],1);assert.equal(final[7],'4');assert.equal(final[14],'SAMPLE-EVENT-20261105');
  r.counterfactuals.forEach((c,i)=>{near(c.forecast,final[8+2*i]);near(c.ratio,final[9+2*i]);});
});
test('v4 real-shift scenario retains the run after three counterfactual tests',()=>{
  const data=input();for(const date of ['2026-11-08','2026-11-09','2026-11-10']){
    row(data,date).total_units*=1.5;data.archives.find(a=>a.run_date===date).expected=row(data,date).total_units/1.15;
  }
  assert.equal(event(run(data)).status,'confirmed_shift');
});
test('v4 opposite-direction scenario excludes the old event and treats the low night separately',()=>{
  const data=input();row(data,'2026-11-08').total_units*=0.6;
  const result=run(data);assert.equal(event(result).status,'one_off_event');
  assert.equal(result.runs.find(r=>r.start==='2026-11-08').status,'isolated_outlier');
});
test('all backfilled history stays unchecked and eligible without stored forecasts',()=>{
  const data=input();data.archives=[];const result=run(data);assert.equal(result.runs.length,0);
  const n=result.nights.find(n=>n.tested);assert.equal(n.outlier_status,'unchecked');assert.deepEqual(n.diagnostics,['no_stored_forecast']);
  assert.equal(projectionVolumeEligibility(n,{restaurantId:REST,asOf:DAY}).eligible,true);
});
test('a missing day-of forecast ends a run without excluding that observed night',()=>{
  const data=input();data.archives=data.archives.filter(a=>a.run_date!=='2026-11-06');
  const result=run(data);assert.equal(result.runs.find(r=>r.start==='2026-11-05').status,'isolated_outlier');
  assert.equal(result.nights.find(n=>n.business_date==='2026-11-06').outlier_status,'unchecked');
});
for(const [cutoff,status] of [['2026-11-06','provisional'],['2026-11-07','provisional'],['2026-11-08','active_run'],
  ['2026-11-09','pending_review'],['2026-11-10','pending_review'],['2026-11-11','one_off_event']])test(`run replay at ${cutoff} is ${status}`,()=>{
  const data=input();data.asOf=cutoff;assert.equal(event(run(data)).status,status);
});
test('active_run counts in the unmodified Step 4 formulas',()=>{
  const data=input();data.asOf='2026-11-08';const result=run(data);
  assert.ok(result.nights.filter(n=>n.outlier_status==='active_run').every(n=>projectionVolumeEligibility(n,{restaurantId:REST,asOf:data.asOf}).eligible));
  const calendar=Array.from({length:8},(_,i)=>({restaurant_id:REST,business_date:shiftProjectionDate(data.asOf,i),
    closed:false,early_close:false,holiday_keys:[],default_factor:1,configuration_revision:0,context_digest:'a'.repeat(64)}));
  const volume=projectRestaurantVolume({...data,history:result.nights,calendar});
  assert.ok(volume.nights.find(n=>n.business_date==='2026-11-12').recent.nights.some(n=>n.business_date==='2026-11-05'));
});
test('closed, holiday, early-close and incomplete nights neither extend nor end runs',()=>{
  for(const field of ['closed','holiday_keys','early_close','complete','source_covered']){
    const data=input(),n=row(data,'2026-11-06');n[field]=field==='holiday_keys'?['new_years_day']:!['complete','source_covered'].includes(field);
    assert.deepEqual(event(run(data)).members,['2026-11-05','2026-11-07']);
  }
});
test('thresholds are strict and counterfactual comparison rounds to the configured precision',()=>{
  const data=input();row(data,'2026-11-05').total_units=data.archives.find(a=>a.run_date==='2026-11-05').expected*1.35;
  near(run(data).nights.find(n=>n.business_date==='2026-11-05').ratio,1.35);
  assert.equal(run(data).nights.find(n=>n.business_date==='2026-11-05').direction,0);
  assert.equal(roundedOutlierRatio(1.3500000000004,12),1.35);assert.equal(roundedOutlierRatio(0.6499999999996,12),0.65);
  assert.ok(roundedOutlierRatio(1.3500000000006,12)>1.35);
});
test('saved decisions retain membership and status when corrected sales disagree',()=>{
  const data=input();data.decisions=[save(run(data))];row(data,'2026-11-05').total_units=10;
  const result=run(data);assert.ok(result.saved_reviews[0].diagnostics.includes('saved_decision_retained_candidate_differs'));
  assert.equal(result.nights.find(n=>n.business_date==='2026-11-05').outlier_status,'one_off_event');
  assert.ok(result.runs.every(r=>r.members.every(date=>!data.decisions[0].member_nights.includes(date))));
});
test('overlapping saved decisions fail closed instead of selecting a winner',()=>{
  const data=input(),d=save(run(data));data.decisions=[d,{...structuredClone(d),id:id(4000),decision:'confirmed_shift'}];
  const result=run(data);const n=result.nights.find(n=>n.business_date==='2026-11-05');
  assert.equal(n.outlier_status,'excluded');assert.ok(n.diagnostics.includes('duplicate_final_decisions'));
});
test('future decisions and later-created archives cannot leak into backtests',()=>{
  const data=input();data.decisions=[{...save(run(data)),created_at:'2027-01-01T00:00:00Z'}];
  assert.equal(run(data).saved_reviews.length,0);data.archives.forEach(a=>a.issued_at='2027-01-01T00:00:00Z');assert.equal(run(data).runs.length,0);
});
test('missing baseline leaves an ended run pending, with an explicit reason',()=>{
  const data=input();data.firstDataDate=null;const r=event(run(data));assert.equal(r.status,'pending_review');
  assert.deepEqual(r.diagnostics,['missing_run_free_forecast_context']);assert.equal(r.decided_through,null);
});
test('post-run counterfactuals exclude previously flagged post nights and cannot use future decisions',()=>{
  const data=input();row(data,'2026-11-08').total_units*=0.6;const r=event(run(data));
  assert.ok(!r.counterfactuals[1].source_dates.includes('2026-11-08'));
  assert.equal(r.counterfactuals[0].history_statuses.find(n=>n.business_date==='2026-10-20').outlier_status,'isolated_outlier');
});
test('invalid tenant, duplicate source and invalid archive chains fail visibly',()=>{
  for(const kind of ['tenant','duplicate','archive','settings']){
    const data=input();if(kind==='tenant')data.history[0].restaurant_id=OTHER;if(kind==='duplicate')data.history.push({...data.history[0]});
    if(kind==='archive')data.archives[0].supersedes_id=id(9999);if(kind==='settings')data.resolvedSettings={...data.resolvedSettings,restaurant_id:OTHER};
    assert.throws(()=>run(data));
  }
});
test('deterministic immutable output does not freeze the caller and ignores incoming derived status',()=>{
  const data=input(),before=structuredClone(data),a=run(data);assert.deepEqual(data,before);assert.equal(Object.isFrozen(data.history[0]),false);
  data.history.reverse();data.archives.reverse();data.history.forEach(n=>n.outlier_status='one_off_event');const b=run(data);
  assert.deepEqual(a.runs,b.runs);assert.equal(Reflect.set(a.nights[0],'outlier_status','normal'),false);
});
test('failed and invalid database replies stay visible',async()=>{
  for(const reply of [null,{data:null,error:null},{data:[],error:null},{data:null,error:{message:'offline'}}])
    await assert.rejects(()=>readProjectionOutliers({rpc:async()=>reply},{restaurantId:REST,asOf:DAY,snapshotAt:SNAP}));
  await assert.rejects(()=>storeProjectionOutliers({rpc:async()=>({data:null,error:{message:'failed'}})},
    {...run(),source_context_digest:'a'.repeat(64)}),/failed/);
});
test('a low run uses the lower bound for its counterfactual decision',()=>{
  const data=input();for(const date of ['2026-11-05','2026-11-06','2026-11-07'])row(data,date).total_units*=0.3;
  const result=run(data),r=event(result);assert.equal(r.direction,-1);assert.equal(r.status,'one_off_event');
  for(const date of ['2026-11-08','2026-11-09','2026-11-10']){
    row(data,date).total_units*=0.5;data.archives.find(a=>a.run_date===date).expected=row(data,date).total_units;
  }
  assert.equal(event(run(data)).status,'confirmed_shift');
});
test('a final block cannot be absorbed by an adjacent continuing high run',()=>{
  const data=input();data.decisions=[save(run(data))];
  for(const date of ['2026-11-08','2026-11-09','2026-11-10'])row(data,date).total_units*=2;
  const result=run(data),r=result.runs.find(r=>r.start==='2026-11-08');assert.ok(r);
  assert.ok(r.members.every(date=>date>'2026-11-07'));assert.equal(result.saved_reviews[0].effective_status,'one_off_event');
});
test('a confirmed earlier saved shift counts in a later counterfactual while an earlier event does not',()=>{
  const data=input(),base=run(data),early={...save(base),id:id(9000),direction:1,decision:'confirmed_shift',
    member_nights:['2026-10-20','2026-10-21','2026-10-22'],decided_through:'2026-10-25',created_at:'2026-10-26T06:00:00Z'};
  data.decisions=[early];let r=event(run(data));
  assert.equal(r.counterfactuals[0].history_statuses.find(n=>n.business_date==='2026-10-20').outlier_status,'confirmed_shift');
  data.decisions[0].decision='one_off_event';r=event(run(data));
  assert.equal(r.counterfactuals[0].history_statuses.find(n=>n.business_date==='2026-10-20').outlier_status,'one_off_event');
});
test('zero or unavailable day-of forecasts never exclude otherwise eligible history',()=>{
  for(const availability of ['available','needs_baseline']){
    const data=input(),archive=data.archives.find(a=>a.run_date==='2026-11-05');archive.availability=availability;archive.expected=0;
    const n=run(data).nights.find(n=>n.business_date==='2026-11-05');assert.equal(n.outlier_status,'unchecked');
    assert.ok(n.diagnostics.includes('no_stored_forecast'));
  }
});
test('counterfactual comparison respects custom versioned bounds, run lengths and precision',()=>{
  const data=input(),settings={...PROJECTION_DEFAULTS,outlier_ratio_min:0.9,outlier_ratio_max:1.1,shift_run_nights:4,post_run_nights:2,comparison_decimal_places:8};
  data.resolvedSettings=resolveProjectionSettings({restaurantId:REST,at:SNAP,globalVersion:{id:id(2000),restaurant_id:null,
    model_major:4,effective_at:'2020-01-01T00:00:00Z',settings}});
  const r=event(run(data));assert.equal(r.status,'short_run');assert.equal(r.counterfactuals.length,0);
});
test('a changed archived run selects only its visible latest day-of version',()=>{
  const data=input(),parent=data.archives.find(a=>a.run_date==='2026-11-05');
  data.archives.push({...parent,id:id(9900),supersedes_id:parent.id,issued_at:'2026-11-06T06:00:00Z',expected:row(data,'2026-11-05').total_units});
  const n=run(data).nights.find(n=>n.business_date==='2026-11-05');assert.equal(n.direction,0);assert.equal(n.forecast_id,id(9900));
});
test('the engine rounds the counterfactual boundary before deciding a high run',()=>{
  for(const [ratio,status] of [[1.3500000000004,'one_off_event'],[1.3500000000006,'confirmed_shift']]){
    const data=input(),forecast=event(run(data)).counterfactuals[0].forecast;
    row(data,'2026-11-08').total_units=forecast*ratio;
    data.archives.find(a=>a.run_date==='2026-11-08').expected=row(data,'2026-11-08').total_units;
    assert.equal(event(run(data)).status,status);
  }
});
test('counterfactual windows anchor to the last complete source night across a data gap',()=>{
  const data=input();row(data,'2026-11-09').complete=false;
  const r=event(run(data)),c=r.counterfactuals.find(c=>c.business_date==='2026-11-10');
  assert.equal(c.complete_through,'2026-11-08');assert.equal(c.volume.window.until,'2026-11-08');
  assert.ok(c.source_dates.every(date=>date<'2026-11-10'));
});

test('unchanged saved evidence triggers zero candidate reruns',()=>{
  const data=input();data.decisions=[save(run(data))];
  const result=run(data);assert.equal(result.saved_decision_rechecks,0);
  assert.equal(result.saved_reviews[0].rechecked,false);assert.equal(result.saved_reviews[0].candidate,null);
  assert.deepEqual(result.saved_reviews[0].diagnostics,[]);
  assert.ok(data.decisions[0].trace.review_evidence.member_nights.every(n=>n.source_revision&&n.archive_id));
  assert.equal(data.decisions[0].trace.review_evidence.post_nights.length,3);
});
test('a changed member revision reruns comparison and reports a differing candidate',()=>{
  const data=input();data.decisions=[save(run(data))];
  const n=row(data,'2026-11-05');n.source_revision='corrected-member';n.total_units=10;
  const result=run(data);assert.equal(result.saved_decision_rechecks,1);assert.equal(result.saved_reviews[0].rechecked,true);
  assert.deepEqual(result.saved_reviews[0].diagnostics,['saved_decision_retained_candidate_differs']);
  assert.equal(result.nights.find(n=>n.business_date==='2026-11-05').outlier_status,'one_off_event');
});
test('post-night revisions and changed day-of archive IDs invalidate the evidence check',()=>{
  for(const kind of ['post_revision','archive']){
    const data=input();data.decisions=[save(run(data))];
    if(kind==='post_revision')row(data,'2026-11-08').source_revision='corrected-post';
    else{
      const parent=data.archives.find(a=>a.run_date==='2026-11-05');
      data.archives.push({...parent,id:id(9901),supersedes_id:parent.id,issued_at:'2026-11-12T06:00:00Z'});
    }
    assert.equal(run(data).saved_decision_rechecks,1);
  }
});
test('a fresh ingestion generation reruns comparison without inventing a changed result',()=>{
  const data=input();row(data,'2026-11-08').ingestion_generation='1';data.decisions=[save(run(data))];
  row(data,'2026-11-08').ingestion_generation='2';
  const result=run(data);assert.equal(result.saved_decision_rechecks,1);assert.deepEqual(result.saved_reviews[0].diagnostics,[]);
});
test('an intervening untested night is tracked and ordinary flag writes do not invalidate evidence',()=>{
  const data=input();row(data,'2026-11-06').complete=false;
  row(data,'2026-11-08').total_units=500;row(data,'2026-11-09').total_units=500;
  const initial=run(data);assert.ok(initial.candidates.length);
  data.decisions=[save(initial)];assert.equal(run(data).saved_decision_rechecks,0);
  data.history.forEach(n=>{n.updated_at='2026-11-18T12:00:00Z';n.flags={outliers:{as_of:DAY}};});
  assert.equal(run(data).saved_decision_rechecks,0);
  row(data,'2026-11-06').ingestion_generation='2';assert.equal(run(data).saved_decision_rechecks,1);
});
test('changed earlier counterfactual source evidence is rechecked while later history is ignored',()=>{
  const data=input();data.decisions=[save(run(data))];
  row(data,'2026-11-18').source_revision='later-service';assert.equal(run(data).saved_decision_rechecks,0);
  const prior=data.decisions[0].trace.review_evidence.source_nights.find(n=>n.business_date<'2026-11-05');
  row(data,prior.business_date).source_revision='corrected-baseline';assert.equal(run(data).saved_decision_rechecks,1);
});
test('legacy decisions without evidence remain conservatively reviewable',()=>{
  const data=input();data.decisions=[save(run(data))];delete data.decisions[0].trace.review_evidence;
  const result=run(data);assert.equal(result.saved_decision_rechecks,1);assert.deepEqual(result.saved_reviews[0].diagnostics,[]);
});
test('sixteen unchanged native decisions trigger zero comparison reruns',()=>{
  const data=input(),start=shiftProjectionDate(DAY,-100);
  data.history.forEach(n=>Object.assign(n,{total_units:100,complete:true,closed:false,early_close:false,holiday_keys:[]}));
  data.archives=[];
  for(let i=0;i<100;i++){
    const date=shiftProjectionDate(start,i);row(data,date).total_units=i<96&&i%6<3?160:100;
    data.archives.push({id:id(20000+i),restaurant_id:REST,run_date:date,target_date:date,model_major:4,
      issued_at:date+'T06:00:00Z',source_through:shiftProjectionDate(date,-1),availability:'available',expected:100,supersedes_id:null});
  }
  const baseline=run(data);assert.equal(baseline.candidates.length,16);
  data.decisions=baseline.candidates.map((candidate,i)=>({id:id(30000+i),restaurant_id:REST,model_major:4,created_at:SNAP,...candidate}));
  const result=run(data);assert.equal(result.saved_reviews.length,16);assert.equal(result.saved_decision_rechecks,0);
  assert.ok(result.saved_reviews.every(r=>!r.rechecked&&r.candidate===null&&r.diagnostics.length===0));
});