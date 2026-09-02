// lib/uploadInvoice.js
// Shared client-side flow for both pages/client/invoices.js and
// pages/client/onboarding.js's invoice upload step: upload the file to
// Storage, stream /api/invoices/parse-invoice's status events, then
// auto-confirm via /api/invoices/confirm-invoice — matching that route's
// own stated design ("Auto-save invoice data after parse — no longer
// requires user confirmation"). The one exception is a duplicate invoice
// detected against something already on file from a PREVIOUS, separate
// upload: parse-invoice flags it but doesn't decide what to do, so this
// stops short of auto-confirming and hands the decision back to the caller.
//
// MULTI-PAGE BATCHES — see forceAppendToInvoiceId below. Multi-page
// invoices very often only print the invoice number on page 1;
// continuation pages are frequently just line-item lists with no repeated
// header. Relying on invoice-number matching to recognize "these pages
// belong together" is fragile for exactly that reason — a page with no
// readable number never even reaches the duplicate check, and silently
// becomes its own separate invoice. The real signal is simpler: files
// selected together in one upload action ARE pages of one invoice, full
// stop, regardless of what each page's own OCR happens to read. Callers
// (invoices.js, onboarding.js) track the invoice id established by the
// first file in a batch and pass it as forceAppendToInvoiceId for every
// subsequent file in that same batch.
//
// ASSUMPTION FLAGGED: the Storage bucket name ("invoices") is a guess — I
// never saw the actual upload code that used to populate invoices.file_url,
// only confirm-invoice.js consuming the URL after the fact. Verify this
// against your actual Supabase Storage bucket name before relying on it;
// if it's wrong, uploads will fail with a clear "bucket not found" error
// rather than silently going anywhere unexpected.
const STORAGE_BUCKET = 'invoices';

/**
 * @param {File} file
 * @param {string} restaurantId
 * @param {string} accessToken
 * @param {(message: string, detail?: string) => void} [onStatus] - called for
 *   each live status event while parsing (e.g. to show "Reading invoice.pdf...")
 * @param {string|null} [forceAppendToInvoiceId] - if set, this file is a
 *   continuation page of an invoice already established earlier in the same
 *   upload batch. Skips both the normal auto-save-as-new path AND the
 *   duplicate-detection path entirely — always appends into this invoice id,
 *   regardless of what this page's own OCR read for its invoice number.
 * @returns {Promise<
 *   | { status: 'saved', invoiceId: string, itemsSaved: number, ingredientsCreated: number, ingredientsUpdated: number, errors: string[] }
 *   | { status: 'duplicate', existing: object, parseResult: object }
 * >}
 */
export async function uploadInvoice(file, restaurantId, accessToken, onStatus, forceAppendToInvoiceId = null) {
  // 1. Upload the raw file to Storage first, so there's a permanent URL to
  // store on the invoice record regardless of how parsing goes.
  const supabase = (await import('./supabaseClient')).default;
  const ext = file.name.split('.').pop();
  const path = `${restaurantId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const { error: uploadError } = await supabase.storage.from(STORAGE_BUCKET).upload(path, file);
  if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);
  const { data: { publicUrl } } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);

  // 2. Stream the OCR parse — parse-invoice.js sends newline-delimited JSON
  // status events, ending with one { type: 'result', data: {...} } or
  // { type: 'error', error }.
  //
  // Sends only the small file_url, restaurant_id, and file_name here — NOT
  // the raw file. Vercel's serverless functions have a hard 4.5MB request
  // body limit at the platform level (not configurable in code); sending
  // the actual file bytes here meant any real phone photo could trivially
  // exceed that and fail with a plain-text 413 the client couldn't even
  // parse as JSON. The file's already in Storage as of the step above —
  // parse-invoice.js fetches it from there itself, server-to-server, which
  // has no such limit.
  const res = await fetch('/api/invoices/parse-invoice', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ restaurant_id: restaurantId, file_url: publicUrl, file_name: file.name }),
  });
  if (!res.body) throw new Error('No response stream from parse-invoice');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let parseResult = null;
  let parseError = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop(); // last (possibly incomplete) line stays in the buffer
    for (const line of lines) {
      if (!line.trim()) continue;
      let event;
      try { event = JSON.parse(line); } catch { continue; }
      if (event.type === 'status') {
        onStatus?.(event.message, event.detail);
      } else if (event.type === 'result') {
        parseResult = event.data;
      } else if (event.type === 'error') {
        parseError = event.error;
      }
    }
  }

  if (parseError) throw new Error(parseError);
  if (!parseResult) throw new Error('Invoice parsing did not return a result.');

  // 3. Part of a multi-file batch already tied to an established invoice —
  // always append, skip duplicate-detection entirely. A continuation page
  // reading a different (or no) invoice number is expected, not a reason
  // to treat it as a separate invoice or ask again.
  if (forceAppendToInvoiceId) {
    return confirmDuplicateInvoice({ ...parseResult, file_url: publicUrl }, restaurantId, accessToken, true, forceAppendToInvoiceId);
  }

  // 4. Duplicate of something from a PREVIOUS, separate upload — don't
  // auto-save, hand the decision back to the caller.
  if (parseResult.duplicate) {
    return { status: 'duplicate', existing: parseResult.duplicate, parseResult: { ...parseResult, file_url: publicUrl } };
  }

  // 5. Auto-confirm — matches confirm-invoice.js's own stated design.
  onStatus?.('Saving to your invoices...', null);
  const confirmRes = await fetch('/api/invoices/confirm-invoice', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      restaurant_id: restaurantId,
      invoice: parseResult.invoice,
      line_items: parseResult.line_items,
      file_urls: [publicUrl],
      ocr_text: parseResult.ocr_text,
    }),
  });
  const confirmJson = await confirmRes.json();
  if (!confirmRes.ok) throw new Error(confirmJson.error || 'Failed to save invoice.');

  return {
    status: 'saved',
    invoiceId: confirmJson.invoice_id,
    itemsSaved: confirmJson.items_saved,
    ingredientsCreated: confirmJson.ingredients_created,
    ingredientsUpdated: confirmJson.ingredients_updated,
    errors: confirmJson.errors || [],
  };
}

/**
 * Confirms a flagged duplicate, OR appends a batch continuation page.
 * - append=true, no explicit id: merges into the invoice parse-invoice.js
 *   itself found as a likely duplicate (parseResult.duplicate.existing_id).
 * - append=true, explicit forceInvoiceId: merges into that specific invoice
 *   instead — used for multi-page batch continuation pages.
 * - append=false: saves as a new, separate invoice regardless.
 */
export async function confirmDuplicateInvoice(parseResult, restaurantId, accessToken, append, forceInvoiceId = null) {
  const appendToId = forceInvoiceId || (append ? parseResult.duplicate?.existing_id : undefined);
  const res = await fetch('/api/invoices/confirm-invoice', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      restaurant_id: restaurantId,
      invoice: parseResult.invoice,
      line_items: parseResult.line_items,
      file_urls: parseResult.file_url ? [parseResult.file_url] : [],
      ocr_text: parseResult.ocr_text,
      append_to_invoice_id: append ? appendToId : undefined,
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to save invoice.');
  return {
    status: 'saved',
    invoiceId: json.invoice_id,
    itemsSaved: json.items_saved,
    ingredientsCreated: json.ingredients_created,
    ingredientsUpdated: json.ingredients_updated,
    errors: json.errors || [],
  };
}