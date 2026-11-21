import test from 'node:test';
import assert from 'node:assert/strict';
import { PROJECTION_DEFAULTS, resolveProjectionSettings } from '../lib/projections/settings.js';
import { shiftProjectionDate } from '../lib/projections/businessTime.js';
import { buildProjectionLifecycle } from '../lib/projections/lifecycle.js';
import { projectRestaurantVolume } from '../lib/projections/volume.js';
import { projectDishShares } from '../lib/projections/shares.js';
import { readProjectionLifecycle, storeProjectionLaunches } from '../lib/projections/lifecycleStore.js';

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

test('onboarding null and multiple onboarding batches never become launches',()=>{
  for(const completed of [null,`${DAY}T00:00:00Z`]) {
    const d=data();d.restaurant.onboarding_completed_at=completed;
    d.availability.forEach(w=>{w.valid_from=null;w.is_initial=true;});
    const result=run(d);assert.equal(result.observations.length,0);
    result.dishes.forEach(x=>{assert.equal(x.is_new,false);assert.equal(x.launch_date,'2026-09-01');});
  }
});
test('first-four-week share is unweighted and the stored index is unclamped',()=>{
  const d=data(); let launchUnits=0,categoryUnits=0;
  for(let i=0;i<28;i++) {
    const date=shiftProjectionDate(START,i);
    d.dishFacts.filter(f=>f.business_date===date).forEach(f=>{f.units=f.dish_id===d.dishes[2].id?i+1:1;});
    const units=i+3;d.history.find(n=>n.business_date===date).total_units=units;
    launchUnits+=i+1;categoryUnits+=units;
  }
  const observation=run(d).observations[0];
  near(observation.first_four_week_share,launchUnits/categoryUnits);
  near(observation.launch_index,3*launchUnits/categoryUnits);assert.ok(observation.launch_index>2);
  assert.equal(observation.existing_dishes,2);assert.equal(observation.observed_through,'2026-10-28');
  assert.equal(observation.trace.dates_used.length,28);
});
test('same-day launches do not count each other as existing',()=>{
  const d=data();d.dishes[1].menu_created_at=d.dishes[2].menu_created_at;d.dishes[1].added_business_date=START;
  d.availability[1].valid_from=START;d.availability[1].is_initial=false;
  d.dishFacts=d.dishFacts.filter(f=>f.dish_id!==d.dishes[1].id||f.business_date>=START);
  const result=run(d);assert.equal(result.observations.length,2);
  result.observations.forEach(o=>assert.deepEqual(o.trace.existing_dish_ids,[d.dishes[0].id]));
});
test('a window must be entirely before as-of; an unfinished open night delays learning',()=>{
  const d=data();d.asOf='2026-10-28';assert.equal(run(d).observations.length,0);
  d.asOf=DAY;d.history.find(n=>n.business_date==='2026-10-14').complete=false;
  assert.equal(run(d).observations.length,0);assert.equal(run(d).pending[0].reason,'incomplete_open_night');
});
test('closed incomplete nights do not delay an otherwise complete launch',()=>{
  const d=data(),night=d.history.find(n=>n.business_date==='2026-10-14');night.closed=true;night.complete=false;
  const observation=run(d).observations[0];assert.equal(observation.trace.dates_used.length,27);
});
test('removal inside the launch window is skipped rather than learned from partial weeks',()=>{
  const d=data();d.availability[2].valid_until='2026-10-14';
  assert.equal(run(d).observations.length,0);assert.equal(run(d).skipped[0].reason,'removed_inside_first_four_weeks');
});
test('recommended and sold-out nights remove both dish and category units; unknown flags remain clean',()=>{
  const d=data(),f=d.dishFacts.filter(f=>f.dish_id===d.dishes[2].id&&f.business_date>=START);
  f[0].recommended=true;f[1].sold_out=true;f[2].recommended=null;f[2].sold_out=null;
  const observation=run(d).observations[0];near(observation.first_four_week_share,1/3);
  assert.equal(observation.trace.dates_used.length,26);assert.deepEqual(observation.trace.unknown_flag_dates,[f[2].business_date]);
});
test('a short gap preserves original launch and new status without filling the gap',()=>{
  const d=data();gap(d,'2026-10-10','2026-10-17');const result=run(d),dish=result.dishes.find(x=>x.id===d.dishes[2].id);
  assert.equal(dish.launch_date,START);assert.equal(dish.is_new,true);assert.equal(dish.is_returning,false);
  const shares=projectDishShares(shareInput(d));
  assert.equal(shares.baselines[2].n,d.dishFacts.filter(f=>f.dish_id===dish.id).length);
  assert.equal(shares.baselines[2].trace.included_dates.includes('2026-10-12'),false);
});
for(const length of [27,28,29]) test(`return classification at a ${length}-day gap uses the versioned boundary`,()=>{
  const d=data();gap(d,'2026-10-01',shiftProjectionDate('2026-10-01',length));
  const dish=run(d).dishes.find(x=>x.id===d.dishes[2].id);
  assert.equal(dish.is_returning,length>=28);
  assert.equal(dish.launch_date,length>=28?shiftProjectionDate('2026-10-01',length):START);
  if(length>=28){assert.equal(dish.last_season_removed_date,'2026-10-01');assert.equal(dish.last_season_category_count,3);}
});
test('missing inside availability rejects; missing outside availability is not a zero',()=>{
  const d=data();gap(d,'2026-10-10','2026-10-17');const input=shareInput(d);
  assert.doesNotThrow(()=>projectDishShares(input));
  const removed=input.dishFacts.findIndex(f=>f.dish_id===d.dishes[2].id&&f.business_date==='2026-10-18');
  input.history=structuredClone(input.history);input.volume=structuredClone(input.volume);
  // A zero proves the missing-row guard independently from the volume reconciliation.
  input.dishFacts[removed].units=0;
  const date=input.dishFacts[removed].business_date;d.dishFacts.find(f=>f.dish_id===d.dishes[2].id&&f.business_date===date).units=0;
  d.history.find(n=>n.business_date===date).total_units=20;
  const refreshed=shareInput(d);refreshed.dishFacts.splice(refreshed.dishFacts.findIndex(f=>f.dish_id===d.dishes[2].id&&f.business_date===date),1);
  assert.throws(()=>projectDishShares(refreshed),/Missing dish fact/);
});
test('eligible positive sales before an addition produce inferred existing origin',()=>{
  const d=data();d.priorSales=[{restaurant_id:REST,dish_id:d.dishes[2].id,business_date:'2026-09-10',units:2,external_item_id:'same-button'}];
  const result=run(d),dish=result.dishes.find(x=>x.id===d.dishes[2].id);
  assert.equal(dish.launch_date,'2026-09-10');assert.equal(dish.is_new,false);
  assert.equal(dish.lifecycle_trace.inferred_existing_from_prior_sales,true);assert.equal(result.origin_corrections.length,1);
});
test('zero, future and ineligible prior sales cannot manufacture existing history',()=>{
  const d=data();d.priorSales=[{restaurant_id:REST,dish_id:d.dishes[2].id,business_date:'2026-09-10',units:0},
    {restaurant_id:REST,dish_id:d.dishes[2].id,business_date:DAY,units:10}];
  assert.equal(run(d).origin_corrections.length,0);
  d.priorSales[0].units=10;d.history.find(n=>n.business_date==='2026-09-10').holiday_keys=['labor_day'];
  assert.equal(run(d).origin_corrections.length,0);
});
test('POS button metadata is not part of dish identity or the launch key',()=>{
  const d=data(),a=run(d);d.dishes[2].external_pos_item_id='changed-button';
  assert.deepEqual(run(d).observations,a.observations);
});
test('source corrections change the observation digest; future facts cannot',()=>{
  const d=data(),a=run(d).observations[0];d.dishFacts.push({...d.dishFacts[0],business_date:DAY});
  assert.deepEqual(run(d).observations[0],a);d.dishFacts.find(f=>f.dish_id===d.dishes[2].id&&f.business_date===START).units=20;
  d.history.find(n=>n.business_date===START).total_units=40;
  assert.notEqual(run(d).observations[0].trace.inputs_digest,a.trace.inputs_digest);
});
test('foreign restaurants, invalid gaps and unknown settings reject',()=>{
  const d=data();d.availability[0].restaurant_id=OTHER;assert.throws(()=>run(d));
  for(const gapValue of [0,-1,1.5,'28',null]) assert.throws(()=>data({minimum_return_gap_days:gapValue}));
});
test('database errors and invalid responses remain failures, never empty successful reads',async()=>{
  for(const result of [null,{data:null,error:null},{data:[],error:null},{data:null,error:{message:'failed',code:'XX'}}]) {
    await assert.rejects(()=>readProjectionLifecycle({rpc:async()=>result},{restaurantId:REST,asOf:DAY,snapshotAt:`${DAY}T12:00:00Z`}));
  }
  await assert.rejects(()=>storeProjectionLaunches({rpc:async()=>({data:null,error:{message:'write failed'}})},
    {...run(data()),source_context_digest:'a'.repeat(64)}),/write failed/);
});
test('results are immutable and input snapshots stay unchanged',()=>{
  const d=data(),before=structuredClone(d),result=run(d);assert.deepEqual(d,before);
  assert.equal(Reflect.set(result.observations[0],'launch_index',0),false);
});

