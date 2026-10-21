// pages/api/admin/tags/action.js
// POST { action, ... }
//   create-kit   { restaurantId, kind: plan|replacement, delivery: mail|hand, shipTo, notes }
//   sell         { restaurantId, qty, price, payment: card|invoice|paid, delivery }
//   mark-written { tagId }          you wrote it; now waiting for your test tap
//   confirm      { tagId }          confirm without a test tap
//   pack         { kitId }          takes the kit off the shelf
//   ship         { kitId, carrier, tracking, postage }
//   handoff      { kitId }          hand delivered: sent and delivered at once
//   delivered    { kitId }          the mailed box arrived; tags go live
//   cancel-kit   { kitId }          only before it is packed
//   tag-status   { tagId, status: active|off }
//   clear-spot   { tagId }          the next tap asks where it is again
//   restock      { item, qty, cost, note }
//   set-stock    { item, onHand, reorderAt }
//   save-setting { key, value }     ship_from or extra_tag_price
// Kit costs are copied onto the client's one-off costs when the kit is made,
// at today's setting, so changing the setting later never rewrites old kits.

import stripe from '../../../../lib/stripeServer';
import { adminDb as db, requireAdmin } from '../../../../lib/admin/requireAdmin';
import { writeAuditLog } from '../../../../lib/admin/withAdminAuth';
import { getSettings } from '../../../../lib/admin/settings';
import { KIT_SIZE, kitUsage } from '../../../../lib/admin/kits';

const ITEMS = ['tags', 'boxes', 'foam', 'cards'];
const today = () => new Date().toISOString().slice(0, 10);

async function newTags(restaurantId, kitId, n) {
  const rows = Array.from({ length: n }, () => ({ restaurant_id: restaurantId, kit_id: kitId, status: 'pending' }));
  const { data, error } = await db.from('nfc_tags').insert(rows).select('id, label');
  if (error) throw new Error(error.message);
  return data;
}

