import test from 'node:test';
import assert from 'node:assert/strict';
import golden from './fixtures/projection-holidays-v4.js';
import { PROJECTION_DEFAULTS,resolveProjectionSettings,projectionSettingsDigest } from '../lib/projections/settings.js';
import { shiftProjectionDate } from '../lib/projections/businessTime.js';
import { buildHolidayFactors,holidayFactorArithmetic,currentHolidayVersions } from '../lib/projections/holidayFactors.js';
import { buildHolidayLearning } from '../lib/projections/holidayLearning.js';
import { projectRestaurantVolume } from '../lib/projections/volume.js';
import { projectDishShares } from '../lib/projections/shares.js';
import { readProjectionHolidays,storeProjectionHolidays } from '../lib/projections/holidayStore.js';

const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const REST=id(1),OTHER=id(2),DAY='2026-11-25',SNAP=`${DAY}T12:00:00Z`;
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-11,`${a} != ${b}`);
const model={model_major:4,logic_revision:'approved-workbook-v4',reference_sha256:golden.sha256,released_at:'2020-01-01T00:00:00Z'};
const version=()=>resolveProjectionSettings({restaurantId:REST,at:SNAP,globalVersion:{id:id(100),restaurant_id:null,model_major:4,
  effective_at:'2020-01-01T00:00:00Z',settings:PROJECTION_DEFAULTS}});
const sample=()=>golden.learning.map(([date,key,actual,L,open,ratio],i)=>({id:id(200+i),restaurant_id:REST,business_date:date,
  holiday_keys:[key],observed_ratio:ratio,supersedes_id:null,created_at:`${shiftProjectionDate(date,1)}T12:00:00Z`}));
function factorInput(keys=['thanksgiving_eve']){
  const rules=keys.map((key,i)=>({id:id(300+i),restaurant_id:null,concept_type:'full_service',holiday_key:key,weekday_group:'all',
    effective_at:'2020-01-01T00:00:00Z',default_factor:key==='super_bowl'?0.8:key==='valentines_day'?1.2:key==='thanksgiving_day'?1:1.2,default_answer:'open'}));
  const calendar=Array.from({length:8},(_,i)=>({restaurant_id:REST,business_date:shiftProjectionDate(DAY,i),closed:false,early_close:false,
    holiday_keys:i?[]:keys,concept_type:'full_service',concept_fallback:false,configuration_revision:1,context_digest:'a'.repeat(64),
    default_factor:i?1:rules.reduce((n,r)=>n*r.default_factor,1),resolved_holidays:i?[]:rules.map(r=>({holiday_key:r.holiday_key,rule_id:r.id,default_factor:r.default_factor,answer:'open'}))}));
  return {restaurantId:REST,asOf:DAY,snapshotAt:SNAP,resolvedSettings:version(),calendar,rules,observations:sample()};
}
function learningInput(){
  const history=[],archives=[],holidays=[],holidayAnswers=[],resolved=version();
  golden.learning.forEach(([date,key,actual,L],i)=>{
    const realKey=key==='early_close'?'christmas_eve':key;
    history.push({restaurant_id:REST,business_date:date,total_units:actual,complete:true,source_covered:true,closed:false,early_close:false,
      holiday_keys:[realKey],outlier_status:'unchecked',source_revision:`r:${date}`});
    holidays.push({holiday_date:date,holiday_key:realKey});
    if(key==='early_close')holidayAnswers.push({restaurant_id:REST,business_date:date,answer:'early_close',revision:1,recorded_at:`${date}T00:00:00Z`});
    archives.push({id:id(400+i),restaurant_id:REST,run_date:date,target_date:date,issued_at:`${date}T06:00:00Z`,supersedes_id:null,
      source_through:shiftProjectionDate(date,-1),availability:'available',global_version_id:resolved.global_version_id,restaurant_version_id:null,
      settings_snapshot:resolved.settings,settings_digest:resolved.settings_digest,model_version:model,
      volume:{business_date:date,status:'ok',recent:{L,nights:[{business_date:shiftProjectionDate(date,-7)}]},
        provenance:{model_major:4,global_version_id:resolved.global_version_id}}});
  });
  return {restaurantId:REST,asOf:DAY,snapshotAt:SNAP,resolvedSettings:resolved,modelVersion:model,firstDataDate:'2020-01-01',
    history,holidays,holidayAnswers,archives,closureThresholdUnits:2};
}
function regularHistory(){
  const rows=[];for(let date='2026-06-01';date<DAY;date=shiftProjectionDate(date,1))rows.push({restaurant_id:REST,business_date:date,
    complete:true,source_covered:true,closed:false,early_close:false,holiday_keys:[],outlier_status:'kept',source_revision:`r:${date}`,total_units:100});
  return rows;
}
const math=(closed,early,components)=>holidayFactorArithmetic({closed,early_close:early,components,observations:sample(),earlyCloseFactor:0.6});
const component=([key,closed,early,H])=>({holiday_key:key,default_factor:H,answer:closed?'closed':early?'early_close':'open'});

