import React, { useMemo } from "react";
import { MONO, money } from "./ClientChrome";
import IngredientDishGrid from "./IngredientDishGrid";
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
// Display the same precision used by the price chart.
const unitMoney = (n) => {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  const rounded = Number(Number(n).toFixed(3));
  return "$" + rounded.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 3,
  });
};

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
    <div style={{ flex: 1, minHeight: 0, minWidth: 0, display: "flex", flexDirection: "column", overflowY: "auto", overflowX: "hidden" }}>
      {/* header */}
      <div style={{ position: "sticky", top: 0, zIndex: 5, background: "var(--shell)", flexShrink: 0, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14, padding: "15px 20px 12px", borderBottom: "1px solid var(--line-soft)" }}>
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

      <div style={{ flex: "0 0 auto", display: "flex", flexDirection: "column", gap: 18, padding: "16px 20px 20px" }}>
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

            <div style={{ flex: "0 0 auto", height: 220, minHeight: 220, display: "flex", flexDirection: "column" }}>
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

        <IngredientDishGrid
          key={g.id}
          dishes={dishes}
          onOpenMenuItem={onOpenMenuItem}
        />
      </div>

      {buys.length > 0 && (
        <div style={{ flexShrink: 0, borderTop: "1px solid var(--line)", padding: "12px 20px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 8, fontFamily: MONO, fontSize: 10, letterSpacing: "0.1em", color: "var(--muted)" }}>
            <span>PURCHASE HISTORY</span>
            <span>CLICK TO OPEN</span>
          </div>
          <div>
            {buys.map((p, i) => (
              <button
                key={p.invoiceId || i}
                type="button"
                onClick={() => onOpenInvoice && onOpenInvoice(p)}
                style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, minHeight: 44, padding: "8px 0", border: "none", borderTop: "1px dashed var(--line-soft)", background: "none", color: "var(--text)", textAlign: "left", cursor: "pointer", fontFamily: MONO }}
              >
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {p.supplier}
                  </span>
                  <span style={{ display: "block", marginTop: 4, fontSize: 10.5, color: "var(--muted)" }}>
                    {p.date} · {p.qty || "—"} ·{" "}
                    <span style={{ color: "var(--accent-deep)" }}>{p.invoice}</span>
                  </span>
                </span>
                <span style={{ flexShrink: 0, fontSize: 12, fontWeight: 600 }}>
                  {unitMoney(p.unitCost)}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

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
  const vals = rows.map((p) => Number(Number(p.unitCost).toFixed(3)));
  if (vals.length < 2) return { points: [] };
  const min = Math.min(...vals), max = Math.max(...vals);
  const pad = Math.max((max - min) * 0.25, max * 0.1, 0.001);
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


/* ── phone layout ──────────────────────────────────────────────────────
   Same facts as IngredientCard, stacked for a phone: header, use-first
   callout, three tiles, price chart, dishes, then every purchase. Returns
   a fragment so the screen's scroll area spaces the sections. */
export function MobileIngredientCard({ g, onOpenMenuItem, onOpenInvoice }) {
  const buys = (g.purchases || []).filter((p) => Number(p.unitCost) > 0);
  const last = buys[0] || null;
  const prev = buys[1] || null;
  const weekUse = Number(g.boughtPerWeek) || 0;
  const onHand = Number(g.onHand) || 0;

  const priceNote = g.awaiting
    ? "AWAITING AN INVOICE"
    : g.estimated
      ? "ESTIMATED · NO INVOICE YET"
      : g.pct == null || !prev
        ? "FROM INVOICE"
        : Math.abs(g.pct) < 0.05
          ? "FLAT VS " + prev.date
          : (g.pct > 0 ? "▲ " : "▼ ") + Math.abs(g.pct).toFixed(1) + "% VS " + prev.date;
  const noteColor = !g.awaiting && !g.estimated && g.pct != null && g.pct > 1.5 ? "var(--amber)" : "var(--muted)";

  const dl = g.daysLeft;
  const useFirst = dl != null && dl <= 3 && onHand > 0;
  const perDay = weekUse / 7;
  const usedBy = perDay * Math.max(dl || 0, 1);
  const atRiskQty = Math.max(0, onHand - usedBy);
  const atRiskDollars = g.price ? atRiskQty * g.price : null;
  const leftLabel = dl <= 0 ? "USE TODAY" : dl === 1 ? "1 DAY LEFT" : dl + " DAYS LEFT";

  const chart = buildChart(buys.slice(0, 6).reverse());
  const first = chart.points[0];
  const lastPt = chart.points[chart.points.length - 1];
  const span = chart.points.length > 1 && first.value ? ((lastPt.value - first.value) / first.value) * 100 : null;

  const dishes = (g.menuItems || []).map((m) => {
    let q = Number(m.quantity) || 0;
    if (m.recipeUnit && m.recipeUnit !== g.unit) q = convertQuantity(q, m.recipeUnit, g.unit, g.name);
    const cost = g.price != null && q != null && isFinite(q) ? g.price * q : null;
    const share = cost != null && m.price > 0 ? Math.round((cost / m.price) * 100) : null;
    return { ...m, cost, share };
  });
  const maxCost = dishes.reduce((a, d) => (d.cost != null && d.cost > a ? d.cost : a), 0);
  const suppliers = new Set(buys.map((p) => p.supplier)).size;

  const card = { background: "var(--shell)", border: "1px solid var(--line)", borderRadius: 14, boxShadow: "0 1px 1px rgba(17,24,25,0.05), 0 3px 6px rgba(17,24,25,0.07)" };
  const tileK = { fontFamily: MONO, fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--muted)" };

  return (
    <>
      {/* header */}
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 5,
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          gap: 10,
          padding: "12px 0",
          background: "var(--panel)",
          borderBottom: "1px solid var(--line)",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14 }}>
          <div style={{ fontSize: 25, fontWeight: 800, letterSpacing: "-0.04em", lineHeight: 1.1, minWidth: 0 }}>{g.name}</div>
          <div style={{ textAlign: "right", flexShrink: 0 }}>
            <div>
              <span style={{ fontSize: 25, fontWeight: 800, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums", color: g.awaiting ? "var(--faint)" : g.estimated ? "var(--amber)" : "var(--text)" }}>
                {g.awaiting ? "—" : unitMoney(g.price)}
              </span>
              {!g.awaiting && <span style={{ fontFamily: MONO, fontSize: 12, color: "var(--muted)" }}> /{g.unit}</span>}
            </div>
            <div style={{ fontFamily: MONO, fontSize: 10.5, color: noteColor, marginTop: 2, whiteSpace: "nowrap" }}>{priceNote}</div>
          </div>
        </div>
        <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--muted)" }}>
          {last ? (
            <>
              {last.supplier} · last invoice {last.date}
              {last.invoiceId && (
                <>
                  {" · "}
                  <a href="#" onClick={(e) => { e.preventDefault(); onOpenInvoice && onOpenInvoice(last); }}>#{last.invoice} ↗</a>
                </>
              )}
            </>
          ) : g.estimated ? "Estimated price · no invoice yet" : "No invoice yet"}
        </div>
      </div>

      {/* use first */}
      {useFirst && (
        <div style={{ background: "color-mix(in srgb, var(--red) 8%, var(--shell))", border: "1px dashed var(--red)", borderRadius: 12, padding: "12px 14px", fontSize: 13.5, lineHeight: 1.5 }}>
          <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: "0.1em", fontWeight: 500, color: "var(--red)" }}>▲ USE FIRST · {leftLabel}</div>
          <div style={{ marginTop: 4 }}>
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
        </div>
      )}

      {buys.length === 0 ? (
        <div style={{ ...card, padding: "20px 16px", textAlign: "center" }}>
          <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-0.02em" }}>{g.name} hasn&rsquo;t come through on an invoice yet</div>
          <div style={{ fontSize: 13, lineHeight: 1.55, color: "var(--muted)", marginTop: 6 }}>
            {g.awaiting
              ? "We’ll price it the first time we read it off a delivery. Until then, dishes that use it show as awaiting pricing."
              : "This is an estimated price, so dish costs using it are approximate. It firms up the first time we read it off a delivery."}
          </div>
        </div>
      ) : (
        <>
          {/* tiles */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
            {[
              { label: "On hand", value: qtyLabel(onHand, g.unit), sub: "INVENTORY" },
              { label: "Next 7 days", value: weekUse > 0 ? "~" + qtyLabel(weekUse, g.unit) : "—", sub: weekUse > 0 ? qtyLabel(perDay, g.unit).toUpperCase() + " / DAY" : "NOT ENOUGH HISTORY" },
              { label: "Last bought", value: last.qty || "—", sub: last.date },
            ].map((t) => (
              <div key={t.label} style={{ ...card, borderRadius: 10, boxShadow: "none", padding: "10px 11px", minWidth: 0 }}>
                <div style={tileK}>{t.label}</div>
                <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums", marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.value}</div>
                <div style={{ fontFamily: MONO, fontSize: 9, color: "var(--muted)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.sub}</div>
              </div>
            ))}
          </div>

          {/* price chart */}
          <div style={{ ...card, padding: "14px 14px 12px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
              <span style={{ fontSize: 15, fontWeight: 800, letterSpacing: "-0.02em" }}>Price per {g.unit}</span>
              <span style={{ fontFamily: MONO, fontSize: 10, color: "var(--muted)", whiteSpace: "nowrap" }}>
                {chart.points.length > 1
                  ? `LAST ${chart.points.length} INVOICES${span != null && Math.abs(span) >= 0.05 ? (span > 0 ? " · ▲ " : " · ▼ ") + Math.abs(span).toFixed(1) + "%" : ""}`
                  : "ONE INVOICE SO FAR"}
              </span>
            </div>
            {chart.points.length > 1 ? (
              <div style={{ position: "relative", height: 130, margin: "26px 22px 26px" }}>
                <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible" }}>
                  <line x1="0" y1="0" x2="100" y2="0" stroke="var(--line-soft)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                  <line x1="0" y1="50" x2="100" y2="50" stroke="var(--line-soft)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                  <line x1="0" y1="100" x2="100" y2="100" stroke="var(--line)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                  <polyline points={chart.points.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                </svg>
                {chart.points.map((p, i) => {
                  const isLast = i === chart.points.length - 1;
                  return (
                    <React.Fragment key={i}>
                      <span style={{ position: "absolute", left: p.x + "%", top: p.y + "%", width: isLast ? 11 : 9, height: isLast ? 11 : 9, margin: isLast ? "-5.5px 0 0 -5.5px" : "-4.5px 0 0 -4.5px", borderRadius: "50%", background: isLast ? "var(--accent-deep)" : "var(--shell)", border: isLast ? "2px solid var(--shell)" : "2px solid var(--accent)" }} />
                      <span style={{ position: "absolute", left: p.x + "%", top: p.y + "%", transform: `translate(${isLast ? "-80%" : "-50%"}, -22px)`, fontFamily: MONO, fontSize: isLast ? 10.5 : 10, fontWeight: isLast ? 500 : 400, color: isLast ? "var(--text)" : "var(--muted)", whiteSpace: "nowrap" }}>{unitMoney(p.value)}</span>
                      <span style={{ position: "absolute", left: p.x + "%", top: "100%", transform: "translate(-50%, 8px)", fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.04em", color: isLast ? "var(--text)" : "var(--muted)", whiteSpace: "nowrap" }}>{p.label}</span>
                    </React.Fragment>
                  );
                })}
              </div>
            ) : (
              <div style={{ padding: "22px 0 10px", fontSize: 12.5, color: "var(--muted)", textAlign: "center" }}>The trend starts with its second invoice.</div>
            )}
          </div>
        </>
      )}

      {/* dishes using it */}
      <IngredientDishGrid
        key={g.id}
        dishes={dishes}
        onOpenMenuItem={onOpenMenuItem}
      />

      {/* purchase history */}
      {buys.length > 0 && (
        <div style={{ background: "var(--paper)", color: "var(--ink)", border: "1px solid var(--paper-line)", borderRadius: 12, padding: 14, fontFamily: MONO }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: 10, letterSpacing: "0.12em", color: "var(--ink-soft)" }}>
            <span>PURCHASE HISTORY</span><span>TAP TO OPEN</span>
          </div>
          <div style={{ borderTop: "1px dashed var(--paper-line)", marginTop: 9 }} />
          {buys.map((p, i) => (
            <button key={i} type="button" onClick={() => onOpenInvoice && onOpenInvoice(p)} style={{ width: "100%", display: "block", minHeight: 44, padding: "10px 0", background: "none", border: "none", borderBottom: "1px dashed var(--paper-line)", textAlign: "left", cursor: "pointer", fontFamily: MONO, color: "var(--ink)" }}>
              <span style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontSize: 12.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.supplier}</span>
                <span style={{ flex: 1, minWidth: 8, borderBottom: "1px dotted var(--ink-faint)", transform: "translateY(-3px)" }} />
                <span style={{ fontSize: 12.5, fontWeight: 500, whiteSpace: "nowrap" }}>{unitMoney(p.unitCost)}</span>
              </span>
              <span style={{ display: "flex", gap: 8, marginTop: 3, fontSize: 10.5, color: "var(--ink-soft)" }}>
                <span>{p.date}</span>
                {p.qty && <><span>·</span><span>{p.qty}</span></>}
                {p.invoice && <><span>·</span><span style={{ color: "var(--accent-deep)" }}>{p.invoice}</span></>}
              </span>
            </button>
          ))}
          <div style={{ fontSize: 10, letterSpacing: "0.1em", color: "var(--ink-soft)", marginTop: 10 }}>
            BOUGHT FROM {suppliers} SUPPLIER{suppliers === 1 ? "" : "S"} · {buys.length} INVOICE{buys.length === 1 ? "" : "S"}
          </div>
        </div>
      )}
    </>
  );
}