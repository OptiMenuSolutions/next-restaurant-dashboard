import React, { useMemo, useState } from "react";
import {
  Shell, Header, MobileHeader, MobileNav, LoadingState, EmptyState, ErrorState,
  useTheme, useIsMobile, MONO, SANS, PAGE_PAD,
} from "./ClientChrome";

/**
 * AnalyticsScreen — ported from "OptiMenu Analytics.dc.html".
 *
 * KPI strip, nightly sales trend with weekend shading and a hover read-out,
 * service rhythm by night or by hour, a menu-engineering matrix crossing plates
 * sold with margin per plate, and top / rising / falling movers. Loading, empty
 * and mobile states included.
 *
 * Props
 *   days [Night] – one entry per service night, oldest → newest:
 *     { date: Date|string, label: "8/25", dow: 0-6 (Mon=0), weekend: bool,
 *       items: [{ name, category, price, cost, qty }] }
 *     rev / cogs / qty are derived if not supplied.
 *   hourly [{ hour: 11-23, qty }]  – optional; the by-hour view hides without it
 *   targetFoodCost number          – %, default 30
 *   posSystem string, syncStamp string, uploadedThrough string
 *   loading, error, onRetry, onUpload
 *   onSelectDish (dish) => void
 *   restaurantName, user, theme/defaultTheme/onThemeChange, NavLink
 */

