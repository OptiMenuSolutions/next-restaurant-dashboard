import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { readProjectionHolidays, storeProjectionHolidays } from '../lib/projections/holidayStore.js';

// Disposable local PostgreSQL only. No .env or connected database is read.
const container=`optimenu-holidays-${randomUUID()}`;
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
    const sql=name==='projection_holiday_context'
      ? `select public.projection_holiday_context('${a.p_restaurant_id}','${a.p_as_of}','${a.p_snapshot_at}');`
      : name==='projection_store_holidays'
      ? `select public.projection_store_holidays('${a.p_restaurant_id}','${a.p_as_of}','${a.p_snapshot_at}','${a.p_context_digest}',${json(a.p_plan)});`
      : null;
    if(!sql)throw new Error('Unknown test RPC');
    return {data:JSON.parse(q(`set role service_role;${sql}`)),error:null};
  }catch(error){return {data:null,error:{message:error.stderr||error.message}};}
}};
const read=(snapshotAt=snapshot())=>readProjectionHolidays(db,{restaurantId:REST,asOf:DAY,snapshotAt});

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
  for(const file of ['20261119222523_projection_foundation.sql','20261120142918_projection_ingestion.sql',
    '20261120171521_projection_calendar.sql',lifecycleFiles[0],holidayFiles[0]]) {
    if(file===lifecycleFiles[0]) {
      q(`insert into public.restaurants values('${id(4)}',null,'America/New_York',null,null,'Preexisting');
        insert into public.menu_items(id,restaurant_id,created_at) values('${id(9)}','${id(4)}',clock_timestamp()-interval '20 days');`);
    }
    q(readFileSync(new URL(`../supabase/migrations/${file}`,import.meta.url),'utf8'));
  }
  DAY=q(`select (projection_private.pos_source_clock('${REST}',null,clock_timestamp())->>'business_date');`);
  q(`insert into public.restaurants values('${REST}',null,'America/New_York',null,clock_timestamp()-interval '90 days','Fixture'),
    ('${OTHER}',null,'Asia/Tokyo',null,null,'Other');
    insert into public.projection_restaurant_config(restaurant_id,first_data_date) values('${REST}','${DAY}'::date-100),('${OTHER}','${DAY}'::date-100);
    insert into public.projection_style_categories values('Neutral','Neutral','{}');
    insert into public.pos_connections values('${id(3)}','${REST}','shift4','connected','America/New_York');
    insert into public.projection_nightly_flags(restaurant_id,business_date,complete,total_units,source_revision)
      select '${REST}',d::date,true,100,'fixture:'||d::date
      from generate_series('${DAY}'::date-100,'${DAY}'::date-1,interval '1 day') d;`);
  TARGET=q(`select max(holiday_date)::text from public.projection_holiday_calendar
    where holiday_date between '${DAY}'::date-72 and '${DAY}'::date-1;`);
  assert.ok(TARGET,'A recent complete holiday fixture is required');
});
after(()=>{if(started)docker(['rm','--force','--volumes',container]);});

