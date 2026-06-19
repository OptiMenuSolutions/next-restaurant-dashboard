import React, { useState, useRef, useEffect } from "react";

/**
 * PassDashboard — OptiMenu "Tonight's Pass" dashboard.
 *
 * Self-contained React component ported from the design artifact.
 * Inline styles (no external CSS needed). The only global CSS is the
 * <style> block below (font import, keyframes, hidden-scrollbar rule).
 *
 * Props:
 *   weekState    "Populated" | "Empty"    – Week in Review data state
 *   startFlipped boolean                  – start all tickets on the recipe side
 *   wasteSort    "Urgency" | "Quantity"   – Waste Risk sort order
 */

const ACCENT = "#4cb1c6";
const GREEN = "#5db87e";
const AMBER = "#d6a142";
const RED = "#d4685a";
const RISK = "#c2503f";
const MONO = "'Inter',sans-serif"; // numeric runs use Inter w/ tabular-nums

const TICKET_DEFS = [
  {
    label: "PUSH TONIGHT", color: ACCENT, num: "#042-01", title: "Churrasco",
    marginPct: "71", cover: "$25.58",
    pitch: "The Churrasco is incredible tonight \u2014 tender, fire-grilled skirt steak with chimichurri. One of the chef\u2019s favorites.",
    desc: "Premium entr\u00e9e, 71% margin \u2014 an underexposed, high-value plate worth pushing.",
    recipe: [
      { name: "Protein", ings: [{ name: "Skirt Steak", qty: "8 oz", risk: true }] },
      { name: "Sauce", ings: [{ name: "Chimichurri", qty: "1.5 oz" }] },
      { name: "Sides", ings: [{ name: "Grilled Vegetables", qty: "4 oz" }, { name: "Chimichurri Rice", qty: "5 oz" }] },
    ],
  },
  {
    label: "RECOMMEND", color: GREEN, num: "#042-02", title: "Medusa Burger",
    marginPct: "68", cover: "$12.53",
    pitch: "The Medusa Burger is fantastic \u2014 bold toppings and one of the most popular things we make. Guests love it.",
    desc: "Top-margin burger at 67.9% \u2014 currently underselling its potential.",
    recipe: [
      { name: "Bun", ings: [{ name: "Brioche Bun", qty: "1 ea", risk: true }] },
      { name: "Protein", ings: [{ name: "Beef Patty", qty: "2 \u00d7 4 oz" }] },
      { name: "Toppings", ings: [{ name: "Smoked Gouda", qty: "1 oz" }, { name: "Crispy Onion", qty: "0.5 oz" }] },
      { name: "Sauce", ings: [{ name: "House Sauce", qty: "1 oz" }] },
    ],
  },
  {
    label: "MENTION", color: AMBER, num: "#042-03", title: "Classic",
    marginPct: "66", cover: "$11.16",
    pitch: "The Classic is honestly one of my favorites \u2014 crispy brick-oven crust, rich house tomato sauce. Simple but amazing.",
    desc: "Best composite-margin pizza tonight at 65.8% \u2014 due for rotation.",
    recipe: [
      { name: "Base", ings: [{ name: "Brick-Oven Dough", qty: "12 in" }] },
      { name: "Sauce", ings: [{ name: "House Tomato Sauce", qty: "4 oz" }] },
      { name: "Cheese", ings: [{ name: "Fresh Mozzarella", qty: "5 oz" }] },
      { name: "Finishing", ings: [{ name: "Basil", qty: "6 leaves" }] },
    ],
  },
];

const TILT = [-0.5, 0.35, -0.25];

const WASTE_BASE = [
  { name: "Burrata", shelf: 7, daysLeft: 0, qty: "~2.5 lb", del: "Jun 14", qtyNum: 2.5 },
  { name: "Skirt Steak", shelf: 6, daysLeft: 1, qty: "~6.0 lb", del: "Jun 15", qtyNum: 6 },
  { name: "Cilantro", shelf: 5, daysLeft: 2, qty: "~0.8 lb", del: "Jun 16", qtyNum: 0.8 },
  { name: "Brioche Buns", shelf: 7, daysLeft: 3, qty: "~24 ea", del: "Jun 15", qtyNum: 24 },
  { name: "Heavy Cream", shelf: 14, daysLeft: 5, qty: "~1.0 gal", del: "Jun 13", qtyNum: 1 },
];

const STATS = [
  { label: "Avg margin", value: "44.6%" },
  { label: "Low-margin items", value: "7" },
  { label: "Expiring soon", value: "21" },
  { label: "YTD spend", value: "$284K" },
];

