import { useCallback, useEffect, useMemo, useState } from "react";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import supabase from "../../lib/supabaseClient";
import IngredientsScreen from "../../components/client/IngredientsScreen";
import { FONT_LINKS } from "../../components/client/ClientChrome";
import TourOverlay from "../../components/TourOverlay";
import { useTour } from "../../lib/useTour";
import UniversalSearch from "../../components/UniversalSearch";
import { enforceAccountGuard } from "../../lib/enforceAccountGuard";

/**
 * pages/client/ingredients.js — ingredients screen, v5 shell.
 *
 * Data container only. Queries match the current ingredients pages:
 *   - ingredients (list)                              … pages/client/ingredients.js
 *   - invoice_items + invoices (price + purchases)    … same file
 *   - menu_item_ingredients (menu items using it)     … pages/client/ingredients/[id].js
 * Purchase history is fetched once for the whole restaurant and grouped by
 * ingredient, so opening a row costs no extra round trip.
 */

const MONTHS = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
const monthKey = (iso) => String(iso).slice(0, 7);
const monthLabel = (iso) => MONTHS[Number(String(iso).slice(5, 7)) - 1];
const shortDate = (iso) => `${monthLabel(iso)} ${Number(String(iso).slice(8, 10))}`;

/** invoice_items rows for one ingredient -> monthly average price series. */
function toHistory(rows) {
  const byMonth = new Map();
  rows.forEach((r) => {
    const iso = r.invoices?.date;
    const unitCost = Number(r.unit_cost);
    if (!iso || !isFinite(unitCost) || unitCost <= 0) return;
    const key = monthKey(iso);
    const bucket = byMonth.get(key) || { label: monthLabel(iso), sum: 0, n: 0 };
    bucket.sum += unitCost;
    bucket.n += 1;
    byMonth.set(key, bucket);
  });
  return [...byMonth.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([, b]) => ({ label: b.label, value: Math.round((b.sum / b.n) * 100) / 100 }));
}

const NavLink = ({ href, style, className, children }) => (
  <Link href={href} style={style} className={className}>{children}</Link>
);

