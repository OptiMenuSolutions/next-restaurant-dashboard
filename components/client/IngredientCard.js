import React, { useMemo } from "react";
import { MONO, money } from "./ClientChrome";
import { convertQuantity } from "../../lib/computeWasteRisk";

/**
 * IngredientCard — right side of the Ingredients page: one ingredient.
 *
 *   header      name, supplier, last invoice (opens it), price per unit and
 *               the change vs the previous invoice
 *   use first   red callout, only when it has 3 days or less left
 *   tiles       on hand · expected use next 7 days · last bought
 *   chart       unit price across its last 6 invoices
 *   dishes      every dish using it: per-plate qty, cost, share of menu price
 *
 * `g` is a row from IngredientsScreen's decorate(): name, unit, supplier,
 * estimated, awaiting, price, pct, purchases (newest first), menuItems,
 * onHand, daysLeft, boughtPerWeek.
 */

const money2 = (n) => money(n, 2);
// Sub-cent prices (tortillas at $0.03) need a third decimal to show a move.
const unitMoney = (n) => (n != null && n < 0.1 ? "$" + Number(n).toFixed(3) : money2(n));

/* 5,700 oz reads better as 356 lb. Shared with the list's On hand column. */
export function qtyLabel(n, unit) {
  if (n == null || !isFinite(n)) return "—";
  let v = Number(n), u = unit || "";
  if (u === "oz" && v >= 32) { v = v / 16; u = "lb"; }
  else if (u === "fl oz" && v >= 128) { v = v / 128; u = "gal"; }
  // Counted items (each, case, can) never show a fraction.
  const counted = /^(ea|each|ct|count|case|cs|can|bag|box|pk|pack|dozen|dz)$/i.test(u);
  const r = counted || v >= 100 ? Math.round(v) : Math.round(v * 10) / 10;
  return r.toLocaleString("en-US") + (u ? " " + u : "");
}

const kicker = { fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--faint)", whiteSpace: "nowrap" };