const DATA_MAP = { 11: 12, 12: 8, 13: -3, 15: 21, 16: 5, 17: 14, 18: 37 };
const DAY_INFO = {
  18: { label: "Thu", short: "06/18", saved: "$310", dishes: [
    { tag: "Push", tcolor: ACCENT, name: "Churrasco", sold: 18, avg: 11 },
    { tag: "Rec", tcolor: GREEN, name: "Medusa Burger", sold: 26, avg: 21 },
    { tag: "Mention", tcolor: AMBER, name: "Classic", sold: 14, avg: 12 }] },
  17: { label: "Wed", short: "06/17", saved: "$180", dishes: [
    { tag: "Push", tcolor: ACCENT, name: "Ribeye", sold: 15, avg: 12 },
    { tag: "Rec", tcolor: GREEN, name: "Fish Tacos", sold: 20, avg: 22 },
    { tag: "Mention", tcolor: AMBER, name: "Caesar", sold: 9, avg: 8 }] },
  15: { label: "Mon", short: "06/15", saved: "$420", dishes: [
    { tag: "Push", tcolor: ACCENT, name: "Short Rib", sold: 22, avg: 14 },
    { tag: "Rec", tcolor: GREEN, name: "Mussels", sold: 17, avg: 15 },
    { tag: "Mention", tcolor: AMBER, name: "Margherita", sold: 11, avg: 13 }] },
};
const TODAY_D = 18;

