// lib/uploadInvoice.js
// Shared client-side flow for both pages/client/invoices.js and
// pages/client/onboarding.js's invoice upload step.
//
// SPEED — same philosophy as parse-menu.js's overhaul. Every file used to
// be uploaded, parsed, and saved fully sequentially — a 5-page invoice did
// 5 full OCR-plus-three-Claude-calls cycles back to back. The three Claude
// calls WITHIN one file's parse (structure → sanity-check → ingredient
// match) are a genuine pipeline, each needs the previous one's output, so
// there's no parallelizing within a single file. But nothing about parsing
// FILE 2 depends on FILE 1 — that dependency only exists at SAVE time
// (page 2 needs to know page 1's resulting invoice_id to append to it
// correctly). So: parse every file in a batch in parallel (parseInvoiceBatch
// below — this is where nearly all the time was going), then save them
// sequentially afterward, which is fast since it's just DB writes.
//
// MULTI-PAGE BATCHES — see groupParsedInvoices below. Multi-page invoices
// very often only print the invoice number on page 1; continuation pages
// are frequently just line-item lists with no repeated header. An earlier
// version of this file assumed "files selected together are always pages
// of ONE invoice" to work around that — which was wrong, and merged a real
// batch of 6 separate invoices into 1. The actual fix: group by
// (supplier, invoice_number) whenever both are confidently read, and only
// fall back to "same invoice as the previous file" when a page's number
// genuinely can't be read at all. See groupParsedInvoices's own comment
// for the full reasoning and its honest limits.
//
// ASSUMPTION FLAGGED: the Storage bucket name ("invoices") is a guess — I
// never saw the actual upload code that used to populate invoices.file_url,
// only confirm-invoice.js consuming the URL after the fact. Verify this
// against your actual Supabase Storage bucket name before relying on it;
// if it's wrong, uploads will fail with a clear "bucket not found" error
// rather than silently going anywhere unexpected.
const STORAGE_BUCKET = 'invoices';

