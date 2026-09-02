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

export async function parseMenuFiles(files, restaurantId, accessToken) {
  const form = new FormData();
  for (const file of Array.from(files)) {
    form.append('file', file);
  }
  form.append('restaurant_id', restaurantId);

  const res = await fetch('/api/menu/parse-menu?review=true', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  });

  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Could not parse that menu.');
  if (!json.dishes?.length) throw new Error('No dishes found — try a clearer photo or a different file.');

  return { dishes: json.dishes, ingredientLibrary: json.ingredient_library || [] };
}