import React, { useState } from "react";
import { MONO, SANS } from "./ClientChrome";
import { calculateStandardizedCost } from "../../lib/standardizedUnits";

/**
 * IngredientDetail — what opens when an ingredient is picked from the list or
 * a crate on the walk-in shelf: the crate pulled off the shelf.
 *
 *   Top:    small crate (fill = on hand / newest delivery), name and supplier,
 *           price with its change since the first recorded month, and four
 *           tape-labeled tiles: On hand, Use within, Bought, Spend.
 *   Bottom: price per unit on graph paper (one dot per delivery), the
 *           delivery log (tap a line to open the invoice), and "Goes into":
 *           pinned tickets for the dishes that use it, with cost per plate.
 *
 * Expects IngredientsScreen's decorated ingredient (price, awaiting,
 * estimated, spanPct, history, purchases, menuItems) plus the shelf fields
 * from pages/client/ingredients.js (onHand, fillPct, daysLeft,
 * boughtPerWeek, spend30, shelf, delivered). Purchases carry `iso`; menu
 * items carry `category`, `quantity` and `recipeUnit`.
 *
 * stacked: single column for phones.
 */

const TAPE_BG = "#efe5cf";
const TAPE_INK = "#141a1b";
const MONTHS = { JAN: "January", FEB: "February", MAR: "March", APR: "April", MAY: "May", JUN: "June", JUL: "July", AUG: "August", SEP: "September", OCT: "October", NOV: "November", DEC: "December" };
const SHELF_NAMES = { protein: "Proteins", fresh: "Produce & dairy", dry: "Dry & pantry" };

// Prices tracked per oz read better per lb; everything else shows as tracked.
function displayUnit(unit) {
  return unit === "oz" ? { unit: "lb", factor: 16 } : { unit: unit || "ea", factor: 1 };
}
const money2 = (n) => "$" + (Number(n) || 0).toFixed(2);
const money0 = (n) => "$" + Math.round(Number(n) || 0).toLocaleString("en-US");
function qtyLabel(n, unit) {
  if (n == null || !isFinite(n) || n <= 0) return "—";
  let v = Number(n);
  let u = unit || "";
  if (u === "oz" && v >= 32) { v /= 16; u = "lb"; }
  else if (u === "fl oz" && v >= 128) { v /= 128; u = "gal"; }
  const r = v >= 100 ? Math.round(v) : Math.round(v * 10) / 10;
  return `${r.toLocaleString("en-US")}${u ? " " + u : ""}`;
}
function useByLabel(daysLeft) {
  const d = new Date();
  d.setDate(d.getDate() + daysLeft);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function Tile({ label, tilt, value, valueColor, sub }) {
  return (
    <div style={{ position: "relative", padding: "16px 12px 10px", background: "var(--paper)", border: "1px solid var(--paper-line)", borderRadius: 6, minWidth: 0 }}>
      <span style={{ position: "absolute", left: 10, top: -8, padding: "2px 7px", background: TAPE_BG, transform: `rotate(${tilt})`, fontFamily: MONO, fontSize: 8.5, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: TAPE_INK }}>{label}</span>
      <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: "-0.02em", color: valueColor || "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{value}</div>
      <div style={{ fontFamily: MONO, fontSize: 9.5, color: "var(--faint)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</div>
    </div>
  );
}

function SectionTitle({ children, right }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8, gap: 10 }}>
      <span style={{ fontFamily: MONO, fontSize: 10.5, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text)" }}>{children}</span>
      {right}
    </div>
  );
}

function PriceChart({ points, disp }) {
  if (points.length < 2) {
    return (
      <div style={{ height: 150, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--paper)", border: "1px solid var(--paper-line)", borderRadius: 6, fontFamily: MONO, fontSize: 11, color: "var(--faint)" }}>
        {points.length ? "One delivery so far" : "No deliveries yet"}
      </div>
    );
  }
  const W = 400, H = 150, PADX = 24, PADY = 22;
  const t0 = points[0].t, t1 = points[points.length - 1].t;
  const vals = points.map((p) => p.v);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const span = hi - lo || hi * 0.1 || 1;
  const x = (t) => PADX + ((t - t0) / (t1 - t0 || 1)) * (W - PADX * 2);
  const y = (v) => H - PADY - ((v - (lo - span * 0.15)) / (span * 1.3)) * (H - PADY * 2);
  const coords = points.map((p) => [x(p.t), y(p.v)]);
  const months = [];
  points.forEach((p) => {
    const m = new Date(p.t).toLocaleDateString("en-US", { month: "short" }).toUpperCase();
    if (!months.some((e) => e.m === m)) months.push({ m, left: (x(p.t) / W) * 100 });
  });
  return (
    <div>
      <div style={{ position: "relative", height: H, backgroundColor: "var(--paper)", backgroundImage: "linear-gradient(var(--paper-line) 1px, transparent 1px), linear-gradient(90deg, var(--paper-line) 1px, transparent 1px)", backgroundSize: "18px 18px", border: "1px solid var(--paper-line)", borderRadius: 6, overflow: "hidden" }}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} aria-hidden="true">
          <polyline points={coords.map((c) => c.join(",")).join(" ")} fill="none" stroke="var(--accent-deep)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          {coords.map((c, i) => (
            <circle key={i} cx={c[0]} cy={c[1]} r={i === coords.length - 1 ? 6 : 5} fill={i === coords.length - 1 ? "var(--accent-deep)" : "var(--shell)"} stroke="var(--accent-deep)" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
          ))}
        </svg>
        <div style={{ position: "absolute", right: 12, top: 10, padding: "3px 7px", background: TAPE_BG, transform: "rotate(2deg)", fontFamily: MONO, fontSize: 10, fontWeight: 600, color: TAPE_INK }}>{money2(vals[vals.length - 1] * disp.factor)} now</div>
        <div style={{ position: "absolute", left: 10, bottom: 8, fontFamily: MONO, fontSize: 10, color: "var(--muted)" }}>{money2(lo * disp.factor)} low</div>
      </div>
      <div style={{ position: "relative", height: 14, marginTop: 6 }}>
        {months.map((e) => (
          <span key={e.m} style={{ position: "absolute", left: `${e.left}%`, transform: "translateX(-50%)", fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.08em", color: "var(--faint)" }}>{e.m}</span>
        ))}
      </div>
    </div>
  );
}

