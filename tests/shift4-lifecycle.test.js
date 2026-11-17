import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { updateShift4Connection, disconnectedShift4State, saveShift4Sync } from '../lib/pos/shift4-state.js';
import { signRequest, verifyWebhook } from '../lib/pos/hmac-auth.js';

const clone=(value)=>structuredClone(value);
const base=()=>({id:'connection',restaurant_id:'restaurant',provider:'shift4',status:'connected',
  shift4_location_id:10,access_token:'old-access',refresh_token:'old-refresh',
  expires_at:'2000-01-01T00:00:00Z',shift4_timezone:'America/New_York'});
function database(connection=base()) {
  const state={connections:connection?[clone(connection)]:[],updates:[],rpc:[],failUpdate:null,rpcError:null};
  const db={auth:{getUser:async()=>({data:{user:{id:'owner'}},error:null})},from(table){
    let values=null,mode='read';const filters=[];
    const q={select(){return q;},eq(k,v){filters.push(r=>r[k]===v);return q;},
      is(k,v){filters.push(r=>r[k]==v);return q;},in(k,v){filters.push(r=>v.includes(r[k]));return q;},
      not(k,op,v){filters.push(r=>r[k]!=v);return q;},
      gte(){return q;},lte(){return q;},delete(){mode='delete';return q;},
      update(v){mode='update';values=v;return q;},insert(v){mode='insert';values=v;return q;},
      upsert(v){mode='upsert';values=v;return q;},
      async maybeSingle(){const r=await run();return {...r,data:r.data?.[0]||null};},
      async single(){const r=await run();return {...r,data:r.data?.[0]||null};},
      then(resolve,reject){return run().then(resolve,reject);}};
    async function run(){
      if(table==='profiles')return {data:[{restaurant_id:'restaurant'}],error:null};
      if(table==='restaurants')return {data:[],error:null};
      if(table==='pos_sales')return {data:[],error:null};
      assert.equal(table,'pos_connections','Unexpected write/read: '+table);
      const rows=state.connections.filter(r=>filters.every(f=>f(r)));
      if(mode==='update'){
        if(state.failUpdate?.(values))return {data:null,error:{message:'database unavailable'}};
        state.updates.push(clone(values));rows.forEach(r=>Object.assign(r,clone(values)));
      } else if(mode==='insert'||mode==='upsert'){
        if(rows.length&&mode==='insert')return {data:null,error:{message:'duplicate connection'}};
        if(rows.length)Object.assign(rows[0],clone(values));else state.connections.push({id:'new-connection',...clone(values)});
      }
      return {data:clone(rows),error:null};
    }
    return q;
  },async rpc(name,args){
    state.rpc.push({name,args:clone(args)});
    if(state.rpcError)return {data:null,error:{message:state.rpcError}};
    const c=state.connections[0];
    if(name==='update_shift4_connection'){
      const matches=c&&c.id===args.p_connection_id&&c.status===args.p_status
        &&(c.shift4_location_id??null)===args.p_location_id
        &&(c.access_token??null)===args.p_access_token&&(c.refresh_token??null)===args.p_refresh_token;
      if(!matches)return {data:false,error:null};
      if(state.failUpdate?.(args.p_changes))return {data:null,error:{message:'database unavailable'}};
      state.updates.push(clone(args.p_changes));Object.assign(c,clone(args.p_changes));
      return {data:true,error:null};
    }
    return {data:{saved:c?.status==='connected'&&c.shift4_location_id===args.p_location_id
      &&c.access_token===args.p_access_token,tickets:0,lines:0},error:null};
  }};
  return {db,state};
}
const env={CRON_SECRET:'cron',NEXT_PUBLIC_SUPABASE_URL:'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY:'service-key',SHIFT4_CLIENT_ID:'client',SHIFT4_CLIENT_SECRET:'secret',
  OAUTH_STATE_SECRET:'state-key',NEXT_PUBLIC_APP_URL:'https://app.example'};
