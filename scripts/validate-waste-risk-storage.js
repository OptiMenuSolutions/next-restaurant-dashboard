// Disposable PostgreSQL only; no environment files or connected projects.
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { projectionTestSQL as q, projectionTestConnection } from './validate-projection-benchmarks.js';
import { prepareWasteRiskAssessment, commitWasteRiskAssessment } from '../lib/wasteRiskStorage.js';
import { assessProjectedWasteRisk } from '../lib/wasteRiskProjection.js';
import { projectionCalibrationKey } from '../lib/projections/settings.js';
import { shiftProjectionDate as shift } from '../lib/projections/businessTime.js';

const id = n => `91000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const REST=id(1), ING=id(2), DISH=id(3), BATCH=id(4), RUN=id(5), OWNER=id(6);
const lit = v => `'${JSON.stringify(v).replaceAll("'","''")}'::jsonb`;
const bad = (sql,re) => assert.throws(()=>q(sql),e=>re.test(e.stderr||e.message));
const read = i => JSON.parse(q(`set role service_role; select public.waste_projection_read(
  '${REST}','${i.inventoryCutoff}',array['${BATCH}']::uuid[],'${i.assessedAt}');`));
const client={rpc:async(name,p)=>{
  try {
    const sql=name==='waste_projection_read'
      ? `public.waste_projection_read('${p.target}','${p.cutoff}',array[${p.batch_ids.map(x=>`'${x}'`).join(',')}]::uuid[],'${p.at_time}')`
      : `public.waste_projection_commit('${p.target}','${p.request_id}',${p.expected_version},${lit(p.snapshot)},${lit(p.outcome)},${p.correction?lit(p.correction):'null'})`;
    return {data:JSON.parse(q(`set role service_role; select ${sql};`)),error:null};
  } catch(e) { return {data:null,error:{message:e.stderr||e.message,code:'DATABASE_ERROR'}}; }
}};
let input, plan, saved;

