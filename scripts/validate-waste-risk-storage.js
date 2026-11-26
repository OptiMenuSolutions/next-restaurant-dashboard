// Disposable PostgreSQL only; no environment files or connected projects.
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
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
const rpcSql = (name,p) => name==='waste_projection_read'
  ? `public.waste_projection_read('${p.target}','${p.cutoff}',array[${p.batch_ids.map(x=>`'${x}'`).join(',')}]::uuid[],'${p.at_time}')`
  : `public.waste_projection_commit('${p.target}','${p.request_id}',${p.expected_version},${lit(p.snapshot)},${lit(p.outcome)},${p.correction?lit(p.correction):'null'})`;
const client={rpc:async(name,p)=>{
  try {
    return {data:JSON.parse(q(`set role service_role; select ${rpcSql(name,p)};`)),error:null};
  } catch(e) { return {data:null,error:{message:e.stderr||e.message,code:'DATABASE_ERROR'}}; }
}};
let input, plan, saved;

test('storage appends a settings version without changing calibration',()=>{
  const before=JSON.parse(q(`select settings from public.projection_setting_versions
    where restaurant_id is null order by effective_at desc offset 1 limit 1;`));
  const after=JSON.parse(q(`select settings from public.projection_setting_versions where restaurant_id is null order by effective_at desc limit 1;`));
  assert.equal(after.waste_recipe_uncovered_share_max,0.1);
  assert.equal(projectionCalibrationKey(4,before),projectionCalibrationKey(4,after));
  assert.equal(q(`select projection_private.check_settings((select settings from public.projection_setting_versions where restaurant_id is null order by effective_at limit 1));`),'t');
  assert.equal(q(`set role service_role;
    select projection_private.check_settings('{"waste_recipe_uncovered_share_max":0.1}',true);`),'t');
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
  assert.equal(q(`select count(*) from pg_class where relname like 'waste_projection_%' and relkind='r' and relrowsecurity;`),'6');
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

test('expiration preserves the compact result, audit, freezes and retry identity',async()=>{
  const before=read(input);
  const assessment=q(`select result from public.waste_projection_assessments where id='${saved.assessment_id}';`);
  const compact=JSON.parse(assessment);
  assert.ok(compact.items.length);
  assert.equal(compact.items[0].allocations,undefined);
  assert.equal(compact.demand_trace,undefined);
  assert.equal(q(`select p.expires_at=a.saved_at+interval '720 hours'
    from public.waste_projection_assessment_payloads p join public.waste_projection_assessments a on a.id=p.assessment_id
    where a.id='${saved.assessment_id}';`),'t');
  for(const role of ['anon','authenticated']) {
    bad(`set role ${role}; select public.waste_projection_expire_payloads();`,/permission denied/);
  }
  bad(`set role service_role; delete from public.waste_projection_assessment_payloads;`,/permission denied/);
  q(`update public.waste_projection_assessment_payloads set expires_at=clock_timestamp()-interval '1 second'
    where assessment_id='${saved.assessment_id}';`);
  assert.equal(q('set role service_role; select public.waste_projection_expire_payloads();'),'1');
  assert.equal(q('set role service_role; select public.waste_projection_expire_payloads();'),'0');
  assert.equal(q(`select result from public.waste_projection_assessments where id='${saved.assessment_id}';`),assessment);
  assert.deepEqual(read(input),before);
  assert.equal((await commitWasteRiskAssessment(client,plan)).duplicate,true);
  await assert.rejects(commitWasteRiskAssessment(client,{...plan,snapshot:{...plan.snapshot,batches:[]}}),/request changed/);
});

test('production-size read and both commits remain under one second',async t=>{
  const ingredients=Array.from({length:150},(_,n)=>({
    restaurant_id:REST,id:id(1000+n),name:`Ingredient ${n}`,unit:'lb',
  }));
  const batches=Array.from({length:400},(_,n)=>({
    ...input.batches[0],id:id(2000+n),ingredient_id:ingredients[n%150].id,
    remaining_qty:30,use_by_date:shift(input.assessmentDate,7),
  }));
  const dishes=[DISH,...Array.from({length:99},(_,n)=>id(3000+n))];
  q(`
    insert into public.projection_dishes(id,restaurant_id,style_category,forecastable)
      select d,'${REST}','Neutral',true from unnest(array[${dishes.slice(1).map(d=>`'${d}'`).join(',')}]::uuid[]) as d;
    insert into public.projection_forecast_dishes(restaurant_id,run_id,target_date,dish_id,share,expected,low,high,confidence,trace)
      select '${REST}','${RUN}',current_date+n,d.id,0.005,1,0,2,'low','{}'
      from generate_series(0,7)n cross join public.projection_dishes d where d.restaurant_id='${REST}' and d.id<>'${DISH}';
  `);
  const days=Array.from({length:8},(_,n)=>shift(input.assessmentDate,n));
  const fixture={...input,ingredients,batches,
    forecast:{...input.forecast,nights:days.map(business_date=>({
      business_date,availability:'available',low:12.34567890123456,
      dishes:dishes.map((dish_id,n)=>({dish_id,active:true,status:'ok',share:n===0?0.3333333333333333:0.005})),
    }))},
    recipes:days.flatMap(business_date=>dishes.map((dish_id,n)=>({
      restaurant_id:REST,business_date,dish_id,active:true,complete:true,
      portions:Array.from({length:6},(_,offset)=>({
        ingredient_id:ingredients[(n*6+offset)%150].id,quantity:0.125,unit:'lb',
      })),
    }))),
    assessedAt:new Date().toISOString(),
  };
  // Use a new tenant so the timed first commit has no prior waste state.
  const tenant=id(4000),run=id(4001);
  q(`
    insert into public.restaurants(id,user_id,name,operational_timezone) values('${tenant}','${OWNER}','Scaled waste fixture','UTC');
    insert into public.projection_restaurant_config(restaurant_id,enabled) values('${tenant}',true);
    insert into public.projection_dishes(id,restaurant_id,style_category,forecastable)
      select replace(id::text,'91000000','92000000')::uuid,'${tenant}',style_category,forecastable
      from public.projection_dishes where restaurant_id='${REST}';
    alter table public.projection_forecast_runs disable trigger user;
    alter table public.projection_forecast_nights disable trigger user;
    insert into public.projection_forecast_runs(id,restaurant_id,run_date,model_major,global_version_id,
      settings_snapshot,settings_digest,calibration_key,source_through,issued_at,trace)
    select case when n=0 then '${run}'::uuid else gen_random_uuid() end,'${tenant}',run_date-n,model_major,global_version_id,
      settings_snapshot,settings_digest,calibration_key,source_through-n,issued_at-n*interval '1 day',trace
      from public.projection_forecast_runs cross join generate_series(0,364)n where id='${RUN}';
    insert into public.projection_forecast_nights(restaurant_id,run_id,target_date,days_ahead,availability,expected,low,high,confidence,trace)
    select '${tenant}',r.id,r.run_date+n.days_ahead-1,n.days_ahead,n.availability,n.expected,n.low,n.high,n.confidence,n.trace
      from public.projection_forecast_runs r cross join public.projection_forecast_nights n
      where r.restaurant_id='${tenant}' and n.run_id='${RUN}';
    insert into public.projection_forecast_dishes(restaurant_id,run_id,target_date,dish_id,share,expected,low,high,confidence,trace)
    select '${tenant}',r.id,r.run_date+(d.target_date-current_date),replace(d.dish_id::text,'91000000','92000000')::uuid,
      d.share,d.expected,d.low,d.high,d.confidence,d.trace
      from public.projection_forecast_runs r cross join public.projection_forecast_dishes d
      where r.restaurant_id='${tenant}' and d.run_id='${RUN}';
    alter table public.projection_forecast_runs enable trigger user;
    alter table public.projection_forecast_nights enable trigger user;
    analyze public.projection_forecast_dishes;
    analyze public.projection_forecast_nights;
  `);
  fixture.restaurantId=tenant;
  fixture.forecast.id=run;
  fixture.forecast.restaurant_id=tenant;
  for(const row of [...ingredients,...batches,...fixture.recipes]) row.restaurant_id=tenant;
  for(const row of [...fixture.recipes,...fixture.forecast.nights.flatMap(n=>n.dishes)]) {
    row.dish_id=row.dish_id.replace('91000000','92000000');
  }
  const timed=(label,sql)=>{
    const milliseconds=Number(q(`set role service_role;
select clock_timestamp() as started \\gset
select ${sql} as result \\gset
select extract(epoch from clock_timestamp()-:'started'::timestamptz)*1000;`));
    t.diagnostic(`${label}: ${milliseconds.toFixed(1)} ms`);
    assert.ok(milliseconds>0 && milliseconds<1000,`${label} took ${milliseconds} ms`);
  };
  const first=await prepareWasteRiskAssessment(client,fixture,id(4002));
  assert.equal(first.outcome.new_demands.length,1200);
  assert.equal(first.outcome.new_cases.length,400);
  timed('First waste_projection_commit',rpcSql('waste_projection_commit',first));
  timed('Frozen waste_projection_read',rpcSql('waste_projection_read',{
    target:tenant,cutoff:fixture.inventoryCutoff,batch_ids:batches.map(b=>b.id),at_time:fixture.assessedAt,
  }));
  const later=await prepareWasteRiskAssessment(client,fixture,id(4003));
  assert.equal(later.outcome.new_demands.length,0);
  assert.equal(later.outcome.new_cases.length,0);
  timed('Unchanged waste_projection_commit',rpcSql('waste_projection_commit',later));
  t.diagnostic(q(`select format('Synthetic payload bytes (JSON text): input %s, full result %s, compact result %s',
    octet_length(p.input::text),octet_length(p.result::text),octet_length(a.result::text))
    from public.waste_projection_assessment_payloads p join public.waste_projection_assessments a on a.id=p.assessment_id
    where a.restaurant_id='${tenant}' and a.request_id='${id(4002)}';`));
});

test('daily jobs fence expired leases, persist one envelope, and commit once', async () => {
  q(`create table public.pos_usage_jobs(
      restaurant_id uuid primary key,generation bigint,applied_publication_id uuid
    );
    create table public.pos_usage_settings(restaurant_id uuid primary key,enabled boolean);
    insert into public.pos_usage_jobs values ('${REST}',9,'${id(80)}');
    insert into public.pos_usage_settings values ('${REST}',true);`);

  const day = input.assessmentDate;
  const asService = sql => q(`set role service_role; select ${sql};`);
  const claimSql = `public.waste_projection_daily_claim('${REST}','${day}')`;
  const claim = () => JSON.parse(asService(claimSql));

  for (const role of ['anon', 'authenticated']) {
    bad(`set role ${role}; select ${claimSql};`, /permission denied/);
  }

  q(`insert into projection_private.waste_daily_jobs(restaurant_id,assessment_date,timing)
    values ('${REST}','${day}',jsonb_build_object(
      'ready_at',clock_timestamp()-interval '5 minutes',
      'deadline_at',clock_timestamp()+interval '10 minutes',
      'sync_buffer_minutes',60
    ));`);

  let job = claim();
  assert.equal(job.status, 'pending');
  assert.equal(claim().status, 'busy');

  q(`update projection_private.waste_daily_jobs set lease_until = clock_timestamp()-interval '1 second'
    where id='${job.id}';`);
  bad(`set role service_role; select public.waste_projection_daily_commit('${job.id}','${job.lease_token}');`,
    /expired or superseded/);

  const token = asService(`public.pos_sync_acquire('${REST}')`);
  asService(`public.pos_sync_release('${REST}','${token}')`);

  job = claim();
  const checkpoint = `public.waste_projection_daily_checkpoint('${job.id}','${job.lease_token}'`;
  const evidence = {
    rawTicketsSaved: true,
    syncRevision: token,
    usageJob: { generation: 9, applied_publication_id: id(80) },
    rows: [],
    startedAt: new Date(Date.now() - 4000).toISOString(),
    finishedAt: new Date(Date.now() - 3000).toISOString(),
    inventoryStartedAt: new Date(Date.now() - 2000).toISOString(),
  };

  bad(`set role service_role; select ${checkpoint},${lit({ ...evidence, rawTicketsSaved: false })});`,
    /stale or incomplete/);
  assert.equal(JSON.parse(asService(`${checkpoint},${lit(evidence)})`)).status, 'ready');

  job = claim();
  assert.equal(job.forecast_run_id, RUN);
  assert.equal(job.fallback, false);

  const prepared = await prepareWasteRiskAssessment(
    client, { ...input, assessedAt: new Date().toISOString() }, id(81)
  );
  prepared.outcome = { ...prepared.outcome, forecast_fallback: false };

  const save = `public.waste_projection_daily_save('${job.id}','${job.lease_token}'`;
  asService(`${save},${lit(prepared)})`);
  asService(`${save},${lit(prepared)})`);
  bad(`set role service_role; select ${save},${lit({ ...prepared, request_id: id(82) })});`,
    /changed daily/);

  const result = JSON.parse(asService(
    `public.waste_projection_daily_commit('${job.id}','${job.lease_token}')`
  ));
  assert.equal(result.status, 'completed');
  assert.equal(claim().assessment_id, result.assessment_id);
  assert.equal(q(`select (envelope is null and receipt is null) from projection_private.waste_daily_jobs
    where id='${job.id}';`), 't');

  q(`update projection_private.waste_daily_jobs set status='ready', receipt=${lit(evidence)}, assessment_id=null
    where id='${job.id}';`);
  for (let attempt = 0; attempt < 4; attempt++) {
    job = claim();
    const stale = { ...prepared, request_id: id(83 + attempt), expected_version: -1 };
    asService(`public.waste_projection_daily_save('${job.id}','${job.lease_token}',${lit(stale)})`);
    const rejected = JSON.parse(asService(
      `public.waste_projection_daily_commit('${job.id}','${job.lease_token}')`
    ));
    assert.equal(rejected.error, 'PT409');
    assert.equal(rejected.recalculations, Math.min(attempt + 1, 3));
    assert.equal(rejected.status, attempt < 3 ? 'ready' : 'failed');
  }
  assert.equal(claim().status, 'failed');
});

test('a job without timely inventory is skipped and stays skipped', () => {
  const day = input.assessmentDate;
  q(`delete from projection_private.waste_daily_jobs where restaurant_id='${REST}';
    insert into projection_private.waste_daily_jobs(restaurant_id,assessment_date,timing)
    values ('${REST}','${day}',jsonb_build_object(
      'ready_at',clock_timestamp()-interval '5 minutes',
      'deadline_at',clock_timestamp()-interval '1 minute',
      'sync_buffer_minutes',60
    ));`);

  const sql = `set role service_role; select public.waste_projection_daily_claim('${REST}','${day}')->>'status';`;
  assert.equal(q(sql), 'skipped');
  assert.equal(q(sql), 'skipped');
});

test('POS sync leases serialize sessions and stale releases cannot clear a successor', async () => {
  const call = sql => q(`set role service_role; select ${sql};`);
  const acquire = `public.pos_sync_acquire('${REST}')`;
  const release = token => `public.pos_sync_release('${REST}','${token}')`;
  for (const role of ['anon', 'authenticated']) {
    bad(`set role ${role}; select ${acquire};`, /permission denied/);
    bad(`set role ${role}; select ${release(id(99))};`, /permission denied/);
  }

  const { localBin, localPsql, localDir, container } = projectionTestConnection();
  const args = localBin
    ? ['-h', localDir, '-p', '55462', '-XqAt', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1']
    : ['exec', container, 'psql', '-XqAt', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'];
  const claim = () => promisify(execFile)(
    localBin ? localPsql : 'docker',
    [...args, '-c', `set role service_role; select ${acquire};`],
    { encoding: 'utf8', timeout: 10000 }
  );
  const claims = (await Promise.all([claim(), claim()])).map(result => result.stdout.trim());
  const tokens = claims.filter(Boolean);
  assert.equal(tokens.length, 1);
  const original = tokens[0];

  assert.equal(q(`select expires_at > clock_timestamp() + interval '300 seconds'
    from projection_private.pos_sync_leases where restaurant_id='${REST}';`), 't');
  q(`update projection_private.pos_sync_leases set expires_at=clock_timestamp() - interval '1 second'
    where restaurant_id='${REST}';`);
  const successor = call(acquire);
  assert.notEqual(successor, original);
  assert.ok(successor);
  call(release(original));
  assert.equal(call(acquire), '');
  call(release(successor));

  // Leave a lease for the next test to verify the restaurant cascade.
  assert.ok(call(acquire));
});

test('history cannot be edited or deleted; account purge removes every tenant storage row',()=>{
  bad(`update public.waste_projection_demands set record='{}' where restaurant_id='${REST}';`,/append-only/);
  bad(`delete from public.waste_projection_cases where restaurant_id='${REST}';`,/append-only/);
  q(`select public.purge_restaurant('${REST}');`);
  assert.equal(q(`select count(*) from projection_private.pos_sync_leases where restaurant_id='${REST}';`), '0');
  assert.equal(q(`select count(*) from projection_private.waste_daily_jobs where restaurant_id='${REST}';`), '0');
  for(const t of ['state','corrections','assessments','assessment_payloads','cases','demands']) assert.equal(q(`select count(*) from public.waste_projection_${t} where restaurant_id='${REST}';`),'0');
  const counts=JSON.parse(q(`select deleted_rows from public.projection_account_purge_log order by purged_at desc limit 1;`));
  assert.ok(counts.waste_projection_demands>=4);
  assert.equal(counts.waste_daily_jobs, 1);
  assert.equal(counts.pos_sync_leases, 1);
});