test('new holiday RPCs are service-only and direct observation writes are blocked',()=>{
  for(const role of ['anon','authenticated']){
    rejects(`set role ${role};select public.projection_holiday_context('${REST}','${DAY}',now());`,/permission denied/);
    rejects(`set role ${role};select public.projection_store_holidays('${REST}','${DAY}',now(),'x','{}');`,/permission denied/);
  }
  rejects('set role service_role;insert into public.projection_holiday_observations default values;',/permission denied/);
});
test('the real context reconstructs a past holiday normal L and returns a verified forecast snapshot',async()=>{
  const result=await read();plan=result.learning;initialCount=plan.observations.length;
  const row=plan.observations.find(r=>r.business_date===TARGET);assert.ok(row);assert.equal(row.trace.L_source,'reconstructed');
  assert.ok(Math.abs(row.trace.normal_L-100)<1e-10);assert.equal(result.factors.nights.length,8);
  assert.ok(row.trace.source_dates.every(date=>date<TARGET));
});
test('a retry changes no observation and never creates a second original',async()=>{
  const first=await storeProjectionHolidays(db,plan);assert.equal(first.saved,initialCount);
  const retry=await storeProjectionHolidays(db,plan);assert.equal(retry.saved,0);assert.equal(retry.retry,true);
  assert.equal(q(`select count(*) from public.projection_holiday_observations where restaurant_id='${REST}'`),String(initialCount));
});
test('an archived day-of L replaces reconstruction and appends a correction',async()=>{
  const before=await read();
  const volume={business_date:TARGET,status:'ok',recent:{L:50,nights:[{business_date:q(`select ('${TARGET}'::date-7)::text;`)}]},
    provenance:{model_major:4,global_version_id:before.resolvedSettings.global_version_id}};
  q(`insert into public.projection_forecast_runs(id,restaurant_id,run_date,model_major,global_version_id,settings_snapshot,settings_digest,
      calibration_key,source_through,trace)
    select '${id(80)}','${REST}','${TARGET}',4,id,settings,'${before.resolvedSettings.settings_digest}',
      '${before.resolvedSettings.calibration_key}','${TARGET}'::date-1,'{}' from public.projection_setting_versions where id='${before.resolvedSettings.global_version_id}';
    insert into public.projection_forecast_nights(restaurant_id,run_id,target_date,days_ahead,availability,expected,low,high,confidence,trace)
      values('${REST}','${id(80)}','${TARGET}',1,'available',100,90,110,'Normal',${json({volume})});`);
  const result=await read(),row=result.learning.observations.find(r=>r.business_date===TARGET);
  assert.equal(row.trace.L_source,'archived');assert.equal(row.trace.normal_L,50);assert.equal(row.observed_ratio,2);
  assert.equal((await storeProjectionHolidays(db,result.learning)).saved,1);
  assert.equal(q(`select count(*) from public.projection_current_holiday_observations where restaurant_id='${REST}'`),String(initialCount));
  const historic=await read(before.learning.snapshot_at);
  assert.equal(historic.learning.observations.find(r=>r.business_date===TARGET).trace.L_source,'reconstructed');
});
test('a batch with a foreign later row rolls back its earlier correction',async()=>{
  const {learning}=await read(),bad=structuredClone(learning);
  bad.observations=bad.observations.filter(r=>r.business_date===TARGET);
  bad.observations[0].trace.inputs_digest='f'.repeat(64);
  bad.observations.push({...bad.observations[0],business_date:q(`select ('${TARGET}'::date-1)::text;`),restaurant_id:OTHER});
  const before=q(`select count(*) from public.projection_holiday_observations`);
  await assert.rejects(()=>storeProjectionHolidays(db,bad));assert.equal(q(`select count(*) from public.projection_holiday_observations`),before);
});
test('duplicate dates and forged archived provenance reject before a saved change',async()=>{
  const {learning}=await read(),bad=structuredClone(learning),row=bad.observations.find(r=>r.business_date===TARGET);
  bad.observations.push({...row});await assert.rejects(()=>storeProjectionHolidays(db,bad),/Duplicate/);
  bad.observations=[row];row.trace.archive_id=id(999);await assert.rejects(()=>storeProjectionHolidays(db,bad),/provenance/);
});
test('two independent PostgreSQL writers serialize one correction and one unchanged retry',async()=>{
  q(`update public.projection_nightly_flags set total_units=150 where restaurant_id='${REST}' and business_date='${TARGET}';`);
  const {learning}=await read();
  const sql=`set role service_role;select public.projection_store_holidays('${REST}','${DAY}','${learning.snapshot_at}',
    '${learning.source_context_digest}',${json(learning)});`;
  const execute=()=>new Promise((resolve,reject)=>{
    const child=spawn('docker',args,{stdio:['pipe','pipe','pipe']});let out='',err='';
    child.stdout.on('data',data=>out+=data);child.stderr.on('data',data=>err+=data);
    child.on('error',reject);child.on('close',code=>code===0?resolve(JSON.parse(out.trim())):reject(new Error(err)));child.stdin.end(sql);
  });
  const results=await Promise.all([execute(),execute()]);assert.deepEqual(results.map(r=>r.saved).sort(),[0,1]);
});
test('a changed source rejects a stale plan instead of saving its old ratio',async()=>{
  const {learning}=await read();
  q(`update public.projection_nightly_flags set total_units=200 where restaurant_id='${REST}' and business_date='${TARGET}';`);
  await assert.rejects(()=>storeProjectionHolidays(db,learning),/context changed/);
  const fresh=await read();assert.equal((await storeProjectionHolidays(db,fresh.learning)).saved,1);
});
test('a dated early-close answer corrects that date to the reserved key only',async()=>{
  q(`insert into public.projection_holiday_answer_versions(restaurant_id,business_date,revision,answer,actor_id)
    values('${REST}','${TARGET}',1,'early_close','${id(90)}');`);
  const result=await read(),row=result.learning.observations.find(r=>r.business_date===TARGET);
  assert.deepEqual(row.holiday_keys,['early_close']);assert.equal((await storeProjectionHolidays(db,result.learning)).saved,1);
  assert.equal(q(`select holiday_keys::text from public.projection_current_holiday_observations where restaurant_id='${REST}' and business_date='${TARGET}'`),'{early_close}');
});
test('an incomplete corrected source is excluded from factors while its immutable history survives',async()=>{
  const before=q(`select count(*) from public.projection_holiday_observations`);
  q(`update public.projection_nightly_flags set complete=false where restaurant_id='${REST}' and business_date='${TARGET}';`);
  const result=await read();assert.ok(result.factors.inputs.excludedDates.includes(TARGET));
  assert.equal(result.learning.skipped.find(r=>r.business_date===TARGET).reason,'incomplete');
  assert.equal((await storeProjectionHolidays(db,result.learning)).saved,0);
  assert.equal(q(`select count(*) from public.projection_holiday_observations`),before);
});
test('account purge removes holiday observations and archives while preserving another tenant',()=>{
  q(`insert into public.projection_holiday_observations(restaurant_id,business_date,holiday_keys,observed_ratio,trace)
    values('${OTHER}','${TARGET}',array['early_close'],0.6,'{}');`);
  const before=q(`select count(*) from public.projection_holiday_observations where restaurant_id='${REST}'`);
  q(`set role service_role;select public.purge_restaurant('${REST}');`);
  assert.equal(q(`select count(*) from public.projection_holiday_observations where restaurant_id='${REST}'`),'0');
  assert.equal(q(`select count(*) from public.projection_forecast_runs where restaurant_id='${REST}'`),'0');
  assert.equal(q(`select count(*) from public.projection_holiday_observations where restaurant_id='${OTHER}'`),'1');
  assert.equal(q(`select deleted_rows->>'projection_holiday_observations' from public.projection_account_purge_log order by purged_at desc limit 1`),before);
});