import React, { useMemo, useState } from "react";
import {
  Shell, Header, MobileHeader, MobileNav, LoadingState, EmptyState, ErrorState,
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
const pctLabel = (p) => (p == null ? "—" : (p >= 0 ? "▲ " : "▼ ") + Math.abs(p).toFixed(1) + "%");
const pctColor = (p) => (p == null ? "var(--faint)" : p > 1.5 ? "var(--red)" : p < -1.5 ? "var(--green)" : "var(--muted)");

const COLUMNS = [
  { label: "Ingredient", align: "left" },
  { label: "Price", align: "center" },
  { label: "30d", align: "right" },
];

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
  const price = h.length ? h[h.length - 1].value : g.estimatedPrice != null ? g.estimatedPrice : g.price || 0;
  const prev = h.length > 1 ? h[h.length - 2].value : null;
  return {
    ...g,
    history: h,
    purchases: g.purchases || [],
    menuItems: g.menuItems || [],
    price,
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
  const [selectedId, setSelectedId] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [invoicesOpen, setInvoicesOpen] = useState(false);

  const all = useMemo(() => (ingredientsProp || DEMO_INGREDIENTS).map(decorate), [ingredientsProp]);

  const risers = all.filter((g) => g.pct != null && g.pct > 1.5);
  const fallers = all.filter((g) => g.pct != null && g.pct < -1.5);
  const unpriced = all.filter((g) => g.estimated);
  const priced = all.filter((g) => !g.estimated);

  const shown = filter === "Risers" ? risers : filter === "Needs price" ? unpriced : all;
  const selected = shown.find((g) => g.id === selectedId) || null;

  const select = (g) => { setSelectedId(g.id); setMenuOpen(false); setInvoicesOpen(false); if (onOpenIngredient) onOpenIngredient(g); };
  const clear = () => { setSelectedId(null); setMenuOpen(false); setInvoicesOpen(false); };

  const chrome = (
    <Header active="ingredients" NavLink={NavLink} user={user} restaurantName={restaurantName} theme={theme} onToggleTheme={toggleTheme} onSearch={onSearch} onSignOut={onSignOut} logoSrc={logoSrc} logoDarkSrc={logoDarkSrc} />
  );

  if (loading) return <Shell theme={theme}>{chrome}<LoadingState label="Pricing your ingredients…" /></Shell>;
  if (error) return <Shell theme={theme}>{chrome}<ErrorState message={error} onRetry={onRetry} /></Shell>;

  if (!all.length) {
    return (
      <Shell theme={theme}>
        {chrome}
        <EmptyState
          kicker="Nothing priced yet"
          title="Your ingredient list builds itself"
          body="Every line item we read off an invoice becomes an ingredient here, with its own price history. Upload a delivery invoice and this page fills in on its own."
        >
          <button type="button" onClick={onUploadInvoice} style={{ marginTop: 8, background: "var(--accent)", color: "#fff", border: "none", borderRadius: 24, padding: "12px 26px", fontFamily: SANS, fontSize: 14.5, fontWeight: 700, cursor: "pointer", boxShadow: "0 10px 24px rgba(2,164,186,0.28)" }}>Upload an invoice</button>
        </EmptyState>
      </Shell>
    );
  }

  const countLabel = `Showing ${shown.length} of ${all.length} ingredients`;

  if (isMobile) {
    return (
      <Shell theme={theme}>
        <MobileHeader theme={theme} onToggleTheme={toggleTheme} user={user} logoSrc={logoSrc} logoDarkSrc={logoDarkSrc} />
        <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--line)" }}>
          <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: "-0.03em" }}>Ingredients</div>
          <div style={{ fontFamily: MONO, fontSize: 11.5, letterSpacing: "0.08em", color: "var(--faint)", marginTop: 3 }}>{countLabel}</div>
        </div>
        <div style={{ flex: 1, padding: 16, display: "flex", flexDirection: "column", gap: 10, background: "var(--panel)" }}>
          {shown.map((g) => (
            <div key={g.id} onClick={() => onOpenIngredient && onOpenIngredient(g)} style={{ background: "var(--shell)", border: "1px solid var(--line)", borderRadius: 12, padding: "13px 14px", display: "flex", flexDirection: "column", gap: 7 }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
                <span style={{ fontSize: 14.5, fontWeight: 700, letterSpacing: "-0.02em" }}>{g.name}</span>
                <span style={{ fontSize: 14.5, fontWeight: 800, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums", color: g.estimated ? "var(--amber)" : "var(--text)" }}>{money2(g.price)}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <span style={{ fontFamily: MONO, fontSize: 11.5, color: "var(--faint)" }}>per {g.unit} · {g.lastOrdered || "never"}</span>
                <span style={{ fontFamily: MONO, fontSize: 11.5, fontWeight: 500, color: pctColor(g.pct) }}>{pctLabel(g.pct)}</span>
              </div>
            </div>
          ))}
        </div>
        <MobileNav active="ingredients" NavLink={NavLink} />
      </Shell>
    );
  }

  const monthMoved = all.reduce((a, g) => (g.pct != null && g.pct > 0 ? a + 1 : a), 0);

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
            <button type="button" onClick={onSearch} className="om-hover-accent" style={{ display: "flex", alignItems: "center", gap: 7, background: "var(--shell)", border: "1px solid var(--line)", borderRadius: 20, padding: "7px 12px", cursor: "pointer" }}>
              <SearchIcon size={13} />
              <span style={{ fontSize: 12.5, color: "var(--faint)" }}>Search ingredients</span>
            </button>
            <div style={{ display: "flex", alignItems: "center", gap: 2, background: "var(--shell)", border: "1px solid var(--line)", borderRadius: 20, padding: 3 }}>
              {["All", "Risers", "Needs price"].map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => { setFilter(f); clear(); }}
                  style={{ border: "none", cursor: "pointer", fontFamily: SANS, fontSize: 12.5, fontWeight: 600, borderRadius: 16, padding: "6px 12px", whiteSpace: "nowrap", background: filter === f ? "var(--accent)" : "transparent", color: filter === f ? "#fff" : "var(--muted)" }}
                >
                  {f === "Risers" ? `Risers · ${risers.length}` : f}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(420px,0.95fr) minmax(0,1fr)", gap: 16, flex: 1, minHeight: 0 }}>
          <div data-tour="ing-list" style={{ background: "var(--shell)", border: "1px solid var(--line)", borderRadius: 12, boxShadow: "var(--card-lift)", display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 126px 66px", gap: 14, padding: "12px 20px", borderBottom: "1px solid var(--line)", flexShrink: 0 }}>
              {COLUMNS.map((c) => (
                <span key={c.label} style={{ fontFamily: MONO, fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--faint)", textAlign: c.align }}>{c.label}</span>
              ))}
            </div>
            <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
              {shown.map((g) => {
                const active = selected && g.id === selected.id;
                return (
                  <div key={g.id} data-tour="ing-row" className="om-row" onClick={() => select(g)} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 72px 40px 66px", gap: 14, alignItems: "center", padding: "13px 20px", borderBottom: "1px solid var(--line-soft)", cursor: "pointer", background: active ? "var(--accent-tint)" : "transparent", borderLeft: `2px solid ${active ? "var(--accent)" : "transparent"}` }}>
                    <div style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{g.name}</span>
                      {g.estimated && (
                        <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--amber)", border: "1px solid var(--amber)", borderRadius: 10, padding: "1px 5px", flexShrink: 0 }}>Est</span>
                      )}
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums", textAlign: "right", whiteSpace: "nowrap", color: g.estimated ? "var(--amber)" : "var(--text)" }}>{money2(g.price)}</div>
                    <div style={{ fontFamily: MONO, fontSize: 11.5, color: "var(--faint)", whiteSpace: "nowrap" }}>/{g.unit}</div>
                    <div style={{ fontFamily: MONO, fontSize: 12, fontWeight: 500, textAlign: "right", whiteSpace: "nowrap", color: pctColor(g.pct) }}>{pctLabel(g.pct)}</div>
                  </div>
                );
              })}
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 20px", borderTop: "1px solid var(--line)", flexShrink: 0, fontFamily: MONO, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--faint)" }}>
              <span>{countLabel}</span>
              <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ color: "var(--red)" }}>{monthMoved} of {all.length} up</span>
                <span>{priced.length} priced from invoices · {all.length - priced.length} estimated</span>
              </span>
            </div>
          </div>

          <div data-tour="ing-detail" style={{ minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column", background: "var(--shell)", border: "1px solid var(--line)", borderRadius: 12, boxShadow: "var(--card-lift)", animation: "om-rise .4s cubic-bezier(.25,.8,.35,1) both" }}>
            {selected ? (
              <Detail
                g={selected}
                onBack={clear}
                menuOpen={menuOpen}
                setMenuOpen={(v) => { setMenuOpen(v); setInvoicesOpen(false); }}
                invoicesOpen={invoicesOpen}
                setInvoicesOpen={(v) => { setInvoicesOpen(v); setMenuOpen(false); }}
                onOpenMenuItem={onOpenMenuItem}
                onOpenInvoice={onOpenInvoice}
              />
            ) : (
              <Summary
                all={all}
                risers={risers}
                fallers={fallers}
                unpriced={unpriced}
                override={summaryProp}
                onPick={(g) => { setFilter("All"); select(g); }}
                onNeedsPrice={() => { setFilter("Needs price"); clear(); }}
              />
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
    { label: "Basket drift", value: (basketDrift >= 0 ? "+" : "−") + Math.abs(basketDrift).toFixed(1) + "%", color: basketDrift > 1.5 ? "var(--red)" : "var(--text)", note: "average across the list" },
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
              {unpriced.length === 1 ? `${unpriced[0].name} is still priced by hand` : `${unpriced.length} ingredients are still priced by hand`}
            </span>
            <button type="button" onClick={onNeedsPrice} style={{ background: "none", border: "none", cursor: "pointer", fontFamily: MONO, fontSize: 10.5, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--amber)", whiteSpace: "nowrap" }}>Review ›</button>
          </div>
        )}
      </div>
    </>
  );
}

/* ── right pane: one ingredient ─────────────────────────────────────── */

function Detail({ g, onBack, menuOpen, setMenuOpen, invoicesOpen, setInvoicesOpen, onOpenMenuItem, onOpenInvoice }) {
  const h = g.history;
  const hasHistory = h.length > 1;
  const chart = useMemo(() => buildChart(h), [h]);

  const menuTotal = g.menuItems.length;
  const menuVisible = Math.min(3, menuTotal);
  const card = (m) => {
    const margin = m.price ? ((m.price - m.cost) / m.price) * 100 : 0;
    return {
      ...m,
      contribution: money2(g.price * (parseFloat(m.qty) || 0)),
      marginLabel: margin.toFixed(0) + "%",
      marginColor: margin < 60 ? "var(--amber)" : "var(--muted)",
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
            {g.estimated ? "Entered by hand · no invoice yet" : `${g.supplier || "—"} · last ${g.lastOrdered || "—"}`}
          </div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-0.045em", fontVariantNumeric: "tabular-nums", lineHeight: 1, color: g.estimated ? "var(--amber)" : "var(--text)" }}>{money2(g.price)}</div>
          <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--accent-deep)", marginTop: 7 }}>per {g.unit}</div>
        </div>
      </div>

      {!hasHistory && (
        <div style={{ padding: "28px 22px", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 9 }}>
          <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--amber)" }}>Estimated price</div>
          <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-0.02em" }}>{g.name} hasn’t come through on an invoice yet</div>
          <div style={{ fontSize: 13.5, lineHeight: 1.55, color: "var(--muted)", maxWidth: 320, textWrap: "pretty" }}>
            The price you see was entered by hand, so menu costs using it are approximate. It will firm up the first time we read it off a delivery.
          </div>
        </div>
      )}

      {hasHistory && !menuOpen && !invoicesOpen && (
        <div style={{ display: "flex", alignItems: "stretch", flexWrap: "wrap", borderBottom: "1px solid var(--line)", flexShrink: 0 }}>
          <div style={{ flex: "1 1 150px", minWidth: 0, padding: "16px 18px 10px", display: "flex", flexDirection: "column" }}>
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

          <div style={{ flex: "0 0 236px", minWidth: 0, padding: "16px 18px 18px", borderLeft: "1px solid var(--line)" }}>
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

      {hasHistory && menuOpen && (
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

      {hasHistory && !menuOpen && (
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