function fixture(options={}){
  const {db,state}=database(options.connection===undefined?base():options.connection);
  const calls={refresh:0,fetch:0,install:0,remove:0,alerts:[],exchange:0};
  const provider={authType:'oauth2',
    async refresh(){calls.refresh++;return {accessToken:'new-access',refreshToken:'rotated-refresh',expiresAt:'2030-01-01T00:00:00Z'};},
    async fetchSalesAndTickets(){calls.fetch++;return {sales:[],tickets:[]};},
    async listLocations(){return [{id:10,name:'Test',isAvailable:true,timeZone:'America/Los_Angeles'}];},
    async listInstalledLocations(){return [];},
    async installLocation(){calls.install++;},async removeInstallation(){calls.remove++;},
    async exchangeCode(){calls.exchange++;return {accessToken:'new-access',refreshToken:'new-refresh',expiresAt:'2030-01-01T00:00:00Z',pendingLocation:true};},
    ...options.provider};
  const globals={createClient:()=>db,supabaseAdmin:db,shift4:provider,
    getProvider:()=>provider,getRestaurantIdForRequest:async()=> 'restaurant',
    getShift4Connection:async()=>clone(state.connections[0]||null),
    updateShift4Connection,disconnectedShift4State,saveShift4Sync,verifyWebhook,
    withJobRun:(_,h)=>h,sendCronAlert:async(...args)=>calls.alerts.push(args),
    saveTickets:async()=>({tickets:0,lines:0}),runUsage:async()=>({}),crypto};
  function route(path){
    const source=readFileSync(new URL('../'+path,import.meta.url),'utf8')
      .replace(/^import[\s\S]*?from\s+['"][^'"]+['"];\s*$/gm,'')
      .replace(/^export const /gm,'const ')
      .replace(/^export default /gm,'globalThis.testHandler = ');
    const context={...globals,process:{env},console:{log(){},warn(){},error(){}},
      Buffer,Date,URL,URLSearchParams,structuredClone,fetch:()=>{throw new Error('Unexpected network call');}};
    vm.runInNewContext(source,context,{filename:path});
    return context.testHandler;
  }
  async function run(path,request={}){
    const response={headers:{},status(n){this.code=n;return this;},json(body){this.body=body;return this;},
      setHeader(k,v){this.headers[k]=v;},redirect(url){this.url=url;return this;}};
    await route(path)({method:'GET',headers:{authorization:'Bearer cron'},query:{},body:{restaurantId:'restaurant'},...request},response);
    return response;
  }
  return {db,state,calls,provider,run};
}
const manual='pages/api/pos/sync.js';
const daily='pages/api/cron/sync-all-pos.js';
const refresh='pages/api/cron/refresh-shift4-tokens.js';
const reconcile='pages/api/cron/reconcile-shift4.js';
const disconnect='pages/api/pos/shift4/disconnect.js';
const install='pages/api/pos/shift4/install.js';

