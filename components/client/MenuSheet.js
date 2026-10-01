import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Head from "next/head";
import { MONO, SANS } from "./ClientChrome";

/**
 * MenuSheet — the Menu Items page's right-hand card when no dish is selected:
 * the restaurant's own menu, typeset like the printed one and marked up the
 * way an owner marks up a menu.
 *
 * Views
 *   Menu engineering — the four marks (classic menu engineering):
 *                        star (popular, high contribution)  -> highlighter
 *                        plowhorse (popular, low)            -> "raise it" sticky
 *                        puzzle (slow, high)                 -> red circle
 *                        dog (slow, low)                     -> line through
 *   By section       — the menu as printed, no marks.
 *   A – Z            — every dish alphabetically.
 * Front / Back tabs when the menu has more than one side.
 * Each side fits the card: 2 or 3 columns, then scaled down (never below
 * MIN_SCALE; only then does it scroll).
 *
 * Props
 *   dishes   decorated dishes from MenuItemsScreen: id, name, category, price,
 *            cost, covers, awaiting, plus optional sortOrder, menuSide, variantOf
 *   sections optional [{ name, side, order, note, boxed }] from menu_categories
 *   menuStyle optional { font: 'typewriter'|'serif'|'sans'|'script', accent, files: [url] }
 *   restaurantName, onOpenDish(dish)
 *
 * Classification uses contribution margin in dollars (price - cost) against
 * the sales-weighted average, and popularity against 70% of an even share of
 * sales. Dishes awaiting pricing, or any menu with no sales yet, stay unmarked.
 */

const PAPER = "#fbfaf6";
const INK = "#1d1d1b";
const SOFT = "#5d5a52";
const RULE = "#c9c3b6";
const RED = "#c4473e";
const MIN_SCALE = 0.62;

const FONTS = {
  typewriter: "'Courier Prime', 'Courier New', monospace",
  serif: "'Playfair Display', Georgia, serif",
  sans: "'Manrope', system-ui, sans-serif",
  script: "'Playfair Display', Georgia, serif",
};

const VIEWS = [
  { id: "engineering", label: "Menu engineering", title: "Your menu, marked up", subtitle: "Marked by what each dish earns and how well it sells." },
  { id: "section", label: "By section", title: "Your menu, as printed", subtitle: "Sections and dishes in the order the menu prints them." },
  { id: "az", label: "A – Z", title: "Every dish, A to Z", subtitle: "For finding one fast. Tap a dish to open its recipe." },
];

const money = (n) => (Number(n) || 0).toFixed(2);
const low = (s) => String(s || "").toLowerCase().trim();

/* Variants print as one line ("Sizzling Fajitas  27.95–30.95"). A dish is a
   variant when variant_of is saved, or when "Parent - Variant" shares its
   parent with another dish in the same section. */
function groupLines(dishes) {
  const byParent = new Map();
  for (const d of dishes) {
    const parent = d.variantOf || (String(d.name).includes(" - ") ? String(d.name).split(" - ")[0].trim() : null);
    if (!parent) continue;
    const k = low(parent);
    byParent.set(k, [...(byParent.get(k) || []), d]);
  }
  const used = new Set();
  const lines = [];
  for (const d of dishes) {
    if (used.has(d.id)) continue;
    const parent = d.variantOf || (String(d.name).includes(" - ") ? String(d.name).split(" - ")[0].trim() : null);
    const group = parent ? byParent.get(low(parent)) : null;
    if (group && group.length > 1) {
      group.forEach((g) => used.add(g.id));
      lines.push({ key: `g:${low(parent)}`, name: parent, dishes: group });
    } else {
      used.add(d.id);
      lines.push({ key: d.id, name: d.name, dishes: [d] });
    }
  }
  return lines;
}