async function uploadFileToStorage(file, restaurantId) {
  const supabase = (await import('./supabaseClient')).default;
  const ext = file.name.split('.').pop();
  const path = `${restaurantId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const { error: uploadError } = await supabase.storage.from(STORAGE_BUCKET).upload(path, file);
  if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);
  const { data: { publicUrl } } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  return publicUrl;
}

/**
 * Uploads one file to Storage, then streams /api/invoices/parse-invoice's
 * status events. Returns the parse result only — makes no save decision.
 * Sends only the small file_url/file_name here, not the raw file — Vercel's
 * serverless functions have a hard 4.5MB request body limit at the platform
 * level; the actual file bytes are fetched server-to-server from Storage,
 * which has no such limit.
 */
async function parseInvoiceFile(file, restaurantId, accessToken, onStatus) {
  const publicUrl = await uploadFileToStorage(file, restaurantId);

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

  return { publicUrl, parseResult };
}

/**
 * Parses every file in a batch AT ONCE — this is the actual speed change.
 * One file's OCR-and-Claude pipeline doesn't depend on any other file's,
 * so there's no reason to make them wait on each other. A failure in one
 * file is captured per-item (error: string) rather than thrown, so one
 * bad photo doesn't sink the rest of the batch.
 *
 * @param {File[]} files
 * @param {string} restaurantId
 * @param {string} accessToken
 * @param {(fileIndex: number, fileName: string, message: string, detail?: string) => void} [onFileStatus]
 * @returns {Promise<Array<{ file: File, publicUrl?: string, parseResult?: object, error?: string }>>}
 */
export async function parseInvoiceBatch(files, restaurantId, accessToken, onFileStatus) {
  return Promise.all(files.map(async (file, i) => {
    try {
      const { publicUrl, parseResult } = await parseInvoiceFile(
        file, restaurantId, accessToken,
        (message, detail) => onFileStatus?.(i, file.name, message, detail)
      );
      return { file, publicUrl, parseResult };
    } catch (err) {
      console.error(`[uploadInvoice] Parse failed for "${file.name}":`, err.message);
      return { file, error: err.message };
    }
  }));
}

/**
 * Groups parsed batch items into actual invoices. This is the fix for a
 * real bug: the earlier design treated every file selected together as
 * pages of ONE invoice, full stop — which was built to handle continuation
 * pages that don't print an invoice number, but never accounted for the
 * opposite case, someone bulk-uploading several genuinely SEPARATE
 * invoices in one selection. It silently merged 6 real invoices into 1.
 *
 * The fix: every file already gets its own OCR'd supplier + invoice_number
 * before saving — use it. Group by (supplier, invoice_number) whenever
 * both are confidently read; a file with a different number than the one
 * before it is treated as a new, separate invoice. Only when a page's
 * number genuinely can't be read at all does it fall back to joining
 * whichever invoice immediately preceded it in the order the files were
 * selected — that's the actual continuation-page case this was originally
 * built for, and it's still handled correctly.
 *
 * HONEST LIMIT: this isn't foolproof. If OCR misreads a continuation
 * page's number as something *different* (rather than reading nothing),
 * this would incorrectly split it into its own invoice instead of merging
 * it. That's a real, remaining risk — just a much narrower one than
 * before, and the one this was designed to fix (bulk uploads of separate
 * invoices) is now handled correctly.
 *
 * @param {Array<{file:File, publicUrl?:string, parseResult?:object, error?:string}>} parsedItems
 *   — in the SAME order the files were originally selected; order matters
 *   for the fallback rule above.
 * @returns {Array<{key: string|null, items: Array}>}
 */
export function groupParsedInvoices(parsedItems) {
  const groups = [];
  let currentGroup = null;

  for (const item of parsedItems) {
    if (item.error) {
      // Failed items get their own group so they're reported individually,
      // never silently folded into a neighboring invoice.
      groups.push({ key: null, items: [item] });
      currentGroup = null;
      continue;
    }

    const supplier = (item.parseResult.invoice?.supplier || '').trim().toLowerCase();
    const number = (item.parseResult.invoice?.invoice_number || '').trim().toLowerCase();

    if (number) {
      const key = `${supplier}::${number}`;
      const existing = groups.find(g => g.key === key);
      if (existing) {
        existing.items.push(item);
        currentGroup = existing;
      } else {
        currentGroup = { key, items: [item] };
        groups.push(currentGroup);
      }
    } else if (currentGroup) {
      // No readable number — the real continuation-page case. Join
      // whatever invoice came immediately before it.
      currentGroup.items.push(item);
    } else {
      currentGroup = { key: null, items: [item] };
      groups.push(currentGroup);
    }
  }

  return groups;
}

/**
 * Saves one already-parsed invoice. This is the fast part (just DB writes),
 * kept sequential by the caller within a group so page 2+ of that SAME
 * invoice can correctly append to whatever invoice_id page 1 resolved to.
 * Different groups (different invoices) are independent of each other.
 *
 * @param {string|null} [forceAppendToInvoiceId] - if set, always appends
 *   into this invoice id, skipping the normal auto-save-as-new path AND
 *   the duplicate-detection path entirely — used for the 2nd+ file within
 *   one group, regardless of what that page's own OCR read for its number.
 * @returns {Promise<
 *   | { status: 'saved', invoiceId: string, itemsSaved: number, ingredientsCreated: number, ingredientsUpdated: number, errors: string[] }
 *   | { status: 'duplicate', existing: object }
 * >}
 */
export async function saveParsedInvoice(parseResult, publicUrl, restaurantId, accessToken, forceAppendToInvoiceId = null) {
  if (forceAppendToInvoiceId) {
    return confirmInvoiceSave(parseResult, publicUrl, restaurantId, accessToken, forceAppendToInvoiceId);
  }
  if (parseResult.duplicate) {
    return { status: 'duplicate', existing: parseResult.duplicate };
  }
  return confirmInvoiceSave(parseResult, publicUrl, restaurantId, accessToken, null);
}

async function confirmInvoiceSave(parseResult, publicUrl, restaurantId, accessToken, appendToInvoiceId) {
  const res = await fetch('/api/invoices/confirm-invoice', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      restaurant_id: restaurantId,
      invoice: parseResult.invoice,
      line_items: parseResult.line_items,
      file_urls: publicUrl ? [publicUrl] : [],
      ocr_text: parseResult.ocr_text,
      append_to_invoice_id: appendToInvoiceId || undefined,
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

/**
 * Confirms a flagged duplicate after the user picks merge-or-new in the
 * modal. append=true merges into the invoice parse-invoice.js flagged as a
 * likely match; append=false saves as a new, separate invoice regardless.
 */
export async function confirmDuplicateInvoice(parseResult, publicUrl, restaurantId, accessToken, append) {
  const appendToId = append ? parseResult.duplicate?.existing_id : null;
  return confirmInvoiceSave(parseResult, publicUrl, restaurantId, accessToken, appendToId);
}