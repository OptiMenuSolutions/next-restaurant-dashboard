import React, { useMemo, useState } from "react";
import { MONO, SANS } from "./ClientChrome";

/**
 * WalkInShelf — the Ingredients page's right-hand card when no ingredient is
 * selected: a walk-in rack of crates, one crate per ingredient.
 *
 * Views
 *   Operational — Use first / High usage / Price watch / Pantry staples. Each
 *                 ingredient appears once. Placement priority: Use first, then
 *                 Price watch, then High usage, then Pantry staples, so a price
 *                 rise on a big seller is never hidden under High usage.
 *   By shelf    — Proteins / Produce & dairy / Dry & pantry, by 30-day spend.
 *   A – Z       — alphabetical, on hand.
 * "See all N" opens one shelf across the whole rack.
 *
 * Expects IngredientsScreen's decorated ingredients (id, name, unit, pct)
 * plus the fields pages/client/ingredients.js adds: onHand, fillPct,
 * daysLeft, boughtPerWeek, spend30, shelf ('protein' | 'fresh' | 'dry'),
 * delivered (has ever been on an invoice).
 *
 * Fill = on hand / size of the newest delivery, capped at 100%. An ingredient
 * never invoiced has nothing to measure: its bin is drawn dashed and empty.
 */

const PER_SHELF = 4;
const TILTS = ["-1deg", "0.8deg", "-0.4deg", "0.5deg"];

// Colors on the masking-tape label: the tape is light in both themes, so
// these stay fixed instead of following the theme.
const TAPE = { red: "#b23b33", amber: "#8a5d0f", green: "#2f7d44", teal: "#03808f", ink: "#141a1b" };

function qtyLabel(n, unit) {
  if (n == null || !isFinite(n) || n <= 0) return "—";
  let v = Number(n);
  let u = unit || "";
  if (u === "oz" && v >= 32) { v /= 16; u = "lb"; }
  else if (u === "fl oz" && v >= 128) { v /= 128; u = "gal"; }
  const r = v >= 100 ? Math.round(v) : Math.round(v * 10) / 10;
  return `${r.toLocaleString("en-US")}${u ? " " + u : ""}`;
}
const money0 = (n) => (n > 0 ? "$" + Math.round(n).toLocaleString("en-US") : "—");
const daysLabel = (d) => (d < 0 ? "Past date" : d === 0 ? "Today" : d === 1 ? "1 day" : `${d} days`);
const byName = (a, b) => (a.name || "").localeCompare(b.name || "");
const bySpend = (a, b) => (b.spend30 || 0) - (a.spend30 || 0) || byName(a, b);