export default function IngredientDetail({ g, onBack, onOpenMenuItem, onOpenInvoice, stacked = false }) {
  const [allDishes, setAllDishes] = useState(false);
  const disp = displayUnit(g.unit);

  const priceText = g.awaiting ? "Awaiting price" : `${money2(g.price * disp.factor)}`;
  const changeText = g.spanPct != null && g.history.length > 1 && Math.abs(g.spanPct) >= 0.05
    ? `${g.spanPct > 0 ? "▲" : "▼"} ${Math.abs(g.spanPct).toFixed(1)}% since ${MONTHS[g.history[0].label] || g.history[0].label}`
    : g.estimated && !g.awaiting ? "Estimated · no invoice yet" : "";
  const changeColor = g.spanPct > 0 ? "var(--red)" : g.spanPct < 0 ? "var(--green)" : "var(--faint)";

  const points = (g.purchases || [])
    .filter((p) => p.iso && Number(p.unitCost) > 0)
    .map((p) => ({ t: Date.parse(`${p.iso}T12:00:00`), v: Number(p.unitCost) }))
    .sort((a, b) => a.t - b.t)
    .slice(-12);

  const dishes = (g.menuItems || []).map((m) => {
    const q = Number(m.quantity) || 0;
    const plate = !g.awaiting && q > 0
      ? calculateStandardizedCost(q, m.recipeUnit || g.unit, g.price, g.unit, g.name || "")
      : null;
    return { ...m, plateText: plate != null && isFinite(plate) && plate > 0 ? `${money2(plate)}/plate` : "—" };
  });
  const shownDishes = allDishes ? dishes : dishes.slice(0, 4);

  const perWeekDisplay = (Number(g.boughtPerWeek) || 0) / disp.factor;
  const impact = !g.awaiting && perWeekDisplay > 0 ? perWeekDisplay * 0.1 : null;

  const tile = { onHand: g.delivered ? qtyLabel(g.onHand, g.unit) : "—" };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: stacked ? "auto" : "100%", minHeight: 0, fontFamily: SANS }}>
      <div style={{ padding: "14px 20px 0", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexShrink: 0 }}>
        <button type="button" onClick={onBack} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: MONO, fontSize: 10.5, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--accent-deep)" }}>
          ← Back to the walk-in
        </button>
        <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--faint)" }}>{SHELF_NAMES[g.shelf] || ""}</span>
      </div>

      <div style={{ padding: "14px 20px 18px", display: "grid", gridTemplateColumns: stacked ? "1fr" : "170px minmax(0, 1fr)", gap: stacked ? 16 : 24, alignItems: "center", borderBottom: "1px dashed var(--line)", flexShrink: 0 }}>
        <div style={{ position: "relative", width: 170, height: 128, justifySelf: stacked ? "center" : "start", background: "var(--shell)", border: g.delivered ? "2px solid var(--line)" : "2px dashed var(--line)", borderTop: "none", borderRadius: "3px 3px 14px 14px" }}>
          {g.delivered && g.fillPct > 0 && (
            <>
              <div style={{ position: "absolute", left: 8, right: 8, bottom: 8, height: `max(0px, calc(${g.fillPct}% - 16px))`, background: "rgba(2,164,186,0.16)", borderRadius: "3px 3px 9px 9px" }} />
              <div style={{ position: "absolute", left: 8, right: 8, bottom: `max(8px, calc(${g.fillPct}% - 8px))`, borderTop: "1.5px dashed var(--accent-deep)" }} />
            </>
          )}
          <div style={{ position: "absolute", left: -5, right: -5, top: 0, height: 9, background: "var(--panel)", border: "1.5px solid var(--line)", borderRadius: 4 }} />
          <div style={{ position: "absolute", left: "12%", right: "12%", top: 22, padding: "8px 6px 9px", background: TAPE_BG, transform: "rotate(-1.5deg)", boxShadow: "0 1px 2px rgba(17,24,25,0.1)", display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
            <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: TAPE_INK, textAlign: "center", lineHeight: 1.2 }}>{g.name}</span>
            <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: "0.06em", color: "#5a6669" }}>{g.lastOrdered ? `REC'D ${g.lastOrdered}` : "NOT DELIVERED"}</span>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.035em", lineHeight: 1.1 }}>{g.name}</div>
              <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 4 }}>
                {g.supplier ? `${g.supplier} · last delivered ${g.lastOrdered || "—"}` : "No invoice yet"}
              </div>
            </div>
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <div style={{ fontSize: g.awaiting ? 15 : 24, fontWeight: 800, letterSpacing: "-0.035em", lineHeight: 1.1, color: g.awaiting ? "var(--faint)" : g.estimated ? "var(--amber)" : "var(--text)" }}>
                {priceText}
                {!g.awaiting && <span style={{ fontSize: 13, fontWeight: 600, color: "var(--muted)" }}> /{disp.unit}</span>}
              </div>
              {changeText && <div style={{ fontFamily: MONO, fontSize: 10.5, fontWeight: 600, color: changeColor, marginTop: 4 }}>{changeText}</div>}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: stacked ? "repeat(2, minmax(0, 1fr))" : "repeat(4, minmax(0, 1fr))", gap: stacked ? "18px 10px" : 10, marginTop: 4 }}>
            <Tile label="On hand" tilt="-2deg" value={tile.onHand} sub={g.delivered ? `${g.fillPct || 0}% of last delivery` : "never invoiced"} />
            <Tile
              label="Use within"
              tilt="1.5deg"
              value={g.daysLeft == null ? "—" : g.daysLeft < 0 ? "Past date" : g.daysLeft === 0 ? "Today" : g.daysLeft === 1 ? "1 day" : `${g.daysLeft} days`}
              valueColor={g.daysLeft != null && g.daysLeft <= 2 ? "var(--red)" : undefined}
              sub={g.daysLeft == null ? "nothing on hand" : `use by ${useByLabel(g.daysLeft)}`}
            />
            <Tile label="Bought" tilt="-1deg" value={g.boughtPerWeek > 0 ? `${qtyLabel(g.boughtPerWeek, g.unit)}/wk` : "—"} sub="last 4 weeks" />
            <Tile label="Spend" tilt="2deg" value={g.spend30 > 0 ? money0(g.spend30) : "—"} sub="last 30 days" />
          </div>
        </div>
      </div>

      <div style={{ flex: stacked ? "none" : 1, minHeight: 0, display: "grid", gridTemplateColumns: stacked ? "1fr" : "minmax(0, 1.15fr) minmax(0, 1fr)" }}>
        <div style={{ padding: "16px 20px", borderRight: stacked ? "none" : "1px dashed var(--line)", borderBottom: stacked ? "1px dashed var(--line)" : "none", display: "flex", flexDirection: "column", gap: 14, minHeight: 0 }}>
          <div>
            <SectionTitle right={<span style={{ fontFamily: MONO, fontSize: 10, color: "var(--faint)" }}>each dot is a delivery</span>}>
              Price per {disp.unit}
            </SectionTitle>
            <PriceChart points={points} disp={disp} />
          </div>

          <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <SectionTitle right={<span style={{ fontFamily: MONO, fontSize: 10, color: "var(--faint)" }}>tap to open the invoice</span>}>
              Delivery log
            </SectionTitle>
            <div style={{ position: "relative", flex: 1, minHeight: stacked ? 0 : 120, marginTop: 7, background: "var(--paper)", border: "1px solid var(--paper-line)", borderRadius: 6, padding: "14px 14px 6px" }}>
              <div style={{ position: "absolute", left: "50%", top: -7, transform: "translateX(-50%)", width: 70, height: 14, background: "var(--line)", borderRadius: 4 }} />
              <div style={{ maxHeight: stacked ? "none" : "100%", overflowY: stacked ? "visible" : "auto", position: stacked ? "static" : "absolute", inset: stacked ? "auto" : "14px 14px 6px" }}>
                {g.purchases.length === 0 && (
                  <div style={{ padding: "8px 0", fontFamily: MONO, fontSize: 11, color: "var(--faint)" }}>No deliveries yet</div>
                )}
                {g.purchases.map((p, i) => (
                  <button
                    key={`${p.invoiceId || p.invoice}-${i}`}
                    type="button"
                    onClick={() => onOpenInvoice && onOpenInvoice(p)}
                    style={{ width: "100%", display: "grid", gridTemplateColumns: "62px minmax(0, 1fr) auto", gap: 10, alignItems: "center", padding: "8px 0", background: "none", border: "none", borderBottom: "1px dotted var(--line)", cursor: "pointer", color: "var(--text)", textAlign: "left", fontFamily: SANS }}
                  >
                    <span style={{ justifySelf: "start", padding: "2px 6px", border: "1.5px solid var(--red)", borderRadius: 3, transform: "rotate(-3deg)", fontFamily: MONO, fontSize: 9.5, fontWeight: 600, letterSpacing: "0.06em", color: "var(--red)", whiteSpace: "nowrap" }}>{p.date}</span>
                    <span style={{ fontFamily: MONO, fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.qty} · #{p.invoice}</span>
                    <span style={{ fontFamily: MONO, fontSize: 11.5, fontWeight: 600 }}>{money2(Number(p.unitCost) * disp.factor)}/{disp.unit}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 10, minHeight: 0, background: "var(--panel)" }}>
          <SectionTitle
            right={dishes.length > 4 && (
              <button type="button" onClick={() => setAllDishes((v) => !v)} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: MONO, fontSize: 10, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--accent-deep)" }}>
                {allDishes ? "Show fewer" : `All ${dishes.length} dishes →`}
              </button>
            )}
          >
            Goes into
          </SectionTitle>
          <div style={{ flex: stacked ? "none" : 1, minHeight: 0, overflowY: stacked ? "visible" : "auto", padding: "8px 2px 4px" }}>
            {dishes.length === 0 ? (
              <div style={{ fontFamily: MONO, fontSize: 11, color: "var(--faint)" }}>Not on any dish yet</div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "18px 12px" }}>
                {shownDishes.map((m, i) => (
                  <button
                    key={`${m.id}-${i}`}
                    type="button"
                    onClick={() => onOpenMenuItem && onOpenMenuItem(m)}
                    style={{ position: "relative", display: "flex", flexDirection: "column", gap: 6, padding: "16px 12px 12px", background: "var(--shell)", border: "1px solid var(--paper-line)", borderRadius: 2, boxShadow: "0 2px 5px rgba(17,24,25,0.07)", cursor: "pointer", color: "var(--text)", textAlign: "left", fontFamily: SANS }}
                  >
                    <span style={{ position: "absolute", left: "50%", top: -6, transform: "translateX(-50%)", width: 12, height: 12, borderRadius: "50%", background: "var(--ink)", boxShadow: "0 1px 2px rgba(17,24,25,0.35)" }} />
                    <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--faint)" }}>{m.category || "Menu"}</span>
                    <span style={{ fontSize: 13.5, fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1.2 }}>{m.name}</span>
                    <span style={{ borderTop: "1px dashed var(--line)", marginTop: 2 }} />
                    <span style={{ display: "flex", justifyContent: "space-between", gap: 8, fontFamily: MONO, fontSize: 10.5, color: "var(--muted)" }}>
                      <span>{m.qty || "—"}</span>
                      <span style={{ fontWeight: 600, color: "var(--text)" }}>{m.plateText}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {impact != null && impact >= 0.5 && (
            <div style={{ padding: "10px 12px", border: "1px dashed var(--line)", borderRadius: 6, fontSize: 12.5, color: "var(--muted)", lineHeight: 1.45, flexShrink: 0 }}>
              At <b style={{ color: "var(--text)" }}>{money2(g.price * disp.factor)}/{disp.unit}</b>, every 10¢ rise adds about{" "}
              <b style={{ color: "var(--red)" }}>{money0(impact)} a week</b> to what you spend on it.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}