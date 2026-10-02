import React, { useEffect, useRef, useState } from "react";
import Head from "next/head";
import { MONO, SANS } from "./ClientChrome";

/**
 * MenuAnalysis — the Menu Items page's right-hand card when no dish is
 * selected: a printed "manager's copy" of the menu analysis, marked up by hand.
 *
 *   Profit drivers         highest weekly contribution: (price - cost) x sold
 *   Cost pressure          largest margin drops since last month (points),
 *                          with the ingredient behind the rise
 *   Pricing opportunities  popular dishes below target, with the raise that
 *                          reaches target (rounded up to the next $0.25)
 *   Hidden gems            target margin or better, below-median sales
 *
 * Every quadrant always shows 3 dishes, and no dish appears twice on the
 * sheet. When there are not enough dishes with the numbers a quadrant needs
 * (no prices or no POS sales yet), the rest are filled with other dishes from
 * the menu, spread across sections, shown with their menu price and what they
 * are waiting on. Marks and handwritten notes only go on real, measured rows.
 *
 * Expects MenuItemsScreen's decorated dishes (all of them, priced or not):
 * id, name, category, price, cost, margin, drift, covers (sold, last 30
 * days), awaiting, components. tgt is the target margin %.
 */

const PER = 3;
// The sheet is laid out at this width, then scaled to fit the card exactly.
const SHEET_W = 700;
const PAPER = "#fffefa";
const INK = "#141a1b";
const TEXT = "#1f2426";
const SOFT = "#6b7275";
const FAINT = "#a3aaac";
const RED = "#c4473e";
const NOTE_RED = "#b8433b";
const NOTE_AMBER = "#b07a1a";
const NOTE_TEAL = "#2c8c99";
const HAND = "'Caveat', cursive";
const HIGHLIGHT = {
  teal: "linear-gradient(transparent 58%, rgba(2,164,186,0.32) 58%, rgba(2,164,186,0.32) 94%, transparent 94%)",
  yellow: "linear-gradient(transparent 58%, rgba(255,214,0,0.55) 58%, rgba(255,214,0,0.55) 94%, transparent 94%)",
  pink: "linear-gradient(transparent 58%, rgba(236,120,140,0.40) 58%, rgba(236,120,140,0.40) 94%, transparent 94%)",
};

const money0 = (n) => "$" + Math.round(n).toLocaleString("en-US");
const money2 = (n) => "$" + (Number(n) || 0).toFixed(2);
const pct1 = (n) => `${(Math.round(n * 10) / 10).toFixed(1)}%`;

function median(values) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// The ingredient behind most of a dish's cost increase, if one stands out.
function costDriver(d) {
  const moves = (d.components || [])
    .flatMap((c) => c.ingredients || [])
    .map((i) => {
      const cost = Number(i.cost) || 0;
      const then = Number(i.costThen != null ? i.costThen : i.cost) || 0;
      return { name: i.name, then, up: cost - then };
    })
    .filter((m) => m.up > 0);
  const total = moves.reduce((a, m) => a + m.up, 0);
  if (!total) return null;
  const top = moves.sort((a, b) => b.up - a.up)[0];
  if (top.up / total < 0.6 || !top.then) return { label: `Plate cost up ${money2(total)}`, ingredient: null };
  const short = String(top.name).split(",")[0].trim();
  return { label: `${short} cost up ${pct1((top.up / top.then) * 100)}`, ingredient: short.toLowerCase() };
}

function analyze(dishes, tgt) {
  const priced = dishes.filter((d) => d.price > 0 && !d.awaiting);
  const hasSales = priced.some((d) => d.covers > 0);
  const popBar = median(priced.map((d) => d.covers));

  const drivers = hasSales
    ? priced
        .map((d) => ({ d, weekly: ((d.price - d.cost) * d.covers * 7) / 30 }))
        .filter((x) => x.weekly > 0)
        .sort((a, b) => b.weekly - a.weekly)
    : [];
  const pressure = priced
    .filter((d) => d.drift <= -0.5)
    .sort((a, b) => a.drift - b.drift)
    .map((d) => ({ d, driver: costDriver(d) }));
  const pricing = hasSales && tgt < 100
    ? priced
        .filter((d) => d.covers > 0 && d.covers >= popBar && d.margin < tgt)
        .map((d) => ({ d, raise: Math.max(0.25, Math.ceil((d.cost / (1 - tgt / 100) - d.price) * 4) / 4) }))
        .sort((a, b) => b.d.covers - a.d.covers)
    : [];
  const gems = hasSales
    ? priced.filter((d) => d.margin >= tgt && d.covers < popBar).sort((a, b) => b.margin - a.margin)
    : [];

  const flagged = new Set([...pressure.map((x) => x.d.id), ...pricing.map((x) => x.d.id), ...gems.map((d) => d.id)]).size;
  return { drivers, pressure, pricing, gems, flagged };
}

