// pages/api/admin/review/invoices.js
// The scanned-invoice side of the Review queue.
// GET            -> every unreviewed invoice (not samples), oldest first
// GET ?id=<id>   -> one invoice: signed page images, lines with checks,
//                   match suggestions and the restaurant's ingredient list
// POST { action: 'save', invoiceId, lines }
// POST { action: 'reviewed', invoiceId, lines? }   saves any edits first

import { adminDb as db, requireAdmin } from '../../../../lib/admin/requireAdmin';
import { writeAuditLog } from '../../../../lib/admin/withAdminAuth';
import { saveInvoiceLines } from '../../../../lib/admin/invoiceLines';
import { fetchAll } from '../../../../lib/admin/fetchAll';
import { convertInvoiceCostToStandardUnit } from '../../../../lib/standardizedUnits';

const words = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2);

// Up to 3 ingredients whose names share the most words with the line.
function suggest(itemName, ingredients) {
  const w = new Set(words(itemName));
  if (!w.size) return [];
  return ingredients
    .map((g) => {
      const gw = words(g.name);
      const hits = gw.filter((x) => w.has(x) || [...w].some((y) => y.startsWith(x) || x.startsWith(y))).length;
      return { id: g.id, name: g.name, score: gw.length ? hits / gw.length : 0 };
    })
    .filter((g) => g.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

const isUrl = (v) => /^https?:\/\//.test(v || '');
const fileKind = (v) => (/\.pdf(\?|$)/i.test(v || '') ? 'pdf' : 'image');

async function detail(id) {
  const { data: inv } = await db.from('invoices')
    .select('id, restaurant_id, supplier, number, date, amount, file_url, created_at, reviewed')
    .eq('id', id).single();
  if (!inv) return null;

  const [{ data: rest }, { data: lines }, { data: files }, ingredients] = await Promise.all([
    db.from('restaurants').select('id, name').eq('id', inv.restaurant_id).single(),
    db.from('invoice_items').select('id, item_name, quantity, unit, unit_cost, amount, ingredient_id, original_quantity, original_price').eq('invoice_id', id).order('item_name'),
    db.from('invoice_files').select('file_url, page_number').eq('invoice_id', id).order('page_number'),
    fetchAll(() => db.from('ingredients').select('id, name, unit, last_price, is_estimated, price_approved_at').eq('restaurant_id', inv.restaurant_id).order('id')),
  ]);

  // Pages: invoice_files first, else the single file_url. Private bucket, so sign them.
  const raw = (files || []).length ? files.map((f) => ({ path: f.file_url, page: f.page_number })) : inv.file_url ? [{ path: inv.file_url, page: 1 }] : [];
  const toSign = raw.map((p) => p.path).filter((p) => p && !isUrl(p));
  const signed = {};
  if (toSign.length) {
    const { data } = await db.storage.from('invoices').createSignedUrls(toSign, 3600);
    for (const s of data || []) if (s.signedUrl) signed[s.path] = s.signedUrl;
  }
  const pages = raw.map((p) => ({ page: p.page, url: isUrl(p.path) ? p.path : signed[p.path] || null, kind: fileKind(p.path) })).filter((p) => p.url);

  const ingById = new Map(ingredients.map((g) => [g.id, g]));
  const out = (lines || []).map((l) => {
    const g = l.ingredient_id ? ingById.get(l.ingredient_id) : null;
    const checks = [];
    const q = Number(l.quantity), c = Number(l.unit_cost), a = Number(l.amount);
    if (q > 0 && c > 0 && a > 0 && Math.abs(q * c - a) > Math.max(0.05, a * 0.02)) checks.push({ tone: 'amber', text: `Qty × cost is $${(q * c).toFixed(2)}, total says $${a.toFixed(2)}` });
    if (g && c > 0 && g.last_price > 0) {
      const std = convertInvoiceCostToStandardUnit(c, l.unit || 'each', g.name);
      const diff = (std - Number(g.last_price)) / Number(g.last_price);
      if (Math.abs(diff) >= 0.3) checks.push({ tone: 'amber', text: `${diff > 0 ? '+' : ''}${Math.round(diff * 100)}% vs ${g.name} at $${Number(g.last_price).toFixed(2)}/${g.unit}` });
    }
    if (!l.ingredient_id) checks.push({ tone: 'muted', text: 'Not matched to an ingredient' });
    const edited = (l.original_quantity != null && Number(l.original_quantity) !== q) || (l.original_price != null && Number(l.original_price) !== c);
    return { ...l, edited, checks, suggestions: l.ingredient_id ? [] : suggest(l.item_name, ingredients) };
  });

  return {
    invoice: { ...inv, total: inv.total_amount ?? inv.amount, restaurant: rest?.name || 'Unknown' },
    pages,
    lines: out,
    ingredients: ingredients.map((g) => ({ id: g.id, name: g.name, unit: g.unit })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export default async function handler(req, res) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  try {
    if (req.method === 'GET') {
      if (req.query.id) {
        const out = await detail(req.query.id);
        if (!out) return res.status(404).json({ error: 'Invoice not found' });
        return res.status(200).json(out);
      }
      const { data: invs, error } = await db.from('invoices')
        .select('id, restaurant_id, supplier, number, date, amount, created_at, invoice_items(count)')
        .eq('reviewed', false).eq('is_sample', false)
        .order('created_at', { ascending: true }).limit(500);
      if (error) throw new Error(error.message);
      const ids = [...new Set((invs || []).map((i) => i.restaurant_id))];
      const { data: rest } = ids.length ? await db.from('restaurants').select('id, name').in('id', ids) : { data: [] };
      const names = new Map((rest || []).map((r) => [r.id, r.name]));
      return res.status(200).json({
        invoices: (invs || []).map((i) => ({
          id: i.id, restaurant_id: i.restaurant_id, restaurant: names.get(i.restaurant_id) || 'Unknown',
          supplier: i.supplier, number: i.number, date: i.date, total: i.total_amount ?? i.amount,
          lines: i.invoice_items?.[0]?.count ?? 0, parse_status: i.parse_status, created_at: i.created_at,
        })),
      });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const { action, invoiceId, lines } = req.body || {};
    if (!invoiceId) return res.status(400).json({ error: 'invoiceId is required' });

    let result = { changed: 0, relinked: 0, errors: [] };
    if (Array.isArray(lines) && lines.length) result = await saveInvoiceLines(db, invoiceId, lines);

    const { data: inv } = await db.from('invoices').select('id, restaurant_id, supplier, number').eq('id', invoiceId).single();
    const { data: r } = inv ? await db.from('restaurants').select('id, name').eq('id', inv.restaurant_id).single() : { data: null };
    const what = `${inv?.supplier || 'invoice'}${inv?.number ? ' #' + inv.number : ''}`;

    if (action === 'reviewed') {
      const now = new Date().toISOString();
      const [{ error: e1 }, { error: e2 }] = await Promise.all([
        db.from('invoices').update({ reviewed: true, reviewed_at: now, reviewed_by: admin.user.id }).eq('id', invoiceId),
        db.from('invoice_items').update({ reviewed: true }).eq('invoice_id', invoiceId),
      ]);
      if (e1 || e2) throw new Error((e1 || e2).message);
      await writeAuditLog({ admin_id: admin.user.id, admin_name: admin.name, action: `Marked ${what} reviewed${result.changed || result.relinked ? ` (${result.changed} lines fixed, ${result.relinked} rematched)` : ''}`, target_restaurant_id: r?.id, target_restaurant_name: r?.name });
    } else if (result.changed || result.relinked) {
      await writeAuditLog({ admin_id: admin.user.id, admin_name: admin.name, action: `Edited ${what}: ${result.changed} lines fixed, ${result.relinked} rematched`, target_restaurant_id: r?.id, target_restaurant_name: r?.name });
    }
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    console.error('[admin/review/invoices]', err);
    return res.status(500).json({ error: err.message || 'Something went wrong' });
  }
}