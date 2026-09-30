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
import useSWR from "swr";
import { useGuardedAccount } from "../../lib/useAccount";
import { fetchSampleData } from "../../lib/seedSampleData";
import { convertInvoiceCostToStandardUnit, getStandardUnitForIngredient } from "../../lib/standardizedUnits";

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

/* Sample invoice_items have no ingredient_id set (unlike real invoice
   data), so tour-mode history is matched by normalized name instead of FK. */
function buildSampleIngredientRows(sample) {
  const flatItems = [];
  (sample.invoices || []).forEach((inv) => {
    (inv.invoice_items || []).forEach((item) => {
      flatItems.push({ ...item, invoices: { id: inv.id, date: inv.date, supplier: inv.supplier, number: inv.number } });
    });
  });

  // fetchSampleData()'s menu_items query already nests
  // menu_item_components -> component_ingredients -> ingredients, so build
  // the same ingredient-id -> [dishes] map the real data path builds from
  // componentLinks, just sourced from the sample menuItems array instead.
  const menuByIngredient = new Map();
  (sample.menuItems || []).forEach((mi) => {
    (mi.menu_item_components || []).forEach((comp) => {
      (comp.component_ingredients || []).forEach((ci) => {
        const ingId = ci.ingredients?.id;
        if (!ingId) return;
        const list = menuByIngredient.get(ingId) || [];
        if (list.some((existing) => existing.id === mi.id)) return; // dish already added via another component
        list.push({
          id: mi.id,
          name: mi.name,
          qty: [ci.quantity, ci.unit].filter(Boolean).join(" ") || String(ci.quantity || ""),
          price: Number(mi.price) || 0,
          cost: null, // stored menu_items.cost is built from unapproved AI guesses
        });
        menuByIngredient.set(ingId, list);
      });
    });
  });

  return (sample.ingredients || []).map((g) => {
    const lines = flatItems
      .filter((r) => (r.ingredient_name_normalized || r.item_name || "").toLowerCase().trim() === (g.name || "").toLowerCase().trim())
      .sort((a, b) => (String(a.invoices.date) < String(b.invoices.date) ? 1 : -1));

    return {
      id: g.id,
      name: g.name,
      unit: g.unit || "ea",
      estimated: !!g.is_estimated,
      estimatedPrice: Number(g.last_price) || 0,
      supplier: lines[0]?.invoices?.supplier || null,
      lastOrdered: g.last_ordered_at ? shortDate(g.last_ordered_at) : lines[0] ? shortDate(lines[0].invoices.date) : null,
      history: toHistory(lines, g.unit || "ea", g.name),
      purchases: lines.map((r) => ({
        date: shortDate(r.invoices.date),
        supplier: r.invoices.supplier || "Supplier",
        invoice: r.invoices.number || "No number",
        invoiceId: r.invoices.id,
        qty: [r.quantity, r.unit || g.unit].filter(Boolean).join(" "),
        unitCost: toIngredientUnitCost(r, g.unit || "ea", g.name) ?? (Number(r.unit_cost) || 0),
      })),
      menuItems: menuByIngredient.get(g.id) || [],
    };
  });
}

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
/* Invoice lines store the price per the INVOICE's unit ($2.15/lb for a
   40 lb case). The ingredient is priced and labeled per its own unit (oz),
   so convert first — otherwise $2.15/lb displays as "$2.15/oz". Uses the
   same conversion confirm-invoice uses when it saves last_price, so the
   page and the saved price always agree. Null when the units don't line up. */
function toIngredientUnitCost(r, ingUnit, ingName) {
  const cost = Number(r.unit_cost);
  if (!isFinite(cost) || cost <= 0) return null;
  const from = r.unit || ingUnit;
  if (!from || from === ingUnit) return cost;
  if (getStandardUnitForIngredient(from, ingName || "") !== ingUnit) return null;
  return convertInvoiceCostToStandardUnit(cost, from, ingName || "");
}

