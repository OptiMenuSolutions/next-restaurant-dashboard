import React, { useEffect, useMemo, useRef, useState } from "react";
import IngredientCard, { qtyLabel, MobileIngredientCard } from "./IngredientCard";
import {
  Shell, Header, MobileHeader, MobileNav, MobileTitle, MobileChips, MobileBackBar, mCard, LoadingState, EmptyState, ErrorState, StatePage,
  useTheme, useIsMobile, MONO, SANS, PAGE_PAD, SearchIcon, money,
} from "./ClientChrome";

/**
 * IngredientsScreen — ported from "OptiMenu Ingredients.dc.html".
 *
 * Left: sortable ingredient list with All / Risers / Needs-price filters.
 * Right: the pantry summary until a row is picked, then the ingredient detail —
 * price-per-unit trend (inline SVG), the menu items using it, and purchase
 * history. Estimated-price, mobile, loading and empty states included.
 *
 * Props
 *   ingredients [Ingredient] – see DEMO_INGREDIENTS:
 *     { id, name, unit, lastOrdered, supplier, estimated, estimatedPrice,
 *       history: [{ label, value }]           // oldest → newest, one per month
 *       purchases: [{ date, supplier, invoice, invoiceId, qty, unitCost }]
 *       menuItems: [{ id, name, qty, price, cost }] }
 *   loading, error, onRetry
 *   onOpenIngredient (ingredient) => void   – row → detail route (optional)
 *   onOpenMenuItem   (menuItem) => void
 *   onOpenInvoice    (purchase) => void
 *   onUploadInvoice  () => void             – empty-state CTA
 *   periodLabel, spendLabel …               – summary copy (see `summary` prop)
 *   summary { periodLabel, spend, invoiceCount, lineCount }  – optional override
 *   restaurantName, user, theme/defaultTheme/onThemeChange, NavLink
 */

const money2 = (n) => money(n, 2);
const moneyN = (n, d) => money(n, d);
// No change shows a dash, not "▲ 0.0%".
const pctLabel = (p) => (p == null || Math.abs(p) < 0.05 ? "—" : (p > 0 ? "▲ " : "▼ ") + Math.abs(p).toFixed(1) + "%");
// Rises are amber (watch). Red is kept for use it or lose it.
const pctColor = (p) => (p == null ? "var(--faint)" : p > 1.5 ? "var(--amber)" : p < -1.5 ? "var(--green)" : "var(--muted)");

const COLUMNS = [
  { label: "Ingredient", align: "left" },
  { label: "Price", align: "center" },
  { label: "30d", align: "right" },
  { label: "On hand · vs next 7 days", align: "left" },
];

/* The list's row and header grids: name, price, unit, change, on hand. */
const ROW_GRID = "minmax(0,1fr) 78px 44px 70px 200px";
const HEAD_GRID = "minmax(0,1fr) 136px 70px 200px";

export const DEMO_INGREDIENTS = [
  { id: 1, name: "Duck breast, magret", unit: "ea", lastOrdered: "AUG 23", supplier: "Sysco Northeast",
    history: [["MAR", 15.8], ["APR", 16.2], ["MAY", 16.05], ["JUN", 17.1], ["JUL", 17.6], ["AUG", 18.4]].map(([label, value]) => ({ label, value })),
    purchases: [
      { date: "AUG 23", supplier: "Sysco Northeast", invoice: "INV-88214", qty: "12 ea", unitCost: 18.4 },
      { date: "JUL 26", supplier: "Sysco Northeast", invoice: "INV-87551", qty: "12 ea", unitCost: 17.6 },
      { date: "JUN 28", supplier: "Sysco Northeast", invoice: "INV-86902", qty: "10 ea", unitCost: 17.1 },
      { date: "MAY 24", supplier: "D’Artagnan", invoice: "INV-86233", qty: "12 ea", unitCost: 16.05 },
      { date: "APR 26", supplier: "D’Artagnan", invoice: "INV-85604", qty: "10 ea", unitCost: 16.2 },
    ],
    menuItems: [
      { name: "Duck, sour cherry, hazelnut", qty: "1 ea", price: 42.0, cost: 19.85 },
      { name: "Duck rillettes, toast", qty: "0.35 ea", price: 18.0, cost: 8.1 },
    ] },
  { id: 2, name: "Butter, cultured 82%", unit: "kg", lastOrdered: "AUG 17", supplier: "Ronnybrook Dairy",
    history: [["MAR", 9.9], ["APR", 10.4], ["MAY", 11.2], ["JUN", 11.8], ["JUL", 12.6], ["AUG", 13.2]].map(([label, value]) => ({ label, value })),
    purchases: [
      { date: "AUG 17", supplier: "Ronnybrook Dairy", invoice: "INV-87812", qty: "12 kg", unitCost: 13.2 },
      { date: "JUL 20", supplier: "Ronnybrook Dairy", invoice: "INV-87344", qty: "12 kg", unitCost: 12.6 },
      { date: "JUN 22", supplier: "Ronnybrook Dairy", invoice: "INV-86780", qty: "10 kg", unitCost: 11.8 },
      { date: "MAY 18", supplier: "Baldor Produce", invoice: "INV-86104", qty: "10 kg", unitCost: 11.2 },
    ],
    menuItems: [
      { name: "Focaccia, whipped butter", qty: "0.06 kg", price: 12.0, cost: 3.05 },
      { name: "Cacio e pepe", qty: "0.03 kg", price: 26.0, cost: 6.4 },
      { name: "Brown butter tart", qty: "0.09 kg", price: 14.0, cost: 4.75 },
    ] },
  { id: 3, name: "Olive oil, blend 5L", unit: "ea", lastOrdered: "AUG 19", supplier: "Sysco Northeast",
    history: [["MAR", 38], ["APR", 39.5], ["MAY", 41], ["JUN", 43], ["JUL", 44.5], ["AUG", 46]].map(([label, value]) => ({ label, value })),
    purchases: [
      { date: "AUG 19", supplier: "Sysco Northeast", invoice: "INV-87903", qty: "4 ea", unitCost: 46 },
      { date: "JUL 12", supplier: "Sysco Northeast", invoice: "INV-87180", qty: "4 ea", unitCost: 44.5 },
      { date: "JUN 14", supplier: "Sysco Northeast", invoice: "INV-86640", qty: "6 ea", unitCost: 43 },
    ],
    menuItems: [
      { name: "Focaccia, whipped butter", qty: "0.02 ea", price: 12.0, cost: 3.05 },
      { name: "Caesar, little gem", qty: "0.01 ea", price: 17.0, cost: 4.2 },
      { name: "Broccolini, chili, lemon", qty: "0.01 ea", price: 15.0, cost: 3.4 },
      { name: "Fritto misto", qty: "0.03 ea", price: 21.0, cost: 6.9 },
    ] },
  { id: 4, name: "Broccolini", unit: "kg", lastOrdered: "AUG 22", supplier: "Baldor Produce",
    history: [["MAR", 9.4], ["APR", 10.1], ["MAY", 9.2], ["JUN", 8.8], ["JUL", 8.9], ["AUG", 8.6]].map(([label, value]) => ({ label, value })),
    purchases: [
      { date: "AUG 22", supplier: "Baldor Produce", invoice: "INV-88190", qty: "14 kg", unitCost: 8.6 },
      { date: "JUL 25", supplier: "Baldor Produce", invoice: "INV-87540", qty: "12 kg", unitCost: 8.9 },
    ],
    menuItems: [{ name: "Broccolini, chili, lemon", qty: "0.18 kg", price: 15.0, cost: 3.4 }] },
  { id: 5, name: "Saffron threads", unit: "g", lastOrdered: null, supplier: null, estimated: true, estimatedPrice: 9.5,
    history: [], purchases: [], menuItems: [] },
];