test('input row order cannot change lifecycle output or digests',()=>{
  const d=data(),a=run(d);
  for(const key of ['dishes','availability','history','dishFacts'])d[key].reverse();
  assert.deepEqual(run(d),a);
});
test('all holiday, early-close, uncovered and excluded-outlier reasons remain visible',()=>{
  const d=data();d.history.find(n=>n.business_date===START).holiday_keys=['christmas_day'];
  d.history.find(n=>n.business_date==='2026-10-02').early_close=true;
  d.history.find(n=>n.business_date==='2026-10-03').outlier_status='one_off_event';
  const observation=run(d).observations[0];assert.equal(observation.trace.dates_used.length,25);
  assert.deepEqual(observation.trace.excluded.map(n=>n.reasons[0]),['holiday','early_close','excluded_outlier']);
  d.history.find(n=>n.business_date==='2026-10-04').source_covered=false;
  assert.equal(run(d).skipped[0].reason,'uncovered_open_night');
});
test('historical category count uses the removal date rather than today',()=>{
  const d=data();gap(d,'2026-10-10','2026-11-10');
  d.dishes[0].menu_created_at='2026-10-20T12:00:00Z';d.dishes[0].added_business_date='2026-10-20';
  d.availability[0].valid_from='2026-10-20';d.availability[0].is_initial=false;
  d.dishFacts=d.dishFacts.filter(f=>f.dish_id!==d.dishes[0].id||f.business_date>='2026-10-20');
  d.history.forEach(n=>{n.total_units=d.dishFacts.filter(f=>f.business_date===n.business_date).reduce((t,f)=>t+f.units,0);});
  const dish=run(d).dishes.find(x=>x.id===d.dishes[2].id);
  assert.equal(dish.is_returning,true);assert.equal(dish.last_season_category_count,2);
});

test('a persisted positive-sales inference remains visible after a POS mapping changes',()=>{
  const d=data();d.availability[2].valid_from='2026-09-10';d.availability[2].is_initial=true;
  d.availability[2].lifecycle_context={inferred_existing_from_prior_sales:true};
  const result=run(d),dish=result.dishes.find(x=>x.id===d.dishes[2].id);
  assert.equal(dish.is_new,false);assert.equal(dish.lifecycle_trace.inferred_existing_from_prior_sales,true);
});