const GLOBAL_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;450;500;600;700&display=swap');
@keyframes blink{0%,100%{opacity:1}50%{opacity:.25}}
@keyframes printIn{from{opacity:0;transform:translateY(-16px);}to{opacity:1;transform:translateY(0);}}
.waste-scroll{scrollbar-width:none;-ms-overflow-style:none;}
.waste-scroll::-webkit-scrollbar{display:none;width:0;height:0;}
`;

export default function PassDashboard({
  weekState = "Populated",
  startFlipped = false,
  wasteSort = "Urgency",
}) {
  const [flipped, setFlipped] = useState(
    startFlipped ? [true, true, true] : [false, false, false]
  );
  const [openDay, setOpenDay] = useState(null);
  const stageRef = useRef(null);

  // Scale the fixed-size stage to fit the viewport (fills height, side gutters).
  useEffect(() => {
    const fit = () => {
      const el = stageRef.current;
      if (!el) return;
      const dh = el.offsetHeight || 880;
      const s = Math.min(window.innerWidth / 1500, window.innerHeight / dh);
      el.style.transform = `translate(-50%, -50%) scale(${s})`;
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  const toggleFlip = (i) =>
    setFlipped((f) => f.map((v, idx) => (idx === i ? !v : v)));

  // ── Waste ──────────────────────────────────────────────
  const wColor = (dl) => (dl <= 1 ? RED : dl <= 2 ? AMBER : ACCENT);
  const sortedWaste = WASTE_BASE.slice().sort((a, b) =>
    wasteSort === "Quantity" ? b.qtyNum - a.qtyNum : a.daysLeft - b.daysLeft
  );

  // ── Week / calendar ────────────────────────────────────
  const empty = weekState === "Empty";
  const selected = openDay != null ? DAY_INFO[openDay] : null;
  const showTotals = openDay == null && !empty;
  const showEmpty = openDay == null && empty;
  const showDay = openDay != null && !!selected;
  const showNoDay = openDay != null && !selected;
  const weekHint = empty ? "Awaiting first week of data" : "Tap a highlighted date to drill in";

  const calendar = [];
  for (let d = 1; d <= 30; d++) {
    const has = Object.prototype.hasOwnProperty.call(DATA_MAP, d);
    const extra = DATA_MAP[d];
    const clickable = d <= TODAY_D;
    const isActive = openDay === d;
    const isToday = d === TODAY_D;
    const cellStyle = {
      position: "relative", display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", gap: "2px", borderRadius: "6px", minHeight: "34px", padding: "1px",
      fontFamily: "'Inter',sans-serif", border: "1px solid transparent", background: "transparent",
    };
    let numColor, subColor;
    if (isActive) {
      cellStyle.background = ACCENT; cellStyle.borderColor = ACCENT; cellStyle.cursor = "pointer";
      numColor = "#0a0908"; subColor = "#0a0908";
    } else if (has) {
      cellStyle.background = "#101113"; cellStyle.borderColor = "#23252a"; cellStyle.cursor = "pointer";
      numColor = "#edeae2"; subColor = extra > 0 ? GREEN : extra < 0 ? RED : "#55554f";
    } else if (clickable) {
      cellStyle.cursor = "pointer"; numColor = "#7d7b74"; subColor = "transparent";
    } else {
      cellStyle.cursor = "default"; numColor = "#44443f"; subColor = "transparent";
    }
    if (isToday && !isActive) cellStyle.boxShadow = "inset 0 0 0 1px #4cb1c6";
    calendar.push({
      d, has, clickable,
      sub: has ? (extra > 0 ? "+" : "") + extra : "\u00b7",
      cellStyle,
      numStyle: { fontSize: "12px", lineHeight: 1, color: numColor, fontWeight: isActive || has ? 600 : 400 },
      subStyle: { fontFamily: MONO, fontVariantNumeric: "tabular-nums", fontSize: "9px", fontWeight: 700, lineHeight: 1, color: subColor },
    });
  }

  const onCellClick = (c) => {
    if (!c.clickable) return;
    setOpenDay((o) => (o === c.d ? null : c.d));
  };

  let dayPanel = null;
  if (selected) {
    dayPanel = {
      heading: selected.label + " \u00b7 " + selected.short,
      saved: selected.saved,
      dishes: selected.dishes.map((ds) => {
        const diff = ds.sold - ds.avg;
        const max = Math.max(ds.sold, ds.avg, 1);
        const dc = diff > 0 ? GREEN : diff < 0 ? RED : "#7d7b74";
        return {
          name: ds.name, sold: ds.sold, avg: ds.avg, tag: ds.tag, tcolor: ds.tcolor,
          diff: (diff > 0 ? "+" : "") + diff, dc,
          soldPct: (ds.sold / max) * 100, avgPct: (ds.avg / max) * 100,
        };
      }),
    };
  }

  const statValStyle = {
    fontSize: "15px", fontWeight: 600, fontVariantNumeric: "tabular-nums",
    letterSpacing: "-.01em", color: "#edeae2",
  };

  return (
    <>
      <style>{GLOBAL_CSS}</style>
      {/* dark backdrop for the letterbox gutters */}
      <div style={{ position: "fixed", inset: 0, background: "#0a0b0d", zIndex: 0 }} />

      <div
        ref={stageRef}
        style={{
          position: "fixed", top: "50%", left: "50%",
          transform: "translate(-50%,-50%) scale(1)", transformOrigin: "center center",
          width: "1500px", height: "auto", background: "#0a0b0d",
          fontFamily: "'Inter',sans-serif", color: "#edeae2",
          display: "flex", flexDirection: "column", overflow: "hidden", zIndex: 1,
        }}
      >
        {/* ── TOP BAR ── */}
        <div style={{ flex: "none", height: "54px", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 32px", borderBottom: "1px solid #1c1e22", background: "#0d0e10" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "30px" }}>
            <div style={{ fontWeight: 700, fontSize: "20px", letterSpacing: "-.3px", color: "#edeae2" }}>
              Opti<span style={{ color: ACCENT }}>Menu</span>
            </div>
            <div style={{ display: "flex", gap: "2px" }}>
              <div style={{ padding: "6px 13px", borderRadius: "6px", fontSize: "13px", color: "#edeae2", background: "#1a1c1f" }}>Dashboard</div>
              {["Invoices", "Ingredients", "Menu Items", "Analytics"].map((t) => (
                <div key={t} style={{ padding: "6px 13px", borderRadius: "6px", fontSize: "13px", color: "#7d7b74" }}>{t}</div>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", color: ACCENT }}>
              <span style={{ width: "6px", height: "6px", background: ACCENT, borderRadius: "50%", animation: "blink 2s infinite", display: "inline-block" }} />Active
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", width: "220px", height: "32px", padding: "0 12px", border: "1px solid #23252a", borderRadius: "8px", color: "#55554f", fontSize: "13px" }}>
              <span style={{ fontSize: "13px" }}>{"\u2315"}</span>Search&hellip;
            </div>
            <div style={{ width: "32px", height: "32px", borderRadius: "50%", background: "#1f6b7a", color: "#cdeef4", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "13px", fontWeight: 600 }}>N</div>
          </div>
        </div>

        <div style={{ flex: 1, minHeight: 0, padding: "0 32px 20px", display: "flex", flexDirection: "column" }}>

          {/* ── TOP REGION: glance + the pass ── */}
          <div style={{ flex: "none", display: "grid", gridTemplateColumns: "248px 1fr", gap: "24px", paddingTop: "20px" }}>

            {/* glance column */}
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {/* identity */}
              <div style={{ background: "#131417", border: "1px solid #1f2126", borderRadius: "10px", padding: "15px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "10px", fontWeight: 600, letterSpacing: ".14em", color: ACCENT, marginBottom: "9px" }}>
                  <span style={{ width: "5px", height: "5px", background: ACCENT, borderRadius: "50%", animation: "blink 2s infinite", display: "inline-block" }} />ON THE PASS &middot; 5:31 PM
                </div>
                <div style={{ fontSize: "23px", fontWeight: 700, letterSpacing: "-.03em", lineHeight: 1, color: "#edeae2" }}>Nico</div>
                <hr style={{ border: "none", borderTop: "1px solid #1f2126", margin: "11px 0" }} />
                <div style={{ fontSize: "14px", fontWeight: 600, color: "#edeae2" }}>Echo Tap &amp; Grille</div>
                <div style={{ fontSize: "11px", color: "#8a887f", marginTop: "3px" }}>Thursday, June 18</div>
              </div>

              {/* optiscore */}
              <div style={{ background: "#131417", border: "1px solid #1f2126", borderRadius: "10px", padding: "15px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
                  <div style={{ fontSize: "10px", fontWeight: 600, letterSpacing: ".14em", textTransform: "uppercase", color: "#6f6d66" }}>OptiScore</div>
                  <div style={{ fontSize: "10px", fontWeight: 700, letterSpacing: ".06em", color: ACCENT, background: "rgba(76,177,198,.12)", border: "1px solid rgba(76,177,198,.3)", borderRadius: "5px", padding: "2px 7px" }}>GOOD</div>
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: "5px" }}>
                  <span style={{ fontWeight: 700, fontSize: "40px", lineHeight: ".9", letterSpacing: "-.03em", color: "#edeae2", fontVariantNumeric: "tabular-nums" }}>79</span>
                  <span style={{ fontSize: "13px", fontWeight: 600, color: "#55554f" }}>/ 100</span>
                </div>
                <div style={{ width: "100%", height: "5px", background: "#23252a", borderRadius: "3px", overflow: "hidden", marginTop: "12px" }}>
                  <div style={{ height: "100%", width: "79%", background: ACCENT, borderRadius: "3px" }} />
                </div>
                <div style={{ borderTop: "1px solid #1f2126", marginTop: "12px", paddingTop: "8px", fontSize: "10px", color: "#6f6d66", letterSpacing: ".03em" }}>Updated 5:31 PM</div>
              </div>

              {/* stats */}
              <div style={{ background: "#131417", border: "1px solid #1f2126", borderRadius: "10px", padding: "13px 15px", display: "flex", flexDirection: "column", gap: "11px" }}>
                {STATS.map((s) => (
                  <div key={s.label} style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "8px" }}>
                    <span style={{ fontSize: "11px", color: "#a9a79f" }}>{s.label}</span>
                    <span style={statValStyle}>{s.value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* the pass */}
            <div>
              <div style={{ fontWeight: 600, fontSize: "26px", letterSpacing: "-.3px", lineHeight: 1.25, marginBottom: "10px", color: "#edeae2" }}>
                Good evening, Nico. <em style={{ fontStyle: "italic", color: ACCENT }}>Tonight&rsquo;s pass is set.</em>
              </div>

              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: "10px" }}>
                <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: ".2em", textTransform: "uppercase", color: "#a9a79f", display: "flex", alignItems: "center", gap: "10px" }}>
                  Tonight&rsquo;s Service<span style={{ display: "block", width: "54px", height: "1px", background: "#23252a" }} />
                </div>
                <div style={{ fontSize: "10px", color: "#6f6d66" }}>3 dishes on the rail &middot; tap a ticket to flip</div>
              </div>

              {/* rail */}
              <div style={{ position: "relative", height: "10px", borderRadius: "5px", background: "linear-gradient(to bottom,#8a8378 0%,#b5ada0 18%,#6e675d 55%,#4a443c 100%)", boxShadow: "0 2px 5px rgba(0,0,0,.55), inset 0 1px 0 rgba(255,255,255,.35), inset 0 -1px 1px rgba(0,0,0,.4)", zIndex: 1 }}>
                <div style={{ position: "absolute", top: "50%", left: "7px", transform: "translateY(-50%)", width: "6px", height: "6px", borderRadius: "50%", background: "radial-gradient(circle at 35% 30%,#d8d2c6,#5a544a 70%)", boxShadow: "inset 0 -1px 1px rgba(0,0,0,.6)" }} />
                <div style={{ position: "absolute", top: "50%", right: "7px", transform: "translateY(-50%)", width: "6px", height: "6px", borderRadius: "50%", background: "radial-gradient(circle at 35% 30%,#d8d2c6,#5a544a 70%)", boxShadow: "inset 0 -1px 1px rgba(0,0,0,.6)" }} />
              </div>

              {/* tickets */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "24px", alignItems: "stretch", marginTop: "-2px" }}>
                {TICKET_DEFS.map((t, i) => (
                  <Ticket key={t.num} t={t} i={i} flipped={flipped[i]} onFlip={() => toggleFlip(i)} />
                ))}
              </div>
            </div>
          </div>

          {/* ── SUPPORTING BAND ── */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2.2fr", gap: "18px", paddingTop: "18px", flex: "none", height: "336px" }}>

            {/* waste risk */}
            <div style={{ background: "#131417", border: "1px solid #1f2126", borderRadius: "10px", padding: "16px", display: "flex", flexDirection: "column", minHeight: 0 }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: "10px" }}>
                <div style={{ fontSize: "13px", fontWeight: 600, color: "#edeae2" }}>Waste Risk</div>
                <span style={{ fontSize: "10px", color: "#6f6d66" }}>21 at risk &middot; 6 within 3 days</span>
              </div>
              <div className="waste-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden" }}>
                {sortedWaste.map((w) => {
                  const col = wColor(w.daysLeft);
                  const pct = Math.min(100, ((w.shelf - w.daysLeft) / w.shelf) * 100);
                  const lbl = w.daysLeft === 0 ? "Use today" : w.daysLeft === 1 ? "1 day left" : w.daysLeft + " days left";
                  return (
                    <div key={w.name} style={{ display: "flex", flexDirection: "column", gap: "5px", padding: "9px 0", borderBottom: "1px solid #191b1f" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
                        <span style={{ width: "6px", height: "6px", borderRadius: "50%", flexShrink: 0, background: col }} />
                        <div style={{ flex: 1, fontSize: "12px", color: "#c4c2ba", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{w.name}</div>
                        <div style={{ fontFamily: MONO, fontVariantNumeric: "tabular-nums", fontSize: "11px", fontWeight: 700, whiteSpace: "nowrap", color: col }}>{lbl}</div>
                      </div>
                      <div style={{ width: "100%", height: "3px", background: "#23252a", borderRadius: "2px", overflow: "hidden" }}>
                        <div style={{ height: "100%", borderRadius: "2px", width: pct + "%", background: "#3a3d43" }} />
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: "8px" }}>
                        <span style={{ fontSize: "9px", color: "#6f6d66", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{w.qty} remaining &middot; Delivered {w.del}</span>
                        <span style={{ fontSize: "9px", color: ACCENT }}>Invoice &rarr;</span>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "12px", fontSize: "9px", color: "#6f6d66", paddingTop: "8px", borderTop: "1px solid #191b1f", marginTop: "6px" }}>
                <span style={{ display: "flex", alignItems: "center", gap: "4px" }}><span style={{ width: "6px", height: "6px", borderRadius: "50%", background: RED, display: "inline-block" }} />Expired / today</span>
                <span style={{ display: "flex", alignItems: "center", gap: "4px" }}><span style={{ width: "6px", height: "6px", borderRadius: "50%", background: AMBER, display: "inline-block" }} />2 days</span>
                <span style={{ display: "flex", alignItems: "center", gap: "4px" }}><span style={{ width: "6px", height: "6px", borderRadius: "50%", background: ACCENT, display: "inline-block" }} />3&ndash;7 days</span>
              </div>
            </div>

            {/* week in review */}
            <div style={{ background: "#131417", border: "1px solid #1f2126", borderRadius: "10px", padding: "16px", display: "flex", flexDirection: "column", minHeight: 0 }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: "12px" }}>
                <div style={{ fontSize: "13px", fontWeight: 600, color: "#edeae2" }}>Week in Review</div>
                <span style={{ fontSize: "10px", color: "#6f6d66" }}>{weekHint}</span>
              </div>
              <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 1.25fr", gap: "18px" }}>

                {/* left panel */}
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {showTotals && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "10px", flex: 1 }}>
                      <Kpi label="Extra sold" caption="covers vs. avg, last 7 nights" value="+37" color={GREEN} />
                      <Kpi label="Waste saved" caption="estimated, last 7 nights" value="$1,240" color={GREEN} />
                      <Kpi label="Hit rate" caption="nights above average" value="82%" color={ACCENT} />
                      <div style={{ background: "#101113", border: "1px solid #191b1f", borderRadius: "7px", padding: "8px 12px", display: "flex", flexDirection: "column", justifyContent: "center", flex: 1 }}>
                        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "10px" }}>
                          <div style={{ fontSize: "9px", color: "#a9a79f", textTransform: "uppercase", letterSpacing: ".08em", whiteSpace: "nowrap" }}>Top performer</div>
                          <div style={{ fontSize: "9px", color: "#6f6d66" }}>Mon, Jun 15</div>
                        </div>
                        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "10px", marginTop: "5px" }}>
                          <div style={{ fontSize: "14px", fontWeight: 600, color: "#edeae2", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Short Rib</div>
                          <div style={{ fontVariantNumeric: "tabular-nums", fontSize: "16px", fontWeight: 700, lineHeight: 1, color: GREEN, flexShrink: 0 }}>+8</div>
                        </div>
                      </div>
                    </div>
                  )}

                  {showEmpty && (
                    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", gap: "8px", padding: "16px", color: "#6f6d66" }}>
                      <div style={{ fontSize: "22px" }}>{"\u25f7"}</div>
                      <div style={{ fontSize: "11px", lineHeight: 1.5 }}>No weekly results yet &mdash; totals appear here once Tonight&rsquo;s Dish runs a full week.</div>
                    </div>
                  )}

                  {showDay && dayPanel && (
                    <>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <div style={{ fontSize: "12px", fontWeight: 600, color: "#c4c2ba" }}>{dayPanel.heading}</div>
                        <div style={{ marginLeft: "auto", fontSize: "10px", color: "#6f6d66" }}>Saved <span style={{ color: GREEN, fontWeight: 600 }}>{dayPanel.saved}</span></div>
                      </div>
                      {dayPanel.dishes.map((d) => (
                        <div key={d.name} style={{ background: "#101113", border: "1px solid #191b1f", borderRadius: "8px", padding: "8px 11px" }}>
                          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "8px", marginBottom: "6px" }}>
                            <div style={{ display: "flex", alignItems: "baseline", gap: "6px", minWidth: 0 }}>
                              <span style={{ fontSize: "9px", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: d.tcolor }}>{d.tag}</span>
                              <span style={{ fontSize: "12px", fontWeight: 600, color: "#c4c2ba", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</span>
                            </div>
                            <span style={{ fontFamily: MONO, fontVariantNumeric: "tabular-nums", fontSize: "11px", fontWeight: 700, whiteSpace: "nowrap", color: d.dc }}>{d.diff}</span>
                          </div>
                          <BarRow label="Sold" pct={d.soldPct} value={d.sold} barColor={ACCENT} valColor={ACCENT} />
                          <BarRow label="Avg" pct={d.avgPct} value={d.avg} barColor="#3a3d43" valColor="#8a887f" />
                        </div>
                      ))}
                      <button type="button" onClick={() => setOpenDay(null)} style={{ background: "none", border: "none", cursor: "pointer", fontFamily: "'Inter',sans-serif", textAlign: "left", fontSize: "10px", color: ACCENT, padding: "2px 0" }}>&larr; Back to week totals</button>
                    </>
                  )}

                  {showNoDay && (
                    <>
                      <div style={{ fontSize: "12px", fontWeight: 600, color: "#c4c2ba" }}>June {openDay}</div>
                      <div style={{ fontSize: "11px", color: "#7d7b74", lineHeight: 1.5, padding: "8px 0" }}>No Tonight&rsquo;s Dish data recorded for this night.</div>
                      <button type="button" onClick={() => setOpenDay(null)} style={{ background: "none", border: "none", cursor: "pointer", fontFamily: "'Inter',sans-serif", textAlign: "left", fontSize: "10px", color: ACCENT, padding: "2px 0" }}>&larr; Back to week totals</button>
                    </>
                  )}
                </div>

                {/* calendar */}
                <div style={{ display: "flex", flexDirection: "column", borderLeft: "1px solid #191b1f", paddingLeft: "18px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "13px", fontWeight: 700, color: "#a9a79f", letterSpacing: ".04em", marginBottom: "8px" }}>
                    <span style={{ width: "22px", height: "22px", display: "flex", alignItems: "center", justifyContent: "center", background: "#101113", border: "1px solid #191b1f", borderRadius: "5px", color: "#55554f", opacity: 0.4 }}>&lsaquo;</span>
                    June 2026
                    <span style={{ width: "22px", height: "22px", display: "flex", alignItems: "center", justifyContent: "center", background: "#101113", border: "1px solid #191b1f", borderRadius: "5px", color: "#55554f", opacity: 0.4 }}>&rsaquo;</span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: "3px", marginBottom: "3px" }}>
                    {["MO", "TU", "WE", "TH", "FR", "SA", "SU"].map((w) => (
                      <span key={w} style={{ fontSize: "9px", fontWeight: 600, color: "#55554f", textAlign: "center", letterSpacing: ".06em" }}>{w}</span>
                    ))}
                  </div>
                  <div style={{ flex: 1, display: "grid", gridTemplateColumns: "repeat(7,1fr)", gridAutoRows: "1fr", gap: "3px" }}>
                    {calendar.map((c) => (
                      <button key={c.d} type="button" onClick={() => onCellClick(c)} style={c.cellStyle}>
                        <span style={c.numStyle}>{c.d}</span>
                        <span style={c.subStyle}>{c.sub}</span>
                      </button>
                    ))}
                  </div>
                  <div style={{ fontSize: "9px", color: "#55554f", textAlign: "center", paddingTop: "8px" }}>Highlighted nights have Tonight&rsquo;s Dish data &mdash; tap to drill in</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function Kpi({ label, caption, value, color }) {
  return (
    <div style={{ background: "#101113", border: "1px solid #191b1f", borderRadius: "7px", padding: "8px 12px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", flex: 1 }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: "9px", color: "#a9a79f", textTransform: "uppercase", letterSpacing: ".08em" }}>{label}</div>
        <div style={{ fontSize: "9px", color: "#6f6d66", marginTop: "1px" }}>{caption}</div>
      </div>
      <div style={{ fontVariantNumeric: "tabular-nums", fontSize: "18px", fontWeight: 700, lineHeight: 1, color, flexShrink: 0 }}>{value}</div>
    </div>
  );
}

function BarRow({ label, pct, value, barColor, valColor }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "7px", marginBottom: label === "Sold" ? "3px" : 0 }}>
      <span style={{ fontSize: "9px", color: "#6f6d66", width: "24px", flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, height: "4px", background: "#23252a", borderRadius: "2px", overflow: "hidden" }}>
        <div style={{ height: "100%", background: barColor, borderRadius: "2px", width: pct + "%" }} />
      </div>
      <span style={{ fontVariantNumeric: "tabular-nums", fontSize: "10px", fontWeight: 700, color: valColor, width: "20px", textAlign: "right", flexShrink: 0 }}>{value}</span>
    </div>
  );
}

function Ticket({ t, i, flipped, onFlip }) {
  const faceShared = {
    position: "absolute", inset: 0, display: "flex", flexDirection: "column",
    overflow: "hidden", backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden",
    background: "#f4f0e6", color: "#1f1a13", fontFamily: "'Courier New',monospace",
    borderRadius: "2px 2px 0 0", padding: "13px 16px 18px",
    boxShadow: "0 12px 26px -10px rgba(0,0,0,.65), 0 2px 4px rgba(0,0,0,.35)",
  };
  const zigzag = {
    position: "absolute", left: 0, right: 0, bottom: 0, height: "7px",
    backgroundImage: "linear-gradient(45deg,#0a0b0d 25%,transparent 25%),linear-gradient(-45deg,#0a0b0d 25%,transparent 25%)",
    backgroundSize: "11px 14px", backgroundPosition: "bottom", backgroundRepeat: "repeat-x",
  };
  const dash = { border: "none", borderTop: "1px dashed #d8d0bd", margin: "6px 0" };

  return (
    <div style={{ position: "relative", paddingTop: "7px" }}>
      {/* clip */}
      <div style={{ position: "absolute", top: "-3px", left: "50%", transform: "translateX(-50%)", width: "48px", height: "18px", borderRadius: "3px 3px 2px 2px", background: "linear-gradient(to bottom,#c9c2b4 0%,#9a9285 35%,#6e675d 75%,#565047 100%)", boxShadow: "0 2px 4px rgba(0,0,0,.55), inset 0 1px 0 rgba(255,255,255,.4)", zIndex: 3 }}>
        <div style={{ position: "absolute", left: "5px", right: "5px", bottom: "4px", height: "2px", borderRadius: "1px", background: "rgba(0,0,0,.35)" }} />
      </div>
      {/* flip stage */}
      <div style={{ position: "relative", height: "342px", perspective: "1300px", animation: "printIn .45s cubic-bezier(.25,.8,.35,1) both", animationDelay: 0.05 + i * 0.12 + "s", transform: `rotate(${TILT[i]}deg)`, transformOrigin: "top center" }}>
        <div style={{ position: "absolute", inset: 0, transformStyle: "preserve-3d", transition: "transform .55s cubic-bezier(.35,.1,.25,1)", transform: flipped ? "rotateY(180deg)" : "none" }}>

          {/* FRONT */}
          <button type="button" onClick={onFlip} style={{ ...faceShared, border: "none", textAlign: "left", cursor: "pointer" }}>
            <div style={{ textAlign: "center", marginBottom: "6px" }}>
              <div style={{ fontSize: "12px", fontWeight: 700, letterSpacing: ".04em", color: "#1f1a13", lineHeight: 1.3 }}>Echo Tap &amp; Grille</div>
              <div style={{ fontSize: "10px", color: "#5a5142", letterSpacing: ".06em" }}>*** Food ***</div>
              <div style={{ fontSize: "10px", fontWeight: 700, letterSpacing: ".14em", color: t.color }}>{t.label}</div>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span style={{ fontSize: "11px", fontWeight: 700, color: "#1f1a13" }}>{t.num}</span>
              <span style={{ fontSize: "10px", color: "#5a5142" }}>5:31 PM</span>
            </div>
            <hr style={dash} />
            <div style={{ fontSize: "19px", fontWeight: 700, lineHeight: 1.15, color: "#1f1a13" }}>{t.title}</div>
            <hr style={dash} />
            <div style={{ textAlign: "center", fontSize: "10px", color: "#5a5142", marginBottom: "5px" }}>--- Tonight&rsquo;s Pitch ---</div>
            <div style={{ fontSize: "12px", lineHeight: 1.5, fontStyle: "italic", color: t.color }}>{t.pitch}</div>
            <div style={{ fontSize: "11px", lineHeight: 1.45, color: "#5a5142", marginTop: "6px" }}>{t.desc}</div>
            <div style={{ flex: 1 }} />
            <hr style={dash} />
            <div style={{ display: "flex", gap: "6px" }}>
              <span style={{ fontSize: "9px", fontWeight: 700, letterSpacing: ".06em", padding: "2px 6px", border: "1px solid #b9af99", borderRadius: "2px", color: "#5a5142" }}>MARGIN {t.marginPct}%</span>
              <span style={{ fontSize: "9px", fontWeight: 700, letterSpacing: ".06em", padding: "2px 6px", border: "1px solid #b9af99", borderRadius: "2px", color: "#5a5142" }}>{t.cover}/COVER</span>
            </div>
            <div style={{ marginTop: "8px", fontSize: "9px", color: "#968b78", textAlign: "center", letterSpacing: ".06em" }}>&middot; &middot; &middot;&nbsp;&nbsp;FLIP FOR RECIPE&nbsp;&nbsp;&middot; &middot; &middot;</div>
            <div style={zigzag} />
          </button>

          {/* BACK */}
          <div onClick={onFlip} style={{ ...faceShared, transform: "rotateY(180deg)", cursor: "pointer" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "10px", fontWeight: 700, letterSpacing: ".1em", color: t.color }}>RECIPE &middot; {t.num}</span>
              <span style={{ fontSize: "10px", fontWeight: 700, letterSpacing: ".06em", color: "#5a5142" }}>&#8635; FLIP BACK</span>
            </div>
            <hr style={dash} />
            <div style={{ fontSize: "16px", fontWeight: 700, lineHeight: 1.2, color: "#1f1a13" }}>{t.title}</div>
            <hr style={dash} />
            <div style={{ flex: 1, overflow: "hidden" }}>
              {t.recipe.map((comp) => (
                <div key={comp.name} style={{ marginBottom: "8px" }}>
                  <div style={{ fontSize: "13px", fontWeight: 700, color: "#1f1a13", letterSpacing: ".01em", marginBottom: "4px" }}>{comp.name}</div>
                  {comp.ings.map((ing) => (
                    <div key={ing.name} style={{ paddingLeft: "12px", marginBottom: "3px", display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "6px" }}>
                      <div style={{ display: "flex", alignItems: "baseline", gap: "5px", minWidth: 0 }}>
                        <div style={{ fontSize: "11px", lineHeight: 1.3, fontWeight: 400, color: t.color }}>{ing.name}</div>
                        {ing.risk && <span style={{ color: RISK, fontWeight: 700, fontSize: "9px", flexShrink: 0 }}>{"\u25b2"}</span>}
                      </div>
                      <div style={{ fontSize: "10px", fontStyle: "italic", flexShrink: 0, color: t.color }}>{ing.qty}</div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <div style={{ textAlign: "center", fontSize: "9px", color: "#968b78", letterSpacing: ".06em", marginBottom: "5px" }}>&middot; &middot; &middot;&nbsp;&nbsp;TAP TO FLIP BACK&nbsp;&nbsp;&middot; &middot; &middot;</div>
            <div style={zigzag} />
          </div>
        </div>
      </div>
    </div>
  );
}
