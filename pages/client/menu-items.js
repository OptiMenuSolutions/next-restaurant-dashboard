import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import supabase from "../../lib/supabaseClient";
import MenuItemsScreen from "../../components/client/MenuItemsScreen";
import { FONT_LINKS } from "../../components/client/ClientChrome";
import TourOverlay from "../../components/TourOverlay";
import { useTour } from "../../lib/useTour";
import UniversalSearch from "../../components/UniversalSearch";
import { enforceAccountGuard } from "../../lib/enforceAccountGuard";
import { parseMenuFiles } from "../../lib/parseMenu";
import { fetchSampleData } from "../../lib/seedSampleData";
import { calculateStandardizedCost, getUnitCategory, hasUnitMismatch } from "../../lib/standardizedUnits";

const SAMPLE_RESTAURANT_ID = "00000000-0000-0000-0000-000000000001";

function isTourQueryActive() {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  if (params.get("tour") !== "true") return false;
  try {
    return localStorage.getItem("optimenu_tour_done") !== "1";
  } catch {
    return true;
  }
}
import ParseReviewModal from "../../components/ParseReviewModal";

/**
 * pages/client/menu-items.js — menu items screen, v5 shell.
 *
 * Data container only. Queries match the current menu-items pages:
 *   - menu_items + menu_item_components + component_ingredients + ingredients
 *   - menu_item_ingredients (dishes whose recipe is flat, no components)
 *   - menu_item_cost_history (the margin trend and the Δ column)
 *   - pos_sales (covers, last 30 days — used for the weighted menu margin)
 * All markup lives in components/client/MenuItemsScreen.js.
 */

const MONTHS = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
const monthKey = (iso) => String(iso).slice(0, 7);
const monthLabel = (iso) => MONTHS[Number(String(iso).slice(5, 7)) - 1];
const num = (v) => Number(v) || 0;

/** menu_item_cost_history rows -> monthly margin series (%). */
function toMarginHistory(rows, price) {
  if (!price) return [];
  const byMonth = new Map();
  (rows || []).forEach((r) => {
    const iso = r.created_at || r.recorded_at;
    const cost = num(r.cost ?? r.new_cost);
    if (!iso || !cost) return;
    byMonth.set(monthKey(iso), { label: monthLabel(iso), cost });
  });
  return [...byMonth.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([, b]) => ({ label: b.label, value: ((price - b.cost) / price) * 100 }));
}

