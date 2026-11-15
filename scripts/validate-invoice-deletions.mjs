import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function validateInvoiceDeletions(context) {
  const {
    db, restaurantId, ownerId, fixtureName, cedarId,
    ingredientId, dishId, invoiceIds, today, printedDate, future,
    baseline, incoming, late, saveInvoice, processJobs,
    expectState, job, audits, pass,
  } = context;

  assert.equal(db.supabaseUrl, 'https://hadinygxviofopdejwvj.supabase.co');
  assert.match(fixtureName, /^Phase 6 staging [0-9a-f-]{36}$/);

  const { createDeleteInvoiceHandler } =
    await import('../pages/api/invoices/delete-invoice.js');

  function checked(result) {
    if (result.error) throw new Error(result.error.message);
    return result.data;
  }

  async function snapshot() {
    const results = await Promise.all([
      ...['invoices', 'ingredients', 'menu_items', 'current_inventory',
        'menu_item_cost_history', 'invoice_confirmation_requests',
        'invoice_delivery_date_audit', 'invoice_match_rejections',
        'invoice_match_decision_audit'].map(table => db.from(table)
        .select('*').eq('restaurant_id', restaurantId).order('id')),
      ...['invoice_items', 'invoice_files'].map(table => db.from(table)
        .select('*').in('invoice_id', invoiceIds).order('id')),
    ]);
    return { rows: results.map(checked), job: await job() };
  }

  function reject(result, message) {
    assert.equal(result.error?.code, 'P0001', JSON.stringify(result));
    assert.match(result.error.message, message);
    assert.equal(result.data, null);
  }

  async function deleteViaApi(ids, failPricing = false) {
    const handler = createDeleteInvoiceHandler({
      db,
      // Fixture authorization only; browser session validation is separate.
      verifyAccess: async (req, rid) => rid === restaurantId
        ? { user: { id: ownerId } }
        : { error: 'Wrong staging restaurant', status: 403 },
      processCalculations: async (database, rid) => {
        assert.equal(database, db);
        assert.equal(rid, restaurantId);
        return processJobs(failPricing ? {
          reprice: async () => {
            throw new Error('Synthetic staging deletion pricing failure');
          },
        } : {});
      },
    });

    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
      end() { return this; },
    };

    await handler({
      method: 'POST',
      body: { restaurant_id: restaurantId, invoice_ids: ids },
    }, res);
    return res;
  }

  function completed(response, deleted) {
    assert.equal(response.statusCode, 200, JSON.stringify(response.body));
    assert.equal(response.body.success, true);
    assert.equal(response.body.deleted, deleted);
    assert.equal(response.body.lines_deleted, deleted);
    assert.equal(response.body.calculations_queued, true);
    assert.equal(response.body.calculations_pending, false);
    assert.deepEqual(response.body.calculation_errors, []);
    assert.equal(response.body.storage_cleanup_failed, false);
  }

  async function expectRemoved(invoice) {
    assert.equal(checked(await db.from('invoices').select('id')
      .eq('restaurant_id', restaurantId).eq('id', invoice.id)
      .maybeSingle()), null);

    for (const table of ['invoice_items', 'invoice_files',
      'invoice_confirmation_requests', 'current_inventory']) {
      const rows = checked(await db.from(table).select('id')
        .eq('invoice_id', invoice.id));
      assert.equal(rows.length, 0, `${table} retained deleted invoice rows`);
    }
  }

  async function expectUnpriced(deliveries) {
    const ingredient = checked(await db.from('ingredients').select('*')
      .eq('restaurant_id', restaurantId).eq('id', ingredientId).single());
    const dish = checked(await db.from('menu_items').select('*')
      .eq('restaurant_id', restaurantId).eq('id', dishId).single());
    const stock = checked(await db.from('current_inventory').select('*')
      .eq('restaurant_id', restaurantId));
    const state = await job();

    assert.equal(ingredient.price_status, 'needs_review');
    assert.equal(ingredient.is_estimated, true);
    assert.equal(ingredient.price_approved_at, null);
    assert.equal(Number(ingredient.last_price), 0.20);
    assert.equal(dish.cost_status, 'needs_review');
    assert.ok(dish.cost_issues.length > 0);
    assert.deepEqual(stock.map(row => row.invoice_id).sort(),
      deliveries.map(invoice => invoice.id).sort());
    for (const row of stock) {
      assert.equal(row.ingredient_id, ingredientId);
      assert.equal(row.unit, 'fl oz');
      assert.equal(Number(row.remaining_qty), 32);
    }
    assert.equal(String(state.generation), String(state.completed_generation));
    assert.equal(state.last_error, null);
    assert.equal(state.lease_token, null);
    assert.equal(state.lease_until, null);
  }

  const beforeRejected = await snapshot();
  const cedarJobBefore = checked(await db.from('invoice_calculation_jobs')
    .select('*').eq('restaurant_id', cedarId).maybeSingle());

  reject(await db.rpc('delete_invoices_transactional', {
    p_restaurant_id: cedarId,
    p_invoice_ids: [incoming.id],
    p_queue_calculations: true,
  }), /do not belong/i);
  reject(await db.rpc('delete_invoices_transactional', {
    p_restaurant_id: restaurantId,
    p_invoice_ids: [baseline.id, randomUUID()],
    p_queue_calculations: true,
  }), /do not belong/i);
  assert.deepEqual(await snapshot(), beforeRejected);
  assert.deepEqual(checked(await db.from('invoice_calculation_jobs')
    .select('*').eq('restaurant_id', cedarId).maybeSingle()), cedarJobBefore);
  pass('Wrong-restaurant and partly missing batches reject atomically.');

  for (const table of ['invoice_match_rejections', 'invoice_match_decision_audit']) {
    const id = randomUUID();
    const record = {
      id, restaurant_id: restaurantId, supplier_key: fixtureName,
      product_key: incoming.lineId, reason: fixtureName,
      ...(table === 'invoice_match_rejections' ? {
        ingredient_id: ingredientId, rejected_by: ownerId,
        source_invoice_item_id: incoming.lineId,
      } : {
        invoice_item_id: incoming.lineId, action: 'rejected',
        previous_ingredient_id: ingredientId, admin_id: ownerId,
      }),
    };

    try {
      checked(await db.from(table).insert(record));
      if (table === 'invoice_match_rejections') {
        // Isolate this guard from the audit row created by the rejection trigger.
        checked(await db.from('invoice_match_decision_audit').delete()
          .eq('restaurant_id', restaurantId).eq('reason', fixtureName)
          .eq('admin_id', ownerId).eq('invoice_item_id', incoming.lineId)
          .eq('action', 'rejected'));
      }
      const before = await snapshot();
      reject(await db.rpc('delete_invoices_transactional', {
        p_restaurant_id: restaurantId,
        p_invoice_ids: [baseline.id, incoming.id],
        p_queue_calculations: true,
      }), /protected matching history/i);
      assert.deepEqual(await snapshot(), before);
      pass(`${table} blocks the whole batch without deleting either invoice.`);
    } finally {
      checked(await db.from(table).delete().eq('id', id)
        .eq('restaurant_id', restaurantId).eq('reason', fixtureName));
    }
  }

  const futureInvoice = await saveInvoice(printedDate, future, 9.60);
  checked(await db.from('invoice_files').insert({
    invoice_id: futureInvoice.id,
    file_url: `https://example.invalid/${futureInvoice.id}.pdf`,
    page_number: 1,
  }));
  assert.deepEqual((await processJobs()).errors, []);
  await expectState(0.25, 0.50, [baseline, incoming, late]);
  const beforeFutureDelete = await job();
  completed(await deleteViaApi([futureInvoice.id, futureInvoice.id]), 1);
  await expectRemoved(futureInvoice);
  await expectState(0.25, 0.50, [baseline, incoming, late]);
  assert.equal(BigInt((await job()).generation),
    BigInt(beforeFutureDelete.generation) + 1n);
  pass('Future invoice deletes once, clears file metadata, and leaves current costs unchanged.');

  const auditBefore = await audits();
  const beforeDelete = await job();
  const pendingResponse = await deleteViaApi([incoming.id], true);
  assert.equal(pendingResponse.statusCode, 200);
  assert.equal(pendingResponse.body.success, true);
  assert.equal(pendingResponse.body.deleted, 1);
  assert.equal(pendingResponse.body.calculations_pending, true);
  assert.ok(pendingResponse.body.calculation_errors.some(message =>
    message.includes('Synthetic staging deletion pricing failure')));
  await expectRemoved(incoming);
  const pending = await job();
  assert.equal(BigInt(pending.generation), BigInt(beforeDelete.generation) + 1n);
  assert.equal(String(pending.completed_generation), String(beforeDelete.completed_generation));
  assert.ok(pending.last_error.includes('Synthetic staging deletion pricing failure'));
  assert.equal(pending.lease_token, null);
  assert.deepEqual(await audits(), auditBefore);
  pass('Deletion stays committed and recovery stays queued after a pricing failure.');

  assert.deepEqual((await processJobs()).errors, []);
  await expectState(0.20, 0.40, [baseline, late]);
  pass('Retry restores the remaining verified price, dish cost, and inventory.');

  const beforeDuplicate = await snapshot();
  const duplicate = await deleteViaApi([incoming.id]);
  assert.equal(duplicate.statusCode, 404);
  assert.deepEqual(await snapshot(), beforeDuplicate);
  pass('Repeating deletion creates no new job, stock changes, or cost history.');

  const unverified = await saveInvoice(today, today, 1.60);
  checked(await db.from('invoice_items').update({
    price_verification_status: 'unknown',
    price_verification_source: null,
    price_verified_at: null,
    price_verification_evidence: null,
  }).eq('invoice_id', unverified.id).eq('id', unverified.lineId));
  assert.deepEqual((await processJobs()).errors, []);
  await expectState(0.20, 0.40, [baseline, late, unverified]);
  pass('An unverified purchase adds physical stock without replacing verified pricing.');

  completed(await deleteViaApi([baseline.id, late.id]), 2);
  await expectRemoved(baseline);
  await expectRemoved(late);
  await expectUnpriced([unverified]);
  pass('Deleting both verified sources marks ingredient and dish costs as needing review.');

  completed(await deleteViaApi([unverified.id]), 1);
  await expectRemoved(unverified);
  await expectUnpriced([]);
  for (const table of ['invoices', 'invoice_confirmation_requests', 'current_inventory']) {
    assert.equal(checked(await db.from(table).select('id')
      .eq('restaurant_id', restaurantId)).length, 0);
  }
  for (const table of ['invoice_items', 'invoice_files']) {
    assert.equal(checked(await db.from(table).select('id')
      .in('invoice_id', invoiceIds)).length, 0);
  }
  assert.deepEqual(await audits(), auditBefore);
  assert.equal(checked(await db.from('notification_email_outbox').select('id')
    .eq('restaurant_id', restaurantId)).length, 0);
  pass('Final deletion leaves no invoice, line, receipt, file metadata, or stock; date audit survives.');
}