test('install storage after the full applied projection chain; append a version without changing calibration',()=>{
  const before=JSON.parse(q(`select settings from public.projection_setting_versions where restaurant_id is null order by effective_at desc limit 1;`));
  const files=readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(n=>n.endsWith('_projection_waste_risk_storage.sql'));
  assert.equal(files.length,1);
  q(readFileSync(new URL(`../supabase/migrations/${files[0]}`,import.meta.url),'utf8'));
  const after=JSON.parse(q(`select settings from public.projection_setting_versions where restaurant_id is null order by effective_at desc limit 1;`));
  assert.equal(after.waste_recipe_uncovered_share_max,0.1);
  assert.equal(projectionCalibrationKey(4,before),projectionCalibrationKey(4,after));
  assert.equal(q(`select projection_private.check_settings((select settings from public.projection_setting_versions where restaurant_id is null order by effective_at limit 1));`),'t');
  for(const value of ['null','"0.1"','-0.1','1.1']) assert.equal(q(`select projection_private.check_settings('{"waste_recipe_uncovered_share_max":${value}}',true);`),'f');
  q(`insert into public.restaurants(id,user_id,name,operational_timezone) values('${REST}','${OWNER}','Waste fixture','UTC');
    insert into public.projection_restaurant_config(restaurant_id,enabled) values('${REST}',true);
    insert into public.projection_setting_versions(restaurant_id,model_major,effective_at,settings) values('${REST}',4,clock_timestamp(),'{"business_day_cutoff_minutes":0}');
    insert into public.projection_dishes(id,restaurant_id,style_category,forecastable) values('${DISH}','${REST}','Neutral',true);
    alter table public.projection_forecast_runs disable trigger user;
    insert into public.projection_forecast_runs(id,restaurant_id,run_date,model_major,global_version_id,
      settings_snapshot,settings_digest,calibration_key,source_through,trace)
    select '${RUN}','${REST}',current_date,4,id,settings,repeat('a',64),'v4',current_date-1,'{}'
      from public.projection_setting_versions where restaurant_id is null order by effective_at desc limit 1;
    alter table public.projection_forecast_runs enable trigger user;
    alter table public.projection_forecast_nights disable trigger user;
    insert into public.projection_forecast_nights(restaurant_id,run_id,target_date,days_ahead,availability,expected,low,high,confidence,trace)
    select '${REST}','${RUN}',current_date+n,n+1,'available',20,12.34567890123456,30,'low','{}' from generate_series(0,7)n;
    alter table public.projection_forecast_nights enable trigger user;
    insert into public.projection_forecast_dishes(restaurant_id,run_id,target_date,dish_id,share,expected,low,high,confidence,trace)
    select '${REST}','${RUN}',current_date+n,'${DISH}',0.3333333333333333,20,0,30,'low','{}' from generate_series(0,7)n;`);
  const archive=JSON.parse(q(`select to_jsonb(r) from public.projection_forecast_runs r where id='${RUN}';`));
  const day=archive.run_date;
  input={restaurantId:REST,assessmentDate:day,assessedAt:new Date().toISOString(),inventoryCutoff:shift(day,-1),
    timeZone:'UTC',cutoffMinutes:0,inventoryComplete:true,
    ingredients:[{restaurant_id:REST,id:ING,name:'Chicken',unit:'lb'}],
    batches:[{restaurant_id:REST,id:BATCH,ingredient_id:ING,received_date:shift(day,-3),use_by_date:shift(day,2),remaining_qty:30,unit:'lb',unit_cost:4.5}],
    forecast:{id:RUN,restaurant_id:REST,run_date:day,issued_at:archive.issued_at,source_through:shift(day,-1),model_major:4,calibration_key:'v4',
      nights:Array.from({length:8},(_,n)=>({business_date:shift(day,n),availability:'available',low:12.34567890123456,
        dishes:[{dish_id:DISH,active:true,status:'ok',share:0.3333333333333333}]}))},
    recipes:Array.from({length:8},(_,n)=>({restaurant_id:REST,business_date:shift(day,n),dish_id:DISH,active:true,complete:true,
      portions:[{ingredient_id:ING,quantity:0.12345678901234566,unit:'lb'},{ingredient_id:ING,quantity:1e-7,unit:'lb'}]}))};
});

test('RLS and direct writes are blocked; only the service role can execute storage RPCs',()=>{
  assert.equal(q(`select count(*) from pg_class where relname like 'waste_projection_%' and relkind='r' and relrowsecurity;`),'5');
  for(const role of ['anon','authenticated']) bad(`set role ${role}; select public.waste_projection_read('${REST}',current_date-1,'{}',clock_timestamp());`,/permission denied/);
  bad(`set role service_role; insert into public.waste_projection_state values('${REST}',99,null,null);`,/permission denied/);
});

test('JSONB preserves frozen quantities, lows, shares, portions and digests exactly',async()=>{
  plan=await prepareWasteRiskAssessment(client,input,id(10));
  saved=await commitWasteRiskAssessment(client,plan);
  const restored=read(input);
  assert.deepEqual(restored.frozen,plan.outcome.frozen);
  const again=assessProjectedWasteRisk({...plan.snapshot,frozen:restored.frozen});
  assert.deepEqual(again.frozen,restored.frozen);
  for(const d of restored.frozen.demands) assert.equal(d.quantity,d.basis.night_low*d.basis.weighted_portion);
  assert.equal(q(`select count(*) from information_schema.columns where table_name in('waste_projection_demands','waste_projection_cases') and data_type='numeric';`),'0');
});

test('exact retries return the existing assessment and create no additional rows',async()=>{
  const retry=await commitWasteRiskAssessment(client,plan);
  assert.equal(retry.assessment_id,saved.assessment_id); assert.equal(retry.duplicate,true);
  assert.equal(q(`select count(*) from public.waste_projection_assessments where restaurant_id='${REST}';`),'1');
  await assert.rejects(commitWasteRiskAssessment(client,{...plan,snapshot:{...plan.snapshot,batches:[]}}),/request changed/);
});

