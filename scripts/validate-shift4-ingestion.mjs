import assert from 'node:assert/strict';
import { createShift4TicketReader } from '../lib/pos/providers/shift4.js';
import { signRequest } from '../lib/pos/hmac-auth.js';
import { validatePosConsumption } from './validate-pos-consumption.mjs';

const HOST = 'https://shift4-validation.invalid';
const KEY = 'synthetic-validation-key';
const SECRET = 'synthetic-validation-secret';
export const SHIFT4_LOCATION = 900001;

export function shift4Payload(tickets) {
  const details = new Map();
  const raw = tickets.map(ticket => {
    const items = ticket.raw.ticketItems.map(source => {
      const typed = [...(source.specialRequests || [])];
      const modifiers = [];
      if (typed.includes('extra beef') || typed.includes('chicken instead')) {
        const text = typed.splice(0, 1)[0];
        modifiers.push({ posRef: `${source.posRef}-modifier`, modifierRef: 'choice',
          name: text, type: 'sale', quantity: 1, price: 200, unitPrice: 200 });
      } else if (typed.includes('no onion')) {
        modifiers.push({ posRef: `${source.posRef}-modifier`, modifierRef: 'no-onion',
          name: 'Sandwich No: Onion', type: 'sale', quantity: 1, price: 0, unitPrice: 0 });
      }
      const item = { ...source, unitPrice: 1500, itemAmount: 1500 * source.quantity,
        discountAmount: 0, modifierAmount: modifiers.length ? 200 : 0,
        ticketItemModifiers: modifiers };
      delete item.specialRequests;
      return { item, detail: { posRef: source.posRef, specialRequests: typed,
        quantity: 999, itemAmount: 999999,
        ticketItemModifiers: modifiers.map(modifier => ({ posRef: modifier.posRef,
          specialRequests: [modifier.name], quantity: 999, price: 999999 })).reverse() } };
    });
    details.set(ticket.external_ticket_id, { posRef: ticket.external_ticket_id,
      ticketItems: items.map(value => value.detail).reverse() });
    return { posRef: ticket.external_ticket_id, type: ticket.ticket_type,
      openedAt: `${ticket.business_date}T17:00:00Z`,
      closedAt: ticket.ticket_type === 'open' ? null : `${ticket.business_date}T18:00:00Z`,
      orderNumber: ticket.raw.orderNumber, customerName: 'Synthetic customer',
      customerRef: 'synthetic-customer', totalItems: 12300, totalGrand: 12300,
      ticketItems: items.map(value => value.item) };
  });
  return { raw, details };
}

export function fixtureReader(payload, {
  enabled = true, initial = null, lookup = null, status = 200,
} = {}) {
  const calls = [];
  const read = createShift4TicketReader({
    apiBase: HOST, clientId: KEY, clientSecret: SECRET, specialRequestsEnabled: enabled,
    request: async (input, options) => {
      const url = new URL(input);
      assert.equal(url.origin, HOST, 'No live Shift4 host is allowed.');
      const method = options.method || 'GET';
      const body = options.body || '';
      assert.equal(options.headers['x-access-key'], KEY);
      assert.equal(options.headers['x-signature'], signRequest({ clientId: KEY,
        clientSecret: SECRET, method, path: url.pathname, body,
        timestamp: options.headers['x-timestamp'] }));
      calls.push({ method, path: url.pathname, body: body ? JSON.parse(body) : null });
      if (url.pathname === `/pos/v2/${SHIFT4_LOCATION}/tickets`) {
        assert.equal(method, 'GET');
        return Response.json(initial ? initial(payload.raw, url) : { results: structuredClone(payload.raw) });
      }
      assert.equal(url.pathname, '/pos/v2/lookup/tickets');
      assert.equal(method, 'POST');
      const request = JSON.parse(body);
      assert.ok(request.filter.refs.length <= 25);
      assert.ok(request.filter.refs.every(ref => ref.locationId === SHIFT4_LOCATION));
      const results = request.filter.refs.map(ref => structuredClone(payload.details.get(ref.posRef))).reverse();
      return Response.json(lookup ? lookup(results) : { results }, { status });
    },
  });
  return { read, calls };
}

