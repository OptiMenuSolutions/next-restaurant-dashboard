// pages/api/scanner/process.js
// POST { scan_id } with the scanner's login as Bearer.
//
// Reads and saves the pages of one scan, the same way an owner's upload is
// read and saved: each page goes through /api/invoices/parse-invoice, then
// /api/invoices/confirm-invoice, called from here with the internal key once
// this route has checked the scanner. Pages of one invoice join into one
// invoice (same grouping as the owner's uploader); separate invoices photographed
// in one go stay separate.
//
// Differences from an owner's upload:
//   - A possible duplicate is saved anyway. The Invoices page already flags
//     same supplier, number and total for the owner to merge.
//   - Every saved invoice is tagged with the scanner's name, unreviewed.
//   - An unreadable photo marks the scan "retake": the scanner sees a Retake
//     button and the owner sees it on the scanner's row in Profile.
import { admin, requireScanner, internalHeaders, selfBaseUrl } from '../../../lib/scannerAuth';
import { groupParsedInvoices } from '../../../lib/uploadInvoice';

export const config = { maxDuration: 300 };

async function parsePage(base, restaurantId, path, n) {
  const res = await fetch(`${base}/api/invoices/parse-invoice`, {
    method: 'POST',
    headers: internalHeaders(),
    body: JSON.stringify({ restaurant_id: restaurantId, file_path: path, file_name: `scan-page-${n}.jpg` }),
  });
  const text = await res.text();
  let result = null;
  let error = null;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    if (event.type === 'result') result = event.data;
    if (event.type === 'error') error = event.error;
  }
  if (error || !result) throw new Error(error || 'Could not read this page.');
  return result;
}

async function savePage(base, restaurantId, parseResult, path, appendTo) {
  const res = await fetch(`${base}/api/invoices/confirm-invoice`, {
    method: 'POST',
    headers: internalHeaders(),
    body: JSON.stringify({
      restaurant_id: restaurantId,
      invoice: parseResult.invoice,
      line_items: parseResult.line_items,
      file_urls: [path],
      ocr_text: parseResult.ocr_text,
      append_to_invoice_id: appendTo || undefined,
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || 'Could not save this invoice.');
  return json;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const auth = await requireScanner(req);
  if (auth.error) return res.status(auth.status).json({ error: auth.error, removed: !!auth.removed });
  const { scanner, restaurant } = auth;

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const { data: scan } = await admin.from('scanner_scans')
    .select('id, paths, status')
    .eq('id', body.scan_id).eq('scanner_id', scanner.id)
    .maybeSingle();
  if (!scan) return res.status(404).json({ error: 'That scan was not found.' });
  if (scan.status !== 'sending') return res.status(200).json({ status: scan.status });

  const finish = async (fields) => {
    await admin.from('scanner_scans').update({ ...fields, finished_at: new Date().toISOString() }).eq('id', scan.id);
    return res.status(200).json({ status: fields.status });
  };

  try {
    const base = selfBaseUrl(req);

    // Every page at once; one page does not wait on another.
    const parsed = await Promise.all(scan.paths.map(async (path, i) => {
      const file = { name: `page ${i + 1}` };
      try {
        const parseResult = await parsePage(base, restaurant.id, path, i + 1);
        return { file, publicUrl: path, parseResult };
      } catch (err) {
        return { file, publicUrl: path, error: err.message };
      }
    }));

    const readable = parsed.filter((p) => !p.error);
    if (!readable.length) {
      const first = parsed[0]?.error || '';
      // Billing problems are the owner's to fix, and a photo that never
      // uploaded needs sending again: neither is a blurry photo.
      if (/subscription|payment|plan/i.test(first)) return finish({ status: 'failed', error: 'Not sent. Let your manager know.' });
      if (/download/i.test(first)) return finish({ status: 'failed', error: 'Did not send. Try again.' });
      return finish({ status: 'retake', error: 'Too blurry to read' });
    }

    const invoiceIds = [];
    let pricesUpdated = 0;
    for (const group of groupParsedInvoices(parsed)) {
      let invoiceId = null;
      for (const item of group.items) {
        if (item.error) continue;
        const saved = await savePage(base, restaurant.id, item.parseResult, item.publicUrl, invoiceId);
        invoiceId = saved.invoice_id || invoiceId;
        pricesUpdated += (saved.ingredients_updated || 0) + (saved.ingredients_created || 0);
      }
      if (invoiceId && !invoiceIds.includes(invoiceId)) invoiceIds.push(invoiceId);
    }

    if (invoiceIds.length) {
      await admin.from('invoices')
        .update({ scanned_by_scanner_id: scanner.id, scanned_by_name: scanner.name, scan_reviewed_at: null })
        .in('id', invoiceIds).eq('restaurant_id', restaurant.id);
    }

    // Some pages read, some not: the invoice is saved; the scanner is asked
    // to retake only when nothing could be read.
    return finish({
      status: invoiceIds.length ? 'read' : 'retake',
      invoice_ids: invoiceIds,
      prices_updated: pricesUpdated,
      error: invoiceIds.length ? (readable.length < parsed.length ? `${parsed.length - readable.length} page could not be read` : null) : 'Too blurry to read',
    });
  } catch (err) {
    console.error('[scanner/process] Failed:', err);
    return finish({ status: 'failed', error: 'Did not send. Try again.' });
  }
}