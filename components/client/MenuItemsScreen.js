import React, { useEffect, useMemo, useRef, useState } from "react";
import MenuCosting, { marginColor, MobileMenuCosting } from "./MenuCosting";
import {
  Shell, Header, MobileHeader, MobileNav, MobileTitle, MobileChips, MobileSegmented, MobileBackBar, mCard, LoadingState, EmptyState, ErrorState, StatePage,
  useTheme, useIsMobile, MONO, SANS, PAGE_PAD, SearchIcon, money,
} from "./ClientChrome";

/**
 * MenuItemsScreen — ported from "OptiMenu Menu Items.dc.html".
 *
 * Left: the dish list as cards or a table, with All / Below-target / Slipping
 * filters. Right: the menu summary until a dish is picked, then that dish —
 * six-month margin trend against the target line, a price check with a reprice
 * suggestion, and the plate-cost breakdown by component and ingredient.
 *
 * Props
 *   items [Dish] – see DEMO_ITEMS:
 *     { id, name, category, price, cost, costThen, covers,
 *       history: [{ label, value }]        // margin %, oldest → newest
 *       components: [{ name, ingredients: [
 *         { name, qty, unit, unitPrice, cost, costThen, estimated }] }] }
 *   targetMargin  number  – 0–100, default 68
 *   loading, error, onRetry
 *   onOpenItem (dish) => void      – detail route
 *   onAddItem  () => void          – empty-state CTA
 *   restaurantName, user, theme/defaultTheme/onThemeChange, NavLink
 */

const money2 = (n) => money(n, 2);
const money0 = (n) => money(n, 0);
const pct = (n) => (Number(n) || 0).toFixed(0) + "%";
const ppLabel = (p) => (p >= 0 ? "+" : "−") + Math.abs(p).toFixed(1) + "pp";
const ppColor = (p) => (p < -2 ? "var(--red)" : p > 2 ? "var(--green)" : "var(--faint)");
const moveLabel = (m) => (m >= 0 ? "+" : "−") + money2(Math.abs(m)).slice(1);
// Cost rises are amber (watch), drops green (a gain).
const moveColor = (m) => (m > 0.01 ? "var(--amber)" : m < -0.01 ? "var(--green)" : "var(--faint)");
// Plate cost change over the last 30 days, e.g. "▲ $0.42".
const move30Label = (m) => (Math.abs(m || 0) > 0.005 ? (m > 0 ? "▲ " : "▼ ") + money2(Math.abs(m)) : "");

const fmtQty = (n) => {
  const v = Number(n);
  if (!isFinite(v)) return String(n ?? "");
  if (v === 0) return "0";
  const a = Math.abs(v);
  const dp = a >= 10 ? 1 : a >= 1 ? 2 : 3;
  return parseFloat(v.toFixed(dp)).toString();
};

const COLUMNS = [
  { label: "Dish", align: "left" },
  { label: "Menu", align: "right" },
  { label: "Cost", align: "right" },
  { label: "Margin", align: "right" },
];

const LIST_GRID = "minmax(0,1fr) 62px 62px 62px";

export const DEMO_ITEMS = [
  {
    id: 1, name: "Duck, sour cherry, hazelnut", category: "Secondi", price: 42, covers: 61,
    history: [["MAR", 55.6], ["APR", 54.4], ["MAY", 54.5], ["JUN", 51.8], ["JUL", 50.5], ["AUG", 48.4]].map(([label, value]) => ({ label, value })),
    components: [
      { name: "Protein", ingredients: [
        { name: "Duck breast, magret", qty: "1 ea", unit: "ea", unitPrice: 18.4, cost: 18.4, costThen: 15.8 },
        { name: "Butter, cultured 82%", qty: "0.02 kg", unit: "kg", unitPrice: 13.2, cost: 0.26, costThen: 0.2 },
      ] },
      { name: "Gastrique", ingredients: [
        { name: "Sour cherries, frozen", qty: "0.06 kg", unit: "kg", unitPrice: 9.8, cost: 0.59, costThen: 0.49 },
        { name: "Pepper, tellicherry", qty: "0.001 kg", unit: "kg", unitPrice: 28, cost: 0.03, costThen: 0.03, estimated: true },
      ] },
      { name: "Sauce", ingredients: [
        { name: "Heavy cream 36%", qty: "0.05 L", unit: "L", unitPrice: 4.15, cost: 0.21, costThen: 0.18 },
      ] },
      { name: "Crumb", ingredients: [
        { name: "Hazelnuts, blanched", qty: "0.03 kg", unit: "kg", unitPrice: 14.25, cost: 0.43, costThen: 0.38 },
      ] },
    ],
  },
  {
    id: 2, name: "Cacio e pepe", category: "Primi", price: 26, covers: 96,
    history: [["MAR", 84.2], ["APR", 83.8], ["MAY", 83.1], ["JUN", 82.6], ["JUL", 82.2], ["AUG", 81.8]].map(([label, value]) => ({ label, value })),
    components: [
      { name: "Pasta", ingredients: [
        { name: "Semolina 00", qty: "0.14 kg", unit: "kg", unitPrice: 2.4, cost: 0.34, costThen: 0.34, estimated: true },
        { name: "Egg, large", qty: "0.5 ea", unit: "ea", unitPrice: 0.42, cost: 0.21, costThen: 0.21, estimated: true },
      ] },
      { name: "Sauce", ingredients: [
        { name: "Pecorino romano", qty: "0.12 kg", unit: "kg", unitPrice: 21.75, cost: 2.61, costThen: 2.3 },
        { name: "Butter, cultured 82%", qty: "0.05 kg", unit: "kg", unitPrice: 13.2, cost: 0.66, costThen: 0.5 },
      ] },
    ],
  },
  {
    id: 3, name: "Whole branzino, salsa verde", category: "Secondi", price: 58, covers: 46,
    history: [["MAR", 56.1], ["APR", 53.6], ["MAY", 54.6], ["JUN", 52.3], ["JUL", 51.0], ["AUG", 50.3]].map(([label, value]) => ({ label, value })),
    components: [
      { name: "Fish", ingredients: [
        { name: "Branzino, whole", qty: "1 ea", unit: "ea", unitPrice: 27.8, cost: 27.8, costThen: 24.5 },
        { name: "Butter, cultured 82%", qty: "0.05 kg", unit: "kg", unitPrice: 13.2, cost: 0.66, costThen: 0.5 },
      ] },
      { name: "Salsa verde", ingredients: [
        { name: "Olive oil, blend 5L", qty: "0.03 ea", unit: "ea", unitPrice: 46, cost: 1.38, costThen: 1.14 },
        { name: "Lemons, case", qty: "0.02 cs", unit: "cs", unitPrice: 42, cost: 0.84, costThen: 0.72 },
      ] },
    ],
  },
];

function decorate(d) {
  const components = (d.components || []).map((c) => {
    const ings = c.ingredients || [];
    return {
      ...c,
      ingredients: ings,
      cost: ings.reduce((a, i) => a + (Number(i.cost) || 0), 0),
      costThen: ings.reduce((a, i) => a + (Number(i.costThen != null ? i.costThen : i.cost) || 0), 0),
      allEstimated: ings.length > 0 && ings.every((i) => i.estimated),
      /* no per-line history available -> the Δ column shows "—" */
      unknownMove: ings.length > 0 && ings.every((i) => i.costThen == null),
    };
  });
  const lines = components.reduce((a, c) => a + c.ingredients.length, 0);
  const cost = d.cost != null ? Number(d.cost) : components.reduce((a, c) => a + c.cost, 0);
  const costThen = d.costThen != null ? Number(d.costThen) : components.reduce((a, c) => a + c.costThen, 0);
  const price = Number(d.price) || 0;
  const margin = price ? ((price - cost) / price) * 100 : 0;
  const marginThen = price ? ((price - costThen) / price) * 100 : 0;
  const estIngs = components.flatMap((c) => c.ingredients).filter((i) => i.estimated);
  const estCost = estIngs.reduce((a, i) => a + (Number(i.cost) || 0), 0);
  return {
    ...d,
    components,
    lineCount: lines,
    cost,
    costThen,
    margin,
    marginThen,
    drift: margin - marginThen,
    covers: Number(d.covers) || 0,
    history: d.history || [],
    estCount: estIngs.length,
    estShare: cost ? estCost / cost : 0,
    unpricedCount: Number(d.unpricedCount) || 0,
    awaiting: (Number(d.unpricedCount) || 0) > 0,
  };
}

