import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

export async function validateInvoiceCorrectionQueue(context) {
  const {
    db, restaurantId, ownerId, fixtureName, cedarId, ingredientId,
    invoiceIds, baseline, incoming, late, expectState, pass,
  } = context;
  const ref = 'hadinygxviofopdejwvj';
  assert.equal(db.supabaseUrl, `https://${ref}.supabase.co`);
  assert.match(fixtureName, /^Phase 6 staging [0-9a-f-]{36}$/);
  assert.notEqual(restaurantId, cedarId);

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
  const client = new pg.Client({
    connectionString: url.toString(),
    ssl: { rejectUnauthorized: true,
      ...(caFile ? { ca: readFileSync(caFile, 'utf8') } : {}) },
    connectionTimeoutMillis: 10000,
    statement_timeout: 15000,
    query_timeout: 18000,
    application_name: 'optimenu-staging-correction-queue',
  });
  const connectionErrors = [];
  client.on('error', error => connectionErrors.push(error));
  const { normalizeSupplierProduct } = await import('../lib/invoiceMatchConflicts.js');

  async function state() {
    const tables = [
      'invoices', 'ingredients', 'menu_items', 'menu_item_cost_history',
      'current_inventory', 'invoice_delivery_date_audit',
      'invoice_supported_price_evidence', 'invoice_confirmation_requests',
      'invoice_match_decision_audit', 'invoice_match_rejections',
      'invoice_ingredient_mappings', 'notification_email_outbox',
    ];
    const sections = tables.map(table => `
      (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb)
       FROM public.${table} t WHERE t.restaurant_id=ANY($1::uuid[])) AS ${table}`);
    const result = await client.query(`SELECT ${sections.join(',')},
      (SELECT to_jsonb(p) FROM public.profiles p WHERE p.id=$2::uuid) AS profile,
      (SELECT coalesce(jsonb_agg(to_jsonb(j) ORDER BY j.restaurant_id), '[]'::jsonb)
       FROM public.invoice_calculation_jobs j
       WHERE j.restaurant_id=ANY($1::uuid[])) AS jobs,
      (SELECT coalesce(jsonb_agg(to_jsonb(ii) ORDER BY ii.id), '[]'::jsonb)
       FROM public.invoice_items ii WHERE ii.invoice_id=ANY($3::uuid[])) AS lines,
      (SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.invoice_item_id), '[]'::jsonb)
       FROM public.historical_invoice_match_exclusions e
       JOIN public.invoice_items ii ON ii.id=e.invoice_item_id
       WHERE ii.invoice_id=ANY($3::uuid[])) AS exclusions`,
    [[restaurantId, cedarId], ownerId, invoiceIds]);
    return result.rows[0];
  }

  const change = (lineId = incoming.lineId, expected = null, selected = ingredientId) => ({
    invoice_item_id: lineId, expected_ingredient_id: expected, ingredient_id: selected,
  });

  async function correct(changes = [change()], options = {}) {
    const result = await client.query(`SELECT public.resolve_invoice_ingredient_conflict(
      p_restaurant_id := $1::uuid, p_supplier := $2::text,
      p_product_description := $3::text, p_changes := $4::jsonb,
      p_future_ingredient_id := NULL::uuid, p_approve_future := FALSE,
      p_admin_id := $5::uuid, p_expected_mapping_updated_at := NULL::timestamptz
    ) AS result`, [options.restaurantId ?? restaurantId,
      options.supplier ?? fixtureName, options.product ?? 'Dijon Mustard',
      JSON.stringify(changes), ownerId]);
    return result.rows[0].result;
  }

  async function rejected(work, message) {
    const before = await state();
    await client.query('SAVEPOINT expected_rejection');
    try {
      await assert.rejects(work, { code: 'P0001', message });
    } finally {
      await client.query('ROLLBACK TO SAVEPOINT expected_rejection');
      await client.query('RELEASE SAVEPOINT expected_rejection');
    }
    assert.deepEqual(await state(), before, 'Rejected correction left partial changes.');
  }

  let original;
  async function rolledBack(work, prepare = true) {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    let failure;
    try {
      await client.query("SET LOCAL lock_timeout = '10s'");
      await client.query("SET LOCAL idle_in_transaction_session_timeout = '30s'");
      if (prepare) {
        // This role change and unmatched-line setup must never be committed.
        const role = await client.query(`UPDATE public.profiles SET role='admin'
          WHERE id=$1 AND restaurant_id=$2 AND role='client'`, [ownerId, restaurantId]);
        assert.equal(role.rowCount, 1);
        const line = await client.query(`UPDATE public.invoice_items SET ingredient_id=NULL
          WHERE id=$1 AND invoice_id=$2 AND ingredient_id=$3`,
        [incoming.lineId, incoming.id, ingredientId]);
        assert.equal(line.rowCount, 1);
      }
      await work();
    } catch (error) {
      failure = error;
    } finally {
      try { await client.query('ROLLBACK'); }
      catch (error) {
        await client.end().catch(() => {});
        failure = new AggregateError([failure, error].filter(Boolean), 'Correction rollback failed.');
      }
    }
    if (failure) throw failure;
    assert.deepEqual(await state(), original, 'Rollback did not restore the original fixture.');
  }

  try {
    await client.connect();
    const identity = await client.query(`SELECT r.id FROM public.restaurants r
      JOIN public.profiles p ON p.id=r.user_id
      WHERE r.id=$1 AND r.user_id=$2 AND r.name=$3
        AND p.restaurant_id=r.id AND p.role='client'`,
    [restaurantId, ownerId, fixtureName]);
    assert.equal(identity.rowCount, 1, 'PostgreSQL fixture identity does not match the API fixture.');
    original = await state();
    const originalJob = original.jobs.find(row => row.restaurant_id === restaurantId);
    assert.ok(originalJob);
    assert.equal(String(originalJob.generation), String(originalJob.completed_generation));

    await rolledBack(() => rejected(() => correct(), /Admin access required/), false);
    pass('The real correction function rejects the fixture client without administrator access.');

    await rolledBack(async () => {
      const before = await state();
      const queuedBefore = before.jobs.find(row => row.restaurant_id === restaurantId);
      assert.deepEqual(await correct(), {
        restaurantId, updated: 1, futureMappingApproved: false, calculationsPending: true,
      });
      const after = await state();
      const expectedLines = before.lines.map(row => row.id === incoming.lineId
        ? { ...row, ingredient_id: ingredientId } : row);
      assert.deepEqual(after.lines, expectedLines);
      const audit = after.invoice_match_decision_audit.filter(row =>
        row.restaurant_id === restaurantId && row.invoice_item_id === incoming.lineId);
      assert.equal(audit.length, 1);
      assert.equal(audit[0].action, 'approved');
      assert.equal(audit[0].admin_id, ownerId);
      assert.equal(audit[0].previous_ingredient_id, null);
      assert.equal(audit[0].new_ingredient_id, ingredientId);
      const queuedAfter = after.jobs.find(row => row.restaurant_id === restaurantId);
      assert.equal(BigInt(queuedAfter.generation), BigInt(queuedBefore.generation) + 1n);
      assert.equal(String(queuedAfter.completed_generation), String(queuedBefore.completed_generation));
      assert.equal(queuedAfter.effective_date, queuedBefore.effective_date);
      for (const field of ['lease_token', 'lease_until', 'last_error']) {
        assert.equal(queuedAfter[field], queuedBefore[field]);
      }
      pass('A real ingredient correction saves its audit and advances the queue without completing calculations.');

      assert.deepEqual(await correct([change(incoming.lineId, ingredientId)]), {
        restaurantId, updated: 0, futureMappingApproved: false, calculationsPending: false,
      });
      assert.deepEqual(await state(), after);
      pass('An unchanged correction creates no additional audit or calculation generation.');
    });
    pass('Rolling back a successful correction restores the link, audit, queue, and client role.');

    await rolledBack(() => rejected(() => correct([change(), change()]),
      /included more than once/));
    pass('Duplicate invoice lines reject before any correction is saved.');

    await rolledBack(async () => {
      await rejected(() => correct([change(), change(baseline.lineId)]),
        /Invoice link changed since preview/);
      await rejected(() => correct([change(), change(randomUUID())]),
        /Invoice line not found/);
    });
    pass('A stale or missing later line rolls back the entire correction batch and its audit.');

    await rolledBack(async () => {
      await rejected(() => correct(undefined, { restaurantId: cedarId }),
        /Invoice does not belong to this restaurant/);
      await rejected(() => correct(undefined, { supplier: `${fixtureName} other` }),
        /different supplier/);
      await rejected(() => correct(undefined, { product: 'Different product' }),
        /does not belong to this product group/);
      const foreignId = randomUUID();
      await client.query(`INSERT INTO public.ingredients (id,restaurant_id,name,unit)
        VALUES ($1,$2,$3,'fl oz')`, [foreignId, cedarId, fixtureName]);
      await rejected(() => correct([change(incoming.lineId, null, foreignId)]),
        /Ingredient belongs to another restaurant/);
    });
    pass('Restaurant, supplier, product, and replacement-ingredient boundaries reject unrelated corrections.');

    await assert.rejects(rolledBack(async () => {
      assert.equal((await correct()).updated, 1);
      const saved = await state();
      assert.equal(BigInt(saved.jobs.find(row => row.restaurant_id === restaurantId).generation),
        BigInt(originalJob.generation) + 1n);
      // Force a database error after the real correction and queue writes.
      await client.query('SELECT 1 / 0');
    }), { code: '22012', message: /division by zero/ });
    assert.deepEqual(await state(), original);
    pass('A failure after correction and queue writes rolls back the saved link, audit, job, and role.');

    await rolledBack(async () => {
      await client.query(`INSERT INTO public.invoice_match_rejections (
        restaurant_id,supplier_key,product_key,ingredient_id,rejected_by,reason
      ) VALUES ($1,$2,$3,$4,$5,$6)`, [restaurantId,
        normalizeSupplierProduct(fixtureName), normalizeSupplierProduct('Dijon Mustard'),
        ingredientId, ownerId, fixtureName]);
      await rejected(() => correct(), /previously rejected/);
    });
    pass('An existing rejection cannot be bypassed by an ingredient correction.');

    assert.deepEqual(await state(), original);
    await expectState(0.25, 0.50, [baseline, incoming, late]);
    assert.equal(connectionErrors.length, 0);
    pass('All correction transactions are rolled back; original prices, costs, inventory, and tenant data stay unchanged.');
  } finally {
    await client.end().catch(() => {});
  }
}