test('manual Shift4 sync does not refresh OAuth credentials or depend on an expired sign-in',async()=>{
  const f=fixture();const r=await f.run(manual,{method:'POST'});
  assert.equal(r.code,200);assert.equal(f.calls.refresh,0);assert.equal(f.state.rpc.filter(r=>r.name==='save_shift4_sync').length,1);
});
test('manual refresh for other OAuth providers saves rotated refresh credentials',async()=>{
  const f=fixture({connection:{...base(),provider:'square'}});
  const r=await f.run(manual,{method:'POST'});
  assert.equal(r.code,200);
  assert.equal(f.calls.refresh,1);
  assert.equal(f.state.connections[0].refresh_token,'rotated-refresh');
});
for(const path of [manual,daily]){
  test(path+' cannot restore an uninstall that finishes during a pull',async()=>{
    const f=fixture();f.provider.fetchSalesAndTickets=async()=>{
      Object.assign(f.state.connections[0],disconnectedShift4State());return {sales:[],tickets:[]};
    };
    const r=await f.run(path,{method:path===manual?'POST':'GET'});
    assert.equal(f.state.connections[0].status,'disconnected');
    assert.equal(f.state.connections[0].access_token,null);
    assert.equal(r.code,path===manual?409:200);
  });
  test(path+' records errors without disabling a valid HMAC connection',async()=>{
    const f=fixture();f.provider.fetchSalesAndTickets=async()=>{throw new Error('Shift4 unavailable');};
    await f.run(path,{method:path===manual?'POST':'GET'});
    assert.equal(f.state.connections[0].status,'connected');
    assert.equal(f.state.connections[0].last_error,'Shift4 unavailable');
  });
}
test('manual invalid date ranges are rejected before fetching or changing data',async()=>{
  const f=fixture();const r=await f.run(manual,{method:'POST',body:{restaurantId:'restaurant',from:'2026-02-30',to:'2026-03-01'}});
  assert.equal(r.code,400);assert.equal(f.calls.fetch,0);
});
test('manual persistence errors are surfaced instead of reporting a successful partial sync',async()=>{
  const f=fixture();f.state.rpcError='line insert failed';
  assert.equal((await f.run(manual,{method:'POST'})).code,502);
});
test('scheduled refresh persists rotated tokens and verifies the renewed Bearer token',async()=>{
  const f=fixture();let token;f.provider.listLocations=async(t)=>{token=t;return [];};
  const r=await f.run(refresh);assert.equal(r.code,200);assert.equal(token,'new-access');
  assert.equal(f.state.connections[0].refresh_token,'rotated-refresh');assert.equal(r.body.refreshed.length,1);
});
test('refresh completing after uninstall does not restore tokens',async()=>{
  const f=fixture();const original=f.provider.refresh;
  f.provider.refresh=async()=>{const t=await original();Object.assign(f.state.connections[0],disconnectedShift4State());return t;};
  await f.run(refresh);assert.equal(f.state.connections[0].access_token,null);assert.equal(f.state.connections[0].status,'disconnected');
});
test('failed verification after rotation records the error against the new credentials',async()=>{
  const f=fixture();f.provider.listLocations=async()=>{throw new Error('verification failed');};
  const r=await f.run(refresh);assert.equal(r.body.failed.length,1);
  assert.match(f.state.connections[0].token_error,/verification failed/);
});
test('refresh failures after a reconnect cannot overwrite the new connection error state',async()=>{
  const f=fixture();f.provider.refresh=async()=>{
    Object.assign(f.state.connections[0],{access_token:'reauthorized',refresh_token:'new-grant',token_error:null});
    throw new Error('old refresh rejected');
  };
  const r=await f.run(refresh);assert.equal(r.body.failed.length,0);assert.equal(f.state.connections[0].token_error,null);
});
test('missing refresh credentials are surfaced instead of silently omitted from the job',async()=>{
  const f=fixture({connection:{...base(),refresh_token:null}});f.provider.refresh=async()=>{throw new Error('No refresh token saved');};
  const r=await f.run(refresh);assert.equal(r.body.failed.length,1);assert.match(f.state.connections[0].token_error,/No refresh token/);
});
test('reconciliation removes credentials as well as active state',async()=>{
  const f=fixture();const r=await f.run(reconcile);
  assert.equal(r.code,200);assert.equal(f.state.connections[0].status,'disconnected');assert.equal(f.state.connections[0].refresh_token,null);
});
test('reconciliation cannot disconnect a new authorization created during the remote read',async()=>{
  const f=fixture();f.provider.listInstalledLocations=async()=>{
    Object.assign(f.state.connections[0],{access_token:'new-grant',refresh_token:'new-grant-refresh'});return [];
  };
  await f.run(reconcile);assert.equal(f.state.connections[0].status,'connected');
});
test('failed installed-location reads leave connection state untouched',async()=>{
  const f=fixture();f.provider.listInstalledLocations=async()=>{throw new Error('malformed collection');};
  assert.equal((await f.run(reconcile)).code,500);assert.equal(f.state.connections[0].status,'connected');
});
test('disconnect pauses sync before the API call and clears credentials after removal',async()=>{
  const f=fixture();f.provider.removeInstallation=async()=>{assert.equal(f.state.connections[0].status,'disconnecting');};
  const r=await f.run(disconnect,{method:'POST'});
  assert.equal(r.code,200);assert.equal(f.state.connections[0].status,'disconnected');assert.equal(f.state.connections[0].refresh_token,null);
});
test('ambiguous disconnect failure stays paused and can safely be retried',async()=>{
  const f=fixture();f.provider.removeInstallation=async()=>{throw new Error('network failed');};
  assert.equal((await f.run(disconnect,{method:'POST'})).code,502);assert.equal(f.state.connections[0].status,'disconnecting');
  f.provider.removeInstallation=async()=>{};
  assert.equal((await f.run(disconnect,{method:'POST'})).code,200);assert.equal(f.state.connections[0].status,'disconnected');
});
test('uninstall webhook completing during partner removal counts as success',async()=>{
  const f=fixture();f.provider.removeInstallation=async()=>Object.assign(f.state.connections[0],disconnectedShift4State());
  assert.equal((await f.run(disconnect,{method:'POST'})).code,200);
});
test('initial installation stores the correct location time zone before syncing',async()=>{
  const f=fixture({connection:{...base(),status:'pending',shift4_location_id:null}});
  assert.equal((await f.run(install,{method:'POST',body:{locationId:10}})).code,200);
  assert.equal(f.state.connections[0].shift4_timezone,'America/Los_Angeles');assert.equal(f.calls.install,1);
});
test('installation interrupted during local save is recoverable without a second remote install',async()=>{
  const f=fixture({connection:{...base(),status:'pending',shift4_location_id:null}});
  f.state.failUpdate=(v)=>v.status==='connected';
  assert.equal((await f.run(install,{method:'POST',body:{locationId:10}})).code,500);
  assert.equal(f.state.connections[0].status,'installing');
  f.state.failUpdate=null;f.provider.listLocations=async()=>[{id:10,name:'Test',isAvailable:false,reason:'INSTALLED',timeZone:'America/Los_Angeles'}];
  assert.equal((await f.run(install,{method:'POST',body:{locationId:10}})).code,200);
  assert.equal(f.calls.install,1);
});
test('unavailable locations cannot be installed by submitting an id directly',async()=>{
  const f=fixture({connection:{...base(),status:'pending',shift4_location_id:null}});
  f.provider.listLocations=async()=>[{id:10,isAvailable:false,reason:'INSTALLED'}];
  assert.equal((await f.run(install,{method:'POST',body:{locationId:10}})).code,400);assert.equal(f.calls.install,0);
});