export default function MenuItemsScreen({
  items: itemsProp,
  targetMargin = 68,
  loading = false,
  error = null,
  onRetry,
  onOpenItem,
  openItemId = null,
  onSelectionChange,
  onAddItem,
  onUploadMenu,
  onSearch,
  onSignOut,
  periodLabel,
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
  const [layout, setLayout] = useState("cards");
  const [localSelectedId, setLocalSelectedId] = useState(null);
  const selectedId = onSelectionChange ? openItemId : localSelectedId;

  function setSelectedId(value) {
    const next = typeof value === "function" ? value(selectedId) : value;

    if (onSelectionChange) {
      onSelectionChange(next);
    } else {
      setLocalSelectedId(next);
    }
  }
  // Sandbox ("Try portions") for the open dish. Client-side only, never saved;
  // cleared whenever a different dish opens.
  const [sandbox, setSandbox] = useState(false);
  const [whatIf, setWhatIf] = useState({});
  useEffect(() => { setSandbox(false); setWhatIf({}); }, [selectedId]);
  const [mobileTab, setMobileTab] = useState("dishes"); // phones: "dishes" | "costing"

  const data = useMemo(() => (itemsProp || DEMO_ITEMS).map(decorate), [itemsProp]);

  // Guided tour on phones: show the view a step needs (see lib/useTour.js).
  // "detail" keeps whatever dish is open, or opens the first one.
  const firstIdRef = useRef(null);
  firstIdRef.current = data[0]?.id ?? null;
  useEffect(() => {
    const onView = (e) => {
      const v = e.detail?.view;

      if (v === "list") {
        setMobileTab("dishes");
        setFilter("All");
        setSelectedId(null);
      }

      if (v === "detail") {
        setFilter("All");
        setSelectedId((id) => id ?? firstIdRef.current);
      }
    };

    window.addEventListener("optimenu-tour-view", onView);
    return () => window.removeEventListener("optimenu-tour-view", onView);
  }, [onSelectionChange, selectedId]);
  const tgt = targetMargin;

  // Dishes awaiting pricing have no trustworthy cost — keep them out of
  // every count, filter, and average.
  const priced = data.filter((d) => !d.awaiting);
  const belowTarget = priced.filter((d) => d.margin < tgt);
  // Cost rising: plate cost went up over the last 30 days.
  const costRising = priced.filter((d) => (d.move30 || 0) > 0.005);
  const waitingList = data.filter((d) => d.awaiting);
  const estimated = priced.filter((d) => d.estShare > 0.15);

  const shown =
    filter === "Below target" ? belowTarget :
    filter === "Cost rising" ? costRising :
    filter === "Waiting" ? waitingList :
    filter === "Part-estimated" ? estimated : data;

  // Resolve URL selections against the full menu, including dishes outside
  // the current filter.
  const selected = selectedId == null
    ? null
    : data.find((d) => String(d.id) === String(selectedId)) || null;

  // Keep standalone uses working when no URL handler is supplied.
  useEffect(() => {
    if (onSelectionChange) return;
    setLocalSelectedId(openItemId);
  }, [openItemId, onSelectionChange]);

  const chrome = (
    <Header active="menu-items" NavLink={NavLink} user={user} restaurantName={restaurantName} theme={theme} onToggleTheme={toggleTheme} onSearch={onSearch} onSignOut={onSignOut} logoSrc={logoSrc} logoDarkSrc={logoDarkSrc} />
  );
  const page = (children) => (
    <StatePage
      theme={theme} isMobile={isMobile} active="menu-items" NavLink={NavLink} header={chrome}
      mobileHeader={<MobileHeader theme={theme} onToggleTheme={toggleTheme} onSearch={onSearch} onSignOut={onSignOut} restaurantName={restaurantName} NavLink={NavLink} user={user} logoSrc={logoSrc} logoDarkSrc={logoDarkSrc} />}
    >
      {children}
    </StatePage>
  );

  if (loading) return page(<LoadingState label="Costing your plates…" mobile={isMobile} />);
  if (error) return page(<ErrorState message={error} onRetry={onRetry} />);

  if (openItemId && !selected) {
    return page(
      <EmptyState
        kicker="Dish unavailable"
        title="We could not find that dish"
        body="It is not in your current menu. Return to the list to choose another."
      >
        <button
          type="button"
          onClick={() => setSelectedId(null)}
          style={{ border: "1px solid var(--line)", borderRadius: 22, padding: "10px 18px", minHeight: 44, background: "var(--shell)", color: "var(--text)", fontFamily: SANS, fontWeight: 700, cursor: "pointer" }}
        >
          Back to all dishes
        </button>
      </EmptyState>
    );
  }

  if (!data.length) {
    return page(
        <EmptyState
          kicker="No dishes yet"
          title="Upload your menu to get started"
          body="Snap a photo or upload a PDF of your menu. We'll build a recipe for every dish, and every invoice you upload after that keeps its cost current."
        >
          <button type="button" onClick={onAddItem} style={{ marginTop: 8, background: "var(--accent)", color: "#fff", border: "none", borderRadius: 24, padding: "12px 26px", fontFamily: SANS, fontSize: 14.5, fontWeight: 700, cursor: "pointer", boxShadow: "0 10px 24px rgba(2,164,186,0.28)" }}>Upload your menu</button>
        </EmptyState>
    );
  }

  const countLabel = `Showing ${shown.length} of ${data.length} dishes`;
  const avgMargin = priced.length ? priced.reduce((a, d) => a + d.margin, 0) / priced.length : 0;

  if (isMobile && selected) {
    const sd = selected;
    const canTry = !sd.awaiting && sd.price > 0;
    const backRight = !canTry ? null : sandbox ? (
      <button type="button" onClick={() => { setWhatIf({}); setSandbox(false); }} style={{ height: 34, padding: "0 14px", marginRight: 4, borderRadius: 17, background: "var(--accent)", border: "none", color: "#fff", fontFamily: SANS, fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>Done</button>
    ) : (
      <button type="button" onClick={() => setSandbox(true)} style={{ height: 34, display: "flex", alignItems: "center", gap: 6, padding: "0 12px", marginRight: 4, borderRadius: 17, background: "none", border: "1px solid var(--line)", color: "var(--muted)", fontFamily: SANS, fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 3h6" /><path d="M10 3v6L4.5 18.5A1.6 1.6 0 006 21h12a1.6 1.6 0 001.5-2.5L14 9V3" /><path d="M7 15h10" /></svg>
        Try
      </button>
    );

    return (
      <Shell theme={theme} style={{ position: "fixed", inset: 0, height: "auto", minHeight: 0, overflow: "hidden" }}>
        <MobileBackBar label="All dishes" onBack={() => setSelectedId(null)} title="Dish" right={backRight} />
        <div className="om-mscroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", padding: "16px 16px 28px", display: "flex", flexDirection: "column", gap: 14, background: "var(--panel)" }}>
          <DishDetail d={sd} tgt={tgt} onBack={() => setSelectedId(null)} stacked sandbox={sandbox} setSandbox={setSandbox} whatIf={whatIf} setWhatIf={setWhatIf} />
        </div>
        <MobileNav active="menu-items" NavLink={NavLink} />
      </Shell>
    );
  }

  if (isMobile) {
    const chipOpts = [
      { key: "All", label: `All · ${data.length}` },
      { key: "Below target", label: `Below target · ${belowTarget.length}` },
      { key: "Cost rising", label: `Cost rising · ${costRising.length}` },
      { key: "Waiting", label: `Waiting · ${waitingList.length}` },
    ];
    const kpiVal = { fontSize: 21, fontWeight: 800, letterSpacing: "-0.035em", fontVariantNumeric: "tabular-nums" };
    const kpiLbl = { fontFamily: MONO, fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--muted)", marginTop: 2, lineHeight: 1.35 };

    return (
      <Shell theme={theme} style={{ position: "fixed", inset: 0, height: "auto", minHeight: 0, overflow: "hidden" }}>
        <MobileHeader theme={theme} onToggleTheme={toggleTheme} onSearch={onSearch} onSignOut={onSignOut} restaurantName={restaurantName} NavLink={NavLink} user={user} logoSrc={logoSrc} logoDarkSrc={logoDarkSrc} />
        <div className="om-mscroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", padding: "18px 16px 28px", display: "flex", flexDirection: "column", gap: 14, background: "var(--panel)" }}>

          <MobileTitle kicker={`${restaurantName} · Menu engineering`} title="Menu items" sub="Costed from tonight’s prices" />

          <div style={{ ...mCard, display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))" }}>
            <div style={{ padding: 12 }}>
              <div style={{ ...kpiVal, color: priced.length && avgMargin < tgt ? marginColor(avgMargin, tgt) : "var(--text)" }}>{priced.length ? pct(avgMargin) : "—"}</div>
              <div style={kpiLbl}>Avg margin<br />target {pct(tgt)}</div>
            </div>
            <div style={{ padding: 12, borderLeft: "1px solid var(--line-soft)" }}>
              <div style={{ ...kpiVal, color: belowTarget.length ? "var(--amber)" : "var(--text)" }}>{belowTarget.length}</div>
              <div style={kpiLbl}>Below<br />target</div>
            </div>
            <div style={{ padding: 12, borderLeft: "1px solid var(--line-soft)" }}>
              <div style={kpiVal}>{priced.length} / {data.length}</div>
              <div style={kpiLbl}>Dishes<br />costed</div>
            </div>
          </div>

          <MobileSegmented
            options={[{ key: "dishes", label: "Dishes" }, { key: "costing", label: "Is each price right?" }]}
            value={mobileTab}
            onChange={setMobileTab}
          />

          {mobileTab === "dishes" ? (
            <>
              <MobileChips options={chipOpts} value={filter} onChange={(k) => { setFilter(k); setSelectedId(null); }} />
              <div data-tour="mi-grid-wrap" style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 10 }}>
                {shown.map((d) => {
                  const total = Math.max(1, d.lineCount);
                  const pips = Math.min(10, total);
                  const filled = Math.round(((total - d.unpricedCount) / total) * pips);
                  return (
                    <button key={d.id} type="button" data-tour="mi-card" onClick={() => setSelectedId(d.id)} style={{ height: 138, minWidth: 0, background: "var(--shell)", border: "1px solid var(--line)", borderRadius: 12, padding: "11px 12px", display: "flex", flexDirection: "column", justifyContent: "space-between", textAlign: "left", cursor: "pointer", fontFamily: SANS, color: "var(--text)", overflow: "hidden" }}>
                      <span style={{ display: "block", width: "100%", minWidth: 0 }}>
                        <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                          <span style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{d.category}</span>
                          {!d.awaiting && d.estShare > 0.15 && (
                            <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--amber)", border: "1px solid var(--amber)", borderRadius: 9, padding: "0 4px", flexShrink: 0 }}>Est</span>
                          )}
                        </span>
                        <span style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", fontSize: 14, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.22, marginTop: 5 }}>{d.name}</span>
                      </span>
                      <span style={{ display: "flex", flexDirection: "column", gap: 4, width: "100%" }}>
                        <span style={{ fontFamily: MONO, fontSize: 10, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {d.awaiting ? `${money2(d.price)} menu` : `${money2(d.price)} menu · ${money2(d.cost)} cost`}
                        </span>
                        {d.awaiting ? (
                          <>
                            <span style={{ display: "flex", gap: 2 }}>
                              {Array.from({ length: pips }).map((_, k) => (
                                <span key={k} style={{ flex: 1, height: 4, borderRadius: 1, background: k < filled ? "var(--accent)" : "var(--line)" }} />
                              ))}
                            </span>
                            <span style={{ fontFamily: MONO, fontSize: 9.5, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{d.unpricedCount} of {d.lineCount} ingredients unpriced</span>
                          </>
                        ) : (
                          <span style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
                            <span style={{ fontSize: 19, fontWeight: 800, letterSpacing: "-0.035em", fontVariantNumeric: "tabular-nums", color: marginColor(d.margin, tgt) }}>{pct(d.margin)}</span>
                            <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--muted)" }}>mgn</span>
                            <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: 10.5, whiteSpace: "nowrap", color: moveColor(d.move30) }}>{move30Label(d.move30)}</span>
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
              {shown.length === 0 && (
                <div style={{ padding: "18px 4px", textAlign: "center", fontSize: 13, color: "var(--muted)" }}>Nothing in this filter.</div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "0 2px", fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--muted)" }}>
                <span>{countLabel}</span>
                <span>{priced.length} costed · {waitingList.length} waiting</span>
              </div>
            </>
          ) : (
            <MobileMenuCosting dishes={data} tgt={tgt} NavLink={NavLink} onPick={(d) => { setFilter("All"); setSelectedId(d.id); }} />
          )}
        </div>
        <MobileNav active="menu-items" NavLink={NavLink} />
      </Shell>
    );
  }

  return (
    <Shell theme={theme} style={{ height: "100vh", overflow: "hidden" }}>
      {chrome}
      <div style={{ padding: `16px ${PAGE_PAD} 20px`, display: "flex", flexDirection: "column", gap: 14, background: "var(--panel)", flex: 1, minHeight: 0, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 20, flexWrap: "wrap", flexShrink: 0 }}>
          <div>
            <div style={{ fontFamily: MONO, fontSize: 11.5, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--faint)", marginBottom: 5 }}>{restaurantName} · Menu engineering</div>
            <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-0.035em", lineHeight: 1.1 }}>
              Menu items <span style={{ color: "var(--faint)" }}>· costed from tonight’s prices</span>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button type="button" onClick={onSearch} className="om-hover-accent" style={{ display: "flex", alignItems: "center", gap: 7, background: "var(--shell)", border: "1px solid var(--line)", borderRadius: 20, padding: "7px 12px", cursor: "pointer" }}>
              <SearchIcon size={13} />
              <span style={{ fontSize: 12.5, color: "var(--faint)" }}>Search dishes</span>
            </button>
            <div style={{ display: "flex", alignItems: "center", gap: 2, background: "var(--shell)", border: "1px solid var(--line)", borderRadius: 20, padding: 3 }}>
              {["All", "Below target", "Cost rising", "Waiting"].map((f) => (
                <button key={f} type="button" onClick={() => { setFilter(f); setSelectedId(null); }}
                  style={{ border: "none", cursor: "pointer", fontFamily: SANS, fontSize: 12.5, fontWeight: 600, borderRadius: 16, padding: "6px 12px", whiteSpace: "nowrap", background: filter === f ? "var(--accent)" : "transparent", color: filter === f ? "#fff" : "var(--muted)" }}>
                  {f === "Below target" ? `Below target · ${belowTarget.length}` : f === "Cost rising" ? `Cost rising · ${costRising.length}` : f === "Waiting" ? `Waiting · ${waitingList.length}` : f}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 2, background: "var(--shell)", border: "1px solid var(--line)", borderRadius: 20, padding: 3 }}>
              {[["cards", "Cards"], ["list", "List"]].map(([k, label]) => (
                <button key={k} type="button" onClick={() => setLayout(k)}
                  style={{ border: "none", cursor: "pointer", fontFamily: MONO, fontSize: 10.5, letterSpacing: "0.12em", textTransform: "uppercase", borderRadius: 16, padding: "7px 11px", whiteSpace: "nowrap", background: layout === k ? "var(--accent-tint)" : "transparent", color: layout === k ? "var(--accent-deep)" : "var(--faint)" }}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

                {/* Dish cards: 3 columns, 4 on wide screens. The menu takes the other half. */}
                <style>{`.mi-cards{grid-template-columns:repeat(3,minmax(0,1fr))}@media (min-width:1500px){.mi-cards{grid-template-columns:repeat(4,minmax(0,1fr))}}`}</style>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, flex: 1, minHeight: 0 }}>
          <div data-tour="mi-grid-wrap" style={{ background: "var(--shell)", border: "1px solid var(--line)", borderRadius: 12, boxShadow: "var(--card-lift)", display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
            {layout === "cards" ? (
              <div className="mi-cards" style={{ flex: 1, minHeight: 0, overflowY: "auto", margin: "8px 6px 0 0", padding: "6px 10px 14px 16px", display: "grid", gap: 14, alignContent: "start", scrollbarGutter: "stable" }}>
                {shown.map((d) => {
                  const active = selected && d.id === selected.id;
                  return (
                    <div key={d.id} data-tour="mi-card" onClick={() => setSelectedId(d.id)} onDoubleClick={() => onOpenItem && onOpenItem(d)} className="om-hover-accent"
                      style={{ height: 150, background: active ? "var(--accent-tint)" : "var(--panel)", border: `1px solid ${active ? "var(--accent)" : "var(--line-soft)"}`, borderRadius: 10, padding: "11px 12px", display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 8, cursor: "pointer", overflow: "hidden" }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                          <span style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--faint)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{d.category}</span>
                          {!d.awaiting && d.estShare > 0.15 && (
                            <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--amber)", border: "1px solid var(--amber)", borderRadius: 9, padding: "0 4px", flexShrink: 0 }}>Est</span>
                          )}
                        </div>
                        {/* One line; a long name ends in "…" so every card lines up. */}
                        <div title={d.name} style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.25, marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{d.name}</div>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                        <div style={{ fontFamily: MONO, fontSize: 10, color: "var(--faint)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{d.awaiting ? `${money2(d.price)} menu` : `${money2(d.price)} menu · ${money2(d.cost)} cost`}</div>
                        {d.awaiting ? (
                          <>
                            {/* One pip per ingredient (scaled to 10), filled once it has a price. */}
                            {(() => {
                              const total = Math.max(1, d.lineCount);
                              const n = Math.min(10, total);
                              const filled = Math.round(((total - d.unpricedCount) / total) * n);
                              return (
                                <div style={{ display: "flex", gap: 2 }}>
                                  {Array.from({ length: n }).map((_, k) => (
                                    <span key={k} style={{ flex: 1, height: 4, borderRadius: 1, background: k < filled ? "var(--accent)" : "var(--line)" }} />
                                  ))}
                                </div>
                              );
                            })()}
                            <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.06em", color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{d.unpricedCount} of {d.lineCount} ingredients unpriced</div>
                          </>
                        ) : (
                          <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
                            <span style={{ fontSize: 15, fontWeight: 800, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums", color: marginColor(d.margin, tgt) }}>{pct(d.margin)}</span>
                            <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--faint)" }}>mgn</span>
                            <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: 10, whiteSpace: "nowrap", color: moveColor(d.move30) }}>{move30Label(d.move30)}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <>
                <div style={{ display: "grid", gridTemplateColumns: LIST_GRID, gap: 12, padding: "12px 20px", borderBottom: "1px solid var(--line)", flexShrink: 0 }}>
                  {COLUMNS.map((c) => (
                    <span key={c.label} style={{ fontFamily: MONO, fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--faint)", textAlign: c.align }}>{c.label}</span>
                  ))}
                </div>
                <div style={{ flex: 1, minHeight: 0, overflowY: "auto", margin: "6px 6px 0 0", scrollbarGutter: "stable" }}>
                  {shown.map((d) => {
                    const active = selected && d.id === selected.id;
                    return (
                      <div key={d.id} className="om-row" onClick={() => setSelectedId(d.id)} onDoubleClick={() => onOpenItem && onOpenItem(d)}
                        style={{ display: "grid", gridTemplateColumns: LIST_GRID, gap: 12, alignItems: "center", padding: "12px 20px", borderBottom: "1px solid var(--line-soft)", cursor: "pointer", background: active ? "var(--accent-tint)" : "transparent", borderLeft: `2px solid ${active ? "var(--accent)" : "transparent"}` }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                            <span style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{d.name}</span>
                            {!d.awaiting && d.estShare > 0.15 && (
                              <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--amber)", border: "1px solid var(--amber)", borderRadius: 10, padding: "1px 5px", flexShrink: 0 }}>Est</span>
                            )}
                          </div>
                          <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--faint)", marginTop: 3 }}>{d.category}</div>
                        </div>
                        <div style={{ fontSize: 13.5, fontWeight: 600, fontVariantNumeric: "tabular-nums", textAlign: "right", whiteSpace: "nowrap", color: "var(--muted)" }}>{money0(d.price)}</div>
                        <div style={{ fontSize: 13.5, fontWeight: 600, fontVariantNumeric: "tabular-nums", textAlign: "right", whiteSpace: "nowrap", color: d.awaiting ? "var(--faint)" : "var(--text)" }}>{d.awaiting ? "—" : money2(d.cost)}</div>
                        <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                          {d.awaiting ? (
                            <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--faint)" }}>Pending</div>
                          ) : (
                            <>
                              <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums", color: marginColor(d.margin, tgt) }}>{pct(d.margin)}</div>
                              <div style={{ fontFamily: MONO, fontSize: 10.5, color: moveColor(d.move30), marginTop: 2 }}>{move30Label(d.move30)}</div>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 20px", borderTop: "1px solid var(--line)", flexShrink: 0, fontFamily: MONO, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--faint)" }}>
              <span>{countLabel}</span>
              <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span>{priced.length} costed</span>
                <span>{waitingList.length} waiting on prices</span>
              </span>
            </div>
          </div>

          <div data-tour="mi-detail" style={{ minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column", background: "var(--shell)", border: "1px solid var(--line)", borderRadius: 12, boxShadow: "var(--card-lift)", animation: "om-rise .4s cubic-bezier(.25,.8,.35,1) both" }}>
            {selected ? (
              <DishDetail
                key={selected.id}
                d={selected}
                tgt={tgt}
                onBack={() => setSelectedId(null)}
                sandbox={sandbox}
                setSandbox={setSandbox}
                whatIf={whatIf}
                setWhatIf={setWhatIf}
              />
            ) : (
              <MenuCosting
                dishes={data}
                tgt={tgt}
                NavLink={NavLink}
                onPick={(d) => { setFilter("All"); setSelectedId(d.id); }}
              />
            )}
          </div>
        </div>
      </div>
    </Shell>
  );
}

/* ── right pane: the whole menu ─────────────────────────────────────── */

function MenuSummary({ data, tgt, belowTarget, estimated, periodLabel, onPick, onEstimated, onUploadMenu }) {
  if (!data.length) {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", padding: "32px 28px", gap: 10 }}>
        <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-0.035em" }}>Your recipes are in</div>
        <div style={{ fontSize: 13.5, color: "var(--muted)", lineHeight: 1.6, maxWidth: 420 }}>
          Plate costs and margins appear here as soon as your ingredient prices come in from your invoices.
        </div>
      </div>
    );
  }
  const revenue = data.reduce((a, d) => a + d.price * d.covers, 0);
  const weighted = revenue ? (data.reduce((a, d) => a + (d.price - d.cost) * d.covers, 0) / revenue) * 100 : 0;
  const avgDrift = data.reduce((a, d) => a + d.drift, 0) / data.length;
  const slippers = data.slice().sort((a, b) => a.drift - b.drift).slice(0, 5);

  const stats = [
    { label: "Below target", value: String(belowTarget.length), color: "var(--text)", note: `of ${data.length} dishes` },
    { label: "Food cost", value: pct(100 - weighted), color: "var(--text)", note: "weighted by covers" },
    { label: "Menu drift", value: ppLabel(avgDrift), color: ppColor(avgDrift), note: "average across the menu" },
  ];

  return (
    <>
      <div style={{ flexShrink: 0, background: "var(--accent-tint)", borderBottom: "1px solid var(--line)", borderLeft: "3px solid var(--accent)", padding: "20px 22px 18px", display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.04em", lineHeight: 1.05 }}>The menu, at today’s costs</div>
          <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 7 }}>
            {periodLabel || `${data.length} dishes costed · target margin ${pct(tgt)}`}
          </div>
          {onUploadMenu && (
            <button
              type="button"
              onClick={onUploadMenu}
              style={{ marginTop: 12, display: "inline-flex", alignItems: "center", gap: 7, background: "var(--shell)", border: "1px solid var(--line)", borderRadius: 20, padding: "7px 14px", fontSize: 12.5, fontWeight: 700, color: "var(--accent-deep)", cursor: "pointer" }}
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
              Upload new menu
            </button>
          )}
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-0.045em", fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{pct(weighted)}</div>
          <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--accent-deep)", marginTop: 7 }}>Weighted margin</div>
        </div>
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
          <span style={{ fontFamily: MONO, fontSize: 11.5, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--muted)" }}>Where the margin went</span>
          <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: "0.06em", color: "var(--faint)" }}>Across the price history</span>
        </div>
        <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", marginTop: 10, borderTop: "1px dashed var(--line)" }}>
          {slippers.map((d) => (
            <div key={d.id} onClick={() => onPick(d)} style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, padding: "10px 2px", borderBottom: "1px dashed var(--line)", cursor: "pointer" }}>
              <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{d.name}</span>
              <span style={{ display: "flex", alignItems: "baseline", gap: 12, flexShrink: 0, fontFamily: MONO, fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
                <span style={{ display: "flex", alignItems: "baseline", gap: 5, color: "var(--faint)" }}>
                  <span style={{ minWidth: 42, textAlign: "right" }}>{pct(d.marginThen)}</span>
                  <span>→</span>
                  <span style={{ minWidth: 42, textAlign: "right" }}>{pct(d.margin)}</span>
                </span>
                <span style={{ fontWeight: 600, color: ppColor(d.drift), minWidth: 62, textAlign: "right" }}>{ppLabel(d.drift)}</span>
              </span>
            </div>
          ))}
        </div>
        {estimated.length > 0 && (
          <div style={{ flexShrink: 0, marginTop: 12, border: "1px dashed var(--amber)", borderRadius: 8, padding: "11px 13px", display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
            <span style={{ fontSize: 12.5, color: "var(--text)" }}>
              {estimated.length === 1 ? `${estimated[0].name} leans on hand-priced ingredients` : `${estimated.length} dishes lean on hand-priced ingredients`}
            </span>
            <button type="button" onClick={onEstimated} style={{ background: "none", border: "none", cursor: "pointer", fontFamily: MONO, fontSize: 10.5, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--amber)", whiteSpace: "nowrap" }}>Review ›</button>
          </div>
        )}
      </div>
    </>
  );
}

/* ── right pane: one dish ───────────────────────────────────────────── */

const pct1 = (n) => (Number(n) || 0).toFixed(1) + "%";
const SHADES = [100, 70, 48, 30];
const shade = (i) => `color-mix(in srgb, var(--accent) ${SHADES[Math.min(i, SHADES.length - 1)]}%, var(--shell))`;
const DD_CSS = `
.dd-pt .dd-tip{opacity:0;transition:opacity .12s;pointer-events:none}
.dd-pt:hover .dd-tip,.dd-pt.on .dd-tip{opacity:1}
.dd-qty:focus{outline:none;border-color:var(--accent)!important}
.dd-root{display:flex;flex-direction:column;overflow:hidden}
.dd-body{flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,1fr) 236px;grid-template-rows:minmax(0,1fr);gap:14px}
.dd-recipe{display:flex;flex-direction:column;min-height:0}
.dd-list{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;margin-right:-8px;padding-right:8px}
.dd-rail{min-height:0;overflow-y:auto;overflow-x:hidden;scrollbar-gutter:stable}
.dd-rail > *{flex-shrink:0;box-sizing:border-box}
.dd-rail > :first-child{min-height:130px}
.dd-rail > :nth-child(2){min-height:260px}
.dd-comp{cursor:pointer;user-select:none}
.dd-comp:hover .dd-cname{color:var(--accent-deep)}
@media (max-width:1279px){
  .dd-root{overflow-y:auto}
  .dd-body{flex:none;grid-template-columns:minmax(0,1fr);grid-template-rows:none}
  .dd-list{flex:none;overflow:visible;margin-right:0;padding-right:0}
  .dd-rail{overflow:visible}
}
`;

/*
 * DishDetail — one dish: price vs plate cost, the recipe by component, sales,
 * the margin trend and how to reach the target. Desktop renders it in the
 * right pane; phones render it stacked inside the screen's scroll area.
 *
 * Sandbox ("Try portions"): pure client-side what-if. Nothing here ever writes
 * to Supabase. whatIf holds ONLY the quantities a person has typed (as the raw
 * strings they typed, so "0.0" stays editable); every real dish number stays
 * exactly as loaded. The parent owns sandbox/whatIf so the phone back bar can
 * hold the Try/Done button, and clears both whenever a different dish opens.
 */
function DishDetail({ d, tgt, onBack, stacked = false, sandbox = false, setSandbox, whatIf = {}, setWhatIf }) {
  // Components start expanded; click a component to fold it down to its
  // subtotal, or use Collapse all / Expand all. Resets for each dish.
  const [folded, setFolded] = useState({});
  useEffect(() => { setFolded({}); }, [d.id]);
  const anyOpen = d.components.some((c, ci) => !folded[ci]);
  const toggleAll = () => {
    const next = {};
    d.components.forEach((c, ci) => { next[ci] = anyOpen; });
    setFolded(next);
  };
  const price = Number(d.price) || 0;
  const ingKey = (ci, ii) => `${ci}-${ii}`;
  // Price per RECIPE unit, derived from the line cost toDish() already
  // unit-converted (oz↔lb etc.). Multiplying qty × ing.unitPrice directly
  // skipped that conversion and under-costed mixed-unit lines.
  const recipeUnitPrice = (ing) => {
    const q = Number(ing.quantity);
    return q ? (Number(ing.cost) || 0) / q : (Number(ing.unitPrice) || 0);
  };
  const typedQty = (ci, ii) => {
    const k = ingKey(ci, ii);
    if (!(k in whatIf)) return null;
    const v = parseFloat(whatIf[k]);
    return isFinite(v) && v >= 0 ? v : 0;
  };
  const isChanged = (ci, ii, ing) => {
    const v = typedQty(ci, ii);
    return v != null && Math.abs(v - (Number(ing.quantity) || 0)) > 1e-9;
  };
  const lineCost = (ci, ii, ing, useSandbox) =>
    useSandbox && isChanged(ci, ii, ing) ? typedQty(ci, ii) * recipeUnitPrice(ing) : Number(ing.cost) || 0;
  const compCost = (ci, c, useSandbox) => c.ingredients.reduce((a, ing, ii) => a + lineCost(ci, ii, ing, useSandbox), 0);

  const changes = d.components.reduce((n, c, ci) => n + c.ingredients.filter((ing, ii) => isChanged(ci, ii, ing)).length, 0);
  const realSum = d.components.reduce((a, c, ci) => a + compCost(ci, c, false), 0);
  const sbSum = d.components.reduce((a, c, ci) => a + compCost(ci, c, true), 0);
  const realCost = Number(d.cost) || 0;
  const sbCost = Math.max(0, realCost + (sbSum - realSum));
  const live = sandbox && changes > 0; // sandbox numbers differ from the real ones
  const cost = live ? sbCost : realCost;
  const marginOf = (c) => (price ? ((price - c) / price) * 100 : 0);
  const realMargin = marginOf(realCost);
  const margin = marginOf(cost);
  const keep = price - cost;
  const delta = sbCost - realCost; // negative = the sandbox saves money

  const awaiting = d.awaiting;
  const under = !awaiting && price > 0 && realMargin < tgt;
  const allLines = d.components.flatMap((c) => c.ingredients);
  const invoicePriced = allLines.filter((i) => !i.unpriced && !i.estimated).length;
  const covers = Number(d.covers) || 0;

  // Reach the target: price rounded up to the next .95 (same rule as Menu costing).
  const tp = realCost / (1 - tgt / 100);
  let reprice = Math.ceil(tp) - 0.05;
  if (reprice < tp) reprice += 1;
  const trimTo = price * (1 - tgt / 100);
  const lever = allLines.filter((i) => !i.unpriced).sort((a, b) => (Number(b.cost) || 0) - (Number(a.cost) || 0))[0];

  const exitSandbox = () => { setWhatIf && setWhatIf({}); setSandbox && setSandbox(false); };
  const resetSandbox = () => setWhatIf && setWhatIf({});

  const kick = { fontFamily: MONO, fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--faint)" };
  const box = { border: "1px solid var(--line)", borderRadius: 12 };
  const h3 = { fontSize: 13, fontWeight: 700, letterSpacing: "-0.02em" };
  const pill = { height: stacked ? 34 : 30, display: "flex", alignItems: "center", gap: 6, padding: "0 12px", borderRadius: 17, fontFamily: SANS, fontSize: 12, fontWeight: 700, whiteSpace: "nowrap", cursor: "pointer" };
  const tile = { background: "var(--shell)", border: "1px solid var(--line)", borderRadius: 9, padding: "9px 10px", minWidth: 0 };
  const tileLbl = { fontSize: 11.5, color: "var(--muted)" };
  const tileVal = { fontSize: 17, fontWeight: 800, letterSpacing: "-0.03em", marginTop: 2, fontVariantNumeric: "tabular-nums" };
  const tileNote = { fontFamily: MONO, fontSize: 9.5, color: "var(--faint)", marginTop: 2 };

  /* ── status chip ── */
  const chip = (() => {
    const base = { display: "inline-flex", alignItems: "center", gap: 7, padding: "4px 10px", borderRadius: 20, fontFamily: MONO, fontSize: stacked ? 9.5 : 10, letterSpacing: "0.08em", fontWeight: 500, whiteSpace: "nowrap", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis" };
    const dot = (c) => <span style={{ width: 6, height: 6, borderRadius: "50%", background: c, flexShrink: 0 }} />;
    if (awaiting) return <span style={{ ...base, background: "var(--panel)", color: "var(--muted)" }}>{dot("var(--faint)")}AWAITING PRICES · {d.unpricedCount} OF {d.lineCount} UNPRICED</span>;
    if (live) {
      const hit = margin >= tgt;
      return (
        <span style={{ ...base, background: "var(--accent-tint)", color: "var(--accent-deep)" }}>
          {dot("var(--accent)")}{hit ? `HITS ${stacked ? "" : "YOUR "}${Math.round(tgt)}% TARGET` : `${(tgt - margin).toFixed(1)} PTS UNDER ${Math.round(tgt)}%`}
          <span style={{ opacity: 0.7 }}>· NOW {pct1(realMargin)}</span>
        </span>
      );
    }
    if (under) return <span style={{ ...base, background: "var(--panel)", color: "var(--muted)" }}>{dot("var(--text)")}{(tgt - realMargin).toFixed(1)} PTS UNDER {stacked ? "" : "YOUR "}{Math.round(tgt)}% TARGET</span>;
    return <span style={{ ...base, background: "var(--accent-tint)", color: "var(--accent-deep)" }}>{dot("var(--accent)")}{pct1(realMargin)} · {(realMargin - tgt).toFixed(1)} PTS OVER TARGET</span>;
  })();

  /* ── where every dollar goes: plate cost vs what the dish keeps ── */
  const dollarBar = (() => {
    if (awaiting || !price) return null;
    const clamp = (v) => Math.max(0, Math.min(100, v));
    const solidW = clamp((Math.min(realCost, cost) / price) * 100);
    const hatchW = live ? clamp((Math.abs(delta) / price) * 100) : 0;
    const costW = clamp((cost / price) * 100);
    const edge = clamp((Math.max(realCost, cost) / price) * 100); // where the tint starts
    const targetLeft = 100 - tgt;
    const lbl = { position: "absolute", top: 0, bottom: 0, display: "flex", alignItems: "center", fontFamily: MONO, fontSize: stacked ? 10 : 10.5, fontWeight: 500, whiteSpace: "nowrap" };
    const keepTxt = `KEEPS ${money2(keep)} · ${pct1(margin)}${live ? ` · ${delta <= 0 ? "+" : "−"}${money2(Math.abs(delta))}` : ""}`;
    const plateInside = costW >= 24;
    return (
      <div style={{ padding: stacked ? "16px 0 0" : "16px 18px 0" }}>
        <div style={{ position: "relative", height: 30 }}>
          <div style={{ position: "absolute", inset: 0, display: "flex", borderRadius: 7, overflow: "hidden", background: "var(--accent-tint)" }}>
            <span style={{ width: solidW + "%", background: "var(--text)", opacity: 0.86 }} />
            {hatchW > 0 && (
              <span style={{ width: hatchW + "%", opacity: 0.6, background: `repeating-linear-gradient(135deg, ${delta < 0 ? "var(--accent)" : "var(--text)"} 0 2px, transparent 2px 5px)` }} />
            )}
          </div>
          {plateInside && <div style={{ ...lbl, left: 0, width: solidW + "%", paddingLeft: 10, color: "var(--shell)", overflow: "hidden" }}>PLATE {money2(cost)}</div>}
          {edge > 62 ? (
            <div style={{ ...lbl, right: 10, color: "var(--accent-deep)" }}>{plateInside ? keepTxt : `PLATE ${money2(cost)} · ${keepTxt}`}</div>
          ) : (
            <div style={{ ...lbl, left: edge + "%", paddingLeft: 10, color: "var(--accent-deep)" }}>{plateInside ? keepTxt : `PLATE ${money2(cost)} · ${keepTxt}`}</div>
          )}
          <div style={{ position: "absolute", left: targetLeft + "%", top: -5, bottom: -5, width: 0, borderLeft: "2px dashed var(--text)" }} />
        </div>
        <div style={{ position: "relative", height: 16, marginTop: 5 }}>
          <span style={{ position: "absolute", left: targetLeft + "%", transform: "translateX(-50%)", fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.08em", color: "var(--faint)", whiteSpace: "nowrap" }}>
            TARGET · {Math.round(100 - tgt)}% FOOD COST
          </span>
        </div>
      </div>
    );
  })();

  /* ── recipe ── */
  const recipe = (
    <div className={stacked ? undefined : "dd-recipe"} style={{ ...box, padding: "12px 14px", minWidth: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, paddingBottom: 10, marginBottom: 12, borderBottom: "1px solid var(--line-soft)", flexShrink: 0 }}>
        <span style={h3}>Recipe · one plate</span>
        <button type="button" onClick={toggleAll} style={{ minHeight: stacked ? 34 : 24, background: "none", border: "none", padding: "0 2px", cursor: "pointer", fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.1em", color: "var(--accent-deep)", whiteSpace: "nowrap" }}>
          {anyOpen ? "COLLAPSE ALL" : "EXPAND ALL"}
        </button>
      </div>
      <div className={stacked ? undefined : "dd-list"}>
      {d.components.map((c, ci) => {
        const sub = compCost(ci, c, sandbox);
        const sub0 = compCost(ci, c, false);
        const tot = sandbox ? sbCost : realCost;
        const share = tot ? (sub / tot) * 100 : 0;
        const anyUnpriced = c.ingredients.some((i) => i.unpriced);
        const col = shade(ci);
        const isFolded = !!folded[ci];
        const changedHere = sandbox ? c.ingredients.filter((ing, ii) => isChanged(ci, ii, ing)).length : 0;
        return (
          <div key={c.name + ci} style={{ paddingTop: ci === 0 ? 0 : isFolded ? 12 : sandbox ? 14 : 18 }}>
            <div className="dd-comp" role="button" tabIndex={0} aria-expanded={!isFolded}
              onClick={() => setFolded((f) => ({ ...f, [ci]: !isFolded }))}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setFolded((f) => ({ ...f, [ci]: !isFolded })); } }}
              style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, minHeight: stacked ? 28 : 0 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, fontSize: 13.5, fontWeight: 800, letterSpacing: "-0.01em" }}>
                <span style={{ width: 10, flexShrink: 0, fontSize: 11, lineHeight: 1, color: "var(--faint)" }}>{isFolded ? "▸" : "▾"}</span>
                <span style={{ width: 9, height: 9, borderRadius: 2, background: col, flexShrink: 0 }} />
                <span className="dd-cname" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</span>
                {isFolded && (
                  <span style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: 400, letterSpacing: "0.06em", color: changedHere ? "var(--accent-deep)" : "var(--faint)", whiteSpace: "nowrap" }}>
                    {c.ingredients.length} ING{changedHere ? ` · ${changedHere} CHANGED` : ""}
                  </span>
                )}
              </span>
              <span style={{ fontSize: 13, fontWeight: 700, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                {sandbox && Math.abs(sub - sub0) > 0.005 && (
                  <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 400, color: "var(--faint)", textDecoration: "line-through", marginRight: 5 }}>{money2(sub0)}</span>
                )}
                {anyUnpriced ? "—" : money2(sub)}{" "}
                {!awaiting && <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 400, color: "var(--faint)" }}>{share.toFixed(0)}%</span>}
              </span>
            </div>
            <div style={{ height: 3, borderRadius: 2, background: "var(--line-soft)", margin: "7px 0 4px", overflow: "hidden" }}>
              {!awaiting && <div style={{ width: Math.min(100, share) + "%", height: "100%", background: col }} />}
            </div>
            {!isFolded && c.ingredients.map((i, ii) => {
              const tag = (txt, color = "var(--faint)", border = "var(--line)") => (
                <span style={{ fontFamily: MONO, fontSize: 9, color, border: `1px solid ${border}`, borderRadius: 3, padding: "0 4px", marginLeft: 5, whiteSpace: "nowrap" }}>{txt}</span>
              );
              const tags = (
                <>
                  {i.unpriced && tag("NO PRICE")}
                  {i.estimated && !i.unpriced && tag("EST")}
                  {i.unitMismatch && tag("CHECK UNIT", "var(--red)", "var(--red)")}
                </>
              );
              const changed = sandbox && isChanged(ci, ii, i);
              const cst = lineCost(ci, ii, i, sandbox);
              if (!sandbox) {
                return (
                  <div key={ii} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "5px 0", fontSize: 13 }}>
                    <span style={{ minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {i.name}{tags} <span style={{ color: "var(--faint)", fontSize: 11.5 }}>· {i.qty || `${fmtQty(i.quantity)} ${i.unit || ""}`}</span>
                    </span>
                    <span style={{ fontFamily: MONO, fontSize: 11.5, color: i.unpriced ? "var(--faint)" : "var(--muted)", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{i.unpriced ? "—" : money2(cst)}</span>
                  </div>
                );
              }
              const k = ingKey(ci, ii);
              const shown = k in whatIf ? whatIf[k] : fmtQty(i.quantity);
              return (
                <div key={ii} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto 52px", alignItems: "center", gap: 8, padding: "2px 0", fontSize: 13 }}>
                  <span style={{ minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{i.name}{tags}</span>
                  <span style={{ display: "flex", alignItems: "center", gap: 5, fontFamily: MONO, fontSize: 10.5, color: "var(--faint)" }}>
                    <input
                      className="dd-qty"
                      type="text"
                      inputMode="decimal"
                      value={shown}
                      aria-label={`${i.name} quantity`}
                      title="Try a different portion. This never changes the real recipe."
                      onChange={(e) => {
                        const v = e.target.value.replace(/[^0-9.]/g, "");
                        setWhatIf && setWhatIf((prev) => ({ ...prev, [k]: v }));
                      }}
                      style={{
                        width: 58, height: stacked ? 30 : 23, padding: "0 7px", borderRadius: 5, textAlign: "right",
                        fontFamily: MONO, fontSize: stacked ? 16 : 11.5, // 16px on phones stops iOS zooming in
                        background: changed ? "var(--accent-tint)" : "transparent",
                        border: changed ? "1.5px solid var(--accent)" : "1px dashed var(--line)",
                        color: changed ? "var(--accent-deep)" : "var(--text)", fontWeight: changed ? 500 : 400,
                      }}
                    />
                    <span style={{ width: 34, whiteSpace: "nowrap", overflow: "hidden" }}>{i.unit || "ea"}</span>
                  </span>
                  <span style={{ textAlign: "right", fontFamily: MONO, fontSize: 11.5, fontVariantNumeric: "tabular-nums", color: changed ? "var(--accent-deep)" : i.unpriced ? "var(--faint)" : "var(--muted)", fontWeight: changed ? 500 : 400 }}>
                    {i.unpriced ? "—" : money2(cst)}
                  </span>
                </div>
              );
            })}
          </div>
        );
      })}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, paddingTop: 10, marginTop: 10, borderTop: "1px solid var(--line-soft)", flexShrink: 0 }}>
        <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontSize: 13.5, fontWeight: 800 }}>{sandbox ? "Plate cost · sandbox" : "Plate cost"}</span>
          <span style={{ fontFamily: MONO, fontSize: 9.5, color: "var(--faint)", whiteSpace: "nowrap" }}>{invoicePriced} OF {d.lineCount} INVOICE-PRICED</span>
        </span>
        <span style={{ fontSize: 15, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
          {live && <span style={{ fontFamily: MONO, fontSize: 10.5, fontWeight: 400, color: "var(--faint)", textDecoration: "line-through", marginRight: 8 }}>{money2(realCost)}</span>}
          {awaiting ? "Awaiting prices" : money2(sandbox ? sbCost : realCost)}
        </span>
      </div>
    </div>
  );

  /* ── sold and earned (POS, last 30 days) ── */
  const sales = (
    <div style={{ ...box, display: "grid", gridTemplateColumns: "1fr 1fr", overflow: "hidden" }}>
      <div style={{ padding: stacked ? "16px 14px" : "18px 14px" }}>
        <div style={{ ...kick, fontSize: 9.5 }}>Sold · 30D</div>
        <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.04em", marginTop: 9, fontVariantNumeric: "tabular-nums" }}>{covers.toLocaleString()}</div>
        <div style={{ fontFamily: MONO, fontSize: 10, color: "var(--faint)", marginTop: 3 }}>{covers ? "LAST 30 DAYS" : "NO SALES SYNCED"}</div>
      </div>
      <div style={{ padding: stacked ? "16px 14px" : "18px 14px", borderLeft: "1px solid var(--line-soft)" }}>
        <div style={{ ...kick, fontSize: 9.5 }}>Earned · 30D</div>
        <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.04em", marginTop: 9, fontVariantNumeric: "tabular-nums" }}>{awaiting || !covers ? "—" : money0(covers * (price - realCost))}</div>
        <div style={{ fontFamily: MONO, fontSize: 10, color: "var(--faint)", marginTop: 3, whiteSpace: "nowrap" }}>
          {awaiting ? "AWAITING PRICES" : live && covers ? (
            <span style={{ color: "var(--accent-deep)" }}>{delta <= 0 ? "+" : "−"}{money0(Math.abs(delta) * covers)} SANDBOX</span>
          ) : `${money2(price - realCost)} A PLATE`}
        </div>
      </div>
    </div>
  );

  /* ── margin trend ── */
  const hist = (d.history || []).slice(-6);
  const trendMove = hist.length > 1 ? hist[hist.length - 1].value - hist[0].value : 0;
  const trend = (
    <div style={{ ...box, padding: "12px 13px 10px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={h3}>Margin, {hist.length > 1 ? `${hist.length} months` : "trend"}</span>
        {hist.length > 1 && Math.abs(trendMove) >= 0.05 && (
          <span style={{ fontFamily: MONO, fontSize: 10, color: "var(--faint)" }}>{trendMove < 0 ? "▼" : "▲"} {Math.abs(trendMove).toFixed(1)} PTS</span>
        )}
      </div>
      {hist.length > 1 ? (
        <div style={{ marginTop: 12 }}>
          <MarginTrend history={hist} tgt={tgt} whatIf={live ? margin : null} height={stacked ? 180 : 200} />
          {stacked && <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: "0.06em", color: "var(--faint)", textAlign: "center", marginTop: 10 }}>TAP A MONTH TO SEE ITS MARGIN</div>}
        </div>
      ) : (
        <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.5, marginTop: 8 }}>The trend appears once this dish has a second month of invoice prices.</div>
      )}
    </div>
  );

  /* ── reach your target / sandbox result ── */
  const panel = (() => {
    if (sandbox) {
      return (
        <div style={{ border: "1px solid var(--accent)", borderRadius: 12, padding: "12px 13px", background: "var(--accent-tint)" }}>
          <div style={{ ...h3, color: "var(--accent-deep)" }}>Sandbox result</div>
          {live ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 9 }}>
              <div style={tile}>
                <div style={tileLbl}>Plate cost</div>
                <div style={tileVal}>{money2(sbCost)}</div>
                <div style={tileNote}>{delta <= 0 ? "−" : "+"}{money2(Math.abs(delta))} A PLATE</div>
              </div>
              <div style={tile}>
                <div style={tileLbl}>Margin</div>
                <div style={tileVal}>{pct1(margin)}</div>
                <div style={tileNote}>{margin >= realMargin ? "+" : "−"}{Math.abs(margin - realMargin).toFixed(1)} PTS</div>
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.45, marginTop: 6 }}>Change any quantity in the recipe to see what it does to the plate cost and margin.</div>
          )}
          <div style={{ fontSize: 11.5, color: "var(--muted)", lineHeight: 1.45, marginTop: 9 }}>Only a test. Nothing here changes the real recipe.</div>
        </div>
      );
    }
    if (awaiting) {
      return (
        <div style={{ ...box, padding: "12px 13px", background: "var(--panel)" }}>
          <div style={h3}>Finish costing</div>
          <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.5, marginTop: 6 }}>
            {d.unpricedCount} ingredient{d.unpricedCount === 1 ? "" : "s"} still need an invoice price before this dish has a margin.
          </div>
        </div>
      );
    }
    if (!price) return null;
    const leverLine = lever && realCost > 0 && (
      <div style={{ fontSize: 11.5, color: "var(--muted)", lineHeight: 1.45, marginTop: 9 }}>
        Biggest lever: <strong style={{ color: "var(--text)" }}>{lever.name.toLowerCase()}</strong>, {Math.round(((Number(lever.cost) || 0) / realCost) * 100)}% of the plate.
      </div>
    );
    if (!under) {
      return (
        <div style={{ ...box, padding: "12px 13px", background: "var(--panel)" }}>
          <div style={h3}>On target</div>
          <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.5, marginTop: 6 }}>
            Plate cost can rise <strong style={{ color: "var(--text)" }}>{money2(Math.max(0, trimTo - realCost))}</strong> before this dish drops under {Math.round(tgt)}%.
          </div>
          {leverLine}
        </div>
      );
    }
    return (
      <div style={{ ...box, padding: "12px 13px", background: "var(--panel)" }}>
        <div style={h3}>Reach your target</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 9 }}>
          <div style={tile}>
            <div style={tileLbl}>Reprice to</div>
            <div style={tileVal}>{money2(reprice)}</div>
            <div style={tileNote}>+{money2(reprice - price)}</div>
          </div>
          <div style={tile}>
            <div style={tileLbl}>Or trim plate to</div>
            <div style={tileVal}>{money2(trimTo)}</div>
            <div style={tileNote}>−{money2(realCost - trimTo)} A PLATE</div>
          </div>
        </div>
        {leverLine}
      </div>
    );
  })();

  /* ── top bar (desktop) and sandbox actions ── */
  const flask = (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 3h6" /><path d="M10 3v6L4.5 18.5A1.6 1.6 0 006 21h12a1.6 1.6 0 001.5-2.5L14 9V3" /><path d="M7 15h10" /></svg>
  );
  const canTry = !awaiting && price > 0;
  const topBar = !stacked && (
    <div style={{ position: "sticky", top: 0, zIndex: 5, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "12px 18px", background: "var(--shell)", borderBottom: "1px solid var(--line-soft)" }}>
      <button type="button" onClick={onBack} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: MONO, fontSize: 10.5, letterSpacing: "0.12em", color: "var(--accent-deep)" }}>
        <span style={{ fontSize: 14, lineHeight: 1 }}>‹</span>ALL DISHES
      </button>
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        {sandbox ? (
          <>
            <span style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: MONO, fontSize: 10, letterSpacing: "0.1em", color: "var(--accent-deep)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent)", flexShrink: 0 }} />
              SANDBOX · {changes} CHANGE{changes === 1 ? "" : "S"} · NOTHING SAVES
            </span>
            <button type="button" onClick={resetSandbox} disabled={!changes} style={{ ...pill, background: "none", border: "1px solid var(--line)", color: "var(--muted)", opacity: changes ? 1 : 0.5 }}>Reset</button>
            <button type="button" onClick={exitSandbox} style={{ ...pill, background: "var(--accent)", border: "none", color: "#fff" }}>Done</button>
          </>
        ) : canTry ? (
          <button type="button" onClick={() => setSandbox && setSandbox(true)} style={{ ...pill, background: "none", border: "1px solid var(--line)", color: "var(--muted)" }}>{flask}Try portions</button>
        ) : null}
      </div>
    </div>
  );

  // Phones: the result stays pinned to the bottom while the recipe scrolls.
  const stickyBar = stacked && sandbox && (
    <div style={{ position: "sticky", bottom: 12, zIndex: 5, marginTop: 2, display: "flex", alignItems: "center", gap: 12, padding: "11px 14px", borderRadius: 14, background: "var(--text)", color: "var(--shell)", boxShadow: "0 10px 26px rgba(0,0,0,0.22)" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: "0.12em", opacity: 0.7 }}>SANDBOX · {changes} CHANGE{changes === 1 ? "" : "S"} · NOTHING SAVES</div>
        <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: "-0.02em", marginTop: 3, whiteSpace: "nowrap" }}>
          Plate {money2(cost)} · {pct1(margin)}
          {live && <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 500, color: "var(--accent)", marginLeft: 6 }}>{margin >= realMargin ? "▲" : "▼"} {Math.abs(margin - realMargin).toFixed(1)} PTS</span>}
        </div>
      </div>
      <button type="button" onClick={resetSandbox} disabled={!changes} style={{ height: 34, padding: "0 12px", borderRadius: 17, background: "none", border: "1px solid color-mix(in srgb, var(--shell) 35%, transparent)", color: "var(--shell)", fontFamily: SANS, fontSize: 12, fontWeight: 700, cursor: "pointer", opacity: changes ? 1 : 0.5 }}>Reset</button>
    </div>
  );

  const hero = (
    <div data-tour={stacked ? "mi-detail" : undefined}>
      {stacked ? (
        <div>
          <div style={{ ...kick }}>{[d.category || "Dish", `${d.components.length} component${d.components.length === 1 ? "" : "s"}`, `${d.lineCount} ingredient${d.lineCount === 1 ? "" : "s"}`].join(" · ")}</div>
          <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.04em", lineHeight: 1.12, marginTop: 7 }}>{d.name}</div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 12 }}>
            <div style={{ minWidth: 0 }}>{chip}</div>
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.045em", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{money2(price)}</div>
              <div style={{ ...kick, fontSize: 9, color: "var(--accent-deep)", marginTop: 5 }}>Menu price</div>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ padding: "16px 18px 0", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ ...kick, fontSize: 10.5 }}>{[d.category || "Dish", `${d.components.length} component${d.components.length === 1 ? "" : "s"}`, `${d.lineCount} ingredient${d.lineCount === 1 ? "" : "s"}`].join(" · ")}</div>
            <div style={{ fontSize: 25, fontWeight: 800, letterSpacing: "-0.04em", lineHeight: 1.1, marginTop: 7, textWrap: "pretty" }}>{d.name}</div>
            <div style={{ marginTop: 10 }}>{chip}</div>
          </div>
          <div style={{ textAlign: "right", flexShrink: 0 }}>
            <div style={{ fontSize: 32, fontWeight: 800, letterSpacing: "-0.045em", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{money2(price)}</div>
            <div style={{ ...kick, color: "var(--accent-deep)", marginTop: 7 }}>Menu price</div>
          </div>
        </div>
      )}
      {dollarBar}
    </div>
  );

  if (stacked) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12, animation: "om-print .45s cubic-bezier(.25,.8,.35,1) both" }}>
        <style>{DD_CSS}</style>
        {sandbox && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", borderRadius: 10, background: "var(--accent-tint)", color: "var(--accent-deep)", fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.1em" }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent)" }} />SANDBOX · TAP ANY QUANTITY · NOTHING SAVES
          </div>
        )}
        <div style={{ background: "var(--shell)", border: "1px solid var(--line)", borderRadius: 14, padding: "16px 14px", display: "flex", flexDirection: "column", gap: 0 }}>{hero}</div>
        {sales}
        {recipe}
        {trend}
        {panel}
        {stickyBar}
      </div>
    );
  }

  return (
    <div className="dd-root" style={{ flex: 1, minHeight: 0, background: "var(--shell)", borderTop: sandbox ? "3px solid var(--accent)" : "3px solid transparent", animation: "om-print .45s cubic-bezier(.25,.8,.35,1) both" }}>
      <style>{DD_CSS}</style>
      {topBar}
      {hero}
      <div className="dd-body" style={{ padding: "16px 18px 18px" }}>
        {recipe}
        <div className="dd-rail" style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
          {sales}
          {trend}
          {panel}
        </div>
      </div>
    </div>
  );
}