function toHistory(rows, ingUnit, ingName) {
  const byMonth = new Map();
  rows.forEach((r) => {
    const iso = r.invoices?.date;
    const unitCost = toIngredientUnitCost(r, ingUnit, ingName);
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

  const [searchOpen, setSearchOpen] = useState(false);
  const [, setTourEndedTick] = useState(0);

  // Returns { rows, spend } instead of setting state, so the result can be
  // kept in the shared cache and shown instantly on the next visit.
  const load = useCallback(async (restaurantId, tourMode) => {
    if (tourMode) {
      const sample = await fetchSampleData();
      if (sample) {
        const rows = buildSampleIngredientRows(sample);
        const thisMonth = monthKey(new Date().toISOString());
        const flatItems = [];
        (sample.invoices || []).forEach((inv) => {
          (inv.invoice_items || []).forEach((item) => flatItems.push({ ...item, invoices: { date: inv.date } }));
        });
        const spend = flatItems
          .filter((r) => monthKey(r.invoices.date) === thisMonth)
          .reduce((a, r) => a + (Number(r.amount) || Number(r.unit_cost) * Number(r.quantity) || 0), 0);
        return { rows, spend };
      }
      // fetchSampleData() failed — fall through to the real query below.
    }
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
        cost: null, // stored menu_items.cost is built from unapproved AI guesses
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
        cost: null, // stored menu_items.cost is built from unapproved AI guesses
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
        // Only invoice prices and admin-approved estimates are shown to the
        // restaurant. A raw AI guess from the menu parse shows as no price.
        estimatedPrice: g.is_estimated === false || g.price_approved_at ? Number(g.last_price) || 0 : null,
        supplier: lines[0]?.invoices?.supplier || null,
        lastOrdered: g.last_ordered_at ? shortDate(g.last_ordered_at) : lines[0] ? shortDate(lines[0].invoices.date) : null,
        history: toHistory(lines, g.unit || "ea", g.name),
        purchases: lines.map((r) => ({
          date: shortDate(r.invoices.date),
          supplier: r.invoices.supplier || "Supplier",
          invoice: r.invoices.number || "No number",
          invoiceId: r.invoices.id,
          qty: [r.quantity, r.unit || g.unit].filter(Boolean).join(" "),
          unitCost: toIngredientUnitCost(r, g.unit || "ea", g.name) ?? (Number(r.unit_cost) || 0),
        })),
        menuItems: menuByIngredient.get(g.id) || [],
      };
    });

    /* Summary spend: this month's invoiced line items. */
    const thisMonth = monthKey(new Date().toISOString());
    const spend = history
      .filter((r) => monthKey(r.invoices.date) === thisMonth)
      .reduce((a, r) => a + (Number(r.amount) || Number(r.unit_cost) * Number(r.quantity) || 0), 0);
    return { rows, spend };
  }, []);

  // Account (login, profile, restaurant) comes from the shared cache: loaded
  // once per session, with the account checks applied on every page.
  const { account, loading: accountLoading, error: accountError } = useGuardedAccount();
  const restaurantId = account?.profile?.restaurant_id || null;
  const restaurantName = account?.restaurant?.name || "";
  const userName = account?.profile?.full_name || "";

  // Ingredient data is kept after the first visit: coming back shows it at
  // once while a fresh copy loads in the background.
  const tourMode = isTourQueryActive();
  const { data: ingData, error: ingError } = useSWR(
    restaurantId ? ["ingredients", restaurantId, tourMode] : null,
    () => load(restaurantId, tourMode)
  );
  const ingredients = ingData?.rows || [];
  const spend = ingData ? ingData.spend : null;
  const loading = accountLoading || (!!restaurantId && !ingData && !ingError);
  const error = accountError || (ingError ? ingError.message || "Could not load your ingredients" : null);

  // When the tour finishes, re-render so tourMode flips and real data loads.
  useEffect(() => {
    const handler = () => setTourEndedTick((n) => n + 1);
    window.addEventListener("optimenu-tour-ended", handler);
    return () => window.removeEventListener("optimenu-tour-ended", handler);
  }, []);

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
        onOpenMenuItem={(m) => m.id && router.push(`/client/menu-items?item=${m.id}`)}
        onOpenInvoice={(p) => p.invoiceId && router.push(`/client/invoices?invoice=${p.invoiceId}`)}
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