const money0 = (n) => "$" + Math.round(Number(n) || 0).toLocaleString("en-US");
const money2 = (n) => "$" + (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const moneyK = (n) => (Math.abs(n) >= 1000 ? "$" + (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "k" : "$" + Math.round(n));
/* KPI strip keeps one decimal in the k-range so $41.5k and $42.4k don't read alike. */
const moneyK1 = (n) => (Math.abs(n) >= 1000 ? "$" + (n / 1000).toFixed(1) + "k" : "$" + Math.round(n));
const num = (n) => Math.round(Number(n) || 0).toLocaleString("en-US");
const pct1 = (n) => (Number(n) || 0).toFixed(1) + "%";

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAY_FULL = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const QUAD_COLOR = { Star: "var(--green)", Plowhorse: "var(--accent-deep)", Puzzle: "var(--amber)", Dog: "var(--red)" };

/* A fortnight of demo nights so the screen renders before the queries land. */
export const DEMO_DAYS = (() => {
  const DISHES = [
    ["Whole branzino, salsa verde", "Secondi", 58, 31.1, 7.7],
    ["Duck, sour cherry, hazelnut", "Secondi", 42, 19.92, 10.2],
    ["Fritto misto", "Antipasti", 21, 7.02, 12.3],
    ["Caesar, little gem", "Antipasti", 17, 5.61, 14.6],
    ["Focaccia, whipped butter", "Antipasti", 12, 2.0, 22],
    ["Cacio e pepe", "Primi", 26, 3.93, 16],
    ["Carbonara, guanciale", "Primi", 28, 3.91, 13.5],
    ["Broccolini, chili, lemon", "Contorni", 15, 2.9, 9.5],
    ["Brown butter tart", "Dolci", 14, 3.13, 10.6],
  ];
  const DOW = [0.72, 0.8, 0.9, 1.06, 1.36, 1.52, 0.96];
  let seed = 20260825;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const end = Date.UTC(2026, 7, 25);
  return Array.from({ length: 28 }, (_, k) => {
    const i = 27 - k;
    const d = new Date(end - i * 86400000);
    const dow = (d.getUTCDay() + 6) % 7;
    return {
      date: d,
      label: d.getUTCMonth() + 1 + "/" + d.getUTCDate(),
      dow,
      weekend: dow >= 4,
      items: DISHES.map(([name, category, price, cost, base]) => ({
        name, category, price, cost,
        qty: Math.max(0, Math.round(base * DOW[dow] * (0.86 + rnd() * 0.28))),
      })),
    };
  });
})();

function normalise(days) {
  return (days || []).map((d) => {
    const items = (d.items || []).map((x) => ({
      ...x,
      qty: Number(x.qty) || 0,
      price: Number(x.price) || 0,
      cost: x.cost == null ? null : Number(x.cost),
      rev: x.rev != null ? Number(x.rev) : (Number(x.qty) || 0) * (Number(x.price) || 0),
      cogs: x.cogs != null ? Number(x.cogs) : (Number(x.qty) || 0) * (Number(x.cost) || 0),
    })).map((x) => ({
      ...x,
      // Revenue from dishes whose cost is known. Food cost % uses only this,
      // so sales of not-yet-priced dishes don't make it look artificially low.
      costedRev: x.costedRev != null ? Number(x.costedRev) : x.cost != null ? x.rev : 0,
    }));
    const date = d.date instanceof Date ? d.date : new Date(d.date);
    const dow = d.dow != null ? d.dow : (date.getDay() + 6) % 7;
    return {
      ...d,
      date,
      dow,
      weekend: d.weekend != null ? d.weekend : dow >= 4,
      label: d.label || `${date.getMonth() + 1}/${date.getDate()}`,
      items,
      qty: items.reduce((a, x) => a + x.qty, 0),
      rev: items.reduce((a, x) => a + x.rev, 0),
      cogs: items.reduce((a, x) => a + x.cogs, 0),
      costedRev: items.reduce((a, x) => a + x.costedRev, 0),
    };
  });
}

export default function AnalyticsScreen({
  days: daysProp,
  hourly,
  targetFoodCost = 30,
  posSystem = "Toast",
  syncStamp,
  loading = false,
  error = null,
  onRetry,
  onUpload,
  onSelectDish,
  onSearch,
  onSignOut,
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
  const [range, setRange] = useState("28d");
  const [trendMetric, setTrendMetric] = useState("rev");
  const [sortBy, setSortBy] = useState("margin");
  const [hoverIdx, setHoverIdx] = useState(null);

  const days = useMemo(() => normalise(daysProp || DEMO_DAYS), [daysProp]);

  const chrome = (
    <Header active="analytics" NavLink={NavLink} user={user} restaurantName={restaurantName} theme={theme} onToggleTheme={toggleTheme} onSearch={onSearch} onSignOut={onSignOut} logoSrc={logoSrc} logoDarkSrc={logoDarkSrc} />
  );

  if (loading) return <Shell theme={theme}>{chrome}<LoadingState label="Reading the tickets…" /></Shell>;
  if (error) return <Shell theme={theme}>{chrome}<ErrorState message={error} onRetry={onRetry} /></Shell>;

  if (!days.length) {
    const required = ["item name", "sale date", "quantity", "revenue"].map((l) => ({ label: l, border: "var(--accent)", color: "var(--accent-deep)" }))
      .concat(["category", "unit price", "hour", "voids", "comps"].map((l) => ({ label: l + " (optional)", border: "var(--line)", color: "var(--faint)" })));
    return (
      <Shell theme={theme}>
        {chrome}
        <EmptyState
          kicker="No sales yet"
          title="Your POS knows what sold. We know what it cost."
          body="Export a sales report from your POS and drop the file here. Every plate you have costed gets matched to what actually left the kitchen, so tonight’s revenue arrives with its margin attached."
        >
          <button type="button" onClick={onUpload} style={{ marginTop: 8, background: "var(--accent)", color: "#fff", border: "none", borderRadius: 24, padding: "12px 26px", fontFamily: SANS, fontSize: 14.5, fontWeight: 700, cursor: "pointer", boxShadow: "0 10px 24px rgba(2,164,186,0.28)" }}>Upload a POS export</button>
          <div style={{ marginTop: 14, width: "100%", border: "1px dashed var(--line)", borderRadius: 10, padding: "14px 16px", textAlign: "left" }}>
            <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--faint)" }}>Columns we need</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginTop: 9 }}>
              {required.map((c) => (
                <span key={c.label} style={{ fontFamily: MONO, fontSize: 11, padding: "3px 8px", borderRadius: 12, border: `1px solid ${c.border}`, color: c.color, whiteSpace: "nowrap" }}>{c.label}</span>
              ))}
            </div>
            <div style={{ fontSize: 12, color: "var(--faint)", marginTop: 10 }}>Toast, Square, Clover and Lightspeed exports map themselves. Anything else, you match the columns once.</div>
          </div>
        </EmptyState>
      </Shell>
    );
  }

  /* ── window + KPIs ─────────────────────────────────────────────── */
  const span = range === "7d" ? Math.min(7, days.length) : range === "14d" ? Math.min(14, days.length) : Math.min(28, days.length);
  const win = days.slice(-span);
  const prior = days.slice(Math.max(0, days.length - span * 2), days.length - span);
  const sum = (arr, k) => arr.reduce((a, x) => a + x[k], 0);
  const rev = sum(win, "rev"), cogs = sum(win, "cogs"), qty = sum(win, "qty");
  const costedRev = sum(win, "costedRev");
  const pRev = sum(prior, "rev"), pQty = sum(prior, "qty"), pCogs = sum(prior, "cogs"), pCostedRev = sum(prior, "costedRev");
  // Food cost and margin cover only sales of dishes with a known cost.
  // With none costed, both show a dash rather than a number built on guesses.
  const contribution = costedRev ? costedRev - cogs : null;
  const foodCost = costedRev ? (cogs / costedRev) * 100 : null;
  const pContribution = pCostedRev ? pCostedRev - pCogs : null;
  const pFoodCost = pCostedRev ? (pCogs / pCostedRev) * 100 : null;
  const costedShare = rev ? costedRev / rev : 0;
  const fcColor = (v) => (v == null ? "var(--faint)" : v > targetFoodCost ? "var(--red)" : "var(--text)");

  const pctDelta = (now, was) => {
    if (now == null || !was) return { label: "—", color: "var(--faint)" };
    const p = ((now - was) / was) * 100;
    return { label: (p >= 0 ? "▲ " : "▼ ") + Math.abs(p).toFixed(1) + "%", color: p > 0.5 ? "var(--green)" : p < -0.5 ? "var(--red)" : "var(--faint)" };
  };
  // Food cost going UP is bad, so its colors run the other way.
  const ptsDelta = (now, was) => {
    if (now == null || was == null) return { label: "—", color: "var(--faint)" };
    const p = now - was;
    return { label: (p >= 0 ? "▲ " : "▼ ") + Math.abs(p).toFixed(1) + " pts", color: p > 0.2 ? "var(--red)" : p < -0.2 ? "var(--green)" : "var(--faint)" };
  };
  const salesD = pctDelta(rev, pRev);
  const qtyD = pctDelta(qty, pQty);
  const fcD = ptsDelta(foodCost, pFoodCost);
  const gmD = pctDelta(contribution, pContribution);
  const priorNote = prior.length ? `vs prior ${prior.length} nights` : "no earlier nights to compare";

  /* ── night by night ────────────────────────────────────────────── */
  const nightFc = (d) => (d.costedRev ? (d.cogs / d.costedRev) * 100 : null);
  const valOf = (d) => (trendMetric === "rev" ? d.rev : trendMetric === "qty" ? d.qty : nightFc(d) || 0);
  const niceMax = (v) => {
    if (!(v > 0)) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    const n = v / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
  };
  const rawMax = Math.max(0, ...win.map(valOf));
  const chartMax = trendMetric === "fc"
    ? Math.max(40, Math.ceil(Math.max(rawMax, targetFoodCost) / 10) * 10)
    : niceMax(rawMax);
  const fmtAxis = (v) => (trendMetric === "rev" ? moneyK(v) : trendMetric === "fc" ? Math.round(v) + "%" : num(v));
  const labelStep = span <= 7 ? 1 : span <= 14 ? 2 : Math.ceil(span / 7);
  const barGap = span <= 7 ? 14 : span <= 14 ? 7 : 3;
  const BAR_SOFT = "color-mix(in srgb, var(--accent) 45%, var(--shell))";
  const BAR_OK = "color-mix(in srgb, var(--faint) 50%, var(--shell))";
  const bars = win.map((d, i) => {
    const f = nightFc(d);
    const color = trendMetric === "fc"
      ? (f != null && f > targetFoodCost ? "var(--red)" : BAR_OK)
      : d.weekend ? "var(--accent)" : BAR_SOFT;
    return { key: d.label + "-" + i, h: Math.max(1, (valOf(d) / chartMax) * 100), color, x: i % labelStep === 0 ? d.label : "" };
  });
  const readDay = win[hoverIdx != null && win[hoverIdx] ? hoverIdx : win.length - 1];
  const readFc = nightFc(readDay);
  const targetTop = Math.max(0, (1 - targetFoodCost / chartMax) * 100);
  const legend = trendMetric === "fc"
    ? [["var(--red)", `Over your ${targetFoodCost}% target`], [BAR_OK, "At or under target"]]
    : [["var(--accent)", "Fri – Sun"], [BAR_SOFT, "Mon – Thu"]];

  /* ── dish performance ──────────────────────────────────────────── */
  const perDish = (() => {
    const map = new Map();
    win.forEach((d) => d.items.forEach((x) => {
      const e = map.get(x.name) || { name: x.name, cat: x.category || x.cat || "", price: x.price, cost: x.cost, qty: 0, rev: 0, cogs: 0 };
      e.qty += x.qty; e.rev += x.rev; e.cogs += x.cogs;
      e.price = x.price || e.price;
      if (x.cost != null) e.cost = x.cost;
      map.set(x.name, e);
    }));
    return [...map.values()].map((d) => {
      const known = d.cost != null;
      return {
        ...d,
        contribPer: known ? d.price - d.cost : null,
        contribTotal: known ? d.qty * (d.price - d.cost) : null,
        foodCostPct: known && d.price ? (d.cost / d.price) * 100 : null,
      };
    });
  })();
  // Classes only for dishes with a known cost; the rest show as Unpriced.
  const pricedDishes = perDish.filter((d) => d.contribPer != null);
  const medOf = (arr) => {
    const s = arr.slice().sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const medQty = pricedDishes.length ? medOf(pricedDishes.map((d) => d.qty)) : 0;
  const medContrib = pricedDishes.length ? medOf(pricedDishes.map((d) => d.contribPer)) : 0;
  perDish.forEach((d) => {
    d.quad = d.contribPer == null ? null
      : d.qty >= medQty ? (d.contribPer >= medContrib ? "Star" : "Plowhorse")
      : d.contribPer >= medContrib ? "Puzzle" : "Dog";
  });
  const sortVal = (d) =>
    sortBy === "qty" ? d.qty
    : sortBy === "fc" ? (d.foodCostPct == null ? -1 : d.foodCostPct)
    : d.contribTotal == null ? -1 : d.contribTotal;
  const dishRows = perDish.slice().sort((a, b) => sortVal(b) - sortVal(a));

  /* ── close-out: the last service night ─────────────────────────── */
  const zNight = days[days.length - 1];
  // Same weekday a week earlier; falls back to the latest earlier night of
  // that weekday when the restaurant was closed that exact date.
  const zPrev = days.slice(0, -1).reverse().find((d) => d.dow === zNight.dow) || null;
  const zFc = nightFc(zNight);
  const zItems = zNight.items.filter((x) => x.qty > 0).sort((a, b) => b.rev - a.rev);
  const zUnpriced = zNight.items.filter((x) => x.cost == null && x.qty > 0);
  const zUnpricedRev = zUnpriced.reduce((a, x) => a + x.rev, 0);
  const zCompare = zPrev ? [
    { name: "Net sales", ...pctDelta(zNight.rev, zPrev.rev) },
    { name: "Covers", ...pctDelta(zNight.qty, zPrev.qty) },
    { name: "Food cost", ...ptsDelta(zFc, nightFc(zPrev)) },
  ] : [];

  if (isMobile) {
    const mobileKpis = [
      { label: "Net sales", value: money0(rev), color: "var(--text)" },
      { label: "Plates", value: num(qty), color: "var(--text)" },
      { label: "Food cost", value: foodCost == null ? "—" : pct1(foodCost), color: foodCost == null ? "var(--faint)" : foodCost > targetFoodCost ? "var(--red)" : "var(--text)" },
      { label: "Margin", value: contribution == null ? "—" : money0(contribution), color: contribution == null ? "var(--faint)" : "var(--accent-deep)" },
    ];
    return (
      <Shell theme={theme}>
        <MobileHeader theme={theme} onToggleTheme={toggleTheme} onSearch={onSearch} onSignOut={onSignOut} restaurantName={restaurantName} NavLink={NavLink} user={user} logoSrc={logoSrc} logoDarkSrc={logoDarkSrc} />
        <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--line)" }}>
          <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: "-0.03em" }}>Analytics</div>
          <div style={{ fontFamily: MONO, fontSize: 11.5, letterSpacing: "0.08em", color: "var(--faint)", marginTop: 3 }}>
            {syncStamp || `${posSystem} · ${span} nights`}
          </div>
        </div>
        <div style={{ flex: 1, padding: 16, display: "flex", flexDirection: "column", gap: 12, background: "var(--panel)" }}>
          <div style={{ background: "var(--shell)", border: "1px solid var(--line)", borderRadius: 12, padding: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {mobileKpis.map((k) => (
              <div key={k.label}>
                <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--faint)" }}>{k.label}</div>
                <div style={{ fontSize: 19, fontWeight: 800, letterSpacing: "-0.035em", fontVariantNumeric: "tabular-nums", marginTop: 4, color: k.color }}>{k.value}</div>
              </div>
            ))}
          </div>
          <div style={{ background: "var(--shell)", border: "1px solid var(--line)", borderRadius: 12, padding: 14 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, letterSpacing: "-0.02em" }}>Top sellers</div>
            <div style={{ display: "flex", flexDirection: "column", marginTop: 8 }}>
              {perDish.slice().sort((a, b) => b.qty - a.qty).slice(0, 5).map((d) => (
                <div key={d.name} style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, padding: "9px 0", borderBottom: "1px dotted var(--line)" }}>
                  <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{d.name}</span>
                  <span style={{ display: "flex", alignItems: "baseline", gap: 10, flexShrink: 0, fontFamily: MONO, fontSize: 11.5, fontVariantNumeric: "tabular-nums" }}>
                    <span style={{ color: "var(--faint)" }}>{num(d.qty)}</span>
                    <span style={{ color: "var(--text)", fontWeight: 500 }}>{money0(d.rev)}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <MobileNav active="analytics" NavLink={NavLink} />
      </Shell>
    );
  }

  const pill = (activeFlag) => ({
    border: "none", cursor: "pointer", fontFamily: MONO, fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase",
    borderRadius: 14, padding: "6px 10px", whiteSpace: "nowrap",
    background: activeFlag ? "var(--accent-tint)" : "transparent", color: activeFlag ? "var(--accent-deep)" : "var(--faint)",
  });
  const group = { display: "flex", alignItems: "center", gap: 2, background: "var(--panel)", border: "1px solid var(--line-soft)", borderRadius: 16, padding: 3, flexShrink: 0 };
  const cardStyle = { background: "var(--shell)", border: "1px solid var(--line)", borderRadius: 12, boxShadow: "var(--card-lift)", display: "flex", flexDirection: "column", overflow: "hidden" };
  const kicker = { fontFamily: MONO, fontSize: 10.5, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--faint)" };
  const axisText = { fontFamily: MONO, fontSize: 10, color: "var(--faint)", whiteSpace: "nowrap" };
  const th = (align, pad = "0 8px") => ({ textAlign: align, padding: pad, height: 30, fontFamily: MONO, fontSize: 9.5, fontWeight: 500, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--faint)", position: "sticky", top: 0, background: "var(--panel)", zIndex: 1, whiteSpace: "nowrap" });
  const td = { padding: "6px 8px", textAlign: "right", fontFamily: MONO, fontSize: 12, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };
  const zRow = { display: "flex", justifyContent: "space-between", gap: 10 };
  const zRule = { borderTop: "1px dashed var(--ink-faint)", flexShrink: 0 };
  const zLabel = { fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--ink-soft)", flexShrink: 0 };

  const kpiCards = [
    { label: "Net sales", value: money0(rev), color: "var(--text)", delta: salesD, note: priorNote },
    { label: "Covers sold", value: num(qty), color: "var(--text)", delta: qtyD, note: `${num(qty / (span || 1))} a night on average` },
    { label: "Food cost", value: foodCost == null ? "—" : pct1(foodCost), color: fcColor(foodCost), delta: fcD, bar: true },
    { label: "Gross margin", value: contribution == null ? "—" : money0(contribution), color: contribution == null ? "var(--faint)" : "var(--text)", delta: gmD, note: costedRev ? `on ${Math.round(costedShare * 100)}% of sales that are costed` : "awaiting pricing" },
  ];

  return (
    <Shell theme={theme} style={{ height: "100vh", overflow: "hidden" }}>
      {chrome}
      <div style={{ padding: `16px ${PAGE_PAD} 18px`, display: "flex", flexDirection: "column", gap: 13, background: "var(--panel)", flex: 1, minHeight: 0, overflow: "hidden" }}>

        {/* ── title row ── */}
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 20, flexWrap: "wrap", flexShrink: 0 }}>
          <div>
            <div style={{ fontFamily: MONO, fontSize: 11.5, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--faint)", marginBottom: 5 }}>{syncStamp || `${restaurantName} · ${posSystem}`}</div>
            <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-0.035em", lineHeight: 1.1 }}>
              Sales &amp; food cost <span style={{ color: "var(--faint)" }}>· last {span} nights</span>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 2, background: "var(--shell)", border: "1px solid var(--line)", borderRadius: 20, padding: 3 }}>
              {[["7d", "7 nights"], ["14d", "14 nights"], ["28d", "28 nights"]].map(([r, label]) => (
                <button key={r} type="button" onClick={() => { setRange(r); setHoverIdx(null); }} style={{ ...pill(range === r), padding: "7px 11px", fontSize: 10.5, borderRadius: 16 }}>{label}</button>
              ))}
            </div>
            <button type="button" onClick={onUpload} style={{ background: "var(--accent)", color: "#fff", border: "none", borderRadius: 20, padding: "8px 16px", cursor: "pointer", fontFamily: SANS, fontSize: 12.5, fontWeight: 700, whiteSpace: "nowrap", boxShadow: "0 8px 18px rgba(2,164,186,0.22)" }}>Upload POS export</button>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.5fr) minmax(0,1.25fr) minmax(260px,0.8fr)", gap: 14, flex: 1, minHeight: 0 }}>

          {/* ── left: 2 × 2 totals over the nightly chart ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14, minHeight: 0 }}>
            <div data-tour="an-kpis" style={{ flexShrink: 0, display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 12 }}>
              {kpiCards.map((k) => (
                <div key={k.label} style={{ ...cardStyle, padding: "13px 16px", gap: 7 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                    <span style={kicker}>{k.label}</span>
                    {k.bar && <span style={{ fontFamily: MONO, fontSize: 10.5, color: "var(--faint)", whiteSpace: "nowrap" }}>TARGET {targetFoodCost}%</span>}
                  </div>
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.035em", fontVariantNumeric: "tabular-nums", lineHeight: 1, color: k.color }}>{k.value}</span>
                    <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 500, whiteSpace: "nowrap", color: k.delta.color }}>{k.delta.label}</span>
                  </div>
                  {k.bar ? (
                    <div style={{ position: "relative", height: 5, background: "var(--line-soft)", borderRadius: 3, margin: "4px 0 3px" }}>
                      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: Math.min(100, ((foodCost || 0) / 50) * 100) + "%", background: k.color, borderRadius: 3 }} />
                      <div style={{ position: "absolute", top: -3, width: 2, height: 11, background: "var(--text)", left: Math.min(100, (targetFoodCost / 50) * 100) + "%" }} />
                    </div>
                  ) : (
                    <div style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{k.note}</div>
                  )}
                </div>
              ))}
            </div>

            <div data-tour="an-trend" style={{ ...cardStyle, flex: 1, minHeight: 0, padding: "14px 18px 12px", gap: 10, animation: "om-rise .4s cubic-bezier(.25,.8,.35,1) both" }}>
              <div style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: "-0.02em" }}>Night by night</div>
                <div style={group}>
                  {[["rev", "Net sales"], ["qty", "Covers"], ["fc", "Food cost %"]].map(([k, label]) => (
                    <button key={k} type="button" onClick={() => { setTrendMetric(k); setHoverIdx(null); }} style={pill(trendMetric === k)}>{label}</button>
                  ))}
                </div>
              </div>

              <div style={{ flexShrink: 0, display: "flex", flexWrap: "wrap", gap: "4px 16px", alignItems: "baseline", padding: "7px 10px", background: "var(--paper)", border: "1px dashed var(--paper-line)", borderRadius: 8, fontFamily: MONO, fontSize: 11, color: "var(--ink-soft)" }}>
                <span style={{ fontWeight: 500, color: "var(--ink)", textTransform: "uppercase", letterSpacing: "0.08em" }}>{DAY_NAMES[readDay.dow]} {readDay.label}</span>
                <span>{money0(readDay.rev)} net</span>
                <span>{num(readDay.qty)} covers</span>
                <span>food cost <span style={{ fontWeight: 500, color: readFc != null && readFc > targetFoodCost ? "var(--red)" : "var(--ink)" }}>{readFc == null ? "—" : pct1(readFc)}</span></span>
              </div>

              <div onMouseLeave={() => setHoverIdx(null)} style={{ flex: 1, minHeight: 100, position: "relative" }}>
                <div style={{ position: "absolute", left: 0, top: 0, bottom: 18, width: 38 }}>
                  <span style={{ ...axisText, position: "absolute", right: 6, top: -6 }}>{fmtAxis(chartMax)}</span>
                  <span style={{ ...axisText, position: "absolute", right: 6, top: "calc(50% - 6px)" }}>{fmtAxis(chartMax / 2)}</span>
                </div>
                <div style={{ position: "absolute", left: 42, right: 0, top: 0, bottom: 18 }}>
                  <div style={{ position: "absolute", left: 0, right: 0, top: 0, borderTop: "1px solid var(--line-soft)" }} />
                  <div style={{ position: "absolute", left: 0, right: 0, top: "50%", borderTop: "1px solid var(--line-soft)" }} />
                  <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, borderTop: "1px solid var(--line)" }} />
                  <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "flex-end", gap: barGap }}>
                    {bars.map((b, i) => (
                      <div key={b.key} onMouseEnter={() => setHoverIdx(i)} style={{ flex: "1 1 0", height: "100%", display: "flex", alignItems: "flex-end", cursor: "pointer" }}>
                        <div style={{ width: "100%", height: b.h + "%", background: b.color, opacity: hoverIdx == null || hoverIdx === i ? 1 : 0.4, borderRadius: "3px 3px 0 0", transition: "opacity .15s" }} />
                      </div>
                    ))}
                  </div>
                  {trendMetric === "fc" && (
                    <>
                      <div style={{ position: "absolute", left: 0, right: 0, top: targetTop + "%", borderTop: "2px dashed var(--text)", pointerEvents: "none" }} />
                      <div style={{ position: "absolute", right: 0, top: `calc(${targetTop}% - 16px)`, fontFamily: MONO, fontSize: 10, color: "var(--text)", background: "var(--shell)", padding: "0 4px", pointerEvents: "none" }}>TARGET {targetFoodCost}%</div>
                    </>
                  )}
                </div>
                <div style={{ position: "absolute", left: 42, right: 0, bottom: 0, height: 14, display: "flex", gap: barGap }}>
                  {bars.map((b) => (
                    <div key={"x" + b.key} style={{ flex: "1 1 0", textAlign: "center", fontFamily: MONO, fontSize: 10, color: "var(--faint)", whiteSpace: "nowrap" }}>{b.x}</div>
                  ))}
                </div>
              </div>

              <div style={{ flexShrink: 0, display: "flex", flexWrap: "wrap", gap: 14, fontSize: 11.5, color: "var(--muted)" }}>
                {legend.map(([c, t]) => (
                  <span key={t} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 9, height: 9, borderRadius: 2, background: c }} />{t}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* ── middle: dish performance ── */}
          <div data-tour="an-matrix" style={{ ...cardStyle, minHeight: 0, animation: "om-rise .5s cubic-bezier(.25,.8,.35,1) both" }}>
            <div style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "14px 16px 12px", flexWrap: "wrap" }}>
              <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: "-0.02em" }}>Dish performance</div>
              <div style={group}>
                {[["margin", "Margin"], ["qty", "Sold"], ["fc", "Food cost"]].map(([k, label]) => (
                  <button key={k} type="button" onClick={() => setSortBy(k)} style={pill(sortBy === k)}>{label}</button>
                ))}
              </div>
            </div>
            <div style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", fontSize: 12.5 }}>
                <colgroup>
                  <col style={{ width: "36%" }} />
                  <col style={{ width: "11%" }} />
                  <col style={{ width: "15%" }} />
                  <col style={{ width: "14%" }} />
                  <col style={{ width: "24%" }} />
                </colgroup>
                <thead>
                  <tr>
                    <th style={th("left", "0 8px 0 16px")}>Dish</th>
                    <th style={th("right")}>Sold</th>
                    <th style={th("right")}>Food cost</th>
                    <th style={th("right")}>Margin</th>
                    <th style={th("right", "0 16px 0 8px")}>Class</th>
                  </tr>
                </thead>
                <tbody>
                  {dishRows.map((d) => {
                    const qc = d.quad ? QUAD_COLOR[d.quad] : "var(--faint)";
                    const over = d.foodCostPct != null && d.foodCostPct > targetFoodCost;
                    return (
                      <tr key={d.name} className="om-row" onClick={() => onSelectDish && onSelectDish(d)} style={{ borderTop: "1px solid var(--line-soft)", cursor: onSelectDish ? "pointer" : "default" }}>
                        <td style={{ padding: "6px 8px 6px 16px", overflow: "hidden" }}>
                          <div style={{ fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{d.name}</div>
                          <div style={{ fontSize: 11, color: "var(--faint)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginTop: 1 }}>
                            {[d.cat, money2(d.price), money0(d.rev) + " sales"].filter(Boolean).join(" · ")}
                          </div>
                        </td>
                        <td style={td}>{num(d.qty)}</td>
                        <td style={{ ...td, color: d.foodCostPct == null ? "var(--faint)" : over ? "var(--red)" : "var(--text)", fontWeight: over ? 700 : 400 }}>{d.foodCostPct == null ? "no price" : pct1(d.foodCostPct)}</td>
                        <td style={{ ...td, fontWeight: 500, color: d.contribTotal == null ? "var(--faint)" : "var(--text)" }}>{d.contribTotal == null ? "—" : money0(d.contribTotal)}</td>
                        <td style={{ ...td, padding: "6px 16px 6px 8px", fontFamily: SANS }}>
                          <span style={{ display: "inline-block", padding: "3px 9px", borderRadius: 20, fontSize: 11, fontWeight: 700, color: qc, background: d.quad ? `color-mix(in srgb, ${qc} 14%, var(--shell))` : "var(--panel)" }}>{d.quad || "Unpriced"}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ flexShrink: 0, display: "flex", flexWrap: "wrap", gap: "4px 14px", padding: "9px 16px", borderTop: "1px solid var(--line)", background: "var(--panel)", fontSize: 11, color: "var(--muted)" }}>
              <span><strong style={{ color: QUAD_COLOR.Star }}>Star</strong> sells often, keeps a lot</span>
              <span><strong style={{ color: QUAD_COLOR.Plowhorse }}>Plowhorse</strong> sells often, keeps less</span>
              <span><strong style={{ color: QUAD_COLOR.Puzzle }}>Puzzle</strong> keeps a lot, sells slowly</span>
              <span><strong style={{ color: QUAD_COLOR.Dog }}>Dog</strong> slow and thin</span>
            </div>
          </div>

          {/* ── right: close-out ticket for the last service night ── */}
          <div aria-label="Last night close-out" style={{ minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column", gap: 10, background: "var(--paper)", color: "var(--ink)", fontFamily: MONO, border: "1px solid var(--paper-line)", borderRadius: 12, boxShadow: "var(--card-lift)", padding: "16px 18px", animation: "om-print .45s cubic-bezier(.25,.8,.35,1) both" }}>
            <div style={{ textAlign: "center", display: "flex", flexDirection: "column", gap: 3, flexShrink: 0 }}>
              <div style={zLabel}>Close-out · Z report</div>
              <div style={{ fontFamily: SANS, fontSize: 17, fontWeight: 800, letterSpacing: "-0.02em" }}>{DAY_FULL[zNight.dow]} {zNight.label}</div>
              <div style={{ fontSize: 10, color: "var(--ink-soft)" }}>LAST SERVICE NIGHT</div>
            </div>
            <div style={zRule} />
            <div style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 11.5, flexShrink: 0 }}>
              <div style={zRow}><span>COVERS SOLD</span><span>{num(zNight.qty)}</span></div>
              <div style={zRow}><span>NET SALES</span><span>{money0(zNight.rev)}</span></div>
              <div style={{ ...zRow, color: "var(--ink-soft)" }}><span>COSTED SALES</span><span>{money0(zNight.costedRev)}</span></div>
              <div style={{ ...zRow, color: "var(--ink-soft)" }}><span>PLATE COST</span><span>{money0(zNight.cogs)}</span></div>
            </div>
            <div style={zRule} />
            <div style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 11.5, fontWeight: 500, flexShrink: 0 }}>
              <div style={zRow}><span>FOOD COST</span><span style={{ color: zFc != null && zFc > targetFoodCost ? "var(--red)" : "var(--ink)" }}>{zFc == null ? "—" : pct1(zFc)}</span></div>
              <div style={zRow}><span>GROSS MARGIN</span><span>{zNight.costedRev ? money0(zNight.costedRev - zNight.cogs) : "—"}</span></div>
            </div>
            {zPrev && (
              <>
                <div style={zRule} />
                <div style={zLabel}>VS LAST {DAY_NAMES[zPrev.dow].toUpperCase()} · {zPrev.label}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 11.5, flexShrink: 0 }}>
                  {zCompare.map((c) => (
                    <div key={c.name} style={zRow}><span>{c.name.toUpperCase()}</span><span style={{ color: c.color }}>{c.label}</span></div>
                  ))}
                </div>
              </>
            )}
            <div style={zRule} />
            <div style={zLabel}>Items sold</div>
            <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 5, fontSize: 11.5 }}>
              {zItems.map((x) => (
                <div key={x.name} style={{ display: "flex", gap: 8 }}>
                  <span style={{ width: 28, flexShrink: 0, color: "var(--ink-soft)" }}>{num(x.qty)}×</span>
                  <span style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{x.name}</span>
                  <span style={{ flexShrink: 0 }}>{money0(x.rev)}</span>
                </div>
              ))}
            </div>
            <div style={zRule} />
            <div style={{ flexShrink: 0, fontSize: 10.5, lineHeight: 1.45, color: "var(--ink-soft)" }}>
              * {zUnpriced.length
                ? `${money0(zUnpricedRev)} from ${zUnpriced.map((x) => x.name).join(", ")} left out of food cost until priced.`
                : "Every dish sold was fully costed."}
            </div>
          </div>

        </div>
      </div>
    </Shell>
  );
}