/* Margin trend: no y-axis. The first and last months are labelled, every
   month shows its margin on hover (tap on phones), and the sandbox result
   shows as a dashed ghost point on the latest month. */
function MarginTrend({ history, tgt, whatIf = null, height = 200 }) {
  const [tapped, setTapped] = useState(null);
  const vals = history.map((p) => Number(p.value) || 0);
  const all = vals.concat([tgt], whatIf != null ? [whatIf] : []);
  const lo = Math.min(...all) - 1.5;
  const hi = Math.max(...all) + 1.5;
  const TOP = 26, BOT = 6;
  const Y = (v) => TOP + ((hi - v) / (hi - lo || 1)) * (height - TOP - BOT);
  const X = (i) => (vals.length < 2 ? 50 : 4 + (i / (vals.length - 1)) * 92); // % across
  const pts = vals.map((v, i) => ({ x: X(i), y: Y(v), v, label: history[i].label }));
  const last = pts.length - 1;
  const line = pts.map((p, i) => (i ? "L" : "M") + p.x.toFixed(2) + " " + p.y.toFixed(1)).join(" ");
  const area = `${line} L${pts[last].x.toFixed(2)} ${height} L${pts[0].x.toFixed(2)} ${height} Z`;
  const ty = Y(tgt);
  const wy = whatIf != null ? Y(whatIf) : null;
  const mono = { fontFamily: MONO, position: "absolute", whiteSpace: "nowrap" };
  const dot = (p, big) => (
    <span style={{ position: "absolute", left: p.x + "%", top: p.y, width: big ? 9 : 6, height: big ? 9 : 6, transform: "translate(-50%,-50%)", borderRadius: "50%", background: big ? "var(--accent)" : "var(--shell)", border: "2px solid var(--accent)", boxSizing: "content-box", pointerEvents: "none" }} />
  );
  return (
    <div>
      <div style={{ position: "relative", height }}>
        <svg width="100%" height={height} viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" style={{ display: "block", overflow: "visible" }} aria-hidden="true">
          <line x1="0" y1={ty} x2="100" y2={ty} stroke="var(--text)" strokeWidth="1.5" strokeDasharray="4 4" opacity="0.45" vectorEffect="non-scaling-stroke" />
          <path d={area} fill="var(--accent-tint)" />
          <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          {wy != null && (
            <line x1={pts[last].x} y1={pts[last].y} x2={pts[last].x} y2={wy} stroke="var(--accent-deep)" strokeWidth="1.5" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
          )}
        </svg>
        <span style={{ ...mono, [wy != null ? "left" : "right"]: 0, top: ty + 4, fontSize: 9, letterSpacing: "0.08em", color: "var(--faint)" }}>TARGET {Math.round(tgt)}%</span>
        {pts.map((p, i) => <React.Fragment key={i}>{dot(p, i === 0 || i === last)}</React.Fragment>)}
        {wy != null && (
          <>
            <span style={{ position: "absolute", left: pts[last].x + "%", top: wy, width: 8, height: 8, transform: "translate(-50%,-50%)", borderRadius: "50%", background: "var(--shell)", border: "2px dashed var(--accent-deep)", pointerEvents: "none" }} />
            <span style={{ ...mono, left: `calc(${pts[last].x}% - 10px)`, transform: "translateX(-100%)", top: wy - 22, fontSize: 10.5, fontWeight: 500, color: "var(--accent-deep)" }}>SANDBOX {pct1(whatIf)}</span>
          </>
        )}
        <span style={{ ...mono, left: `calc(${pts[0].x}% - 4px)`, top: pts[0].y - 24, fontSize: 11, color: "var(--muted)" }}>{pct1(pts[0].v)}</span>
        <span style={{ ...mono, left: `calc(${pts[last].x}% + 4px)`, transform: "translateX(-100%)", top: pts[last].y + 9, fontSize: 12, fontWeight: 500, color: "var(--text)" }}>{pct1(pts[last].v)}</span>
        {pts.map((p, i) => (
          <button
            key={"hit" + i}
            type="button"
            className={"dd-pt" + (tapped === i ? " on" : "")}
            onClick={() => setTapped((t) => (t === i ? null : i))}
            aria-label={`${p.label}: ${pct1(p.v)} margin`}
            style={{ position: "absolute", left: p.x + "%", top: p.y, width: 28, height: 28, transform: "translate(-50%,-50%)", padding: 0, border: "none", background: "none", cursor: "pointer" }}
          >
            <span className="dd-tip" style={{ position: "absolute", bottom: 32, left: "50%", transform: "translateX(-50%)", whiteSpace: "nowrap", background: "var(--text)", color: "var(--shell)", fontFamily: MONO, fontSize: 10.5, padding: "4px 8px", borderRadius: 6 }}>
              {p.label} · {pct1(p.v)}
            </span>
          </button>
        ))}
      </div>
      <div style={{ position: "relative", height: 12, marginTop: 6, fontFamily: MONO, fontSize: 9, color: "var(--faint)" }}>
        {pts.map((p, i) => (
          <span key={i} style={{ position: "absolute", left: p.x + "%", transform: "translateX(-50%)", textTransform: "uppercase" }}>{p.label}</span>
        ))}
      </div>
    </div>
  );
}

