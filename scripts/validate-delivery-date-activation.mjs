import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';

export async function prepareDeliveryDateActivation({ db, restaurantId, ownerId, fixtureName, today }) {
  const ref = 'hadinygxviofopdejwvj';
  assert.equal(db.supabaseUrl, `https://${ref}.supabase.co`);
  assert.match(fixtureName, /^Phase 6 staging [0-9a-f-]{36}$/);
  let url;
  try { url = new URL(process.env.OPTIMENU_TEST_DATABASE_URL); }
  catch { throw new Error('A valid OPTIMENU_TEST_DATABASE_URL is required.'); }
  const user = decodeURIComponent(url.username);
  const allowed = (url.hostname === `db.${ref}.supabase.co` && user === 'postgres') ||
    (url.hostname.endsWith('.pooler.supabase.com') && user === `postgres.${ref}`);
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol) && allowed,
    'Only the development PostgreSQL database is allowed.');
  assert.ok(['', '5432'].includes(url.port) && url.pathname === '/postgres' && url.password,
    'Use the development session pooler on port 5432 with a password.');
  const caFile = process.env.OPTIMENU_TEST_DATABASE_CA_FILE || url.searchParams.get('sslrootcert');
  url.search = '';
  const client = new pg.Client({ connectionString: url.toString(),
    ssl: { rejectUnauthorized: true,
      ...(caFile ? { ca: readFileSync(caFile, 'utf8') } : {}) },
    connectionTimeoutMillis: 10000, statement_timeout: 15000, query_timeout: 18000,
    application_name: 'optimenu-staging-delivery-activation' });
  const errors = [];
  client.on('error', error => errors.push(error));
  try {
    await client.connect();
    const identity = await client.query(`SELECT r.id FROM public.restaurants r
      JOIN public.profiles p ON p.id=r.user_id WHERE r.id=$1 AND r.user_id=$2
        AND r.name=$3 AND p.restaurant_id=r.id AND p.role='client'`,
    [restaurantId, ownerId, fixtureName]);
    assert.equal(identity.rowCount, 1, 'PostgreSQL fixture identity does not match the API fixture.');
    if (process.argv.includes('--apply-delivery-correction-migration')) {
      const migration = readFileSync(new URL(
        '../supabase/migrations/20261116143937_activate_delivery_date_corrections.sql', import.meta.url), 'utf8')
        .replace(/\r\n/g, '\n').trimEnd() + '\n';
      assert.equal(createHash('sha256').update(migration).digest('hex'),
        '3911f269af2f8d3d6c3f5bb1dbefaafdc0b863929bd9ef98a3ca5b7f20d0aca4');
      await client.query("SET lock_timeout = '5s'");
      await client.query(migration);
    }
    const definition = (await client.query(`SELECT pg_get_functiondef(
      'public.correct_invoice_delivery_date(uuid,uuid,uuid,date,date,boolean)'::regprocedure) AS definition`)).rows[0].definition;
    assert.match(definition, /ERRCODE = 'PT409'/);
    const permissions = (await client.query(`SELECT
      has_function_privilege('anon','public.correct_invoice_delivery_date(uuid,uuid,uuid,date,date,boolean)','EXECUTE') AS anon,
      has_function_privilege('authenticated','public.correct_invoice_delivery_date(uuid,uuid,uuid,date,date,boolean)','EXECUTE') AS authenticated,
      has_function_privilege('service_role','public.correct_invoice_delivery_date(uuid,uuid,uuid,date,date,boolean)','EXECUTE') AS service,
      has_table_privilege('service_role','public.invoice_delivery_date_audit','SELECT,INSERT') AS audit_read_insert,
      has_table_privilege('service_role','public.invoice_delivery_date_audit','UPDATE') AS audit_update,
      has_table_privilege('service_role','public.invoice_delivery_date_audit','DELETE') AS audit_delete`)).rows[0];
    assert.deepEqual(permissions, { anon: false, authenticated: false, service: true,
      audit_read_insert: true, audit_update: false, audit_delete: false });
    assert.equal(errors.length, 0);
  } finally {
    await client.end().catch(() => {});
  }
  let probe;
  const unknownInvoice = randomUUID();
  for (let attempt = 0; attempt < 20; attempt++) {
    probe = await db.rpc('correct_invoice_delivery_date', {
      p_restaurant_id: restaurantId, p_invoice_id: unknownInvoice, p_actor_id: ownerId,
      p_expected_delivery_date: null, p_delivery_date: today, p_queue_calculations: false,
    });
    if (probe.error?.code !== 'PGRST202') break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.equal(probe.error?.code, 'P0002', 'The correction RPC must be available through the Data API.');
  console.log('Development delivery-date migration and Data API verified.');
}

