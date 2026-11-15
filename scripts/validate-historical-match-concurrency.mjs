import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';

export async function validateHistoricalMatchConcurrency(context) {
  const {
    db, restaurantId, ownerId, fixtureName, cedarId, ingredientId,
    invoiceIds, printedDate, future, baseline, incoming, late,
    expectState, job, pass,
  } = context;
  const ref = 'hadinygxviofopdejwvj';
  assert.equal(db.supabaseUrl, `https://${ref}.supabase.co`);
  assert.match(fixtureName, /^Phase 6 staging [0-9a-f-]{36}$/);

  let url;
  try { url = new URL(process.env.OPTIMENU_TEST_DATABASE_URL); }
  catch { throw new Error('A valid OPTIMENU_TEST_DATABASE_URL is required.'); }
  const user = decodeURIComponent(url.username);
  const direct = url.hostname === `db.${ref}.supabase.co` && user === 'postgres';
  const pooled = url.hostname.endsWith('.pooler.supabase.com') &&
    user === `postgres.${ref}`;
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol) &&
    (direct || pooled), 'Only the development PostgreSQL database is allowed.');
  assert.ok(['', '5432'].includes(url.port) && url.pathname === '/postgres',
    'Use the development session pooler on port 5432.');
  assert.ok(url.password, 'The database password is missing.');
  const caFile = process.env.OPTIMENU_TEST_DATABASE_CA_FILE ||
    url.searchParams.get('sslrootcert');
  url.search = '';
  const config = {
    connectionString: url.toString(),
    ssl: { rejectUnauthorized: true,
      ...(caFile ? { ca: readFileSync(caFile, 'utf8') } : {}) },
    connectionTimeoutMillis: 10000,
    statement_timeout: 15000,
    query_timeout: 18000,
    application_name: 'optimenu-staging-historical-locks',
  };
  const a = new pg.Client(config);
  const b = new pg.Client(config);
  const connectionErrors = [];
  for (const client of [a, b]) client.on('error', error => connectionErrors.push(error));

  const { normalizeSupplierProduct } = await import('../lib/invoiceMatchConflicts.js');
  const scope = [restaurantId, normalizeSupplierProduct(fixtureName),
    normalizeSupplierProduct('Dijon Mustard')];
  const id = randomUUID();
  const lineId = randomUUID();
  const manualId = randomUUID();
  const originalIds = invoiceIds.slice();
  let lease;
  let ownedScope = false;
  let cleared = false;
  let failure;

  function checked(result) {
    if (result.error) throw new Error(result.error.message);
    return result.data;
  }

  async function snapshot() {
    const results = await Promise.all([
      ...['invoices', 'ingredients', 'menu_items', 'menu_item_cost_history',
        'current_inventory', 'invoice_delivery_date_audit',
        'invoice_confirmation_requests', 'historical_invoice_match_audit',
        'notification_email_outbox'].map(table => db.from(table)
        .select('*').eq('restaurant_id', restaurantId).order('id')),
      db.from('invoice_items').select('*').in('invoice_id', originalIds).order('id'),
    ]);
    return { rows: results.map(checked), job: await job() };
  }

  async function transaction(work, commit = false) {
    await a.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    try {
      await a.query("SET LOCAL lock_timeout = '10s'");
      await a.query("SET LOCAL idle_in_transaction_session_timeout = '30s'");
      const result = await work();
      await a.query(commit ? 'COMMIT' : 'ROLLBACK');
      return result;
    } catch (error) {
      try { await a.query('ROLLBACK'); }
      catch (rollbackError) {
        await a.end().catch(() => {});
        throw new AggregateError([error, rollbackError], 'Historical transaction cleanup failed.');
      }
      throw error;
    }
  }

  async function reset() {
    await transaction(async () => {
      for (const table of ['invoice_match_decision_audit', 'invoice_match_rejections']) {
        await a.query(`DELETE FROM public.${table}
          WHERE restaurant_id=$1 AND supplier_key=$2 AND product_key=$3`, scope);
      }
      await a.query(`DELETE FROM public.historical_invoice_match_audit
        WHERE invoice_item_id=$1 AND restaurant_id=$2`, [lineId, restaurantId]);
      await a.query(`UPDATE public.invoice_items SET ingredient_id=NULL, reviewed=false
        WHERE id=$1 AND invoice_id=$2`, [lineId, id]);
      // Updating the ingredient creates an exclusion; clear only this test line's marker.
      await a.query(`DELETE FROM public.historical_invoice_match_exclusions
        WHERE invoice_item_id=$1`, [lineId]);
    }, true);
  }

  async function link(client, overrides = {}) {
    const result = await client.query(`SELECT public.link_historical_invoice_item(
      $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::bigint) AS linked`, [
      restaurantId, lineId, overrides.ingredientId ?? ingredientId,
      overrides.token ?? lease.lease_token, overrides.generation ?? lease.generation,
    ]);
    return result.rows[0].linked;
  }

  async function manual(client) {
    const result = await client.query(`UPDATE public.invoice_items
      SET ingredient_id=$1, reviewed=false WHERE id=$2 AND invoice_id=$3`,
    [manualId, lineId, id]);
    assert.equal(result.rowCount, 1);
  }

  async function reject(client) {
    // No source line: these synthetic relationship decisions carry no protected invoice history.
    const result = await client.query(`INSERT INTO public.invoice_match_rejections (
      id,restaurant_id,supplier_key,product_key,ingredient_id,rejected_by,reason
    ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [randomUUID(), ...scope, ingredientId, ownerId, fixtureName]);
    assert.equal(result.rowCount, 1);
  }

  async function state() {
    const result = await a.query(`SELECT ii.ingredient_id, ii.reviewed,
      (SELECT count(*)::int FROM public.historical_invoice_match_exclusions
        WHERE invoice_item_id=ii.id) AS exclusions,
      (SELECT count(*)::int FROM public.historical_invoice_match_audit
        WHERE invoice_item_id=ii.id) AS audits
      FROM public.invoice_items ii WHERE ii.id=$1 AND ii.invoice_id=$2`, [lineId, id]);
    assert.equal(result.rowCount, 1);
    return result.rows[0];
  }

  async function assertState(selected, audits, exclusions, rejected = false) {
    assert.deepEqual(await state(), {
      ingredient_id: selected, reviewed: false, audits, exclusions,
    });
    const audit = await a.query(`SELECT restaurant_id, ingredient_id, calculated_at
      FROM public.historical_invoice_match_audit WHERE invoice_item_id=$1`, [lineId]);
    assert.deepEqual(audit.rows, audits ? [{
      restaurant_id: restaurantId, ingredient_id: ingredientId, calculated_at: null,
    }] : []);
    for (const table of ['invoice_match_rejections', 'invoice_match_decision_audit']) {
      const rows = await a.query(`SELECT * FROM public.${table}
        WHERE restaurant_id=$1 AND supplier_key=$2 AND product_key=$3`, scope);
      assert.equal(rows.rowCount, rejected ? 1 : 0);
      if (rejected && table === 'invoice_match_decision_audit') {
        assert.equal(rows.rows[0].action, 'rejected');
        assert.equal(rows.rows[0].invoice_item_id, null);
      }
    }
  }

  async function runCase(test) {
    let activeA = false;
    let activeB = false;
    let pending;
    let error;
    const action = async (client, type) => {
      if (type === 'manual') return manual(client);
      if (type === 'reject') return reject(client);
      return link(client);
    };
    try {
      for (const client of [a, b]) {
        await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        if (client === a) activeA = true;
        else activeB = true;
        await client.query("SET LOCAL lock_timeout = '10s'");
        await client.query("SET LOCAL idle_in_transaction_session_timeout = '30s'");
      }
      const pidA = (await a.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      const pidB = (await b.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      assert.notEqual(pidA, pidB);
      const first = await action(a, test.first);
      if (test.first === 'historical') assert.equal(first, true);
      let finished = false;
      pending = action(b, test.second).then(
        result => { finished = true; return { result }; },
        error => { finished = true; return { error }; }
      );
      const deadline = Date.now() + 5000;
      let blocked = false;
      while (Date.now() < deadline) {
        const result = await a.query(
          'SELECT $1::int = ANY(pg_blocking_pids($2::int)) AS blocked', [pidA, pidB]
        );
        if (result.rows[0].blocked) { blocked = true; break; }
        if (finished) throw new Error('The competing statement did not wait for the expected lock.');
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      assert.equal(blocked, true, 'PostgreSQL did not report the expected blocking session.');
      await a.query(test.release);
      activeA = false;
      const outcome = await pending;
      if (outcome.error) throw outcome.error;
      if (test.second === 'historical') assert.equal(outcome.result, test.linked);
      await b.query('COMMIT');
      activeB = false;
    } catch (caught) {
      error = caught;
    } finally {
      // Release the blocker before draining the waiting statement or rolling back its session.
      if (activeA) {
        try { await a.query('ROLLBACK'); }
        catch (caught) { error ||= caught; await a.end().catch(() => {}); }
      }
      if (pending) await pending;
      if (activeB) {
        try { await b.query('ROLLBACK'); }
        catch (caught) { error ||= caught; await b.end().catch(() => {}); }
      }
    }
    if (error) throw error;
    await assertState(test.selected, test.audits, test.exclusions, test.rejected);
    pass(test.message);
  }

  async function removeFixture() {
    await reset();
    const invoice = checked(await db.from('invoices').select('id')
      .eq('restaurant_id', restaurantId).eq('id', id).maybeSingle());
    if (invoice) {
      const result = checked(await db.rpc('delete_invoices_transactional', {
        p_restaurant_id: restaurantId, p_invoice_ids: [id], p_queue_calculations: false,
      }));
      assert.equal(result.deleted, 1);
      assert.equal(result.calculations_queued, false);
    }
    checked(await db.from('ingredients').delete()
      .eq('restaurant_id', restaurantId).eq('id', manualId));
  }

  try {
    await a.connect();
    await b.connect();
    for (const client of [a, b]) {
      const result = await client.query(`SELECT id FROM public.restaurants
        WHERE id=$1 AND user_id=$2 AND name=$3`, [restaurantId, ownerId, fixtureName]);
      assert.equal(result.rowCount, 1, 'PostgreSQL fixture identity does not match the API fixture.');
    }
    for (const table of ['invoice_ingredient_mappings', 'invoice_match_rejections',
      'invoice_match_decision_audit']) {
      const result = await a.query(`SELECT id FROM public.${table}
        WHERE restaurant_id=$1 AND supplier_key=$2 AND product_key=$3`, scope);
      assert.equal(result.rowCount, 0, 'The disposable matching scope must start empty.');
    }
    ownedScope = true;
    const before = await snapshot();
    checked(await db.from('ingredients').insert({
      id: manualId, restaurant_id: restaurantId, name: 'Historical Manual Selection',
      unit: 'fl oz', standard_unit: 'fl oz', ingredient_category: 'volume',
      last_price: 0.30, price_status: 'invoice', is_estimated: false,
    }));
    const saved = checked(await db.rpc('save_invoice_confirmation_transactional', {
      p_restaurant_id: restaurantId, p_request_id: randomUUID(),
      p_request_fingerprint: createHash('sha256').update(id).digest('hex'),
      p_append_to_invoice_id: null,
      p_invoice: { id, supplier: fixtureName, number: id,
        date: printedDate, delivery_date: future, amount: 8 },
      p_files: [], p_evidence: [], p_queue_calculations: false,
      p_lines: [{ id: lineId, invoice_id: id, item_name: 'Dijon Mustard',
        ingredient_id: null, reviewed: false, quantity: 1, unit: 'qt',
        unit_cost: 8, amount: 8 }],
    }));
    assert.equal(saved.success, true);
    assert.equal(saved.invoice_id, id);
    await a.query('SELECT public.enqueue_historical_invoice_matching($1::uuid)', [restaurantId]);
    const claimed = await a.query(
      'SELECT * FROM public.claim_historical_invoice_matching($1::uuid)', [restaurantId]
    );
    assert.equal(claimed.rowCount, 1, 'The fixture historical lease could not be claimed.');
    lease = claimed.rows[0];

    const cases = [
      { first: 'manual', second: 'historical', release: 'ROLLBACK', linked: true,
        selected: ingredientId, audits: 1, exclusions: 0,
        message: 'Rolling back a manual correction lets the waiting historical match link once.' },
      { first: 'manual', second: 'historical', release: 'COMMIT', linked: false,
        selected: manualId, audits: 0, exclusions: 1,
        message: 'A committed manual correction prevents the waiting historical match from overwriting it.' },
      { first: 'historical', second: 'manual', release: 'ROLLBACK',
        selected: manualId, audits: 0, exclusions: 1,
        message: 'A rolled-back historical match releases the manual correction without leaving an audit.' },
      { first: 'historical', second: 'manual', release: 'COMMIT',
        selected: manualId, audits: 1, exclusions: 1,
        message: 'A waiting manual correction replaces the committed historical link and preserves its audit.' },
      { first: 'reject', second: 'historical', release: 'ROLLBACK', linked: true,
        selected: ingredientId, audits: 1, exclusions: 0,
        message: 'A rolled-back rejection lets the waiting historical match proceed.' },
      { first: 'reject', second: 'historical', release: 'COMMIT', linked: false,
        selected: null, audits: 0, exclusions: 0, rejected: true,
        message: 'A committed rejection blocks the waiting historical match after the lock is released.' },
    ];
    for (const test of cases) {
      await reset();
      await runCase(test);
    }

    await reset();
    await transaction(async () => {
      await a.query('UPDATE public.invoice_items SET reviewed=true WHERE id=$1', [lineId]);
      assert.equal(await link(a), false);
      assert.equal((await state()).ingredient_id, null);
    });
    await transaction(async () => {
      await manual(a);
      await a.query('UPDATE public.invoice_items SET ingredient_id=NULL WHERE id=$1', [lineId]);
      assert.equal((await state()).exclusions, 1);
      assert.equal(await link(a), false);
      assert.equal((await state()).ingredient_id, null);
    });
    await transaction(async () => {
      await manual(a);
      await a.query('DELETE FROM public.historical_invoice_match_exclusions WHERE invoice_item_id=$1', [lineId]);
      assert.equal(await link(a), false);
      assert.equal((await state()).ingredient_id, manualId);
    });
    await assertState(null, 0, 0);
    pass('Reviewed lines, explicit manual unlinks, and existing ingredient links are protected.');

    const leaseError = { code: 'P0001', message: /Historical matching lease expired/ };
    await assert.rejects(transaction(() => link(a, { token: randomUUID() })), leaseError);
    await assert.rejects(transaction(() => link(a, {
      generation: (BigInt(lease.generation) + 1n).toString(),
    })), leaseError);
    await assert.rejects(transaction(async () => {
      await a.query(`UPDATE public.historical_invoice_match_jobs
        SET lease_until=now()-interval '1 second' WHERE restaurant_id=$1`, [restaurantId]);
      await link(a);
    }), leaseError);
    await assert.rejects(transaction(async () => {
      const foreignId = randomUUID();
      await a.query(`INSERT INTO public.ingredients (id,restaurant_id,name,unit)
        VALUES ($1,$2,$3,'fl oz')`, [foreignId, cedarId, fixtureName]);
      await link(a, { ingredientId: foreignId });
    }), { code: 'P0001', message: /Ingredient does not belong to restaurant/ });
    await transaction(async () => {
      // Only the newly created test invoice changes tenant, and this transaction rolls back.
      await a.query('UPDATE public.invoices SET restaurant_id=$1 WHERE id=$2', [cedarId, id]);
      assert.equal(await link(a), false);
    });
    await assertState(null, 0, 0);
    pass('Wrong, stale, and expired leases and foreign ingredients or invoices cannot create a link.');

    await transaction(async () => {
      assert.equal(await link(a), true);
      const beforeReplay = await a.query(`SELECT * FROM public.historical_invoice_match_audit
        WHERE invoice_item_id=$1`, [lineId]);
      assert.equal(await link(a), false);
      const afterReplay = await a.query(`SELECT * FROM public.historical_invoice_match_audit
        WHERE invoice_item_id=$1`, [lineId]);
      assert.deepEqual(afterReplay.rows, beforeReplay.rows);
      await assertState(ingredientId, 1, 0);
    });
    pass('Repeating historical matching creates no duplicate link, exclusion, or audit.');

    await removeFixture();
    const finished = await a.query(`SELECT public.finish_historical_invoice_matching(
      $1::uuid,$2::uuid,$3::bigint,NULL) AS finished`,
    [restaurantId, lease.lease_token, lease.generation]);
    assert.equal(finished.rows[0].finished, true);
    const completed = (await a.query(`SELECT * FROM public.historical_invoice_match_jobs
      WHERE restaurant_id=$1`, [restaurantId])).rows[0];
    assert.equal(completed.generation, completed.completed_generation);
    for (const field of ['lease_token', 'lease_until', 'last_error']) {
      assert.equal(completed[field], null);
    }
    for (const table of ['invoices', 'invoice_items', 'invoice_confirmation_requests']) {
      const column = table === 'invoices' ? 'id' : 'invoice_id';
      assert.equal(checked(await db.from(table).select('id').eq(column, id)).length, 0);
    }
    assert.deepEqual(await snapshot(), before);
    await expectState(0.25, 0.50, [baseline, incoming, late]);
    assert.equal(connectionErrors.length, 0);
    cleared = true;
    pass('Historical fixtures are removed; original links, prices, costs, stock, and calculation jobs stay unchanged.');
  } catch (error) {
    failure = error;
  } finally {
    if (ownedScope && !cleared) {
      try { await removeFixture(); }
      catch (error) {
        failure = new AggregateError([failure, error].filter(Boolean), 'Historical test or cleanup failed.');
      }
    }
    await Promise.allSettled([a.end(), b.end()]);
  }
  if (failure) throw failure;
}