function webhookRequest({signatureValid=true,location=10,name='marketplace.Location.deleted'}={}){
  const raw=JSON.stringify({event:{name},payload:{locationId:location}});
  const timestamp=Math.floor(Date.now()/1000);
  return {method:'POST',headers:{'x-access-key':'client','x-timestamp':String(timestamp),
    'x-signature':signatureValid?signRequest({clientId:'client',clientSecret:'secret',method:'POST',path:'/api/webhooks/shift4',body:raw,timestamp}):'invalid'},
    async *[Symbol.asyncIterator](){yield Buffer.from(raw);}};
}
const webhook='pages/api/webhooks/shift4.js';
test('authenticated merchant uninstall and repeat delivery leave a disconnected connection',async()=>{
  const f=fixture();assert.equal((await f.run(webhook,webhookRequest())).code,200);
  assert.equal(f.state.connections[0].status,'disconnected');assert.equal((await f.run(webhook,webhookRequest())).code,200);
});
test('a delayed uninstall notification cannot delete a currently reinstalled location',async()=>{
  const f=fixture();f.provider.listInstalledLocations=async()=>[{id:10}];
  assert.equal((await f.run(webhook,webhookRequest())).code,200);assert.equal(f.state.connections[0].status,'connected');
});
test('invalid webhook signatures and invalid location ids are rejected',async()=>{
  const f=fixture();assert.equal((await f.run(webhook,webhookRequest({signatureValid:false}))).code,401);
  assert.equal((await f.run(webhook,webhookRequest({location:null}))).code,400);assert.equal(f.state.connections[0].status,'connected');
});
test('failed webhook persistence returns non-2xx so delivery can be retried',async()=>{
  const f=fixture();f.state.failUpdate=()=>true;assert.equal((await f.run(webhook,webhookRequest())).code,500);
});
test('a refresh racing webhook processing requests redelivery rather than losing the uninstall',async()=>{
  const f=fixture();f.provider.listInstalledLocations=async()=>{
    f.state.connections[0].access_token='refreshed';return [];
  };
  assert.equal((await f.run(webhook,webhookRequest())).code,500);
  f.provider.listInstalledLocations=async()=>[];
  assert.equal((await f.run(webhook,webhookRequest())).code,200);
  assert.equal(f.state.connections[0].status,'disconnected');
});
test('legacy installation-request events do not provision accounts in the selected OAuth flow',async()=>{
  const f=fixture();assert.equal((await f.run(webhook,webhookRequest({name:'marketplace.InstallationRequest.created'}))).code,200);
  assert.equal(f.state.updates.length,0);
});
test('captured webhook signatures expire and malformed values never throw',()=>{
  const args={clientId:'client',clientSecret:'secret',path:'/api/webhooks/shift4',body:'{}',timestamp:Math.floor(Date.now()/1000)-3600};
  assert.equal(verifyWebhook({...args,signature:signRequest({...args,method:'POST'})}),false);
  assert.equal(verifyWebhook({...args,signature:'nope'}),false);
});

