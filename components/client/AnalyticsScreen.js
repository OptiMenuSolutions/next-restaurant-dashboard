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
      cost: Number(x.cost) || 0,
      rev: x.rev != null ? Number(x.rev) : (Number(x.qty) || 0) * (Number(x.price) || 0),
      cogs: x.cogs != null ? Number(x.cogs) : (Number(x.qty) || 0) * (Number(x.cost) || 0),
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
  const [range, setRange] = useState("14d");
  const [trendMetric, setTrendMetric] = useState("rev");
  const [rhythmView, setRhythmView] = useState("day");
  const [openHour, setOpenHour] = useState(null);
  const [moversTab, setMoversTab] = useState("top");
  const [moversMetric, setMoversMetric] = useState("qty");
  const [selected, setSelected] = useState(null);
  const [matrixHover, setMatrixHover] = useState(null);
  const [hoverIdx, setHoverIdx] = useState(null);

  const days = useMemo(() => normalise(daysProp || DEMO_DAYS), [daysProp]);

  const chrome = (
    <Header active="analytics" NavLink={NavLink} user={user} theme={theme} onToggleTheme={toggleTheme} logoSrc={logoSrc} logoDarkSrc={logoDarkSrc} />
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

  /* ── win + KPIs ─────────────────────────────────────────────────── */
  const span = range === "7d" ? Math.min(7, days.length) : range === "14d" ? Math.min(14, days.length) : range === "30d" ? Math.min(30, days.length) : days.length;
  const win = days.slice(-span);
  const prior = days.slice(Math.max(0, days.length - span * 2), days.length - span);
  const sum = (arr, k) => arr.reduce((a, x) => a + x[k], 0);
  const rev = sum(win, "rev"), cogs = sum(win, "cogs"), qty = sum(win, "qty");
  const pRev = sum(prior, "rev"), pQty = sum(prior, "qty");
  const contribution = rev - cogs;
  const foodCost = rev ? (cogs / rev) * 100 : 0;

  const deltaLabel = (now, was) => (was ? (now >= was ? "+" : "−") + Math.abs(((now - was) / was) * 100).toFixed(1) + "%" : "—");
  const deltaColor = (now, was) => (!was ? "var(--faint)" : now > was * 1.01 ? "var(--green)" : now < was * 0.99 ? "var(--red)" : "var(--faint)");

  const kpis = [
    { label: "Net sales", value: moneyK1(rev), color: "var(--text)", delta: deltaLabel(rev, pRev), deltaColor: deltaColor(rev, pRev) },
    { label: "Plates sold", value: num(qty), color: "var(--text)", delta: deltaLabel(qty, pQty), deltaColor: deltaColor(qty, pQty) },
    { label: "Food cost", value: pct1(foodCost), color: foodCost > targetFoodCost ? "var(--red)" : "var(--text)", delta: "", deltaColor: "var(--faint)" },
    { label: "Gross margin", value: moneyK1(contribution), color: "var(--accent-deep)", delta: "", deltaColor: "var(--faint)" },
    { label: "Nights read", value: num(span), color: "var(--text)", delta: "", deltaColor: "var(--faint)" },
  ];

  /* ── trend ─────────────────────────────────────────────────────────── */
  const vals = win.map((d) => (trendMetric === "rev" ? d.rev : d.qty));
  const max = Math.max(...vals), min = Math.min(...vals);
  const hi = max + (max - min) * 0.28, lo = Math.max(0, min - (max - min) * 0.35);
  const avg = vals.reduce((a, v) => a + v, 0) / vals.length;
  const VB_W = 120, VB_H = 50, X0 = 1.5, X1 = 118.5, Y0 = 3, Y1 = 47;
  const px = (i) => X0 + (i / (vals.length - 1 || 1)) * (X1 - X0);
  const py = (v) => Y1 - ((v - lo) / (hi - lo || 1)) * (Y1 - Y0);
  const fmtV = (v) => (trendMetric === "rev" ? moneyK(v) : num(v));
  const colW = 100 / vals.length;
  const dotAt = (i, size) => {
    const d = win[i];
    const v = trendMetric === "rev" ? d.rev : d.qty;
    return { leftPct: ((px(i) / VB_W) * 100).toFixed(3) + "%", topPct: ((py(v) / VB_H) * 100).toFixed(3) + "%", size };
  };
  const dots0 = [hoverIdx != null && win[hoverIdx] ? dotAt(hoverIdx, 11) : dotAt(vals.length - 1, 9)];
  const stepW = (X1 - X0) / (vals.length - 1 || 1);
  const weekends = win.map((d, i) => (d.weekend ? { x: (px(i) - stepW / 2).toFixed(2), w: stepW.toFixed(2) } : null)).filter(Boolean);
  const linePath = win.map((d, i) => (i ? "L" : "M") + px(i).toFixed(2) + " " + py(trendMetric === "rev" ? d.rev : d.qty).toFixed(2)).join(" ");
  const areaPath = `${linePath} L${px(vals.length - 1).toFixed(2)} ${Y1} L${px(0).toFixed(2)} ${Y1} Z`;
  const gridLines = [0.88, 0.5, 0.12].map((f) => {
    const v = lo + (hi - lo) * f;
    return { y: py(v).toFixed(2), topPct: ((py(v) / VB_H) * 100).toFixed(2) + "%", label: fmtV(v) };
  });
  const xIdxs = [0, Math.floor((vals.length - 1) / 2), vals.length - 1].filter((v, i, a) => a.indexOf(v) === i);
  const hDay = hoverIdx != null && win[hoverIdx] ? win[hoverIdx] : null;

  /* ── rhythm ────────────────────────────────────────────────────────── */
  const byDow = DAY_NAMES.map((label, i) => {
    const set = win.filter((d) => d.dow === i);
    const nights = set.length || 1;
    return { label, rev: sum(set, "rev") / nights, nights: set.length };
  });
  const dowMax = Math.max(...byDow.map((d) => d.rev), 1);
  const peakDow = byDow.slice().sort((a, b) => b.rev - a.rev)[0];

  const hourRows = (hourly || []).filter((h) => Number(h.qty) > 0);
  const hourMax = Math.max(...hourRows.map((h) => Number(h.qty)), 1);
  const hourLabel = (h) => (h === 12 ? "12p" : h > 12 ? h - 12 + "p" : h + "a");
  const hourTotal = hourRows.reduce((a, h) => a + Number(h.qty), 0);
  const openRow = hourRows.find((h) => h.hour === openHour);
  const busiest = hourRows.slice().sort((a, b) => b.qty - a.qty)[0];
  const hourNote = openRow
    ? `${hourLabel(openRow.hour)} · ${num(openRow.qty / span)} plates a night · ${Math.round((openRow.qty / (hourTotal || 1)) * 100)}% of the day`
    : busiest ? `Peak ${hourLabel(busiest.hour)} · tap an hour` : "No hour-level data in this export";

  /* ── menu engineering ──────────────────────────────────────────────── */
  const perDish = (() => {
    const map = new Map();
    win.forEach((d) => d.items.forEach((x) => {
      const e = map.get(x.name) || { name: x.name, cat: x.category || x.cat || "", price: x.price, cost: x.cost, qty: 0, rev: 0, cogs: 0 };
      e.qty += x.qty; e.rev += x.rev; e.cogs += x.cogs;
      e.price = x.price || e.price; e.cost = x.cost || e.cost;
      map.set(x.name, e);
    }));
    return [...map.values()].map((d) => ({
      ...d,
      contribPer: d.price - d.cost,
      contribTotal: d.qty * (d.price - d.cost),
      marginPct: d.price ? ((d.price - d.cost) / d.price) * 100 : 0,
    }));
  })();

  const medOf = (arr) => {
    const s = arr.slice().sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const medQty = medOf(perDish.map((d) => d.qty));
  const medContrib = medOf(perDish.map((d) => d.contribPer));
  const qMin = Math.min(...perDish.map((d) => d.qty)), qMax = Math.max(...perDish.map((d) => d.qty));
  const cMin = Math.min(...perDish.map((d) => d.contribPer)), cMax = Math.max(...perDish.map((d) => d.contribPer));
  const xOf = (q) => 11 + ((q - qMin) / (qMax - qMin || 1)) * 76;
  const yOf = (c) => 87 - ((c - cMin) / (cMax - cMin || 1)) * 74;
  perDish.forEach((d) => {
    d.quad = d.qty >= medQty ? (d.contribPer >= medContrib ? "Star" : "Plowhorse") : d.contribPer >= medContrib ? "Puzzle" : "Dog";
  });

  const hasSelection = !!selected && perDish.some((d) => d.name === selected);
  const sel = perDish.find((d) => d.name === selected) || perDish[0];
  const weeks = span / 7;
  const verdicts = sel && {
    Star: `Sells hard and earns hard. ${money0(sel.contribTotal / weeks)} of margin a week — hold the recipe and the price where they are.`,
    Plowhorse: `Popular and thin. A dollar on the price is ${money0(sel.qty / weeks)} a week at this volume, and nobody counts a dollar on a plate they already order.`,
    Puzzle: `Earns ${money2(sel.contribPer)} a plate and only sells ${num(sel.qty / weeks)} a week. Worth a push from the pass tonight.`,
    Dog: `Low volume, low earn — ${money0(sel.contribTotal / weeks)} a week of margin for a line on the menu and space in the walk-in.`,
  };

  /* ── movers ────────────────────────────────────────────────────────── */
  const last7 = days.slice(-7), prev7 = days.slice(-14, -7);
  const qtyIn = (set, name) => set.reduce((a, d) => a + (d.items.find((x) => x.name === name)?.qty || 0), 0);
  const changes = perDish.map((d) => {
    const c = qtyIn(last7, d.name), p = qtyIn(prev7, d.name);
    return { name: d.name, curr: c, prev: p, change: p ? ((c - p) / p) * 100 : 0 };
  });

  let moverRows;
  if (moversTab === "top") {
    const sorted = perDish.slice().sort((a, b) => (moversMetric === "qty" ? b.qty - a.qty : b.rev - a.rev));
    const top = sorted.length ? (moversMetric === "qty" ? sorted[0].qty : sorted[0].rev) : 1;
    moverRows = sorted.map((d, i) => ({
      key: d.name, rank: String(i + 1), name: d.name, sub: [d.cat, money2(d.contribPer) + " margin"].filter(Boolean).join(" · "),
      barWidth: (((moversMetric === "qty" ? d.qty : d.rev) / (top || 1)) * 100).toFixed(1) + "%",
      barColor: "var(--accent)",
      value: moversMetric === "qty" ? num(d.qty) : money0(d.rev),
      valColor: "var(--accent-deep)",
      dish: d,
    }));
  } else {
    const dir = moversTab === "rising" ? 1 : -1;
    const color = moversTab === "rising" ? "var(--green)" : "var(--red)";
    moverRows = changes.filter((c) => c.change * dir > 2).sort((a, b) => (b.change - a.change) * dir).map((c, i) => ({
      key: c.name, rank: String(i + 1), name: c.name, sub: `${c.prev} → ${c.curr} plates`,
      barWidth: Math.min(100, Math.abs(c.change) * 2.2).toFixed(1) + "%",
      barColor: color,
      value: (c.change > 0 ? "▲ " : "▼ ") + Math.abs(c.change).toFixed(0) + "%",
      valColor: color,
      dish: perDish.find((d) => d.name === c.name),
    }));
  }
  const puzzles = perDish.filter((d) => d.quad === "Puzzle");
  const footNote = moversTab === "top" ? `Ranked over ${span} nights` : "Last 7 nights vs the 7 before";
  const footValue = moversTab === "top"
    ? (puzzles.length ? `${puzzles.length} puzzles to push` : "No puzzles on the menu")
    : `${moverRows.length} item${moverRows.length === 1 ? "" : "s"}`;

  const pickDish = (d) => { setSelected(d && d.name === selected ? null : d && d.name); if (d && onSelectDish) onSelectDish(d); };

  if (isMobile) {
    const mobileKpis = [
      { label: "Net sales", value: money0(rev), color: "var(--text)" },
      { label: "Plates", value: num(qty), color: "var(--text)" },
      { label: "Food cost", value: pct1(foodCost), color: foodCost > targetFoodCost ? "var(--red)" : "var(--text)" },
      { label: "Margin", value: money0(contribution), color: "var(--accent-deep)" },
    ];
    return (
      <Shell theme={theme}>
        <MobileHeader theme={theme} onToggleTheme={toggleTheme} user={user} logoSrc={logoSrc} logoDarkSrc={logoDarkSrc} />
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

  return (
    <Shell theme={theme} style={{ height: "100vh", overflow: "hidden" }}>
      {chrome}
      <div style={{ padding: `16px ${PAGE_PAD} 18px`, display: "flex", flexDirection: "column", gap: 13, background: "var(--panel)", flex: 1, minHeight: 0, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 20, flexWrap: "wrap", flexShrink: 0 }}>
          <div>
            <div style={{ fontFamily: MONO, fontSize: 11.5, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--faint)", marginBottom: 5 }}>{restaurantName} · POS sales</div>
            <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-0.035em", lineHeight: 1.1 }}>
              What sold <span style={{ color: "var(--faint)" }}>· and what it earned</span>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 2, background: "var(--shell)", border: "1px solid var(--line)", borderRadius: 20, padding: 3 }}>
              {["7d", "14d", "30d", "All"].map((r) => (
                <button key={r} type="button" onClick={() => { setRange(r); setHoverIdx(null); }} style={{ ...pill(range === r), padding: "7px 11px", fontSize: 10.5, borderRadius: 16 }}>{r}</button>
              ))}
            </div>
            <button type="button" onClick={onUpload} style={{ background: "var(--accent)", color: "#fff", border: "none", borderRadius: 20, padding: "8px 16px", cursor: "pointer", fontFamily: SANS, fontSize: 12.5, fontWeight: 700, whiteSpace: "nowrap", boxShadow: "0 8px 18px rgba(2,164,186,0.22)" }}>Upload POS export</button>
          </div>
        </div>

        <div data-tour="an-kpis" style={{ flexShrink: 0, background: "var(--shell)", border: "1px solid var(--line)", borderRadius: 12, boxShadow: "var(--card-lift)", display: "grid", gridTemplateColumns: "repeat(5,1fr)", overflow: "hidden" }}>
          {kpis.map((k) => (
            <div key={k.label} style={{ padding: "18px 20px 19px", borderLeft: "1px solid var(--line-soft)", display: "flex", flexDirection: "column", gap: 9, minWidth: 0 }}>
              <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--faint)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{k.label}</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
                <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums", lineHeight: 1, color: k.color }}>{k.value}</span>
                <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 500, whiteSpace: "nowrap", color: k.deltaColor }}>{k.delta}</span>
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.22fr) minmax(0,1fr)", gap: 14, flex: 1, minHeight: 0 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14, minHeight: 0 }}>
            <div data-tour="an-trend" style={{ ...cardStyle, flex: "1.35 1 0", minHeight: 0, animation: "om-rise .4s cubic-bezier(.25,.8,.35,1) both" }}>
              <div style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "14px 18px 0" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: "-0.02em" }}>{trendMetric === "rev" ? "Nightly sales" : "Plates a night"}</div>
                  <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: "0.08em", color: "var(--faint)", marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{span} nights · weekends shaded</div>
                </div>
                <div style={group}>
                  {[["rev", "Sales"], ["qty", "Plates"]].map(([k, label]) => (
                    <button key={k} type="button" onClick={() => setTrendMetric(k)} style={pill(trendMetric === k)}>{label}</button>
                  ))}
                </div>
              </div>
              <div style={{ flex: 1, minHeight: 0, padding: "16px 20px 32px 46px", display: "flex", flexDirection: "column" }}>
                <div onMouseLeave={() => setHoverIdx(null)} style={{ position: "relative", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
                  <svg viewBox="0 0 120 50" preserveAspectRatio="none" style={{ width: "100%", height: "100%", minHeight: 0, display: "block", overflow: "visible" }}>
                    {weekends.map((w, i) => (<rect key={i} x={w.x} y="2" width={w.w} height="46" fill="var(--amber)" opacity="0.055" />))}
                    {gridLines.map((g, i) => (<line key={i} x1="0" y1={g.y} x2="120" y2={g.y} stroke="var(--line-soft)" strokeWidth="1" vectorEffect="non-scaling-stroke" />))}
                    <path d={areaPath} fill="var(--accent-tint)" stroke="none" />
                    <path d={linePath} fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                    <line x1="0" y1={py(avg).toFixed(2)} x2="120" y2={py(avg).toFixed(2)} stroke="var(--faint)" strokeWidth="1" strokeDasharray="2 5" vectorEffect="non-scaling-stroke" />
                  </svg>
                  {gridLines.map((g, i) => (
                    <div key={"g" + i} style={{ position: "absolute", right: "100%", marginRight: 9, top: g.topPct, transform: "translateY(-50%)", fontFamily: MONO, fontSize: 11, color: "var(--faint)", whiteSpace: "nowrap" }}>{g.label}</div>
                  ))}
                  <div style={{ position: "absolute", right: 0, top: ((py(avg) / VB_H) * 100).toFixed(2) + "%", transform: "translateY(-135%)", fontFamily: MONO, fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--faint)", whiteSpace: "nowrap" }}>Avg {fmtV(avg)}</div>
                  {dots0.map((p, i) => (
                    <div key={"d" + i} style={{ position: "absolute", left: p.leftPct, top: p.topPct, width: p.size, height: p.size, marginLeft: -p.size / 2, marginTop: -p.size / 2, borderRadius: "50%", background: "var(--shell)", border: "2.2px solid var(--accent)", pointerEvents: "none" }} />
                  ))}
                  {win.map((d, i) => (
                    <div key={"c" + i} onMouseEnter={() => setHoverIdx(i)} style={{ position: "absolute", left: (i * colW).toFixed(3) + "%", top: -8, bottom: -24, width: colW.toFixed(3) + "%", cursor: "crosshair" }} />
                  ))}
                  {xIdxs.map((i) => (
                    <div key={"x" + i} style={{ position: "absolute", top: "100%", marginTop: 7, left: ((px(i) / VB_W) * 100).toFixed(3) + "%", transform: "translateX(-50%)", fontFamily: MONO, fontSize: 10.5, whiteSpace: "nowrap", color: "var(--faint)" }}>{win[i].label}</div>
                  ))}
                  {hDay && (
                    <div style={{ position: "absolute", left: ((px(hoverIdx) / VB_W) * 100).toFixed(3) + "%", top: ((py(trendMetric === "rev" ? hDay.rev : hDay.qty) / VB_H) * 100).toFixed(3) + "%", transform: `translate(${hoverIdx > vals.length * 0.7 ? "-92%" : "-8%"},-118%)`, background: "var(--shell)", border: "1px solid var(--line)", borderRadius: 9, boxShadow: "var(--shadow)", padding: "8px 11px", pointerEvents: "none", whiteSpace: "nowrap", zIndex: 3 }}>
                      <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums", color: "var(--accent-deep)" }}>
                        {trendMetric === "rev" ? money0(hDay.rev) : num(hDay.qty) + " plates"}
                      </div>
                      <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: "0.06em", color: "var(--faint)", marginTop: 3 }}>
                        {hDay.label} · {DAY_FULL[hDay.dow]}{hDay.weekend ? " · service night" : ""}{hDay.rev ? " · " + pct1((hDay.cogs / hDay.rev) * 100) + " food cost" : ""}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div style={{ ...cardStyle, flex: "1 1 0", minHeight: 0, animation: "om-rise .45s cubic-bezier(.25,.8,.35,1) both" }}>
              <div style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "14px 18px 0" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: "-0.02em" }}>Service rhythm</div>
                  <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: "0.08em", color: "var(--faint)", marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {rhythmView === "day" ? `${peakDow.label} carries the week · ${moneyK(peakDow.rev)} a night` : `Plates by hour across ${span} nights`}
                  </div>
                </div>
                {hourRows.length > 0 && (
                  <div style={group}>
                    {[["day", "By night"], ["hour", "By hour"]].map(([k, label]) => (
                      <button key={k} type="button" onClick={() => setRhythmView(k)} style={pill(rhythmView === k)}>{label}</button>
                    ))}
                  </div>
                )}
              </div>

              {rhythmView === "day" || !hourRows.length ? (
                <div style={{ flex: 1, minHeight: 0, padding: "12px 18px 14px", display: "flex", alignItems: "stretch", gap: 10 }}>
                  {byDow.map((d) => {
                    const peak = d.label === peakDow.label;
                    return (
                      <div key={d.label} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                        <span style={{ fontFamily: MONO, fontSize: 11, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", color: peak ? "var(--amber)" : "var(--muted)" }}>{d.nights ? moneyK(d.rev) : "—"}</span>
                        <div style={{ flex: 1, minHeight: 0, width: "100%", display: "flex", alignItems: "flex-end", background: "var(--panel)", borderRadius: 5, overflow: "hidden" }}>
                          <div style={{ width: "100%", height: d.nights ? Math.max(4, (d.rev / dowMax) * 100).toFixed(1) + "%" : "0%", borderRadius: "5px 5px 0 0", background: peak ? "var(--amber)" : "color-mix(in srgb, var(--accent) 55%, var(--panel))" }} />
                        </div>
                        <span style={{ fontSize: 11.5, fontWeight: 600, color: peak ? "var(--amber)" : "var(--faint)" }}>{d.label}</span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={{ flex: 1, minHeight: 0, padding: "12px 18px 14px", display: "flex", flexDirection: "column", gap: 9 }}>
                  <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "stretch", gap: 4 }}>
                    {hourRows.map((h) => {
                      const t = Number(h.qty) / hourMax;
                      const base = t > 0.72 ? "var(--red)" : t > 0.45 ? "var(--amber)" : t > 0.15 ? "var(--accent)" : "var(--panel)";
                      const isOpen = openHour === h.hour;
                      return (
                        <button key={h.hour} type="button" onClick={() => setOpenHour(isOpen ? null : h.hour)}
                          style={{ flex: 1, minWidth: 0, border: `1px solid ${isOpen ? "var(--accent)" : "var(--line-soft)"}`, borderRadius: 5, background: `color-mix(in srgb, ${base} ${Math.round(28 + t * 72)}%, var(--shell))`, display: "flex", alignItems: "flex-end", justifyContent: "center", paddingBottom: 4, cursor: "pointer" }}>
                          <span style={{ fontFamily: MONO, fontSize: 9.5, color: t > 0.45 ? "var(--text)" : "var(--faint)" }}>{hourLabel(h.hour)}</span>
                        </button>
                      );
                    })}
                  </div>
                  <div style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", fontFamily: MONO, fontSize: 10.5, letterSpacing: "0.06em", color: "var(--faint)" }}>
                    <span>{hourNote}</span>
                    <span style={{ display: "flex", alignItems: "center", gap: 11 }}>
                      {[["Peak", "var(--red)"], ["Busy", "var(--amber)"], ["Steady", "var(--accent)"], ["Quiet", "var(--panel)"]].map(([label, fill]) => (
                        <span key={label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                          <span style={{ width: 7, height: 7, borderRadius: 2, background: fill }} />{label}
                        </span>
                      ))}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 14, minHeight: 0 }}>
            <div data-tour="an-matrix" style={{ ...cardStyle, flex: hasSelection ? "1 1 0" : "1.15 1 0", minHeight: 0, animation: "om-rise .5s cubic-bezier(.25,.8,.35,1) both" }}>
              <div style={{ flexShrink: 0, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, padding: "14px 18px 0" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: "-0.02em" }}>Menu engineering</div>
                  <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: "0.08em", color: "var(--faint)", marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>Plates sold against margin per plate</div>
                </div>
                {hasSelection ? (
                  <button type="button" onClick={() => { setSelected(null); setMatrixHover(null); }} className="om-hover-accent" style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "1px solid var(--line)", borderRadius: 16, padding: "5px 11px", cursor: "pointer", fontFamily: MONO, fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--accent-deep)", whiteSpace: "nowrap", flexShrink: 0 }}>
                    <span style={{ fontSize: 13, lineHeight: 1 }}>‹</span>All dishes
                  </button>
                ) : (
                  <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--faint)", whiteSpace: "nowrap", flexShrink: 0 }}>{span} nights</span>
                )}
              </div>

              <div style={{ flex: 1, minHeight: 0, padding: "16px 22px 26px 40px" }}>
                <div style={{ position: "relative", width: "100%", height: "100%", minHeight: 0, borderLeft: "1px solid var(--line)", borderBottom: "1px solid var(--line)" }}>
                  <div style={{ position: "absolute", left: xOf(medQty).toFixed(2) + "%", top: 0, bottom: 0, width: 1, borderLeft: "1px dashed var(--line)" }} />
                  <div style={{ position: "absolute", top: yOf(medContrib).toFixed(2) + "%", left: 0, right: 0, height: 1, borderTop: "1px dashed var(--line)" }} />
                  {[
                    { label: "Puzzles", left: "4%", top: "5%", shift: "0,0" },
                    { label: "Stars", left: "96%", top: "5%", shift: "-100%,0" },
                    { label: "Dogs", left: "4%", top: "95%", shift: "0,-100%" },
                    { label: "Plowhorses", left: "96%", top: "95%", shift: "-100%,-100%" },
                  ].map((q) => (
                    <span key={q.label} style={{ position: "absolute", left: q.left, top: q.top, transform: `translate(${q.shift})`, fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--faint)", opacity: 0.75, whiteSpace: "nowrap" }}>{q.label}</span>
                  ))}
                  {perDish.map((d) => {
                    const on = hasSelection && d.name === sel.name;
                    const lit = on || matrixHover === d.name;
                    const right = xOf(d.qty) > 62;
                    const size = on ? 13 : lit ? 11 : 9;
                    return (
                      <div key={d.name} onClick={() => pickDish(d)} onMouseEnter={() => setMatrixHover(d.name)} onMouseLeave={() => setMatrixHover(null)} title={d.name}
                        style={{ position: "absolute", left: xOf(d.qty).toFixed(2) + "%", top: yOf(d.contribPer).toFixed(2) + "%", transform: `translate(${lit ? (right ? "-100%" : "0%") : "-50%"},-50%)`, display: "flex", flexDirection: lit && right ? "row-reverse" : "row", alignItems: "center", gap: lit ? 5 : 0, cursor: "pointer", zIndex: on ? 5 : lit ? 4 : 2 }}>
                        <span style={{ width: size, height: size, borderRadius: "50%", background: lit ? "var(--accent)" : "color-mix(in srgb, var(--accent) 34%, var(--shell))", border: `2px solid ${lit ? "var(--accent-deep)" : "var(--accent)"}`, flexShrink: 0 }} />
                        <span style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.02em", whiteSpace: "nowrap", color: on ? "var(--text)" : "var(--muted)", fontWeight: 600 }}>{lit ? d.name.split(",")[0] : ""}</span>
                      </div>
                    );
                  })}
                  <div style={{ position: "absolute", left: -11, top: "50%", transform: "translate(-100%,-50%) rotate(-90deg)", transformOrigin: "center", fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--faint)", whiteSpace: "nowrap" }}>Margin / plate</div>
                  <div style={{ position: "absolute", left: "50%", top: "100%", marginTop: 6, transform: "translateX(-50%)", fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--faint)", whiteSpace: "nowrap" }}>Plates sold</div>
                </div>
              </div>

              {hasSelection && (
                <div style={{ flexShrink: 0, borderTop: "1px solid var(--line)", background: "var(--panel)", padding: "12px 18px 14px", display: "flex", flexDirection: "column", gap: 9 }}>
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 700, letterSpacing: "-0.02em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sel.name}</span>
                    <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", padding: "3px 8px", borderRadius: 12, flexShrink: 0, color: QUAD_COLOR[sel.quad], border: `1px solid ${QUAD_COLOR[sel.quad]}` }}>{sel.quad}</span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10 }}>
                    {[
                      { label: "Plates sold", value: num(sel.qty), color: "var(--text)" },
                      { label: "Net sales", value: money0(sel.rev), color: "var(--text)" },
                      { label: "Margin / plate", value: money2(sel.contribPer), color: "var(--accent-deep)" },
                      { label: "Total margin", value: money0(sel.contribTotal), color: "var(--text)" },
                    ].map((s) => (
                      <div key={s.label} style={{ minWidth: 0 }}>
                        <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--faint)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.label}</div>
                        <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums", marginTop: 4, color: s.color }}>{s.value}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ fontSize: 12.5, lineHeight: 1.5, color: "var(--muted)", textWrap: "pretty", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{verdicts[sel.quad]}</div>
                </div>
              )}
            </div>

            {!hasSelection && (
              <div style={{ ...cardStyle, flex: "1 1 0", minHeight: 0, animation: "om-rise .55s cubic-bezier(.25,.8,.35,1) both" }}>
                <div style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "13px 18px 0", flexWrap: "wrap" }}>
                  <div style={group}>
                    {[["top", "Top sellers"], ["rising", "Rising"], ["falling", "Falling"]].map(([k, label]) => (
                      <button key={k} type="button" onClick={() => setMoversTab(k)}
                        style={{ border: "none", cursor: "pointer", fontFamily: SANS, fontSize: 12, fontWeight: 600, borderRadius: 14, padding: "6px 11px", whiteSpace: "nowrap", background: moversTab === k ? "var(--accent)" : "transparent", color: moversTab === k ? "#fff" : "var(--muted)" }}>
                        {label}
                      </button>
                    ))}
                  </div>
                  {moversTab === "top" && (
                    <div style={group}>
                      {[["qty", "Plates"], ["rev", "Sales"]].map(([k, label]) => (
                        <button key={k} type="button" onClick={() => setMoversMetric(k)} style={pill(moversMetric === k)}>{label}</button>
                      ))}
                    </div>
                  )}
                </div>
                <div style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", padding: "8px 18px 12px" }}>
                  {moverRows.map((r) => (
                    <div key={r.key} onClick={() => r.dish && pickDish(r.dish)} style={{ display: "grid", gridTemplateColumns: "16px minmax(0,1fr) minmax(0,1.1fr) 58px", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px dotted var(--line)", cursor: "pointer" }}>
                      <span style={{ fontFamily: MONO, fontSize: 10.5, color: "var(--faint)", textAlign: "right" }}>{r.rank}</span>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.name}</div>
                        <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.06em", color: "var(--faint)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.sub}</div>
                      </div>
                      <div style={{ height: 7, background: "var(--panel)", borderRadius: 4, overflow: "hidden" }}>
                        <div style={{ height: 7, borderRadius: 4, width: r.barWidth, background: r.barColor }} />
                      </div>
                      <div style={{ fontSize: 12.5, fontWeight: 700, fontVariantNumeric: "tabular-nums", textAlign: "right", whiteSpace: "nowrap", color: r.valColor }}>{r.value}</div>
                    </div>
                  ))}
                </div>
                <div style={{ flexShrink: 0, borderTop: "1px solid var(--line)", padding: "10px 18px 11px", fontFamily: MONO, fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--faint)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <span>{footNote}</span>
                  <span style={{ color: "var(--muted)" }}>{footValue}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </Shell>
  );
}
