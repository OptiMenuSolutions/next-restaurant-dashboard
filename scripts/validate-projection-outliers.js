import golden from '../tests/fixtures/projection-outliers-v4.js';
import { shiftProjectionDate } from '../lib/projections/businessTime.js';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { readProjectionOutliers, storeProjectionOutliers } from '../lib/projections/outlierStore.js';

// Disposable local PostgreSQL only. No .env or connected database is read.
const container=`optimenu-outliers-${randomUUID()}`;
const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const REST=id(1),OTHER=id(2);let started=false,DAY,TARGET,plan,initialCount;
const docker=(args,opts={})=>execFileSync('docker',args,{encoding:'utf8',timeout:60000,maxBuffer:32*1024*1024,
  stdio:['pipe','pipe','pipe'],...opts});
const args=['exec','-i',container,'psql','-X','-qAt','-U','postgres','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'];
const q=sql=>docker(args,{input:sql}).trim();
const json=value=>`'${JSON.stringify(value).replaceAll("'","''")}'::jsonb`;
const rejects=(sql,pattern)=>assert.throws(()=>q(sql),e=>pattern.test(e.stderr||e.message));
const snapshot=()=>new Date().toISOString();
const db={rpc:async(name,a)=>{
  try{
    if(name==='projection_prepare_calendar'){q(`set role service_role;select public.projection_prepare_calendar('${a.p_from}','${a.p_until}');`);return {data:null,error:null};}
    const sql=name==='projection_outlier_context'
      ? `select public.projection_outlier_context('${a.p_restaurant_id}','${a.p_as_of}','${a.p_snapshot_at}');`
      : name==='projection_store_outliers'
      ? `select public.projection_store_outliers('${a.p_restaurant_id}','${a.p_as_of}','${a.p_snapshot_at}','${a.p_context_digest}',${json(a.p_plan)});`
      : null;
    if(!sql)throw new Error('Unknown test RPC');
    return {data:JSON.parse(q(`set role service_role;${sql}`)),error:null};
  }catch(error){return {data:null,error:{message:error.stderr||error.message}};}
}};
const read=(snapshotAt=snapshot())=>readProjectionOutliers(db,{restaurantId:REST,asOf:DAY,snapshotAt});

