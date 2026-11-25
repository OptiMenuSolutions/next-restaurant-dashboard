import {
  calculateInventory,
  readAllInventoryRows,
} from './currentInventory.js';
import { aggregateShift4TicketSales } from './pos/providers/shift4.js';
import {
  missingPosCloseTimestamp,
  posCloseInstant,
} from './pos/usageInventory.js';
import { projectionInstant } from './projections/businessTime.js';
import {
  loadRestaurantTimezone,
  requireRestaurantTimezone,
  restaurantLocalDate,
} from './restaurantTime.js';

function saleKey(row) {
  return JSON.stringify([
    row.sale_date,
    row.hour_of_day ?? null,
    row.item_name.trim().toLowerCase(),
  ]);
}

function coverageError() {
  return Object.assign(
    new Error('Shift4 tickets do not reconcile to the inventory sales input.'),
    { code: 'POS_TICKET_COVERAGE_INCOMPLETE' }
  );
}

function salesByKey(rows) {
  const byKey = new Map();
  for (const row of rows) {
    const key = saleKey(row);
    if (byKey.has(key)) throw coverageError();
    byKey.set(key, row);
  }
  return byKey;
}

// Service-side calculation. Call with the timezone used by the Shift4 sync
// and a business-boundary instant. It returns inventory without publishing it.
export async function calculateInventoryAsOf(
  db,
  restaurantId,
  boundaryAt,
  shift4Timezone
) {
  const instant = projectionInstant(boundaryAt);
  const restaurantTimezone = await loadRestaurantTimezone(db, restaurantId);
  const providerTimezone = requireRestaurantTimezone(shift4Timezone);
  if (providerTimezone !== restaurantTimezone) {
    throw Object.assign(
      new Error('Shift4 time zone must match the restaurant operational time zone.'),
      { code: 'POS_TIMEZONE_MISMATCH' }
    );
  }

  const throughDate = restaurantLocalDate(restaurantTimezone, new Date(instant));

  return calculateInventory(db, restaurantId, throughDate, null, {
    instant,
    async readSales(storedSales) {
      const boundarySales = storedSales.filter(row => row.sale_date === throughDate);
      if (boundarySales.some((row) =>
        row.pos_system !== 'shift4' || row.upload_session_id != null
      )) {
        throw missingPosCloseTimestamp();
      }

      const tickets = await readAllInventoryRows(
        () => db
          .from('pos_tickets')
          .select('id,ticket_type,business_date,closed_at,raw')
          .eq('restaurant_id', restaurantId)
          .eq('pos_system', 'shift4')
          .eq('business_date', throughDate)
          .order('id', { ascending: true }),
        'Shift4 tickets for as-of inventory'
      );

      const closedTickets = [];
      for (const ticket of tickets) {
        if (ticket.ticket_type === 'open') continue;

        const closedAt = posCloseInstant(ticket.closed_at);
        if (!Array.isArray(ticket.raw?.ticketItems)) throw coverageError();

        closedTickets.push({
          closedAt,
          raw: {
            ...ticket.raw,
            type: ticket.ticket_type,
            closedAt: ticket.closed_at,
          },
        });
      }

      const range = { from: throughDate, to: throughDate };

      const fullSales = salesByKey(aggregateShift4TicketSales(
        closedTickets.map(ticket => ticket.raw),
        range,
        providerTimezone
      ));
      const storedByKey = salesByKey(boundarySales);

      if (fullSales.size !== storedByKey.size) throw coverageError();

      for (const [key, stored] of storedByKey) {
        const rebuilt = fullSales.get(key);
        if (
          !rebuilt ||
          rebuilt.quantity_sold !== Number(stored.quantity_sold ?? 0) ||
          rebuilt.refunds !== Number(stored.refunds ?? 0)
        ) {
          throw coverageError();
        }
      }

      const eligibleSales = salesByKey(aggregateShift4TicketSales(
        closedTickets.filter(ticket => ticket.closedAt < instant)
          .map(ticket => ticket.raw),
        range,
        providerTimezone
      ));

      // Preserve the IDs and order used by inventory count replay. Only the
      // quantities are taken from the eligible tickets.
      return storedSales.flatMap((stored) => {
        if (stored.sale_date < throughDate) return [stored];

        const eligible = eligibleSales.get(saleKey(stored));
        if (!eligible) return [];
        return [{
          ...stored,
          quantity_sold: eligible.quantity_sold,
          refunds: eligible.refunds,
        }];
      });
    },
  });
}