test('golden export covers every cached Holiday Calendar H–K and Holiday Dates D–K row',()=>{
  assert.equal(golden.calendar.reduce((n,r)=>n+r.at(-1).length,0),90);
  assert.equal(golden.dates.reduce((n,r)=>n+r.at(-1).length,0),89);
  golden.calendar.forEach(row=>{
    const [key,closed,early,H,I,J,K]=row,result=math(closed,early,[component(row)]);
    near(result.components[0].default_factor,H);assert.equal(result.components[0].n,I);near(result.components[0].calendar_factor,J);
    assert.equal(K,I?'OWN HISTORY BLEND':'SPEC DEFAULT');
  });
  golden.dates.forEach(([indexes,D,E,F,G,H,I,J,K])=>{
    const result=math(!!E,!!F,indexes.map(i=>component(golden.calendar[i])));
    near(result.component_product,D);assert.equal(result.combination_n,G);near(result.combination_ratio_sum,H);
    near(result.factor,I);assert.equal(result.source,J);near(E?0:F?result.early_close_factor:1,K);
  });
  near(math(false,true,[]).factor,golden.early_close_B28);
});
test('golden learning ratios and eligibility match cached F–G, including the empty rows',()=>{
  const result=buildHolidayLearning(learningInput());assert.equal(result.observations.length,6);assert.equal(result.skipped.length,0);
  golden.learning.forEach(([date,key,actual,L,open,F,G])=>{
    const row=result.observations.find(r=>r.business_date===date);near(row.observed_ratio,F);assert.equal(open,G);
    assert.deepEqual(row.holiday_keys,[key]);assert.equal(row.trace.normal_L,L);assert.equal(row.trace.L_source,'archived');
  });
  assert.ok(golden.empty_learning_G.every(value=>value===0));near(golden.early_close_B28,0.62);
});
test('single holiday uses its effective default plus exactly matching observations',()=>{
  const result=buildHolidayFactors(factorInput()).nights[0];near(result.factor,(1.2+1.2+1.4)/3);assert.equal(result.n,2);
  const empty=factorInput();empty.observations=[];near(buildHolidayFactors(empty).nights[0].factor,1.2);
});
test('overlap uses learned component factors, then blends combination observations',()=>{
  const input=factorInput(['super_bowl','valentines_day']);const first=buildHolidayFactors(input).nights[0];
  near(first.factor,0.8*(1.2+1.25)/2);assert.equal(first.source,'PRODUCT OF ALL HOLIDAYS');
  input.observations.push({id:id(500),restaurant_id:REST,business_date:'2025-02-09',holiday_keys:['super_bowl','valentines_day'],
    observed_ratio:1.6,created_at:'2025-02-10T12:00:00Z',supersedes_id:null});
  const learned=buildHolidayFactors(input).nights[0];near(learned.factor,(first.factor+1.6)/2);assert.equal(learned.source,'COMBINATION LEARNED');
  assert.deepEqual(learned.components.map(r=>r.n),[0,1]);assert.equal(learned.combination_n,1);
});
test('early close replaces holiday multiplication and reopened Thanksgiving starts at 1.0',()=>{
  const input=factorInput();input.calendar[0].early_close=true;input.calendar[0].default_factor=0.6;input.calendar[0].resolved_holidays[0].answer='early_close';
  const row=buildHolidayFactors(input).nights[0];near(row.factor,0.62);assert.equal(row.source,'EARLY CLOSE ONLY');assert.equal(row.n,2);
  near(buildHolidayFactors(factorInput(['thanksgiving_day'])).nights[0].factor,1);
  input.calendar[0].early_close=false;input.calendar[0].closed=true;input.calendar[0].default_factor=0;
  assert.equal(buildHolidayFactors(input).nights[0].factor,0);
});
test('learned factors have no added cap',()=>{
  const input=factorInput();input.observations[0].observed_ratio=1000;
  assert.ok(buildHolidayFactors(input).nights[0].factor>100);
});
test('future dates and later-created versions cannot leak into a historical snapshot',()=>{
  const input=factorInput();input.observations[0].created_at='2026-11-26T00:00:00Z';
  assert.equal(buildHolidayFactors(input).nights[0].n,1);
  input.observations[1].business_date=DAY;assert.equal(buildHolidayFactors(input).nights[0].n,0);
});
test('corrections replace their earlier observation, including a corrected classification',()=>{
  const input=factorInput(),parent=input.observations[0];
  input.observations.push({...parent,id:id(501),supersedes_id:parent.id,created_at:'2026-01-01T00:00:00Z',holiday_keys:['early_close'],observed_ratio:0.5});
  assert.equal(buildHolidayFactors(input).nights[0].n,1);
  assert.equal(currentHolidayVersions(input.observations,REST,DAY,SNAP).length,input.observations.length-1);
});
test('wrong tenants, duplicate originals, missing parents and branching histories reject',()=>{
  for(const kind of ['tenant','original','missing','branch']){
    const input=factorInput(),parent=input.observations[0];
    if(kind==='tenant')parent.restaurant_id=OTHER;
    if(kind==='original')input.observations.push({...parent,id:id(502)});
    if(kind==='missing')parent.supersedes_id=id(999);
    if(kind==='branch')input.observations.push(...[503,504].map(n=>({...parent,id:id(n),supersedes_id:parent.id,created_at:'2026-01-01T00:00:00Z'})));
    assert.throws(()=>buildHolidayFactors(input));
  }
});
test('effective rule precedence matches Step 3 and changed or forged factor snapshots reject',()=>{
  const input=factorInput();input.rules.push({...input.rules[0],id:id(600),restaurant_id:REST,default_factor:1.5});
  input.calendar[0].default_factor=1.5;input.calendar[0].resolved_holidays[0]={...input.calendar[0].resolved_holidays[0],rule_id:id(600),default_factor:1.5};
  near(buildHolidayFactors(input).nights[0].components[0].default_factor,1.5);
  const history=regularHistory(),snapshot=structuredClone(buildHolidayFactors(input));snapshot.nights[0].factor=10;
  assert.throws(()=>projectRestaurantVolume({restaurantId:REST,asOf:DAY,firstDataDate:'2026-06-01',resolvedSettings:input.resolvedSettings,
    modelVersion:model,history,calendar:input.calendar,holidaySnapshot:snapshot}),/verification failed/);
});
test('holiday snapshot changes adjusted volume while base volume and Step 5 dish shares remain unchanged',()=>{
  const input=factorInput(),history=regularHistory(),common={restaurantId:REST,asOf:DAY,firstDataDate:'2026-06-01',resolvedSettings:input.resolvedSettings,
    modelVersion:model,history,calendar:input.calendar};
  const original=projectRestaurantVolume(common),volume=projectRestaurantVolume({...common,holidaySnapshot:buildHolidayFactors(input)});
  near(volume.nights[0].base_volume,original.nights[0].base_volume);near(volume.nights[0].calendar_default_factor,1.2);
  near(volume.nights[0].adjusted_volume,100*(1.2+1.2+1.4)/3);
  const dishes=[0,1,2].map(i=>({id:id(700+i),restaurant_id:REST,forecastable:true,style_category:'Neutral',launch_date:'2020-01-01',
    removed_date:null,is_new:false,is_returning:false,last_season_removed_date:null,last_season_category_count:null}));
  const facts=history.flatMap(n=>dishes.map((d,i)=>({restaurant_id:REST,business_date:n.business_date,dish_id:d.id,units:[40,30,30][i],
    recommended:false,sold_out:false,source_revision:n.source_revision})));
  const share={restaurantId:REST,asOf:DAY,snapshotAt:SNAP,resolvedSettings:input.resolvedSettings,history,dishes,dishFacts:facts,
    launchHistory:[],styleCategories:['Comfort/Heavy','Light/Fresh','Neutral']};
  const a=projectDishShares({...share,volume:original}),b=projectDishShares({...share,volume});
  a.nights[0].dishes.forEach((row,i)=>near(row.overall_share,b.nights[0].dishes[i].overall_share));
  near(b.nights[0].dishes.reduce((n,r)=>n+r.expected_units,0),volume.nights[0].adjusted_volume);
  assert.throws(()=>projectDishShares({...share,volume,snapshotAt:`${DAY}T06:00:00Z`}),/same capture time/);
});
for(const reason of ['closed','incomplete','not_pos_covered','zero_normal_L','archived_baseline_unavailable'])test(`${reason} produces a skipped observation without inventing a ratio`,()=>{
  const input=learningInput(),date=input.history[0].business_date;
  if(reason==='closed')input.history[0].closed=true;
  if(reason==='incomplete')input.history[0].complete=false;
  if(reason==='not_pos_covered')input.history[0].source_covered=false;
  if(reason==='zero_normal_L')input.archives[0].volume.recent.L=0;
  if(reason==='archived_baseline_unavailable')input.archives[0].availability='needs_baseline';
  const result=buildHolidayLearning(input);assert.equal(result.observations.length,5);assert.equal(result.skipped.find(r=>r.business_date===date).reason,reason);
});
test('without an archive, reconstruct Step 4 as of the holiday and use L rather than R or the blend',()=>{
  const input=learningInput();input.archives=[];input.history=regularHistory();input.holidays=[{holiday_date:'2026-11-18',holiday_key:'thanksgiving_eve'}];input.holidayAnswers=[];
  const night=input.history.find(n=>n.business_date==='2026-11-18');night.holiday_keys=['thanksgiving_eve'];night.total_units=150;
  const result=buildHolidayLearning(input),row=result.observations[0];assert.equal(row.trace.L_source,'reconstructed');near(row.trace.normal_L,100);near(row.observed_ratio,1.5);
  assert.ok(row.trace.source_dates.every(date=>date<'2026-11-18'));
});
test('an unavailable reconstructed baseline is skipped and no future archive is borrowed',()=>{
  const input=learningInput();input.archives.forEach(r=>r.issued_at='2027-01-01T00:00:00Z');
  const result=buildHolidayLearning(input);assert.equal(result.observations.length,0);
  assert.ok(result.skipped.every(r=>r.reason==='reconstructed_baseline_unavailable'));
});
test('an overlap night records one combined observation while early close records only its reserved key',()=>{
  const input=learningInput(),date=input.history[0].business_date;input.holidays.push({holiday_date:date,holiday_key:'super_bowl'});input.history[0].holiday_keys.push('super_bowl');
  const result=buildHolidayLearning(input);assert.deepEqual(result.observations.find(r=>r.business_date===date).holiday_keys,['super_bowl','thanksgiving_eve']);
  assert.equal(result.observations.filter(r=>r.business_date===date).length,1);
  assert.equal(result.observations.filter(r=>r.holiday_keys[0]==='early_close').length,2);
});
test('invalid database responses remain failures and immutable snapshots do not freeze their inputs',async()=>{
  for(const reply of [null,{data:null,error:null},{data:[],error:null},{data:null,error:{message:'offline'}}])
    await assert.rejects(()=>readProjectionHolidays({rpc:async()=>reply},{restaurantId:REST,asOf:DAY,snapshotAt:SNAP}));
  await assert.rejects(()=>storeProjectionHolidays({rpc:async()=>({data:null,error:{message:'failed'}})},
    {...buildHolidayLearning(learningInput()),source_context_digest:'a'.repeat(64)}),/failed/);
  const input=factorInput(),before=structuredClone(input),result=buildHolidayFactors(input);assert.deepEqual(input,before);
  assert.equal(Object.isFrozen(input.calendar[0]),false);assert.equal(Reflect.set(result.nights[0],'factor',9),false);
});
test('excluded current source dates stop old observations contributing without rewriting history',()=>{
  const input=factorInput();input.excludedDates=[input.observations[0].business_date];
  const result=buildHolidayFactors(input);assert.equal(result.nights[0].n,1);near(result.nights[0].factor,(1.2+1.4)/2);
  assert.equal(input.observations.length,6);
});
test('a future rule cannot replace the effective default, and fallback identifies full service',()=>{
  const input=factorInput();input.rules.push({...input.rules[0],id:id(810),effective_at:'2027-01-01T00:00:00Z',default_factor:9});
  near(buildHolidayFactors(input).nights[0].components[0].default_factor,1.2);
  input.calendar[0].concept_fallback=true;assert.equal(buildHolidayFactors(input).nights[0].concept_fallback,true);
  input.calendar[0].concept_type='bar_pub';assert.throws(()=>buildHolidayFactors(input));
});
test('the existing v4 settings shape works without the Step 6 lifecycle setting',()=>{
  const input=factorInput(),settings={...PROJECTION_DEFAULTS};delete settings.minimum_return_gap_days;
  input.resolvedSettings=resolveProjectionSettings({restaurantId:REST,at:SNAP,globalVersion:{id:id(100),restaurant_id:null,model_major:4,
    effective_at:'2020-01-01T00:00:00Z',settings}});
  assert.equal(Object.hasOwn(buildHolidayFactors(input).inputs.resolvedSettings.settings,'minimum_return_gap_days'),false);
});
test('row ordering is deterministic and a mismatched calendar cannot reuse a holiday snapshot',()=>{
  const input=factorInput(),a=buildHolidayFactors(input);input.calendar.reverse();input.rules.reverse();input.observations.reverse();
  assert.deepEqual(buildHolidayFactors(input),a);
  const calendar=structuredClone(a.inputs.calendar);calendar[0].context_digest='b'.repeat(64);
  assert.throws(()=>projectRestaurantVolume({restaurantId:REST,asOf:DAY,firstDataDate:'2026-06-01',resolvedSettings:input.resolvedSettings,
    modelVersion:model,history:regularHistory(),calendar,holidaySnapshot:a}),/different calendar/);
});
test('an archive containing future normal-level evidence is rejected',()=>{
  const input=learningInput();input.archives[0].volume.recent.nights=[{business_date:input.archives[0].run_date}];
  assert.throws(()=>buildHolidayLearning(input),/future source dates/);
});