export async function validateDeliveryDateActivation(context) {
  const { db, restaurantId, ownerId, cedarId, today, future, baseline, incoming, late,
    processJobs, expectState, job, audits, pass } = context;
  assert.equal(db.supabaseUrl, 'https://hadinygxviofopdejwvj.supabase.co');
  const { createUpdateDeliveryDateHandler } = await import('../pages/api/invoices/update-delivery-date.js');
  const checked = result => {
    if (result.error) throw new Error(result.error.message);
    return result.data;
  };
  const originalLine = checked(await db.from('invoice_items').select('*')
    .eq('invoice_id', incoming.id).eq('id', incoming.lineId).single());
  const originalInvoice = checked(await db.from('invoices').select('date,amount')
    .eq('restaurant_id', restaurantId).eq('id', incoming.id).single());
  const originalAudits = await audits();
  const background = [];
  const outcomes = [];

  async function request(expected, next, options = {}) {
    const start = background.length;
    const firstOutcome = outcomes.length;
    const handler = createUpdateDeliveryDateHandler({
      db, isEnabled: () => options.enabled !== false,
      verifyAccess: async (req, rid) => rid === restaurantId
        ? { user: { id: ownerId } } : { error: 'Forbidden', status: 403 },
      processCalculations: async (database, rid) => {
        assert.equal(database, db);
        assert.equal(rid, restaurantId);
        const result = await processJobs(options.failPricing ? {
          reprice: async () => { throw new Error('Synthetic delivery-date pricing failure'); },
        } : {});
        outcomes.push(result);
        return result;
      },
      schedule: work => background.push(work),
    });
    const res = { statusCode: 200, setHeader() {},
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; }, end() { return this; } };
    await handler({ method: 'POST', body: { restaurant_id: options.restaurantId || restaurantId,
      invoice_id: incoming.id, expected_delivery_date: expected, delivery_date: next } }, res);
    await Promise.all(background.slice(start));
    const reports = outcomes.slice(firstOutcome);
    const queued = res.statusCode === 200 && res.body.calculations_queued;
    assert.equal(background.length - start, queued ? 1 : 0);
    assert.equal(reports.length, queued ? 1 : 0);
    for (const report of reports) {
      assert.equal(report.skipped, false);
      if (options.failPricing) {
        assert.ok(report.errors.some(message => message.includes('Synthetic delivery-date pricing failure')));
      } else assert.deepEqual(report.errors, []);
    }
    if (res.statusCode === 200 && res.body.changed) incoming.deliveryDate = next;
    return res;
  }

  const initialJob = await job();
  assert.equal((await request(today, future, { enabled: false })).statusCode, 503);
  assert.deepEqual(await job(), initialJob);
  assert.deepEqual(await audits(), originalAudits);
  pass('The disabled correction endpoint saves no date, audit, or calculation work.');

  let response = await request(today, future);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.changed, true);
  assert.equal(response.body.invoice.date, originalInvoice.date);
  await expectState(0.20, 0.40, [baseline, late]);
  pass('An owner API correction to a future delivery immediately recalculates current price, recipe cost, and stock.');

  const settled = await job();
  const savedAudits = await audits();
  response = await request(today, future);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.changed, false);
  assert.equal(response.body.calculations_queued, false);
  assert.deepEqual(await job(), settled);
  assert.deepEqual(await audits(), savedAudits);
  pass('An identical retry changes no audit or job and schedules no duplicate worker.');

  assert.equal((await request(today, today)).statusCode, 409);
  assert.deepEqual(await job(), settled);
  assert.deepEqual(await audits(), savedAudits);
  pass('A stale expected date returns HTTP 409 without a PostgREST serialization retry.');

  assert.equal((await request(future, today, { restaurantId: cedarId })).statusCode, 403);
  assert.deepEqual(await job(), settled);
  assert.deepEqual(await audits(), savedAudits);
  pass('A request for another restaurant cannot save or schedule financial work.');

  assert.equal((await request(future, today)).statusCode, 200);
  await expectState(0.25, 0.50, [baseline, incoming, late]);
  pass('Restoring delivery to today restores the eligible price, recipe cost, and physical stock.');

  response = await request(today, future, { failPricing: true });
  assert.equal(response.statusCode, 200);
  const pending = await job();
  assert.ok(BigInt(pending.completed_generation) < BigInt(pending.generation));
  assert.ok(pending.last_error.includes('Synthetic delivery-date pricing failure'));
  assert.equal(pending.lease_token, null);
  assert.deepEqual((await processJobs()).errors, []);
  await expectState(0.20, 0.40, [baseline, late]);
  pass('An immediate pricing failure preserves the saved date and durable job; a real retry completes recalculation.');

  assert.equal((await request(future, today)).statusCode, 200);
  await expectState(0.25, 0.50, [baseline, incoming, late]);
  assert.deepEqual(checked(await db.from('invoice_items').select('*')
    .eq('invoice_id', incoming.id).eq('id', incoming.lineId).single()), originalLine);
  assert.deepEqual(checked(await db.from('invoices').select('date,amount')
    .eq('restaurant_id', restaurantId).eq('id', incoming.id).single()), originalInvoice);
  const changes = (await audits()).filter(row => !originalAudits.some(old => old.id === row.id));
  assert.equal(changes.length, 4);
  assert.ok(changes.every(row => row.actor_id === ownerId && row.invoice_id === incoming.id &&
    row.original_invoice_date === originalInvoice.date));
  pass('The final API correction restores baseline state and preserves printed dates, source lines, and audit identity.');
}