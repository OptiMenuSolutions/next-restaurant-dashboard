// pages/api/admin/invoice-review/mark-reviewed.js
// POST: stamps an invoice and all its line items as reviewed.

import { withAdminAuth } from '../../../../lib/admin/withAdminAuth';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createMarkInvoiceReviewedHandler({ db = supabase } = {}) {
  return async function handler(req, res, session) {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).end();
    }
    if (session?.profile?.role !== 'admin' || !UUID.test(session?.user?.id || '')) {
      return res.status(403).json({ error: 'Administrator authorization required.' });
    }

    let body;
    try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; }
    catch { return res.status(400).json({ error: 'A valid invoice_id is required.' }); }
    if (!body || Array.isArray(body) || typeof body !== 'object' ||
      Object.keys(body).some(key => key !== 'invoice_id') ||
      typeof body.invoice_id !== 'string' || !UUID.test(body.invoice_id)) {
      return res.status(400).json({ error: 'A valid invoice_id is required.' });
    }

    try {
      const { data: invoice, error: lookupError } = await db.from('invoices')
        .select('id,restaurant_id').eq('id', body.invoice_id).maybeSingle();
      if (lookupError) throw lookupError;
      if (!invoice) return res.status(404).json({ error: 'Invoice not found.' });
      if (invoice.id !== body.invoice_id || !UUID.test(invoice.restaurant_id || '')) {
        throw new Error('Invalid invoice ownership record.');
      }
      const { data: result, error } = await db.rpc('mark_invoice_reviewed_transactional', {
        p_restaurant_id: invoice.restaurant_id,
        p_invoice_id: invoice.id,
        p_admin_id: session.user.id,
      });
      if (error) {
        if (error.code === '42501') return res.status(403).json({ error: 'Administrator authorization required.' });
        if (error.code === 'P0002') return res.status(404).json({ error: 'Invoice not found.' });
        throw error;
      }
      if (result?.success !== true || result.invoice_id !== invoice.id ||
        result.restaurant_id !== invoice.restaurant_id || result.reviewed !== true ||
        !UUID.test(result.reviewed_by || '') || typeof result.reviewed_at !== 'string' ||
        !Number.isFinite(Date.parse(result.reviewed_at)) ||
        !Number.isInteger(result.reviewed_lines) || result.reviewed_lines < 0 ||
        typeof result.changed !== 'boolean') {
        throw new Error('Unexpected invoice review result.');
      }
      return res.status(200).json(result);
    } catch (error) {
      console.error('[invoice-review mark-reviewed]', error.message);
      return res.status(500).json({ error: 'Could not mark the invoice as reviewed.' });
    }
  };
}

export default withAdminAuth(createMarkInvoiceReviewedHandler());