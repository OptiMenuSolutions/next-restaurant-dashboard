import test from 'node:test';
import assert from 'node:assert/strict';
import { PROJECTION_DEFAULTS, resolveProjectionSettings, projectionSettingsDigest } from '../lib/projections/settings.js';
import { shiftProjectionDate } from '../lib/projections/businessTime.js';
import { buildProjectionLifecycle } from '../lib/projections/lifecycle.js';
import { projectRestaurantVolume } from '../lib/projections/volume.js';
import { projectDishShares } from '../lib/projections/shares.js';

const id = n => `10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const REST=id(1),OTHER=id(2),DAY='2026-11-20',START='2026-10-01';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-10,`${a} != ${b}`);
function data(extra={}) {
  const dishes=[0,1,2].map(i=>({id:id(10+i),restaurant_id:REST,menu_created_at:'2020-01-01T00:00:00Z',
    added_business_date:'2020-01-01',forecastable:true,style_category:'Neutral'}));
  dishes[2].menu_created_at=`${START}T12:00:00Z`;dishes[2].added_business_date=START;
  const availability=dishes.map((d,i)=>({id:id(30+i),restaurant_id:REST,dish_id:d.id,
    valid_from:i===2?START:null,valid_until:null,is_initial:i!==2}));
  const history=[],dishFacts=[];
  for(let date='2026-09-01';date<DAY;date=shiftProjectionDate(date,1)) {
    const active=availability.filter(w=>(!w.valid_from||w.valid_from<=date)&&(!w.valid_until||date<w.valid_until));
    history.push({restaurant_id:REST,business_date:date,complete:true,source_covered:true,closed:false,early_close:false,
      holiday_keys:[],outlier_status:'kept',total_units:active.length*10,source_revision:`rev:${date}`});
    active.forEach(w=>dishFacts.push({restaurant_id:REST,business_date:date,dish_id:w.dish_id,units:10,
      recommended:false,sold_out:false,source_revision:`rev:${date}`}));
  }
  const resolvedSettings=resolveProjectionSettings({restaurantId:REST,at:`${DAY}T12:00:00Z`,globalVersion:{
    id:id(100),restaurant_id:null,model_major:4,effective_at:'2020-01-01T00:00:00Z',settings:{...PROJECTION_DEFAULTS,...extra}}});
  return {restaurantId:REST,asOf:DAY,snapshotAt:`${DAY}T12:00:00Z`,resolvedSettings,dishes,availability,history,dishFacts,priorSales:[],
    restaurant:{id:REST,onboarding_completed_at:'2026-01-01T00:00:00Z',first_data_date:'2026-09-01'}};
}
const run=d=>buildProjectionLifecycle(d);
const gap=(d,from,until)=>{
  const w=d.availability[2];w.valid_until=from;
  d.availability.push({...w,id:id(33),valid_from:until,valid_until:null,is_initial:false});
  d.dishFacts=d.dishFacts.filter(f=>f.dish_id!==d.dishes[2].id||f.business_date<from||f.business_date>=until);
  d.history.forEach(n=>{n.total_units=d.dishFacts.filter(f=>f.business_date===n.business_date).reduce((t,f)=>t+f.units,0);});
};
function shareInput(d) {
  const life=run(d),menu=life.dishes.map(x=>({...x}));
  const calendar=Array.from({length:8},(_,i)=>({restaurant_id:REST,business_date:shiftProjectionDate(DAY,i),closed:false,
    early_close:false,holiday_keys:[],default_factor:1,configuration_revision:1,context_digest:'a'.repeat(64)}));
  const volume=projectRestaurantVolume({restaurantId:REST,asOf:DAY,firstDataDate:d.restaurant.first_data_date,
    resolvedSettings:d.resolvedSettings,history:d.history,calendar,modelVersion:{model_major:4,logic_revision:'approved-workbook-v4',
      reference_sha256:'97e91fb3cf46e6b4726cb121f00f8b70f3fcb42eb914059fdf8fa40a6865b882',released_at:'2020-01-01T00:00:00Z'}});
  return {restaurantId:REST,asOf:DAY,snapshotAt:d.snapshotAt,resolvedSettings:d.resolvedSettings,volume,history:d.history,
    styleCategories:['Comfort/Heavy','Light/Fresh','Neutral'],dishes:menu,dishFacts:d.dishFacts,availability:life.availability,launchHistory:[]};
}

import { projectionMenuRepairStatus } from '../lib/projections/lifecycleHealth.js';

const repair = dish => ({ id:id(90),restaurant_id:REST,dish_id:dish,menu_item_id:dish,error_code:'P0001',
  attempt_count:2,first_failure_at:'2026-11-18T12:00:00Z',last_failure_at:'2026-11-19T12:00:00Z' });

test('a stuck repair quarantines its category while another category keeps its forecast',()=>{
  const d=data();d.dishes[0].style_category='Comfort/Heavy';
  const before=projectDishShares(shareInput(d));
  d.menuRepairs=[repair(d.dishes[2].id)];d.availability.splice(2,1);
  const life=run(d);assert.equal(life.dishes[2].lifecycle_unavailable,true);
  assert.equal(life.dishes[0].lifecycle_unavailable,undefined);
  const after=projectDishShares(shareInput(d));
  for(let i=0;i<8;i++){
    const healthy=after.nights[i].categories.find(c=>c.style_category==='Comfort/Heavy');
    const blocked=after.nights[i].categories.find(c=>c.style_category==='Neutral');
    assert.equal(healthy.status,'ok');assert.equal(blocked.reason,'lifecycle_unavailable');
    near(after.nights[i].dishes[0].expected_units,before.nights[i].dishes[0].expected_units);
    assert.equal(after.nights[i].dishes[2].expected_units,null);
  }
});
test('incomplete repaired-category facts exclude that night instead of inventing category demand',()=>{
  const d=data();d.dishes[0].style_category='Comfort/Heavy';d.menuRepairs=[repair(d.dishes[2].id)];
  d.dishFacts=d.dishFacts.filter(f=>!(f.dish_id===d.dishes[2].id&&f.business_date===START));
  const result=projectDishShares(shareInput(d));
  assert.equal(result.nights[0].dishes[0].status,'ok');
  assert.equal(result.nights[0].dishes[2].expected_units,null);
});
for(const mode of ['reconciliation','missing','revision'])test(`${mode} mismatch makes the launch pending with its date`,()=>{
  const d=data(),index=d.dishFacts.findIndex(f=>f.business_date===START&&f.dish_id===d.dishes[2].id);
  if(mode==='reconciliation')d.dishFacts[index].units+=5;
  if(mode==='missing'){d.dishFacts.splice(index,1);d.history.find(n=>n.business_date===START).total_units-=10;}
  if(mode==='revision')d.dishFacts[index].source_revision='stale';
  const result=run(d);assert.equal(result.observations.length,0);
  assert.equal(result.pending[0].reason,'facts_require_reingestion');assert.deepEqual(result.pending[0].dates,[START]);
});
test('an unrelated later launch still learns while an older launch needs reingestion',()=>{
  const d=data(),dish={...d.dishes[2],id:id(15),menu_created_at:'2026-10-23T12:00:00Z',added_business_date:'2026-10-23'};
  d.dishes.push(dish);d.availability.push({id:id(35),restaurant_id:REST,dish_id:dish.id,valid_from:'2026-10-23',valid_until:null,is_initial:false});
  for(const n of d.history.filter(n=>n.business_date>='2026-10-23')){
    d.dishFacts.push({restaurant_id:REST,business_date:n.business_date,dish_id:dish.id,units:10,recommended:false,sold_out:false,source_revision:n.source_revision});n.total_units+=10;
  }
  d.dishFacts.find(f=>f.business_date===START&&f.dish_id===d.dishes[2].id).source_revision='stale';
  const result=run(d);assert.equal(result.pending[0].dish_id,d.dishes[2].id);
  assert.equal(result.observations.length,1);assert.equal(result.observations[0].dish_id,dish.id);
});
test('a three-day archive in week two still learns from 25 available nights',()=>{
  const d=data();gap(d,'2026-10-10','2026-10-13');
  const result=run(d),observation=result.observations[0];
  assert.equal(result.skipped.length,0);assert.equal(observation.trace.dates_used.length,25);
  near(observation.first_four_week_share,1/3);
  assert.deepEqual(observation.trace.excluded,[10,11,12].map(n=>({business_date:`2026-10-${n}`,reasons:['unavailable']})));
});
test('a real episode ending inside four weeks is still skipped',()=>{
  const d=data();gap(d,'2026-10-10','2026-11-10');
  assert.equal(run(d).skipped[0].reason,'removed_inside_first_four_weeks');
});
test('wrong tenants duplicates and bad fact or repair types still reject',()=>{
  const d=data();d.dishFacts[0].units='10';assert.throws(()=>run(d),/Invalid dish fact/);
  const other=data();other.menuRepairs=[{...repair(other.dishes[2].id),restaurant_id:OTHER}];assert.throws(()=>run(other),/crosses restaurants/);
  other.menuRepairs=[repair(other.dishes[2].id),repair(other.dishes[2].id)];assert.throws(()=>run(other),/duplicate menu repair/);
});
test('pre-migration settings resolve in volume and share without adding the lifecycle key',()=>{
  const d=data(),input=shareInput(d),legacy={...PROJECTION_DEFAULTS};delete legacy.minimum_return_gap_days;
  const resolved=resolveProjectionSettings({restaurantId:REST,at:d.snapshotAt,globalVersion:{id:id(100),restaurant_id:null,
    model_major:4,effective_at:'2020-01-01T00:00:00Z',settings:legacy}});
  assert.equal(Object.hasOwn(resolved.settings,'minimum_return_gap_days'),false);
  const volume=projectRestaurantVolume({restaurantId:REST,asOf:DAY,firstDataDate:d.restaurant.first_data_date,
    resolvedSettings:resolved,modelVersion:input.volume.provenance.model_version,history:d.history,calendar:input.volume.nights.map(n=>n.calendar)});
  assert.equal(volume.nights[0].status,'ok');
  const shares=projectDishShares({...input,resolvedSettings:resolved,volume});assert.equal(shares.nights[0].status,'ok');
  assert.equal(projectionSettingsDigest(legacy),resolved.settings_digest);
  assert.notEqual(resolved.settings_digest,d.resolvedSettings.settings_digest);
  d.resolvedSettings=resolved;assert.throws(()=>run(d),/explicit minimum_return_gap_days/);
});
function monitor(reply){
  const calls=[],chain={};
  for(const method of ['select','lt'])chain[method]=(...args)=>{calls.push([method,...args]);return chain;};
  chain.abortSignal=async()=>reply;
  return {calls,db:{from:name=>{calls.push(['from',name]);return chain;}}};
}
test('repair monitoring counts every overdue row using the original failure time',async()=>{
  const f=monitor({count:10001,error:null});
  const result=await projectionMenuRepairStatus(f.db,new Date('2026-11-20T12:00:00Z'));
  assert.equal(result.status,'DOWN');assert.match(result.error,/10001 menu repair/);
  assert.deepEqual(f.calls[2],['lt','first_failure_at','2026-11-19T12:00:00.000Z']);
  assert.deepEqual(f.calls[1],['select','id',{count:'exact',head:true}]);
});
test('no overdue repairs clears the existing monitor state; failed reads never clear it',async()=>{
  assert.equal((await projectionMenuRepairStatus(monitor({count:0,error:null}).db)).status,'UP');
  for(const reply of [null,{}, {count:null,error:null},{count:0,error:{message:'offline'}}]){
    assert.equal((await projectionMenuRepairStatus(monitor(reply).db)).status,'DOWN');
  }
});