function decorate(g) {
  const h = g.history || [];
  // Purchases arrive newest first, each already in the ingredient's unit.
  const buys = (g.purchases || []).filter((p) => Number(p.unitCost) > 0);
  const price = buys.length
    ? Number(buys[0].unitCost)
    : h.length ? h[h.length - 1].value : g.estimatedPrice != null ? g.estimatedPrice : null;
  // No invoice history and no approved price: nothing to show yet.
  const awaiting = price == null;
  // Change since the previous delivery. History is averaged by month, so two
  // deliveries in the same month (a $2.15 -> $2.19 chicken increase) would
  // otherwise show no change at all.
  const prev = buys.length > 1 ? Number(buys[1].unitCost) : h.length > 1 ? h[h.length - 2].value : null;
  return {
    ...g,
    history: h,
    purchases: g.purchases || [],
    menuItems: g.menuItems || [],
    price,
    awaiting,
    pct: prev ? ((price - prev) / prev) * 100 : null,
    spanPct: h.length > 1 ? ((price - h[0].value) / h[0].value) * 100 : null,
  };
}

export default function IngredientsScreen({
  ingredients: ingredientsProp,
  loading = false,
  error = null,
  onRetry,
  onOpenIngredient,
  openIngredientId = null,
  onCloseIngredient,
  onOpenMenuItem,
  onOpenInvoice,
  onUploadInvoice,
  onSearch,
  onSignOut,
  summary: summaryProp,
  restaurantName = "Trattoria Lume",
  user,
  theme: themeProp,
  defaultTheme = "light",
  onThemeChange,
  NavLink,
  logoSrc,
  logoDarkSrc,
}) {
  const [theme, toggleTheme] = useTheme(themeProp, defaultTheme, onThemeChange);
  const isMobile = useIsMobile(900);
  const [filter, setFilter] = useState("All");
  const [searchText, setSearchText] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [invoicesOpen, setInvoicesOpen] = useState(false);

  const all = useMemo(() => (ingredientsProp || DEMO_INGREDIENTS).map(decorate), [ingredientsProp]);

  // Guided tour on phones: show the view a step needs (see lib/useTour.js).
  // "detail" keeps whatever is open, or opens the first ingredient.
  const firstIdRef = useRef(null);
  firstIdRef.current = all[0]?.id ?? null;
  useEffect(() => {
    const onView = (e) => {
      const v = e.detail?.view;

      if (v === "list") {
        setFilter("All");
        setSelectedId(null);
        setMenuOpen(false);
        setInvoicesOpen(false);
        if (onCloseIngredient) onCloseIngredient();
      }

      if (v === "detail") {
        setFilter("All");

        if (onOpenIngredient) {
          if (!openIngredientId && firstIdRef.current != null) {
            onOpenIngredient({ id: firstIdRef.current });
          }
        } else {
          setSelectedId((id) => id ?? firstIdRef.current);
        }
      }
    };

    window.addEventListener("optimenu-tour-view", onView);
    return () => window.removeEventListener("optimenu-tour-view", onView);
  }, [onOpenIngredient, onCloseIngredient, openIngredientId]);

  const risers = all.filter((g) => g.pct != null && g.pct > 1.5);
  const fallers = all.filter((g) => g.pct != null && g.pct < -1.5);
  const unpriced = all.filter((g) => g.estimated);
  // Use first: on hand with 3 days or less left.
  const useFirst = all.filter((g) => g.daysLeft != null && g.daysLeft <= 3 && Number(g.onHand) > 0);
  const invoicePriced = all.filter((g) => !g.estimated && !g.awaiting).length;
  const estimatedCount = all.filter((g) => g.estimated && !g.awaiting).length;
  const awaitingCount = all.filter((g) => g.awaiting).length;

  const filtered = filter === "Use first" ? useFirst : filter === "Risers" ? risers : filter === "Needs price" ? unpriced : all;
  const searchTerms = searchText.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = filtered.filter((g) => {
    const name = String(g.name || "").toLowerCase();
    return searchTerms.every((term) => name.includes(term));
  });
  // URL selection is independent of the filter so saved links and browser
  // Back/Forward always open the requested ingredient.
  const picked = onCloseIngredient
    ? all.find((g) => String(g.id) === String(openIngredientId)) || null
    : shown.find((g) => g.id === selectedId) || null;
  const selected = picked || (isMobile ? null : shown[0] || null);

  const select = (g) => {
    setSelectedId(g.id);
    setMenuOpen(false);
    setInvoicesOpen(false);
    if (onOpenIngredient) onOpenIngredient(g);
  };

  const clear = () => {
    setSelectedId(null);
    setMenuOpen(false);
    setInvoicesOpen(false);
    if (onCloseIngredient) onCloseIngredient();
  };

  useEffect(() => {
    setMenuOpen(false);
    setInvoicesOpen(false);
  }, [openIngredientId]);

  const chrome = (
    <Header active="ingredients" NavLink={NavLink} user={user} restaurantName={restaurantName} theme={theme} onToggleTheme={toggleTheme} onSearch={onSearch} onSignOut={onSignOut} logoSrc={logoSrc} logoDarkSrc={logoDarkSrc} />
  );
  const page = (children) => (
    <StatePage
      theme={theme} isMobile={isMobile} active="ingredients" NavLink={NavLink} header={chrome}
      mobileHeader={<MobileHeader theme={theme} onToggleTheme={toggleTheme} onSearch={onSearch} onSignOut={onSignOut} restaurantName={restaurantName} NavLink={NavLink} user={user} logoSrc={logoSrc} logoDarkSrc={logoDarkSrc} />}
    >
      {children}
    </StatePage>
  );

  if (loading) return page(<LoadingState label="Pricing your ingredients…" mobile={isMobile} />);
  if (error) return page(<ErrorState message={error} onRetry={onRetry} />);

  if (openIngredientId && !picked) {
    return page(
      <EmptyState
        kicker="Ingredient unavailable"
        title="We could not find that ingredient"
        body="It is not in your available ingredients. Return to the list to choose another."
      >
        <button
          type="button"
          onClick={clear}
          style={{ border: "1px solid var(--line)", borderRadius: 22, padding: "10px 18px", minHeight: 44, background: "var(--shell)", color: "var(--text)", fontFamily: SANS, fontWeight: 700, cursor: "pointer" }}
        >
          Back to ingredients
        </button>
      </EmptyState>
    );
  }

  if (!all.length) {
    return page(
        <EmptyState
          kicker="Nothing priced yet"
          title="Your ingredient list builds itself"
          body="Every line item we read off an invoice becomes an ingredient here, with its own price history. Upload a delivery invoice and this page fills in on its own."
        >
          <button type="button" onClick={onUploadInvoice} style={{ marginTop: 8, background: "var(--accent)", color: "#fff", border: "none", borderRadius: 24, padding: "12px 26px", fontFamily: SANS, fontSize: 14.5, fontWeight: 700, cursor: "pointer", boxShadow: "0 10px 24px rgba(2,164,186,0.28)" }}>Upload an invoice</button>
        </EmptyState>
    );
  }

  const countLabel = `Showing ${shown.length} of ${all.length} ingredients`;

  if (isMobile && selected) {
    return (
      <Shell theme={theme} style={{ position: "fixed", inset: 0, height: "auto", minHeight: 0, overflow: "hidden" }}>
        <MobileBackBar label="Ingredients" onBack={clear} title="Ingredient" />
        <div className="om-mscroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", padding: "0 16px 28px", display: "flex", flexDirection: "column", gap: 14, background: "var(--panel)" }}>
          <div
            data-tour="ing-detail"
            style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}
          >
            <MobileIngredientCard g={selected} onOpenMenuItem={onOpenMenuItem} onOpenInvoice={onOpenInvoice} />
          </div>
        </div>
        <MobileNav active="ingredients" NavLink={NavLink} />
      </Shell>
    );
  }

  if (isMobile) {
    const filterOpts = [
      { key: "All", label: `All · ${all.length}` },
      { key: "Use first", label: `Use first · ${useFirst.length}` },
      { key: "Risers", label: `Risers · ${risers.length}` },
      { key: "Needs price", label: `Needs price · ${unpriced.length}` },
    ];
    const pctOfAll = (n) => (all.length ? (n / all.length) * 100 : 0);
    const showAlert = useFirst.length > 0 && (filter === "All" || filter === "Use first");
    const uf = useFirst[0];
    const ufLeft = uf ? (uf.daysLeft <= 0 ? "USE TODAY" : uf.daysLeft === 1 ? "1 DAY LEFT" : uf.daysLeft + " DAYS LEFT") : "";
    const ufRisk = uf && uf.price
      ? Math.max(0, (Number(uf.onHand) || 0) - ((Number(uf.boughtPerWeek) || 0) / 7) * Math.max(uf.daysLeft || 0, 1)) * uf.price
      : 0;

    return (
      <Shell theme={theme} style={{ position: "fixed", inset: 0, height: "auto", minHeight: 0, overflow: "hidden" }}>
        <MobileHeader theme={theme} onToggleTheme={toggleTheme} onSearch={onSearch} onSignOut={onSignOut} restaurantName={restaurantName} NavLink={NavLink} user={user} logoSrc={logoSrc} logoDarkSrc={logoDarkSrc} />
        <div className="om-mscroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", padding: "18px 16px 28px", display: "flex", flexDirection: "column", gap: 14, background: "var(--panel)" }}>

          <MobileTitle kicker={`${restaurantName} · Purchasing`} title="Ingredients" sub="Priced from your invoices" />

          <label style={{ display: "flex", alignItems: "center", gap: 9, background: "var(--shell)", border: "1px solid var(--line)", borderRadius: 24, padding: "10px 14px", minHeight: 44, boxSizing: "border-box", minWidth: 0 }}>
            <SearchIcon size={16} />
            <input
              type="search"
              aria-label="Search ingredients"
              placeholder="Search ingredients"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              autoComplete="off"
              style={{ flex: 1, width: "100%", minWidth: 0, border: "none", background: "transparent", color: "var(--text)", fontFamily: SANS, fontSize: 16, outline: "none" }}
            />
          </label>

          <MobileChips options={filterOpts} value={filter} onChange={(k) => { setFilter(k); clear(); }} />

          {showAlert && uf && (
            <button
              type="button"
              onClick={() => (useFirst.length === 1 ? select(uf) : setFilter("Use first"))}
              style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, background: "color-mix(in srgb, var(--red) 8%, var(--shell))", border: "1px dashed var(--red)", borderRadius: 12, padding: "12px 14px", textAlign: "left", cursor: "pointer", fontFamily: SANS, color: "var(--text)" }}
            >
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontFamily: MONO, fontSize: 10, letterSpacing: "0.12em", fontWeight: 500, color: "var(--red)" }}>
                  ▲ USE FIRST · {useFirst.length === 1 ? ufLeft : useFirst.length + " INGREDIENTS"}
                </span>
                <span style={{ display: "block", fontSize: 14, fontWeight: 700, marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {useFirst.length === 1 ? uf.name : useFirst.map((g) => g.name).join(", ")}
                </span>
                {useFirst.length === 1 && (
                  <span style={{ display: "block", fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                    {qtyLabel(Number(uf.onHand) || 0, uf.unit)} on hand{ufRisk >= 1 ? ` · roughly ${money(ufRisk, 0)} at risk` : ""}
                  </span>
                )}
              </span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--red)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}><path d="M9 6l6 6-6 6" /></svg>
            </button>
          )}

          <div data-tour="ing-list" style={{ ...mCard, overflow: "hidden" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "10px 14px 8px", background: "var(--panel)", borderBottom: "1px solid var(--line-soft)", fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.12em", color: "var(--muted)" }}>
              <span>INGREDIENT · ON HAND VS NEXT 7 DAYS</span><span>PRICE · 30D</span>
            </div>
            {shown.map((g) => {
              const oh = Number(g.onHand) || 0;
              const wk = Number(g.boughtPerWeek) || 0;
              const cover = wk > 0 ? Math.min(100, Math.round((oh / wk) * 100)) : oh > 0 ? 100 : 0;
              const urgent = g.daysLeft != null && g.daysLeft <= 3 && oh > 0;
              const barColor = urgent ? "var(--red)" : wk > 0 && cover < 33 ? "var(--amber)" : "var(--accent)";
              return (
                <button key={g.id} type="button" data-tour="ing-row" onClick={() => select(g)} style={{ width: "100%", display: "flex", flexDirection: "column", gap: 6, padding: "12px 14px", background: "none", border: "none", borderBottom: "1px solid var(--line-soft)", textAlign: "left", cursor: "pointer", fontFamily: SANS, color: "var(--text)" }}>
                  <span style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
                      <span style={{ fontSize: 14.5, fontWeight: 700, letterSpacing: "-0.02em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{g.name}</span>
                      {g.estimated && !g.awaiting && (
                        <span style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--amber)", border: "1px solid var(--amber)", borderRadius: 9, padding: "0 5px", flexShrink: 0 }}>Est</span>
                      )}
                    </span>
                    <span style={{ whiteSpace: "nowrap", flexShrink: 0 }}>
                      <span style={{ fontSize: 15, fontWeight: 800, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums", color: g.awaiting ? "var(--faint)" : g.estimated ? "var(--amber)" : "var(--text)" }}>{g.awaiting ? "—" : money2(g.price)}</span>
                      {!g.awaiting && <span style={{ fontFamily: MONO, fontSize: 11, color: "var(--muted)" }}>/{g.unit}</span>}
                    </span>
                  </span>
                  <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                    <span style={{ fontFamily: MONO, fontSize: 10.5, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {g.awaiting ? "Awaiting an invoice" : g.estimated ? "Estimated price · no invoice yet" : `${g.supplier || "Supplier"} · last ${g.lastOrdered || "—"}`}
                    </span>
                    <span style={{ fontFamily: MONO, fontSize: 11.5, fontWeight: 500, whiteSpace: "nowrap", color: pctColor(g.pct) }}>{pctLabel(g.pct)}</span>
                  </span>
                  <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ flex: 1, height: 4, background: "var(--line-soft)", borderRadius: 2, overflow: "hidden" }}>
                      <span style={{ display: "block", height: "100%", width: cover + "%", background: barColor }} />
                    </span>
                    <span style={{ fontFamily: MONO, fontSize: 10.5, color: "var(--muted)", whiteSpace: "nowrap", minWidth: 54, textAlign: "right" }}>{oh > 0 ? qtyLabel(oh, g.unit) : "—"}</span>
                  </span>
                </button>
              );
            })}
            {shown.length === 0 && (
              <div style={{ padding: "24px 14px", textAlign: "center", fontSize: 13, color: "var(--muted)" }}>Nothing in this filter.</div>
            )}
            <div style={{ padding: "12px 14px 13px", background: "var(--panel)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
                <span style={{ fontSize: 13, fontWeight: 700 }}>{invoicePriced} of {all.length} priced from invoices</span>
                <span style={{ fontFamily: MONO, fontSize: 10.5, color: "var(--muted)" }}>{Math.round(pctOfAll(invoicePriced))}%</span>
              </div>
              <div style={{ height: 5, background: "var(--line)", borderRadius: 3, marginTop: 7, overflow: "hidden", display: "flex" }}>
                <div style={{ width: pctOfAll(invoicePriced) + "%", background: "var(--accent)" }} />
                <div style={{ width: pctOfAll(estimatedCount) + "%", background: "var(--amber)" }} />
              </div>
              <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--muted)", marginTop: 6 }}>
                <span style={{ color: "var(--accent-deep)" }}>■</span> Invoice · <span style={{ color: "var(--amber)" }}>■</span> {estimatedCount} estimated · {awaitingCount} awaiting an invoice
              </div>
            </div>
          </div>
        </div>
        <MobileNav active="ingredients" NavLink={NavLink} />
      </Shell>
    );
  }

  const pctOf = (n) => (all.length ? (n / all.length) * 100 : 0);

  return (
    <Shell theme={theme} style={{ height: "100vh", overflow: "hidden" }}>
      {chrome}
      <div style={{ padding: `16px ${PAGE_PAD} 20px`, display: "flex", flexDirection: "column", gap: 14, background: "var(--panel)", flex: 1, minHeight: 0, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 20, flexWrap: "wrap", flexShrink: 0 }}>
          <div>
            <div style={{ fontFamily: MONO, fontSize: 11.5, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--faint)", marginBottom: 5 }}>{restaurantName} · Purchasing</div>
            <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-0.035em", lineHeight: 1.1 }}>
              Ingredients <span style={{ color: "var(--faint)" }}>· priced from your invoices</span>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 7, background: "var(--shell)", border: "1px solid var(--line)", borderRadius: 20, padding: "7px 12px", minWidth: 0 }}>
              <SearchIcon size={13} />
              <input
                type="search"
                aria-label="Search ingredients"
                placeholder="Search ingredients"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                autoComplete="off"
                style={{ width: 160, minWidth: 0, border: "none", background: "transparent", color: "var(--text)", fontFamily: SANS, fontSize: 13, outline: "none" }}
              />
            </label>
            <div style={{ display: "flex", alignItems: "center", gap: 2, background: "var(--shell)", border: "1px solid var(--line)", borderRadius: 20, padding: 3 }}>
              {["All", "Use first", "Risers", "Needs price"].map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => { setFilter(f); clear(); }}
                  style={{ border: "none", cursor: "pointer", fontFamily: SANS, fontSize: 12.5, fontWeight: 600, borderRadius: 16, padding: "6px 12px", whiteSpace: "nowrap", background: filter === f ? "var(--accent)" : "transparent", color: filter === f ? "#fff" : "var(--muted)" }}
                >
                  {f === "Use first" ? `Use first · ${useFirst.length}` : f === "Risers" ? `Risers · ${risers.length}` : f === "Needs price" ? `Needs price · ${unpriced.length}` : f}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1fr)", gap: 16, flex: 1, minHeight: 0 }}>
          <div data-tour="ing-list" style={{ background: "var(--shell)", border: "1px solid var(--line)", borderRadius: 12, boxShadow: "var(--card-lift)", display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
            <div style={{ display: "grid", gridTemplateColumns: HEAD_GRID, gap: 14, padding: "12px 20px", borderBottom: "1px solid var(--line)", flexShrink: 0 }}>
              {COLUMNS.map((c) => (
                <span key={c.label} style={{ fontFamily: MONO, fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--faint)", textAlign: c.align }}>{c.label}</span>
              ))}
            </div>
            <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
              {shown.map((g) => {
                const active = selected && g.id === selected.id;
                return (
                  <div key={g.id} data-tour="ing-row" className="om-row" onClick={() => select(g)} style={{ display: "grid", gridTemplateColumns: ROW_GRID, gap: 14, alignItems: "center", padding: "9px 20px", borderBottom: "1px solid var(--line-soft)", cursor: "pointer", background: active ? "var(--accent-tint)" : "transparent", borderLeft: `2px solid ${active ? "var(--accent)" : "transparent"}` }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                        <span style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{g.name}</span>
                        {g.estimated && !g.awaiting && (
                          <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--amber)", border: "1px solid var(--amber)", borderRadius: 10, padding: "1px 5px", flexShrink: 0 }}>Est</span>
                        )}
                      </div>
                      <div style={{ fontFamily: MONO, fontSize: 10.5, color: "var(--faint)", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {g.awaiting ? "Awaiting an invoice" : g.estimated ? "Estimated price" : `${g.supplier || "Supplier"} · last ${g.lastOrdered || "—"}`}
                      </div>
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums", textAlign: "right", whiteSpace: "nowrap", color: g.awaiting ? "var(--faint)" : g.estimated ? "var(--amber)" : "var(--text)" }}>{g.awaiting ? "—" : money2(g.price)}</div>
                    <div style={{ fontFamily: MONO, fontSize: 11.5, color: "var(--faint)", whiteSpace: "nowrap" }}>{g.awaiting ? "" : `/${g.unit}`}</div>
                    <div style={{ fontFamily: MONO, fontSize: 12, fontWeight: 500, textAlign: "right", whiteSpace: "nowrap", color: pctColor(g.pct) }}>{pctLabel(g.pct)}</div>
                    {(() => {
                      // On hand against expected use over the next 7 days: full
                      // at a week or more, amber under a third of a week.
                      const oh = Number(g.onHand) || 0;
                      const wk = Number(g.boughtPerWeek) || 0;
                      const cover = wk > 0 ? Math.min(100, Math.round((oh / wk) * 100)) : oh > 0 ? 100 : 0;
                      return (
                        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                          <div style={{ flex: 1, height: 4, background: "var(--line-soft)", borderRadius: 2, overflow: "hidden" }}>
                            <div style={{ height: "100%", width: cover + "%", background: wk > 0 && cover < 33 ? "var(--amber)" : "var(--accent)" }} />
                          </div>
                          <span style={{ fontFamily: MONO, fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap", width: 70, textAlign: "right" }}>{oh > 0 ? qtyLabel(oh, g.unit) : "—"}</span>
                        </div>
                      );
                    })()}
                  </div>
                );
              })}
            </div>
            {/* How the list is priced: invoice, estimated, still awaiting. */}
            <div style={{ padding: "11px 20px 12px", borderTop: "1px solid var(--line)", flexShrink: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
                <span style={{ fontSize: 12.5, fontWeight: 700 }}>{invoicePriced} of {all.length} priced from invoices</span>
                <span style={{ fontFamily: MONO, fontSize: 10.5, color: "var(--faint)" }}>{Math.round(pctOf(invoicePriced))}%</span>
              </div>
              <div style={{ height: 5, background: "var(--line-soft)", borderRadius: 3, marginTop: 6, overflow: "hidden", display: "flex" }}>
                <div style={{ width: pctOf(invoicePriced) + "%", background: "var(--accent)" }} />
                <div style={{ width: pctOf(estimatedCount) + "%", background: "var(--amber)" }} />
              </div>
              <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--faint)", marginTop: 5 }}>
                <span style={{ color: "var(--accent-deep)" }}>■</span> Invoice · <span style={{ color: "var(--amber)" }}>■</span> {estimatedCount} estimated · {awaitingCount} awaiting an invoice
              </div>
            </div>
          </div>

          <div data-tour="ing-detail" style={{ minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column", background: "var(--shell)", border: "1px solid var(--line)", borderRadius: 12, boxShadow: "var(--card-lift)", animation: "om-rise .4s cubic-bezier(.25,.8,.35,1) both" }}>
            {selected ? (
              <IngredientCard g={selected} onOpenMenuItem={onOpenMenuItem} onOpenInvoice={onOpenInvoice} />
            ) : (
              <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, color: "var(--muted)" }}>Nothing in this filter.</div>
            )}
          </div>
        </div>
      </div>
    </Shell>
  );
}

/* ── right pane: pantry summary (nothing selected) ──────────────────── */

function Summary({ all, risers, fallers, unpriced, override, onPick, onNeedsPrice }) {
  const drifted = all.filter((g) => g.spanPct != null);
  const basketDrift = drifted.reduce((a, g) => a + g.spanPct, 0) / (drifted.length || 1);
  const movers = drifted.slice().sort((a, b) => Math.abs(b.spanPct) - Math.abs(a.spanPct)).slice(0, 5);

  const spend = override?.spend;
  const periodLabel = override?.periodLabel || "This month · priced from your invoices";
  const rangeLabel = override?.rangeLabel || "Since the first invoice";

  const stats = [
    { label: "Rising", value: String(risers.length), color: "var(--red)", note: "up since last month" },
    { label: "Falling", value: String(fallers.length), color: "var(--green)", note: "down since last month" },
    { label: "Basket drift", value: drifted.length ? (basketDrift >= 0 ? "+" : "−") + Math.abs(basketDrift).toFixed(1) + "%" : "—", color: drifted.length && basketDrift > 1.5 ? "var(--red)" : "var(--text)", note: "average across the list" },
  ];

  return (
    <>
      <div style={{ flexShrink: 0, background: "var(--accent-tint)", borderBottom: "1px solid var(--line)", borderLeft: "3px solid var(--accent)", padding: "20px 22px 18px", display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.04em", lineHeight: 1.05 }}>Pantry, this month</div>
          <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 7 }}>{periodLabel}</div>
        </div>
        {spend != null && (
          <div style={{ textAlign: "right", flexShrink: 0 }}>
            <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-0.045em", fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{typeof spend === "number" ? moneyN(spend, 0) : spend}</div>
            <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--accent-deep)", marginTop: 7 }}>Invoiced spend</div>
          </div>
        )}
      </div>

      <div style={{ flexShrink: 0, display: "grid", gridTemplateColumns: "repeat(3,1fr)", borderBottom: "1px solid var(--line)" }}>
        {stats.map((s) => (
          <div key={s.label} style={{ padding: "14px 18px", borderLeft: "1px solid var(--line-soft)" }}>
            <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--faint)" }}>{s.label}</div>
            <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.035em", fontVariantNumeric: "tabular-nums", marginTop: 6, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 3 }}>{s.note}</div>
          </div>
        ))}
      </div>

      <div style={{ flex: "1 1 auto", minHeight: 0, display: "flex", flexDirection: "column", background: "var(--panel)", padding: "16px 22px 18px" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexShrink: 0 }}>
          <span style={{ fontFamily: MONO, fontSize: 11.5, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--muted)" }}>Biggest movers</span>
          <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: "0.06em", color: "var(--faint)" }}>{rangeLabel}</span>
        </div>
        <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", marginTop: 10, borderTop: "1px dashed var(--line)" }}>
          {movers.map((g) => (
            <div key={g.id} onClick={() => onPick(g)} style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, padding: "10px 2px", borderBottom: "1px dashed var(--line)", cursor: "pointer" }}>
              <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{g.name}</span>
              <span style={{ display: "flex", alignItems: "baseline", gap: 12, flexShrink: 0, fontFamily: MONO, fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
                <span style={{ display: "flex", alignItems: "baseline", gap: 5, color: "var(--faint)" }}>
                  <span style={{ minWidth: 52, textAlign: "right" }}>{money2(g.history[0].value)}</span>
                  <span>→</span>
                  <span style={{ minWidth: 52, textAlign: "right" }}>{money2(g.price)}</span>
                </span>
                <span style={{ fontWeight: 600, color: pctColor(g.spanPct), minWidth: 62, textAlign: "right" }}>{pctLabel(g.spanPct)}</span>
              </span>
            </div>
          ))}
        </div>
        {unpriced.length > 0 && (
          <div style={{ flexShrink: 0, marginTop: 12, border: "1px dashed var(--amber)", borderRadius: 8, padding: "11px 13px", display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
            <span style={{ fontSize: 12.5, color: "var(--text)" }}>
              {unpriced.length === 1 ? `${unpriced[0].name} is waiting on its first invoice` : `${unpriced.length} ingredients are waiting on their first invoice`}
            </span>
            <button type="button" onClick={onNeedsPrice} style={{ background: "none", border: "none", cursor: "pointer", fontFamily: MONO, fontSize: 10.5, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--amber)", whiteSpace: "nowrap" }}>Review ›</button>
          </div>
        )}
      </div>
    </>
  );
}

/* ── right pane: one ingredient ─────────────────────────────────────── */

function Detail({ g, onBack, menuOpen, setMenuOpen, invoicesOpen, setInvoicesOpen, onOpenMenuItem, onOpenInvoice, stacked = false }) {
  const h = g.history;
  const hasHistory = h.length > 1;
  // Any invoice at all means real purchase data to show. The "no invoice yet"
  // message is only for ingredients that truly have none.
  const hasPurchases = g.purchases.length > 0;
  const chart = useMemo(() => buildChart(h), [h]);

  const menuTotal = g.menuItems.length;
  const menuVisible = Math.min(3, menuTotal);
  const card = (m) => {
    // m.cost is null for real accounts until plate costs come from
    // invoice or approved prices; show a dash rather than a guessed margin.
    const margin = m.price && m.cost != null ? ((m.price - m.cost) / m.price) * 100 : null;
    return {
      ...m,
      contribution: money2(g.price * (parseFloat(m.qty) || 0)),
      marginLabel: margin == null ? "—" : margin.toFixed(0) + "%",
      marginColor: margin == null ? "var(--faint)" : margin < 60 ? "var(--amber)" : "var(--muted)",
    };
  };

  return (
    <>
      <div style={{ flexShrink: 0, background: "var(--accent-tint)", borderBottom: "1px solid var(--line)", borderLeft: "3px solid var(--accent)", padding: "20px 22px 18px", display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16 }}>
        <div style={{ minWidth: 0 }}>
          <button type="button" onClick={onBack} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", padding: 0, marginBottom: 9, cursor: "pointer", fontFamily: MONO, fontSize: 10.5, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--accent-deep)" }}>
            <span style={{ fontSize: 14, lineHeight: 1 }}>‹</span><span>All ingredients</span>
          </button>
          <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.04em", lineHeight: 1.05 }}>{g.name}</div>
          <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 7, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {g.awaiting ? "No invoice yet" : g.estimated ? "Estimated price · no invoice yet" : `${g.supplier || "—"} · last ${g.lastOrdered || "—"}`}
          </div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-0.045em", fontVariantNumeric: "tabular-nums", lineHeight: 1, color: g.awaiting ? "var(--faint)" : g.estimated ? "var(--amber)" : "var(--text)" }}>{g.awaiting ? "—" : money2(g.price)}</div>
          <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--accent-deep)", marginTop: 7 }}>{g.awaiting ? "awaiting price" : `per ${g.unit}`}</div>
        </div>
      </div>

      {!hasPurchases && (
        <div style={{ padding: "28px 22px", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 9 }}>
          <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: g.awaiting ? "var(--faint)" : "var(--amber)" }}>{g.awaiting ? "Awaiting price" : "Estimated price"}</div>
          <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-0.02em" }}>{g.name} hasn’t come through on an invoice yet</div>
          <div style={{ fontSize: 13.5, lineHeight: 1.55, color: "var(--muted)", maxWidth: 320, textWrap: "pretty" }}>
            {g.awaiting
              ? "We’ll price it the first time we read it off a delivery. Until then, dishes that use it show as awaiting pricing."
              : "This is an estimated price, so menu costs using it are approximate. It will firm up the first time we read it off a delivery."}
          </div>
        </div>
      )}

      {hasPurchases && !menuOpen && !invoicesOpen && (
        <div style={{ display: "flex", alignItems: "stretch", flexWrap: "wrap", borderBottom: "1px solid var(--line)", flexShrink: 0 }}>
          <div style={{ flex: stacked ? "1 1 100%" : "1 1 150px", minWidth: 0, padding: "16px 18px 10px", display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 700, letterSpacing: "-0.02em", whiteSpace: "nowrap" }}>
                <span style={{ width: 7, height: 7, background: "var(--accent)", flexShrink: 0 }} />
                <span>Price history</span>
              </span>
              <span style={{ fontFamily: MONO, fontSize: 11.5, letterSpacing: "0.04em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0, color: pctColor(g.spanPct) }}>{g.spanPct == null ? "" : pctLabel(g.spanPct)}</span>
            </div>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", padding: "10px 24px 26px 30px" }}>
              <div style={{ position: "relative" }}>
                <svg viewBox="0 0 120 50" style={{ width: "100%", height: "auto", display: "block", overflow: "visible" }}>
                  {chart.gridLines.map((gl, i) => (
                    <line key={i} x1="0" y1={gl.y} x2="120" y2={gl.y} stroke="var(--line-soft)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                  ))}
                  <path d={chart.areaPath} fill="var(--accent-tint)" stroke="none" />
                  <path d={chart.linePath} fill="none" stroke="var(--accent)" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                </svg>
                {chart.points.map((p, i) => (
                  <div key={"pt" + i} style={{ position: "absolute", left: p.leftPct, top: p.topPct, width: 9, height: 9, margin: "-4.5px 0 0 -4.5px", borderRadius: "50%", background: "var(--shell)", border: "2.2px solid var(--accent)" }} />
                ))}
                {chart.gridLines.map((gl, i) => (
                  <div key={"gl" + i} style={{ position: "absolute", right: "100%", marginRight: 8, top: gl.topPct, transform: "translateY(-50%)", fontFamily: MONO, fontSize: 11.5, color: "var(--faint)", whiteSpace: "nowrap" }}>{gl.label}</div>
                ))}
                {chart.points.map((p, i) => (
                  <div key={"lb" + i} style={{ position: "absolute", top: "100%", marginTop: 6, left: p.leftPct, transform: "translateX(-50%)", fontFamily: MONO, fontSize: 11.5, color: "var(--faint)", whiteSpace: "nowrap" }}>{p.label}</div>
                ))}
              </div>
            </div>
          </div>

          <div style={{ flex: stacked ? "1 1 100%" : "0 0 236px", minWidth: 0, padding: "16px 18px 18px", borderLeft: stacked ? "none" : "1px solid var(--line)", borderTop: stacked ? "1px solid var(--line)" : "none" }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 700, letterSpacing: "-0.02em" }}>
                <span style={{ width: 7, height: 7, border: "1.5px solid var(--accent)", borderRadius: "50%" }} />On the menu
              </span>
              <span style={{ fontFamily: MONO, fontSize: 11.5, color: "var(--faint)" }}>{menuTotal ? `${menuTotal} items` : "none yet"}</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2,96px)", gap: 8, marginTop: 12 }}>
              {g.menuItems.slice(0, menuVisible).map(card).map((m, i) => (
                <div key={i} onClick={() => onOpenMenuItem && onOpenMenuItem(m)} className="om-hover-accent" style={{ aspectRatio: "1", background: "var(--panel)", border: "1px solid var(--line-soft)", borderRadius: 10, padding: 9, display: "flex", flexDirection: "column", justifyContent: "space-between", cursor: "pointer", overflow: "hidden" }}>
                  <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.2, textWrap: "pretty", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden", minHeight: 41 }}>{m.name}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <div style={{ fontFamily: MONO, fontSize: 10, color: "var(--faint)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.contribution} cost</div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums", color: m.marginColor }}>{m.marginLabel}</span>
                      <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: m.marginColor }}>mgn</span>
                    </div>
                  </div>
                </div>
              ))}
              {menuVisible < menuTotal && (
                <button type="button" onClick={() => setMenuOpen(true)} className="om-hover-accent" style={{ aspectRatio: "1", background: "none", border: "1px dashed var(--line)", borderRadius: 10, cursor: "pointer", fontFamily: SANS, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, color: "var(--muted)" }}>
                  <span style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: "0.1em", textTransform: "uppercase" }}>View all</span>
                  <span style={{ fontSize: 15, lineHeight: 1 }}>›</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {hasPurchases && menuOpen && (
        <div style={{ flex: "1 1 auto", minHeight: 0, display: "flex", flexDirection: "column", background: "var(--panel)", padding: "16px 22px 20px" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexShrink: 0 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 700, letterSpacing: "-0.02em" }}>
              <span style={{ width: 7, height: 7, border: "1.5px solid var(--accent)", borderRadius: "50%" }} />On the menu
            </span>
            <button type="button" onClick={() => setMenuOpen(false)} style={{ background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontFamily: MONO, fontSize: 10.5, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--muted)" }}>
              <span style={{ fontSize: 14, lineHeight: 1 }}>‹</span><span>Back</span>
            </button>
          </div>
          <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(146px,1fr))", gap: 12, alignContent: "start", overflowY: "auto", minHeight: 0 }}>
            {g.menuItems.map(card).map((m, i) => (
              <div key={i} onClick={() => onOpenMenuItem && onOpenMenuItem(m)} className="om-hover-accent" style={{ aspectRatio: "1", background: "var(--shell)", border: "1px solid var(--line)", borderRadius: 10, padding: 14, display: "flex", flexDirection: "column", justifyContent: "space-between", cursor: "pointer" }}>
                <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: "-0.025em", lineHeight: 1.2, textWrap: "pretty" }}>{m.name}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  <div style={{ fontFamily: MONO, fontSize: 11.5, color: "var(--text)" }}>{m.qty} per plate</div>
                  <div style={{ fontFamily: MONO, fontSize: 11.5, color: "var(--faint)" }}>{m.contribution} cost</div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 5, marginTop: 2 }}>
                    <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums", color: m.marginColor }}>{m.marginLabel}</span>
                    <span style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase", color: m.marginColor }}>margin</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {hasPurchases && !menuOpen && (
        <div style={{ flex: "1 1 auto", minHeight: 0, display: "flex", flexDirection: "column", background: "var(--panel)", padding: "16px 22px 18px" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexShrink: 0 }}>
            <span style={{ fontFamily: MONO, fontSize: 11.5, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--muted)" }}>Purchase history</span>
            <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: "0.06em", color: "var(--faint)" }}>
              {invoicesOpen ? `All ${g.purchases.length} deliveries` : "Tap a line to open the invoice"}
            </span>
          </div>
          <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", marginTop: 10, borderTop: "1px dashed var(--line)" }}>
            {(invoicesOpen ? g.purchases : g.purchases.slice(0, 3)).map((p, i) => (
              <div key={i} onClick={() => onOpenInvoice && onOpenInvoice(p)} style={{ padding: "9px 2px", borderBottom: "1px dashed var(--line)", cursor: "pointer", fontFamily: MONO }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span style={{ fontSize: 12.5, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.supplier}</span>
                  <span style={{ flex: 1, borderBottom: "1px dotted var(--faint)", transform: "translateY(-3px)" }} />
                  <span style={{ fontSize: 12.5, fontWeight: 500, color: "var(--text)", whiteSpace: "nowrap" }}>{money2(p.unitCost)}</span>
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 3, fontSize: 11, color: "var(--faint)" }}>
                  <span>{p.date}</span><span>·</span><span>{p.qty}</span><span>·</span>
                  <span style={{ color: "var(--accent-deep)" }}>{p.invoice}</span>
                </div>
              </div>
            ))}
          </div>
          {g.purchases.length > 3 && (
            <button type="button" onClick={() => setInvoicesOpen(!invoicesOpen)} className="om-hover-accent" style={{ flexShrink: 0, marginTop: 10, background: "none", border: "1px dashed var(--line)", borderRadius: 8, padding: "9px 12px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 7, fontFamily: MONO, fontSize: 10.5, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--muted)" }}>
              <span>{invoicesOpen ? "Back to price history" : "View all invoices"}</span>
              <span style={{ fontSize: 14, lineHeight: 1 }}>{invoicesOpen ? "‹" : "›"}</span>
            </button>
          )}
        </div>
      )}
    </>
  );
}

/* Trend geometry for the 120×50 viewBox used above. */
function buildChart(history) {
  const h = history || [];
  const costs = h.map((p) => p.value);
  const min = costs.length ? Math.min(...costs) : 0;
  const max = costs.length ? Math.max(...costs) : 0;
  const pad = (max - min) * 0.35 || max * 0.1 || 1;
  const lo = min - pad, hi = max + pad;
  const VB_W = 120, VB_H = 50, X0 = 1.5, X1 = 118.5, Y0 = 3.5, Y1 = 46.5;
  const px = (i) => (h.length < 2 ? (X0 + X1) / 2 : X0 + (i / (h.length - 1)) * (X1 - X0));
  const py = (v) => Y1 - ((v - lo) / (hi - lo || 1)) * (Y1 - Y0);
  const midIdx = Math.floor((h.length - 1) / 2);
  const points = h.map((p, i) => ({
    x: px(i).toFixed(2),
    y: py(p.value).toFixed(2),
    topPct: ((py(p.value) / VB_H) * 100).toFixed(2) + "%",
    leftPct: ((px(i) / VB_W) * 100).toFixed(2) + "%",
    label: i === 0 || i === h.length - 1 || i === midIdx ? p.label : "",
  }));
  const linePath = points.map((p, i) => (i ? "L" : "M") + p.x + " " + p.y).join(" ");
  const areaPath = points.length ? `${linePath} L${points[points.length - 1].x} ${Y1} L${points[0].x} ${Y1} Z` : "";
  const gridLines = [hi - (hi - lo) * 0.1, (hi + lo) / 2, lo + (hi - lo) * 0.1].map((v) => ({
    y: py(v).toFixed(1),
    topPct: ((py(v) / VB_H) * 100).toFixed(2) + "%",
    label: moneyN(v, v < 10 ? 2 : 0),
  }));
  return { points, linePath, areaPath, gridLines };
}