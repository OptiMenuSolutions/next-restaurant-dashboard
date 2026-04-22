// pages/api/admin/reparse-invoice.js
// Triggers a manual re-parse of a failed invoice for any restaurant.
// Uses the service role key to bypass RLS and act on any restaurant's invoice.

import { withAdminAuth } from '../../../lib/admin/withAdminAuth';
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export default withAdminAuth(async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { invoiceId } = req.body;
  if (!invoiceId) return res.status(400).json({ error: 'invoiceId is required' });

  try {
    // 1. Fetch the invoice
    const { data: invoice, error: fetchErr } = await supabase
      .from('invoices')
      .select('*')
      .eq('id', invoiceId)
      .single();

    if (fetchErr || !invoice) return res.status(404).json({ error: 'Invoice not found' });
    if (!invoice.file_url) return res.status(400).json({ error: 'Invoice has no file attached' });

    // 2. Mark as re-parsing
    await supabase
      .from('invoices')
      .update({ parse_status: 'parsing', parse_error: null })
      .eq('id', invoiceId);

    // 3. Fetch the file as base64
    const fileRes = await fetch(invoice.file_url);
    if (!fileRes.ok) throw new Error('Could not fetch invoice file');
    const buffer = await fileRes.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    const contentType = fileRes.headers.get('content-type') || 'application/pdf';

    // 4. Fetch restaurant ingredients for matching context
    const { data: ingredients } = await supabase
      .from('ingredients')
      .select('id, name, unit, last_price')
      .eq('restaurant_id', invoice.restaurant_id)
      .limit(200);

    const ingredientContext = (ingredients || [])
      .map(i => `${i.name} (${i.unit}, $${i.last_price || 0})`)
      .join('\n');

    // 5. Call Claude Vision to parse
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: contentType, data: base64 },
          },
          {
            type: 'text',
            text: `Parse this supplier invoice and extract all line items.

Known ingredients for matching:
${ingredientContext || 'None available'}

Return JSON only:
{
  "supplier": "supplier name",
  "invoice_number": "number or null",
  "invoice_date": "YYYY-MM-DD or null",
  "total_amount": number,
  "items": [
    {
      "description": "item name as on invoice",
      "quantity": number,
      "unit": "unit of measure",
      "unit_price": number,
      "total_price": number,
      "matched_ingredient_name": "best match from known ingredients or null"
    }
  ]
}`,
          },
        ],
      }],
    });

    const raw = response.content[0]?.text || '';
    const clean = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

    // 6. Update invoice with parsed results
    await supabase
      .from('invoices')
      .update({
        parse_status: 'completed',
        supplier: parsed.supplier || invoice.supplier,
        number: parsed.invoice_number || invoice.number,
        date: parsed.invoice_date || invoice.date,
        amount: parsed.total_amount || invoice.amount,
        parsed_data: parsed,
        parsed_at: new Date().toISOString(),
        parse_error: null,
      })
      .eq('id', invoiceId);

    return res.status(200).json({ success: true, parsed });

  } catch (err) {
    console.error('[reparse-invoice] Error:', err);

    // Mark as failed with error message
    await supabase
      .from('invoices')
      .update({ parse_status: 'failed', parse_error: err.message })
      .eq('id', invoiceId);

    return res.status(500).json({ error: err.message || 'Re-parse failed' });
  }
});