/** One menu_items row (with nested recipe) -> screen dish. */
function toDish(row, costHistory, covers, opts = {}) {
  const price = num(row.price);

  const components = (row.menu_item_components || []).map((c) => ({
    name: c.name || "Component",
    ingredients: (c.component_ingredients || []).map((ci) => {
      const g = ci.ingredients || {};
      // Only invoice prices and admin-approved estimates are shown to the
      // restaurant. Raw AI guesses from the menu parse count as unpriced.
      const priced = opts.trustPrices || g.is_estimated === false || !!g.price_approved_at;
      const unitPrice = priced ? num(g.last_price) : 0;
      const recipeUnit = ci.unit || g.unit || "ea";
      const ingredientUnit = g.unit || recipeUnit;
      // The recipe's unit (set once, at menu-parse time) and the
      // ingredient's CURRENT unit (which confirm-invoice.js can silently
      // change on every real invoice — e.g. standardizing "lb" to "oz")
      // can drift apart over an ingredient's life. A plain quantity x
      // unitPrice multiply then silently assumes they still match — this
      // converts first, and flags rather than guesses when it can't.
      return {
        name: g.name || "Ingredient",
        unit: recipeUnit,
        quantity: num(ci.quantity), // raw number — needed for live what-if math below
        qty: [ci.quantity, recipeUnit].filter(Boolean).join(" "),
        unitPrice,
        cost: calculateStandardizedCost(num(ci.quantity), recipeUnit, unitPrice, ingredientUnit, g.name),
        costThen: null, // per-line history is not stored; the Δ column shows "—"
        estimated: !!g.is_estimated,
        unitMismatch: hasUnitMismatch(recipeUnit, ingredientUnit),
        unpriced: !priced,
      };
    }),
  }));

  /* Dishes recorded the old way — a flat menu_item_ingredients list. */
  const flat = (row.menu_item_ingredients || []).map((mi) => {
    const g = mi.ingredients || {};
    const priced = opts.trustPrices || g.is_estimated === false || !!g.price_approved_at;
    const unitPrice = priced ? num(g.last_price) : 0;
    const recipeUnit = g.unit || "ea";
    const ingredientUnit = g.unit || recipeUnit;
    const unitMismatch =
      recipeUnit !== ingredientUnit && getUnitCategory(recipeUnit) !== getUnitCategory(ingredientUnit);
    return {
      name: g.name || "Ingredient",
      unit: recipeUnit,
      quantity: num(mi.quantity),
      qty: [mi.quantity, recipeUnit].filter(Boolean).join(" "),
      unitPrice,
      cost: calculateStandardizedCost(num(mi.quantity), recipeUnit, unitPrice, ingredientUnit),
      costThen: null,
      estimated: !!g.is_estimated,
      unitMismatch,
      unpriced: !priced,
    };
  });
  if (flat.length) components.push({ name: "Recipe", ingredients: flat });

  const history = toMarginHistory(costHistory, price);
  // Live, unit-converted recipe sum is the source of truth — same number the
  // detail footer shows. Stored menu_items.cost is only a fallback for dishes
  // with no recipe rows (e.g. tour sample data); it's only recomputed when an
  // invoice touches the dish, so it goes stale after any costing fix.
  const allLines = components.flatMap((c) => c.ingredients);
  const unpricedCount = allLines.filter((i) => i.unpriced).length;
  const recipeCost = allLines.reduce((n, i) => n + i.cost, 0);
  // Stored menu_items.cost was computed from AI price guesses — only fall
  // back to it for dishes with no recipe rows at all (tour sample data).
  const cost = allLines.length ? recipeCost : num(row.cost);
  const costThen = history.length ? price - (history[0].value / 100) * price : cost;

  return {
    id: row.id,
    name: row.name,
    category: row.category || "Uncategorised",
    price,
    cost,
    costThen,
    covers,
    history,
    components,
    unpricedCount,
  };
}

const NavLink = ({ href, style, className, children }) => (
  <Link href={href} style={style} className={className}>{children}</Link>
);

