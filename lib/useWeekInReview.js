/**
 * lib/useWeekInReview.js
 *
 * Custom hook that fetches and computes 7-day recommendation performance data.
 * Shared by WeekInReviewCard (desktop) and MobileWeekInReview.
 *
 * @param {string}   restaurantId  - The restaurant's UUID
 * @param {object[]} wasteRisk     - Output of computeWasteRisk — used for wasteSaved calculation
 * @param {object[]} menuItems     - Full menu items array with nested components + ingredients
 * @param {string}   [rangeFrom]   - Optional 'YYYY-MM-DD' start of an extra date range to fetch
 *                                   (e.g. the calendar's visible month). The trailing 7 days are
 *                                   always fetched too, so summary stats stay week-based.
 * @param {string}   [rangeTo]     - Optional 'YYYY-MM-DD' end of the extra range (clamped to today)
 *
 * @returns {{
 *   weekData:       object[],  - Per-day performance objects
 *   weekExtraSold:  number,    - Total extra portions sold vs. average across the week
 *   weekWasteSaved: number,    - Total estimated waste cost saved across the week ($)
 *   hitRate:        number,    - % of days with recommendations that beat average
 *   loading:        boolean,
 * }}
 */

import { useState, useEffect, useMemo } from 'react';
import supabase from './supabaseClient';

const TICKET_COLORS = ['var(--accent)', 'var(--color-green)', 'var(--color-amber)'];

// Historical sales window: 67 days (9.5 weeks) rather than exactly 60 so that
// each day-of-week has at least 9 data points for a stable average.
const HISTORY_DAYS = 67;

/**
 * Builds a map of { dishNameLower → [{ ingredientNameLower, quantity, unitCost }] }
 * for waste-saved calculation. Only includes ingredients that appear in wasteRisk.
 *
 * @param {object[]} menuItems
 * @param {object[]} wasteRisk
 * @returns {Map<string, { nameLower: string, quantity: number, unitCost: number }[]>}
 */
function buildAtRiskIngredientMap(menuItems, wasteRisk) {
  const atRiskByName = new Map();
  for (const w of (wasteRisk || [])) {
    const key = (w.name || '').toLowerCase().trim();
    if (key) atRiskByName.set(key, w);
  }

  const map = new Map();
  for (const item of (menuItems || [])) {
    const dishKey = (item.name || '').toLowerCase().trim();
    if (!dishKey) continue;

    const atRiskIngs = [];
    for (const comp of (item.menu_item_components || [])) {
      for (const ci of (comp.component_ingredients || [])) {
        const ingName    = (ci.ingredients?.name || '').trim();
        const ingNameLow = ingName.toLowerCase();
        const riskEntry  = atRiskByName.get(ingNameLow);
        if (!riskEntry) continue;
        atRiskIngs.push({
          nameLower: ingNameLow,
          quantity:  parseFloat(ci.quantity || 0),
          unitCost:  riskEntry.unitCost,
        });
      }
    }

    // Only store dishes that actually have at-risk ingredients
    if (atRiskIngs.length > 0) map.set(dishKey, atRiskIngs);
  }

  return map;
}

/**
 * Calculates estimated waste cost saved for a dish given how many portions were sold.
 * wasteSaved = sum over all at-risk ingredients of (qtySold × recipeQuantity × unitCost)
 *
 * @param {string} dishName
 * @param {number} qtySold
 * @param {Map}    atRiskIngredientMap
 * @returns {number}
 */
function calcWasteSaved(dishName, qtySold, atRiskIngredientMap) {
  if (!qtySold || qtySold <= 0) return 0;
  const dishKey = (dishName || '').toLowerCase().trim();
  const ings    = atRiskIngredientMap.get(dishKey);
  if (!ings || ings.length === 0) return 0;

  return ings.reduce((sum, ing) => {
    return sum + (qtySold * ing.quantity * ing.unitCost);
  }, 0);
}

