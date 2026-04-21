// pages/api/admin/onboarding.js
// Returns new restaurants and their onboarding progress.

import { withAdminAuth } from '../../../lib/admin/withAdminAuth';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default withAdminAuth(async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const [
      { data: restaurants },
      { data: invoices },
      { data: menuItems },
      { data: ingredients },
      { data: profiles },
      { data: posSales },
    ] = await Promise.all([
      supabase.from('restaurants').select('*').order('created_at', { ascending: false }),
      supabase.from('invoices').select('id, restaurant_id, created_at, parse_status'),
      supabase.from('menu_items').select('id, restaurant_id'),
      supabase.from('ingredients').select('id, restaurant_id'),
      supabase.from('profiles').select('id, email, full_name'),
      supabase.from('pos_sales').select('id, restaurant_id'),
    ]);

    const profileMap = {};
    for (const p of profiles || []) profileMap[p.id] = p;

    const invoiceMap = {};
    const successfulInvoiceMap = {};
    for (const inv of invoices || []) {
      invoiceMap[inv.restaurant_id] = (invoiceMap[inv.restaurant_id] || 0) + 1;
      if (inv.parse_status === 'completed') {
        successfulInvoiceMap[inv.restaurant_id] = (successfulInvoiceMap[inv.restaurant_id] || 0) + 1;
      }
    }

    const menuMap = {};
    for (const m of menuItems || []) menuMap[m.restaurant_id] = (menuMap[m.restaurant_id] || 0) + 1;

    const ingredientMap = {};
    for (const i of ingredients || []) ingredientMap[i.restaurant_id] = (ingredientMap[i.restaurant_id] || 0) + 1;

    const posMap = {};
    for (const s of posSales || []) posMap[s.restaurant_id] = (posMap[s.restaurant_id] || 0) + 1;

    const now = new Date();

    const enriched = (restaurants || []).map(r => {
      const profile = profileMap[r.user_id] || {};
      const invoiceCount = invoiceMap[r.id] || 0;
      const successfulInvoices = successfulInvoiceMap[r.id] || 0;
      const menuCount = menuMap[r.id] || 0;
      const ingredientCount = ingredientMap[r.id] || 0;
      const posCount = posMap[r.id] || 0;
      const daysSinceJoin = Math.floor((now - new Date(r.created_at)) / 86400000);

      // Onboarding steps
      const steps = [
        { key: 'account',      label: 'Account created',      done: true },
        { key: 'menu',         label: 'Menu imported',         done: menuCount > 0 },
        { key: 'invoice',      label: 'First invoice parsed',  done: successfulInvoices > 0 },
        { key: 'ingredients',  label: 'Ingredients populated', done: ingredientCount > 0 },
        { key: 'pos',          label: 'POS data uploaded',     done: posCount > 0 },
      ];

      const completedSteps = steps.filter(s => s.done).length;
      const progressPct = Math.round((completedSteps / steps.length) * 100);

      // Status
      let status = 'complete';
      if (progressPct < 40)  status = 'stuck';
      else if (progressPct < 100) status = 'in_progress';

      // Flag as stuck if > 7 days since join and < 40% complete
      const isStuck = daysSinceJoin > 7 && progressPct < 40;

      return {
        id: r.id,
        name: r.name || 'Unnamed Restaurant',
        owner_name: profile.full_name || null,
        owner_email: profile.email || null,
        created_at: r.created_at,
        days_since_join: daysSinceJoin,
        subscription_status: r.subscription_status || 'unknown',
        invoice_count: invoiceCount,
        menu_count: menuCount,
        ingredient_count: ingredientCount,
        pos_count: posCount,
        steps,
        completed_steps: completedSteps,
        progress_pct: progressPct,
        status,
        is_stuck: isStuck,
      };
    });

    // Sort: stuck first, then in_progress, then complete
    const order = { stuck: 0, in_progress: 1, complete: 2 };
    enriched.sort((a, b) => {
      if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
      return a.progress_pct - b.progress_pct;
    });

    const stats = {
      total: enriched.length,
      complete: enriched.filter(r => r.status === 'complete').length,
      in_progress: enriched.filter(r => r.status === 'in_progress').length,
      stuck: enriched.filter(r => r.status === 'stuck').length,
      avg_progress: enriched.length
        ? Math.round(enriched.reduce((s, r) => s + r.progress_pct, 0) / enriched.length)
        : 0,
    };

    return res.status(200).json({ restaurants: enriched, stats });

  } catch (err) {
    console.error('[onboarding API] Error:', err);
    return res.status(500).json({ error: 'Failed to load onboarding data' });
  }
});