export default function MenuItemsPage() {
  const tour = useTour("menu-items");
  const router = useRouter();

  const signOut = async () => {
    await supabase.auth.signOut();
    router.push("/client/login");
  };

  const [loading, setLoading] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [error, setError] = useState(null);
  const [restaurantName, setRestaurantName] = useState("");
  const [restaurantId, setRestaurantId] = useState(null);
  const [userName, setUserName] = useState("");
  const [targetMargin, setTargetMargin] = useState(70);
  const [items, setItems] = useState([]);

  const menuFileInput = useRef(null);
  const [menuParsing, setMenuParsing] = useState(false);
  const [menuParseError, setMenuParseError] = useState("");
  const [reviewData, setReviewData] = useState(null); // { dishes, ingredientLibrary } | null

  // Same risk as onboarding's menu step, actually worse here — this page
  // has a full always-visible nav bar (Dashboard, Invoices, Ingredients,
  // Analytics), any of which would silently lose an in-flight or
  // not-yet-saved menu parse. Active from when parsing starts through the
  // whole review-modal period, since nothing's saved until it's committed.
  const menuFlowActive = menuParsing || !!reviewData;

  useEffect(() => {
    if (!menuFlowActive) return;

    const handleBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);

    const handleRouteChangeStart = () => {
      if (!window.confirm("Your menu is still being processed and hasn't been saved yet. Leave anyway?")) {
        router.events.emit("routeChangeError");
        // eslint-disable-next-line no-throw-literal
        throw "routeChange aborted."; // Next.js's own idiom for cancelling a route change from a routeChangeStart handler
      }
    };
    router.events.on("routeChangeStart", handleRouteChangeStart);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      router.events.off("routeChangeStart", handleRouteChangeStart);
    };
  }, [menuFlowActive, router.events]);

  async function handleMenuFiles(fileList) {
    if (!fileList || !fileList.length || !restaurantId) return;
    setMenuParseError("");
    setMenuParsing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const result = await parseMenuFiles(fileList, restaurantId, session?.access_token);
      setReviewData(result);
    } catch (err) {
      console.error("[menu-items] Menu parse failed:", err);
      setMenuParseError(err.message);
    } finally {
      setMenuParsing(false);
    }
  }

  const load = useCallback(async (restaurantId) => {
    if (isTourQueryActive()) {
      const sample = await fetchSampleData();
      if (sample) {
        const coverMap = new Map();
        (sample.posSales || []).forEach((s) => {
          const key = String(s.item_name || "").toLowerCase().trim();
          coverMap.set(key, (coverMap.get(key) || 0) + num(s.quantity_sold));
        });
        // Sample data has no menu_item_components/menu_item_ingredients or
        // menu_item_cost_history rows (same known gap as the dashboard
        // ticket recipe flip-side), so toDish() renders these dishes with
        // an empty recipe and no margin trend — real name/price/cost/
        // category and real cover counts still come through correctly.
        setItems(
          (sample.menuItems || []).map((m) =>
            toDish(m, [], coverMap.get(String(m.name || "").toLowerCase().trim()) || 0, { trustPrices: true })
          )
        );
        return;
      }
      // fetchSampleData() failed — fall through to the real query below.
    }

    const since = new Date();
    since.setDate(since.getDate() - 30);

    const [{ data: menuItems }, { data: sales }] = await Promise.all([
      supabase
        .from("menu_items")
        .select(`
          id, name, price, cost, category,
          menu_item_components(id, name, cost,
            component_ingredients(id, quantity, unit, ingredients:ingredient_id(id, name, unit, last_price, is_estimated, price_approved_at))),
          menu_item_ingredients(quantity, ingredients(id, name, unit, last_price, is_estimated, price_approved_at))
        `)
        .eq("restaurant_id", restaurantId)
        .is("archived_at", null)
        .order("name")
        .limit(500),
      supabase
        .from("pos_sales")
        .select("item_name, quantity_sold")
        .eq("restaurant_id", restaurantId)
        .gte("sale_date", since.toISOString().split("T")[0]),
    ]);

    const coverMap = new Map();
    (sales || []).forEach((s) => {
      const key = String(s.item_name || "").toLowerCase().trim();
      coverMap.set(key, (coverMap.get(key) || 0) + num(s.quantity_sold));
    });

    const ids = (menuItems || []).map((m) => m.id);
    // Supabase caps a select at 1,000 rows — this used to silently drop the
    // newest history and made drift compare against stale mid-May costs.
    const history = [];
    if (ids.length) {
      const PAGE = 1000;
      for (let from = 0; ; from += PAGE) {
        const { data: page, error: hErr } = await supabase
          .from("menu_item_cost_history")
          .select("menu_item_id, new_cost, created_at")
          .in("menu_item_id", ids)
          .order("created_at", { ascending: true })
          .range(from, from + PAGE - 1);
        if (hErr || !page || !page.length) break;
        history.push(...page);
        if (page.length < PAGE) break;
      }
    }

    const historyById = new Map();
    (history || []).forEach((h) => {
      const list = historyById.get(h.menu_item_id) || [];
      list.push(h);
      historyById.set(h.menu_item_id, list);
    });

    setItems(
      (menuItems || []).map((m) =>
        toDish(m, historyById.get(m.id) || [], coverMap.get(String(m.name || "").toLowerCase().trim()) || 0)
      )
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { router.push("/client/login"); return; }
        const { data: profile } = await supabase
          .from("profiles").select("restaurant_id, full_name").eq("id", user.id).single();
        if (!profile?.restaurant_id) { setLoading(false); return; }
        if (cancelled) return;
        setUserName(profile.full_name || "");

        const rest = await enforceAccountGuard(supabase, router, profile.restaurant_id);
        if (!rest) return;
        if (!cancelled) {
          setRestaurantId(profile.restaurant_id);
          setRestaurantName(rest?.name || "");
          if (rest?.target_food_cost) setTargetMargin(100 - num(rest.target_food_cost));
        }

        await load(profile.restaurant_id);
      } catch (e) {
        if (!cancelled) setError(e.message || "Could not load your menu");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [router, load]);

  useEffect(() => {
    const handler = () => { if (restaurantId) load(restaurantId); };
    window.addEventListener('optimenu-tour-ended', handler);
    return () => window.removeEventListener('optimenu-tour-ended', handler);
  }, [restaurantId, load]);

  const periodLabel = useMemo(
    () => {
      const costed = items.filter((i) => !i.unpricedCount).length;
      return `Tonight’s prices · ${costed} of ${items.length} dishes costed · target margin ${Math.round(targetMargin)}%`;
    },
    [items, targetMargin]
  );

  const initials = (userName || "Chef").split(" ").map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();

  return (
    <>
      <Head>
        <title>Menu items · OptiMenu</title>
        {FONT_LINKS}
      </Head>
      <MenuItemsScreen
        items={items}
        targetMargin={targetMargin}
        loading={loading}
        error={error}
        onRetry={() => router.reload()}
        periodLabel={periodLabel}
        onOpenItem={(d) => router.push(`/client/menu-items/${d.id}`)}
        onAddItem={() => menuFileInput.current && menuFileInput.current.click()}
        onSearch={() => setSearchOpen(true)}
        onSignOut={signOut}
        restaurantName={restaurantName || "Your restaurant"}
        user={{ initials: initials || "MR", firstName: (userName || "").split(" ")[0] || "Chef" }}
        NavLink={NavLink}
      />
      {tour.active && <TourOverlay tour={tour} />}

      <UniversalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />

      <input
        ref={menuFileInput}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png,.webp"
        multiple
        style={{ display: "none" }}
        onChange={(e) => {
          // Copy the files first: clearing the input empties the browser's
          // live FileList, and handleMenuFiles reads it after an await.
          const files = Array.from(e.target.files || []);
          e.target.value = "";
          handleMenuFiles(files);
        }}
      />

      {menuParsing && (
        <div style={{ position: "fixed", inset: 0, zIndex: 600, background: "rgba(17,24,25,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ background: "var(--shell,#fff)", border: "1px solid var(--line,#d8dfe0)", borderRadius: 14, padding: "32px 36px", textAlign: "center", maxWidth: 360, fontFamily: "'Manrope',sans-serif" }}>
            <div style={{ width: 32, height: 32, border: "3px solid #d8dfe0", borderTopColor: "#02a4ba", borderRadius: "50%", margin: "0 auto 18px", animation: "spin 0.8s linear infinite" }} />
            <div style={{ fontSize: 15, fontWeight: 700, color: "#111819", marginBottom: 6 }}>Reading your menu...</div>
            <div style={{ fontSize: 12.5, color: "#4b585b", lineHeight: 1.5 }}>Building dish-by-dish recipes can take a few minutes for a full menu — don't close this tab.</div>
          </div>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {menuParseError && (
        <div style={{ position: "fixed", bottom: 16, right: 16, zIndex: 500, maxWidth: 340, background: "#faeae8", border: "1px solid #c4473e", borderRadius: 10, padding: "12px 16px", fontFamily: "'Manrope',sans-serif", fontSize: 13, color: "#c4473e", boxShadow: "0 10px 30px rgba(17,24,25,0.15)" }}>
          <div style={{ fontWeight: 700 }}>{menuParseError}</div>
        </div>
      )}

      {reviewData && (
        <ParseReviewModal
          dishes={reviewData.dishes}
          ingredientLibrary={reviewData.ingredientLibrary}
          restaurantId={restaurantId}
          onCommitted={async () => {
            setReviewData(null);
            await load(restaurantId);
          }}
          onClose={() => setReviewData(null)}
        />
      )}
    </>
  );
}