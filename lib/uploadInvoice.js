// lib/uploadInvoice.js
// Shared client-side flow for both pages/client/invoices.js and
// OnboardingScreen's step-4 invoice upload: upload the file to Storage,
// stream /api/invoices/parse-invoice's status events, then auto-confirm via
// /api/invoices/confirm-invoice — matching that route's own stated design
// ("Auto-save invoice data after parse — no longer requires user
// confirmation"). The one exception is a duplicate invoice: parse-invoice
// flags it but doesn't decide what to do, so this stops short of
// auto-confirming and hands the decision back to the caller.
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
 * @returns {Promise<
 *   | { status: 'saved', invoiceId: string, itemsSaved: number, ingredientsCreated: number, ingredientsUpdated: number, errors: string[] }
 *   | { status: 'duplicate', existing: object, parseResult: object }
 * >}
 */
export async function uploadInvoice(file, restaurantId, accessToken, onStatus) {
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
  const form = new FormData();
  form.append('file', file);
  form.append('restaurant_id', restaurantId);
  form.append('file_url', publicUrl);

  const res = await fetch('/api/invoices/parse-invoice', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
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

  // 3. Duplicate detected — don't auto-save, hand the decision back.
  if (parseResult.duplicate) {
    return { status: 'duplicate', existing: parseResult.duplicate, parseResult };
  }

  // 4. Auto-confirm — matches confirm-invoice.js's own stated design.
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
 * Same as uploadInvoice, but for confirming a flagged duplicate — pass
 * either append=true (merge into the existing invoice) or append=false
 * (save as a new invoice anyway).
 */
export async function confirmDuplicateInvoice(parseResult, restaurantId, accessToken, append) {
  const res = await fetch('/api/invoices/confirm-invoice', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      restaurant_id: restaurantId,
      invoice: parseResult.invoice,
      line_items: parseResult.line_items,
      file_urls: parseResult.file_url ? [parseResult.file_url] : [],
      ocr_text: parseResult.ocr_text,
      append_to_invoice_id: append ? parseResult.duplicate.existing_id : undefined,
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