export default function IngredientCard({ g, onOpenMenuItem, onOpenInvoice, onBack }) {
  const buys = useMemo(() => (g.purchases || []).filter((p) => Number(p.unitCost) > 0), [g]);
  const last = buys[0] || null;
  const prev = buys[1] || null;
  const weekUse = Number(g.boughtPerWeek) || 0;
  const onHand = Number(g.onHand) || 0;

  /* Price note under the big number. */
  const priceNote = g.awaiting
    ? "AWAITING AN INVOICE"
    : g.estimated
      ? "ESTIMATED · NO INVOICE YET"
      : g.pct == null || !prev
        ? "FROM INVOICE"
        : Math.abs(g.pct) < 0.05
          ? "FLAT VS " + prev.date
          : (g.pct > 0 ? "▲ " : "▼ ") + Math.abs(g.pct).toFixed(1) + "% VS " + prev.date;
  const noteColor = !g.awaiting && !g.estimated && g.pct != null && g.pct > 1.5 ? "var(--amber)" : "var(--faint)";

  /* Use first: red only for use it or lose it. */
  const dl = g.daysLeft;
  const useFirst = dl != null && dl <= 3 && onHand > 0;
  const perDay = weekUse / 7;
  const usedBy = perDay * Math.max(dl || 0, 1);
  const atRiskQty = Math.max(0, onHand - usedBy);
  const atRiskDollars = g.price ? atRiskQty * g.price : null;
  const leftLabel = dl <= 0 ? "USE TODAY" : dl === 1 ? "1 DAY LEFT" : dl + " DAYS LEFT";

  /* Last 6 invoice prices, oldest to newest. */
  const chart = useMemo(() => buildChart(buys.slice(0, 6).reverse()), [buys]);

  /* Dishes: this ingredient's cost on each plate, in its own unit. */
  const dishes = (g.menuItems || []).map((m) => {
    let q = Number(m.quantity) || 0;
    if (m.recipeUnit && m.recipeUnit !== g.unit) q = convertQuantity(q, m.recipeUnit, g.unit, g.name);
    const cost = g.price != null && q != null && isFinite(q) ? g.price * q : null;
    const share = cost != null && m.price > 0 ? Math.round((cost / m.price) * 100) : null;
    return { ...m, cost, share };
  });
  const maxCost = dishes.reduce((a, d) => (d.cost != null && d.cost > a ? d.cost : a), 0);
  const suppliers = new Set(buys.map((p) => p.supplier)).size;

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      {/* header */}
      <div style={{ flexShrink: 0, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14, padding: "15px 20px 12px", borderBottom: "1px solid var(--line-soft)" }}>
        <div style={{ minWidth: 0 }}>
          {onBack ? (
            <button type="button" onClick={onBack} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: MONO, fontSize: 10.5, letterSpacing: "0.14em", color: "var(--accent-deep)" }}>‹ ALL INGREDIENTS</button>
          ) : (
            <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: "0.14em", color: "var(--accent-deep)" }}>INGREDIENT</div>
          )}
          <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-0.035em", marginTop: 3, lineHeight: 1.15 }}>{g.name}</div>
          <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--faint)", marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {last ? (
              <>
                {last.supplier} · last invoice {last.date}
                {last.invoiceId && (
                  <>
                    {" · "}
                    <a href="#" onClick={(e) => { e.preventDefault(); onOpenInvoice && onOpenInvoice(last); }} style={{ textDecoration: "none" }}>#{last.invoice} ↗</a>
                  </>
                )}
              </>
            ) : g.estimated ? "Estimated price · no invoice yet" : "No invoice yet"}
          </div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div>
            <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums", color: g.awaiting ? "var(--faint)" : g.estimated ? "var(--amber)" : "var(--text)" }}>
              {g.awaiting ? "—" : unitMoney(g.price)}
            </span>
            {!g.awaiting && <span style={{ fontFamily: MONO, fontSize: 11, color: "var(--faint)" }}> /{g.unit}</span>}
          </div>
          <div style={{ fontFamily: MONO, fontSize: 10, color: noteColor, marginTop: 2, whiteSpace: "nowrap" }}>{priceNote}</div>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 14, padding: "14px 20px 16px", overflow: "hidden" }}>
        {useFirst && (
          <div style={{ flexShrink: 0, border: "1px dashed var(--red)", borderRadius: 6, padding: "9px 12px", fontSize: 12, lineHeight: 1.5 }}>
            <span style={{ fontFamily: MONO, color: "var(--red)", fontWeight: 500, letterSpacing: "0.06em" }}>▲ USE FIRST · {leftLabel}.</span>{" "}
            {qtyLabel(onHand, g.unit)} on hand
            {weekUse > 0 ? (
              atRiskQty > 0 ? (
                <>
                  {" "}and about {qtyLabel(usedBy, g.unit)} get used by then
                  {atRiskDollars ? <>, so roughly <strong>{money(atRiskDollars, 0)}</strong> is at risk</> : null}. Push a dish below to move it.
                </>
              ) : (
                <>, and you should use it all in time.</>
              )
            ) : (
              <>. Push a dish below to move it.</>
            )}
          </div>
        )}

        {buys.length === 0 ? (
          <div style={{ flexShrink: 0, padding: "18px 4px", textAlign: "center" }}>
            <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-0.02em" }}>{g.name} hasn’t come through on an invoice yet</div>
            <div style={{ fontSize: 12.5, lineHeight: 1.55, color: "var(--muted)", marginTop: 6 }}>
              {g.awaiting
                ? "We’ll price it the first time we read it off a delivery. Until then, dishes that use it show as awaiting pricing."
                : "This is an estimated price, so dish costs using it are approximate. It firms up the first time we read it off a delivery."}
            </div>
          </div>
        ) : (
          <>
            <div style={{ flexShrink: 0, display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
              {[
                { label: "On hand", value: qtyLabel(onHand, g.unit), sub: "FROM CURRENT INVENTORY" },
                { label: "Next 7 days", value: weekUse > 0 ? "~" + qtyLabel(weekUse, g.unit) : "—", sub: weekUse > 0 ? "EXPECTED USE · " + qtyLabel(perDay, g.unit) + " / DAY" : "NOT ENOUGH HISTORY" },
                { label: "Last bought", value: last.qty || "—", sub: `${last.date} · ${unitMoney(last.unitCost)}/${g.unit}` },
              ].map((t) => (
                <div key={t.label} style={{ background: "var(--panel)", border: "1px solid var(--line-soft)", borderRadius: 8, padding: "9px 12px", minWidth: 0 }}>
                  <div style={kicker}>{t.label}</div>
                  <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums", marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.value}</div>
                  <div style={{ fontFamily: MONO, fontSize: 9.5, color: "var(--muted)", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.sub}</div>
                </div>
              ))}
            </div>

            <div style={{ flex: "1 1 130px", minHeight: 110, display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6, flexShrink: 0 }}>
                <span style={{ fontSize: 12.5, fontWeight: 700 }}>Price per {g.unit}</span>
                <span style={{ fontFamily: MONO, fontSize: 10, color: "var(--faint)" }}>
                  {chart.points.length > 1 ? `LAST ${chart.points.length} INVOICES` : "ONE INVOICE SO FAR"}
                </span>
              </div>
              {chart.points.length > 1 ? (
                <div style={{ flex: 1, minHeight: 0, position: "relative", margin: "18px 22px 18px 22px" }}>
                  <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible" }}>
                    <line x1="0" y1="0" x2="100" y2="0" stroke="var(--line-soft)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                    <line x1="0" y1="50" x2="100" y2="50" stroke="var(--line-soft)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                    <line x1="0" y1="100" x2="100" y2="100" stroke="var(--line)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                    <polyline points={chart.points.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                  </svg>
                  {chart.points.map((p, i) => (
                    <React.Fragment key={i}>
                      <span style={{ position: "absolute", left: p.x + "%", top: p.y + "%", width: 7, height: 7, margin: "-3.5px 0 0 -3.5px", borderRadius: "50%", background: i === chart.points.length - 1 ? "var(--accent-deep)" : "var(--accent)", border: "1.5px solid var(--shell)" }} />
                      <span style={{ position: "absolute", left: p.x + "%", top: p.y + "%", transform: "translate(-50%, -19px)", fontFamily: MONO, fontSize: 9.5, color: "var(--muted)", whiteSpace: "nowrap" }}>{unitMoney(p.value)}</span>
                      <span style={{ position: "absolute", left: p.x + "%", top: "100%", transform: "translate(-50%, 6px)", fontFamily: MONO, fontSize: 9, letterSpacing: "0.06em", color: "var(--faint)", whiteSpace: "nowrap" }}>{p.label}</span>
                    </React.Fragment>
                  ))}
                </div>
              ) : (
                <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "var(--muted)" }}>
                  The trend starts with its second invoice.
                </div>
              )}
            </div>
          </>
        )}

        <div style={{ flex: "0 1 auto", minHeight: 90, display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4, flexShrink: 0 }}>
            <span style={{ fontSize: 12.5, fontWeight: 700 }}>{dishes.length ? `Used in ${dishes.length} dish${dishes.length === 1 ? "" : "es"}` : "Not used in any dish yet"}</span>
            {maxCost > 0 && (
              <span style={{ fontFamily: MONO, fontSize: 10, color: "var(--faint)" }}>A 10% RISE ADDS UP TO {money2(Math.max(0.01, maxCost * 0.1))} A PLATE</span>
            )}
          </div>
          {dishes.length > 0 && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 74px 64px 100px", gap: 10, fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.12em", color: "var(--faint)", padding: "5px 0", borderBottom: "1px solid var(--line)", flexShrink: 0 }}>
                <span>DISH</span><span style={{ textAlign: "right" }}>PER PLATE</span><span style={{ textAlign: "right" }}>COST</span><span style={{ textAlign: "right" }}>OF MENU PRICE</span>
              </div>
              <div style={{ minHeight: 0, overflowY: "auto" }}>
                {dishes.map((d, i) => (
                  <div key={d.id || i} className="om-row" onClick={() => onOpenMenuItem && onOpenMenuItem(d)} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 74px 64px 100px", gap: 10, alignItems: "center", height: 30, borderBottom: "1px solid var(--line-soft)", cursor: "pointer" }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{d.name}</span>
                    <span style={{ fontFamily: MONO, fontSize: 11, color: "var(--muted)", textAlign: "right", whiteSpace: "nowrap" }}>{d.qty || "—"}</span>
                    <span style={{ fontFamily: MONO, fontSize: 11, textAlign: "right" }}>{d.cost == null ? "—" : money2(d.cost)}</span>
                    <span style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "flex-end" }}>
                      {d.share != null && (
                        <span style={{ width: 40, height: 4, background: "var(--line-soft)", borderRadius: 2, overflow: "hidden" }}>
                          <span style={{ display: "block", height: "100%", width: Math.min(100, d.share) + "%", background: "var(--accent)" }} />
                        </span>
                      )}
                      <span style={{ fontFamily: MONO, fontSize: 10.5, color: "var(--muted)", minWidth: 28, textAlign: "right" }}>{d.share == null ? "—" : (d.share < 1 && d.cost > 0 ? "<1" : d.share) + "%"}</span>
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <div style={{ flexShrink: 0, display: "flex", justifyContent: "space-between", gap: 12, padding: "11px 20px", borderTop: "1px solid var(--line)", fontFamily: MONO, fontSize: 10.5, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--faint)" }}>
        <span>{buys.length ? `Bought from ${suppliers} supplier${suppliers === 1 ? "" : "s"} · ${buys.length} invoice${buys.length === 1 ? "" : "s"}` : "No invoices yet"}</span>
        <span>Tap a dish to open it</span>
      </div>
    </div>
  );
}

/* Points in a 0–100 box: x spread evenly, y with headroom so a flat line
   sits in the middle instead of on an edge. */
function buildChart(rows) {
  const vals = rows.map((p) => Number(p.unitCost));
  if (vals.length < 2) return { points: [] };
  const min = Math.min(...vals), max = Math.max(...vals);
  const pad = (max - min) * 0.25 || max * 0.1 || 1;
  const lo = min - pad, hi = max + pad;
  return {
    points: rows.map((p, i) => ({
      x: +((i / (rows.length - 1)) * 100).toFixed(2),
      y: +(100 - ((vals[i] - lo) / (hi - lo)) * 100).toFixed(2),
      value: vals[i],
      label: p.date,
    })),
  };
}