function oauthRequest(overrides={}){
  const payload={restaurantId:'restaurant',provider:'shift4',returnTo:'/client/profile',ts:Date.now(),nonce:'browser-nonce',...overrides};
  const data=Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig=crypto.createHmac('sha256',env.OAUTH_STATE_SECRET).update(data).digest('base64url');
  return {headers:{cookie:'pos_oauth_nonce=browser-nonce'},query:{code:'auth-code',state:`${data}.${sig}`}};
}
const callback='pages/api/pos/oauth-callback.js';
test('expired or different-browser OAuth callbacks do not exchange codes',async()=>{
  for(const override of [{ts:Date.now()-3600000},{nonce:'wrong-browser'}]){
    const f=fixture();assert.match((await f.run(callback,oauthRequest(override))).url,/pos=error/);assert.equal(f.calls.exchange,0);
  }
});
test('OAuth reconnect cannot overwrite a disconnect during token exchange',async()=>{
  const f=fixture();f.provider.exchangeCode=async()=>{
    Object.assign(f.state.connections[0],disconnectedShift4State());
    return {pendingLocation:true,accessToken:'new-access',refreshToken:'new-refresh'};
  };
  f.provider.listLocations=async()=>[{id:10,isAvailable:false,reason:'INSTALLED'}];
  assert.match((await f.run(callback,oauthRequest())).url,/pos=error/);assert.equal(f.state.connections[0].status,'disconnected');
});
test('first OAuth grant creates a pending connection and reaches the picker',async()=>{
  const f=fixture({connection:null});assert.match((await f.run(callback,oauthRequest())).url,/connect-shift4/);
  assert.equal(f.state.connections[0].status,'pending');
});
test('OAuth start cookie, callback and location install work together',async()=>{
  const f=fixture({connection:null});
  f.provider.getAuthUrl=({state})=>'https://oauth.example/?state='+encodeURIComponent(state);
  const start=await f.run('pages/api/pos/oauth-start.js',{method:'POST',body:{restaurantId:'restaurant',provider:'shift4'}});
  assert.equal(start.code,200);assert.match(start.headers['Set-Cookie'],/HttpOnly; Secure; SameSite=Lax/);
  const callbackResponse=await f.run(callback,{headers:{cookie:start.headers['Set-Cookie'].split(';')[0]},
    query:{code:'authorization-code',state:new URL(start.body.url).searchParams.get('state')}});
  assert.match(callbackResponse.url,/connect-shift4/);assert.equal(f.state.connections[0].status,'pending');
  const installed=await f.run(install,{method:'POST',body:{locationId:10}});
  assert.equal(installed.code,200);assert.equal(f.state.connections[0].status,'connected');
});
test('an interrupted install can reauthorize without losing its claimed location',async()=>{
  const f=fixture({connection:{...base(),status:'installing'}});
  f.provider.listLocations=async()=>[{id:10,isAvailable:false,reason:'INSTALLED'}];
  assert.match((await f.run(callback,oauthRequest())).url,/connect-shift4/);
  assert.equal(f.state.connections[0].status,'installing');assert.equal(f.state.connections[0].shift4_location_id,10);
});
