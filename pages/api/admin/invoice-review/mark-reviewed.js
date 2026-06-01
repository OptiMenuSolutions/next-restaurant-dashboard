// pages/api/admin/invoice-review/mark-reviewed.js
// POST: stamps an invoice and all its line items as reviewed.

import { withAdminAuth } from '../../../../lib/admin/withAdminAuth';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default withAdminAuth(async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { invoice_id } = req.body;
  if (!invoice_id) return res.status(400).json({ error: 'invoice_id required' });

  try {
    const now = new Date().toISOString();

    const [{ error: invErr }, { error: itemsErr }] = await Promise.all([
      supabase
        .from('invoices')
        .update({
          reviewed:    true,
          reviewed_at: now,
          reviewed_by: adminUser.id,
        })
        .eq('id', invoice_id),

      supabase
        .from('invoice_items')
        .update({ reviewed: true })
        .eq('invoice_id', invoice_id),
    ]);

    if (invErr)    throw invErr;
    if (itemsErr)  throw itemsErr;

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('[invoice-review mark-reviewed]', err);
    return res.status(500).json({ error: err.message });
  }
});