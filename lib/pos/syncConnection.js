import { sendCronAlert } from '../cronAlert.js';
import { getProvider } from './registry.js';
import { runUsage } from './runUsage.js';
import { saveTickets } from './saveTickets.js';

export async function syncPosConnection(db, conn, range, { alertName = 'POS sync cron' } = {}) {
  const { data: lease, error: leaseError } = await db.rpc('pos_sync_acquire', {
    target: conn.restaurant_id,
  });
  if (leaseError) {
    console.error('[pos-sync] Could not acquire lease:', leaseError.message);
    throw Object.assign(new Error('POS sync lock is unavailable.'), { code: 'POS_SYNC_LOCK_UNAVAILABLE' });
  }
  if (!lease) {
    throw Object.assign(new Error('Another POS sync is in progress.'), { code: 'POS_SYNC_BUSY' });
  }

  const startedAt = new Date().toISOString();
  const detail = message => `${range.from} through ${range.to}: ${message}`;

  try {
    const provider = getProvider(conn.provider);
    let connection = conn;

    if (conn.provider !== 'shift4' && provider.authType === 'oauth2' && conn.expires_at) {
      const soon = new Date(Date.now() + 5 * 60 * 1000);
      if (new Date(conn.expires_at) < soon) {
        const refreshed = await provider.refresh(conn);
        if (refreshed) {
          const patch = {
            access_token: refreshed.accessToken,
            expires_at: refreshed.expiresAt,
            updated_at: new Date().toISOString(),
          };
          await db.from('pos_connections').update(patch).eq('id', conn.id);
          connection = { ...conn, ...patch };
        }
      }
    }

    const { sales, tickets } = typeof provider.fetchSalesAndTickets === 'function'
      ? await provider.fetchSalesAndTickets(connection, range)
      : { sales: await provider.fetchSales(connection, range), tickets: null };

    const { error: deleteError } = await db
      .from('pos_sales')
      .delete()
      .eq('restaurant_id', conn.restaurant_id)
      .eq('pos_system', conn.provider)
      .is('upload_session_id', null)
      .gte('sale_date', range.from)
      .lte('sale_date', range.to);
    if (deleteError) throw new Error(`pos_sales delete failed: ${deleteError.message}`);

    for (let i = 0; i < sales.length; i += 500) {
      const rows = sales.slice(i, i + 500).map(row => ({
        ...row,
        restaurant_id: conn.restaurant_id,
        pos_system: conn.provider,
        upload_session_id: null,
      }));
      const { error } = await db.from('pos_sales').insert(rows);
      if (error) throw new Error(`pos_sales insert failed: ${error.message}`);
    }

    let ticketCounts = { tickets: 0, lines: 0 };
    let rawTicketsSaved = false;
    if (tickets) {
      try {
        ticketCounts = await saveTickets(db, {
          restaurantId: conn.restaurant_id,
          posSystem: conn.provider,
          tickets,
        });
        rawTicketsSaved = true;
      } catch (error) {
        console.error(`[pos-sync] Ticket save failed for ${conn.restaurant_id}:`, error.message);
        await sendCronAlert(
          alertName,
          `Sales synced but raw tickets failed to save for restaurant ${conn.restaurant_id}.`,
          [detail(error.message)]
        );
      }
    }

    const syncedAt = new Date().toISOString();
    await db.from('pos_connections').update({
      last_synced_at: syncedAt,
      status: 'connected',
      last_error: null,
      updated_at: syncedAt,
    }).eq('id', conn.id);

    let usage = null;
    if (conn.provider === 'shift4') {
      try {
        usage = await runUsage(db, conn.restaurant_id);
        if (usage.error) throw new Error(usage.error);
      } catch (error) {
        usage = { error: error.message };
        console.error('[pos-usage:after-sync]', conn.restaurant_id, error.message);
        await sendCronAlert(
          'POS ingredient usage',
          `Sales saved for ${conn.restaurant_id}, but ingredient usage needs a retry.`,
          [detail(error.message)]
        );
      }
    }

    return {
      rows: sales.length,
      ...ticketCounts,
      rawTicketsSaved,
      usage,
      startedAt,
      finishedAt: new Date().toISOString(),
    };
  } catch (error) {
    const patch = { last_error: error.message, updated_at: new Date().toISOString() };
    if (conn.provider !== 'shift4') patch.status = 'error';
    const { error: updateError } = await db.from('pos_connections').update(patch).eq('id', conn.id);
    if (updateError) console.error('[pos-sync] Could not record failure:', updateError.message);
    throw error;
  } finally {
    try {
      const { error } = await db.rpc('pos_sync_release', {
        target: conn.restaurant_id,
        lease_token: lease,
      });
      if (error) throw error;
    } catch (error) {
      console.error('[pos-sync] Could not release lease:', error.message);
    }
  }
}