// Keeps every dish to one appearance on the sheet, and hands out filler
// dishes round-robin across menu sections so the sheet shows a spread.
function makePicker(dishes) {
  const bySection = new Map();
  for (const d of dishes) {
    const k = d.category || "Menu";
    bySection.set(k, [...(bySection.get(k) || []), d]);
  }
  const queues = [...bySection.values()];
  const used = new Set();
  return {
    // Up to PER measured rows from a ranked list, skipping dishes already shown.
    real(list, getDish) {
      const out = [];
      for (const x of list) {
        if (out.length === PER) break;
        const d = getDish(x);
        if (used.has(d.id)) continue;
        used.add(d.id);
        out.push(x);
      }
      return out;
    },
    // Unused dishes to bring a quadrant up to PER rows.
    fill(have) {
      const out = [];
      while (out.length < PER - have) {
        let found = null;
        for (let pass = 0; pass < queues.length && !found; pass++) {
          const q = queues.shift();
          queues.push(q);
          const d = q.find((x) => !used.has(x.id));
          if (d) found = d;
        }
        if (!found) break;
        used.add(found.id);
        out.push(found);
      }
      return out;
    },
  };
}

function Row({ d, mark, right, rightColor, meta, circled, underline, onPick }) {
  return (
    <button
      type="button"
      onClick={() => onPick && onPick(d)}
      style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", padding: "5px 0 6px", cursor: "pointer", color: TEXT, fontFamily: SANS }}
    >
      <span style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
        <span style={{ fontSize: 14.5, fontWeight: 600, letterSpacing: "-0.01em", lineHeight: 1.3, padding: "0 2px", margin: "0 -2px", background: mark ? HIGHLIGHT[mark] : "none", minWidth: 0 }}>{d.name}</span>
        <span style={{ position: "relative", flexShrink: 0, fontFamily: MONO, fontSize: 12, whiteSpace: "nowrap", color: rightColor || TEXT, padding: circled ? "0 4px" : 0 }}>
          {right}
          {circled && <span style={{ position: "absolute", left: -9, right: -9, top: -7, bottom: -6, border: `1.8px solid ${RED}`, borderRadius: "50%", transform: "rotate(-3deg)", pointerEvents: "none" }} />}
          {underline && <span style={{ position: "absolute", left: -16, right: -3, bottom: -4, borderTop: `1.8px solid ${RED}`, transform: "rotate(-1deg)", pointerEvents: "none" }} />}
        </span>
      </span>
      <span style={{ display: "block", fontFamily: MONO, fontSize: 11, color: SOFT, marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{meta}</span>
    </button>
  );
}

function FillerRow({ d, why, onPick }) {
  return (
    <Row
      d={d}
      right={d.price > 0 ? money2(d.price) : "—"}
      rightColor={FAINT}
      meta={`${d.category || "Menu"} · ${d.awaiting ? "waiting on prices" : why}`}
      onPick={onPick}
    />
  );
}

function Quadrant({ title, sub, children }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontFamily: SANS, fontSize: 12.5, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: INK, paddingBottom: 8, borderBottom: `1.5px solid ${INK}` }}>{title}</div>
      <div style={{ fontFamily: MONO, fontSize: 11, color: SOFT, margin: "10px 0 6px" }}>{sub}</div>
      {children}
    </div>
  );
}

function Note({ color, align = "left", tilt, children }) {
  return (
    <div style={{ fontFamily: HAND, fontSize: 18, fontWeight: 600, lineHeight: 1.1, color, textAlign: align, margin: align === "right" ? "2px 6px 0 0" : "2px 0 0 4px", transform: `rotate(${tilt})`, pointerEvents: "none" }}>
      {children}
    </div>
  );
}

