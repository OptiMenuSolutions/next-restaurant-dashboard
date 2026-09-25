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

// ── Launch a new menu ───────────────────────────────────────────────────
// Exact name matches are kept automatically.
//
// Unmatched parsed dishes remain new dishes. If an unmatched parsed dish has
// a similar name to an unmatched saved dish, that saved dish is offered only
// as a possible match for the user to confirm or deny during review.
//
// Similarity never merges, removes, renames, restores, or archives anything
// automatically.

const normName = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const similarityName = (s) =>
  normName(s)
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function nameSimilarity(a, b) {
  const aKey = similarityName(a);
  const bKey = similarityName(b);

  if (!aKey || !bKey) return 0;
  if (aKey === bKey) return 1;

  const aWords = [...new Set(aKey.split(" ").filter(Boolean))];
  const bWords = [...new Set(bKey.split(" ").filter(Boolean))];

  const bSet = new Set(bWords);
  const commonWords = aWords.filter((word) => bSet.has(word));
  const commonCount = commonWords.length;

  if (commonCount === 0) return 0;

  const shorterCount = Math.min(aWords.length, bWords.length);
  const longerCount = Math.max(aWords.length, bWords.length);

  // One-word names can still receive suggestions when that word is
  // meaningful, such as "Burger" versus "Classic Burger".
  if (
    shorterCount === 1 &&
    commonWords[0].length < 5
  ) {
    return 0;
  }

  const shorterCoverage = commonCount / shorterCount;
  const longerCoverage = commonCount / longerCount;

  const oneNameContainsTheOther =
    aKey.startsWith(`${bKey} `) ||
    bKey.startsWith(`${aKey} `) ||
    aKey.endsWith(` ${bKey}`) ||
    bKey.endsWith(` ${aKey}`);

  const containmentBonus = oneNameContainsTheOther ? 0.08 : 0;

  return Math.min(
    1,
    shorterCoverage * 0.72 +
      longerCoverage * 0.28 +
      containmentBonus
  );
}

export async function splitForMenuUpdate(parsedDishes, restaurantId) {
  const supabase = (await import("./supabaseClient")).default;

  const { data: existing, error } = await supabase
    .from("menu_items")
    .select(
      "id, name, price, category, description, archived_at"
    )
    .eq("restaurant_id", restaurantId);

  if (error) {
    throw new Error(
      `Could not load your current menu: ${error.message}`
    );
  }

  // One saved dish per exact normalized name. Prefer an active dish over
  // an archived dish when both exist.
  const byName = new Map();

  for (const menuItem of existing || []) {
    const key = normName(menuItem.name);
    const previous = byName.get(key);

    if (
      !previous ||
      (previous.archived_at && !menuItem.archived_at)
    ) {
      byName.set(key, menuItem);
    }
  }

  const matched = [];
  const newDishes = [];
  const keptIds = new Set();

  for (const [index, parsedDish] of parsedDishes.entries()) {
    const exactMatch = byName.get(normName(parsedDish.name));

    if (!exactMatch) {
      newDishes.push({
        ...parsedDish,
        _menuUpdateKey: `new-${index}`,
      });
      continue;
    }

    // The same exact dish can be returned twice from overlapping menu
    // photos. Only one parsed occurrence may claim the saved dish.
    if (keptIds.has(exactMatch.id)) continue;

    keptIds.add(exactMatch.id);

    matched.push({
      id: exactMatch.id,
      oldName: exactMatch.name,
      name: exactMatch.name,
      oldPrice: exactMatch.price,
      price: parsedDish.price ?? exactMatch.price,
      category: parsedDish.category || exactMatch.category || null,
      description:
        parsedDish.description ??
        exactMatch.description ??
        null,
      restored: Boolean(exactMatch.archived_at),
    });
  }

  // Only saved dishes that were not already claimed by an exact match can
  // be offered as possible matches. This enforces one saved dish per parsed
  // dish and prevents a kept item from being matched a second time.
  const matchableExisting = (existing || [])
    .filter((menuItem) => !keptIds.has(menuItem.id))
    .map((menuItem) => ({
      id: menuItem.id,
      name: menuItem.name,
      price: menuItem.price,
      category: menuItem.category,
      description: menuItem.description,
      archived_at: menuItem.archived_at,
    }));

  const possibleMatches = {};

  for (const parsedDish of newDishes) {
    const candidates = matchableExisting
      .map((savedDish) => ({
        ...savedDish,
        similarity: nameSimilarity(
          parsedDish.name,
          savedDish.name
        ),
      }))
      .filter((candidate) => candidate.similarity >= 0.68)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 3);

    if (candidates.length > 0) {
      possibleMatches[parsedDish._menuUpdateKey] = candidates;
    }
  }

  const toArchive = matchableExisting
    .filter((menuItem) => !menuItem.archived_at)
    .map((menuItem) => ({
      id: menuItem.id,
      name: menuItem.name,
    }));

  return {
    newDishes,
    matched,
    toArchive,
    possibleMatches,
    matchableExisting,
  };
}