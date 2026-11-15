import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';

export async function validateInvoiceConcurrency(context) {
  const {
    db, restaurantId, ownerId, fixtureName, cedarId, ingredientId,
    invoiceIds, today, printedDate, future, baseline, incoming, late,
    correct, processJobs, expectState, job, audits, pass,
  } = context;

  assert.equal(db.supabaseUrl, 'https://hadinygxviofopdejwvj.supabase.co');
  assert.match(fixtureName, /^Phase 6 staging [0-9a-f-]{36}$/);

  const fixture = checked(await db.from('restaurants').select('id,name,user_id')
    .eq('id', restaurantId).single());
  assert.equal(fixture.name, fixtureName);
  assert.equal(fixture.user_id, ownerId);

  const { repriceFromInvoices } = await import('../lib/admin/invoiceLines.js');
  const { inventoryBuild } = await import('../lib/inventoryBuild.js');
  const { calculateInventory, rebuildCurrentInventory } =
    await import('../lib/currentInventory.js');

  function checked(result) {
    if (result.error) throw new Error(result.error.message);
    return result.data;
  }

  function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
  }

  async function bounded(promise, label) {
    let timer;
    try {
      return await Promise.race([
        promise,
        new Promise((resolve, reject) => {
          timer = setTimeout(() => reject(new Error(`${label} timed out`)), 20000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async function parallel(requests) {
    const results = await Promise.allSettled(requests);
    for (const result of results) {
      if (result.status === 'rejected') throw result.reason;
    }
    return results.map(result => result.value);
  }

  // Always release pauses and await the work before fixture cleanup can run.
  async function controlled(start, pauseAt, exercise) {
    const gates = new Map(pauseAt.map(index => [index, {
      entered: deferred(), released: deferred(),
    }]));
    const samples = [];
    const pause = async sample => {
      samples.push(sample);
      const gate = gates.get(samples.length);
      if (gate) {
        gate.entered.resolve();
        await gate.released.promise;
      }
    };
    const settled = Promise.resolve().then(() => start(pause)).then(
      value => ({ value }), error => ({ error })
    );
    let failure;
    try {
      await exercise({
        samples,
        wait: index => bounded(Promise.race([
          gates.get(index).entered.promise,
          settled.then(result => {
            throw result.error || new Error(
              `Work ended before pause ${index}: ${JSON.stringify(result.value)}`
            );
          }),
        ]), `Pause ${index}`),
        release: index => gates.get(index).released.resolve(),
      });
    } catch (error) {
      failure = error;
    } finally {
      for (const gate of gates.values()) gate.released.resolve();
    }
    const result = await settled;
    if (failure) throw failure;
    if (result.error) throw result.error;
    return { value: result.value, samples };
  }

  const history = async () => checked(await db.from('menu_item_cost_history')
    .select('*').eq('restaurant_id', restaurantId).order('id'));
  const stock = async () => checked(await db.from('current_inventory')
    .select('*').eq('restaurant_id', restaurantId).order('invoice_item_id'))
    .map(({ id, computed_at, ...row }) => row);
  const readInvoice = async () => checked(await db.from('invoices')
    .select('id,date,delivery_date').eq('restaurant_id', restaurantId)
    .eq('id', incoming.id).single());
  const lineBefore = checked(await db.from('invoice_items').select('*')
    .eq('invoice_id', incoming.id).eq('id', incoming.lineId).single());
  const cedarBefore = checked(await db.from('invoice_calculation_jobs')
    .select('*').eq('restaurant_id', cedarId).maybeSingle());
  assert.deepEqual(checked(await db.from('ingredients').select('id')
    .eq('restaurant_id', restaurantId)), [{ id: ingredientId }]);

  async function move(expected, next) {
    const result = checked(await correct(incoming, expected, next));
    assert.equal(result.changed, true);
    incoming.deliveryDate = next;
    return result;
  }

  async function restoreToday() {
    const invoice = await readInvoice();
    if (invoice.delivery_date !== today) await move(invoice.delivery_date, today);
    incoming.deliveryDate = today;
    assert.deepEqual((await processJobs()).errors, []);
    await expectState(0.25, 0.50, [baseline, incoming, late]);
  }

  const beforeEdits = await job();
  const beforeAuditCount = (await audits()).length;
  const edits = await parallel([
    correct(incoming, today, future),
    correct(incoming, today, printedDate),
  ]);
  assert.equal(edits.filter(result => !result.error && result.data?.changed).length, 1);
  const conflict = edits.find(result => result.error);
  assert.equal(conflict?.error.code, 'PT409', JSON.stringify(edits));
  assert.equal(conflict.status, 409);
  assert.equal((await audits()).length, beforeAuditCount + 1);
  assert.equal(BigInt((await job()).generation), BigInt(beforeEdits.generation) + 1n);
  assert.equal((await readInvoice()).delivery_date,
    edits.find(result => !result.error).data.invoice.delivery_date);
  await restoreToday();
  pass('Competing date edits produce one saved change and one explicit conflict.');

  const beforeIdentical = await job();
  const identicalAuditCount = (await audits()).length;
  const identical = (await parallel([
    correct(incoming, today, future), correct(incoming, today, future),
  ])).map(checked);
  assert.deepEqual(identical.map(result => result.changed).sort(), [false, true]);
  assert.equal((await audits()).length, identicalAuditCount + 1);
  assert.equal(BigInt((await job()).generation), BigInt(beforeIdentical.generation) + 1n);
  await restoreToday();
  pass('Identical concurrent date retries create one audit and one job generation.');

  function confirmation(requestId, unitPrice) {
    const id = randomUUID();
    invoiceIds.push(id);
    const request = {
      p_restaurant_id: restaurantId, p_request_id: requestId,
      p_append_to_invoice_id: null,
      p_invoice: {
        id, supplier: fixtureName, number: id, date: printedDate,
        delivery_date: future, amount: unitPrice,
      },
      p_files: [],
      p_lines: [{
        id: randomUUID(), invoice_id: id, ingredient_id: ingredientId,
        item_name: 'Dijon Mustard', quantity: 1, unit: 'qt',
        unit_cost: unitPrice, amount: unitPrice,
        price_verification_status: 'verified',
        price_verification_source: 'synthetic_staging_fixture',
        price_verified_at: new Date().toISOString(),
        price_verification_evidence: { fixture: fixtureName },
      }],
      p_evidence: [], p_queue_calculations: true,
    };
    return { ...request, p_request_fingerprint: createHash('sha256')
      .update(JSON.stringify(request)).digest('hex') };
  }

  const same = confirmation(randomUUID(), 9.60);
  const beforeConfirmation = await job();
  const receipts = (await parallel(Array.from({ length: 4 }, () =>
    db.rpc('save_invoice_confirmation_transactional', same)))).map(checked);
  assert.equal(receipts.filter(result => result.replayed === false).length, 1);
  assert.equal(receipts.filter(result => result.replayed === true).length, 3);
  assert.ok(receipts.every(result => result.invoice_id === same.p_invoice.id));
  assert.equal(checked(await db.from('invoice_items').select('id')
    .eq('invoice_id', same.p_invoice.id)).length, 1);
  assert.equal(checked(await db.from('invoice_confirmation_requests').select('id')
    .eq('restaurant_id', restaurantId).eq('request_id', same.p_request_id)).length, 1);
  assert.equal(BigInt((await job()).generation), BigInt(beforeConfirmation.generation) + 1n);
  pass('Four parallel confirmation retries save one invoice, line, receipt, and job generation.');

  const requestId = randomUUID();
  const options = [confirmation(requestId, 9.60), confirmation(requestId, 12.80)];
  const beforeConflict = await job();
  const outcomes = await parallel(options.map(request =>
    db.rpc('save_invoice_confirmation_transactional', request)));
  const winner = outcomes.find(result => !result.error)?.data;
  const loser = outcomes.find(result => result.error);
  assert.equal(winner?.success, true, JSON.stringify(outcomes));
  assert.equal(loser?.error.code, 'P0001', JSON.stringify(outcomes));
  assert.match(loser.error.message, /reused with different contents/i);
  assert.equal(checked(await db.from('invoices').select('id')
    .eq('restaurant_id', restaurantId)
    .in('id', options.map(request => request.p_invoice.id))).length, 1);
  assert.equal(checked(await db.from('invoice_confirmation_requests').select('id')
    .eq('restaurant_id', restaurantId).eq('request_id', requestId)).length, 1);
  assert.equal(BigInt((await job()).generation), BigInt(beforeConflict.generation) + 1n);
  pass('Conflicting concurrent confirmations cannot overwrite the winning receipt.');

  async function finish(claim, error) {
    checked(await db.rpc('finish_invoice_calculations', {
      p_restaurant_id: restaurantId, p_lease: claim.lease_token,
      p_generation: claim.generation, p_error: error,
    }));
  }

  let activeClaim;
  try {
    const claims = (await parallel([
      db.rpc('claim_invoice_calculations', { p_restaurant_id: restaurantId }),
      db.rpc('claim_invoice_calculations', { p_restaurant_id: restaurantId }),
    ])).map(checked);
    assert.deepEqual(claims.map(rows => rows.length).sort(), [0, 1]);
    activeClaim = claims.flat()[0];
    assert.equal((await job()).lease_token, activeClaim.lease_token);
    pass('Competing claim requests grant exactly one worker lease.');

    const oldClaim = activeClaim;
    await finish(oldClaim, 'Synthetic staging claim release');
    activeClaim = null;
    const next = checked(await db.rpc('claim_invoice_calculations', {
      p_restaurant_id: restaurantId,
    }));
    assert.equal(next.length, 1);
    activeClaim = next[0];
    assert.notEqual(activeClaim.lease_token, oldClaim.lease_token);
    const beforeStaleFinish = await job();
    await finish(oldClaim, null);
    assert.deepEqual(await job(), beforeStaleFinish);
    pass('An old lease cannot finish or clear a newer worker lease.');
  } finally {
    if (activeClaim) await finish(activeClaim, 'Synthetic staging claim release');
  }

  const worker = pause => processJobs({
    reprice: async (...args) => {
      const claimed = await job();
      await repriceFromInvoices(...args);
      await pause(claimed);
    },
  });

  const historyBefore = await history();
  const exclusive = await controlled(worker, [1], async gate => {
    await gate.wait(1);
    const held = await job();
    let duplicateReprices = 0;
    const duplicate = await processJobs({ reprice: async (...args) => {
      duplicateReprices++;
      await repriceFromInvoices(...args);
    } });
    assert.equal(duplicate.skipped, true);
    assert.deepEqual(duplicate.errors, []);
    assert.equal(duplicateReprices, 0);
    assert.deepEqual(await job(), held);
  });
  assert.deepEqual(exclusive.value.errors, []);
  assert.equal(exclusive.samples.length, 1);
  await expectState(0.25, 0.50, [baseline, incoming, late]);
  assert.deepEqual(await history(), historyBefore);
  pass('A second full worker skips an active lease without duplicating cost history.');

  await move(today, future);
  const catchup = await controlled(worker, [1], async gate => {
    await gate.wait(1);
    const held = await job();
    await move(future, today);
    const queued = await job();
    assert.equal(queued.lease_token, held.lease_token);
    assert.equal(String(queued.completed_generation), String(held.completed_generation));
    assert.equal(BigInt(queued.generation), BigInt(held.generation) + 1n);
    assert.equal((await processJobs()).skipped, true);
  });
  assert.deepEqual(catchup.value.errors, []);
  assert.equal(catchup.samples.length, 2);
  assert.equal(String(catchup.samples[1].completed_generation),
    String(catchup.samples[0].generation));
  assert.notEqual(catchup.samples[1].lease_token, catchup.samples[0].lease_token);
  await expectState(0.25, 0.50, [baseline, incoming, late]);
  pass('A correction during calculation survives the old completion and runs in a second pass.');

  await move(today, future);
  const boundedWorker = await controlled(worker, [1, 2], async gate => {
    await gate.wait(1);
    await move(future, today);
    gate.release(1);
    await gate.wait(2);
    await move(today, future);
  });
  assert.deepEqual(boundedWorker.value.errors, []);
  assert.equal(boundedWorker.samples.length, 2);
  const stillPending = await job();
  assert.equal(String(stillPending.completed_generation),
    String(boundedWorker.samples[1].generation));
  assert.equal(BigInt(stillPending.generation), BigInt(stillPending.completed_generation) + 1n);
  assert.equal(stillPending.lease_token, null);
  assert.deepEqual((await processJobs()).errors, []);
  await expectState(0.20, 0.40, [baseline, late]);
  await restoreToday();
  pass('A correction during the second pass stays queued for the next worker.');

  const removed = checked(await db.rpc('delete_invoices_transactional', {
    p_restaurant_id: restaurantId,
    p_invoice_ids: [same.p_invoice.id, winner.invoice_id],
    p_queue_calculations: true,
  }));
  assert.equal(removed.success, true);
  assert.equal(removed.deleted, 2);
  assert.equal(checked(await db.from('invoices').select('id')
    .eq('restaurant_id', restaurantId)
    .in('id', [same.p_invoice.id, winner.invoice_id])).length, 0);
  assert.deepEqual((await processJobs()).errors, []);
  await expectState(0.25, 0.50, [baseline, incoming, late]);

  let afterNewerBuild;
  const rebuilt = await controlled(pause => inventoryBuild(
    db, restaurantId, async (...args) => {
      const calculated = await calculateInventory(...args);
      await pause(calculated.rows.length);
      return calculated;
    }
  ), [1], async gate => {
    await gate.wait(1);
    await rebuildCurrentInventory(db, restaurantId);
    afterNewerBuild = await stock();
  });
  assert.equal(rebuilt.samples.length, 2);
  assert.deepEqual(await stock(), afterNewerBuild);
  await expectState(0.25, 0.50, [baseline, incoming, late]);
  assert.deepEqual(checked(await db.from('invoice_items').select('*')
    .eq('invoice_id', incoming.id).eq('id', incoming.lineId).single()), lineBefore);
  assert.equal((await readInvoice()).date, printedDate);
  assert.deepEqual(checked(await db.from('invoice_calculation_jobs')
    .select('*').eq('restaurant_id', cedarId).maybeSingle()), cedarBefore);
  assert.equal(checked(await db.from('notification_email_outbox').select('id')
    .eq('restaurant_id', restaurantId)).length, 0);
  pass('An overlapping inventory build retries its stale token without duplicate stock.');
}