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
function toDish(row, costHistory, covers) {
  const price = num(row.price);

  const components = (row.menu_item_components || []).map((c) => ({
    name: c.name || "Component",
    ingredients: (c.component_ingredients || []).map((ci) => {
      const g = ci.ingredients || {};
      const unitPrice = num(g.last_price);
      return {
        name: g.name || "Ingredient",
        unit: ci.unit || g.unit || "ea",
        qty: [ci.quantity, ci.unit || g.unit].filter(Boolean).join(" "),
        unitPrice,
        cost: num(ci.quantity) * unitPrice,
        costThen: null, // per-line history is not stored; the Δ column shows "—"
        estimated: !!g.is_estimated,
      };
    }),
  }));

  /* Dishes recorded the old way — a flat menu_item_ingredients list. */
  const flat = (row.menu_item_ingredients || []).map((mi) => {
    const g = mi.ingredients || {};
    const unitPrice = num(g.last_price);
    return {
      name: g.name || "Ingredient",
      unit: g.unit || "ea",
      qty: [mi.quantity, g.unit].filter(Boolean).join(" "),
      unitPrice,
      cost: num(mi.quantity) * unitPrice,
      costThen: null,
      estimated: !!g.is_estimated,
    };
  });
  if (flat.length) components.push({ name: "Recipe", ingredients: flat });

  const history = toMarginHistory(costHistory, price);
  const cost = num(row.cost) || components.reduce((a, c) => a + c.ingredients.reduce((n, i) => n + i.cost, 0), 0);
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
  const [repriceError, setRepriceError] = useState("");

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
    const since = new Date();
    since.setDate(since.getDate() - 30);

    const [{ data: menuItems }, { data: sales }] = await Promise.all([
      supabase
        .from("menu_items")
        .select(`
          id, name, price, cost, category,
          menu_item_components(id, name, cost,
            component_ingredients(id, quantity, unit, ingredients:ingredient_id(id, name, unit, last_price, is_estimated))),
          menu_item_ingredients(quantity, ingredients(id, name, unit, last_price, is_estimated))
        `)
        .eq("restaurant_id", restaurantId)
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
    const { data: history } = ids.length
      ? await supabase
          .from("menu_item_cost_history")
          .select("*")
          .in("menu_item_id", ids)
          .order("created_at", { ascending: true })
      : { data: [] };

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

  const periodLabel = useMemo(
    () => `Tonight’s prices · ${items.length} dishes costed · target margin ${Math.round(targetMargin)}%`,
    [items.length, targetMargin]
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
        onAddItem={() => router.push("/client/menu-items?new=1")}
        onUploadMenu={() => menuFileInput.current && menuFileInput.current.click()}
        onReprice={async (d, suggested) => {
          setRepriceError("");
          try {
            const { data: { session } } = await supabase.auth.getSession();
            const res = await fetch("/api/menu-items/update-price", {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
              body: JSON.stringify({ restaurant_id: restaurantId, menu_item_id: d.id, price: suggested }),
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || "Could not update price.");
            // Updates the SAME card in place — no navigation. margin/drift
            // are derived from price inside MenuItemsScreen's own render
            // transform, so updating price here is all that's needed for
            // those to recompute correctly on the next render.
            setItems((prev) => prev.map((item) => (item.id === d.id ? { ...item, price: suggested } : item)));
          } catch (err) {
            console.error("[menu-items] Reprice failed:", err);
            setRepriceError(err.message);
          }
        }}
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
        onChange={(e) => { handleMenuFiles(e.target.files); e.target.value = ""; }}
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

      {repriceError && (
        <div style={{ position: "fixed", bottom: 16, right: 16, zIndex: 500, maxWidth: 340, background: "#faeae8", border: "1px solid #c4473e", borderRadius: 10, padding: "12px 16px", fontFamily: "'Manrope',sans-serif", fontSize: 13, color: "#c4473e", boxShadow: "0 10px 30px rgba(17,24,25,0.15)" }}>
          <div style={{ fontWeight: 700 }}>{repriceError}</div>
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