function buildShelves(all, view) {
  if (view === "category") {
    const group = (key) => all.filter((g) => g.shelf === key).sort(bySpend);
    const metricOf = (g) => ({ text: money0(g.spend30), color: TAPE.ink });
    return [
      { label: "Proteins", note: "30-day spend", dot: "var(--red)", items: group("protein"), metricOf, empty: "No proteins yet" },
      { label: "Produce & dairy", note: "30-day spend", dot: "var(--green)", items: group("fresh"), metricOf, empty: "No produce or dairy yet" },
      { label: "Dry & pantry", note: "30-day spend", dot: "var(--faint)", items: group("dry"), metricOf, empty: "No dry goods yet" },
    ];
  }

  if (view === "az") {
    const sorted = [...all].sort(byName);
    const first = (g) => (g.name || "").trim().charAt(0).toUpperCase();
    const between = (g, lo, hi) => { const c = first(g); return c >= lo && c <= hi; };
    const metricOf = (g) => ({ text: qtyLabel(g.onHand, g.unit), color: TAPE.ink });
    return [
      { label: "A – F", note: "on hand", dot: "var(--faint)", items: sorted.filter((g) => !between(g, "G", "Z")), metricOf, empty: "Nothing here" },
      { label: "G – O", note: "on hand", dot: "var(--faint)", items: sorted.filter((g) => between(g, "G", "O")), metricOf, empty: "Nothing here" },
      { label: "P – Z", note: "on hand", dot: "var(--faint)", items: sorted.filter((g) => between(g, "P", "Z")), metricOf, empty: "Nothing here" },
    ];
  }

  // Operational: place in priority order, display in shelf order.
  const placed = new Set();
  const take = (list) => {
    const out = list.filter((g) => !placed.has(g.id));
    out.forEach((g) => placed.add(g.id));
    return out;
  };
  const useFirst = take(all.filter((g) => g.onHand > 0 && g.daysLeft != null && g.daysLeft <= 2).sort((a, b) => a.daysLeft - b.daysLeft));
  const priceWatch = take(all.filter((g) => g.pct != null && Math.abs(g.pct) >= 3).sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct)));
  const highUsage = take(all.filter((g) => g.boughtPerWeek > 0 && g.shelf !== "dry").sort(bySpend));
  const pantry = take(all.filter((g) => g.shelf === "dry").sort(bySpend));

  return [
    {
      label: "Use first", note: "days left", dot: "var(--red)", items: useFirst, tint: "red",
      metricOf: (g) => ({ text: daysLabel(g.daysLeft), color: g.daysLeft <= 1 ? TAPE.red : TAPE.amber }),
      empty: "Nothing close to expiring",
    },
    {
      label: "High usage", note: "bought per week", dot: "var(--accent)", items: highUsage,
      metricOf: (g) => ({ text: `${qtyLabel(g.boughtPerWeek, g.unit)}/wk`, color: TAPE.teal }),
      empty: "Needs a few weeks of invoices",
    },
    {
      label: "Price watch", note: "vs last invoice", dot: "var(--amber)", items: priceWatch,
      metricOf: (g) => ({ text: `${g.pct > 0 ? "+" : "−"}${Math.abs(Math.round(g.pct))}%`, color: g.pct > 0 ? TAPE.red : TAPE.green }),
      empty: "No price changes over 3%",
    },
    {
      label: "Pantry staples", note: "on hand", dot: "var(--faint)", items: pantry,
      metricOf: (g) => ({ text: qtyLabel(g.onHand, g.unit), color: TAPE.ink }),
      empty: "No dry goods yet",
    },
  ];
}

const VIEWS = [
  { id: "operational", label: "Operational", title: "What needs your attention", subtitle: "Each ingredient sits on the first shelf it belongs to." },
  { id: "category", label: "By shelf", title: "Your walk-in, by shelf", subtitle: "Grouped the way the kitchen stores it, biggest spend first." },
  { id: "az", label: "A – Z", title: "Every ingredient, A to Z", subtitle: "For finding one fast. Tap a crate to open it." },
];

function chunk(list, n) {
  const out = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out.length ? out : [[]];
}

