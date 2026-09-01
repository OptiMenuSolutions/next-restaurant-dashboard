// lib/parsePOScsv.js

// Known column mappings for major POS systems
const POS_MAPPINGS = {
  toast: {
    item_name: ['menu item', 'item name', 'item', 'product', 'menu item name'],
    quantity_sold: ['quantity', 'qty', 'count', 'num sold', 'quantity sold'],
    revenue: ['net amount', 'net sales', 'revenue', 'sales', 'net revenue', 'total'],
    unit_price: ['price', 'unit price', 'menu price', 'item price'],
    category: ['category', 'menu group', 'group', 'section'],
    sale_date: ['date', 'business date', 'sale date', 'order date'],
    hour_of_day: ['hour', 'hour of day', 'time hour'],
    voids: ['void qty', 'voids', 'void quantity', 'voided'],
    comps: ['comp amount', 'comps', 'comp total', 'complimentary'],
  },
  square: {
    item_name: ['item', 'item name', 'description', 'product name'],
    quantity_sold: ['qty', 'quantity', 'units sold'],
    revenue: ['gross sales', 'net sales', 'revenue', 'total collected'],
    unit_price: ['price', 'unit price', 'gross amount'],
    category: ['category', 'type'],
    sale_date: ['date', 'transaction date', 'payment date'],
    hour_of_day: ['hour', 'time'],
    voids: ['refunds', 'voids'],
    comps: ['discounts', 'comps', 'discount amount'],
  },
  clover: {
    item_name: ['name', 'item name', 'item', 'line item'],
    quantity_sold: ['quantity', 'qty', 'count'],
    revenue: ['revenue', 'net revenue', 'amount', 'total'],
    unit_price: ['price', 'unit price', 'rate'],
    category: ['category', 'group'],
    sale_date: ['date', 'order date', 'close date'],
    hour_of_day: ['hour'],
    voids: ['void', 'voids'],
    comps: ['discount', 'comp'],
  },
  lightspeed: {
    item_name: ['product', 'item name', 'description', 'sku name'],
    quantity_sold: ['quantity sold', 'qty sold', 'units'],
    revenue: ['net sales', 'revenue', 'total sales'],
    unit_price: ['unit price', 'price', 'sell price'],
    category: ['category', 'department', 'family'],
    sale_date: ['date', 'completed date', 'sale date'],
    hour_of_day: ['hour', 'time'],
    voids: ['voided', 'voids'],
    comps: ['discount', 'comps'],
  },
  other: {
    item_name: ['item', 'name', 'product', 'description', 'menu item', 'dish'],
    quantity_sold: ['quantity', 'qty', 'count', 'sold', 'units'],
    revenue: ['revenue', 'sales', 'total', 'amount', 'net'],
    unit_price: ['price', 'unit price', 'rate'],
    category: ['category', 'type', 'group', 'section'],
    sale_date: ['date', 'sale date', 'order date'],
    hour_of_day: ['hour', 'time'],
    voids: ['void', 'voids', 'refund'],
    comps: ['comp', 'comps', 'discount'],
  },
};

/**
 * Parse CSV text into array of objects
 */
export function parseCSV(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 2) throw new Error('CSV must have at least a header row and one data row');

  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, '').toLowerCase());

  return lines.slice(1).map(line => {
    // Handle quoted fields with commas inside
    const values = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"') { inQuotes = !inQuotes; continue; }
      if (line[i] === ',' && !inQuotes) { values.push(current.trim()); current = ''; continue; }
      current += line[i];
    }
    values.push(current.trim());

    const row = {};
    headers.forEach((h, i) => { row[h] = values[i] || ''; });
    return row;
  }).filter(row => Object.values(row).some(v => v !== ''));
}

/**
 * Auto-detect which POS system a CSV came from based on headers
 */
