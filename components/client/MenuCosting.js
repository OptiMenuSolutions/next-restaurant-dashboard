import React, { useMemo, useState } from "react";
import { MONO, SANS, money } from "./ClientChrome";

/**
 * MenuCosting — right side of the Menu items page when no dish is open.
 * Cost and price only (sales live on Analytics):
 *
 *   header           avg margin vs target · below target · dishes costed
 *   margin ladder    every costed dish on one margin scale, with a
 *                    Below target / All / Above target toggle that zooms the
 *                    scale; crowded spots stack 5 marks, then a +N chip
 *   two lists        below target (price for target) or, in Above view, most
 *                    room to spare · plate cost moves over the last 30 days
 *   finish costing   ingredients whose first invoice price would cost the
 *                    most waiting dishes (hidden once nothing is waiting)
 *
 * Props: dishes (decorated rows from MenuItemsScreen), tgt (target margin %),
 * onPick(dish), NavLink.
 */

const money2 = (n) => money(n, 2);
const pct1 = (m) => (Math.round(m * 10) / 10).toString().replace(/\.0$/, "") + "%";

/* Margin color: normal at or above target; below it, amber shading to red
   the further it falls (fully red 15 points under). Shared with the cards. */
export function marginColor(m, tgt) {
  if (m >= tgt) return "var(--text)";
  const r = Math.round(Math.min(100, ((tgt - m) / 20) * 100 + 25));
  return `color-mix(in srgb, var(--red) ${r}%, var(--amber))`;
}
const markColor = (m, tgt) => (m >= tgt ? "var(--accent)" : marginColor(m, tgt));

/* Price that reaches the target margin, rounded up to the next .95. */
function priceForTarget(cost, tgt) {
  const tp = cost / (1 - tgt / 100);
  let r = Math.ceil(tp) - 0.05;
  if (r < tp) r += 1;
  return { exact: tp, menu: r };
}

const CSS = `
.mc-mk{position:absolute;width:15px;height:15px;margin-left:-7.5px;border-radius:50%;border:2.5px solid var(--shell);cursor:pointer;z-index:1;transition:transform .12s}
.mc-mk:hover{transform:scale(1.25);z-index:3}
.mc-chip{position:absolute;transform:translateX(-50%);font-family:${MONO};font-size:9.5px;font-weight:500;color:var(--muted);background:var(--shell);border:1px solid var(--line);border-radius:9px;padding:0 5px;line-height:15px;cursor:default;z-index:2;white-space:nowrap}
.mc-chip:hover{border-color:var(--accent);color:var(--accent-deep);z-index:4}
.mc-tip{display:none;position:absolute;bottom:calc(100% + 9px);left:50%;transform:translateX(-50%);background:var(--shell);color:var(--text);border:1px solid var(--line);border-radius:8px;box-shadow:var(--card-lift);padding:7px 10px 8px;white-space:nowrap;text-align:left;pointer-events:none;font-family:${SANS}}
.mc-tip::after{content:"";position:absolute;top:100%;left:50%;margin-left:-5px;border:5px solid transparent;border-top-color:var(--shell)}
.mc-mk:hover .mc-tip,.mc-chip:hover .mc-tip{display:block}
.mc-mk:hover .mc-tip{transform:translateX(-50%) scale(.8);transform-origin:bottom center}
`;