export function useWeekInReview(restaurantId, wasteRisk, menuItems, rangeFrom, rangeTo) {
  const [weekData, setWeekData] = useState([]);
  const [loading, setLoading]   = useState(true);

  // Build the at-risk ingredient map once when wasteRisk or menuItems change
  const atRiskIngredientMap = useMemo(
    () => buildAtRiskIngredientMap(menuItems, wasteRisk),
    [menuItems, wasteRisk]
  );

  useEffect(() => {
    if (restaurantId) loadWeekData();
  }, [restaurantId, rangeFrom, rangeTo]);

  async function loadWeekData() {
    setLoading(true);
    try {
      // Trailing 7-day window (oldest → newest) — always fetched so the
      // weekly summary stats stay stable regardless of which month is shown
      const last7 = Array.from({ length: 7 }, (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - i);
        return d.toISOString().split('T')[0];
      }).reverse();

      // Optional extra range (e.g. the calendar's visible month), clamped to today
      const todayStr = last7[last7.length - 1];
      const rangeDays = [];
      if (rangeFrom && rangeTo) {
        const cur = new Date(rangeFrom + 'T12:00:00');
        const end = new Date((rangeTo <= todayStr ? rangeTo : todayStr) + 'T12:00:00');
        while (cur <= end) {
          rangeDays.push(cur.toISOString().split('T')[0]);
          cur.setDate(cur.getDate() + 1);
        }
      }

      const days = [...new Set([...rangeDays, ...last7])].sort();
      const fromDate = days[0];
      const toDate   = days[days.length - 1];

      // Fetch current-week recs + sales, and historical sales for DOW averages
      const [{ data: recs }, { data: sales }] = await Promise.all([
        supabase
          .from('ai_recommendations')
          .select('generated_date,recommendations')
          .eq('restaurant_id', restaurantId)
          .gte('generated_date', fromDate)
          .lte('generated_date', toDate)
          .order('generated_date', { ascending: false }),
        supabase
          .from('pos_sales')
          .select('item_name,quantity_sold,sale_date')
          .eq('restaurant_id', restaurantId)
          .gte('sale_date', fromDate)
          .lte('sale_date', toDate),
      ]);

      // DOW averages come from the 67 days *before* the viewed window, so a
      // past month is compared against averages from its own era
      const historyStart = new Date(fromDate + 'T12:00:00');
      historyStart.setDate(historyStart.getDate() - HISTORY_DAYS);
      const historyStartStr = historyStart.toISOString().split('T')[0];

      const { data: historicSales } = await supabase
        .from('pos_sales')
        .select('item_name,quantity_sold,sale_date')
        .eq('restaurant_id', restaurantId)
        .gte('sale_date', historyStartStr)
        .lt('sale_date', fromDate);

      // Build DOW average map: { itemName: { dow: [qty, ...] } }
      const avgByItemDay = {};
      for (const s of (historicSales || [])) {
        const dow = new Date(s.sale_date + 'T12:00:00').getDay();
        if (!avgByItemDay[s.item_name])          avgByItemDay[s.item_name]       = {};
        if (!avgByItemDay[s.item_name][dow])      avgByItemDay[s.item_name][dow]  = [];
        avgByItemDay[s.item_name][dow].push(parseFloat(s.quantity_sold || 0));
      }

      // Build current-week sales map: { date: { itemName: qty } }
      const salesByDateItem = {};
      for (const s of (sales || [])) {
        if (!salesByDateItem[s.sale_date]) salesByDateItem[s.sale_date] = {};
        salesByDateItem[s.sale_date][s.item_name] =
          (salesByDateItem[s.sale_date][s.item_name] || 0) + parseFloat(s.quantity_sold || 0);
      }

      // Build recs map: { date: recommendations[] }
      const recsMap = {};
      for (const r of (recs || [])) {
        recsMap[r.generated_date] = r.recommendations || [];
      }

      const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

      const built = days.map(date => {
        const dow      = new Date(date + 'T12:00:00').getDay();
        const daySales = salesByDateItem[date] || {};
        const dayRecs  = recsMap[date] || [];

        // Build per-dish performance — wrap in try/catch so one malformed
        // rec object cannot break the entire day's data
        const dishes = dayRecs.slice(0, 3).map((rec, i) => {
          try {
            const name = (rec.title || rec.dish || '').trim();
            const sold = daySales[name] ?? 0;
            const hist = avgByItemDay[name]?.[dow] || [];
            const avg  = hist.length > 0
              ? hist.reduce((a, b) => a + b, 0) / hist.length
              : null;

            // ?? instead of || so a diff of exactly 0 is preserved, not
            // silently treated as null/no-uplift
            const diff = avg !== null ? sold - avg : null;
            const pct  = avg !== null && avg > 0
              ? Math.round((diff / avg) * 100)
              : null;

            return {
              name,
              sold,
              avg,
              diff,
              pct,
              type:        rec.type,
              ticketColor: TICKET_COLORS[i],
            };
          } catch {
            return {
              name:        rec?.title || rec?.dish || '',
              sold:        0,
              avg:         null,
              diff:        null,
              pct:         null,
              type:        rec?.type,
              ticketColor: TICKET_COLORS[i],
            };
          }
        });

        const extraSold = Math.round(
          dishes.reduce((s, d) => s + (d.diff ?? 0), 0) * 10
        ) / 10;

        // wasteSaved: sum across all recommended dishes of
        // (qty sold × recipe ingredient qty × ingredient unitCost)
        // for every at-risk ingredient in that dish's recipe
        const wasteSaved = Math.round(
          dishes.reduce((s, dish) => {
            return s + calcWasteSaved(dish.name, dish.sold, atRiskIngredientMap);
          }, 0)
        );

        return {
          date,
          dayLabel: DAY_NAMES[dow],
          dishes,
          extraSold,
          wasteSaved,
        };
      });

      setWeekData(built);
    } catch (e) {
      console.error('[useWeekInReview]', e);
    } finally {
      setLoading(false);
    }
  }

  // Derived summary stats — always computed over the trailing 7 days, even
  // when weekData also contains a browsed month from rangeFrom/rangeTo
  const last7Data = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 6);
    const start = d.toISOString().split('T')[0];
    return weekData.filter(x => x.date >= start);
  }, [weekData]);

  const weekExtraSold = useMemo(
    () => Math.round(last7Data.reduce((s, d) => s + Math.max(0, d.extraSold), 0) * 10) / 10,
    [last7Data]
  );

  const weekWasteSaved = useMemo(
    () => last7Data.reduce((s, d) => s + d.wasteSaved, 0),
    [last7Data]
  );

  const hitRate = useMemo(() => {
    const daysWithData = last7Data.filter(d => d.dishes.length > 0).length;
    return daysWithData > 0
      ? Math.round((last7Data.filter(d => d.extraSold > 0).length / daysWithData) * 100)
      : 0;
  }, [last7Data]);

  return { weekData, weekExtraSold, weekWasteSaved, hitRate, loading };
}