export async function validateShift4Ingestion(context) {
  const { db, restaurantId, today, pass } = context;
  let pulls = 0;
  const range = { from: today, to: today };
  const connection = { shift4_location_id: SHIFT4_LOCATION, shift4_timezone: 'America/New_York' };
  const ingestTickets = async tickets => {
    const { read, calls } = fixtureReader(shift4Payload(tickets));
    const records = await read(connection, range);
    assert.equal(records.tickets.length, tickets.length);
    assert.equal(calls.length, 2);
    assert.ok(records.tickets.every(ticket =>
      !Object.hasOwn(ticket.raw, 'customerName') && !Object.hasOwn(ticket.raw, 'customerRef')));
    if (pulls++ === 0) {
      assert.equal(records.sales.length, 1);
      assert.equal(records.sales[0].quantity_sold, 6);
      assert.equal(records.sales[0].refunds, 1);
      assert.equal(records.sales[0].revenue, 90);
      assert.equal(records.tickets[0].raw.ticketItems[0].quantity, 2);
      pass('The real Shift4 reader preserves source quantities and money while joining reordered lookup details by ID.');
    }
    return records.tickets;
  };
  await validatePosConsumption({ ...context, ingestTickets });
  assert.equal(pulls, 4);
  const checked = result => {
    if (result.error) throw new Error(result.error.message);
    return result.data;
  };
  const tickets = async () => checked(await db.from('pos_tickets')
    .select('external_ticket_id,raw').eq('restaurant_id', restaurantId).order('external_ticket_id'));
  const lines = async () => checked(await db.from('pos_ticket_lines')
    .select('external_line_id,quantity,modifiers,special_requests')
    .eq('restaurant_id', restaurantId).order('external_line_id'));
  const savedTickets = await tickets();
  const savedLines = await lines();
  assert.equal(savedTickets.length, 9);
  assert.equal(savedLines.length, 9);
  const extra = savedLines.find(line => line.external_line_id === 'line-3');
  assert.equal(extra.quantity, 1);
  assert.equal(extra.modifiers[0].name, 'extra beef');
  assert.equal(extra.modifiers[0].quantity, 1);
  assert.deepEqual(extra.modifiers[0].special_requests, ['extra beef']);
  assert.deepEqual(savedLines.find(line => line.external_line_id === 'line-5').special_requests, ['no sauce']);
  const result = checked(await db.from('pos_usage_results').select('report')
    .eq('restaurant_id', restaurantId).single());
  const blocked = result.report.filter(row => row.status === 'blocked');
  assert.equal(blocked.length, 1);
  assert.match(blocked[0].reason, /chef's choice/);
  pass('Saved raw tickets, child lines, and the usage report retain modifier and typed-request meaning.');

  const source = [{ external_ticket_id: 'rejected', ticket_type: 'closed', business_date: today,
    raw: { ticketItems: [{ posRef: 'rejected-line', itemRef: 'validation-burger',
      name: 'Validation Burger', type: 'sale', quantity: 1, specialRequests: [] }] } }];
  const bad = fixtureReader(shift4Payload(source), {
    lookup: results => ({ results: results.map(ticket => ({ ...ticket, ticketItems: [] })) }),
  });
  const { saveTickets } = await import('../lib/pos/saveTickets.js');
  let savedInvalid = false;
  await assert.rejects(async () => {
    const records = await bad.read(connection, range);
    savedInvalid = true;
    await saveTickets(db, { restaurantId, posSystem: 'shift4', tickets: records.tickets });
  }, /did not return item/);
  assert.equal(savedInvalid, false);
  assert.deepEqual(await tickets(), savedTickets);
  assert.deepEqual(await lines(), savedLines);
  pass('An incomplete lookup fails before saving and preserves previously stored tickets and modifiers.');
}