const sectionHead = { display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, paddingBottom: 6, borderBottom: "1px solid var(--line)", flexShrink: 0 };
const hint = { fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.1em", color: "var(--faint)", whiteSpace: "nowrap" };

export default function MenuCosting({ dishes, tgt, onPick, NavLink }) {
  const priced = useMemo(
    () => (dishes || []).filter(
      (d) =>
        !d.awaiting &&
        !d.noRecipe &&
        d.cost != null &&
        Number.isFinite(d.cost) &&
        d.price > 0
    ),
    [dishes]
  );
  const waiting = useMemo(() => (dishes || []).filter((d) => d.awaiting), [dishes]);
  const below = useMemo(() => priced.filter((d) => d.margin < tgt).sort((a, b) => a.margin - b.margin), [priced, tgt]);
  const above = useMemo(() => priced.filter((d) => d.margin >= tgt).sort((a, b) => b.margin - a.margin), [priced, tgt]);

  const [picked, setPicked] = useState(null);
  const view = picked || (below.length ? "below" : "all");

  const avg = priced.length ? priced.reduce((a, d) => a + d.margin, 0) / priced.length : null;

  /* ── ladder geometry ── */
  const ladder = useMemo(() => {
    if (!priced.length) return null;
    const ms = priced.map((d) => d.margin);
    const minM = Math.min(...ms), maxM = Math.max(...ms);
    let lo, hi, set;
    if (view === "below") { lo = Math.floor(minM) - 1; hi = tgt; set = below; }
    else if (view === "above") { lo = tgt; hi = Math.ceil(maxM) + 1; set = above; }
    else { lo = Math.min(tgt - 20, Math.floor(minM) - 1); hi = Math.max(tgt + 20, Math.ceil(maxM) + 1); set = priced; }
    if (hi - lo < 4) { lo -= 2; hi += 2; }
    const X = (m) => ((m - lo) / (hi - lo)) * 100;

    // Columns ~2.5% wide; up to 5 marks stacked (worst on the bottom), then +N.
    const BIN = 2.5, MAX = 5;
    const bins = new Map();
    set.forEach((d) => {
      const k = Math.round(X(d.margin) / BIN);
      bins.set(k, [...(bins.get(k) || []), d]);
    });
    const marks = [], chips = [];
    bins.forEach((col, k) => {
      const x = Math.max(1.5, Math.min(98.5, k * BIN));
      col.sort((a, b) => a.margin - b.margin);
      col.slice(0, MAX).forEach((d, i) => marks.push({ d, x, y: 67.5 - i * 14 }));
      if (col.length > MAX) {
        const rest = col.slice(MAX);
        chips.push({ key: k, x, y: 67.5 - MAX * 14 - 2, rest });
      }
    });

    const faint = "color-mix(in srgb, #e8c25a 22%, var(--shell))";
    const teal = "color-mix(in srgb, var(--accent) 22%, var(--shell))";
    const tx = X(tgt);
    const track = view === "below"
      ? `linear-gradient(90deg, var(--red) 0%, ${faint} 100%)`
      : view === "above"
        ? teal
        : `linear-gradient(90deg, var(--red) 0%, ${faint} ${tx}%, ${teal} ${tx}% 100%)`;
    const step = hi - lo > 30 ? 10 : 5;
    const ticks = [];
    for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) ticks.push({ t, x: X(t) });
    return { marks, chips, track, ticks, tx };
  }, [priced, below, above, view, tgt]);

  /* ── lists ── */
  const moves = useMemo(
    () => priced.filter((d) => Math.abs(d.move30 || 0) > 0.005).sort((a, b) => b.move30 - a.move30),
    [priced]
  );
  const unlock = useMemo(() => {
    const counts = new Map();
    waiting.forEach((d) => {
      const names = new Set(d.components.flatMap((c) => c.ingredients).filter((i) => i.unpriced).map((i) => i.name));
      names.forEach((n) => counts.set(n, (counts.get(n) || 0) + 1));
    });
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [waiting]);

  const viewBtn = (id, label) => (
    <button
      key={id}
      type="button"
      onClick={() => setPicked(id)}
      style={{ border: "none", cursor: "pointer", fontFamily: SANS, fontSize: 11.5, fontWeight: 600, borderRadius: 16, padding: "4px 11px", whiteSpace: "nowrap", background: view === id ? "var(--accent-tint)" : "transparent", color: view === id ? "var(--accent-deep)" : "var(--muted)" }}
    >
      {label}
    </button>
  );

  const IngLink = ({ children, style }) =>
    NavLink ? <NavLink href="/client/ingredients" style={style}>{children}</NavLink> : <a href="/client/ingredients" style={style}>{children}</a>;

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <style>{CSS}</style>

      {/* header */}
      <div style={{ flexShrink: 0, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14, padding: "15px 20px 12px", borderBottom: "1px solid var(--line-soft)" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: "0.14em", color: "var(--accent-deep)" }}>MENU COSTING</div>
          <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: "-0.03em", marginTop: 3 }}>Is each price right?</div>
        </div>
        <div style={{ display: "flex", alignItems: "baseline" }}>
          {[
            { v: avg == null ? "—" : Math.round(avg) + "%", l: `Avg margin · target ${Math.round(tgt)}%`, c: avg != null && avg < tgt ? marginColor(avg, tgt) : "var(--text)" },
            { v: String(below.length), l: "Below target", c: below.length ? "var(--amber)" : "var(--text)" },
            { v: `${priced.length} / ${(dishes || []).length}`, l: "Dishes costed", c: "var(--text)" },
          ].map((k, i) => (
            <div key={k.l} style={{ paddingLeft: 14, marginLeft: 14, borderLeft: i ? "1px solid var(--line)" : "none", textAlign: "right" }}>
              <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums", color: k.c }}>{k.v}</div>
              <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--faint)", whiteSpace: "nowrap" }}>{k.l}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 16, padding: "14px 20px 14px", overflow: "hidden" }}>
        {!ladder ? (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", gap: 6 }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>No dish is fully costed yet</div>
            <div style={{ fontSize: 12.5, color: "var(--muted)", maxWidth: 360, lineHeight: 1.55 }}>
              A dish gets a margin once every ingredient in it has an invoice price. The ingredients below would cost the most dishes first.
            </div>
          </div>
        ) : (
          <>
            {/* margin ladder */}
            <div style={{ flexShrink: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 12.5, fontWeight: 700 }}>Margin ladder</span>
                <div style={{ display: "flex", alignItems: "center", gap: 2, background: "var(--shell)", border: "1px solid var(--line-soft)", borderRadius: 20, padding: 3 }}>
                  {viewBtn("below", `Below target · ${below.length}`)}
                  {viewBtn("all", `All · ${priced.length}`)}
                  {viewBtn("above", `Above target · ${above.length}`)}
                </div>
              </div>
              <div style={{ position: "relative", height: 104, margin: "12px 10px 0" }}>
                <div style={{ position: "absolute", left: 0, right: 0, top: 70, height: 10, borderRadius: 5, background: ladder.track }} />
                {view === "all" && (
                  <>
                    <div style={{ position: "absolute", left: ladder.tx + "%", top: 4, height: 88, borderLeft: "2px solid var(--accent-deep)" }} />
                    <span style={{ position: "absolute", left: ladder.tx + "%", top: -2, transform: "translateX(7px)", fontFamily: MONO, fontSize: 10, letterSpacing: "0.1em", fontWeight: 500, color: "var(--accent-deep)", whiteSpace: "nowrap" }}>TARGET {Math.round(tgt)}%</span>
                  </>
                )}
                {ladder.ticks.map(({ t, x }) => (
                  <span key={t} style={{ position: "absolute", left: x + "%", top: 86, transform: x < 3 ? "none" : x > 97 ? "translateX(-100%)" : "translateX(-50%)", fontFamily: MONO, fontSize: 9.5, color: "var(--faint)" }}>{t}%</span>
                ))}
                {ladder.marks.map(({ d, x, y }) => {
                  const c = markColor(d.margin, tgt);
                  const under = d.margin < tgt;
                  return (
                    <span key={d.id} className="mc-mk" onClick={() => onPick && onPick(d)} style={{ left: x + "%", top: y, background: c, boxShadow: `0 0 0 1.5px ${c}` }}>
                      <span className="mc-tip">
                        <span style={{ display: "block", fontFamily: MONO, fontSize: 9, letterSpacing: "0.14em", color: under ? (d.margin < tgt - 5 ? "var(--red)" : "var(--amber)") : "var(--accent-deep)" }}>{under ? "BELOW TARGET" : "AT OR ABOVE TARGET"}</span>
                        <span style={{ display: "block", fontSize: 12.5, fontWeight: 700, marginTop: 2 }}>{d.name}</span>
                        <span style={{ display: "block", fontFamily: MONO, fontSize: 10, color: "var(--muted)", marginTop: 2 }}>{pct1(d.margin)} MARGIN · {money2(d.price)} MENU · {money2(d.cost)} COST</span>
                      </span>
                    </span>
                  );
                })}
                {ladder.chips.map((ch) => (
                  <span key={ch.key} className="mc-chip" style={{ left: ch.x + "%", top: ch.y }}>
                    +{ch.rest.length}
                    <span className="mc-tip" style={{ minWidth: 190 }}>
                      <span style={{ display: "block", fontFamily: MONO, fontSize: 9, letterSpacing: "0.14em", color: "var(--faint)" }}>{ch.rest.length} MORE HERE</span>
                      {ch.rest.map((d) => (
                        <span key={d.id} style={{ display: "flex", justifyContent: "space-between", gap: 14, fontSize: 12, fontWeight: 600, marginTop: 3 }}>
                          {d.name}
                          <span style={{ fontFamily: MONO, fontSize: 10.5, fontWeight: 500, color: d.margin < tgt ? "var(--amber)" : "var(--accent-deep)" }}>{pct1(d.margin)}</span>
                        </span>
                      ))}
                    </span>
                  </span>
                ))}
              </div>
            </div>

            {/* lists */}
            <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 22 }}>
              <div style={{ minHeight: 0, display: "flex", flexDirection: "column" }}>
                <div style={sectionHead}>
                  <span style={{ fontSize: 12.5, fontWeight: 700 }}>{view === "above" ? `Most room to spare · ${above.length}` : `Below target · ${below.length}`}</span>
                  <span style={hint}>{view === "above" ? "COST → MENU PRICE" : `PRICE FOR ${Math.round(tgt)}%`}</span>
                </div>
                <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
                  {view === "above"
                    ? above.map((d) => {
                        const room = d.price * (1 - tgt / 100) - d.cost;
                        return (
                          <div key={d.id} className="om-row" onClick={() => onPick && onPick(d)} style={{ padding: "8px 2px", borderBottom: "1px solid var(--line-soft)", cursor: "pointer" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                              <span style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{d.name}</span>
                              <span style={{ fontFamily: MONO, fontSize: 11, whiteSpace: "nowrap" }}>{money2(d.cost)} → <strong>{money2(d.price)}</strong></span>
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 2, fontFamily: MONO, fontSize: 10 }}>
                              <span style={{ color: "var(--accent-deep)" }}>{pct1(d.margin)} MARGIN</span>
                              <span style={{ color: "var(--faint)" }}>COST CAN RISE {money2(room)}</span>
                            </div>
                          </div>
                        );
                      })
                    : below.map((d) => {
                        const p = priceForTarget(d.cost, tgt);
                        return (
                          <div key={d.id} className="om-row" onClick={() => onPick && onPick(d)} style={{ padding: "8px 2px", borderBottom: "1px solid var(--line-soft)", cursor: "pointer" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                              <span style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{d.name}</span>
                              <span style={{ fontFamily: MONO, fontSize: 11, whiteSpace: "nowrap" }}>{money2(d.price)} → <strong>{money2(p.menu)}</strong></span>
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 2, fontFamily: MONO, fontSize: 10 }}>
                              <span style={{ color: marginColor(d.margin, tgt) }}>{pct1(d.margin)} MARGIN</span>
                              <span style={{ color: "var(--faint)" }}>+{money2(p.exact - d.price)}{d.move30 > 0.005 ? ` · COST UP ${money2(d.move30)} THIS MONTH` : ""}</span>
                            </div>
                          </div>
                        );
                      })}
                  {view !== "above" && !below.length && (
                    <div style={{ padding: "14px 2px", fontSize: 12, color: "var(--muted)" }}>Every costed dish is at or above target.</div>
                  )}
                </div>
              </div>

              <div style={{ minHeight: 0, display: "flex", flexDirection: "column" }}>
                <div style={sectionHead}>
                  <span style={{ fontSize: 12.5, fontWeight: 700 }}>Plate cost moves</span>
                  <span style={hint}>LAST 30 DAYS · PER PLATE</span>
                </div>
                <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
                  {moves.map((d) => (
                    <div key={d.id} className="om-row" onClick={() => onPick && onPick(d)} style={{ padding: "8px 2px", borderBottom: "1px solid var(--line-soft)", cursor: "pointer" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                        <span style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{d.name}</span>
                        <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 500, whiteSpace: "nowrap", color: d.move30 > 0 ? "var(--amber)" : "var(--green)" }}>{(d.move30 > 0 ? "▲ " : "▼ ") + money2(Math.abs(d.move30))}</span>
                      </div>
                      <div style={{ fontFamily: MONO, fontSize: 10, textTransform: "uppercase", color: "var(--faint)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{d.moveCause || "From your invoices"}</div>
                    </div>
                  ))}
                  {!moves.length && (
                    <div style={{ padding: "14px 2px", fontSize: 12, color: "var(--muted)" }}>No plate cost changes in the last 30 days.</div>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {waiting.length > 0 && (
        <div style={{ flexShrink: 0, padding: "11px 20px 13px", borderTop: "1px solid var(--line)", background: "var(--panel)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
            <span style={{ fontSize: 12.5, fontWeight: 700 }}>Finish costing · {waiting.length} dish{waiting.length === 1 ? "" : "es"} waiting</span>
            <IngLink style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.1em" }}>OPEN INGREDIENTS ›</IngLink>
          </div>
          {unlock.length > 0 && (
            <>
              <div style={{ fontFamily: MONO, fontSize: 10, color: "var(--faint)", margin: "3px 0 7px" }}>ONE INVOICE PRICE FOR EACH OF THESE COSTS THE MOST DISHES</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {unlock.map(([n, c]) => (
                  <IngLink key={n} style={{ fontFamily: MONO, fontSize: 10.5, padding: "3px 9px", border: "1px solid var(--line)", borderRadius: 12, background: "var(--shell)", color: "var(--text)" }}>
                    {n} <span style={{ color: "var(--accent-deep)" }}>· {c} dish{c === 1 ? "" : "es"}</span>
                  </IngLink>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}


/* ── phone layout ─────────────────────────────────────────────────────
   "Is each price right?" on a phone: margin ladder (tap a dot to read it,
   no hover), the below-target / room-to-spare list, plate cost moves and
   finish costing. Returns a fragment so the screen's scroll area spaces
   the sections. */
export function MobileMenuCosting({ dishes, tgt, onPick, NavLink }) {
  const priced = useMemo(() => (dishes || []).filter((d) => !d.awaiting && d.price > 0), [dishes]);
  const waiting = useMemo(() => (dishes || []).filter((d) => d.awaiting), [dishes]);
  const below = useMemo(() => priced.filter((d) => d.margin < tgt).sort((a, b) => a.margin - b.margin), [priced, tgt]);
  const above = useMemo(() => priced.filter((d) => d.margin >= tgt).sort((a, b) => b.margin - a.margin), [priced, tgt]);

  const [picked, setPicked] = useState(null);
  const [selId, setSelId] = useState(null);
  const view = picked || (below.length ? "below" : "all");
  const inView = view === "below" ? below : view === "above" ? above : priced;
  const sel = inView.find((d) => d.id === selId) || inView[0] || null;

  const ladder = useMemo(() => {
    if (!priced.length) return null;
    const ms = priced.map((d) => d.margin);
    const minM = Math.min(...ms), maxM = Math.max(...ms);
    let lo, hi, set;
    if (view === "below") { lo = Math.floor(minM) - 1; hi = tgt; set = below; }
    else if (view === "above") { lo = tgt; hi = Math.ceil(maxM) + 1; set = above; }
    else { lo = Math.min(tgt - 20, Math.floor(minM) - 1); hi = Math.max(tgt + 20, Math.ceil(maxM) + 1); set = priced; }
    if (hi - lo < 4) { lo -= 2; hi += 2; }
    const X = (m) => ((m - lo) / (hi - lo)) * 100;

    // Wider columns than desktop (4%) so dots stay finger-sized; up to 4 stacked, then +N.
    const BIN = 4, MAX = 4;
    const bins = new Map();
    set.forEach((d) => {
      const k = Math.round(X(d.margin) / BIN);
      bins.set(k, [...(bins.get(k) || []), d]);
    });
    const marks = [], chips = [];
    bins.forEach((col, k) => {
      const x = Math.max(2, Math.min(98, k * BIN));
      col.sort((a, b) => a.margin - b.margin);
      col.slice(0, MAX).forEach((d, i) => marks.push({ d, x, y: 69 - i * 17 }));
      if (col.length > MAX) chips.push({ key: k, x, y: 69 - MAX * 17 - 2, rest: col.slice(MAX) });
    });

    const faint = "color-mix(in srgb, #e8c25a 22%, var(--shell))";
    const teal = "color-mix(in srgb, var(--accent) 22%, var(--shell))";
    const tx = X(tgt);
    const track = view === "below"
      ? `linear-gradient(90deg, var(--red) 0%, ${faint} 100%)`
      : view === "above"
        ? teal
        : `linear-gradient(90deg, var(--red) 0%, ${faint} ${tx}%, ${teal} ${tx}% 100%)`;
    const step = hi - lo > 30 ? 10 : 5;
    const ticks = [];
    for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) ticks.push({ t, x: X(t) });
    return { marks, chips, track, ticks, tx };
  }, [priced, below, above, view, tgt]);

  const moves = useMemo(
    () => priced.filter((d) => Math.abs(d.move30 || 0) > 0.005).sort((a, b) => b.move30 - a.move30),
    [priced]
  );
  const unlock = useMemo(() => {
    const counts = new Map();
    waiting.forEach((d) => {
      const names = new Set(d.components.flatMap((c) => c.ingredients).filter((i) => i.unpriced).map((i) => i.name));
      names.forEach((n) => counts.set(n, (counts.get(n) || 0) + 1));
    });
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [waiting]);

  const card = { background: "var(--shell)", border: "1px solid var(--line)", borderRadius: 14, boxShadow: "0 1px 1px rgba(17,24,25,0.05), 0 3px 6px rgba(17,24,25,0.07)" };
  const head = { display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, padding: "13px 14px 9px" };
  const h2 = { fontSize: 15, fontWeight: 800, letterSpacing: "-0.02em" };
  const hintM = { fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.08em", color: "var(--muted)", whiteSpace: "nowrap" };
  const row = { width: "100%", display: "block", padding: "10px 14px", background: "none", border: "none", borderTop: "1px solid var(--line-soft)", textAlign: "left", cursor: "pointer", fontFamily: SANS, color: "var(--text)" };
  const IngLink = ({ children, style }) =>
    NavLink ? <NavLink href="/client/ingredients" style={style}>{children}</NavLink> : <a href="/client/ingredients" style={style}>{children}</a>;

  const viewBtn = (id, label) => (
    <button
      key={id}
      type="button"
      onClick={() => { setPicked(id); setSelId(null); }}
      style={{ height: 36, border: "none", borderRadius: 17, fontFamily: SANS, fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", background: view === id ? "var(--accent-tint)" : "transparent", color: view === id ? "var(--accent-deep)" : "var(--muted)" }}
    >
      {label}
    </button>
  );

  return (
    <>
      {/* margin ladder */}
      <div style={{ ...card, padding: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span style={h2}>Margin ladder</span>
          {ladder && <span style={hintM}>TAP A DOT</span>}
        </div>
        {!ladder ? (
          <div style={{ padding: "16px 0 4px", textAlign: "center" }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>No dish is fully costed yet</div>
            <div style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.55, marginTop: 4 }}>
              A dish gets a margin once every ingredient in it has an invoice price. The ingredients below would cost the most dishes first.
            </div>
          </div>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 2, background: "var(--panel)", borderRadius: 20, padding: 3, marginTop: 10 }}>
              {viewBtn("below", `Below · ${below.length}`)}
              {viewBtn("all", `All · ${priced.length}`)}
              {viewBtn("above", `Above · ${above.length}`)}
            </div>
            <div style={{ position: "relative", height: 104, margin: "14px 12px 0" }}>
              <div style={{ position: "absolute", left: 0, right: 0, top: 70, height: 10, borderRadius: 5, background: ladder.track }} />
              {view === "all" && (
                <>
                  <div style={{ position: "absolute", left: ladder.tx + "%", top: 6, height: 86, borderLeft: "2px solid var(--accent-deep)" }} />
                  <span style={{ position: "absolute", left: ladder.tx + "%", top: -4, transform: "translateX(6px)", fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.1em", fontWeight: 500, color: "var(--accent-deep)", whiteSpace: "nowrap" }}>TARGET {Math.round(tgt)}%</span>
                </>
              )}
              {ladder.ticks.map(({ t, x }) => (
                <span key={t} style={{ position: "absolute", left: x + "%", top: 86, transform: x < 3 ? "none" : x > 97 ? "translateX(-100%)" : "translateX(-50%)", fontFamily: MONO, fontSize: 9.5, color: "var(--muted)" }}>{t}%</span>
              ))}
              {ladder.marks.map(({ d, x, y }) => {
                const c = markColor(d.margin, tgt);
                const on = sel && sel.id === d.id;
                return (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => setSelId(d.id)}
                    aria-label={`${d.name}, ${pct1(d.margin)} margin`}
                    style={{ position: "absolute", left: x + "%", top: y, width: 28, height: 28, margin: "-6.5px 0 0 -14px", padding: 0, border: "none", background: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", zIndex: on ? 3 : 1 }}
                  >
                    <span style={{ width: on ? 17 : 15, height: on ? 17 : 15, borderRadius: "50%", background: c, border: "2.5px solid var(--shell)", boxShadow: `0 0 0 ${on ? 3 : 1.5}px ${on ? "var(--text)" : c}` }} />
                  </button>
                );
              })}
              {ladder.chips.map((ch) => (
                <button key={ch.key} type="button" onClick={() => setSelId(ch.rest[0].id)} style={{ position: "absolute", left: ch.x + "%", top: ch.y, transform: "translateX(-50%)", minWidth: 28, height: 20, padding: "0 6px", fontFamily: MONO, fontSize: 10, fontWeight: 500, color: "var(--muted)", background: "var(--shell)", border: "1px solid var(--line)", borderRadius: 10, cursor: "pointer", zIndex: 2 }}>
                  +{ch.rest.length}
                </button>
              ))}
            </div>
            {sel && (() => {
              const under = sel.margin < tgt;
              return (
                <div style={{ marginTop: 6, background: "var(--paper)", border: "1px dashed var(--paper-line)", borderRadius: 8, padding: "9px 11px", display: "flex", alignItems: "center", gap: 10, fontFamily: MONO, color: "var(--ink)" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 9, letterSpacing: "0.14em", color: under ? (sel.margin < tgt - 5 ? "var(--red)" : "var(--amber)") : "var(--accent-deep)" }}>{under ? "BELOW TARGET" : "AT OR ABOVE TARGET"}</div>
                    <div style={{ fontFamily: SANS, fontSize: 14, fontWeight: 700, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sel.name}</div>
                    <div style={{ fontSize: 10.5, color: "var(--ink-soft)", marginTop: 2 }}>{pct1(sel.margin)} MARGIN · {money2(sel.price)} MENU · {money2(sel.cost)} COST</div>
                  </div>
                  <button type="button" onClick={() => onPick && onPick(sel)} style={{ flexShrink: 0, minHeight: 36, padding: "0 12px", background: "none", border: "1px solid var(--ink-faint)", borderRadius: 18, fontFamily: MONO, fontSize: 10, letterSpacing: "0.1em", color: "var(--ink)", cursor: "pointer" }}>
                    OPEN ›
                  </button>
                </div>
              );
            })()}
          </>
        )}
      </div>

      {/* below target, or room to spare */}
      {ladder && (
        <div style={{ ...card, overflow: "hidden" }}>
          <div style={head}>
            <span style={h2}>{view === "above" ? `Most room to spare · ${above.length}` : `Below target · ${below.length}`}</span>
            <span style={hintM}>{view === "above" ? "COST → MENU PRICE" : `PRICE FOR ${Math.round(tgt)}%`}</span>
          </div>
          {view === "above"
            ? above.map((d) => {
                const room = d.price * (1 - tgt / 100) - d.cost;
                return (
                  <button key={d.id} type="button" onClick={() => onPick && onPick(d)} style={row}>
                    <span style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                      <span style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{d.name}</span>
                      <span style={{ fontFamily: MONO, fontSize: 11.5, whiteSpace: "nowrap" }}>{money2(d.cost)} → <strong>{money2(d.price)}</strong></span>
                    </span>
                    <span style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 3, fontFamily: MONO, fontSize: 10 }}>
                      <span style={{ color: "var(--accent-deep)" }}>{pct1(d.margin)} MARGIN</span>
                      <span style={{ color: "var(--muted)" }}>COST CAN RISE {money2(room)}</span>
                    </span>
                  </button>
                );
              })
            : below.map((d) => {
                const p = priceForTarget(d.cost, tgt);
                return (
                  <button key={d.id} type="button" onClick={() => onPick && onPick(d)} style={row}>
                    <span style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                      <span style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{d.name}</span>
                      <span style={{ fontFamily: MONO, fontSize: 11.5, whiteSpace: "nowrap" }}>{money2(d.price)} → <strong>{money2(p.menu)}</strong></span>
                    </span>
                    <span style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 3, fontFamily: MONO, fontSize: 10 }}>
                      <span style={{ color: marginColor(d.margin, tgt) }}>{pct1(d.margin)} MARGIN</span>
                      <span style={{ color: "var(--muted)" }}>+{money2(p.exact - d.price)}{d.move30 > 0.005 ? ` · COST UP ${money2(d.move30)}` : ""}</span>
                    </span>
                  </button>
                );
              })}
          {view !== "above" && !below.length && (
            <div style={{ padding: "12px 14px 14px", borderTop: "1px solid var(--line-soft)", fontSize: 12.5, color: "var(--muted)" }}>Every costed dish is at or above target.</div>
          )}
        </div>
      )}

      {/* plate cost moves */}
      {ladder && (
        <div style={{ ...card, overflow: "hidden" }}>
          <div style={head}>
            <span style={h2}>Plate cost moves</span>
            <span style={hintM}>LAST 30 DAYS · PER PLATE</span>
          </div>
          {moves.map((d) => (
            <button key={d.id} type="button" onClick={() => onPick && onPick(d)} style={row}>
              <span style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{d.name}</span>
                <span style={{ fontFamily: MONO, fontSize: 11.5, fontWeight: 500, whiteSpace: "nowrap", color: d.move30 > 0 ? "var(--amber)" : "var(--green)" }}>{(d.move30 > 0 ? "▲ " : "▼ ") + money2(Math.abs(d.move30))}</span>
              </span>
              <span style={{ display: "block", fontFamily: MONO, fontSize: 10, textTransform: "uppercase", color: "var(--muted)", marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{d.moveCause || "From your invoices"}</span>
            </button>
          ))}
          {!moves.length && (
            <div style={{ padding: "12px 14px 14px", borderTop: "1px solid var(--line-soft)", fontSize: 12.5, color: "var(--muted)" }}>No plate cost changes in the last 30 days.</div>
          )}
        </div>
      )}

      {/* finish costing */}
      {waiting.length > 0 && (
        <div style={{ background: "var(--shell)", border: "1px dashed var(--amber)", borderRadius: 14, padding: "13px 14px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
            <span style={{ fontSize: 14, fontWeight: 800, letterSpacing: "-0.02em" }}>Finish costing · {waiting.length} dish{waiting.length === 1 ? "" : "es"} waiting</span>
            <IngLink style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.1em", whiteSpace: "nowrap" }}>OPEN ›</IngLink>
          </div>
          {unlock.length > 0 && (
            <>
              <div style={{ fontSize: 12, color: "var(--muted)", margin: "4px 0 9px" }}>One invoice price for each of these costs the most dishes.</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {unlock.map(([nm, c]) => (
                  <IngLink key={nm} style={{ minHeight: 34, display: "flex", alignItems: "center", fontFamily: MONO, fontSize: 11, padding: "0 10px", border: "1px solid var(--line)", borderRadius: 17, background: "var(--shell)", color: "var(--text)" }}>
                    {nm} <span style={{ color: "var(--accent-deep)", marginLeft: 5 }}>· {c} dish{c === 1 ? "" : "es"}</span>
                  </IngLink>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}