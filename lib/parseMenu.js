// lib/parseMenu.js
// Shared client-side call to /api/menu/parse-menu?review=true, used by both
// pages/client/menu-items.js and pages/client/onboarding.js.
//
// Unlike lib/uploadInvoice.js, this has no live step-by-step status — parse-
// menu.js is one long synchronous request (OCR, then Pass 1, then Pass 2 per
// dish, all in one call) with no NDJSON streaming. A full menu can
// genuinely take a couple of minutes, especially with several dishes each
// needing their own Pass 2 recipe-build call. Callers should show a patient
// "this can take a few minutes" state, not a live progress list.
//
// Uploads each file to Storage first, then sends only the small file_url
// references to parse-menu.js — NOT the raw files. Vercel's serverless
// functions have a hard 4.5MB request body limit at the platform level;
// sending actual photo bytes here meant a handful of real menu photos
// could trivially exceed that combined and fail with a plain-text 413 the
// client couldn't even parse as JSON (exactly what showed up as "Unexpected
// token 'R'..." — the start of a "Request Entity Too Large" error).
// parse-menu.js now downloads each file itself, server-to-server, which has
// no such limit. Same fix, same reasoning, as lib/uploadInvoice.js.
//
// ASSUMPTION FLAGGED: the Storage bucket name ("menus") is a guess, same
// situation as "invoices" in lib/uploadInvoice.js — verify it matches your
// real bucket before relying on it; if wrong, this fails with a clear
// "bucket not found" error rather than going anywhere silently wrong.
const STORAGE_BUCKET = 'menus';

export async function parseMenuFiles(files, restaurantId, accessToken) {
  const supabase = (await import('./supabaseClient')).default;

  const fileRefs = [];
  for (const file of Array.from(files)) {
    const ext = file.name.split('.').pop();
    const path = `${restaurantId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const { error: uploadError } = await supabase.storage.from(STORAGE_BUCKET).upload(path, file);
    if (uploadError) throw new Error(`Upload failed for "${file.name}": ${uploadError.message}`);
    const { data: { publicUrl } } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
    fileRefs.push({ file_url: publicUrl, file_name: file.name });
  }

  const res = await fetch('/api/menu/parse-menu?review=true', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ restaurant_id: restaurantId, files: fileRefs }),
  });

  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Could not parse that menu.');
  if (!json.dishes?.length) throw new Error('No dishes found — try a clearer photo or a different file.');

  return { dishes: json.dishes, ingredientLibrary: json.ingredient_library || [] };
}