export default function WalkInShelf({ all = [], onPick }) {
  const [view, setView] = useState("operational");
  const [focus, setFocus] = useState(null);
  const shelves = useMemo(() => buildShelves(all, view), [all, view]);
  const viewMeta = VIEWS.find((v) => v.id === view);
  const focused = focus ? shelves.find((s) => s.label === focus) : null;

  const rows = focused
    ? chunk(focused.items, PER_SHELF).map((items, i) => ({
        ...focused,
        label: i ? "" : focused.label,
        note: i ? "" : focused.note,
        dot: i ? "transparent" : focused.dot,
        items,
        expandable: false,
      }))
    : shelves.map((s) => ({ ...s, total: s.items.length, items: s.items.slice(0, PER_SHELF), expandable: s.items.length > PER_SHELF }));

  const lipText = { fontFamily: MONO, fontSize: 10.5, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text)" };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{ padding: "16px 20px 12px", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexShrink: 0 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--accent-deep)", marginBottom: 5 }}>The walk-in</div>
          <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.03em" }}>{focused ? focused.label : viewMeta.title}</div>
          <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 3 }}>
            {focused ? `All ${focused.items.length} ingredients on this shelf.` : viewMeta.subtitle}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          {focused && (
            <button type="button" onClick={() => setFocus(null)} style={{ border: "1px solid var(--line)", borderRadius: 20, padding: "8px 13px", background: "var(--shell)", fontFamily: SANS, fontSize: 12, fontWeight: 700, color: "var(--accent-deep)", cursor: "pointer" }}>
              ← Back to the walk-in
            </button>
          )}
          <div style={{ display: "flex", border: "1px solid var(--line)", borderRadius: 20, padding: 3, gap: 2 }}>
            {VIEWS.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => { setView(v.id); setFocus(null); }}
                style={{ border: "none", borderRadius: 16, padding: "7px 13px", fontFamily: SANS, fontSize: 12, fontWeight: 700, cursor: "pointer", background: view === v.id ? "var(--accent-tint)" : "transparent", color: view === v.id ? "var(--accent-deep)" : "var(--muted)" }}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, padding: "4px 22px 0", display: "flex", flexDirection: "column" }}>
        {/* The rack: the two uprights are the scroll area's side borders. */}
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4, borderLeft: "9px solid var(--line)", borderRight: "9px solid var(--line)", borderRadius: 5 }}>
          {rows.map((s, si) => (
            <div key={`${s.label}-${si}`} style={{ display: "flex", flexDirection: "column", flex: focused ? "0 0 auto" : "1 0 auto" }}>
              <div style={{ flex: 1, display: "grid", gridTemplateColumns: `repeat(${PER_SHELF}, minmax(0, 1fr))`, gap: 14, padding: "16px 16px 0", alignItems: "end", alignContent: "end" }}>
                {s.items.length === 0 && (
                  <div style={{ gridColumn: "1 / -1", height: 60, display: "flex", alignItems: "center", fontFamily: MONO, fontSize: 11, letterSpacing: "0.06em", color: "var(--faint)" }}>
                    {s.empty}
                  </div>
                )}
                {s.items.map((g, ci) => {
                  const m = s.metricOf(g);
                  const fillColor = s.tint === "red" ? "rgba(196,71,62,0.18)" : "rgba(2,164,186,0.16)";
                  return (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => onPick && onPick(g)}
                      title={g.delivered ? `${g.name}: ${qtyLabel(g.onHand, g.unit)} on hand` : `${g.name}: never invoiced`}
                      aria-label={`Open ${g.name}, ${m.text}`}
                      className="om-hover-accent"
                      style={{ position: "relative", height: 96, padding: 0, background: "var(--shell)", border: g.delivered ? "1.5px solid var(--line)" : "1.5px dashed var(--line)", borderTop: "none", borderRadius: "2px 2px 10px 10px", cursor: "pointer", fontFamily: SANS }}
                    >
                      {g.delivered && g.fillPct > 0 && (
                        <div style={{ position: "absolute", left: 7, right: 7, bottom: 7, height: `${g.fillPct}%`, maxHeight: "calc(100% - 14px)", background: fillColor, borderRadius: "2px 2px 7px 7px" }} />
                      )}
                      <div style={{ position: "absolute", left: -4, right: -4, top: 0, height: 7, background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 3 }} />
                      <div style={{ position: "absolute", left: "13%", right: "13%", top: 16, padding: "7px 4px 8px", background: "#efe5cf", transform: `rotate(${TILTS[(ci + si) % TILTS.length]})`, boxShadow: "0 1px 1px rgba(17,24,25,0.08)", display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                        <span style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: TAPE.ink, lineHeight: 1.2, textAlign: "center", overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{g.name}</span>
                        <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: "-0.02em", color: m.color }}>{m.text}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
              <div style={{ height: 28, boxSizing: "border-box", padding: "0 14px", marginTop: 0, background: "var(--panel)", borderTop: "1px solid var(--line)", borderBottom: "3px solid var(--line)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ ...lipText, display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: s.dot }} />
                  {s.label}
                  {s.note && <span style={{ fontWeight: 400, letterSpacing: "0.06em", textTransform: "none", color: "var(--muted)" }}>{s.note}</span>}
                </span>
                {s.expandable && (
                  <button type="button" onClick={() => setFocus(s.label)} style={{ border: "none", background: "none", padding: "4px 0", fontFamily: MONO, fontSize: 10, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--accent-deep)", cursor: "pointer" }}>
                    See all {s.total} →
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ padding: "10px 20px", borderTop: "1px solid var(--line)", display: "flex", justifyContent: "space-between", flexShrink: 0, fontFamily: MONO, fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--faint)" }}>
        <span>Tap a crate to open that ingredient</span>
        <span>{all.length} ingredients</span>
      </div>
    </div>
  );
}