/* Margin trend geometry, with the target line folded into the scale. */
function buildMarginChart(history, tgt) {
  const h = history && history.length ? history : [{ label: "", value: tgt }];
  const vals = h.map((p) => p.value);
  const lo0 = Math.min(Math.min(...vals), tgt);
  const hi0 = Math.max(Math.max(...vals), tgt);
  const pad = (hi0 - lo0) * 0.3 || 4;
  const lo = lo0 - pad, hi = hi0 + pad;
  const VB_W = 120, VB_H = 50, X0 = 1.5, X1 = 118.5, Y0 = 3.5, Y1 = 46.5;
  const px = (i) => (vals.length < 2 ? (X0 + X1) / 2 : X0 + (i / (vals.length - 1)) * (X1 - X0));
  const py = (v) => Y1 - ((v - lo) / (hi - lo || 1)) * (Y1 - Y0);
  const midIdx = Math.floor((vals.length - 1) / 2);
  const points = h.map((p, i) => ({
    x: px(i).toFixed(2),
    y: py(p.value).toFixed(2),
    topPct: ((py(p.value) / VB_H) * 100).toFixed(2) + "%",
    leftPct: ((px(i) / VB_W) * 100).toFixed(2) + "%",
    label: i === 0 || i === vals.length - 1 || i === midIdx ? p.label : "",
  }));
  const linePath = points.map((p, i) => (i ? "L" : "M") + p.x + " " + p.y).join(" ");
  const areaPath = `${linePath} L${points[points.length - 1].x} ${Y1} L${points[0].x} ${Y1} Z`;
  const gridLines = [hi - (hi - lo) * 0.1, (hi + lo) / 2, lo + (hi - lo) * 0.1].map((v) => ({
    y: py(v).toFixed(1),
    topPct: ((py(v) / VB_H) * 100).toFixed(2) + "%",
    label: v.toFixed(0) + "%",
  }));
  return {
    points, linePath, areaPath, gridLines,
    hasTargetLine: tgt > lo && tgt < hi,
    targetY: py(tgt).toFixed(1),
    targetTopPct: ((py(tgt) / VB_H) * 100).toFixed(2) + "%",
  };
}

