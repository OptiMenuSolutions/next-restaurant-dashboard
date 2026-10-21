// lib/admin/settings.js
// Business numbers you set once and change rarely (hosting cost, tag kit
// cost and so on), kept in admin_settings. Edit them on Business, Settings.
// Each read falls back to a default.

export const SETTING_DEFAULTS = {
  hosting_monthly: 45, // what hosting costs you per month, split across live restaurants
  kit_cost: 24,        // what one tag kit costs you
  tag_cost: 5,         // what one loose tag costs you (replacements and add-ons)
  ship_from: '',       // your return address for mailing labels
  extra_tag_price: null, // what you charge per extra tag, set the first time you sell
  founding_price: null,  // founding member price per month (for admin numbers only)
  regular_price: null,   // regular price per month after founding seats run out
  founding_seats: null,  // how many founding seats there are
  tags_per_plan: 3,      // NFC tags in a welcome kit
  ai_daily_alert: 5,     // the daily line on AI & parsing, in dollars
};

export async function getSettings(db) {
  const { data } = await db.from('admin_settings').select('key, value');
  const out = { ...SETTING_DEFAULTS };
  for (const row of data || []) out[row.key] = row.value;
  return out;
}