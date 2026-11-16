import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';

export async function validateInvoiceReview(context) {
  const { db, restaurantId, ownerId, fixtureName, cedarId, invoiceIds,
    baseline, incoming, late, expectState, pass } = context;
  const ref = 'hadinygxviofopdejwvj';
  assert.equal(db.supabaseUrl, `https://${ref}.supabase.co`);
  assert.match(fixtureName, /^Phase 6 staging [0-9a-f-]{36}$/);
  assert.match(incoming.id, /^[0-9a-f-]{36}$/);
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
    application_name: 'optimenu-staging-invoice-review' });
  const connectionErrors = [];
  client.on('error', error => connectionErrors.push(error));
  let active = false;
  let wrongRestaurant = false;
  let rpcCalls = 0;
  let lastError;

  async function state() {
    const tables = ['invoices', 'ingredients', 'menu_items', 'current_inventory',
      'menu_item_cost_history', 'invoice_supported_price_evidence', 'invoice_match_decision_audit'];
    const sections = tables.map(table => `(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb)
      FROM public.${table} t WHERE restaurant_id=ANY($1::uuid[])) AS ${table}`);
    return (await client.query(`SELECT ${sections.join(',')},
      (SELECT to_jsonb(p) FROM public.profiles p WHERE id=$2::uuid) AS profile,
      (SELECT coalesce(jsonb_agg(to_jsonb(j) ORDER BY restaurant_id), '[]'::jsonb)
       FROM public.invoice_calculation_jobs j WHERE restaurant_id=ANY($1::uuid[])) AS jobs,
      (SELECT coalesce(jsonb_agg(to_jsonb(ii) ORDER BY id), '[]'::jsonb)
       FROM public.invoice_items ii WHERE invoice_id=ANY($3::uuid[])) AS lines`,
    [[restaurantId, cedarId], ownerId, invoiceIds])).rows[0];
  }

  const adapter = {
    from: (...args) => db.from(...args),
    async rpc(name, args) {
      assert.equal(active, true, 'Review test writes require a rollback-only transaction.');
      assert.equal(name, 'mark_invoice_reviewed_transactional');
      assert.equal(args.p_invoice_id, incoming.id);
      assert.equal(args.p_admin_id, ownerId);
      rpcCalls++;
      await client.query('SAVEPOINT review_request');
      try {
        const result = await client.query(`SELECT public.mark_invoice_reviewed_transactional(
          $1::uuid,$2::uuid,$3::uuid) AS result`,
        [wrongRestaurant ? cedarId : args.p_restaurant_id, args.p_invoice_id, args.p_admin_id]);
        await client.query('RELEASE SAVEPOINT review_request');
        return { data: result.rows[0].result, error: null };
      } catch (error) {
        await client.query('ROLLBACK TO SAVEPOINT review_request');
        await client.query('RELEASE SAVEPOINT review_request');
        lastError = error;
        return { data: null, error };
      }
    },
  };

  try {
    await client.connect();
    const identity = await client.query(`SELECT r.id FROM public.restaurants r
      JOIN public.profiles p ON p.id=r.user_id WHERE r.id=$1 AND r.user_id=$2
        AND r.name=$3 AND p.restaurant_id=r.id AND p.role='client'`,
    [restaurantId, ownerId, fixtureName]);
    assert.equal(identity.rowCount, 1, 'PostgreSQL fixture identity does not match the API fixture.');
    if (process.argv.includes('--apply-review-migration')) {
      const migration = readFileSync(new URL(
        '../supabase/migrations/20261116140231_atomic_invoice_review.sql', import.meta.url), 'utf8')
        .replace(/\r\n/g, '\n').trimEnd() + '\n';
      assert.equal(createHash('sha256').update(migration).digest('hex'),
        'aa904afec106b00e03c40a99d2add5b111486352a5ff43c2349e85620f959566');
      await client.query("SET lock_timeout = '5s'");
      await client.query(migration);
    }
    const grants = (await client.query(`SELECT
      has_function_privilege('anon','public.mark_invoice_reviewed_transactional(uuid,uuid,uuid)','EXECUTE') AS anon,
      has_function_privilege('authenticated','public.mark_invoice_reviewed_transactional(uuid,uuid,uuid)','EXECUTE') AS authenticated,
      has_function_privilege('service_role','public.mark_invoice_reviewed_transactional(uuid,uuid,uuid)','EXECUTE') AS service`)).rows[0];
    assert.deepEqual(grants, { anon: false, authenticated: false, service: true });
    let probe;
    for (let attempt = 0; attempt < 20; attempt++) {
      probe = await db.rpc('mark_invoice_reviewed_transactional', {
        p_restaurant_id: restaurantId, p_invoice_id: incoming.id, p_admin_id: ownerId,
      });
      if (probe.error?.code !== 'PGRST202') break;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.equal(probe.error?.code, '42501', 'The Data API must expose the RPC and reject the client reviewer.');
    pass('The development review function is installed and callable only by the server role.');

    const { createMarkInvoiceReviewedHandler } =
      await import('../pages/api/admin/invoice-review/mark-reviewed.js');
    const handler = createMarkInvoiceReviewedHandler({ db: adapter });
    async function request(body = { invoice_id: incoming.id }, session = {
      user: { id: ownerId }, profile: { role: 'admin' },
    }, method = 'POST') {
      const res = { statusCode: 200, setHeader() {},
        status(code) { this.statusCode = code; return this; },
        json(value) { this.body = value; return this; }, end() { return this; } };
      await handler({ method, body }, res, session);
      return res;
    }
    const original = await state();
    async function rolledBack(work, admin = true) {
      await client.query('BEGIN');
      active = true;
      try {
        await client.query("SET LOCAL idle_in_transaction_session_timeout = '30s'");
        if (admin) {
          const result = await client.query(`UPDATE public.profiles SET role='admin'
            WHERE id=$1 AND restaurant_id=$2 AND role='client'`, [ownerId, restaurantId]);
          assert.equal(result.rowCount, 1);
        }
        await work();
      } finally {
        await client.query('ROLLBACK');
        active = false;
        wrongRestaurant = false;
      }
      assert.deepEqual(await state(), original);
    }

    assert.equal((await request(undefined, null)).statusCode, 403);
    assert.equal((await request({}, undefined, 'GET')).statusCode, 405);
    assert.equal((await request({ invoice_id: 'bad' })).statusCode, 400);
    assert.equal((await request({ invoice_id: incoming.id, reviewed_by: ownerId })).statusCode, 400);
    assert.equal((await request({ invoice_id: randomUUID() })).statusCode, 404);
    assert.equal(rpcCalls, 0);
    assert.deepEqual(await state(), original);
    pass('Invalid requests, missing sessions, and missing invoices perform no review writes.');

    await rolledBack(async () => {
      const before = await state();
      assert.equal((await request()).statusCode, 403);
      assert.equal(lastError.code, '42501');
      assert.deepEqual(await state(), before);
    }, false);
    pass('The database independently rejects a non-administrator reviewer.');

    await rolledBack(async () => {
      wrongRestaurant = true;
      const before = await state();
      assert.equal((await request()).statusCode, 404);
      assert.equal(lastError.code, 'P0002');
      assert.deepEqual(await state(), before);
    });
    pass('A mismatched restaurant cannot mark an invoice or its lines reviewed.');

    async function extraLines() {
      await client.query(`INSERT INTO public.invoice_items
        (id,invoice_id,item_name,quantity,unit,unit_cost,amount,reviewed)
        VALUES ($1,$3,'Review test',1,'each',1,1,false),($2,$3,'Already reviewed',1,'each',1,1,true)`,
      [randomUUID(), randomUUID(), incoming.id]);
    }
    await rolledBack(async () => {
      await extraLines();
      const before = await state();
      const res = await request();
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.reviewed_by, ownerId);
      assert.equal(res.body.reviewed_lines, 2);
      assert.equal(res.body.changed, true);
      const expected = { ...before,
        invoices: before.invoices.map(row => row.id === incoming.id ? { ...row,
          reviewed: true, reviewed_by: ownerId, reviewed_at: res.body.reviewed_at } : row),
        lines: before.lines.map(row => row.invoice_id === incoming.id ? { ...row, reviewed: true } : row) };
      assert.deepEqual(await state(), expected);
      pass('The real handler marks all invoice lines and records the session reviewer without changing financial data.');
      const replay = await request();
      assert.equal(replay.statusCode, 200);
      assert.equal(replay.body.changed, false);
      assert.equal(replay.body.reviewed_lines, 0);
      assert.equal(replay.body.reviewed_at, res.body.reviewed_at);
      assert.deepEqual(await state(), expected);
      pass('Repeating review preserves the first reviewer, timestamp, and all financial state.');
    });

    await rolledBack(async () => {
      await extraLines();
      // This test-only trigger fails the second write and disappears on rollback.
      await client.query(`CREATE FUNCTION pg_temp.phase6_review_failure() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic invoice review failure'; END; $$`);
      await client.query(`CREATE TRIGGER phase6_review_failure BEFORE UPDATE OF reviewed
        ON public.invoices FOR EACH ROW WHEN (NEW.id='${incoming.id}'::uuid)
        EXECUTE FUNCTION pg_temp.phase6_review_failure()`);
      const before = await state();
      assert.equal((await request()).statusCode, 500);
      assert.match(lastError.message, /Synthetic invoice review failure/);
      assert.deepEqual(await state(), before);
    });
    pass('An invoice-write failure rolls back every line flag; no partial review survives.');

    assert.deepEqual(await state(), original);
    await expectState(0.25, 0.50, [baseline, incoming, late]);
    assert.equal(connectionErrors.length, 0);
    pass('All review transactions and temporary role changes are rolled back; original data remains intact.');
  } finally {
    if (active) await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  }
}