test('a competing stale plan cannot replace the first freeze',async()=>{
  await assert.rejects(commitWasteRiskAssessment(client,{...plan,request_id:id(11)}),/state changed/);
  assert.deepEqual(read(input).frozen,plan.outcome.frozen);
});

test('a normal later assessment retains freezes even when the fresh forecast changes',async()=>{
  const changed=structuredClone(input); changed.forecast.nights.forEach(n=>n.low=1000);
  const p=await prepareWasteRiskAssessment(client,changed,id(12));
  assert.deepEqual(p.outcome.frozen,plan.outcome.frozen);
  await commitWasteRiskAssessment(client,p);
});

test('a tampered frozen quantity rejects atomically, without an assessment or counter change',async()=>{
  const p=await prepareWasteRiskAssessment(client,input,id(13));
  const altered=structuredClone(p); altered.outcome.frozen.demands[0].quantity+=1;
  await assert.rejects(commitWasteRiskAssessment(client,altered),/immutable/);
  assert.equal(read(input).version,2);
});

const correction=reason=>({id:id(20),restaurant_id:REST,actor_id:OWNER,reason,source_event_id:'fixture-event-1',
  batch_ids:[BATCH],ingredient_ids:[ING],business_dates:[input.assessmentDate],dish_ids:[DISH]});

test('a foreign actor cannot authorize a correction, and no audit is left behind',async()=>{
  const c=correction('physical_count');c.actor_id=id(999);
  const p=await prepareWasteRiskAssessment(client,input,id(14),c);
  await assert.rejects(commitWasteRiskAssessment(client,p),/Unauthorized/);
  assert.equal(q(`select count(*) from public.waste_projection_corrections where restaurant_id='${REST}';`),'0');
});

test('a physical count changes stock risk without replacing demand with the new forecast',async()=>{
  const changed=structuredClone(input);changed.batches[0].remaining_qty=6;
  changed.forecast.nights.forEach(n=>n.low=1000);
  const p=await prepareWasteRiskAssessment(client,changed,id(15),correction('physical_count'));
  assert.deepEqual(p.outcome.frozen.demands,plan.outcome.frozen.demands);
  await commitWasteRiskAssessment(client,p);
  assert.equal(q(`select count(*) from public.waste_projection_corrections where restaurant_id='${REST}';`),'1');
});

test('confirmed closure appends a scoped demand version while preserving the original',async()=>{
  const c=correction('confirmed_closure');c.id=id(21);
  const p=await prepareWasteRiskAssessment(client,input,id(16),c);
  await commitWasteRiskAssessment(client,p);
  assert.equal(read(input).frozen.demands[0].quantity,0);
  assert.equal(q(`select count(*) from public.waste_projection_demands where restaurant_id='${REST}' and business_date='${input.assessmentDate}';`),'2');
});

test('dish removal and a shelf-life extension append only the authorized changes',async()=>{
  const removal=correction('dish_removal');removal.id=id(22);removal.business_dates=[shift(input.assessmentDate,1)];
  const p=await prepareWasteRiskAssessment(client,input,id(18),removal);
  await commitWasteRiskAssessment(client,p);
  assert.equal(read(input).frozen.demands[1].quantity,0);
  const changed=structuredClone(input);changed.batches[0].use_by_date=shift(input.assessmentDate,3);
  const extension=correction('storage_or_shelf_life');extension.id=id(23);
  const extended=await prepareWasteRiskAssessment(client,changed,id(19),extension);
  await commitWasteRiskAssessment(client,extended);
  input=changed;
  const restored=read(input);
  assert.equal(restored.frozen.demands.length,4);
  assert.doesNotThrow(()=>assessProjectedWasteRisk({...extended.snapshot,frozen:restored.frozen}));
});

