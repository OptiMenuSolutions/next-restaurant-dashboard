import test from 'node:test';
import assert from 'node:assert/strict';
import { posFixture } from '../scripts/validate-pos-consumption.mjs';
import { shift4Payload, fixtureReader, SHIFT4_LOCATION } from '../scripts/validate-shift4-ingestion.mjs';
import { dishInstructions, requestTexts, verifyCoverage } from '../lib/pos/usageMath.js';

const connection = { shift4_location_id: SHIFT4_LOCATION, shift4_timezone: 'America/New_York' };
const range = { from: '2026-11-16', to: '2026-11-16' };
function setup(options = {}) {
  const fixture = posFixture({ restaurantId: '11111111-1111-4111-8111-111111111111',
    mustardId: '22222222-2222-4222-8222-222222222222', today: range.from });
  const payload = shift4Payload(fixture.tickets);
  const reader = fixtureReader(payload, options);
  return { fixture, payload, ...reader, pull: () => reader.read(connection, range) };
}
const rawItem = (records, index) => records.tickets[index - 1].raw.ticketItems[0];

test('the reader reconciles eight native tickets with financial sales', async () => {
  const records = await setup().pull();
  assert.equal(records.tickets.length, 8);
  assert.equal(records.sales.length, 1);
  assert.equal(records.sales[0].quantity_sold, 6);
  assert.equal(records.sales[0].refunds, 1);
  assert.equal(records.sales[0].revenue, 90);
  assert.doesNotThrow(() => verifyCoverage(records));
});

test('item-level typed requests join by reference despite reversed lookup order', async () => {
  const records = await setup().pull();
  assert.deepEqual(rawItem(records, 5).specialRequests, ['no sauce']);
  assert.deepEqual(records.tickets[4].lines[0].special_requests, ['no sauce']);
});

test('modifier names, references, portions, prices, and typed requests survive lookup', async () => {
  const records = await setup().pull();
  const modifier = records.tickets[2].lines[0].modifiers[0];
  assert.equal(modifier.name, 'extra beef');
  assert.equal(modifier.modifier_ref, 'choice');
  assert.equal(modifier.quantity, 1);
  assert.equal(modifier.price, 2);
  assert.deepEqual(modifier.special_requests, ['extra beef']);
  assert.deepEqual(requestTexts(dishInstructions(rawItem(records, 3))), ['extra beef']);
});

test('typed and preset duplicate removals reach usage as one instruction', async () => {
  const records = await setup().pull();
  assert.deepEqual(requestTexts(dishInstructions(rawItem(records, 2))), ['no onion']);
});

test('lookup quantities and prices cannot overwrite the primary ticket financials', async () => {
  const records = await setup().pull();
  assert.equal(rawItem(records, 1).quantity, 2);
  assert.equal(records.tickets[0].lines[0].quantity, 2);
  assert.equal(records.tickets[0].lines[0].unit_price, 15);
  assert.equal(records.tickets[0].lines[0].item_amount, 30);
});

test('same-name items retain their own POS identities and requests', async () => {
  const state = setup();
  const second = structuredClone(state.payload.raw[0].ticketItems[0]);
  second.posRef = 'another-line';
  second.itemRef = 'another-dish';
  state.payload.raw[0].ticketItems.push(second);
  state.payload.details.get('validation-1').ticketItems.unshift({ posRef: 'another-line',
    specialRequests: ['no bun'], ticketItemModifiers: [] });
  const records = await state.pull();
  assert.equal(records.tickets[0].lines[1].external_line_id, 'another-line');
  assert.equal(records.tickets[0].lines[1].item_ref, 'another-dish');
  assert.deepEqual(records.tickets[0].lines[1].special_requests, ['no bun']);
  assert.deepEqual(records.tickets[0].lines[0].special_requests, []);
});

test('open tickets remain stored but create no financial sales', async () => {
  const state = setup();
  state.payload.raw = [state.payload.raw[6]];
  const records = await state.pull();
  assert.equal(records.tickets.length, 1);
  assert.equal(records.tickets[0].ticket_type, 'open');
  assert.deepEqual(records.sales, []);
  assert.equal(state.calls.length, 1);
});

test('refund quantities remain negative while the separate refund count is positive', async () => {
  const state = setup();
  state.payload.raw = [state.payload.raw[5]];
  const records = await state.pull();
  assert.equal(records.sales[0].quantity_sold, -1);
  assert.equal(records.sales[0].refunds, 1);
  assert.equal(records.sales[0].revenue, -15);
});

test('lookup requests contain closed tickets only and request nested typed instructions', async () => {
  const state = setup();
  await state.pull();
  const lookup = state.calls.find(call => call.method === 'POST').body;
  assert.equal(lookup.filter.refs.length, 7);
  assert.ok(!lookup.filter.refs.some(ref => ref.posRef === 'validation-7'));
  const items = lookup.properties.find(property => property.name === 'ticketItems');
  assert.ok(items.properties.some(property => property.name === 'specialRequests'));
  assert.ok(items.properties.find(property => property.name === 'ticketItemModifiers')
    .properties.some(property => property.name === 'specialRequests'));
});

test('a missing primary results array fails visibly', async () => {
  await assert.rejects(setup({ initial: () => ({}) }).pull(), /missing its results array/);
});

test('an invalid primary results type fails visibly', async () => {
  await assert.rejects(setup({ initial: () => ({ results: {} }) }).pull(), /results array/);
});

