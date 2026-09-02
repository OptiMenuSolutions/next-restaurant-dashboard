import React, { useMemo, useState } from "react";
import {
  Shell, Header, MobileHeader, MobileNav, LoadingState, EmptyState, ErrorState,
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
 *   onReprice  (dish, suggestedPrice) => void
 *   restaurantName, user, theme/defaultTheme/onThemeChange, NavLink
 */

const money2 = (n) => money(n, 2);
const money0 = (n) => money(n, 0);
const pct = (n) => (Number(n) || 0).toFixed(0) + "%";
const ppLabel = (p) => (p >= 0 ? "+" : "−") + Math.abs(p).toFixed(1) + "pp";
const ppColor = (p) => (p < -2 ? "var(--red)" : p > 2 ? "var(--green)" : "var(--faint)");
const moveLabel = (m) => (m >= 0 ? "+" : "−") + money2(Math.abs(m)).slice(1);
const moveColor = (m) => (m > 0.01 ? "var(--red)" : m < -0.01 ? "var(--green)" : "var(--faint)");

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
  };
}

export default function MenuItemsScreen({
  items: itemsProp,
  targetMargin = 68,
  loading = false,
  error = null,
  onRetry,
  onOpenItem,
  onAddItem,
  onUploadMenu,
  onReprice,
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
  const [selectedId, setSelectedId] = useState(null);
  const [open, setOpen] = useState({});

  const data = useMemo(() => (itemsProp || DEMO_ITEMS).map(decorate), [itemsProp]);
  const tgt = targetMargin;

  const belowTarget = data.filter((d) => d.margin < tgt);
  const slipping = data.filter((d) => d.drift < -2);
  const estimated = data.filter((d) => d.estShare > 0.15);

  const shown =
    filter === "Below target" ? belowTarget :
    filter === "Slipping" ? slipping :
    filter === "Part-estimated" ? estimated : data;

  const selected = shown.find((d) => d.id === selectedId) || null;

  const chrome = (
    <Header active="menu-items" NavLink={NavLink} user={user} restaurantName={restaurantName} theme={theme} onToggleTheme={toggleTheme} onSearch={onSearch} onSignOut={onSignOut} logoSrc={logoSrc} logoDarkSrc={logoDarkSrc} />
  );

  if (loading) return <Shell theme={theme}>{chrome}<LoadingState label="Costing your plates…" /></Shell>;
  if (error) return <Shell theme={theme}>{chrome}<ErrorState message={error} onRetry={onRetry} /></Shell>;

  if (!data.length) {
    return (
      <Shell theme={theme}>
        {chrome}
        <EmptyState
          kicker="No dishes yet"
          title="Write a recipe once, and it prices itself forever"
          body="Tell us what goes on the plate and how much of it. Every invoice you upload after that re-costs the dish on its own, so the margin you see is the margin you got last week."
        >
          <button type="button" onClick={onAddItem} style={{ marginTop: 8, background: "var(--accent)", color: "#fff", border: "none", borderRadius: 24, padding: "12px 26px", fontFamily: SANS, fontSize: 14.5, fontWeight: 700, cursor: "pointer", boxShadow: "0 10px 24px rgba(2,164,186,0.28)" }}>Add your first dish</button>
        </EmptyState>
      </Shell>
    );
  }

  const countLabel = `Showing ${shown.length} of ${data.length} dishes`;
  const avgMargin = data.reduce((a, d) => a + d.margin, 0) / data.length;

  if (isMobile) {
    return (
      <Shell theme={theme}>
        <MobileHeader theme={theme} onToggleTheme={toggleTheme} user={user} logoSrc={logoSrc} logoDarkSrc={logoDarkSrc} />
        <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--line)" }}>
          <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: "-0.03em" }}>Menu items</div>
          <div style={{ fontFamily: MONO, fontSize: 11.5, letterSpacing: "0.08em", color: "var(--faint)", marginTop: 3 }}>{countLabel}</div>
        </div>
        <div style={{ flex: 1, padding: 16, display: "flex", flexDirection: "column", gap: 10, background: "var(--panel)" }}>
          {shown.map((d) => (
            <div key={d.id} onClick={() => onOpenItem && onOpenItem(d)} style={{ background: "var(--shell)", border: "1px solid var(--line)", borderRadius: 12, padding: "13px 14px", display: "flex", flexDirection: "column", gap: 7 }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
                <span style={{ fontSize: 14.5, fontWeight: 700, letterSpacing: "-0.02em" }}>{d.name}</span>
                <span style={{ fontSize: 14.5, fontWeight: 800, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums", color: d.margin < tgt ? "var(--red)" : "var(--text)" }}>{pct(d.margin)}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <span style={{ fontFamily: MONO, fontSize: 11.5, color: "var(--faint)" }}>{money0(d.price)} menu · {money2(d.cost)} cost</span>
                <span style={{ fontFamily: MONO, fontSize: 11.5, fontWeight: 500, color: ppColor(d.drift) }}>{ppLabel(d.drift)}</span>
              </div>
            </div>
          ))}
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
              {["All", "Below target", "Slipping"].map((f) => (
                <button key={f} type="button" onClick={() => { setFilter(f); setSelectedId(null); }}
                  style={{ border: "none", cursor: "pointer", fontFamily: SANS, fontSize: 12.5, fontWeight: 600, borderRadius: 16, padding: "6px 12px", whiteSpace: "nowrap", background: filter === f ? "var(--accent)" : "transparent", color: filter === f ? "#fff" : "var(--muted)" }}>
                  {f === "Below target" ? `Below target · ${belowTarget.length}` : f === "Slipping" ? `Slipping · ${slipping.length}` : f}
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

        <div style={{ display: "grid", gridTemplateColumns: "minmax(420px,0.95fr) minmax(0,1fr)", gap: 16, flex: 1, minHeight: 0 }}>
          <div data-tour="mi-grid-wrap" style={{ background: "var(--shell)", border: "1px solid var(--line)", borderRadius: 12, boxShadow: "var(--card-lift)", display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
            {layout === "cards" ? (
              <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "14px 16px", display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))", gap: 10, alignContent: "start" }}>
                {shown.map((d) => {
                  const active = selected && d.id === selected.id;
                  return (
                    <div key={d.id} data-tour="mi-card" onClick={() => setSelectedId(d.id)} onDoubleClick={() => onOpenItem && onOpenItem(d)} className="om-hover-accent"
                      style={{ aspectRatio: "1", minHeight: 146, background: active ? "var(--accent-tint)" : "var(--panel)", border: `1px solid ${active ? "var(--accent)" : "var(--line-soft)"}`, borderRadius: 10, padding: "11px 12px", display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 8, cursor: "pointer", overflow: "hidden" }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                          <span style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--faint)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{d.category}</span>
                          {d.estShare > 0.15 && (
                            <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--amber)", border: "1px solid var(--amber)", borderRadius: 9, padding: "0 4px", flexShrink: 0 }}>Est</span>
                          )}
                        </div>
                        <div style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.2, textWrap: "pretty", marginTop: 6, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{d.name}</div>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                        <div style={{ fontFamily: MONO, fontSize: 10, color: "var(--faint)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{money0(d.price)} menu · {money2(d.cost)} cost</div>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
                          <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums", color: d.margin < tgt ? "var(--red)" : "var(--text)" }}>{pct(d.margin)}</span>
                          <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--faint)" }}>mgn</span>
                          <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: 10, whiteSpace: "nowrap", color: ppColor(d.drift) }}>{ppLabel(d.drift)}</span>
                        </div>
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
                <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
                  {shown.map((d) => {
                    const active = selected && d.id === selected.id;
                    return (
                      <div key={d.id} className="om-row" onClick={() => setSelectedId(d.id)} onDoubleClick={() => onOpenItem && onOpenItem(d)}
                        style={{ display: "grid", gridTemplateColumns: LIST_GRID, gap: 12, alignItems: "center", padding: "12px 20px", borderBottom: "1px solid var(--line-soft)", cursor: "pointer", background: active ? "var(--accent-tint)" : "transparent", borderLeft: `2px solid ${active ? "var(--accent)" : "transparent"}` }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                            <span style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{d.name}</span>
                            {d.estShare > 0.15 && (
                              <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--amber)", border: "1px solid var(--amber)", borderRadius: 10, padding: "1px 5px", flexShrink: 0 }}>Est</span>
                            )}
                          </div>
                          <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--faint)", marginTop: 3 }}>{d.category}</div>
                        </div>
                        <div style={{ fontSize: 13.5, fontWeight: 600, fontVariantNumeric: "tabular-nums", textAlign: "right", whiteSpace: "nowrap", color: "var(--muted)" }}>{money0(d.price)}</div>
                        <div style={{ fontSize: 13.5, fontWeight: 600, fontVariantNumeric: "tabular-nums", textAlign: "right", whiteSpace: "nowrap", color: "var(--text)" }}>{money2(d.cost)}</div>
                        <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                          <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums", color: d.margin < tgt ? "var(--red)" : "var(--text)" }}>{pct(d.margin)}</div>
                          <div style={{ fontFamily: MONO, fontSize: 10.5, color: ppColor(d.drift), marginTop: 2 }}>{ppLabel(d.drift)}</div>
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
                <span>{belowTarget.length} below {pct(tgt)}</span>
                <span>Menu average {pct(avgMargin)}</span>
              </span>
            </div>
          </div>

          <div data-tour="mi-detail" style={{ minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column", background: "var(--shell)", border: "1px solid var(--line)", borderRadius: 12, boxShadow: "var(--card-lift)", animation: "om-rise .4s cubic-bezier(.25,.8,.35,1) both" }}>
            {selected ? (
              <DishDetail
                d={selected}
                tgt={tgt}
                open={open}
                setOpen={setOpen}
                onBack={() => setSelectedId(null)}
                onReprice={onReprice}
              />
            ) : (
              <MenuSummary
                data={data}
                tgt={tgt}
                belowTarget={belowTarget}
                estimated={estimated}
                periodLabel={periodLabel}
                onPick={(d) => { setFilter("All"); setSelectedId(d.id); }}
                onEstimated={() => { setFilter("Part-estimated"); setSelectedId(null); }}
                onUploadMenu={onUploadMenu}
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

function DishDetail({ d, tgt, open, setOpen, onBack, onReprice }) {
  const chart = useMemo(() => buildMarginChart(d.history, tgt), [d.history, tgt]);
  const holdPrice = d.cost / (1 - tgt / 100);
  const suggested = Math.ceil(holdPrice);

  const biggest = d.components.slice().sort((a, b) => b.cost - a.cost)[0];
  const keyOf = (c) => d.id + "|" + c.name;
  const isOpen = (c) => (keyOf(c) in open ? open[keyOf(c)] : biggest && c.name === biggest.name);
  const anyOpen = d.components.some(isOpen);

  const priceLines = [
    { label: "On the menu", value: money0(d.price), color: "var(--text)" },
    { label: "Plate cost", value: money2(d.cost), color: "var(--text)" },
    { label: `Holds ${pct(tgt)}`, value: money0(suggested), color: suggested > d.price ? "var(--amber)" : "var(--text)" },
  ];

  const repriceNote = suggested > d.price
    ? `${money0(suggested)} would put ${d.name.split(",")[0]} back at ${pct(tgt)}.` +
      (d.covers ? ` At ${d.covers} covers that is ${money0((suggested - d.price) * d.covers)} a month.` : "")
    : `Priced above target. Holding ${money0(d.price)} banks ${money0((d.price - holdPrice) * (d.covers || 0))} a month over the ${pct(tgt)} line.`;

  return (
    <>
      <div style={{ flexShrink: 0, background: "var(--accent-tint)", borderBottom: "1px solid var(--line)", borderLeft: "3px solid var(--accent)", padding: "20px 22px 18px", display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16 }}>
        <div style={{ minWidth: 0 }}>
          <button type="button" onClick={onBack} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", padding: 0, marginBottom: 9, cursor: "pointer", fontFamily: MONO, fontSize: 10.5, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--accent-deep)" }}>
            <span style={{ fontSize: 14, lineHeight: 1 }}>‹</span><span>All dishes</span>
          </button>
          <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.04em", lineHeight: 1.05 }}>{d.name}</div>
          <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 7, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {[d.category, `${money0(d.price)} on the menu`, d.covers ? `${d.covers} covers` : null].filter(Boolean).join(" · ")}
          </div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-0.045em", fontVariantNumeric: "tabular-nums", lineHeight: 1, color: d.margin < tgt ? "var(--red)" : "var(--text)" }}>{pct(d.margin)}</div>
          <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--accent-deep)", marginTop: 7 }}>
            {d.margin >= tgt ? "On target" : ppLabel(d.margin - tgt) + " off target"}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "stretch", flexWrap: "wrap", borderBottom: "1px solid var(--line)", flexShrink: 0 }}>
        <div style={{ flex: "1 1 150px", minWidth: 0, padding: "16px 18px 10px", display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 700, letterSpacing: "-0.02em", whiteSpace: "nowrap" }}>
              <span style={{ width: 7, height: 7, background: "var(--accent)", flexShrink: 0 }} />
              <span>Margin, six months</span>
            </span>
            <span style={{ fontFamily: MONO, fontSize: 11.5, letterSpacing: "0.04em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0, color: ppColor(d.drift) }}>{ppLabel(d.drift)}</span>
          </div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", padding: "10px 24px 26px 30px" }}>
            <div style={{ position: "relative" }}>
              <svg viewBox="0 0 120 50" style={{ width: "100%", height: "auto", display: "block", overflow: "visible" }}>
                {chart.gridLines.map((g, i) => (
                  <line key={i} x1="0" y1={g.y} x2="120" y2={g.y} stroke="var(--line-soft)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                ))}
                <path d={chart.areaPath} fill="var(--accent-tint)" stroke="none" />
                <path d={chart.linePath} fill="none" stroke="var(--accent)" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                {chart.hasTargetLine && (
                  <line x1="0" y1={chart.targetY} x2="120" y2={chart.targetY} stroke="var(--amber)" strokeWidth="1.2" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
                )}
              </svg>
              {chart.points.map((p, i) => (
                <div key={"pt" + i} style={{ position: "absolute", left: p.leftPct, top: p.topPct, width: 9, height: 9, margin: "-4.5px 0 0 -4.5px", borderRadius: "50%", background: "var(--shell)", border: "2.2px solid var(--accent)" }} />
              ))}
              {chart.gridLines.map((g, i) => (
                <div key={"gl" + i} style={{ position: "absolute", right: "100%", marginRight: 8, top: g.topPct, transform: "translateY(-50%)", fontFamily: MONO, fontSize: 11.5, color: "var(--faint)", whiteSpace: "nowrap" }}>{g.label}</div>
              ))}
              {chart.hasTargetLine && (
                <div style={{ position: "absolute", left: 0, top: chart.targetTopPct, transform: "translateY(-140%)", fontFamily: MONO, fontSize: 10.5, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--amber)", whiteSpace: "nowrap" }}>Target {pct(tgt)}</div>
              )}
              {chart.points.map((p, i) => (
                <div key={"lb" + i} style={{ position: "absolute", top: "100%", marginTop: 6, left: p.leftPct, transform: "translateX(-50%)", fontFamily: MONO, fontSize: 11.5, color: "var(--faint)", whiteSpace: "nowrap" }}>{p.label}</div>
              ))}
            </div>
          </div>
        </div>

        <div style={{ flex: "0 0 236px", minWidth: 0, padding: "16px 18px 18px", borderLeft: "1px solid var(--line)", display: "flex", flexDirection: "column", gap: 12 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 700, letterSpacing: "-0.02em" }}>
            <span style={{ width: 7, height: 7, border: "1.5px solid var(--accent)", borderRadius: "50%" }} />Price check
          </span>
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            {priceLines.map((p) => (
              <div key={p.label} style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
                <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--faint)" }}>{p.label}</span>
                <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums", color: p.color }}>{p.value}</span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: "auto", border: "1px dashed var(--line)", borderRadius: 8, padding: "11px 12px" }}>
            <div style={{ fontSize: 12, lineHeight: 1.5, color: "var(--muted)", textWrap: "pretty" }}>{repriceNote}</div>
            <button type="button" onClick={() => onReprice && onReprice(d, suggested)} className="om-hover-accent" style={{ marginTop: 9, width: "100%", background: "none", border: "1px solid var(--accent)", borderRadius: 20, padding: "7px 12px", cursor: "pointer", fontFamily: MONO, fontSize: 10.5, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--accent-deep)" }}>Reprice to target</button>
          </div>
        </div>
      </div>

      <div style={{ flex: "1 1 auto", minHeight: 0, display: "flex", flexDirection: "column", background: "var(--panel)", padding: "16px 22px 18px" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexShrink: 0 }}>
          <span style={{ fontFamily: MONO, fontSize: 11.5, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--muted)" }}>
            Plate cost · {d.components.length} components · {d.lineCount} ingredients
          </span>
          <span style={{ flex: 1 }} />
          <span style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: "0.06em", color: "var(--faint)", whiteSpace: "nowrap" }}>Cost per plate · Δ since first price</span>
          <button type="button" onClick={() => setOpen((prev) => {
            const next = { ...prev };
            d.components.forEach((c) => { next[d.id + "|" + c.name] = !anyOpen; });
            return next;
          })} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: MONO, fontSize: 10.5, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--muted)" }}>
            {anyOpen ? "Collapse all" : "Expand all"}
          </button>
        </div>
        <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", marginTop: 10, borderTop: "1px dashed var(--line)" }}>
          {d.components.map((c) => {
            const opened = isOpen(c);
            const move = c.cost - c.costThen;
            const share = d.cost ? (c.cost / d.cost) * 100 : 0;
            return (
              <div key={c.name} style={{ padding: "11px 2px 12px", borderBottom: "1px dashed var(--line)" }}>
                <div onClick={() => setOpen((prev) => ({ ...prev, [keyOf(c)]: !opened }))} style={{ display: "flex", alignItems: "baseline", gap: 8, fontFamily: MONO, cursor: "pointer" }}>
                  <span style={{ fontSize: 10, color: "var(--accent-deep)", width: 9, flexShrink: 0 }}>{opened ? "▾" : "▸"}</span>
                  <span style={{ fontSize: 11, fontWeight: 500, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text)", whiteSpace: "nowrap" }}>{c.name}</span>
                  <span style={{ flex: 1, borderBottom: "1px dotted var(--faint)", transform: "translateY(-3px)" }} />
                  <span style={{ fontSize: 12.5, fontWeight: 500, color: "var(--text)", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{money2(c.cost)}</span>
                  <span style={{ fontSize: 11.5, fontWeight: 500, whiteSpace: "nowrap", minWidth: 56, textAlign: "right", fontVariantNumeric: "tabular-nums", color: c.allEstimated || c.unknownMove ? "var(--faint)" : moveColor(move) }}>
                    {c.allEstimated || c.unknownMove ? "—" : moveLabel(move)}
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6, paddingLeft: 17 }}>
                  <div style={{ flex: 1, height: 3, background: "var(--line)", borderRadius: 2, overflow: "hidden" }}>
                    <div style={{ height: 3, borderRadius: 2, background: "var(--accent)", width: share.toFixed(1) + "%" }} />
                  </div>
                  <span style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: "0.06em", color: "var(--faint)", whiteSpace: "nowrap" }}>
                    {share.toFixed(0)}% of plate{!opened && ` · ${c.ingredients.length === 1 ? "1 ingredient" : c.ingredients.length + " ingredients"}`}
                  </span>
                </div>
                {opened && (
                  <div style={{ margin: "8px 0 0 17px", paddingLeft: 12, borderLeft: "1px solid var(--line)", display: "flex", flexDirection: "column", gap: 5 }}>
                    {c.ingredients.map((i, n) => {
                      const im = (Number(i.cost) || 0) - (Number(i.costThen != null ? i.costThen : i.cost) || 0);
                      return (
                        <div key={n} style={{ display: "flex", alignItems: "baseline", gap: 7, fontFamily: MONO }}>
                          <span style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{i.name}</span>
                          {i.estimated && (
                            <span style={{ fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--amber)", border: "1px solid var(--amber)", borderRadius: 9, padding: "0 4px", flexShrink: 0 }}>Est</span>
                          )}
                          <span style={{ fontSize: 11, color: "var(--faint)", whiteSpace: "nowrap" }}>
                            {i.qty}{i.unitPrice != null ? ` · ${money2(i.unitPrice)}/${i.unit || "ea"}` : ""}
                          </span>
                          <span style={{ flex: 1, borderBottom: "1px dotted var(--line)", transform: "translateY(-3px)" }} />
                          <span style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{money2(i.cost)}</span>
                          <span style={{ fontSize: 11, whiteSpace: "nowrap", minWidth: 56, textAlign: "right", fontVariantNumeric: "tabular-nums", color: i.estimated || i.costThen == null ? "var(--faint)" : moveColor(im) }}>
                            {i.estimated || i.costThen == null ? "—" : moveLabel(im)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div style={{ flexShrink: 0, marginTop: 11, display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, fontFamily: MONO, fontSize: 11.5, letterSpacing: "0.06em", color: "var(--faint)" }}>
          <span>
            {d.estCount
              ? `${d.estCount} of ${d.lineCount} lines priced by hand · ${pct(d.estShare * 100)} of plate cost`
              : "Every line priced from an invoice"}
          </span>
          <span style={{ color: "var(--text)", fontWeight: 500 }}>Plate cost {money2(d.cost)} · food cost {pct(d.price ? (d.cost / d.price) * 100 : 0)}</span>
        </div>
      </div>
    </>
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