before(async()=>{
  docker(['run','--detach','--name',container,'--read-only','--tmpfs','/var/lib/postgresql/data','--tmpfs','/var/run/postgresql',
    '--tmpfs','/tmp','-e',`POSTGRES_PASSWORD=${randomUUID()}`,'postgres:17']);started=true;
  let ready=false;for(let n=0;n<160;n++){try{docker(['exec',container,'pg_isready','-h','127.0.0.1','-U','postgres']);ready=true;break;}catch{await delay(250);}}
  assert.ok(ready,'Disposable PostgreSQL did not start');
  q(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create function auth.uid() returns uuid language sql stable as $$select null::uuid$$;
    grant usage on schema public,auth to service_role;grant execute on function auth.uid() to service_role;
    create table public.restaurants(id uuid primary key,user_id uuid,operational_timezone text,deactivated_at timestamptz,
      onboarding_completed_at timestamptz,name text);
    create table public.profiles(id uuid primary key,role text);
    create table public.menu_items(id uuid primary key,restaurant_id uuid references public.restaurants on delete cascade,
      created_at timestamptz not null default clock_timestamp(),archived_at timestamptz);
    create table public.pos_connections(id uuid primary key,restaurant_id uuid references public.restaurants on delete cascade,
      provider text,status text,shift4_timezone text);
    create table public.pos_tickets(id uuid primary key,restaurant_id uuid,pos_system text,ticket_type text,opened_at timestamptz,closed_at timestamptz);
    create table public.pos_ticket_lines(id uuid primary key,ticket_id uuid,restaurant_id uuid,item_ref text,line_type text,
      quantity numeric,is_non_sales_revenue boolean,added_at timestamptz);
    grant select on public.restaurants,public.profiles,public.menu_items,public.pos_connections,public.pos_tickets,public.pos_ticket_lines to service_role;
    create function public.purge_restaurant(target uuid) returns void language plpgsql security definer set search_path='' as $$begin
      delete from public.menu_items where restaurant_id=target;delete from public.pos_connections where restaurant_id=target;
      delete from public.restaurants where id=target;end$$;
    revoke all on function public.purge_restaurant(uuid) from public;grant execute on function public.purge_restaurant(uuid) to service_role;`);
  const lifecycleFiles=readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(name=>name.endsWith('_projection_dish_lifecycle.sql'));
  assert.equal(lifecycleFiles.length,1,'Exactly one lifecycle migration is required');
  const holidayFiles=readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(name=>name.endsWith('_projection_holiday_learning.sql'));
  assert.equal(holidayFiles.length,1);
  const outlierFiles=readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(name=>name.endsWith('_projection_outlier_runs.sql'));
  assert.equal(outlierFiles.length,1);
  for(const file of ['20261119222523_projection_foundation.sql','20261120142918_projection_ingestion.sql',
    '20261120171521_projection_calendar.sql',lifecycleFiles[0],holidayFiles[0],outlierFiles[0]]) {
    if(file===lifecycleFiles[0]) {
      q(`insert into public.restaurants values('${id(4)}',null,'America/New_York',null,null,'Preexisting');
        insert into public.menu_items(id,restaurant_id,created_at) values('${id(9)}','${id(4)}',clock_timestamp()-interval '20 days');`);
    }
    q(readFileSync(new URL(`../supabase/migrations/${file}`,import.meta.url),'utf8'));
  }
  DAY=golden.as_of;
  q(`insert into public.restaurants values('${REST}',null,'America/New_York',null,null,'Fixture'),
    ('${OTHER}',null,'Asia/Tokyo',null,null,'Other');
    insert into public.projection_restaurant_config(restaurant_id,first_data_date) values('${REST}','${golden.first}'),('${OTHER}','${golden.first}');
    insert into public.pos_connections values('${id(3)}','${REST}','shift4','connected','America/New_York');`);
  const units=golden.units.flat();
  q(`insert into public.projection_nightly_flags(restaurant_id,business_date,complete,total_units,source_revision) values `+
    units.map((total,i)=>`('${REST}','${shiftProjectionDate(golden.first,i)}',${!!(golden.flags[i+6]||[1])[0]},${total},'fixture:${i}')`).join(','));
  const context=await read(),settings=context.settings_snapshot;
  for(const [r,expected] of Object.entries(golden.forecasts)) {
    const date=shiftProjectionDate(golden.first,Number(r)-6),runId=id(10000+Number(r));
    q(`insert into public.projection_forecast_runs(id,restaurant_id,run_date,model_major,global_version_id,settings_snapshot,settings_digest,
      calibration_key,source_through,issued_at,trace) values('${runId}','${REST}','${date}',4,'${context.global_version_id}',${json(settings)},
      '${context.settings_digest}','${context.calibration_key}','${shiftProjectionDate(date,-1)}','${date}T06:00:00Z','{}');
      insert into public.projection_forecast_nights(restaurant_id,run_id,target_date,days_ahead,availability,expected,low,high,confidence,trace)
      values('${REST}','${runId}','${date}',1,'available',${expected},0,${expected},'Normal','{}');`);
  }

});
after(()=>{if(started)docker(['rm','--force','--volumes',container]);});

test('new outlier RPCs and direct final-decision writes are restricted to their writer',()=>{
  for(const role of ['anon','authenticated']) {
    rejects(`set role ${role};select public.projection_outlier_context('${REST}','${DAY}',now());`,/permission denied/);
    rejects(`set role ${role};select public.projection_store_outliers('${REST}','${DAY}',now(),'x','{}');`,/permission denied/);
  }
  rejects('set role service_role;insert into public.projection_run_decisions default values;',/permission denied/);
  rejects(`set role service_role;update public.projection_nightly_flags set outlier_status='active_run' where restaurant_id='${REST}';`,/projection_store_outliers|permission denied/);
  rejects(`update public.projection_nightly_flags set outlier_status='active_run' where restaurant_id='${REST}';`,/projection_store_outliers/);
});
test('real context produces the v4 one-off event and saves one permanent decision atomically',async()=>{
  plan=await read();assert.equal(plan.candidates.length,1);assert.equal(plan.candidates[0].decision,'one_off_event');
  const bad=structuredClone(plan);bad.nights.at(-1).restaurant_id=OTHER;
  await assert.rejects(()=>storeProjectionOutliers(db,bad),/Unrelated/);
  assert.equal(q(`select count(*) from public.projection_run_decisions where restaurant_id='${REST}';`),'0');
  const foreign=structuredClone(plan);foreign.candidates[0].trace.restaurant_id=OTHER;
  await assert.rejects(()=>storeProjectionOutliers(db,foreign),/Invalid final candidate/);
  const result=await storeProjectionOutliers(db,plan);assert.equal(result.saved,1);assert.ok(result.flags_changed>0);
  assert.equal(q(`select count(*) from public.projection_run_decisions where restaurant_id='${REST}';`),'1');
  assert.equal(q(`select count(*) from public.projection_run_decision_nights where restaurant_id='${REST}';`),'3');
});
test('an identical retry changes no decision, membership or nightly flag',async()=>{
  const result=await storeProjectionOutliers(db,plan);assert.equal(result.saved,0);assert.equal(result.flags_changed,0);assert.equal(result.retry,true);
  assert.equal((await read()).saved_reviews[0].diagnostics.length,0);
});
test('a corrected candidate retains the saved final decision and records disagreement',async()=>{
  q(`update public.projection_nightly_flags set total_units=10,source_revision='corrected' where restaurant_id='${REST}' and business_date='2026-11-05';`);
  const fresh=await read();assert.ok(fresh.saved_reviews[0].diagnostics.includes('saved_decision_retained_candidate_differs'));
  assert.equal((await storeProjectionOutliers(db,fresh)).saved,0);
  assert.equal(q(`select outlier_status from public.projection_nightly_flags where restaurant_id='${REST}' and business_date='2026-11-05';`),'one_off_event');
  assert.equal(q(`select count(*) from public.projection_run_decisions where restaurant_id='${REST}';`),'1');
});
test('a changed source rejects a stale plan and a foreign later flag rolls back earlier writes',async()=>{
  const old=await read();q(`update public.projection_nightly_flags set total_units=11 where restaurant_id='${REST}' and business_date='2026-11-05';`);
  await assert.rejects(()=>storeProjectionOutliers(db,old),/source changed/);
  const bad=structuredClone(await read());bad.nights.at(-1).restaurant_id=OTHER;
  const before=q(`select md5(string_agg(flags::text,'|' order by business_date)) from public.projection_nightly_flags where restaurant_id='${REST}';`);
  await assert.rejects(()=>storeProjectionOutliers(db,bad),/Unrelated/);
  assert.equal(q(`select md5(string_agg(flags::text,'|' order by business_date)) from public.projection_nightly_flags where restaurant_id='${REST}';`),before);
});
test('the membership primary key and append-only guards preserve permanent decisions',async()=>{
  const bad=structuredClone(await read());bad.candidates=[structuredClone(plan.candidates[0])];
  bad.candidates[0].trace.inputs_digest='a'.repeat(64);
  await assert.rejects(()=>storeProjectionOutliers(db,bad),/membership conflicts/);
  rejects(`update public.projection_run_decisions set decision='confirmed_shift' where restaurant_id='${REST}';`,/append.only|immutable/i);
  rejects(`insert into public.projection_run_decision_nights select * from public.projection_run_decision_nights where restaurant_id='${REST}';`,/duplicate key/);
});
test('parallel writers serialize one active replay and an unchanged retry',async()=>{
  const p=await read(),sql=`set role service_role;select public.projection_store_outliers('${REST}','${DAY}','${p.snapshot_at}',
    '${p.source_context_digest}',${json(p)});`;
  const execute=()=>new Promise((resolve,reject)=>{
    const child=spawn('docker',args,{stdio:['pipe','pipe','pipe']});let out='',err='';
    child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>err+=d);child.on('error',reject);
    child.on('close',code=>code===0?resolve(JSON.parse(out.trim())):reject(new Error(err)));child.stdin.end(sql);
  });
  const results=await Promise.all([execute(),execute()]);assert.equal(results.filter(r=>r.flags_changed>0).length,1);
  assert.equal(results.filter(r=>r.retry).length,1);assert.ok(results.every(r=>r.saved===0));
});
test('a historical write cannot overwrite a newer saved replay',async()=>{
  const p=await read(),older={...p,as_of:'2026-11-18'};
  await assert.rejects(()=>storeProjectionOutliers(db,older),/source changed|newer outlier/);
});
test('account purge deletes both decision tables while preserving another tenant',()=>{
  q(`set role service_role;select public.purge_restaurant('${REST}');`);
  assert.equal(q(`select count(*) from public.projection_run_decisions where restaurant_id='${REST}';`),'0');
  assert.equal(q(`select count(*) from public.projection_run_decision_nights where restaurant_id='${REST}';`),'0');
  assert.equal(q(`select count(*) from public.restaurants where id='${OTHER}';`),'1');
});