test('an authorized extension resumes later without authorizing a fresh baseline reset',async()=>{
  const changed=structuredClone(input);changed.batches[0].use_by_date=shift(input.assessmentDate,5);
  const missing={...changed,forecast:null,recipes:[]};
  const c=correction('storage_or_shelf_life');c.id=id(26);
  const pending=await prepareWasteRiskAssessment(client,missing,id(26),c);
  assert.equal(pending.outcome.items[0].status,'unavailable');
  await commitWasteRiskAssessment(client,pending);
  const resumed=await prepareWasteRiskAssessment(client,changed,id(27));
  assert.equal(resumed.outcome.new_demands.length,2);
  await commitWasteRiskAssessment(client,resumed);
  input=changed;
  assert.equal(read(input).frozen.cases[0].coverage_through,shift(input.assessmentDate,5));
});

test('disabled restaurants cannot save; a later-record failure rolls back all inserts',async()=>{
  const p=await prepareWasteRiskAssessment(client,input,id(17));
  q(`update public.projection_restaurant_config set enabled=false where restaurant_id='${REST}';`);
  await assert.rejects(commitWasteRiskAssessment(client,p),/disabled/);
  q(`update public.projection_restaurant_config set enabled=true where restaurant_id='${REST}';`);
  const c=correction('physical_count');c.id=id(24);
  const write=await prepareWasteRiskAssessment(client,input,id(25),c);
  const corrupted=structuredClone(write);
  const extra=structuredClone(corrupted.outcome.frozen.demands.at(-1));
  extra.business_date=shift(input.assessmentDate,6);extra.basis.run_id=id(999);
  corrupted.outcome.frozen.demands.push(extra);
  const version=read(input).version;
  const audits=q(`select count(*) from public.waste_projection_corrections where restaurant_id='${REST}';`);
  const cases=q(`select count(*) from public.waste_projection_cases where restaurant_id='${REST}';`);
  await assert.rejects(commitWasteRiskAssessment(client,corrupted),/provenance mismatch/);
  assert.equal(read(input).version,version);
  assert.equal(q(`select count(*) from public.waste_projection_corrections where restaurant_id='${REST}';`),audits);
  assert.equal(q(`select count(*) from public.waste_projection_cases where restaurant_id='${REST}';`),cases);
});

test('two independent database sessions race; one commits and the other must reload',async()=>{
  const fresh=structuredClone(input);fresh.batches.push({...fresh.batches[0],id:id(7),use_by_date:shift(input.assessmentDate,6)});
  const p=await prepareWasteRiskAssessment(client,fresh,id(30));
  const {localBin,localPsql,localDir,container}=projectionTestConnection();
  const invoke=async request=>{
    const sql=`set role service_role; select public.waste_projection_commit('${REST}','${request}',${p.expected_version},${lit(p.snapshot)},${lit(p.outcome)},null);`;
    const args=localBin?['-h',localDir,'-p','55462','-XqAt','-U','postgres','-v','ON_ERROR_STOP=1','-c',sql]
      :['exec',container,'psql','-XqAt','-U','postgres','-v','ON_ERROR_STOP=1','-c',sql];
    return promisify(execFile)(localBin?localPsql:'docker',args,{encoding:'utf8',timeout:30000});
  };
  const results=await Promise.allSettled([invoke(id(30)),invoke(id(31))]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.match(results.find(r=>r.status==='rejected').reason.stderr,/state changed/);
  assert.equal(read(input).version,p.expected_version+1);
  assert.equal(q(`select count(*) from public.waste_projection_demands where restaurant_id='${REST}' and business_date='${shift(input.assessmentDate,6)}';`),'1');
});

test('history cannot be edited or deleted; account purge removes every tenant storage row',()=>{
  bad(`update public.waste_projection_demands set record='{}' where restaurant_id='${REST}';`,/append-only/);
  bad(`delete from public.waste_projection_cases where restaurant_id='${REST}';`,/append-only/);
  q(`select public.purge_restaurant('${REST}');`);
  for(const t of ['state','corrections','assessments','cases','demands']) assert.equal(q(`select count(*) from public.waste_projection_${t} where restaurant_id='${REST}';`),'0');
  const counts=JSON.parse(q(`select deleted_rows from public.projection_account_purge_log order by purged_at desc limit 1;`));
  assert.ok(counts.waste_projection_demands>=4);
});