export default function MenuAnalysis({ dishes = [], tgt = 70, restaurantName = "", onPick }) {
  // Scale the whole sheet so it always fits the card: no scrolling, any screen.
  const fitRef = useRef(null);
  const sheetRef = useRef(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const box = fitRef.current;
    const sheet = sheetRef.current;
    if (!box || !sheet) return;
    const fit = () => {
      const s = Math.min(box.clientWidth / sheet.offsetWidth, box.clientHeight / sheet.offsetHeight);
      if (isFinite(s) && s > 0) setScale(Math.min(1.15, s));
    };
    fit();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(fit) : null;
    if (ro) { ro.observe(box); ro.observe(sheet); }
    return () => ro && ro.disconnect();
  }, [dishes]);

  if (!dishes.length) {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", padding: "32px 28px", gap: 10 }}>
        <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-0.035em" }}>Your menu analysis lives here</div>
        <div style={{ fontSize: 13.5, color: "var(--muted)", lineHeight: 1.6, maxWidth: 420 }}>
          Upload your menu and it fills in, then sharpens as invoice prices and POS sales come in.
        </div>
      </div>
    );
  }

  const a = analyze(dishes, tgt);
  const pick = makePicker(dishes);

  // Measured rows first, in this order, so each dish lands in the quadrant it
  // matters most to; fillers come after, from whatever is left.
  const pressure = pick.real(a.pressure, (x) => x.d);
  const pricing = pick.real(a.pricing, (x) => x.d);
  const drivers = pick.real(a.drivers, (x) => x.d);
  const gems = pick.real(a.gems, (d) => d);
  const driverFill = pick.fill(drivers.length);
  const pressureFill = pick.fill(pressure.length);
  const pricingFill = pick.fill(pricing.length);
  const gemFill = pick.fill(gems.length);

  const watch = pricing[0] ? costDriver(pricing[0].d)?.ingredient : null;
  const showPricingGap = pressure.length > 1 && pricing.length > 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <Head>
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Caveat:wght@500;600;700&display=swap" />
      </Head>

      <div ref={fitRef} style={{ flex: 1, minHeight: 0, position: "relative", overflow: "hidden", background: PAPER }}>
        <div style={{ position: "absolute", left: "50%", top: 0, transform: "translateX(-50%)", width: 92, height: 22, background: "#323c3f", borderRadius: "0 0 5px 5px", boxShadow: "0 2px 4px rgba(17,24,25,0.25)", zIndex: 1 }}>
          <div style={{ position: "absolute", left: "50%", top: 9, transform: "translateX(-50%)", width: 50, height: 3, background: "#8d999c", borderRadius: 2 }} />
        </div>
        <div ref={sheetRef} style={{ position: "absolute", top: 0, left: "50%", width: SHEET_W, boxSizing: "border-box", transform: `translateX(-50%) scale(${scale})`, transformOrigin: "top center", padding: "50px 46px 60px", color: TEXT, fontFamily: SANS }}>

          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: "0.2em", textTransform: "uppercase", color: INK }}>{restaurantName}</div>
            <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: "0.2em", textTransform: "uppercase", color: SOFT, marginTop: 10 }}>Menu analysis · manager's copy</div>
          </div>
          <div style={{ borderTop: "1.5px solid #2a2f31", margin: "18px 0 26px" }} />

          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "30px 38px" }}>
            <Quadrant title="Profit drivers" sub="Highest weekly contribution">
              {drivers.map((x, i) => (
                <Row key={x.d.id} d={x.d} mark={i === 1 ? "teal" : null} right={`${money0(x.weekly)}/wk`}
                  meta={`${x.d.category || "Menu"} · ${pct1(x.d.margin)} margin · ${x.d.covers} sold`} onPick={onPick} />
              ))}
              {driverFill.map((d) => <FillerRow key={d.id} d={d} why="waiting on sales" onPick={onPick} />)}
            </Quadrant>

            <Quadrant title="Cost pressure" sub="Largest plate-cost increases">
              {pressure.map((x, i) => (
                <Row key={x.d.id} d={x.d} mark={i === 0 ? "yellow" : null} underline={i === 0}
                  right={`↓ ${Math.abs(x.d.drift).toFixed(1)} pts`} rightColor={RED}
                  meta={x.driver ? x.driver.label : "Plate cost rising"} onPick={onPick} />
              ))}
              {pressureFill.map((d) => <FillerRow key={d.id} d={d} why="no cost change yet" onPick={onPick} />)}
              {showPricingGap && <Note color={NOTE_RED} align="right" tilt="-4deg">pricing gap</Note>}
            </Quadrant>

            <Quadrant title="Pricing opportunities" sub="Popular dishes below target">
              {pricing.map((x, i) => (
                <Row key={x.d.id} d={x.d} mark={i === 0 ? "pink" : null} circled={i === 0}
                  right={`+${money2(x.raise)}`} rightColor={i === 0 ? RED : TEXT}
                  meta={`${pct1(x.d.margin)} margin · ${x.d.covers} sold`} onPick={onPick} />
              ))}
              {pricingFill.map((d) => <FillerRow key={d.id} d={d} why="waiting on sales" onPick={onPick} />)}
              {watch && <Note color={NOTE_AMBER} tilt="-3deg">watch {watch}</Note>}
            </Quadrant>

            <Quadrant title="Hidden gems" sub="Strong margin, lower sales">
              {gems.map((d, i) => (
                <Row key={d.id} d={d} mark={i === 1 ? "teal" : null} right={pct1(d.margin)}
                  meta={`${d.covers} sold · ${d.category || "Menu"}`} onPick={onPick} />
              ))}
              {gemFill.map((d) => <FillerRow key={d.id} d={d} why="waiting on sales" onPick={onPick} />)}
            </Quadrant>
          </div>

          {a.flagged > 0 && (
            <div style={{ position: "absolute", right: 26, bottom: 16, transform: "rotate(-3deg)" }}>
              {gems.length > 0 && (
                <span style={{ position: "absolute", right: 2, top: -24, fontFamily: HAND, fontSize: 18, fontWeight: 600, color: NOTE_TEAL, transform: "rotate(3deg)", whiteSpace: "nowrap" }}>promote this</span>
              )}
              <div style={{ padding: "6px 13px", border: `1.5px solid ${NOTE_TEAL}`, fontFamily: MONO, fontSize: 10.5, letterSpacing: "0.16em", color: NOTE_TEAL, background: "rgba(255,254,250,0.9)" }}>
                {a.flagged} DISH{a.flagged === 1 ? "" : "ES"} FLAGGED
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}