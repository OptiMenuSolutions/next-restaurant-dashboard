// lib/pos/saveTickets.js
//
// Saves raw POS tickets and their item lines to pos_tickets and pos_ticket_lines.
// Safe to re-run over the same days: tickets upsert on their POS ticket id, and
// each saved ticket's lines are deleted and rewritten, so a check that was
// reopened, edited or partly voided after an earlier sync ends up correct.
//
// Called by sync-all-pos with the service role client (RLS has no insert
// policy for these tables on purpose; only the server writes them).

const UPSERT_CHUNK = 500;
// Deletes filter with .in(), which travels in the URL, so keep id lists short.
const DELETE_CHUNK = 100;

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * @param {object} supabase - service role Supabase client
 * @param {object} args
 * @param {string} args.restaurantId
 * @param {string} args.posSystem - e.g. 'shift4'
 * @param {array}  args.tickets - from a provider's fetchSalesAndTickets().tickets:
 *   { external_ticket_id, ticket_type, opened_at, closed_at, business_date, raw, lines: [...] }
 * @returns {{ tickets: number, lines: number }}
 */
export async function saveTickets(supabase, { restaurantId, posSystem, tickets }) {
  if (!tickets || tickets.length === 0) return { tickets: 0, lines: 0 };

  const syncedAt = new Date().toISOString();
  // Every field the provider sends except lines becomes a pos_tickets column.
  const ticketRows = tickets.map(({ lines, ...t }) => ({
    ...t,
    raw: t.raw ?? null,
    restaurant_id: restaurantId,
    pos_system: posSystem,
    synced_at: syncedAt,
  }));

  // 1. Upsert tickets and collect their row ids.
  const idByExternal = new Map();
  for (const part of chunk(ticketRows, UPSERT_CHUNK)) {
    const { data, error } = await supabase
      .from('pos_tickets')
      .upsert(part, { onConflict: 'restaurant_id,pos_system,external_ticket_id' })
      .select('id, external_ticket_id');
    if (error) throw new Error(`pos_tickets upsert failed: ${error.message}`);
    for (const row of data || []) idByExternal.set(row.external_ticket_id, row.id);
  }

  // 2. Clear the existing lines of every ticket we just saved.
  const ticketIds = [...idByExternal.values()];
  for (const part of chunk(ticketIds, DELETE_CHUNK)) {
    const { error } = await supabase.from('pos_ticket_lines').delete().in('ticket_id', part);
    if (error) throw new Error(`pos_ticket_lines delete failed: ${error.message}`);
  }

  // 3. Write the current lines.
  const lineRows = [];
  for (const t of tickets) {
    const ticketId = idByExternal.get(t.external_ticket_id);
    if (!ticketId) continue;
    for (const line of t.lines || []) {
      lineRows.push({ ...line, ticket_id: ticketId, restaurant_id: restaurantId });
    }
  }
  for (const part of chunk(lineRows, UPSERT_CHUNK)) {
    const { error } = await supabase.from('pos_ticket_lines').insert(part);
    if (error) throw new Error(`pos_ticket_lines insert failed: ${error.message}`);
  }

  return { tickets: ticketRows.length, lines: lineRows.length };
}