/*
 * Price-vs-cost geometry for the same six-month window. The app only
 * stores COST history (menu_item_cost_history) — there's no price-history
 * table, so "how price moved" is necessarily today's menu price held flat
 * across the window; only the cost line is a real series, derived back out
 * of the margin history the same way toMarginHistory() derived margin from
 * it: cost_at_point = price * (1 - margin_at_point / 100).
 */
function buildPriceCostChart(history, price) {
  const h = history && history.length ? history : [{ label: "", value: 0 }];
  const costs = h.map((p) => price * (1 - (Number(p.value) || 0) / 100));
  const vals = costs.concat([price]);
  const lo0 = Math.min(...vals);
  const hi0 = Math.max(...vals);
  const pad = (hi0 - lo0) * 0.3 || price * 0.1 || 1;
  const lo = lo0 - pad, hi = hi0 + pad;
  const VB_W = 120, VB_H = 50, X0 = 1.5, X1 = 118.5, Y0 = 3.5, Y1 = 46.5;
  const px = (i) => (costs.length < 2 ? (X0 + X1) / 2 : X0 + (i / (costs.length - 1)) * (X1 - X0));
  const py = (v) => Y1 - ((v - lo) / (hi - lo || 1)) * (Y1 - Y0);
  const midIdx = Math.floor((costs.length - 1) / 2);
  const costPoints = h.map((p, i) => ({
    x: px(i).toFixed(2),
    y: py(costs[i]).toFixed(2),
    topPct: ((py(costs[i]) / VB_H) * 100).toFixed(2) + "%",
    leftPct: ((px(i) / VB_W) * 100).toFixed(2) + "%",
    label: i === 0 || i === costs.length - 1 || i === midIdx ? p.label : "",
  }));
  const costPath = costPoints.map((p, i) => (i ? "L" : "M") + p.x + " " + p.y).join(" ");
  const priceY = py(price).toFixed(1);
  const gridLines = [hi - (hi - lo) * 0.1, (hi + lo) / 2, lo + (hi - lo) * 0.1].map((v) => ({
    y: py(v).toFixed(1),
    topPct: ((py(v) / VB_H) * 100).toFixed(2) + "%",
    label: money0(v),
  }));
  return {
    costPoints, costPath, gridLines,
    priceY,
    priceTopPct: ((py(price) / VB_H) * 100).toFixed(2) + "%",
  };
}