export function detectPOSSystem(headers) {
  const lowerHeaders = headers.map(h => h.toLowerCase());

  const scores = {};
  for (const [system, mapping] of Object.entries(POS_MAPPINGS)) {
    if (system === 'other') continue;
    let score = 0;
    for (const synonyms of Object.values(mapping)) {
      if (synonyms.some(s => lowerHeaders.includes(s))) score++;
    }
    scores[system] = score;
  }

  const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  return best[1] >= 2 ? best[0] : 'other';
}

/**
 * Given CSV headers and a POS system, return the best column mapping
 * Returns { field: detectedColumnName } or { field: null } if not found
 */
export function buildColumnMapping(headers, posSystem = 'other') {
  const lowerHeaders = headers.map(h => h.toLowerCase());
  const mapping = POS_MAPPINGS[posSystem] || POS_MAPPINGS.other;
  const result = {};

  for (const [field, synonyms] of Object.entries(mapping)) {
    const match = synonyms.find(s => lowerHeaders.includes(s));
    result[field] = match ? headers[lowerHeaders.indexOf(match)] : null;
  }

  return result;
}

/**
 * Parse a date string into YYYY-MM-DD
 */
function parseDate(str) {
  if (!str) return null;
  // Try various formats
  const cleaned = str.trim().replace(/"/g, '');
  const formats = [
    /^(\d{4})-(\d{2})-(\d{2})/, // YYYY-MM-DD
    /^(\d{2})\/(\d{2})\/(\d{4})/, // MM/DD/YYYY
    /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/, // M/D/YY or M/D/YYYY
  ];

  for (const fmt of formats) {
    const m = cleaned.match(fmt);
    if (m) {
      try {
        const d = new Date(cleaned);
        if (!isNaN(d)) return d.toISOString().split('T')[0];
      } catch {}
    }
  }

  // Fallback
  try {
    const d = new Date(cleaned);
    if (!isNaN(d)) return d.toISOString().split('T')[0];
  } catch {}

  return null;
}

/**
 * Parse hour from a time string like "14:30:00" or "2:30 PM"
 */
function parseHour(str) {
  if (!str) return null;
  const cleaned = str.trim().replace(/"/g, '');

  // HH:MM:SS or HH:MM
  const hms = cleaned.match(/^(\d{1,2}):(\d{2})/);
  if (hms) {
    const h = parseInt(hms[1]);
    if (cleaned.toLowerCase().includes('pm') && h < 12) return h + 12;
    if (cleaned.toLowerCase().includes('am') && h === 12) return 0;
    return h;
  }

  // Just a number
  const n = parseInt(cleaned);
  if (!isNaN(n) && n >= 0 && n <= 23) return n;

  return null;
}

/**
 * Parse a numeric value, removing currency symbols and commas
 */
function parseNum(str) {
  if (!str) return 0;
  const cleaned = str.toString().replace(/[$,\s"]/g, '');
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

/**
 * Convert raw CSV rows into normalized pos_sales records
 * using the provided column mapping
 */
export function normalizeRows(rows, columnMapping, restaurantId, posSystem) {
  const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  return rows
    .map(row => {
      const get = (field) => {
        const col = columnMapping[field];
        return col ? row[col] || row[col.toLowerCase()] || '' : '';
      };

      const itemName = get('item_name').trim();
      if (!itemName) return null;

      const saleDateStr = get('sale_date');
      const saleDate = parseDate(saleDateStr);
      if (!saleDate) return null;

      const hourStr = get('hour_of_day');
      const hour = parseHour(hourStr);

      const dayOfWeek = saleDate
        ? DAY_NAMES[new Date(saleDate + 'T12:00:00').getDay()]
        : null;

      return {
        restaurant_id: restaurantId,
        sale_date: saleDate,
        item_name: itemName,
        category: get('category').trim() || null,
        quantity_sold: parseNum(get('quantity_sold')),
        revenue: parseNum(get('revenue')),
        unit_price: parseNum(get('unit_price')) || null,
        hour_of_day: hour,
        day_of_week: dayOfWeek,
        voids: Math.round(parseNum(get('voids'))),
        comps: parseNum(get('comps')),
        pos_system: posSystem,
      };
    })
    .filter(Boolean);
}