test('a valid empty result is an empty pull', async () => {
  const state = setup({ initial: () => ({ results: [] }) });
  assert.deepEqual(await state.pull(), { sales: [], tickets: [] });
  assert.equal(state.calls.length, 1);
});

test('lookup HTTP failure rejects instead of publishing tickets without requested details', async () => {
  await assert.rejects(setup({ status: 403, lookup: () => ({ error: { message: 'Lookup refused' } }) })
    .pull(), /Lookup refused/);
});

test('a missing lookup result collection fails visibly', async () => {
  await assert.rejects(setup({ lookup: () => ({}) }).pull(), /lookup is missing tickets/);
});

test('a missing requested ticket fails visibly', async () => {
  await assert.rejects(setup({ lookup: results => ({ results: results.slice(1) }) }).pull(), /did not return ticket/);
});

test('a missing requested item fails visibly', async () => {
  await assert.rejects(setup({ lookup: results => ({ results: results.map(ticket =>
    ({ ...ticket, ticketItems: [] })) }) }).pull(), /did not return item/);
});

test('a missing requested modifier fails visibly', async () => {
  await assert.rejects(setup({ lookup: results => ({ results: results.map(ticket => ({ ...ticket,
    ticketItems: ticket.ticketItems.map(item => ({ ...item, ticketItemModifiers: [] })) })) }) })
    .pull(), /did not return modifier/);
});

for (const level of ['ticket', 'item', 'modifier']) {
  test(`duplicate ${level} lookup references reject ambiguous joins`, async () => {
    const state = setup({ lookup: results => {
      if (level === 'ticket') results.push(structuredClone(results[0]));
      if (level === 'item') results[0].ticketItems.push(structuredClone(results[0].ticketItems[0]));
      if (level === 'modifier') {
        const item = results.flatMap(ticket => ticket.ticketItems)
          .find(item => item.ticketItemModifiers.length);
        item.ticketItemModifiers.push(structuredClone(item.ticketItemModifiers[0]));
      }
      return { results };
    } });
    await assert.rejects(state.pull(), /duplicate reference/);
  });
}

test('lookup rows without POS references reject', async () => {
  await assert.rejects(setup({ lookup: () => ({ results: [{}] }) }).pull(), /without a POS reference/);
});

test('closed primary tickets without POS references reject before lookup', async () => {
  const state = setup();
  delete state.payload.raw[0].posRef;
  await assert.rejects(state.pull(), /without a POS reference/);
  assert.equal(state.calls.length, 1);
});

test('non-string item instructions reject', async () => {
  await assert.rejects(setup({ lookup: results => {
    results[0].ticketItems[0].specialRequests = [42];
    return { results };
  } }).pull(), /invalid special requests/);
});

test('non-array modifier instructions reject', async () => {
  await assert.rejects(setup({ lookup: results => {
    results.flatMap(ticket => ticket.ticketItems).find(item => item.ticketItemModifiers.length)
      .ticketItemModifiers[0].specialRequests = 'not an array';
    return { results };
  } }).pull(), /invalid special requests/);
});

test('explicit null lookup instructions normalize to empty instructions', async () => {
  const records = await setup({ lookup: results => {
    results.forEach(ticket => ticket.ticketItems.forEach(item => { item.specialRequests = null; }));
    return { results };
  } }).pull();
  assert.deepEqual(rawItem(records, 5).specialRequests, []);
});

test('disabled lookup preserves unavailable typed-request context in raw tickets', async () => {
  const state = setup({ enabled: false });
  const records = await state.pull();
  assert.equal(state.calls.length, 1);
  assert.equal(dishInstructions(rawItem(records, 1)).requests, null);
});

test('lookup batches contain at most 25 references and include the final short batch', async () => {
  const state = setup();
  const records = Array.from({ length: 26 }, (_, index) => state.fixture.ticket(100 + index, 1, []));
  const reader = fixtureReader(shift4Payload(records));
  assert.equal((await reader.read(connection, range)).tickets.length, 26);
  assert.deepEqual(reader.calls.filter(call => call.method === 'POST')
    .map(call => call.body.filter.refs.length), [25, 1]);
});

test('late Eastern sales use the restaurant date after UTC midnight', async () => {
  const state = setup();
  state.payload.raw = [state.payload.raw[0]];
  state.payload.raw[0].openedAt = '2026-11-17T02:00:00Z';
  state.payload.raw[0].closedAt = '2026-11-17T03:00:00Z';
  const records = await state.pull();
  assert.equal(records.sales[0].sale_date, '2026-11-16');
  assert.equal(records.sales[0].hour_of_day, 21);
});

test('the same instant can belong to different restaurant dates', async () => {
  const state = setup();
  state.payload.raw = [state.payload.raw[0]];
  state.payload.raw[0].openedAt = '2026-11-17T02:00:00Z';
  state.payload.raw[0].closedAt = '2026-11-17T03:00:00Z';
  const records = await state.read({ ...connection, shift4_timezone: 'Asia/Tokyo' },
    { from: '2026-11-17', to: '2026-11-17' });
  assert.equal(records.sales[0].sale_date, '2026-11-17');
});

test('repeated provider reads produce identical records without accumulating lookup changes', async () => {
  const state = setup();
  assert.deepEqual(await state.pull(), await state.pull());
});

test('customer identifiers are excluded from saved raw ticket records', async () => {
  const records = await setup().pull();
  for (const ticket of records.tickets) {
    assert.equal(Object.hasOwn(ticket.raw, 'customerName'), false);
    assert.equal(Object.hasOwn(ticket.raw, 'customerRef'), false);
  }
});