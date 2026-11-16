import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';

export async function validateAdminInvoiceSave(context) {
  const { db, restaurantId, ownerId, fixtureName, cedarId, today, printedDate,
    baseline, incoming, late, processJobs, expectState, job, pass } = context;
  const ref = 'hadinygxviofopdejwvj';
  assert.equal(db.supabaseUrl, `https://${ref}.supabase.co`);
  assert.match(fixtureName, /^Phase 6 staging [0-9a-f-]{36}$/);
  assert.notEqual(restaurantId, cedarId);
  const checked = result => {
    if (result.error) throw new Error(result.error.message);
    return result.data;
  };
  const hash = value => createHash('sha256').update(value).digest('hex');
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
  const client = new pg.Client({
    connectionString: url.toString(),
    ssl: { rejectUnauthorized: true,
      ...(caFile ? { ca: readFileSync(caFile, 'utf8') } : {}) },
    connectionTimeoutMillis: 10000, statement_timeout: 15000, query_timeout: 18000,
    application_name: 'optimenu-staging-admin-save',
  });
  const connectionErrors = [];
  client.on('error', error => connectionErrors.push(error));
  const previousFlag = process.env.INVOICE_SUPPORTED_REPRICING_ENABLED;
  const previousAllowlist = process.env.INVOICE_SUPPORTED_REPRICING_RESTAURANT_ID;
  const f = { a: randomUUID(), b: randomUUID(), dish: randomUUID(), component: randomUUID() };
  const testInvoices = [];
  const testLines = [];
  const workers = [];
  const rpcErrors = [];
  let options = {};
  let owned = false;
  let failure;

  const line = async item => checked(await db.from('invoice_items').select('*')
    .eq('invoice_id', item.id).eq('id', item.lineId).single());
  const evidence = async item => checked(await db.from('invoice_supported_price_evidence')
    .select('*').eq('restaurant_id', restaurantId).eq('invoice_item_id', item.lineId).single());
  const decisions = async () => checked(await db.from('invoice_match_decision_audit')
    .select('*').eq('restaurant_id', restaurantId).in('invoice_item_id', testLines).order('id'));

  async function snapshot() {
    const results = await Promise.all([
      ...['invoices', 'ingredients', 'menu_items', 'menu_item_cost_history',
        'current_inventory', 'invoice_supported_price_evidence', 'invoice_match_decision_audit',
        'invoice_match_rejections', 'invoice_ingredient_mappings'].map(table => db.from(table)
        .select('*').eq('restaurant_id', restaurantId).order('id')),
      db.from('invoice_items').select('*').in('invoice_id', testInvoices).order('id'),
      db.from('profiles').select('*').eq('id', ownerId).single(),
      db.from('invoice_calculation_jobs').select('*').eq('restaurant_id', cedarId).maybeSingle(),
    ]);
    return { rows: results.map(checked), job: await job() };
  }

  const adapter = {
    from: (...args) => db.from(...args),
    async rpc(name, args) {
      if (name === 'recipe_setup_catalog') {
        assert.ok([restaurantId, cedarId].includes(args.p_restaurant));
        return db.rpc(name, args);
      }
      assert.equal(name, 'save_admin_invoice_review');
      assert.ok(testInvoices.includes(args.p_invoice_id));
      assert.equal(args.p_admin_id, ownerId);
      await client.query('BEGIN');
      try {
        await client.query("SET LOCAL lock_timeout = '10s'");
        await client.query("SET LOCAL idle_in_transaction_session_timeout = '30s'");
        if (!options.withoutAdmin) {
          const role = await client.query(`UPDATE public.profiles SET role='admin'
            WHERE id=$1 AND restaurant_id=$2 AND role='client'`, [ownerId, restaurantId]);
          assert.equal(role.rowCount, 1);
        }
        const result = await client.query(`SELECT public.save_admin_invoice_review(
          $1::uuid,$2::jsonb,$3::boolean,$4::uuid) AS result`,
        [args.p_invoice_id, JSON.stringify(args.p_lines), args.p_reviewed, args.p_admin_id]);
        if (options.failAfterSave) await client.query('SELECT 1 / 0');
        const restored = await client.query(`UPDATE public.profiles SET role='client'
          WHERE id=$1 AND restaurant_id=$2 AND role='admin'`, [ownerId, restaurantId]);
        assert.equal(restored.rowCount, 1);
        // The fixture role returns to client before any successful transaction commits.
        await client.query('COMMIT');
        return { data: result.rows[0].result, error: null };
      } catch (error) {
        try { await client.query('ROLLBACK'); }
        catch (rollbackError) {
          await client.end().catch(() => {});
          throw new AggregateError([error, rollbackError], 'Admin-save rollback failed.');
        }
        rpcErrors.push(error);
        return { data: null, error };
      }
    },
  };

  async function saveInvoice(ingredientId, date, price) {
    const id = randomUUID();
    const lineId = randomUUID();
    testInvoices.push(id);
    testLines.push(lineId);
    const pricing = { invoice_item_id: lineId, invoice_id: id, restaurant_id: restaurantId,
      ingredient_id: ingredientId, item_name: 'D1 Dijon Mustard',
      quantity: 1, unit: 'qt', unit_cost: price * 32, amount: price * 32 };
    const result = checked(await db.rpc('save_invoice_confirmation_transactional', {
      p_restaurant_id: restaurantId, p_request_id: randomUUID(),
      p_request_fingerprint: hash(id), p_append_to_invoice_id: null,
      p_invoice: { id, supplier: fixtureName, number: id, date: printedDate,
        delivery_date: date, amount: price * 32 }, p_files: [],
      p_lines: [{ id: lineId, invoice_id: id, ingredient_id: ingredientId,
        item_name: pricing.item_name, quantity: 1, unit: 'qt',
        unit_cost: price * 32, amount: price * 32, price_verification_status: 'unknown',
        package_quantity: 32, package_unit: 'fl oz', package_description: '1 quart',
        package_validation_status: 'invoice_document_consistent' }],
      // Trusted synthetic source evidence for this disposable fixture only.
      p_evidence: [{ invoice_item_id: lineId, invoice_id: id, restaurant_id: restaurantId,
        source_type: 'structured_ocr_table', validation_status: 'source_table_consistent',
        evidence_version: 1, source_fingerprint: hash(`${fixtureName}.${lineId}`),
        pricing_fingerprint: hash(JSON.stringify(pricing)),
        evidence: { proof_version: 1, fixture: fixtureName, pricing } }],
      p_queue_calculations: true,
    }));
    assert.equal(result.success, true);
    return { id, lineId };
  }

  async function priced(a, b) {
    for (const [id, price] of [[f.a, a], [f.b, b]]) {
      const row = checked(await db.from('ingredients').select('last_price,price_status,is_estimated')
        .eq('restaurant_id', restaurantId).eq('id', id).single());
      assert.equal(Number(row.last_price), price);
      assert.equal(row.price_status, 'invoice');
      assert.equal(row.is_estimated, false);
    }
    const dish = checked(await db.from('menu_items').select('cost,cost_status')
      .eq('restaurant_id', restaurantId).eq('id', f.dish).single());
    assert.equal(Number(dish.cost), Number((2 * a).toFixed(2)));
    assert.equal(dish.cost_status, 'ready');
  }

  async function stock(item, ingredientId, quantity) {
    const row = checked(await db.from('current_inventory').select('*')
      .eq('restaurant_id', restaurantId).eq('invoice_item_id', item.lineId).single());
    assert.equal(row.ingredient_id, ingredientId);
    assert.equal(row.unit, 'fl oz');
    assert.equal(Number(row.invoiced_qty), quantity);
    assert.equal(Number(row.remaining_qty), quantity);
  }

  async function cleanDecisions() {
    if (!owned || !testLines.length) return;
    // Remove only this disposable fixture's synthetic relationship history for cleanup.
    checked(await db.from('invoice_match_rejections').delete()
      .eq('restaurant_id', restaurantId).eq('rejected_by', ownerId)
      .in('source_invoice_item_id', testLines));
    checked(await db.from('invoice_match_decision_audit').delete()
      .eq('restaurant_id', restaurantId).eq('admin_id', ownerId)
      .in('invoice_item_id', testLines));
  }

  try {
    await client.connect();
    const identity = await client.query(`SELECT r.id FROM public.restaurants r
      JOIN public.profiles p ON p.id=r.user_id
      WHERE r.id=$1 AND r.user_id=$2 AND r.name=$3
        AND p.restaurant_id=r.id AND p.role='client'`, [restaurantId, ownerId, fixtureName]);
    assert.equal(identity.rowCount, 1, 'PostgreSQL fixture identity does not match the API fixture.');
    owned = true;
    process.env.INVOICE_SUPPORTED_REPRICING_ENABLED = 'true';
    process.env.INVOICE_SUPPORTED_REPRICING_RESTAURANT_ID = restaurantId;
    const { createSaveInvoiceItemsHandler } =
      await import('../pages/api/admin/invoice-review/save-items.js');
    const handler = createSaveInvoiceItemsHandler({
      db: adapter,
      processCalculations(database, rid) {
        assert.equal(database, adapter);
        assert.equal(rid, restaurantId);
        const work = processJobs(options.failPricing ? {
          reprice: async () => { throw new Error('Synthetic D1 pricing failure'); },
        } : {});
        workers.push(work.then(value => ({ value }), error => ({ error })));
        return work;
      },
    });

    async function request(items, settings = {}) {
      options = settings;
      const firstWorker = workers.length;
      const before = await job();
      const res = { statusCode: 200,
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; } };
      try {
        // Fixture session only; browser login/MFA is outside this handler-level check.
        await handler({ method: settings.method || 'POST', body: {
          invoice_id: current.id, restaurant_id: settings.restaurantId || restaurantId, items,
        } }, res, settings.noSession ? null : { user: { id: ownerId } });
        await Promise.resolve();
        const reports = await Promise.all(workers.slice(firstWorker));
        const after = await job();
        assert.equal(checked(await db.from('profiles').select('role')
          .eq('id', ownerId).single()).role, 'client');
        assert.equal(reports.length, res.statusCode === 200 ? 1 : 0);
        for (const report of reports) {
          if (report.error) throw report.error;
          assert.equal(report.value.skipped, false);
          if (settings.failPricing) {
            assert.ok(report.value.errors.some(message => message.includes('Synthetic D1 pricing failure')));
          } else assert.deepEqual(report.value.errors, []);
        }
        if (res.statusCode === 200) {
          assert.equal(res.body.success, true);
          assert.equal(res.body.calculationsPending, true);
          assert.equal(BigInt(after.generation), BigInt(before.generation) + 1n);
          if (!settings.failPricing) {
            assert.equal(String(after.completed_generation), String(after.generation));
            assert.equal(after.last_error, null);
          }
        }
        return res;
      } finally {
        options = {};
      }
    }

    checked(await db.from('ingredients').insert([f.a, f.b].map((id, index) => ({
      id, restaurant_id: restaurantId, name: `D1 Dijon Mustard ${index}`,
      unit: 'fl oz', standard_unit: 'fl oz', ingredient_category: 'volume',
      last_price: 0.01, price_status: 'needs_review', is_estimated: true,
    }))));
    checked(await db.from('menu_items').insert({ id: f.dish, restaurant_id: restaurantId,
      name: 'D1 Admin Save Dish', price: 10, category: 'Testing' }));
    checked(await db.from('menu_item_components').insert({
      id: f.component, menu_item_id: f.dish, name: 'Sauce' }));
    checked(await db.from('component_ingredients').insert({
      component_id: f.component, ingredient_id: f.a, quantity: 2, unit: 'fl oz' }));
    const older = new Date(Date.parse(`${today}T00:00:00Z`) - 2 * 86400000).toISOString().slice(0, 10);
    await saveInvoice(f.a, older, 0.20);
    await saveInvoice(f.b, older, 0.15);
    const current = await saveInvoice(f.a, today, 0.25);
    assert.deepEqual((await processJobs()).errors, []);
    await priced(0.25, 0.15);
    await stock(current, f.a, 32);
    const originalEvidence = await evidence(current);
    const originalLine = await line(current);
    const entry = overrides => ({ id: current.lineId, quantity: 1, unit: 'qt',
      unit_cost: 8, amount: 8, ingredient_id: f.a, ...overrides });
    pass('The admin-save fixture starts with evidence-supported prices, recipe cost, and stock.');

    let before = await snapshot();
    assert.equal((await request([entry()], { noSession: true })).statusCode, 403);
    assert.equal((await request([entry()], { method: 'GET' })).statusCode, 405);
    assert.equal((await request([entry(), entry()])).statusCode, 400);
    assert.deepEqual(await snapshot(), before);
    pass('Missing sessions, unsupported methods, and duplicate line submissions save nothing.');

    assert.equal((await request([entry()], { restaurantId: cedarId })).statusCode, 404);
    assert.deepEqual(await snapshot(), before);
    pass('An invoice cannot be saved under another restaurant.');

    assert.equal((await request([entry({ unit_cost: 9.60, amount: 9.60 }),
      entry({ id: randomUUID() })])).statusCode, 500);
    assert.match(rpcErrors.at(-1).message, /Invoice line not found/);
    assert.deepEqual(await snapshot(), before);
    pass('A missing later line rolls back earlier edits, evidence invalidation, and queue changes.');

    assert.equal((await request([entry({ ingredient_id: f.b })], { failAfterSave: true })).statusCode, 500);
    assert.equal(rpcErrors.at(-1).code, '22012');
    assert.deepEqual(await snapshot(), before);
    pass('A database failure after the real save rolls back the link, decision audit, rejection, queue, and role.');

    assert.equal((await request([entry()], { withoutAdmin: true })).statusCode, 500);
    assert.match(rpcErrors.at(-1).message, /Admin access required/);
    assert.deepEqual(await snapshot(), before);
    pass('The database save function independently rejects a non-administrator fixture profile.');

    let response = await request([entry({ ingredient_id: f.b })]);
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.relinked, 1);
    await priced(0.20, 0.25);
    await stock(current, f.b, 32);
    assert.deepEqual(await evidence(current), originalEvidence);
    const audit = await decisions();
    const correction = audit.filter(row => row.action === 'corrected');
    assert.equal(correction.length, 1);
    assert.equal(correction[0].previous_ingredient_id, f.a);
    assert.equal(correction[0].new_ingredient_id, f.b);
    assert.equal(correction[0].admin_id, ownerId);
    assert.equal(audit.filter(row => row.action === 'rejected').length, 1);
    pass('A committed relink preserves evidence, audits the decision, and recalculates both ingredient prices and stock.');

    before = await snapshot();
    assert.equal((await request([entry()])).statusCode, 500);
    assert.match(rpcErrors.at(-1).message, /previously rejected/);
    assert.deepEqual(await snapshot(), before);
    pass('A rejected relationship cannot be silently restored through the admin-save handler.');

    const edited = entry({ ingredient_id: f.b, unit_cost: 9.60, amount: 9.60 });
    response = await request([edited], { failPricing: true });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.changed, 1);
    assert.equal(Number((await line(current)).unit_cost), 9.60);
    const invalidated = await evidence(current);
    assert.ok(invalidated.invalidated_at);
    assert.equal(invalidated.invalidation_reason, 'invoice_line_modified');
    const pending = await job();
    assert.ok(BigInt(pending.completed_generation) < BigInt(pending.generation));
    assert.ok(pending.last_error.includes('Synthetic D1 pricing failure'));
    assert.equal(pending.lease_token, null);
    pass('A saved price correction survives an immediate worker failure with recovery durably queued.');

    assert.deepEqual((await processJobs()).errors, []);
    await priced(0.20, 0.15);
    await stock(current, f.b, 32);
    assert.equal(String((await job()).generation), String((await job()).completed_generation));
    assert.equal((await job()).last_error, null);
    pass('A real retry excludes invalidated pricing evidence and restores the remaining supported prices.');

    const unitEdit = { ...edited, quantity: 2, unit: 'fl oz', unit_cost: 0.30, amount: 0.60,
      package_quantity: 9999, package_unit: 'gal', price_verification_status: 'verified' };
    response = await request([unitEdit]);
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.changed, 1);
    const savedLine = await line(current);
    assert.equal(Number(savedLine.quantity), 2);
    assert.equal(savedLine.unit, 'fl oz');
    for (const field of ['package_quantity', 'package_unit', 'package_description',
      'package_validation_status', 'price_verification_status']) {
      assert.equal(savedLine[field], originalLine[field]);
    }
    assert.deepEqual(await evidence(current), invalidated);
    await priced(0.20, 0.15);
    await stock(current, f.b, 2);
    pass('A physical-unit correction rebuilds stock without accepting submitted package or verification claims.');

    const history = checked(await db.from('menu_item_cost_history').select('*')
      .eq('restaurant_id', restaurantId).eq('menu_item_id', f.dish).order('id'));
    response = await request([unitEdit]);
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.changed, 0);
    assert.equal(response.body.relinked, 0);
    assert.deepEqual(await decisions(), audit);
    assert.deepEqual(checked(await db.from('menu_item_cost_history').select('*')
      .eq('restaurant_id', restaurantId).eq('menu_item_id', f.dish).order('id')), history);
    await stock(current, f.b, 2);
    pass('An unchanged admin save creates no duplicate relationship audit, cost observation, or stock.');

    await cleanDecisions();
    checked(await db.rpc('delete_invoices_transactional', {
      p_restaurant_id: restaurantId, p_invoice_ids: testInvoices, p_queue_calculations: true,
    }));
    assert.deepEqual((await processJobs()).errors, []);
    await expectState(0.25, 0.50, [baseline, incoming, late]);
    assert.equal(checked(await db.from('notification_email_outbox').select('id')
      .eq('restaurant_id', restaurantId)).length, 0);
    assert.equal(connectionErrors.length, 0);
    pass('Admin-save test invoices are removed; original prices, dish costs, and inventory remain correct.');
  } catch (error) {
    failure = error;
  } finally {
    await Promise.all(workers);
    try { await cleanDecisions(); }
    catch (error) { failure = new AggregateError([failure, error].filter(Boolean), 'Admin-save cleanup failed.'); }
    await client.end().catch(() => {});
    for (const [name, value] of [['INVOICE_SUPPORTED_REPRICING_ENABLED', previousFlag],
      ['INVOICE_SUPPORTED_REPRICING_RESTAURANT_ID', previousAllowlist]]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
  if (failure) throw failure;
}