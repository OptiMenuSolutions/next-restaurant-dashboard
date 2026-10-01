import React from "react";
import Head from "next/head";
import { MONO } from "./ClientChrome";

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
 * Expects MenuItemsScreen's decorated, priced dishes (price, cost, costThen,
 * margin, drift, covers = sold in the last 30 days, category, components).
 * tgt is the target margin %.
 */

const PAPER = "#fffdf8";
const INK = "#1f2426";
const SOFT = "#6b7275";
const FADED = "#c9c4bb";
const RED = "#c4473e";
const HAND_RED = "#b8433b";
const HAND_TEAL = "#2c8c99";
const SERIF = "Georgia, 'Times New Roman', serif";
const HAND = "'Caveat', cursive";
const HIGHLIGHT = {
  yellow: "linear-gradient(transparent 55%, rgba(255,214,0,0.55) 55%, rgba(255,214,0,0.55) 92%, transparent 92%)",
  teal: "linear-gradient(transparent 55%, rgba(2,164,186,0.30) 55%, rgba(2,164,186,0.30) 92%, transparent 92%)",
  pink: "linear-gradient(transparent 55%, rgba(236,120,140,0.38) 55%, rgba(236,120,140,0.38) 92%, transparent 92%)",
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
  const ings = (d.components || []).flatMap((c) => c.ingredients || []);
  const moves = ings
    .map((i) => ({ name: i.name, cost: Number(i.cost) || 0, then: Number(i.costThen != null ? i.costThen : i.cost) || 0 }))
    .map((m) => ({ ...m, up: m.cost - m.then }))
    .filter((m) => m.up > 0);
  const total = moves.reduce((a, m) => a + m.up, 0);
  if (!total) return null;
  const top = moves.sort((a, b) => b.up - a.up)[0];
  if (top.up / total < 0.6 || !top.then) return { label: `Plate cost up ${money2(total)}`, ingredient: null };
  const short = String(top.name).split(",")[0].trim();
  return { label: `${short} cost up ${pct1((top.up / top.then) * 100)}`, ingredient: short.toLowerCase() };
}

function analyze(data, tgt) {
  const priced = data.filter((d) => d.price > 0 && !d.awaiting);
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

  const pricing = hasSales
    ? priced
        .filter((d) => d.covers >= popBar && d.covers > 0 && d.margin < tgt && tgt < 100)
        .map((d) => {
          const needed = d.cost / (1 - tgt / 100);
          return { d, raise: Math.max(0.25, Math.ceil((needed - d.price) * 4) / 4) };
        })
        .sort((a, b) => b.d.covers - a.d.covers)
    : [];

  const gems = hasSales
    ? priced
        .filter((d) => d.margin >= tgt && d.covers < popBar)
        .sort((a, b) => b.margin - a.margin)
    : [];

  const flagged = new Set([...pressure.map((x) => x.d.id), ...pricing.map((x) => x.d.id), ...gems.map((d) => d.id)]);
  return { hasSales, drivers, pressure, pricing, gems, flagged: flagged.size };
}

function Quadrant({ title, sub, empty, children, isEmpty }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontFamily: SERIF, fontSize: 15, letterSpacing: "0.12em", textTransform: "uppercase", color: FADED, paddingBottom: 6, borderBottom: `1px solid ${FADED}` }}>{title}</div>
      <div style={{ fontFamily: MONO, fontSize: 10.5, color: SOFT, margin: "9px 0 6px" }}>{sub}</div>
      {isEmpty ? (
        <div style={{ fontFamily: MONO, fontSize: 10.5, color: FADED, padding: "8px 0" }}>{empty}</div>
      ) : (
        children
      )}
    </div>
  );
}

