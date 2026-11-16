import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';

export async function validateInvoiceEvidenceIntegrity(context) {
  const {
    db, restaurantId, ownerId, fixtureName, cedarId, today, printedDate, future,
    baseline, incoming, late, processJobs, expectState, job, pass,
  } = context;
  const ref = 'hadinygxviofopdejwvj';
  assert.equal(db.supabaseUrl, `https://${ref}.supabase.co`);
  assert.match(fixtureName, /^Phase 6 staging [0-9a-f-]{36}$/);
  assert.notEqual(restaurantId, cedarId);
  const hash = value => createHash('sha256').update(value).digest('hex');
  const checked = result => {
    if (result.error) throw new Error(result.error.message);
    return result.data;
  };

  let url;
  try { url = new URL(process.env.OPTIMENU_TEST_DATABASE_URL); }
  catch { throw new Error('A valid OPTIMENU_TEST_DATABASE_URL is required.'); }
  const user = decodeURIComponent(url.username);
  const direct = url.hostname === `db.${ref}.supabase.co` && user === 'postgres';
  const pooled = url.hostname.endsWith('.pooler.supabase.com') && user === `postgres.${ref}`;
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol) && (direct || pooled),
    'Only the development PostgreSQL database is allowed.');
  assert.ok(['', '5432'].includes(url.port) && url.pathname === '/postgres',
    'Use the development session pooler on port 5432.');
  assert.ok(url.password, 'The database password is missing.');
  const caFile = process.env.OPTIMENU_TEST_DATABASE_CA_FILE || url.searchParams.get('sslrootcert');
  url.search = '';
  const connection = new pg.Client({
    connectionString: url.toString(),
    ssl: { rejectUnauthorized: true,
      ...(caFile ? { ca: readFileSync(caFile, 'utf8') } : {}) },
    connectionTimeoutMillis: 10000, statement_timeout: 15000, query_timeout: 18000,
    application_name: 'optimenu-staging-evidence-schema',
  });
  const connectionErrors = [];
  connection.on('error', error => connectionErrors.push(error));
  try {
    await connection.connect();
    const identity = await connection.query(`SELECT id FROM public.restaurants
      WHERE id=$1 AND user_id=$2 AND name=$3`, [restaurantId, ownerId, fixtureName]);
    assert.equal(identity.rowCount, 1, 'PostgreSQL fixture identity does not match the API fixture.');
    if (process.argv.includes('--apply-evidence-v2')) {
      const migration = readFileSync(new URL(
        '../supabase/migrations/20261110000100_invoice_evidence_v2_compatibility.sql', import.meta.url
      ), 'utf8');
      assert.equal(hash(migration), '0e58944355c1bae23dee7e091cbb5b3f86acc03de7d3b31316eccb4495a3f704',
        'The migration does not match the reviewed repository version.');
      await connection.query("SET lock_timeout = '5s'");
      await connection.query(migration);
    }
    const checks = await connection.query(`SELECT pg_get_constraintdef(oid) AS definition
      FROM pg_constraint WHERE conrelid='public.invoice_supported_price_evidence'::regclass
        AND conname IN ('invoice_price_evidence_source_check',
          'invoice_price_evidence_status_check','invoice_price_evidence_version_check')`);
    assert.equal(checks.rowCount, 1, 'Apply the existing V2 compatibility migration in development.');
    assert.match(checks.rows[0].definition, /independent_ocr_evidence/);
    assert.equal(connectionErrors.length, 0);
  } finally {
    await connection.end().catch(() => {});
  }
  pass('The development database and disposable fixture are verified; V1 and V2 evidence are supported.');

  const previousFlag = process.env.INVOICE_SUPPORTED_REPRICING_ENABLED;
  const previousAllowlist = process.env.INVOICE_SUPPORTED_REPRICING_RESTAURANT_ID;
  const { isInvoiceSupportedRepricingEnabled } = await import('../lib/invoiceSupportedRepricingFlag.js');

  const oldDate = new Date(Date.parse(`${today}T00:00:00Z`) - 2 * 86400000)
    .toISOString().slice(0, 10);
  const evidence = async line => checked(await db.from('invoice_supported_price_evidence')
    .select('*').eq('restaurant_id', restaurantId).eq('invoice_item_id', line.lineId).single());
  const ingredient = async id => checked(await db.from('ingredients').select('*')
    .eq('restaurant_id', restaurantId).eq('id', id).single());

  async function calculate() {
    const before = await job();
    if (String(before.generation) === String(before.completed_generation)) {
      // Queue this disposable fixture after direct saved-line trigger tests.
      const queued = checked(await db.from('invoice_calculation_jobs').update({
        generation: (BigInt(before.generation) + 1n).toString(),
      }).eq('restaurant_id', restaurantId).eq('generation', before.generation)
        .eq('completed_generation', before.completed_generation).is('lease_token', null)
        .select('restaurant_id'));
      assert.equal(queued.length, 1, 'The fixture calculation job changed unexpectedly.');
    }
    const result = await processJobs();
    assert.equal(result.skipped, false);
    assert.deepEqual(result.errors, []);
    const after = await job();
    assert.equal(String(after.generation), String(after.completed_generation));
    for (const field of ['lease_token', 'lease_until', 'last_error']) assert.equal(after[field], null);
  }

  async function priced(f, price) {
    const saved = await ingredient(f.a);
    assert.equal(saved.price_status, 'invoice');
    assert.equal(saved.is_estimated, false);
    assert.equal(Number(saved.last_price), price);
    const dish = checked(await db.from('menu_items').select('cost,cost_status')
      .eq('restaurant_id', restaurantId).eq('id', f.dish).single());
    assert.equal(dish.cost_status, 'ready');
    assert.equal(Number(dish.cost), Number((price * 2).toFixed(2)));
  }

  async function save(f, date, price) {
    const id = randomUUID();
    const lineId = randomUUID();
    const cost = Number((price * f.factor).toFixed(2));
    const pricing = { invoice_item_id: lineId, invoice_id: id, restaurant_id: restaurantId,
      ingredient_id: f.a, item_name: f.product, quantity: 1, unit: f.purchaseUnit,
      unit_cost: cost, amount: cost };
    // Trusted synthetic database evidence; OCR and proof issuance are separate tests.
    const record = { invoice_item_id: lineId, invoice_id: id, restaurant_id: restaurantId,
      source_type: f.version === 1 ? 'structured_ocr_table' : 'independent_ocr_evidence',
      validation_status: f.version === 1 ? 'source_table_consistent' : 'source_charge_verified',
      evidence_version: f.version, source_fingerprint: hash(`${fixtureName}.${lineId}`),
      pricing_fingerprint: hash(JSON.stringify(pricing)),
      evidence: { proof_version: f.version, fixture: fixtureName, pricing } };
    const saved = checked(await db.rpc('save_invoice_confirmation_transactional', {
      p_restaurant_id: restaurantId, p_request_id: randomUUID(),
      p_request_fingerprint: hash(id), p_append_to_invoice_id: null,
      p_invoice: { id, supplier: fixtureName, number: id, date: printedDate,
        delivery_date: date, amount: cost }, p_files: [],
      p_lines: [{ id: lineId, invoice_id: id, ingredient_id: f.a, item_name: f.product,
        quantity: 1, unit: f.purchaseUnit, unit_cost: cost, amount: cost,
        price_verification_status: 'unknown' }],
      p_evidence: [record], p_queue_calculations: true,
    }));
    assert.equal(saved.success, true);
    assert.equal(saved.invoice_id, id);
    return { id, lineId, record };
  }

  async function update(line, values) {
    const rows = checked(await db.from('invoice_items').update(values)
      .eq('invoice_id', line.id).eq('id', line.lineId).select('id'));
    assert.equal(rows.length, 1);
  }

  function rejected(result, pattern) {
    assert.equal(result.error?.code, 'P0001', JSON.stringify(result));
    assert.match(result.error.message, pattern);
    assert.equal(result.data, null);
  }

  async function remove(line) {
    const result = checked(await db.rpc('delete_invoices_transactional', {
      p_restaurant_id: restaurantId, p_invoice_ids: [line.id], p_queue_calculations: true,
    }));
    assert.equal(result.deleted, 1);
    assert.equal(checked(await db.from('invoice_supported_price_evidence').select('id')
      .eq('restaurant_id', restaurantId).eq('invoice_item_id', line.lineId)).length, 0);
  }

  try {
    process.env.INVOICE_SUPPORTED_REPRICING_ENABLED = 'true';
    process.env.INVOICE_SUPPORTED_REPRICING_RESTAURANT_ID = restaurantId;
    assert.equal(isInvoiceSupportedRepricingEnabled(restaurantId), true);
    assert.equal(isInvoiceSupportedRepricingEnabled(cedarId), false);
    for (const version of [1, 2]) {
      const f = { version, a: randomUUID(), b: randomUUID(), dish: randomUUID(),
        component: randomUUID(), unit: version === 1 ? 'fl oz' : 'oz',
        purchaseUnit: version === 1 ? 'qt' : 'lb', factor: version === 1 ? 32 : 16,
        product: version === 1 ? 'D5 Dijon Mustard' : 'D5 Catch Weight Beef' };
      checked(await db.from('ingredients').insert([f.a, f.b].map((id, index) => ({
        id, restaurant_id: restaurantId, name: `${f.product} ${index}`,
        unit: f.unit, standard_unit: f.unit,
        ingredient_category: version === 1 ? 'volume' : 'weight',
        last_price: 0.01, price_status: 'needs_review', is_estimated: true,
      }))));
      checked(await db.from('menu_items').insert({ id: f.dish, restaurant_id: restaurantId,
        name: `D5 V${version} Dish`, price: 10, category: 'Testing' }));
      checked(await db.from('menu_item_components').insert({
        id: f.component, menu_item_id: f.dish, name: 'Evidence test' }));
      checked(await db.from('component_ingredients').insert({
        component_id: f.component, ingredient_id: f.a, quantity: 2, unit: f.unit }));
      const older = await save(f, oldDate, 0.20);
      let current = await save(f, today, 0.25);
      await calculate();
      await priced(f, 0.25);
      let originalEvidence = await evidence(current);
      assert.equal(originalEvidence.invalidated_at, null);
      pass(`V${version}: Active evidence supports the current ingredient price and recipe cost.`);

      rejected(await db.from('invoice_supported_price_evidence').update({
        evidence: { ...originalEvidence.evidence, modified: true },
      }).eq('id', originalEvidence.id).eq('restaurant_id', restaurantId), /cannot be modified/);
      rejected(await db.from('invoice_supported_price_evidence').insert({
        ...current.record, restaurant_id: cedarId,
      }), /ownership mismatch/);
      const mismatched = await db.from('invoice_supported_price_evidence').insert({
        ...current.record, evidence_version: version === 1 ? 2 : 1,
      });
      assert.equal(mismatched.error?.code, '23514', JSON.stringify(mismatched));
      assert.deepEqual(await evidence(current), originalEvidence);
      pass(`V${version}: Evidence contents, restaurant ownership, and version/source combinations are protected.`);

      await update(current, { ingredient_id: f.b });
      await calculate();
      await priced(f, 0.20);
      assert.equal(Number((await ingredient(f.b)).last_price), 0.25);
      assert.equal((await ingredient(f.b)).price_status, 'invoice');
      assert.deepEqual(await evidence(current), originalEvidence);
      await update(current, { ingredient_id: f.a });
      await calculate();
      await priced(f, 0.25);
      assert.equal((await ingredient(f.b)).price_status, 'needs_review');
      assert.deepEqual(await evidence(current), originalEvidence);
      pass(`V${version}: Relinking preserves source evidence and recalculates both ingredients.`);

      await update(current, { unit_cost: f.factor * 0.30, amount: f.factor * 0.30 });
      const invalidated = await evidence(current);
      assert.ok(invalidated.invalidated_at);
      assert.equal(invalidated.invalidation_reason, 'invoice_line_modified');
      await calculate();
      await priced(f, 0.20);
      await update(current, { unit_cost: f.factor * 0.25, amount: f.factor * 0.25 });
      rejected(await db.from('invoice_supported_price_evidence').update({
        invalidated_at: null, invalidation_reason: null,
      }).eq('id', invalidated.id).eq('restaurant_id', restaurantId), /Invalidated invoice evidence/);
      assert.deepEqual(await evidence(current), invalidated);
      await calculate();
      await priced(f, 0.20);
      pass(`V${version}: Pricing corrections invalidate evidence; restoring numbers cannot reactivate it.`);

      await remove(current);
      current = await save(f, today, 0.25);
      await calculate();
      await priced(f, 0.25);
      await update(current, { item_name: `${f.product} corrected identity` });
      assert.equal((await evidence(current)).invalidation_reason, 'invoice_line_modified');
      await calculate();
      await priced(f, 0.20);
      pass(`V${version}: A product identity correction invalidates its old evidence and restores the older price.`);

      await remove(current);
      current = await save(f, today, 0.25);
      await calculate();
      originalEvidence = await evidence(current);
      for (const [expected, next, price] of [[today, future, 0.20], [future, today, 0.25]]) {
        const result = checked(await db.rpc('correct_invoice_delivery_date', {
          p_restaurant_id: restaurantId, p_invoice_id: current.id, p_actor_id: ownerId,
          p_expected_delivery_date: expected, p_delivery_date: next, p_queue_calculations: true,
        }));
        assert.equal(result.changed, true);
        assert.deepEqual(await evidence(current), originalEvidence);
        await calculate();
        await priced(f, price);
        const invoice = checked(await db.from('invoices').select('date,delivery_date')
          .eq('restaurant_id', restaurantId).eq('id', current.id).single());
        assert.equal(invoice.date, printedDate);
        assert.equal(invoice.delivery_date, next);
      }
      pass(`V${version}: Delivery-date corrections preserve evidence while changing current price eligibility.`);

      await remove(current);
      await calculate();
      await priced(f, 0.20);
      await remove(older);
      await calculate();
      assert.equal((await ingredient(f.a)).price_status, 'needs_review');
      const dish = checked(await db.from('menu_items').select('cost_status')
        .eq('restaurant_id', restaurantId).eq('id', f.dish).single());
      assert.equal(dish.cost_status, 'needs_review');
      assert.equal(checked(await db.from('current_inventory').select('id')
        .eq('restaurant_id', restaurantId).in('ingredient_id', [f.a, f.b])).length, 0);
      pass(`V${version}: Deletion removes supporting evidence; the worker restores fallback pricing or requires review.`);

      checked(await db.from('component_ingredients').delete().eq('component_id', f.component));
      checked(await db.from('menu_item_cost_history').delete()
        .eq('restaurant_id', restaurantId).eq('menu_item_id', f.dish));
      checked(await db.from('menu_item_components').delete().eq('id', f.component));
      checked(await db.from('menu_items').delete().eq('restaurant_id', restaurantId).eq('id', f.dish));
      checked(await db.from('ingredients').delete().eq('restaurant_id', restaurantId).in('id', [f.a, f.b]));
    }
    await expectState(0.25, 0.50, [baseline, incoming, late]);
    assert.equal(checked(await db.from('notification_email_outbox').select('id')
      .eq('restaurant_id', restaurantId)).length, 0);
    pass('V1 and V2 fixtures are removed; original invoice pricing, dish costs, and stock remain correct.');
  } finally {
    for (const [name, value] of [['INVOICE_SUPPORTED_REPRICING_ENABLED', previousFlag],
      ['INVOICE_SUPPORTED_REPRICING_RESTAURANT_ID', previousAllowlist]]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}