/* Menu engineering per printed line (a variant group counts as one line). */
function classify(lines) {
  const known = lines.filter((l) => l.dishes.every((d) => !d.awaiting && d.price > 0));
  const totalCovers = known.reduce((a, l) => a + l.dishes.reduce((b, d) => b + (d.covers || 0), 0), 0);
  const result = new Map();
  if (!known.length || totalCovers <= 0) return result;
  let cmSum = 0;
  for (const l of known) for (const d of l.dishes) cmSum += (d.price - d.cost) * (d.covers || 0);
  const avgCM = cmSum / totalCovers;
  const popBar = (1 / known.length) * 0.7;
  for (const l of known) {
    const covers = l.dishes.reduce((a, d) => a + (d.covers || 0), 0);
    const cm = covers
      ? l.dishes.reduce((a, d) => a + (d.price - d.cost) * (d.covers || 0), 0) / covers
      : l.dishes.reduce((a, d) => a + (d.price - d.cost), 0) / l.dishes.length;
    const popular = covers / totalCovers >= popBar;
    const rich = cm >= avgCM;
    const mark = popular && rich ? "star" : popular ? "plowhorse" : rich ? "puzzle" : "dog";
    const raise = mark === "plowhorse" ? Math.max(0.5, Math.ceil((avgCM - cm) * 2) / 2) : null;
    result.set(l.key, { mark, covers, cm, raise });
  }
  return result;
}

function priceText(line) {
  const ps = line.dishes.map((d) => Number(d.price) || 0).filter((p) => p > 0);
  if (!ps.length) return "";
  const lo = Math.min(...ps), hi = Math.max(...ps);
  return lo === hi ? money(lo) : `${money(lo)}–${money(hi)}`;
}

function marginText(line) {
  const priced = line.dishes.filter((d) => !d.awaiting && d.price > 0);
  if (!priced.length) return null;
  const m = priced.reduce((a, d) => a + ((d.price - d.cost) / d.price) * 100, 0) / priced.length;
  return `${Math.round(m)}% margin`;
}