function Row({ d, mark, right, rightStyle, meta, onPick, circled, underline }) {
  return (
    <button
      type="button"
      onClick={() => onPick && onPick(d)}
      style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", padding: "6px 0 7px", cursor: "pointer", color: INK }}
    >
      <span style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
        <span style={{ fontFamily: SERIF, fontSize: 15, lineHeight: 1.25, padding: "0 2px", margin: "0 -2px", background: mark ? HIGHLIGHT[mark] : "none", minWidth: 0 }}>{d.name}</span>
        <span style={{ position: "relative", flexShrink: 0, fontFamily: MONO, fontSize: 11.5, whiteSpace: "nowrap", ...(rightStyle || {}) }}>
          {right}
          {circled && <span style={{ position: "absolute", left: -8, right: -8, top: -5, bottom: -5, border: `1.8px solid ${RED}`, borderRadius: "50%", transform: "rotate(-3deg)", pointerEvents: "none" }} />}
          {underline && <span style={{ position: "absolute", left: -2, right: -2, bottom: -3, borderTop: `1.8px solid ${RED}`, transform: "rotate(-1.5deg)" }} />}
        </span>
      </span>
      <span style={{ display: "block", fontFamily: MONO, fontSize: 10.5, color: SOFT, marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{meta}</span>
    </button>
  );
}

function Hand({ children, color, style }) {
  return (
    <span style={{ position: "absolute", fontFamily: HAND, fontSize: 17, fontWeight: 600, lineHeight: 1, color, pointerEvents: "none", whiteSpace: "nowrap", ...style }}>
      {children}
    </span>
  );
}

export default function MenuAnalysis({ data = [], tgt = 70, restaurantName = "", onPick }) {
  if (!data.length) {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", padding: "32px 28px", gap: 10 }}>
        <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-0.035em" }}>Your recipes are in</div>
        <div style={{ fontSize: 13.5, color: "var(--muted)", lineHeight: 1.6, maxWidth: 420 }}>
          The menu analysis appears here as soon as your ingredient prices come in from your invoices.
        </div>
      </div>
    );
  }

  const a = analyze(data, tgt);
  const noSales = "Needs POS sales";
  const topPricing = a.pricing[0];
  const watch = topPricing ? costDriver(topPricing.d)?.ingredient : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <Head>
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Caveat:wght@500;600;700&display=swap" />
      </Head>

      <div style={{ padding: "16px 22px 12px", flexShrink: 0 }}>
        <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--accent-deep)", marginBottom: 5 }}>The menu</div>
        <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.03em" }}>Menu analysis</div>
        <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 3 }}>Tonight's costs and the last 30 days of sales.</div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", background: "var(--panel)", padding: "30px 46px 34px", borderTop: "1px solid var(--line)" }}>
        <div style={{ position: "relative", maxWidth: 660, margin: "0 auto", background: PAPER, border: "1px solid #e1ddd4", boxShadow: "0 2px 4px rgba(17,24,25,0.05), 0 14px 30px rgba(17,24,25,0.10)", padding: "42px 42px 40px", color: INK }}>
          <div style={{ position: "absolute", left: "50%", top: -12, transform: "translateX(-50%)", width: 92, height: 24, background: "#2f3a3d", borderRadius: 4 }}>
            <div style={{ position: "absolute", left: "50%", top: 10, transform: "translateX(-50%)", width: 46, height: 3, background: "#8e9a9d", borderRadius: 2 }} />
          </div>

          <div style={{ textAlign: "center" }}>
            <div style={{ fontFamily: SERIF, fontSize: 21, letterSpacing: "0.2em", textTransform: "uppercase" }}>{restaurantName}</div>
            <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", color: SOFT, marginTop: 9 }}>Menu analysis · manager's copy</div>
          </div>
          <div style={{ borderTop: `1.5px solid ${INK}`, margin: "16px 0 22px" }} />

          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "26px 38px" }}>
            <Quadrant title="Profit drivers" sub="Highest weekly contribution" isEmpty={!a.drivers.length} empty={a.hasSales ? "Nothing yet" : noSales}>
              {a.drivers.slice(0, 3).map((x, i) => (
                <Row
                  key={x.d.id}
                  d={x.d}
                  mark={i === 1 ? "teal" : null}
                  right={`${money0(x.weekly)}/wk`}
                  meta={`${x.d.category || "Menu"} · ${pct1(x.d.margin)} margin · ${x.d.covers} sold`}
                  onPick={onPick}
                />
              ))}
            </Quadrant>

            <div style={{ position: "relative" }}>
              <Quadrant title="Cost pressure" sub="Largest plate-cost increases" isEmpty={!a.pressure.length} empty="No margin drops this month">
                {a.pressure.slice(0, 3).map((x, i) => (
                  <Row
                    key={x.d.id}
                    d={x.d}
                    mark={i === 0 ? "yellow" : null}
                    underline={i === 0}
                    right={`↓ ${Math.abs(x.d.drift).toFixed(1)} pts`}
                    rightStyle={{ color: RED }}
                    meta={x.driver ? x.driver.label : "Plate cost rising"}
                    onPick={onPick}
                  />
                ))}
              </Quadrant>
              {a.pressure.length > 1 && a.pricing.length > 0 && (
                <Hand color={HAND_RED} style={{ right: -40, top: 150, transform: "rotate(-6deg)" }}>pricing gap</Hand>
              )}
            </div>

            <div style={{ position: "relative" }}>
              <Quadrant title="Pricing opportunities" sub="Popular dishes below target" isEmpty={!a.pricing.length} empty={a.hasSales ? "Every popular dish is on target" : noSales}>
                {a.pricing.slice(0, 3).map((x, i) => (
                  <Row
                    key={x.d.id}
                    d={x.d}
                    mark={i === 0 ? "pink" : null}
                    circled={i === 0}
                    right={`+${money2(x.raise)}`}
                    rightStyle={{ color: i === 0 ? RED : INK }}
                    meta={`${pct1(x.d.margin)} margin · ${x.d.covers} sold`}
                    onPick={onPick}
                  />
                ))}
              </Quadrant>
              {watch && (
                <Hand color="#b07a1a" style={{ left: -72, top: 78, transform: "rotate(-8deg)", whiteSpace: "normal", width: 70 }}>watch {watch}</Hand>
              )}
            </div>

            <div style={{ position: "relative" }}>
              <Quadrant title="Hidden gems" sub="Strong margin, lower sales" isEmpty={!a.gems.length} empty={a.hasSales ? "Nothing hiding" : noSales}>
                {a.gems.slice(0, 3).map((d, i) => (
                  <Row
                    key={d.id}
                    d={d}
                    mark={i === 1 ? "teal" : null}
                    right={pct1(d.margin)}
                    meta={`${d.covers} sold · ${d.category || "Menu"}`}
                    onPick={onPick}
                  />
                ))}
              </Quadrant>
            </div>
          </div>

          {a.flagged > 0 && (
            <div style={{ position: "absolute", right: 30, bottom: 18, transform: "rotate(-3deg)" }}>
              <div style={{ padding: "6px 12px", border: `1.5px solid ${HAND_TEAL}`, fontFamily: MONO, fontSize: 10.5, letterSpacing: "0.14em", color: HAND_TEAL, background: "rgba(255,253,248,0.85)" }}>
                {a.flagged} DISH{a.flagged === 1 ? "" : "ES"} FLAGGED
              </div>
              {a.gems.length > 0 && <Hand color={HAND_TEAL} style={{ right: 4, top: -22, transform: "rotate(4deg)" }}>promote this</Hand>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}