export default function IngredientsPage() {
  const tour = useTour("ingredients");
  const router = useRouter();

  const signOut = async () => {
    await supabase.auth.signOut();
    router.push("/client/login");
  };

  const [loading, setLoading] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [error, setError] = useState(null);
  const [restaurantName, setRestaurantName] = useState("");
  const [userName, setUserName] = useState("");
  const [ingredients, setIngredients] = useState([]);
  const [spend, setSpend] = useState(null);

  const load = useCallback(async (restaurantId) => {
    const [{ data: ings }, { data: items }, { data: flatLinks }, { data: componentLinks }] = await Promise.all([
      supabase.from("ingredients").select("*").eq("restaurant_id", restaurantId).order("name").limit(1000),
      supabase
        .from("invoice_items")
        .select("*, invoices!invoice_items_invoice_id_fkey(id, date, supplier, number, restaurant_id)")
        .not("ingredient_id", "is", null)
        .limit(5000),
      // Legacy flat structure — has no unit column, kept as a fallback for
      // any dish only ever recorded this way (not through components).
      supabase
        .from("menu_item_ingredients")
        .select("quantity, ingredient_id, menu_items!inner(id, name, price, cost, restaurant_id)")
        .eq("menu_items.restaurant_id", restaurantId),
      // Real recipe structure — component_ingredients DOES have a unit
      // column (confirmed against the schema), unlike the flat table above.
      // This is the primary source; the flat query is only a fallback merge.
      supabase
        .from("component_ingredients")
        .select(`
          quantity, unit, ingredient_id,
          menu_item_components!inner(
            menu_item_id,
            menu_items!inner(id, name, price, cost, restaurant_id)
          )
        `)
        .eq("menu_item_components.menu_items.restaurant_id", restaurantId),
    ]);

    const history = (items || []).filter((i) => i.invoices?.date && i.invoices?.restaurant_id === restaurantId);

    const byIngredient = new Map();
    history.forEach((r) => {
      const list = byIngredient.get(r.ingredient_id) || [];
      list.push(r);
      byIngredient.set(r.ingredient_id, list);
    });

    const menuByIngredient = new Map();

    // Component-based links first — these carry a real unit.
    (componentLinks || []).forEach((l) => {
      const mi = l.menu_item_components?.menu_items;
      if (!mi) return;
      const list = menuByIngredient.get(l.ingredient_id) || [];
      list.push({
        id: mi.id,
        name: mi.name,
        qty: [l.quantity, l.unit].filter(Boolean).join(" ") || String(l.quantity || ""),
        price: Number(mi.price) || 0,
        cost: Number(mi.cost) || 0,
      });
      menuByIngredient.set(l.ingredient_id, list);
    });

    // Flat-table links merged in, but only for a dish not already covered
    // via components — avoids double-listing a dish that has both (which
    // shouldn't normally happen, but isn't schema-enforced against).
    (flatLinks || []).forEach((l) => {
      const mi = l.menu_items;
      if (!mi) return;
      const list = menuByIngredient.get(l.ingredient_id) || [];
      if (list.some((existing) => existing.id === mi.id)) return;
      list.push({
        id: mi.id,
        name: mi.name,
        qty: String(l.quantity || ""), // no unit column on this legacy table
        price: Number(mi.price) || 0,
        cost: Number(mi.cost) || 0,
      });
      menuByIngredient.set(l.ingredient_id, list);
    });

    const rows = (ings || []).map((g) => {
      const lines = (byIngredient.get(g.id) || []).sort((a, b) =>
        String(a.invoices.date) < String(b.invoices.date) ? 1 : -1
      );
      return {
        id: g.id,
        name: g.name,
        unit: g.unit || "ea",
        estimated: !!g.is_estimated,
        estimatedPrice: Number(g.last_price) || 0,
        supplier: lines[0]?.invoices?.supplier || null,
        lastOrdered: g.last_ordered_at ? shortDate(g.last_ordered_at) : lines[0] ? shortDate(lines[0].invoices.date) : null,
        history: toHistory(lines),
        purchases: lines.map((r) => ({
          date: shortDate(r.invoices.date),
          supplier: r.invoices.supplier || "Supplier",
          invoice: r.invoices.number || "No number",
          invoiceId: r.invoices.id,
          qty: [r.quantity, r.unit || g.unit].filter(Boolean).join(" "),
          unitCost: Number(r.unit_cost) || 0,
        })),
        menuItems: menuByIngredient.get(g.id) || [],
      };
    });

    setIngredients(rows);

    /* Summary spend: this month's invoiced line items. */
    const thisMonth = monthKey(new Date().toISOString());
    setSpend(
      history
        .filter((r) => monthKey(r.invoices.date) === thisMonth)
        .reduce((a, r) => a + (Number(r.amount) || Number(r.unit_cost) * Number(r.quantity) || 0), 0)
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
        if (!cancelled) setRestaurantName(rest?.name || "");
        await load(profile.restaurant_id);
      } catch (e) {
        if (!cancelled) setError(e.message || "Could not load your ingredients");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [router, load]);

  const summary = useMemo(() => {
    const now = new Date();
    return {
      spend,
      periodLabel: now.toLocaleDateString("en-US", { month: "long", year: "numeric" }) + " · priced from your invoices",
      rangeLabel: "Since the first invoice",
    };
  }, [spend]);

  const initials = (userName || "Chef").split(" ").map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();

  return (
    <>
      <Head>
        <title>Ingredients · OptiMenu</title>
        {FONT_LINKS}
      </Head>
      <IngredientsScreen
        ingredients={ingredients}
        loading={loading}
        error={error}
        onRetry={() => router.reload()}
        summary={summary}
        onOpenMenuItem={(m) => m.id && router.push(`/client/menu-items/${m.id}`)}
        onOpenInvoice={(p) => p.invoiceId && router.push(`/client/invoices/${p.invoiceId}`)}
        onSearch={() => setSearchOpen(true)}
        onSignOut={signOut}
        onUploadInvoice={() => router.push("/client/invoices")}
        restaurantName={restaurantName || "Your restaurant"}
        user={{ initials: initials || "MR", firstName: (userName || "").split(" ")[0] || "Chef" }}
        NavLink={NavLink}
      />
      {tour.active && <TourOverlay tour={tour} />}

      <UniversalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
    </>
  );
}