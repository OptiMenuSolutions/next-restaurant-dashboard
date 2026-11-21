import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { readProjectionLifecycle, storeProjectionLaunches } from '../lib/projections/lifecycleStore.js';

// Disposable local PostgreSQL only. No .env or connected database is read.
const container=`optimenu-lifecycle-${randomUUID()}`;
const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const REST=id(1),OTHER=id(2);let started=false,DAY,plan;
const docker=(args,opts={})=>execFileSync('docker',args,{encoding:'utf8',timeout:60000,maxBuffer:32*1024*1024,
  stdio:['pipe','pipe','pipe'],...opts});
const args=['exec','-i',container,'psql','-X','-qAt','-U','postgres','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'];
const q=sql=>docker(args,{input:sql}).trim();
const json=value=>`'${JSON.stringify(value).replaceAll("'","''")}'::jsonb`;
const rejects=(sql,pattern)=>assert.throws(()=>q(sql),e=>pattern.test(e.stderr||e.message));
const snapshot=()=>new Date().toISOString();
const context=(at=snapshot(),asOf=DAY,rid=REST)=>JSON.parse(q(`set role service_role;select public.projection_lifecycle_context('${rid}','${asOf}','${at}');`));
const db={rpc:async(name,a)=>{
  try {
    if(name==='projection_lifecycle_context')return {data:context(a.p_snapshot_at,a.p_as_of,a.p_restaurant_id),error:null};
    if(name==='projection_store_launches')return {data:JSON.parse(q(`set role service_role;select public.projection_store_launches(
      '${a.p_restaurant_id}','${a.p_as_of}','${a.p_snapshot_at}','${a.p_context_digest}',${json(a.p_plan)});`)),error:null};
    throw new Error('Unknown test RPC');
  }catch(error){return {data:null,error:{message:error.stderr||error.message}};}
}};
const read=()=>readProjectionLifecycle(db,{restaurantId:REST,asOf:DAY,snapshotAt:snapshot()});

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
  for(const file of ['20261119222523_projection_foundation.sql','20261120142918_projection_ingestion.sql',
    '20261120171521_projection_calendar.sql',lifecycleFiles[0]]) {
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
    insert into public.pos_connections values('${id(3)}','${REST}','shift4','connected','America/New_York');`);
});
after(()=>{if(started)docker(['rm','--force','--volumes',container]);});

test('migration adds only an approved major 4 settings version',()=>{
  const settings=JSON.parse(q('select projection_private.settings_template();'));assert.equal(settings.minimum_return_gap_days,28);
  assert.equal(q('select count(*) from public.projection_model_versions'),'1');
  assert.equal(q('select count(*) from public.projection_setting_versions'),'2');
  assert.equal(q('select bool_and(projection_private.check_settings(settings)) from public.projection_setting_versions'),'t');
  assert.equal(q('select bool_and(projection_private.check_settings(settings_template)) from public.projection_model_versions'),'t');
  assert.equal(q("select projection_private.check_settings('{\"minimum_return_gap_days\":0}',true)"),'f');
});
test('preexisting menu backfills with an unbounded initial window when no data date exists',()=>{
  assert.equal(q(`select count(*) from public.projection_dish_availability where dish_id='${id(9)}' and is_initial and valid_from is null`),'1');
  assert.equal(q(`select count(*) from public.projection_menu_repairs where restaurant_id='${id(4)}'`),'0');
});
test('frontend access is blocked and direct service-role launch insertion is revoked',()=>{
  for(const role of ['anon','authenticated']){
    rejects(`set role ${role};select * from public.projection_menu_repairs;`,/permission denied/);
    rejects(`set role ${role};select public.projection_lifecycle_context('${REST}','${DAY}',now());`,/permission denied/);
  }
  rejects('set role service_role;insert into public.projection_launch_history default values;',/permission denied/);
});

test('onboarding backfill and later onboarding batches are existing, with open-ended availability',()=>{
  q(`insert into public.menu_items(id,restaurant_id,created_at) values('${id(10)}','${OTHER}',clock_timestamp()-interval '50 days'),
    ('${id(11)}','${OTHER}',clock_timestamp()-interval '40 days');`);
  assert.equal(q(`select count(*) from public.projection_dish_availability where restaurant_id='${OTHER}' and is_initial and valid_from='${DAY}'::date-100`),'2');
  assert.equal(q(`select count(*) from public.projection_launch_history where restaurant_id='${OTHER}'`),'0');
});
test('menu source identity persists across an archive and a later return',()=>{
  q(`insert into public.menu_items(id,restaurant_id,created_at) values('${id(12)}','${OTHER}',clock_timestamp()-interval '50 days');
    update public.menu_items set archived_at=clock_timestamp()-interval '35 days' where id='${id(12)}';
    update public.menu_items set archived_at=null where id='${id(12)}';`);
  assert.equal(q(`select count(*) from public.projection_dishes where restaurant_id='${OTHER}' and menu_item_id='${id(12)}'`),'1');
  assert.equal(q(`select count(*) from public.projection_dish_availability where restaurant_id='${OTHER}' and dish_id='${id(12)}'`),'2');
});
test('an injected tracking failure saves the menu edit and every queued transition can be repaired',()=>{
  q(`create function public.fail_lifecycle_fixture() returns trigger language plpgsql as $$begin
      if new.dish_id='${id(13)}' then raise exception 'fixture window failure'; end if;return new;end$$;
    create trigger fixture_failure before insert on public.projection_dish_availability for each row execute function public.fail_lifecycle_fixture();
    insert into public.menu_items(id,restaurant_id,created_at) values('${id(13)}','${OTHER}',clock_timestamp()-interval '40 days');
    update public.menu_items set archived_at=clock_timestamp()-interval '7 days' where id='${id(13)}';
    update public.menu_items set archived_at=null where id='${id(13)}';`);
  assert.equal(q(`select count(*) from public.menu_items where id='${id(13)}'`),'1');
  assert.equal(q(`select count(*) from public.projection_menu_repairs where menu_item_id='${id(13)}'`),'3');
  q('drop trigger fixture_failure on public.projection_dish_availability;');
  const result=JSON.parse(q(`set role service_role;select public.projection_repair_menu('${OTHER}');`));
  assert.equal(result.repaired,3);assert.equal(result.pending,0);
  assert.equal(q(`select count(*) from public.projection_dish_availability where dish_id='${id(13)}'`),'2');
});
test('an initial dish archived before the first data date gets an empty window without a repair',()=>{
  q(`insert into public.menu_items(id,restaurant_id,created_at) values('${id(14)}','${OTHER}',clock_timestamp()-interval '140 days');
    update public.menu_items set archived_at=clock_timestamp()-interval '110 days' where id='${id(14)}';`);
  assert.equal(q(`select valid_from=valid_until and lifecycle_context->>'no_usable_availability'='true'
    from public.projection_dish_availability where dish_id='${id(14)}'`),'t');
  assert.equal(q(`select count(*) from public.projection_menu_repairs where menu_item_id='${id(14)}'`),'0');
});
test('replay continues past a stuck dish and preserves ordered events, age and attempt counts',async()=>{
  q(`create function public.fail_review_fixture() returns trigger language plpgsql as $$begin
      if new.dish_id in ('${id(15)}','${id(16)}') then raise exception 'review window failure';end if;return new;end$$;
    create trigger review_failure before insert on public.projection_dish_availability for each row execute function public.fail_review_fixture();
    insert into public.menu_items(id,restaurant_id,created_at) values('${id(15)}','${OTHER}',clock_timestamp()-interval '40 days'),
      ('${id(16)}','${OTHER}',clock_timestamp()-interval '20 days');
    update public.menu_items set archived_at=clock_timestamp()-interval '10 days' where id='${id(15)}';
    update public.projection_menu_repairs set first_failure_at=clock_timestamp()-interval '25 hours' where menu_item_id='${id(15)}';
    create or replace function public.fail_review_fixture() returns trigger language plpgsql as $$begin
      if new.dish_id='${id(15)}' then raise exception 'still stuck';end if;return new;end$$;`);
  const result=JSON.parse(q(`set role service_role;select public.projection_repair_menu('${OTHER}');`));
  assert.equal(result.repaired,1);assert.equal(result.pending,2);
  assert.equal(q(`select bool_and(attempt_count=2 and length(error_message)>0 and first_failure_at<clock_timestamp()-interval '24 hours')
    from public.projection_menu_repairs where menu_item_id='${id(15)}'`),'t');
  const ctx=context(snapshot(),DAY,OTHER);assert.equal(ctx.menu_repairs.length,2);
  const partial=await readProjectionLifecycle(db,{restaurantId:OTHER,asOf:DAY,snapshotAt:snapshot()});
  assert.equal(partial.dishes.find(d=>d.id===id(15)).lifecycle_unavailable,true);
  assert.equal(partial.dishes.find(d=>d.id===id(16)).lifecycle_unavailable,undefined);
  q('drop trigger review_failure on public.projection_dish_availability;');
  const retry=JSON.parse(q(`set role service_role;select public.projection_repair_menu('${OTHER}');`));
  assert.equal(retry.repaired,2);assert.equal(retry.pending,0);
});
test('a missing timezone and a deactivated restaurant never block menu edits',()=>{
  q(`update public.restaurants set operational_timezone=null,deactivated_at=clock_timestamp() where id='${OTHER}';
    update public.menu_items set archived_at=clock_timestamp() where id='${id(11)}';`);
  assert.equal(q(`select archived_at is not null from public.menu_items where id='${id(11)}'`),'t');
  assert.equal(q(`select lifecycle_context->>'fallback_used' from public.projection_dish_availability where dish_id='${id(11)}'`),'true');
  q(`update public.restaurants set operational_timezone='Asia/Tokyo',deactivated_at=null where id='${OTHER}';`);
});
test('the real context and pure planner produce a complete scoped launch',async()=>{
  q(`insert into public.menu_items(id,restaurant_id,created_at) values
    ('${id(20)}','${REST}',clock_timestamp()-interval '200 days'),
    ('${id(21)}','${REST}',clock_timestamp()-interval '200 days'),
    ('${id(22)}','${REST}',clock_timestamp()-interval '40 days');
    update public.projection_dishes set forecastable=true,style_category='Neutral' where restaurant_id='${REST}';
    insert into public.projection_nightly_flags(restaurant_id,business_date,complete,total_units,source_revision)
      select '${REST}',d::date,true,case when d::date<('${DAY}'::date-40) then 20 else 30 end,'fixture:'||d::date
      from generate_series('${DAY}'::date-100,'${DAY}'::date-1,interval '1 day') d;
    insert into public.projection_nightly_dish_facts(restaurant_id,business_date,dish_id,units,recommended,sold_out,source_revision)
      select '${REST}',n.business_date,d.id,10,false,false,n.source_revision from public.projection_nightly_flags n
      cross join public.projection_dishes d where n.restaurant_id='${REST}' and d.restaurant_id='${REST}'
      and (d.id<>'${id(22)}' or n.business_date>='${DAY}'::date-40);`);
  plan=await read();assert.equal(plan.observations.length,1);assert.equal(plan.observations[0].existing_dishes,2);
  assert.equal(plan.observations[0].launch_index,1);assert.equal(plan.observations[0].trace.dates_used.length,28);
});
test('same-digest retries create no second original or correction',async()=>{
  const first=await storeProjectionLaunches(db,plan);assert.equal(first.saved,1);
  const retry=await storeProjectionLaunches(db,plan);assert.equal(retry.saved,0);assert.equal(retry.retry,true);
  const reread=await read();assert.equal((await storeProjectionLaunches(db,reread)).saved,0);
  assert.equal(q(`select count(*) from public.projection_launch_history where restaurant_id='${REST}'`),'1');
});
test('source correction appends a version and the historical snapshot cannot see that new version',async()=>{
  const before=plan.snapshot_at;
  q(`update public.projection_nightly_dish_facts set units=20 where dish_id='${id(22)}' and business_date='${DAY}'::date-40;
    update public.projection_nightly_flags set total_units=40 where restaurant_id='${REST}' and business_date='${DAY}'::date-40;`);
  const corrected=await read();assert.equal((await storeProjectionLaunches(db,corrected)).saved,1);
  assert.equal(q(`select count(*) from public.projection_launch_history where restaurant_id='${REST}'`),'2');
  assert.equal(q(`select count(*) from public.projection_current_launch_history where restaurant_id='${REST}'`),'1');
  assert.equal(q(`select count(*) from public.projection_launch_history where restaurant_id='${REST}' and created_at<='${before}'`),'0');
  assert.equal(context().launch_history.length,2);
});
test('two PostgreSQL writers serialize one correction and one unchanged retry',async()=>{
  q(`update public.projection_nightly_dish_facts set recommended=true where dish_id='${id(22)}' and business_date='${DAY}'::date-38;`);
  const concurrent=await read();
  const sql=`set role service_role;select public.projection_store_launches('${REST}','${DAY}','${concurrent.snapshot_at}',
    '${concurrent.source_context_digest}',${json(concurrent)});`;
  const execute=()=>new Promise((resolve,reject)=>{
    const child=spawn('docker',args,{stdio:['pipe','pipe','pipe']});let out='',err='';
    child.stdout.on('data',chunk=>out+=chunk);child.stderr.on('data',chunk=>err+=chunk);
    child.on('error',reject);child.on('close',code=>code===0?resolve(JSON.parse(out.trim())):reject(new Error(err)));
    child.stdin.end(sql);
  });
  const results=await Promise.all([execute(),execute()]);
  assert.deepEqual(results.map(r=>r.saved).sort(),[0,1]);
  assert.equal(q(`select count(*) from public.projection_launch_history where restaurant_id='${REST}'`),'3');
  assert.equal((await read()).launch_history.length,3);
});
test('category edits after evidence are rejected instead of rewriting historical categories',()=>{
  q("insert into public.projection_style_categories values('Light/Fresh','Light/Fresh','{}');");
  rejects(`update public.projection_dishes set style_category='Light/Fresh' where id='${id(22)}';`,/Historical dish category/);
});
test('stale writes and duplicate or foreign observations reject atomically',async()=>{
  const fresh=await read();
  const malformed=structuredClone(fresh);malformed.observations[0].trace.inputs_digest='e'.repeat(64);malformed.observations.push({...malformed.observations[0],restaurant_id:OTHER,dish_id:id(12)});
  const count=q(`select count(*) from public.projection_launch_history`);
  await assert.rejects(()=>storeProjectionLaunches(db,malformed));
  assert.equal(q(`select count(*) from public.projection_launch_history`),count);
  const duplicate=structuredClone(fresh);duplicate.observations.push({...duplicate.observations[0]});
  await assert.rejects(()=>storeProjectionLaunches(db,duplicate),/Duplicate/);
  q(`update public.projection_nightly_dish_facts set recommended=true where restaurant_id='${REST}' and dish_id='${id(22)}' and business_date='${DAY}'::date-39;`);
  const stale=structuredClone(fresh);stale.observations[0].trace.inputs_digest='f'.repeat(64);
  await assert.rejects(()=>storeProjectionLaunches(db,stale),/context changed/);
});
test('prior mapped POS sales create an inferred existing origin without a new launch',async()=>{
  q(`insert into public.menu_items(id,restaurant_id,created_at) values('${id(23)}','${REST}',clock_timestamp()-interval '10 days');
    update public.projection_dishes set forecastable=true,style_category='Neutral' where id='${id(23)}';
    insert into public.projection_pos_item_map(restaurant_id,pos_system,external_item_id,dish_id,valid_from)
      values('${REST}','shift4','old-button','${id(23)}','${DAY}'::date-50);
    insert into public.pos_tickets values('${id(40)}','${REST}','shift4','closed',('${DAY}'::date-30)+time '12:00',('${DAY}'::date-30)+time '18:00');
    insert into public.pos_ticket_lines values('${id(41)}','${id(40)}','${REST}','old-button','sale',2,false,('${DAY}'::date-30)+time '15:00');`);
  const inferred=await read(),dish=inferred.dishes.find(d=>d.id===id(23));
  assert.equal(dish.lifecycle_trace.inferred_existing_from_prior_sales,true);assert.equal(dish.is_new,false);
  assert.equal(inferred.origin_corrections.length,1);
  const result=await storeProjectionLaunches(db,inferred);assert.equal(result.origin_corrections,1);
  assert.equal((await storeProjectionLaunches(db,inferred)).retry,true);
  assert.equal(q(`select valid_from='${DAY}'::date-30 and is_initial from public.projection_dish_availability where dish_id='${id(23)}'`),'t');
});
test('prior sales return one earliest eligible date per post-onboarding dish',()=>{
  q(`insert into public.pos_ticket_lines values('${id(42)}','${id(40)}','${REST}','old-button','sale',3,false,('${DAY}'::date-30)+time '15:30'),
    ('${id(43)}','${id(40)}','${REST}','old-button','sale',40,false,('${DAY}'::date-20)+time '15:00'),
    ('${id(44)}','${id(40)}','${REST}','old-button','sale',100,false,('${DAY}'::date-5)+time '15:00'),
    ('${id(45)}','${id(40)}','${REST}','old-button','refund',200,false,('${DAY}'::date-60)+time '15:00');
    insert into public.pos_ticket_lines(id,ticket_id,restaurant_id,item_ref,line_type,quantity,is_non_sales_revenue,added_at)
      select gen_random_uuid(),'${id(40)}','${REST}','old-button','sale',1,false,('${DAY}'::date-30)+time '16:00' from generate_series(1,10001);
    insert into public.projection_pos_item_map(restaurant_id,pos_system,external_item_id,dish_id,valid_from)
      values('${REST}','shift4','initial-button','${id(20)}','${DAY}'::date-100);
    insert into public.pos_ticket_lines values('${id(46)}','${id(40)}','${REST}','initial-button','sale',200,false,('${DAY}'::date-60)+time '15:00');`);
  const rows=context().prior_sales;assert.equal(rows.length,1);assert.equal(rows[0].dish_id,id(23));
  assert.equal(rows[0].units,10006);assert.equal(rows[0].business_date,q(`select ('${DAY}'::date-30)::text;`));
});
test('the scoped clock matches the source clock across an effective cutoff change',()=>{
  q(`insert into public.projection_setting_versions(restaurant_id,model_major,effective_at,settings)
      values('${REST}',4,(('${DAY}'::date+2)::timestamp at time zone 'America/New_York'),'{"business_day_cutoff_minutes":360}');
    insert into public.menu_items(id,restaurant_id,created_at) values('${id(24)}','${REST}',
      (('${DAY}'::date+4)+time '12:00') at time zone 'America/New_York');
    insert into public.projection_pos_item_map(restaurant_id,pos_system,external_item_id,dish_id,valid_from)
      values('${REST}','shift4','cutoff-button','${id(24)}','${DAY}'::date-100);
    insert into public.projection_nightly_flags(restaurant_id,business_date,complete,total_units,source_revision) values
      ('${REST}','${DAY}'::date+2,true,2,'cutoff-before'),('${REST}','${DAY}'::date+3,true,2,'cutoff-after');
    insert into public.pos_ticket_lines values('${id(47)}','${id(40)}','${REST}','cutoff-button','sale',2,false,
      (('${DAY}'::date+3)+time '05:00') at time zone 'America/New_York');`);
  const later=q(`select ('${DAY}'::date+5)::text;`);
  const row=context(`${later}T12:00:00Z`,later).prior_sales.find(r=>r.dish_id===id(24));assert.ok(row);
  const expected=q(`select projection_private.pos_source_clock('${REST}',null,
    (('${DAY}'::date+3)+time '05:00') at time zone 'America/New_York')->>'business_date';`);
  assert.equal(row.business_date,expected);assert.equal(row.business_date,q(`select ('${DAY}'::date+2)::text;`));
});
test('scoped sales match both DST transitions and ticket timestamp fallback',()=>{
  const rid=id(4);
  q(`update public.restaurants set onboarding_completed_at='2026-01-01T00:00:00Z' where id='${rid}';
    insert into public.projection_restaurant_config(restaurant_id,first_data_date) values('${rid}','2026-03-01');
    insert into public.pos_connections values('${id(60)}','${rid}','shift4','connected','America/New_York');
    insert into public.menu_items(id,restaurant_id,created_at) values('${id(50)}','${rid}','2026-11-10T12:00:00Z'),
      ('${id(51)}','${rid}','2026-11-10T12:00:00Z');
    insert into public.projection_pos_item_map(restaurant_id,pos_system,external_item_id,dish_id,valid_from) values
      ('${rid}','shift4','spring','${id(50)}','2026-03-01'),('${rid}','shift4','fall','${id(51)}','2026-03-01');
    insert into public.projection_nightly_flags(restaurant_id,business_date,complete,total_units,source_revision) values
      ('${rid}','2026-03-07',true,2,'spring'),('${rid}','2026-10-31',true,2,'fall');
    insert into public.pos_tickets values('${id(70)}','${rid}','shift4','closed','2026-03-08T06:00:00Z','2026-03-08T06:30:00Z'),
      ('${id(71)}','${rid}','shift4','closed','2026-11-01T05:00:00Z','2026-11-01T07:00:00Z');
    insert into public.pos_ticket_lines values('${id(72)}','${id(70)}','${rid}','spring','sale',1,false,null),
      ('${id(73)}','${id(70)}','${rid}','spring','sale',1,false,'2026-03-08T07:30:00Z'),
      ('${id(74)}','${id(71)}','${rid}','fall','sale',1,false,'2026-11-01T05:30:00Z'),
      ('${id(75)}','${id(71)}','${rid}','fall','sale',1,false,'2026-11-01T06:30:00Z');`);
  const rows=context(snapshot(),DAY,rid).prior_sales;assert.equal(rows.length,2);
  assert.equal(rows.find(r=>r.dish_id===id(50)).business_date,'2026-03-07');
  assert.equal(rows.find(r=>r.dish_id===id(51)).business_date,'2026-10-31');
  rows.forEach(r=>assert.equal(r.units,2));
});
test('POS mapping changes retain the projection dish and its launch versions',()=>{
  q(`insert into public.projection_pos_item_map(restaurant_id,pos_system,external_item_id,dish_id,valid_from)
    values('${REST}','shift4','replacement-button','${id(22)}','${DAY}'::date);`);
  assert.equal(q(`select count(*) from public.projection_dishes where menu_item_id='${id(22)}'`),'1');
  assert.equal(q(`select count(*) from public.projection_launch_history where dish_id='${id(22)}'`),'3');
});
test('account purge removes the new tables and retains the anonymous row-count log',()=>{
  q(`set role service_role;select public.purge_restaurant('${OTHER}');`);
  for(const table of ['projection_menu_events','projection_menu_repairs','projection_dish_availability','projection_dishes']) {
    assert.equal(q(`select count(*) from public.${table} where restaurant_id='${OTHER}'`),'0');
  }
  const counts=JSON.parse(q("select deleted_rows from public.projection_account_purge_log order by purged_at desc limit 1;"));
  assert.ok(Object.hasOwn(counts,'projection_menu_events'));assert.ok(Object.hasOwn(counts,'projection_menu_repairs'));
});