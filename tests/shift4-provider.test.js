import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { buildHmacHeaders } from '../lib/pos/hmac-auth.js';
import { saveMenu } from '../lib/pos/saveMenu.js';

function fixture(responses, env={}) {
  const calls=[];
  const context={process:{env:{SHIFT4_CLIENT_ID:'client',SHIFT4_CLIENT_SECRET:'secret',
    SHIFT4_OAUTH_HOST:'https://oauth.example',SHIFT4_OAUTH_CLIENT_ID:'oauth-client',
    SHIFT4_OAUTH_CLIENT_SECRET:'oauth-secret',...env}},URL,URLSearchParams,Date,
    console:{log(){},warn(){}},setTimeout:(cb)=>cb(),buildHmacHeaders,
    fetch:async(url,options)=>{
      calls.push({url,options});const next=responses.shift();
      if(!next)throw new Error('Unexpected extra API call');
      return {ok:!next.status||next.status<400,status:next.status||200,
        headers:{get:()=>null},json:async()=>next.data};
    }};
  const source=readFileSync(new URL('../lib/pos/providers/shift4.js',import.meta.url),'utf8')
    .replace(/^import[^\n]+\n/gm,'').replace(/^export function /gm,'function ').replace('export default shift4;','globalThis.provider = shift4;');
  vm.runInNewContext(source,context);
  return {provider:context.provider,calls};
}
const ticket={posRef:'ticket-1',type:'sale',openedAt:'2026-11-17T01:00:00Z',closedAt:'2026-11-17T03:00:00Z',
  totalItems:2000,totalTax:200,totalGrand:2200,ticketItems:[{posRef:'line-1',itemRef:'burger',
    name:'Burger',quantity:2,unitPrice:1000,itemAmount:2000,type:'sale',ticketItemModifiers:[]}]};
const connection={shift4_location_id:10,shift4_timezone:'America/New_York'};
const range={from:'2026-11-16',to:'2026-11-16'};

test('installed locations follow every advertised page with fresh signed requests',async()=>{
  const f=fixture([{data:{results:[{id:10}],meta:{count:2}}},{data:{results:[{id:11}],meta:{count:2}}}]);
  const result=await f.provider.listInstalledLocations();
  assert.deepEqual(Array.from(result,r=>r.id),[10,11]);
  assert.equal(new URL(f.calls[1].url).searchParams.get('offset'),'1');
  assert.equal(f.calls[1].options.headers['x-access-key'],'client');
});
test('malformed collections and incomplete pagination fail closed',async()=>{
  for(const responses of [[{data:{}}],[{data:{results:null}}],
    [{data:{results:[{id:10}],meta:{count:2}}},{data:{results:[],meta:{count:2}}}],
    [{data:{results:[{id:10}],meta:{count:-1}}}]]){
    await assert.rejects(fixture(responses).provider.listInstalledLocations());
  }
});
test('duplicate or invalid location identities are rejected before reconciliation',async()=>{
  for(const results of [[{id:10},{id:10}],[{id:null}],[{name:'No identity'}]]){
    await assert.rejects(fixture([{data:{results}}]).provider.listInstalledLocations(),/location id/);
  }
});
test('invalid source time zones cannot silently fall back to a different business date',async()=>{
  await assert.rejects(fixture([{data:{results:[{id:10,timeZone:'Invalid/Zone'}]}}])
    .provider.listInstalledLocations(),/invalid location time zone/);
});
test('OAuth location pagination uses Bearer auth and retains eligibility flags',async()=>{
  const f=fixture([{data:{results:[{id:10,isAvailable:false,reason:'INSTALLED'}],meta:{count:2}}},
    {data:{results:[{id:11,isAvailable:true}],meta:{count:2}}}]);
  const rows=await f.provider.listLocations('merchant-token');
  assert.equal(rows[0].isAvailable,false);assert.equal(rows[1].isAvailable,true);
  assert.equal(f.calls[1].options.headers.Authorization,'Bearer merchant-token');
});
test('ticket pages are aggregated and dates use the location time zone',async()=>{
  const other={...ticket,posRef:'ticket-2',ticketItems:[{...ticket.ticketItems[0],posRef:'line-2'}]};
  const f=fixture([{data:{results:[ticket],meta:{count:2}}},{data:{results:[other],meta:{count:2}}}]);
  const result=await f.provider.fetchSalesAndTickets(connection,range);
  assert.equal(result.tickets.length,2);assert.equal(result.sales[0].sale_date,'2026-11-16');
  assert.equal(result.sales[0].quantity_sold,4);assert.equal(result.sales[0].revenue,40);
  assert.equal(result.tickets[0].total_grand,22);
});
test('duplicate ticket references cannot silently double-count sales',async()=>{
  const f=fixture([{data:{results:[ticket,ticket]}}]);
  await assert.rejects(f.provider.fetchSalesAndTickets(connection,range),/duplicate POS reference/);
});
test('voids are excluded from ordinary sales and refund amounts remain negative',async()=>{
  const t={...ticket,ticketItems:[{...ticket.ticketItems[0],type:'void',quantity:1},
    {...ticket.ticketItems[0],posRef:'refund',type:'refund',quantity:-1,itemAmount:-1000}]};
  const result=await fixture([{data:{results:[t]}}]).provider.fetchSalesAndTickets(connection,range);
  assert.equal(result.sales[0].quantity_sold,-1);assert.equal(result.sales[0].revenue,-10);
  assert.equal(result.sales[0].refunds,1);assert.equal(result.sales[0].voids,1);
});
test('enabled reference lookup preserves typed requests and their parent items',async()=>{
  const f=fixture([{data:{results:[ticket]}},{data:{results:[{posRef:'ticket-1',ticketItems:[
    {posRef:'line-1',specialRequests:['No onion'],ticketItemModifiers:[]}]}]}}],{SHIFT4_SPECIAL_REQUESTS_ENABLED:'true'});
  const result=await f.provider.fetchSalesAndTickets(connection,range);
  assert.equal(result.tickets[0].lines[0].special_requests[0],'No onion');
  assert.match(f.calls[1].url,/lookup\/tickets/);
});
test('missing lookup details surface an error instead of silently losing requests',async()=>{
  const f=fixture([{data:{results:[ticket]}},{data:{results:[]}}],{SHIFT4_SPECIAL_REQUESTS_ENABLED:'true'});
  await assert.rejects(f.provider.fetchSalesAndTickets(connection,range),/did not return ticket/);
});
test('rate limits are retried with a bounded number of requests',async()=>{
  const f=fixture([{status:429,data:{}},{data:{results:[{id:10}]}}]);
  assert.equal((await f.provider.listInstalledLocations()).length,1);assert.equal(f.calls.length,2);
  const exhausted=fixture(Array.from({length:3},()=>({status:429,data:{}})));
  await assert.rejects(exhausted.provider.listInstalledLocations());assert.equal(exhausted.calls.length,3);
});

test('malformed menus cannot mark previously saved items removed',async()=>{
  const db={from(){throw new Error('A malformed menu must not write or read the database');}};
  for(const menu of [{}, {categories:[],items:null,modifierSets:[],modifiers:[]},
    {categories:[],items:[{name:'No ref'}],modifierSets:[],modifiers:[]}]){
    await assert.rejects(saveMenu(db,{restaurantId:'r',posSystem:'shift4',menu}),/POS menu/);
  }
});
