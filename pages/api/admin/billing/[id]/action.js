// pages/api/admin/billing/[id]/action.js
// Billing actions for one client. Every one is written to the audit log.
//   comp-month                 credits one month's price to their Stripe balance
//   refund   { chargeId, amount? }
//   cancel   { reason, note, when: 'end' | 'now' }
//   email    { subject, message }   emails the owner (from nick@opti-menu.com)
//   add-cost { date, what, amount, source? }
//   delete-cost { costId }

import { Resend } from 'resend';
import stripe from '../../../../../lib/stripeServer';
import { adminDb as db, requireAdmin } from '../../../../../lib/admin/requireAdmin';
import { writeAuditLog } from '../../../../../lib/admin/withAdminAuth';

const REASONS = ['Too expensive', 'Not using it enough', 'Closed or sold the restaurant', 'Switched POS', 'Missing a feature they need', 'Other'];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const { id } = req.query;
  const body = req.body || {};
  const { data: r } = await db.from('restaurants').select('id, name, stripe_customer_id, stripe_subscription_id').eq('id', id).single();
  if (!r) return res.status(404).json({ error: 'Restaurant not found' });
  const log = (action, metadata = {}, reason = null) => writeAuditLog({
    admin_id: admin.user.id, admin_name: admin.name, action,
    target_restaurant_id: r.id, target_restaurant_name: r.name, metadata, reason,
  });

  try {
    if (body.action === 'comp-month') {
      if (!r.stripe_customer_id || !r.stripe_subscription_id) return res.status(400).json({ error: 'No Stripe subscription to comp' });
      const sub = await stripe.subscriptions.retrieve(r.stripe_subscription_id);
      const cents = sub.items.data[0]?.price?.unit_amount || 0;
      if (!cents) return res.status(400).json({ error: 'Their plan has no price to comp' });
      await stripe.customers.createBalanceTransaction(r.stripe_customer_id, {
        amount: -cents, currency: sub.items.data[0].price.currency || 'usd', description: 'One month comped by OptiMenu',
      });
      await log(`Comped a month ($${(cents / 100).toFixed(2)})`);
      return res.status(200).json({ ok: true, message: `Credited $${(cents / 100).toFixed(2)}. Their next invoice uses it first.` });
    }

    if (body.action === 'refund') {
      const charge = await stripe.charges.retrieve(String(body.chargeId || ''));
      if (!charge || charge.customer !== r.stripe_customer_id) return res.status(400).json({ error: 'That charge is not theirs' });
      const left = charge.amount - charge.amount_refunded;
      const cents = body.amount ? Math.round(Number(body.amount) * 100) : left;
      if (!(cents > 0) || cents > left) return res.status(400).json({ error: `Refund must be between $0.01 and $${(left / 100).toFixed(2)}` });
      await stripe.refunds.create({ charge: charge.id, amount: cents, reason: 'requested_by_customer' });
      await log(`Refunded $${(cents / 100).toFixed(2)}`, { charge: charge.id });
      return res.status(200).json({ ok: true, message: `Refunded $${(cents / 100).toFixed(2)}.` });
    }

    if (body.action === 'cancel') {
      if (!REASONS.includes(body.reason)) return res.status(400).json({ error: 'Pick a reason' });
      const when = body.when === 'now' ? 'now' : 'end';
      if (r.stripe_subscription_id) {
        if (when === 'now') await stripe.subscriptions.cancel(r.stripe_subscription_id);
        else await stripe.subscriptions.update(r.stripe_subscription_id, { cancel_at_period_end: true });
      }
      const note = String(body.note || '').trim().slice(0, 500) || null;
      await db.from('admin_cancellations').insert({ restaurant_id: r.id, restaurant_name: r.name, reason: body.reason, note, effective: when, admin_name: admin.name });
      await log(`Cancelled their plan ${when === 'now' ? 'right away' : 'at the end of the period'}`, { note }, body.reason);
      return res.status(200).json({ ok: true, message: when === 'now' ? 'Plan cancelled.' : 'Plan will end when their paid month runs out.' });
    }

    if (body.action === 'email') {
      const { data: owners } = await db.from('profiles').select('full_name, email, role').eq('restaurant_id', r.id);
      const owner = (owners || []).find((p) => p.role !== 'admin' && p.email);
      if (!owner) return res.status(400).json({ error: 'No owner email on file' });
      const subject = String(body.subject || '').trim().slice(0, 150);
      const message = String(body.message || '').trim().slice(0, 5000);
      if (!subject || !message) return res.status(400).json({ error: 'Subject and message are needed' });
      const resend = new Resend(process.env.RESEND_API_KEY);
      const { error } = await resend.emails.send({
        from: 'Nick <nick@opti-menu.com>',
        to: owner.email,
        subject,
        text: `${message}\n\nNick Lavin\nOptiMenu · opti-menu.com`,
        html: `<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:560px;color:#111819;font-size:15px;line-height:1.6;white-space:pre-wrap">${esc(message)}</div><p style="font-family:-apple-system,Segoe UI,sans-serif;color:#4b585b;font-size:13px;margin-top:24px">Nick Lavin<br>OptiMenu · <a href="https://www.opti-menu.com" style="color:#03808f">opti-menu.com</a></p>`,
      });
      if (error) throw new Error(error.message || 'Email failed');
      await log(`Emailed the owner: ${subject}`, { to: owner.email });
      return res.status(200).json({ ok: true, message: `Sent to ${owner.email}.` });
    }

    if (body.action === 'add-cost') {
      const what = String(body.what || '').trim().slice(0, 120);
      const amount = Number(body.amount);
      const date = /^\d{4}-\d{2}-\d{2}$/.test(body.date || '') ? body.date : new Date().toISOString().slice(0, 10);
      if (!what || !(amount > 0)) return res.status(400).json({ error: 'Give it a name and an amount' });
      await db.from('admin_client_costs').insert({ restaurant_id: r.id, spent_on: date, what, source: String(body.source || '').slice(0, 120) || null, amount });
      await log(`Added a cost: ${what} $${amount.toFixed(2)}`);
      return res.status(200).json({ ok: true });
    }

    if (body.action === 'delete-cost') {
      await db.from('admin_client_costs').delete().eq('id', body.costId).eq('restaurant_id', r.id);
      await log('Deleted a cost', { cost_id: body.costId });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    console.error('[admin/billing action]', e);
    return res.status(500).json({ error: e.message || 'Something went wrong' });
  }
}