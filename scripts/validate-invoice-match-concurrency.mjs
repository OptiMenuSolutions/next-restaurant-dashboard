import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

export async function validateInvoiceMatchConcurrency(context) {
  const {
    db, restaurantId, ownerId, fixtureName, cedarId, ingredientId,
    invoiceIds, baseline, incoming, late, expectState, job, pass,
  } = context;

  const ref = 'hadinygxviofopdejwvj';
  assert.equal(db.supabaseUrl, `https://${ref}.supabase.co`);
  assert.match(fixtureName, /^Phase 6 staging [0-9a-f-]{36}$/);

  let url;
  try {
    url = new URL(process.env.OPTIMENU_TEST_DATABASE_URL);
  } catch {
    throw new Error('A valid OPTIMENU_TEST_DATABASE_URL is required.');
  }
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
    ssl: {
      rejectUnauthorized: true,
      ...(caFile ? { ca: readFileSync(caFile, 'utf8') } : {}),
    },
    connectionTimeoutMillis: 10000,
    statement_timeout: 15000,
    query_timeout: 18000,
    application_name: 'optimenu-staging-match-locks',
  };
  const a = new pg.Client(config);
  const b = new pg.Client(config);
  const connectionErrors = [];
  for (const client of [a, b]) client.on('error', error => connectionErrors.push(error));

  const { normalizeSupplierProduct } = await import('../lib/invoiceMatchConflicts.js');
  const { loadInvoiceMatchDecisions, applyInvoiceMatchDecisions } =
    await import('../lib/invoiceMatchDecisions.js');
  const supplierKey = normalizeSupplierProduct(fixtureName);
  const description = 'Dijon Mustard';
  const productKey = normalizeSupplierProduct(description);
  const mappingId = randomUUID();
  const scope = [restaurantId, supplierKey, productKey];
  const tables = ['invoice_match_decision_audit', 'invoice_match_rejections',
    'invoice_ingredient_mappings'];
  const approveSql = `
    INSERT INTO public.invoice_ingredient_mappings (
      id, restaurant_id, supplier_key, product_key, ingredient_id,
      approved_by, supplier_name, product_description
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    ON CONFLICT (restaurant_id, supplier_key, product_key)
    DO UPDATE SET ingredient_id = EXCLUDED.ingredient_id,
      approved_by = EXCLUDED.approved_by
    RETURNING id, ingredient_id`;
  const approveParams = id => [id, ...scope, ingredientId, ownerId, fixtureName, description];
  const updateSql = `UPDATE public.invoice_ingredient_mappings
    SET ingredient_id = ingredient_id
    WHERE id = $1 AND restaurant_id = $2 RETURNING id`;
  const rejectSql = `INSERT INTO public.invoice_match_rejections (
    id, restaurant_id, supplier_key, product_key, ingredient_id, rejected_by, reason
  ) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`;
  const rejectParams = () => [randomUUID(), ...scope, ingredientId, ownerId, fixtureName];

  function checked(result) {
    if (result.error) throw new Error(result.error.message);
    return result.data;
  }

  async function decisionRows() {
    const results = await Promise.all(tables.map(table => db.from(table)
      .select('*').eq('restaurant_id', restaurantId)
      .eq('supplier_key', supplierKey).eq('product_key', productKey).order('id')));
    return results.map(checked);
  }

  async function financialSnapshot() {
    const results = await Promise.all([
      ...['invoices', 'ingredients', 'menu_items', 'menu_item_cost_history',
        'current_inventory', 'invoice_delivery_date_audit'].map(table => db.from(table)
        .select('*').eq('restaurant_id', restaurantId).order('id')),
      db.from('invoice_items').select('*').in('invoice_id', invoiceIds).order('id'),
    ]);
    return { rows: results.map(checked), job: await job() };
  }

  async function clear(seed = false) {
    await a.query('BEGIN');
    try {
      for (const table of tables) {
        await a.query(`DELETE FROM public.${table}
          WHERE restaurant_id=$1 AND supplier_key=$2 AND product_key=$3`, scope);
      }
      if (seed) await a.query(approveSql, approveParams(mappingId));
      await a.query('COMMIT');
    } catch (error) {
      await a.query('ROLLBACK');
      throw error;
    }
  }

  async function assertState(rejected) {
    const [audit, rejections, approvals] = await decisionRows();
    assert.equal(approvals.length, rejected ? 0 : 1);
    assert.equal(rejections.length, rejected ? 1 : 0);
    if (rejected) {
      assert.equal(rejections[0].ingredient_id, ingredientId);
      assert.equal(rejections[0].rejected_by, ownerId);
      assert.deepEqual(audit.map(row => row.action).sort(), ['approval_removed', 'rejected']);
      assert.ok(audit.every(row => row.admin_id === ownerId &&
        row.previous_ingredient_id === ingredientId));
    } else {
      assert.equal(approvals[0].id, mappingId);
      assert.equal(approvals[0].ingredient_id, ingredientId);
      assert.equal(audit.length, 0);
    }
  }

  async function runCase(test) {
    let activeA = false;
    let activeB = false;
    let pending;
    let failure;
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

      if (test.first === 'reject') await a.query(rejectSql, rejectParams());
      else await a.query(updateSql, [mappingId, restaurantId]);

      let finished = false;
      const waiting = test.second === 'reject'
        ? b.query(rejectSql, rejectParams())
        : test.second === 'approve'
          ? b.query(approveSql, approveParams(randomUUID()))
          : b.query(updateSql, [mappingId, restaurantId]);
      pending = waiting.then(
        result => { finished = true; return { result }; },
        error => { finished = true; return { error }; }
      );

      const deadline = Date.now() + 5000;
      let blocked = false;
      while (Date.now() < deadline) {
        const observation = await a.query(
          'SELECT $1::int = ANY(pg_blocking_pids($2::int)) AS blocked', [pidA, pidB]
        );
        if (observation.rows[0].blocked) { blocked = true; break; }
        if (finished) throw new Error('The competing statement finished before a lock wait was observed.');
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      assert.equal(blocked, true, 'PostgreSQL did not report the expected blocking session.');

      await a.query(test.release);
      activeA = false;
      const outcome = await pending;
      if (test.error) {
        assert.equal(outcome.error?.code, 'P0001');
        assert.match(outcome.error.message, /previously rejected/i);
      } else {
        if (outcome.error) throw outcome.error;
        assert.equal(outcome.result.rowCount, test.rows);
      }
      await b.query(test.finish);
      activeB = false;
    } catch (error) {
      failure = error;
    } finally {
      // Release the blocker before waiting for the competing statement.
      if (activeA) {
        try { await a.query('ROLLBACK'); }
        catch (error) { failure ||= error; await a.end().catch(() => {}); }
      }
      if (pending) await pending;
      if (activeB) {
        try { await b.query('ROLLBACK'); }
        catch (error) { failure ||= error; await b.end().catch(() => {}); }
      }
    }
    if (failure) throw failure;
    await assertState(test.rejected);
    pass(test.message);
  }

  let ownedScope = false;
  let cleared = false;
  let failure;
  try {
    await a.connect();
    await b.connect();
    for (const client of [a, b]) {
      const result = await client.query(`SELECT id FROM public.restaurants
        WHERE id=$1 AND user_id=$2 AND name=$3`, [restaurantId, ownerId, fixtureName]);
      assert.equal(result.rowCount, 1, 'PostgreSQL fixture identity does not match the API fixture.');
    }
    assert.ok((await decisionRows()).every(rows => rows.length === 0));
    ownedScope = true;
    const before = await financialSnapshot();
    await clear(true);
    await assertState(false);
    const ingredient = checked(await db.from('ingredients').select('*')
      .eq('restaurant_id', restaurantId).eq('id', ingredientId).single());
    const match = async supplier => applyInvoiceMatchDecisions({
      description, invoiceUnit: 'qt', ingredients: [ingredient],
      match: { status: 'auto', matches: [{ ...ingredient, score: 1 }] },
      decisions: await loadInvoiceMatchDecisions(db, restaurantId, supplier),
    });
    const approved = await match(fixtureName);
    assert.equal(approved.decision_source, 'admin_approved');
    assert.equal(approved.matches[0].id, ingredientId);
    pass('The committed fixture approval is reused by the real matching rules.');

    const cases = [
      { first: 'reject', second: 'update', release: 'ROLLBACK', finish: 'ROLLBACK',
        rows: 1, rejected: false,
        message: 'Rejection-first rollback releases the waiting approval update and preserves the mapping.' },
      { first: 'update', second: 'reject', release: 'ROLLBACK', finish: 'ROLLBACK',
        rows: 1, rejected: false,
        message: 'Approval-first rollback releases rejection; rolling rejection back preserves mapping and audit.' },
      { first: 'reject', second: 'update', release: 'COMMIT', finish: 'COMMIT',
        rows: 0, rejected: true,
        message: 'A committed rejection prevents a waiting update from resurrecting the approval.' },
      { first: 'update', second: 'reject', release: 'COMMIT', finish: 'COMMIT',
        rows: 1, rejected: true,
        message: 'A waiting rejection removes the committed approval and records both audit events.' },
      { first: 'reject', second: 'approve', release: 'ROLLBACK', finish: 'COMMIT',
        rows: 1, rejected: false,
        message: 'A rolled-back rejection permits one approval upsert without duplicate mappings.' },
      { first: 'reject', second: 'approve', release: 'COMMIT', finish: 'ROLLBACK',
        error: true, rejected: true,
        message: 'A committed rejection explicitly rejects the waiting approval upsert.' },
    ];
    for (const test of cases) {
      await clear(true);
      await runCase(test);
    }

    const rejected = await match(fixtureName);
    assert.equal(rejected.status, 'new');
    assert.equal(rejected.matches.length, 0);
    pass('The committed rejection prevents future automatic reuse of this ingredient.');

    const otherSupplier = await match(`${fixtureName} other supplier`);
    assert.equal(otherSupplier.status, 'auto');
    assert.equal(otherSupplier.matches[0].id, ingredientId);
    const otherRestaurant = await loadInvoiceMatchDecisions(db, cedarId, fixtureName);
    assert.equal(otherRestaurant.approvals.size, 0);
    assert.equal(otherRestaurant.rejections.size, 0);
    pass('The rejection does not leak to another supplier or restaurant.');

    await clear();
    cleared = true;
    assert.ok((await decisionRows()).every(rows => rows.length === 0));
    assert.deepEqual(await financialSnapshot(), before);
    await expectState(0.25, 0.50, [baseline, incoming, late]);
    assert.equal(connectionErrors.length, 0);
    pass('Matching fixtures are removed; invoice links, prices, costs, stock, and jobs stay unchanged.');
  } catch (error) {
    failure = error;
  } finally {
    if (ownedScope && !cleared) {
      try { await clear(); }
      catch (error) {
        failure = new AggregateError([failure, error].filter(Boolean), 'Matching test or cleanup failed.');
      }
    }
    await Promise.allSettled([a.end(), b.end()]);
  }
  if (failure) throw failure;
}