function DishLine({ line, info, engineering, open, onToggle, onOpenDish, font }) {
  const mark = engineering && info ? info.mark : null;
  const covers = line.dishes.reduce((a, d) => a + (d.covers || 0), 0);
  const m = marginText(line);
  const stats = m == null ? "Waiting on prices" : `${m}${covers ? ` · ${covers} sold` : " · no sales yet"}`;
  return (
    <div style={{ breakInside: "avoid" }}>
      <button
        type="button"
        onClick={onToggle}
        style={{ display: "block", width: "100%", textAlign: "left", background: open ? "rgba(2,164,186,0.08)" : "transparent", border: "none", borderRadius: 3, padding: "4px 4px", margin: "0 -4px", cursor: "pointer", fontFamily: font, color: INK }}
      >
        <span style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
          <span style={{ position: "relative", fontSize: 13, fontWeight: 700, padding: "1px 3px", marginLeft: -3, borderRadius: 2, background: mark === "star" ? "linear-gradient(100deg, rgba(255,214,0,0.15) 0%, rgba(255,214,0,0.55) 6%, rgba(255,214,0,0.5) 94%, rgba(255,214,0,0.2) 100%)" : "transparent" }}>
            {line.name}
            {mark === "puzzle" && (
              <span style={{ position: "absolute", left: -9, right: -9, top: -7, bottom: -7, border: `1.8px solid ${RED}`, borderLeftColor: "transparent", borderRadius: "50%", transform: "rotate(-2.5deg)", pointerEvents: "none" }} />
            )}
            {mark === "dog" && (
              <span style={{ position: "absolute", left: -3, right: -3, top: "54%", borderTop: `2px solid ${RED}`, transform: "rotate(-2.5deg)", pointerEvents: "none" }} />
            )}
          </span>
          <span style={{ flex: 1, borderBottom: "1px dotted #b3ad9f", transform: "translateY(-3px)" }} />
          <span style={{ fontSize: 12.5, fontWeight: 700, whiteSpace: "nowrap" }}>{priceText(line)}</span>
          {mark === "plowhorse" && (
            <span style={{ display: "inline-block", marginLeft: 4, padding: "2px 6px 1px", background: "#ffe680", boxShadow: "0 1px 2px rgba(17,24,25,0.18)", transform: "rotate(3deg)", fontFamily: "'Caveat', cursive", fontSize: 15, fontWeight: 700, color: "#7a4b00", lineHeight: 1, whiteSpace: "nowrap" }}>
              ↑ ${info.raise % 1 ? info.raise.toFixed(2) : info.raise}?
            </span>
          )}
        </span>
      </button>
      {open && (
        <div style={{ margin: "2px 0 4px", padding: "5px 0 2px", borderTop: `1px dashed ${RULE}`, fontFamily: MONO, fontSize: 10, color: SOFT }}>
          <div>{stats}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 10px", marginTop: 4 }}>
            {line.dishes.map((d) => (
              <button key={d.id} type="button" onClick={() => onOpenDish && onOpenDish(d)} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: MONO, fontSize: 10, fontWeight: 600, color: "#03808f" }}>
                {line.dishes.length > 1 ? `${String(d.name).split(" - ").slice(1).join(" - ") || d.name} →` : "Open recipe →"}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Key() {
  const item = { display: "flex", alignItems: "center", gap: 6 };
  return (
    <div style={{ marginTop: 10, paddingTop: 12, borderTop: `1.5px solid ${RULE}`, display: "flex", flexWrap: "wrap", gap: "10px 22px", fontFamily: SANS, fontSize: 11.5, color: "#3d3a34" }}>
      <span style={{ fontFamily: MONO, fontSize: 10.5, fontWeight: 600, letterSpacing: "0.14em" }}>KEY</span>
      <span style={item}><span style={{ padding: "0 4px", background: "rgba(255,214,0,0.55)", fontWeight: 700 }}>Dish</span> star: protect it</span>
      <span style={item}><span style={{ padding: "1px 6px 0", background: "#ffe680", transform: "rotate(3deg)", fontFamily: "'Caveat', cursive", fontSize: 14, fontWeight: 700, color: "#7a4b00" }}>↑ $1?</span> popular, thin margin: raise it</span>
      <span style={item}><span style={{ padding: "1px 8px", border: `1.8px solid ${RED}`, borderLeftColor: "transparent", borderRadius: "50%", fontWeight: 700 }}>Dish</span> profitable, slow: push it</span>
      <span style={item}><span style={{ position: "relative", fontWeight: 700 }}>Dish<span style={{ position: "absolute", left: -2, right: -2, top: "54%", borderTop: `2px solid ${RED}`, transform: "rotate(-2.5deg)" }} /></span> slow, thin: rework or drop</span>
    </div>
  );
}

export default function MenuSheet({ dishes = [], sections = null, menuStyle = null, restaurantName = "", onOpenDish }) {
  const [view, setView] = useState("engineering");
  const [side, setSide] = useState(null);
  const [openKey, setOpenKey] = useState(null);
  const [scale, setScale] = useState(1);
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const areaRef = useRef(null);
  const sheetRef = useRef(null);

  const style = menuStyle || {};
  const font = FONTS[style.font] || FONTS.sans;
  const accent = /^#[0-9a-f]{3,8}$/i.test(style.accent || "") ? style.accent : "#03808f";
  const originalUrl = Array.isArray(style.files) && style.files.length ? style.files[0] : null;

  // Sides present on this menu (1 = first file). One side means no tabs.
  const sides = useMemo(() => {
    const s = new Set(dishes.map((d) => d.menuSide).filter((v) => v != null));
    (sections || []).forEach((sec) => sec.side != null && s.add(sec.side));
    return [...s].sort((a, b) => a - b);
  }, [dishes, sections]);
  const activeSide = sides.length > 1 ? (sides.includes(side) ? side : sides[0]) : null;

  // Sections in printed order: saved order first, then order of first appearance.
  const blocks = useMemo(() => {
    const sorted = [...dishes].sort((a, b) => (a.sortOrder ?? 1e9) - (b.sortOrder ?? 1e9));
    if (view === "az") {
      const byLetter = new Map();
      [...dishes].sort((a, b) => String(a.name).localeCompare(String(b.name))).forEach((d) => {
        const L = String(d.name).trim().charAt(0).toUpperCase() || "#";
        byLetter.set(L, [...(byLetter.get(L) || []), d]);
      });
      return [...byLetter.entries()].map(([L, list]) => ({ name: L, note: "", boxed: false, lines: list.map((d) => ({ key: d.id, name: d.name, dishes: [d] })) }));
    }
    const meta = new Map((sections || []).map((s) => [low(s.name), s]));
    const order = [];
    const byCat = new Map();
    for (const d of sorted) {
      if (activeSide != null && d.menuSide != null && d.menuSide !== activeSide) continue;
      const k = low(d.category) || "menu";
      if (!byCat.has(k)) { byCat.set(k, []); order.push(k); }
      byCat.get(k).push(d);
    }
    order.sort((a, b) => {
      const sa = meta.get(a), sb = meta.get(b);
      return (sa?.order ?? 1e9) - (sb?.order ?? 1e9);
    });
    return order.map((k) => {
      const list = byCat.get(k);
      const m = meta.get(k) || {};
      return { name: m.name || list[0].category || "Menu", note: m.note || "", boxed: !!m.boxed, lines: groupLines(list) };
    });
  }, [dishes, sections, view, activeSide]);

  const marks = useMemo(() => classify(groupLines([...dishes])), [dishes]);
  const lineCount = blocks.reduce((a, b) => a + b.lines.length + 2, 0);
  const columns = lineCount > 34 ? 3 : 2;
  const waiting = dishes.filter((d) => d.awaiting).length;
  const noSales = !dishes.some((d) => (d.covers || 0) > 0);

  // Fit the side to the card: measure at full size, then scale down.
  useLayoutEffect(() => {
    const el = sheetRef.current;
    if (!el) return;
    setNatural({ w: el.offsetWidth, h: el.offsetHeight });
  }, [blocks, columns, view, openKey]);
  useEffect(() => {
    const area = areaRef.current;
    if (!area || !natural.h) return;
    const fit = () => {
      const s = Math.min(1, (area.clientHeight - 8) / natural.h, (area.clientWidth - 8) / natural.w);
      setScale(Math.max(MIN_SCALE, s));
    };
    fit();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(fit) : null;
    if (ro) ro.observe(area);
    return () => ro && ro.disconnect();
  }, [natural]);

  const viewMeta = VIEWS.find((v) => v.id === view);
  const engineering = view === "engineering";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <Head>
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Courier+Prime:wght@400;700&family=Playfair+Display:wght@600;700&family=Caveat:wght@600;700&display=swap" />
      </Head>

      <div style={{ padding: "16px 20px 10px", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexShrink: 0 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--accent-deep)", marginBottom: 5 }}>The menu</div>
          <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.03em" }}>{viewMeta.title}</div>
          <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 3 }}>
            {engineering && noSales ? "Marks appear once POS sales come in." : viewMeta.subtitle}
          </div>
        </div>
        <div style={{ display: "flex", border: "1px solid var(--line)", borderRadius: 20, padding: 3, gap: 2, flexShrink: 0 }}>
          {VIEWS.map((v) => (
            <button key={v.id} type="button" onClick={() => { setView(v.id); setOpenKey(null); }} style={{ border: "none", borderRadius: 16, padding: "7px 13px", fontFamily: SANS, fontSize: 12, fontWeight: 700, cursor: "pointer", background: view === v.id ? "var(--accent-tint)" : "transparent", color: view === v.id ? "var(--accent-deep)" : "var(--muted)" }}>
              {v.label}
            </button>
          ))}
        </div>
      </div>

      <div ref={areaRef} style={{ flex: 1, minHeight: 0, overflow: scale <= MIN_SCALE ? "auto" : "hidden", background: "var(--panel)", padding: "14px 18px 10px", display: "flex", flexDirection: "column", alignItems: "center" }}>
        {view !== "az" && sides.length > 1 && (
          <div style={{ alignSelf: "stretch", display: "flex", gap: 6, paddingLeft: 22, flexShrink: 0 }}>
            {sides.map((s, i) => (
              <button key={s} type="button" onClick={() => { setSide(s); setOpenKey(null); }} style={{ border: "1px solid #cfd2cc", borderBottom: "none", borderRadius: "6px 6px 0 0", padding: "6px 14px 5px", fontFamily: MONO, fontSize: 10, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", cursor: "pointer", background: s === activeSide ? PAPER : "#d3d9da", color: s === activeSide ? accent : "#5a6669" }}>
                {sides.length === 2 ? (i === 0 ? "Front" : "Back") : `Page ${i + 1}`}
              </button>
            ))}
          </div>
        )}

        <div style={{ width: natural.w ? natural.w * scale : "100%", height: natural.h ? natural.h * scale : "auto", flexShrink: 0 }}>
          <div
            ref={sheetRef}
            style={{ width: columns === 3 ? 980 : 760, transform: `scale(${scale})`, transformOrigin: "top left", position: "relative", background: PAPER, border: "1px solid #cfd2cc", borderRadius: 3, boxShadow: "0 2px 4px rgba(17,24,25,0.06), 0 14px 30px rgba(17,24,25,0.10)", padding: "30px 34px 24px", boxSizing: "border-box", fontFamily: font, color: INK }}
          >
            <div style={{ textAlign: "center", marginBottom: 18 }}>
              <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase", color: accent }}>{restaurantName}</div>
              <div style={{ margin: "7px auto 0", width: 170, borderTop: `1.5px solid ${accent}` }} />
            </div>

            <div style={{ columnCount: columns, columnGap: 30 }}>
              {blocks.map((b) => (
                <div key={b.name} style={{ breakInside: "avoid", marginBottom: 16, padding: b.boxed ? "10px 12px 8px" : 0, border: b.boxed ? `1.5px solid ${accent}` : "none" }}>
                  <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: accent }}>{b.name}</div>
                  {b.note && <div style={{ fontSize: 11, fontStyle: "italic", color: SOFT, marginTop: 2, lineHeight: 1.35 }}>{b.note}</div>}
                  <div style={{ borderTop: `1px solid ${RULE}`, margin: "5px 0 3px" }} />
                  {b.lines.map((l) => (
                    <DishLine
                      key={l.key}
                      line={l}
                      info={marks.get(l.key)}
                      engineering={engineering}
                      open={openKey === l.key}
                      onToggle={() => setOpenKey(openKey === l.key ? null : l.key)}
                      onOpenDish={onOpenDish}
                      font={font}
                    />
                  ))}
                </div>
              ))}
            </div>

            {engineering && !noSales && <Key />}
          </div>
        </div>
      </div>

      <div style={{ padding: "10px 20px", borderTop: "1px solid var(--line)", display: "flex", justifyContent: "space-between", flexShrink: 0, fontFamily: MONO, fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--faint)" }}>
        <span>{waiting ? `${waiting} dish${waiting === 1 ? "" : "es"} waiting on prices` : "Every dish priced"}</span>
        {originalUrl ? (
          <a href={originalUrl} target="_blank" rel="noreferrer" style={{ textDecoration: "none", fontWeight: 600, color: "var(--accent-deep)" }}>View original menu ↗</a>
        ) : (
          <span>{dishes.length} dishes</span>
        )}
      </div>
    </div>
  );
}