async function moveStock(item, qty, extra = {}) {
  const { data: row } = await db.from('admin_inventory').select('on_hand').eq('item', item).single();
  if (!row) return;
  await db.from('admin_inventory').update({ on_hand: (row.on_hand || 0) + qty }).eq('item', item);
  await db.from('admin_inventory_moves').insert({ item, qty, ...extra });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const b = req.body || {};
  const now = new Date().toISOString();

  const restaurantOf = async (id) => (await db.from('restaurants').select('id, name, stripe_customer_id').eq('id', id).single()).data;
  const log = (action, r, metadata = {}) => writeAuditLog({
    admin_id: admin.user.id, admin_name: admin.name, action,
    target_restaurant_id: r?.id || null, target_restaurant_name: r?.name || null, metadata,
  });
  const getKit = async () => {
    const { data } = await db.from('admin_tag_kits').select('*').eq('id', b.kitId).single();
    if (!data) throw Object.assign(new Error('Kit not found'), { status: 404 });
    return data;
  };
  const getTag = async () => {
    const { data } = await db.from('nfc_tags').select('*').eq('id', b.tagId).single();
    if (!data) throw Object.assign(new Error('Tag not found'), { status: 404 });
    return data;
  };

  try {
    switch (b.action) {
      case 'create-kit': {
        const r = await restaurantOf(b.restaurantId);
        if (!r) return res.status(404).json({ error: 'Restaurant not found' });
        const kind = b.kind === 'replacement' ? 'replacement' : 'plan';
        const delivery = b.delivery === 'hand' ? 'hand' : 'mail';
        if (delivery === 'mail' && !String(b.shipTo || '').trim()) return res.status(400).json({ error: 'Add the address to mail it to' });
        const { data: kit, error } = await db.from('admin_tag_kits').insert({
          restaurant_id: r.id, kind, delivery, ship_to: String(b.shipTo || '').trim() || null, notes: String(b.notes || '').trim() || null,
        }).select('*').single();
        if (error) throw new Error(error.message);
        const tags = await newTags(r.id, kit.id, KIT_SIZE[kind]);
        const s = await getSettings(db);
        const cost = kind === 'plan' ? Number(s.kit_cost || 0) : Number(s.tag_cost || 0);
        if (cost > 0) {
          await db.from('admin_client_costs').insert({ restaurant_id: r.id, spent_on: today(), what: kind === 'plan' ? 'Tag kit' : 'Replacement tag', source: `Tag kits · ${tags.map((t) => t.label).join(', ')}`, amount: cost });
        }
        await log(`Started a ${kind === 'plan' ? 'tag kit' : 'replacement tag'}`, r, { kit_id: kit.id, tags: tags.map((t) => t.label) });
        return res.status(200).json({ ok: true, kitId: kit.id });
      }

      case 'sell': {
        const r = await restaurantOf(b.restaurantId);
        if (!r) return res.status(404).json({ error: 'Restaurant not found' });
        const qty = Math.min(Math.max(parseInt(b.qty, 10) || 0, 1), 20);
        const price = Number(b.price);
        if (!(price >= 0)) return res.status(400).json({ error: 'Set a price per tag' });
        const payment = ['card', 'invoice', 'paid'].includes(b.payment) ? b.payment : 'paid';
        const cents = Math.round(qty * price * 100);
        if (payment !== 'paid' && cents > 0) {
          if (!r.stripe_customer_id) return res.status(400).json({ error: 'No Stripe customer. Mark it already paid instead.' });
          await stripe.invoiceItems.create({ customer: r.stripe_customer_id, amount: cents, currency: 'usd', description: `${qty} extra NFC tag${qty === 1 ? '' : 's'}` });
          if (payment === 'card') {
            const inv = await stripe.invoices.create({ customer: r.stripe_customer_id, collection_method: 'charge_automatically', pending_invoice_items_behavior: 'include', description: 'Extra NFC tags' });
            await stripe.invoices.finalizeInvoice(inv.id);
            await stripe.invoices.pay(inv.id);
          }
        }
        const { data: kit, error } = await db.from('admin_tag_kits').insert({
          restaurant_id: r.id, kind: 'addon', delivery: b.delivery === 'mail' ? 'mail' : 'hand', ship_to: String(b.shipTo || '').trim() || null,
          payment, price: qty * price,
        }).select('*').single();
        if (error) throw new Error(error.message);
        const tags = await newTags(r.id, kit.id, qty);
        const s = await getSettings(db);
        const cost = qty * Number(s.tag_cost || 0);
        if (cost > 0) await db.from('admin_client_costs').insert({ restaurant_id: r.id, spent_on: today(), what: `${qty} add-on tag${qty === 1 ? '' : 's'}`, source: `Tag kits · ${tags.map((t) => t.label).join(', ')}`, amount: cost });
        await log(`Sold ${qty} extra tag${qty === 1 ? '' : 's'} for $${(qty * price).toFixed(2)} (${payment === 'card' ? 'charged card' : payment === 'invoice' ? 'added to next bill' : 'already paid'})`, r, { kit_id: kit.id });
        return res.status(200).json({ ok: true, kitId: kit.id });
      }

      case 'mark-written': {
        const t = await getTag();
        await db.from('nfc_tags').update({ written_at: t.written_at || now }).eq('id', t.id);
        return res.status(200).json({ ok: true });
      }

      case 'confirm': {
        const t = await getTag();
        await db.from('nfc_tags').update({ written_at: t.written_at || now, confirmed_at: t.confirmed_at || now }).eq('id', t.id);
        return res.status(200).json({ ok: true });
      }

      case 'pack': {
        const kit = await getKit();
        const { data: tags } = await db.from('nfc_tags').select('id, confirmed_at').eq('kit_id', kit.id);
        if (!(tags || []).every((t) => t.confirmed_at)) return res.status(400).json({ error: 'Confirm every tag first' });
        if (!kit.packed_at) {
          await db.from('admin_tag_kits').update({ packed_at: now }).eq('id', kit.id);
          for (const [item, n] of Object.entries(kitUsage(kit.kind, tags.length))) await moveStock(item, -n, { kit_id: kit.id, note: 'Used in a kit' });
        }
        return res.status(200).json({ ok: true });
      }

      case 'ship': {
        const kit = await getKit();
        if (!kit.packed_at) return res.status(400).json({ error: 'Pack it first' });
        const postage = Number(b.postage) || 0;
        await db.from('admin_tag_kits').update({ sent_at: now, carrier: String(b.carrier || '').slice(0, 40) || null, tracking: String(b.tracking || '').trim().slice(0, 80) || null, postage: postage || null }).eq('id', kit.id);
        if (postage > 0) await db.from('admin_client_costs').insert({ restaurant_id: kit.restaurant_id, spent_on: today(), what: 'Postage', source: [b.carrier, b.tracking].filter(Boolean).join(' · ') || 'Tag kit', amount: postage });
        await log('Mailed a tag kit', await restaurantOf(kit.restaurant_id), { kit_id: kit.id, tracking: b.tracking || null });
        return res.status(200).json({ ok: true });
      }

      case 'handoff':
      case 'delivered': {
        const kit = await getKit();
        if (!kit.packed_at) return res.status(400).json({ error: 'Pack it first' });
        await db.from('admin_tag_kits').update({ sent_at: kit.sent_at || now, delivered_at: now }).eq('id', kit.id);
        await db.from('nfc_tags').update({ status: 'active' }).eq('kit_id', kit.id).eq('status', 'pending');
        await log(b.action === 'handoff' ? 'Handed off a tag kit' : 'Marked a tag kit delivered', await restaurantOf(kit.restaurant_id), { kit_id: kit.id });
        return res.status(200).json({ ok: true });
      }

      case 'cancel-kit': {
        const kit = await getKit();
        if (kit.packed_at) return res.status(400).json({ error: 'It is already packed. Turn the tags off instead.' });
        await db.from('nfc_tags').delete().eq('kit_id', kit.id).eq('status', 'pending');
        await db.from('admin_tag_kits').delete().eq('id', kit.id);
        await log('Cancelled a tag kit', await restaurantOf(kit.restaurant_id), { kit_id: kit.id });
        return res.status(200).json({ ok: true });
      }

      case 'tag-status': {
        const t = await getTag();
        if (!['active', 'off'].includes(b.status) || t.status === 'pending') return res.status(400).json({ error: 'That tag cannot change yet' });
        await db.from('nfc_tags').update({ status: b.status }).eq('id', t.id);
        await log(`${b.status === 'off' ? 'Turned off' : 'Turned on'} tag ${t.label}`, await restaurantOf(t.restaurant_id));
        return res.status(200).json({ ok: true });
      }

      case 'clear-spot': {
        const t = await getTag();
        await db.from('nfc_tags').update({ spot: null }).eq('id', t.id);
        await log(`Cleared the spot on ${t.label}`, await restaurantOf(t.restaurant_id));
        return res.status(200).json({ ok: true });
      }

      case 'restock': {
        if (!ITEMS.includes(b.item)) return res.status(400).json({ error: 'Unknown item' });
        const qty = parseInt(b.qty, 10);
        if (!(qty > 0)) return res.status(400).json({ error: 'How many came in?' });
        await moveStock(b.item, qty, { cost: Number(b.cost) || null, note: String(b.note || '').slice(0, 200) || 'Restock' });
        await log(`Restocked ${qty} ${b.item}${Number(b.cost) ? ` for $${Number(b.cost).toFixed(2)}` : ''}`, null);
        return res.status(200).json({ ok: true });
      }

      case 'set-stock': {
        if (!ITEMS.includes(b.item)) return res.status(400).json({ error: 'Unknown item' });
        await db.from('admin_inventory').update({ on_hand: Math.max(0, parseInt(b.onHand, 10) || 0), reorder_at: Math.max(0, parseInt(b.reorderAt, 10) || 0) }).eq('item', b.item);
        return res.status(200).json({ ok: true });
      }

      case 'save-setting': {
        if (!['ship_from', 'extra_tag_price'].includes(b.key)) return res.status(400).json({ error: 'Unknown setting' });
        const value = b.key === 'extra_tag_price' ? Number(b.value) : String(b.value || '').slice(0, 300);
        await db.from('admin_settings').upsert({ key: b.key, value, updated_at: now });
        await log(`Changed setting ${b.key}`, null, { value });
        return res.status(200).json({ ok: true });
      }

      default:
        return res.status(400).json({ error: 'Unknown action' });
    }
  } catch (e) {
    console.error('[admin/tags action]', e);
    return res.status(e.status || 500).json({ error: e.message || 'Something went wrong' });
  }
}