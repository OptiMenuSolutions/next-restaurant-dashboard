// Whitelist projection inputs from the existing Shift4 reader.
// Never copy raw ticket payloads, customer/staff fields, prices,
// modifiers or kitchen requests.
import { projectionInstant } from './businessTime.js';

function reference(value) {
  if (
    (typeof value !== 'string' && typeof value !== 'number') ||
    (typeof value === 'number' && !Number.isFinite(value))
  ) {
    throw new Error('Unsupported Shift4 identifier.');
  }

  return String(value);
}

export function shift4ProjectionSnapshot({
  restaurantId,
  connectionId,
  records,
  coverageFrom,
  coverageTo,
  observedAt,
  complete,
  closedOut = false,
}) {
  if (complete !== true || !Array.isArray(records?.tickets)) {
    throw new Error('A fully read Shift4 ticket snapshot is required.');
  }

  if (
    Array.isArray(records.sales) &&
    records.sales.length &&
    !records.tickets.length
  ) {
    throw new Error('Raw Shift4 ticket coverage is missing.');
  }

  return {
    restaurant_id: restaurantId,
    observed_at: observedAt,
    sources: [{
      connection_id: connectionId,
      provider: 'shift4',
      coverage_from: coverageFrom,
      coverage_to: coverageTo,
      complete: true,
      closed_out: closedOut,
      tickets: records.tickets.flatMap(ticket => {
        const items = ticket.raw?.ticketItems;

        if (!Array.isArray(items)) {
          throw new Error('Shift4 ticket items are missing.');
        }

        if (!items.length && (
          ticket.ticket_type === 'open' || !ticket.closed_at ||
          projectionInstant(ticket.closed_at) > projectionInstant(observedAt)
        )) return [];

        if (ticket.opened_at) {
          projectionInstant(ticket.opened_at);
        }

        if (ticket.closed_at) {
          projectionInstant(ticket.closed_at);
        }

        const key = reference(
          ticket.raw.posRef ?? ticket.external_ticket_id
        );

        const state =
          ticket.ticket_type === 'open' ||
          !ticket.closed_at ||
          projectionInstant(ticket.closed_at) >
            projectionInstant(observedAt)
            ? 'open'
            : ticket.ticket_type === 'void' ? 'void' : 'closed';

        return [{
          id: key,
          state,
          opened_at: ticket.opened_at,
          lines: items.map((item, index) => ({
            id: reference(
              item.posRef ?? item.id ?? `${key}:${index}`
            ),
            item_id: item.itemRef == null
              ? null
              : reference(item.itemRef),
            at:
              item.addedAt ||
              ticket.closed_at ||
              ticket.opened_at,
            kind: item.type,
            quantity: item.quantity,
            non_sales_revenue: item.isNonSalesRevenue === true,
          })),
        }];
      }),
    }],
  };
}