import React, { useCallback, useEffect, useMemo, useState } from "react";

/**
 * PassDashboard — OptiMenu "Tonight's Pass" client dashboard (v5, cream shell).
 *
 * Drop-in replacement for the body of pages/client/dashboard.js.
 * Purely presentational: it renders whatever it is handed and falls back to
 * DEMO_* data when a prop is omitted, so it can be mounted before the queries
 * are wired up.
 *
 * Conventions match the rest of the repo: inline style objects, one <style>
 * block for tokens / keyframes / media queries, no new dependencies.
 *
 * Props
 *   loading        boolean                     – full-page "setting the pass" state
 *   error          string | null               – full-page error state (message shown in the code chip)
 *   onRetry        () => void
 *   theme          "light" | "dark" | undefined – controlled theme; omit for internal state
 *   defaultTheme   "light" | "dark"            – initial theme when uncontrolled (default "light")
 *   onThemeChange  (next) => void
 *   activeNav      string                      – nav key: dashboard | invoices | ingredients | menu-items | analytics
 *   NavLink        component                   – ({ href, children, style }) => node. Pass next/link wrapper.
 *   restaurantName string
 *   user           { firstName, initials }
 *   dateLabel      string   e.g. "Monday, August 24"
 *   timeLabel      string   e.g. "4:41 PM"
 *   optiScore      { value, max, label }
 *   stats          [{ label, value }]
 *   tickets        [Ticket]  (see DEMO_TICKETS for the shape)
 *   waste          [{ name, left, tone, pct, qty }]  tone: "today" | "soon" | "ok"
 *   week           { month, stats:[{label,sub,value,tone}], top:{name,date,delta}, days:{ [dayNumber]: number }, firstWeekdayIndex, daysInMonth, todayDay }
 *   serviceNumber  string   e.g. "001"
 */

/* ── tokens ─────────────────────────────────────────────────────────── */

const CSS = `
.om-dash *,.om-dash *::before,.om-dash *::after{box-sizing:border-box;margin:0;padding:0}
.om-dash{
  --ground:#e6e4e0;--shell:#ffffff;--panel:#eef0ef;--line:#d8dfe0;--line-soft:#eef1f2;
  --text:#111819;--muted:#5a6669;--faint:#9aa5a7;
  --accent:#02a4ba;--accent-deep:#03808f;--accent-tint:#e8f7f9;
  --green:#3f9c56;--amber:#c1871c;--red:#c4473e;
  --shadow-lg:0 22px 60px rgba(17,24,25,0.12);
  --rail:#d7dedf;--rail-2:#c3cccd;
  --card-lift:0 1px 1px rgba(17,24,25,0.05),0 3px 6px rgba(17,24,25,0.07),0 10px 22px rgba(17,24,25,0.10);
  --paper:#f7f7f5;--paper-line:#e0e2e0;--ink:#141a1b;--ink-soft:#5a6669;--ink-faint:#98a1a1;
  background:var(--shell);color:var(--text);
  font-family:'Manrope',system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased;
}
.om-dash[data-theme="dark"]{
  --ground:#0c1113;--shell:#141c1f;--panel:#0f1618;--line:#354549;--line-soft:#222c30;
  --text:#e9f0f0;--muted:#9aa9ab;--faint:#6d7c7f;
  --accent:#26c2d6;--accent-deep:#63d5e2;--accent-tint:#0d2b31;
  --green:#5cc077;--amber:#dda23c;--red:#e0685d;
  --shadow-lg:0 24px 60px rgba(0,0,0,0.55);
  --rail:#2b383c;--rail-2:#3a494e;
  --card-lift:0 1px 1px rgba(0,0,0,0.35),0 3px 8px rgba(0,0,0,0.4),0 12px 26px rgba(0,0,0,0.45);
}
.om-dash a{color:var(--accent-deep);text-decoration:none}
.om-dash a:hover{color:var(--accent)}
.om-dash button:focus-visible,.om-dash a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.om-hover-accent:hover{border-color:var(--accent) !important;color:var(--accent-deep) !important}
.om-nav-link:hover{color:var(--text) !important}
@keyframes om-spin{to{transform:rotate(360deg)}}
@keyframes om-blink{0%,100%{opacity:1}50%{opacity:.25}}
@keyframes om-print{from{opacity:0;transform:translateY(-16px)}to{opacity:1;transform:translateY(0)}}
.om-dash ::-webkit-scrollbar{width:4px;height:4px}
.om-dash ::-webkit-scrollbar-thumb{background:var(--line);border-radius:3px}
.om-dash ::-webkit-scrollbar-track{background:transparent}
.om-scroll-x{overflow-x:auto;scrollbar-width:none}
.om-scroll-x::-webkit-scrollbar{display:none}
`;

const MONO = "'IBM Plex Mono',ui-monospace,SFMono-Regular,Menlo,monospace";
const SANS = "'Manrope',system-ui,-apple-system,sans-serif";

const TONE = { today: "var(--red)", soon: "var(--amber)", ok: "var(--accent)" };

/* ── demo data (used only where a prop is missing) ──────────────────── */

const DEMO_TICKETS = [
  {
    label: "PUSH TONIGHT",
    color: "var(--accent-deep)",
    title: "Seared duck breast",
    pitch: "The kitchen is really proud of this one tonight — worth every bite.",
    reason: "Highest margin on the board tonight.",
    margin: "MARGIN 71%",
    cover: "$18.40/COVER",
    urgency: "HIGH",
    recipe: [
      { name: "Protein", ings: [{ name: "Duck breast", qty: "2 ea", risk: true }, { name: "Duck fat", qty: "30 g" }] },
      { name: "Gastrique", ings: [{ name: "Sour cherries", qty: "90 g", risk: true }, { name: "Red wine vinegar", qty: "40 ml" }, { name: "Demi-glace", qty: "60 ml" }] },
      { name: "Garnish", ings: [{ name: "Turnip", qty: "1 ea" }, { name: "Thyme", qty: "2 sprigs" }] },
    ],
    riskNote: "▲ 2 ingredients at risk tonight — selling this clears them",
  },
  {
    label: "RECOMMEND",
    color: "var(--green)",
    title: "Charred broccolini",
    pitch: "Guests have been loving this lately — a great choice tonight.",
    reason: "Sells best beside the duck. Broccolini is on day three.",
    margin: "MARGIN 68%",
    cover: "$7.10/COVER",
    urgency: "MEDIUM",
    recipe: [
      { name: "Vegetable", ings: [{ name: "Broccolini", qty: "220 g", risk: true }, { name: "Olive oil", qty: "20 ml" }] },
      { name: "Finish", ings: [{ name: "Calabrian chili", qty: "8 g" }, { name: "Pecorino", qty: "15 g" }, { name: "Lemon", qty: "½ ea" }] },
    ],
    riskNote: "▲ 1 ingredient at risk tonight — selling this clears it",
  },
  {
    label: "MENTION",
    color: "var(--amber)",
    title: "Hazelnut semifreddo",
    pitch: "Incredibly fresh tonight — this is the one to get.",
    reason: "Two portions short of a full pan — mention it early.",
    margin: "MARGIN 79%",
    cover: "$6.80/COVER",
    urgency: "LOW",
    recipe: [
      { name: "Base", ings: [{ name: "Heavy cream", qty: "400 ml", risk: true }, { name: "Egg yolk", qty: "4 ea" }, { name: "Caster sugar", qty: "110 g" }] },
      { name: "Praline", ings: [{ name: "Hazelnuts", qty: "80 g" }, { name: "Honey", qty: "25 g" }] },
    ],
    riskNote: "▲ 1 ingredient at risk tonight — selling this clears it",
  },
];

const DEMO_WASTE = [
  { name: "Sour cherries", left: "Use today", tone: "today", pct: 92, qty: "1.4 KG" },
  { name: "Broccolini", left: "2 days left", tone: "soon", pct: 74, qty: "3.1 KG" },
  { name: "Duck breast", left: "3 days left", tone: "ok", pct: 58, qty: "6 EA" },
  { name: "Heavy cream", left: "5 days left", tone: "ok", pct: 40, qty: "4.0 L" },
  { name: "Pecorino", left: "6 days left", tone: "ok", pct: 33, qty: "0.8 KG" },
  { name: "Turnips", left: "7 days left", tone: "ok", pct: 25, qty: "5.2 KG" },
];

const DEMO_STATS = [
  { label: "Avg margin", value: "64.2%" },
  { label: "Low-margin items", value: "7" },
  { label: "Expiring soon", value: "6" },
  { label: "YTD spend", value: "$184,320" },
];

const DEMO_WEEK = {
  month: "August 2026",
  stats: [
    { label: "Extra sold", sub: "COVERS VS. AVG, LAST 7 NIGHTS", value: "+37", tone: "green" },
    { label: "Waste saved", sub: "ESTIMATED, LAST 7 NIGHTS", value: "$412", tone: "green" },
    { label: "Hit rate", sub: "NIGHTS ABOVE AVERAGE", value: "71%", tone: "accent" },
  ],
  top: { name: "Seared duck breast", date: "FRI, 8/21", delta: "+9.4" },
  days: { 3: 4, 5: -2, 7: 6, 10: 3, 12: 8, 14: -1, 17: 5, 19: 2, 21: 9, 22: 1, 24: 3 },
  firstWeekdayIndex: 5, // Monday-first index of the 1st of the month
  daysInMonth: 31,
  todayDay: 24,
};

const NAV = [
  { key: "dashboard", label: "Dashboard", href: "/client/dashboard" },
  { key: "invoices", label: "Invoices", href: "/client/invoices" },
  { key: "ingredients", label: "Ingredients", href: "/client/ingredients" },
  { key: "menu-items", label: "Menu items", href: "/client/menu-items" },
  { key: "analytics", label: "Analytics", href: "/client/analytics" },
];

const DOWS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
const TILT = ["-0.5deg", "0.35deg", "-0.25deg"];

/* ── small shared styles ────────────────────────────────────────────── */

const card = {
  background: "var(--shell)",
  border: "1px solid var(--line)",
  borderRadius: "12px",
  boxShadow: "var(--card-lift)",
};
const kicker = {
  fontFamily: MONO,
  fontSize: "10px",
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "var(--faint)",
};
const dashRule = { borderTop: "1px dashed var(--paper-line)", margin: "8px 0" };
const pill = {
  fontSize: "8.5px",
  fontWeight: 500,
  letterSpacing: "0.06em",
  border: "1px solid var(--ink-faint)",
  borderRadius: "3px",
  padding: "2px 6px",
  color: "var(--ink-soft)",
};

/* ── hooks ──────────────────────────────────────────────────────────── */

function useMediaQuery(query) {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const mq = window.matchMedia(query);
    const on = () => setMatches(mq.matches);
    on();
    if (mq.addEventListener) mq.addEventListener("change", on);
    else mq.addListener(on);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", on);
      else mq.removeListener(on);
    };
  }, [query]);
  return matches;
}

/* ── component ──────────────────────────────────────────────────────── */

export default function PassDashboard({
  loading = false,
  error = null,
  onRetry,
  theme: themeProp,
  defaultTheme = "light",
  onThemeChange,
  activeNav = "dashboard",
  NavLink,
  restaurantName = "Trattoria Lume",
  user = { firstName: "Marco", initials: "MR" },
  dateLabel = "Monday, August 24",
  timeLabel = "4:41 PM",
  optiScore = { value: 78, max: 100, label: "Good" },
  stats = DEMO_STATS,
  tickets = DEMO_TICKETS,
  waste = DEMO_WASTE,
  week = DEMO_WEEK,
  weekData = [],
  monthWeekData = [],
  weekExtraSold = 0,
  weekWasteSaved = 0,
  hitRate = 0,
  onPrevMonth,
  onNextMonth,
  canGoNextMonth = false,
  tourActive = false,
  onSearch,
  serviceNumber = "001",
  logoSrc = "/landing/logo.png",
  logoDarkSrc = "/landing/logo-knockout.png",
}) {
  const [innerTheme, setInnerTheme] = useState(defaultTheme);
  const theme = themeProp || innerTheme;
  const dark = theme === "dark";
  const isMobile = useMediaQuery("(max-width: 900px)");
  const [flipped, setFlipped] = useState(null);
  const [showAllWaste, setShowAllWaste] = useState(false);
  const [openCalendarDay, setOpenCalendarDay] = useState(null);

  const toggleTheme = useCallback(() => {
    const next = dark ? "light" : "dark";
    if (!themeProp) setInnerTheme(next);
    if (onThemeChange) onThemeChange(next);
  }, [dark, themeProp, onThemeChange]);

  const Link = NavLink || (({ href, children, style, className }) => (
    <a href={href} style={style} className={className}>{children}</a>
  ));

  const visibleWaste = showAllWaste ? waste : waste.slice(0, 4);

  // Close any open day drill-down when the browsed month changes, so a
  // stale panel from a different month can't linger.
  useEffect(() => {
    setOpenCalendarDay(null);
  }, [week.viewYear, week.viewMonth]);

  const openCalendarDayEntry = useMemo(() => {
    if (openCalendarDay == null || week.viewYear == null || week.viewMonth == null) return null;
    return (monthWeekData || []).find((d) => {
      const dDate = new Date(d.date + "T12:00:00");
      return dDate.getFullYear() === week.viewYear && dDate.getMonth() === week.viewMonth && dDate.getDate() === openCalendarDay;
    }) || null;
  }, [openCalendarDay, monthWeekData, week.viewYear, week.viewMonth]);

  const cells = useMemo(() => {
    const out = [];
    const lead = week.firstWeekdayIndex || 0;
    for (let i = 0; i < lead; i++) out.push({ blank: true, key: "b" + i });
    for (let d = 1; d <= (week.daysInMonth || 31); d++) {
      const v = week.days ? week.days[d] : undefined;
      const has = v !== undefined;
      const future = week.todayDay ? d > week.todayDay : false;
      out.push({
        key: "d" + d,
        day: d,
        sub: has ? (v > 0 ? "+" + v : String(v)) : "",
        bg: has ? "var(--panel)" : "transparent",
        border: openCalendarDay === d ? "var(--accent)" : has ? "var(--line)" : "transparent",
        numColor: future ? "var(--faint)" : has ? "var(--text)" : "var(--muted)",
        subColor: has ? (v > 0 ? "var(--green)" : "var(--red)") : "transparent",
        clickable: has && !future,
      });
    }
    return out;
  }, [week, openCalendarDay]);

  const header = (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "14px",
        padding: "9px max(20px, calc((100vw - 1460px) / 2))",
        borderBottom: "1px solid var(--line)",
        flexWrap: "wrap",
        flexShrink: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "20px", minWidth: 0, flexShrink: 1 }}>
        <img
          src={dark ? logoDarkSrc : logoSrc}
          alt="optiMenu Solutions"
          style={{ display: "block", height: "22px", width: "auto", flexShrink: 0 }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: "2px", minWidth: 0, overflow: "hidden" }}>
          {NAV.map((n) =>
            n.key === activeNav ? (
              <span
                key={n.key}
                style={{
                  fontSize: "11.5px",
                  fontWeight: 700,
                  color: "var(--text)",
                  background: "var(--accent-tint)",
                  borderRadius: "16px",
                  padding: "5px 11px",
                  whiteSpace: "nowrap",
                }}
              >
                {n.label}
              </span>
            ) : (
              <Link
                key={n.key}
                href={n.href}
                className="om-nav-link"
                style={{
                  fontSize: "11.5px",
                  fontWeight: 500,
                  color: "var(--muted)",
                  padding: "5px 9px",
                  whiteSpace: "nowrap",
                }}
              >
                {n.label}
              </Link>
            )
          )}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "12px", flexShrink: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            fontFamily: MONO,
            fontSize: "10.5px",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--accent-deep)",
            whiteSpace: "nowrap",
          }}
        >
          <span
            style={{
              width: "5px",
              height: "5px",
              borderRadius: "50%",
              background: "var(--accent)",
              animation: "om-blink 2.4s infinite",
            }}
          />
          Live
        </div>
        <button
          type="button"
          title="Search"
          onClick={onSearch}
          className="om-hover-accent"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "30px",
            height: "30px",
            border: "1px solid var(--line)",
            borderRadius: "50%",
            background: "none",
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="var(--faint)" strokeWidth="1.5" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.6-3.6" />
          </svg>
        </button>
        <button
          type="button"
          onClick={toggleTheme}
          title="Toggle light / dark"
          className="om-hover-accent"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "7px",
            background: "none",
            border: "1px solid var(--line)",
            borderRadius: "20px",
            padding: "6px 11px",
            cursor: "pointer",
            fontFamily: MONO,
            fontSize: "11px",
            letterSpacing: "0.06em",
            fontWeight: 600,
            color: "var(--muted)",
          }}
        >
          {dark ? "LIGHT" : "DARK"}
        </button>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "9px",
            paddingLeft: "6px",
            borderLeft: "1px solid var(--line)",
          }}
        >
          <div
            style={{
              width: "26px",
              height: "26px",
              borderRadius: "50%",
              background: "var(--accent)",
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "11px",
              fontWeight: 700,
            }}
          >
            {user.initials}
          </div>
          <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--text)" }}>{user.firstName}</span>
        </div>
      </div>
    </div>
  );

  let body;

  if (loading) {
    body = (
      <div
        style={{
          flex: 1,
          minHeight: "560px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "16px",
          background: "var(--panel)",
        }}
      >
        <div
          style={{
            width: "26px",
            height: "26px",
            border: "2px solid var(--line)",
            borderTopColor: "var(--accent)",
            borderRadius: "50%",
            animation: "om-spin .8s linear infinite",
          }}
        />
        <div style={{ ...kicker, fontSize: "12px", letterSpacing: "0.12em" }}>Setting the pass…</div>
        <div style={{ display: "flex", gap: "22px", marginTop: "26px", flexWrap: "wrap", justifyContent: "center" }}>
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              style={{
                width: "240px",
                height: "200px",
                background: "var(--paper)",
                borderRadius: "4px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: "10px",
                fontFamily: MONO,
                fontSize: "10.5px",
                letterSpacing: "0.16em",
                color: "var(--ink-faint)",
              }}
            >
              <div
                style={{
                  width: "16px",
                  height: "16px",
                  border: "2px solid var(--paper-line)",
                  borderTopColor: "var(--ink-soft)",
                  borderRadius: "50%",
                  animation: "om-spin .8s linear infinite",
                }}
              />
              PRINTING…
            </div>
          ))}
        </div>
      </div>
    );
  } else if (error) {
    body = (
      <div
        style={{
          flex: 1,
          minHeight: "560px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "14px",
          background: "var(--panel)",
          padding: "40px",
        }}
      >
        <div
          style={{
            width: "40px",
            height: "40px",
            borderRadius: "50%",
            background: "var(--accent-tint)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="var(--accent-deep)" strokeWidth="1.5" strokeLinecap="round">
            <path d="M12 8v5" />
            <path d="M12 16.5v.5" />
            <circle cx="12" cy="12" r="9" />
          </svg>
        </div>
        <div style={{ fontSize: "21px", fontWeight: 700, letterSpacing: "-0.02em" }}>Unable to load the dashboard</div>
        <div style={{ fontSize: "14px", color: "var(--muted)", maxWidth: "44ch", textAlign: "center" }}>
          We couldn&rsquo;t reach your restaurant&rsquo;s data. Nothing was lost — tonight&rsquo;s pass will print as soon as the
          connection is back.
        </div>
        <div
          style={{
            fontFamily: MONO,
            fontSize: "11px",
            color: "var(--faint)",
            background: "var(--panel)",
            border: "1px solid var(--line)",
            borderRadius: "6px",
            padding: "8px 12px",
            marginTop: "2px",
          }}
        >
          {error}
        </div>
        <button
          type="button"
          onClick={onRetry}
          style={{
            marginTop: "10px",
            background: "var(--accent)",
            color: "#fff",
            border: "none",
            borderRadius: "24px",
            padding: "13px 28px",
            fontFamily: SANS,
            fontSize: "14.5px",
            fontWeight: 700,
            cursor: "pointer",
            boxShadow: "0 10px 24px rgba(2,164,186,0.28)",
          }}
        >
          Try again
        </button>
      </div>
    );
  } else if (isMobile) {
    body = (
      <MobileView
        restaurantName={restaurantName}
        dateLabel={dateLabel}
        timeLabel={timeLabel}
        optiScore={optiScore}
        tickets={tickets}
        waste={waste}
        stats={stats}
        weekData={weekData}
        weekExtraSold={weekExtraSold}
        weekWasteSaved={weekWasteSaved}
        hitRate={hitRate}
        activeNav={activeNav}
        Link={Link}
      />
    );
  } else {
    body = (
      <div
        style={{
          padding: "16px max(20px, calc((100vw - 1460px) / 2)) 20px",
          display: "flex",
          flexDirection: "column",
          gap: "14px",
          background: "var(--panel)",
          flex: 1,
          minHeight: 0,
        }}
      >
        {/* top band: glance column + the pass */}
        <div
          data-tour="db-grid-wrap"
          style={{
            display: "grid",
            gridTemplateColumns: "232px 1fr",
            gap: "16px",
            alignItems: "stretch",
            flex: "1.15 1 0",
            minHeight: "330px",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "10px", minHeight: 0 }}>
            <div style={{ ...card, padding: "13px 14px", flexShrink: 0 }}>
              <div style={{ ...kicker, marginBottom: "9px" }}>On the pass · {timeLabel}</div>
              <div style={{ fontSize: "14px", fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1.1 }}>
                {restaurantName}
              </div>
              <div style={{ fontSize: "11.5px", color: "var(--muted)", marginTop: "3px" }}>{dateLabel}</div>
            </div>

            <div data-tour="db-panel" style={{ ...card, padding: "13px 14px", flexShrink: 0 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
                <div style={kicker}>OptiScore</div>
                <div
                  style={{
                    fontSize: "10.5px",
                    fontWeight: 700,
                    letterSpacing: "0.04em",
                    textTransform: "uppercase",
                    color: "var(--accent-deep)",
                    background: "var(--accent-tint)",
                    borderRadius: "20px",
                    padding: "3px 9px",
                  }}
                >
                  {optiScore.label}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: "6px" }}>
                <span style={{ fontSize: "23px", fontWeight: 800, letterSpacing: "-0.04em", lineHeight: 0.86 }}>
                  {optiScore.value}
                </span>
                <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--faint)" }}>/ {optiScore.max || 100}</span>
              </div>
              <div style={{ height: "6px", borderRadius: "4px", background: "var(--line)", marginTop: "14px", overflow: "hidden" }}>
                <div
                  style={{
                    height: "6px",
                    width: (optiScore.value / (optiScore.max || 100)) * 100 + "%",
                    borderRadius: "4px",
                    background: "var(--accent)",
                  }}
                />
              </div>
            </div>

            <div style={{ ...card, flex: 1, minHeight: "120px", padding: "2px 14px", display: "flex", flexDirection: "column", overflow: "hidden" }}>
              {stats.map((s) => (
                <div
                  key={s.label}
                  style={{
                    flex: 1,
                    minHeight: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "10px",
                    padding: "3px 0",
                    borderTop: "1px solid var(--line-soft)",
                  }}
                >
                  <span
                    style={{
                      ...kicker,
                      fontSize: "9.5px",
                      letterSpacing: "0.08em",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {s.label}
                  </span>
                  <span
                    style={{
                      fontSize: "clamp(13px,1.8vh,19px)",
                      fontWeight: 700,
                      letterSpacing: "-0.03em",
                      fontVariantNumeric: "tabular-nums",
                      lineHeight: 1,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {s.value}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                gap: "16px",
                marginBottom: "12px",
                flexShrink: 0,
              }}
            >
              <div
                style={{
                  fontSize: "15px",
                  fontWeight: 800,
                  letterSpacing: "-0.03em",
                  lineHeight: 1.2,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  minWidth: 0,
                }}
              >
                Good evening, {user.firstName}.{" "}
                <span style={{ color: "var(--faint)", fontWeight: 700 }}>Tonight&rsquo;s pass is set.</span>
              </div>
              <div style={{ ...kicker, fontSize: "10.5px", letterSpacing: "0.1em", whiteSpace: "nowrap" }}>
                {tickets.length ? tickets.length + " dishes on the rail" : "Rail is empty"}
              </div>
            </div>

            <div
              style={{
                position: "relative",
                height: "9px",
                flexShrink: 0,
                borderRadius: "6px",
                background: "linear-gradient(to bottom,var(--rail-2),var(--rail))",
                zIndex: 2,
              }}
            />

            <div
              style={{
                display: "grid",
                gridTemplateColumns: `repeat(${Math.max(1, tickets.length)}, minmax(0,1fr))`,
                gap: "14px",
                flex: 1,
                minHeight: "240px",
              }}
            >
              {tickets.length === 0 && (
                <div
                  style={{
                    marginTop: "14px",
                    border: "1px dashed var(--line)",
                    borderRadius: "10px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    textAlign: "center",
                    padding: "24px",
                    fontSize: "12.5px",
                    color: "var(--muted)",
                    maxWidth: "46ch",
                    justifySelf: "center",
                  }}
                >
                  No tickets on the rail yet — tonight&rsquo;s dishes print here once the day&rsquo;s sales and invoices are in.
                </div>
              )}
              {tickets.map((t, i) => (
                <Ticket
                  key={t.title}
                  t={t}
                  i={i}
                  restaurantName={restaurantName}
                  serviceNumber={serviceNumber}
                  timeLabel={timeLabel}
                  flipped={flipped === i}
                  onFlip={() => !tourActive && setFlipped((f) => (f === i ? null : i))}
                />
              ))}
            </div>
          </div>
        </div>

        {/* lower band: waste risk + week in review */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "0.85fr 2.15fr",
            gap: "16px",
            alignItems: "stretch",
            flex: "1 1 0",
            minHeight: "280px",
          }}
        >
          <div style={{ ...card, padding: "12px 14px", display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "12px",
                marginBottom: "6px",
                flexShrink: 0,
              }}
            >
              <div style={{ fontSize: "12.5px", fontWeight: 700, letterSpacing: "-0.02em" }}>Waste risk</div>
              <button
                type="button"
                onClick={() => setShowAllWaste((v) => !v)}
                className="om-hover-accent"
                style={{
                  flexShrink: 0,
                  background: "none",
                  border: "1px solid var(--line)",
                  borderRadius: "20px",
                  padding: "4px 11px",
                  fontFamily: SANS,
                  fontSize: "10.5px",
                  fontWeight: 600,
                  color: "var(--muted)",
                  cursor: "pointer",
                }}
              >
                {showAllWaste ? "Show fewer" : "See all " + waste.length + " at risk"}
              </button>
            </div>

            <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column" }}>
              {visibleWaste.map((w) => {
                const col = TONE[w.tone] || TONE.ok;
                return (
                  <div
                    key={w.name}
                    style={{
                      flex: 1,
                      minHeight: "34px",
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "center",
                      padding: "6px 0",
                      borderTop: "1px solid var(--line-soft)",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span style={{ width: "6px", height: "6px", borderRadius: "50%", flexShrink: 0, background: col }} />
                      <span
                        style={{
                          flex: 1,
                          fontSize: "11.5px",
                          fontWeight: 600,
                          color: "var(--text)",
                          textTransform: "capitalize",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {w.name}
                      </span>
                      <span style={{ fontFamily: MONO, fontSize: "9px", color: "var(--faint)", whiteSpace: "nowrap" }}>{w.qty}</span>
                      <span style={{ fontSize: "10.5px", fontWeight: 700, whiteSpace: "nowrap", color: col }}>{w.left}</span>
                    </div>
                    <div style={{ height: "3px", borderRadius: "2px", background: "var(--line)", marginTop: "6px", overflow: "hidden" }}>
                      <div style={{ height: "3px", borderRadius: "2px", background: col, width: w.pct + "%" }} />
                    </div>
                  </div>
                );
              })}
            </div>

            <div
              style={{
                display: "flex",
                gap: "14px",
                marginTop: "10px",
                paddingTop: "9px",
                flexShrink: 0,
                borderTop: "1px solid var(--line-soft)",
                fontFamily: MONO,
                fontSize: "9.5px",
                letterSpacing: "0.06em",
                color: "var(--faint)",
              }}
            >
              <span>
                <span style={{ display: "inline-block", width: "5px", height: "5px", borderRadius: "50%", background: "var(--red)", marginRight: "5px" }} />
                TODAY
              </span>
              <span>
                <span style={{ display: "inline-block", width: "5px", height: "5px", borderRadius: "50%", background: "var(--amber)", marginRight: "5px" }} />
                2 DAYS
              </span>
              <span>
                <span style={{ display: "inline-block", width: "5px", height: "5px", borderRadius: "50%", background: "var(--accent)", marginRight: "5px" }} />
                3–7 DAYS
              </span>
            </div>
          </div>

          <div style={{ ...card, padding: "12px 14px", display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1.55fr",
                gap: "16px",
                alignItems: "center",
                marginBottom: "12px",
                flexShrink: 0,
              }}
            >
              <div style={{ fontSize: "12.5px", fontWeight: 700, letterSpacing: "-0.02em" }}>Week in review</div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "12px", paddingLeft: "18px" }}>
                <button
                  type="button"
                  onClick={onPrevMonth}
                  style={{
                    width: "22px",
                    height: "22px",
                    border: "1px solid var(--line)",
                    borderRadius: "7px",
                    background: "none",
                    color: "var(--muted)",
                    cursor: "pointer",
                    fontSize: "12px",
                    lineHeight: 1,
                  }}
                >
                  &lsaquo;
                </button>
                <span style={{ fontSize: "12.5px", fontWeight: 700, letterSpacing: "-0.01em" }}>{week.month}</span>
                <button
                  type="button"
                  onClick={onNextMonth}
                  disabled={!canGoNextMonth}
                  style={{
                    width: "22px",
                    height: "22px",
                    border: "1px solid var(--line)",
                    borderRadius: "7px",
                    background: "none",
                    color: canGoNextMonth ? "var(--muted)" : "var(--faint)",
                    cursor: canGoNextMonth ? "pointer" : "default",
                    opacity: canGoNextMonth ? 1 : 0.4,
                    fontSize: "12px",
                    lineHeight: 1,
                  }}
                >
                  &rsaquo;
                </button>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1.55fr", gap: "16px", flex: 1, minHeight: "230px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "7px", minHeight: 0 }}>
                {week.stats.map((k) => (
                  <div
                    key={k.label}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "12px",
                      background: "var(--panel)",
                      border: "1px solid var(--line)",
                      borderRadius: "9px",
                      padding: "7px 10px",
                      flex: "1 1 0",
                      minHeight: 0,
                    }}
                  >
                    <div>
                      <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--text)" }}>{k.label}</div>
                      <div style={{ fontFamily: MONO, fontSize: "9.5px", letterSpacing: "0.06em", color: "var(--faint)", marginTop: "3px" }}>
                        {k.sub}
                      </div>
                    </div>
                    <div
                      style={{
                        fontSize: "14.5px",
                        fontWeight: 800,
                        letterSpacing: "-0.03em",
                        fontVariantNumeric: "tabular-nums",
                        color: k.tone === "green" ? "var(--green)" : k.tone === "red" ? "var(--red)" : "var(--accent-deep)",
                      }}
                    >
                      {k.value}
                    </div>
                  </div>
                ))}

                <div
                  style={{
                    flex: "1 1 0",
                    minHeight: 0,
                    background: "var(--accent-tint)",
                    borderRadius: "9px",
                    padding: "9px 11px",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                    gap: "4px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "10px" }}>
                    <div style={{ fontFamily: MONO, fontSize: "9.5px", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--accent-deep)" }}>
                      Top performer
                    </div>
                    <div style={{ fontFamily: MONO, fontSize: "9.5px", color: "var(--accent-deep)" }}>{week.top.date}</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "10px" }}>
                    <div style={{ fontSize: "12px", fontWeight: 700, letterSpacing: "-0.02em", color: "var(--text)" }}>{week.top.name}</div>
                    <div style={{ fontSize: "15px", fontWeight: 800, letterSpacing: "-0.03em", color: "var(--green)" }}>{week.top.delta}</div>
                  </div>
                </div>
              </div>

              <div style={{ borderLeft: "1px solid var(--line)", paddingLeft: "18px", display: "flex", flexDirection: "column", minHeight: 0 }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: "4px", marginBottom: "5px", flexShrink: 0 }}>
                  {DOWS.map((d) => (
                    <span key={d} style={{ fontFamily: MONO, fontSize: "10px", letterSpacing: "0.08em", color: "var(--faint)", textAlign: "center" }}>
                      {d}
                    </span>
                  ))}
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(7,1fr)",
                    gridAutoRows: "minmax(32px,1fr)",
                    gap: "4px",
                    flex: 1,
                    minHeight: 0,
                  }}
                >
                  {cells.map((c) =>
                    c.blank ? (
                      <span key={c.key} />
                    ) : (
                      <div
                        key={c.key}
                        onClick={() => c.clickable && setOpenCalendarDay((prev) => (prev === c.day ? null : c.day))}
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: "3px",
                          borderRadius: "8px",
                          border: "1px solid " + c.border,
                          background: c.bg,
                          cursor: c.clickable ? "pointer" : "default",
                        }}
                      >
                        <span style={{ fontSize: "13px", fontWeight: 600, color: c.numColor, lineHeight: 1 }}>{c.day}</span>
                        <span style={{ fontFamily: MONO, fontSize: "10px", fontWeight: 500, lineHeight: 1, color: c.subColor }}>{c.sub}</span>
                      </div>
                    )
                  )}
                </div>

                {openCalendarDayEntry && (
                  <div
                    style={{
                      marginTop: "10px",
                      paddingTop: "10px",
                      borderTop: "1px solid var(--line)",
                      flexShrink: 0,
                      maxHeight: "160px",
                      overflowY: "auto",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
                      <span style={{ fontFamily: MONO, fontSize: "9.5px", letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--faint)" }}>
                        {openCalendarDayEntry.dayLabel} · dish performance
                      </span>
                      <button
                        type="button"
                        onClick={() => setOpenCalendarDay(null)}
                        style={{ background: "none", border: "none", cursor: "pointer", fontSize: "10px", color: "var(--faint)", padding: 0 }}
                      >
                        Close ✕
                      </button>
                    </div>
                    {openCalendarDayEntry.dishes.length === 0 && (
                      <div style={{ fontSize: "11px", color: "var(--muted)" }}>No recommendations for this day.</div>
                    )}
                    {openCalendarDayEntry.dishes.map((dish, i) => {
                      const diffColor = dish.diff != null ? (dish.diff > 0 ? "var(--green)" : dish.diff < 0 ? "var(--red)" : "var(--muted)") : "var(--muted)";
                      return (
                        <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", padding: "5px 0" }}>
                          <span style={{ fontSize: "11.5px", fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {dish.name}
                          </span>
                          <span style={{ fontSize: "11px", fontWeight: 700, color: diffColor, flexShrink: 0 }}>
                            {dish.diff != null ? `${dish.diff > 0 ? "+" : ""}${dish.diff.toFixed(1)}` : "—"} sold
                            <span style={{ color: "var(--faint)", fontWeight: 500 }}> vs avg</span>
                          </span>
                        </div>
                      );
                    })}
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: "4px", paddingTop: "6px", borderTop: "1px dashed var(--line-soft)" }}>
                      <span style={{ fontSize: "10px", color: "var(--faint)" }}>Est. waste prevented</span>
                      <span style={{ fontSize: "10px", fontWeight: 600, color: "var(--green)" }}>${Math.round(openCalendarDayEntry.wasteSaved)}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <style>{CSS}</style>
      <div
        className="om-dash"
        data-theme={theme}
        style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}
      >
        {header}
        {body}
      </div>
    </>
  );
}

/* ── ticket ─────────────────────────────────────────────────────────── */

function Ticket({ t, i, restaurantName, serviceNumber, timeLabel, flipped, onFlip }) {
  const num = t.num || "#124-0" + (i + 1);
  const face = {
    position: "absolute",
    inset: 0,
    backfaceVisibility: "hidden",
    WebkitBackfaceVisibility: "hidden",
    display: "flex",
    flexDirection: "column",
    background: "var(--paper)",
    color: "var(--ink)",
    fontFamily: MONO,
    borderRadius: "4px",
    padding: "9px 10px 10px",
    boxShadow: "var(--shadow-lg)",
    overflow: "hidden",
  };

  return (
    <div style={{ position: "relative", display: "flex", flexDirection: "column", paddingTop: "9px" }}>
      <div
        style={{
          position: "absolute",
          top: "-7px",
          left: "50%",
          transform: "translateX(-50%)",
          width: "46px",
          height: "16px",
          borderRadius: "4px 4px 3px 3px",
          background: "linear-gradient(to bottom,var(--rail-2),var(--rail))",
          zIndex: 3,
        }}
      />
      <div
        style={{
          position: "relative",
          flex: 1,
          perspective: "1600px",
          transform: `rotate(${TILT[i % TILT.length]})`,
          transformOrigin: "top center",
          animation: "om-print .5s cubic-bezier(.25,.8,.35,1) both",
          animationDelay: 0.05 + i * 0.1 + "s",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            transformStyle: "preserve-3d",
            transition: "transform .6s cubic-bezier(.35,.1,.25,1)",
            transform: flipped ? "rotateY(180deg)" : "none",
          }}
        >
          {/* front */}
          <button type="button" onClick={onFlip} style={{ ...face, border: "none", textAlign: "left", cursor: "pointer" }}>
            <div style={{ textAlign: "center", paddingBottom: "7px" }}>
              <div style={{ fontSize: "9.5px", fontWeight: 500, letterSpacing: "0.06em", color: "var(--ink)" }}>{restaurantName}</div>
              <div style={{ fontSize: "8px", letterSpacing: "0.16em", color: "var(--ink-faint)", marginTop: "2px" }}>
                TONIGHT · SERVICE {serviceNumber}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "8.5px", letterSpacing: "0.08em", color: "var(--ink-soft)" }}>
              <span>{num}</span>
              <span>{timeLabel}</span>
            </div>
            <div style={{ ...dashRule, margin: "7px 0" }} />
            <div style={{ fontSize: "9.5px", fontWeight: 500, letterSpacing: "0.16em", color: t.color }}>{t.label}</div>
            <div style={{ fontFamily: SANS, fontSize: "13.5px", fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1.12, marginTop: "5px", color: "var(--ink)" }}>
              {t.title}
            </div>
            <div style={dashRule} />
            <div style={{ fontSize: "8px", letterSpacing: "0.16em", color: "var(--ink-faint)", textAlign: "center" }}>TONIGHT&rsquo;S PITCH</div>
            <div style={{ flex: "1 1 auto", minHeight: 0, overflow: "hidden", marginTop: "6px" }}>
              <div style={{ fontFamily: SANS, fontSize: "10.5px", fontStyle: "italic", lineHeight: 1.4, color: "var(--ink)" }}>{t.pitch}</div>
              <div style={{ fontFamily: SANS, fontSize: "9.5px", lineHeight: 1.45, color: "var(--ink-soft)", marginTop: "5px" }}>{t.reason}</div>
            </div>
            <div style={dashRule} />
            <div style={{ display: "flex", gap: "5px", flexWrap: "wrap" }}>
              <span style={pill}>{t.margin}</span>
              <span style={pill}>{t.cover}</span>
              <span style={{ ...pill, color: t.color, border: "1px solid " + t.color }}>{t.urgency}</span>
            </div>
            <div style={{ textAlign: "center", fontSize: "8px", letterSpacing: "0.14em", color: "var(--ink-faint)", marginTop: "9px" }}>
              · · · TAP FOR RECIPE · · ·
            </div>
          </button>

          {/* back */}
          <div onClick={onFlip} style={{ ...face, transform: "rotateY(180deg)", cursor: "pointer" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "10px", letterSpacing: "0.12em", color: "var(--ink-soft)" }}>
              <span>RECIPE · {num}</span>
              <button
                type="button"
                onClick={onFlip}
                style={{ background: "none", border: "none", cursor: "pointer", fontFamily: MONO, fontSize: "10px", letterSpacing: "0.08em", color: "var(--ink-soft)" }}
              >
                ↻ FLIP BACK
              </button>
            </div>
            <div style={{ ...dashRule, margin: "9px 0" }} />
            <div style={{ fontFamily: SANS, fontSize: "13.5px", fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1.15, color: "var(--ink)" }}>{t.title}</div>
            <div style={{ ...dashRule, margin: "11px 0" }} />
            <div style={{ flex: 1, overflowY: "auto" }}>
              {t.recipe.map((c) => (
                <div key={c.name} style={{ marginBottom: "12px" }}>
                  <div style={{ fontSize: "9px", fontWeight: 500, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--ink-soft)", marginBottom: "4px" }}>
                    {c.name}
                  </div>
                  {c.ings.map((g) => {
                    const col = g.risk ? "var(--red)" : "var(--ink-soft)";
                    return (
                      <div key={g.name} style={{ display: "flex", alignItems: "baseline", gap: "7px", fontSize: "10px", lineHeight: 1.75 }}>
                        <span style={{ color: col, whiteSpace: "nowrap" }}>{g.name}</span>
                        <span style={{ flex: 1, borderBottom: "1px dotted var(--ink-faint)", transform: "translateY(-3px)" }} />
                        <span style={{ color: col, whiteSpace: "nowrap" }}>{g.qty}</span>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
            <div style={{ ...dashRule, margin: "9px 0" }} />
            <div style={{ fontSize: "9.5px", fontWeight: 500, letterSpacing: "0.08em", color: "var(--red)" }}>{t.riskNote}</div>
            <button
              type="button"
              onClick={onFlip}
              style={{
                width: "100%",
                background: "none",
                border: "none",
                cursor: "pointer",
                fontFamily: MONO,
                fontSize: "9.5px",
                letterSpacing: "0.14em",
                color: "var(--ink-faint)",
                marginTop: "12px",
              }}
            >
              · · · TAP TO FLIP BACK · · ·
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── mobile ─────────────────────────────────────────────────────────── */

const MOBILE_TABS = ["Tonight's picks", "Metrics", "Waste risk", "Week review", "Prices"];

function MobileView({ restaurantName, dateLabel, timeLabel, optiScore, tickets, waste, stats, weekData, weekExtraSold, weekWasteSaved, hitRate, activeNav, Link }) {
  const [tab, setTab] = useState(MOBILE_TABS[0]);
  return (
    <div style={{ background: "var(--panel)", flex: 1, display: "flex", flexDirection: "column" }}>
      <div
        style={{
          padding: "14px 16px",
          borderBottom: "1px solid var(--line)",
          background: "var(--shell)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "12px",
        }}
      >
        <div>
          <div style={{ fontSize: "16px", fontWeight: 800, letterSpacing: "-0.03em" }}>{restaurantName}</div>
          <div style={{ fontFamily: MONO, fontSize: "10px", letterSpacing: "0.08em", color: "var(--faint)", marginTop: "3px" }}>
            {dateLabel.toUpperCase()} · {timeLabel}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontFamily: MONO, fontSize: "9.5px", letterSpacing: "0.1em", color: "var(--faint)" }}>OPTISCORE</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: "4px", justifyContent: "flex-end" }}>
            <span style={{ fontSize: "22px", fontWeight: 800, letterSpacing: "-0.03em" }}>{optiScore.value}</span>
            <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--accent-deep)" }}>{optiScore.label}</span>
          </div>
        </div>
      </div>

      <div className="om-scroll-x" style={{ display: "flex", gap: "6px", padding: "12px 16px", borderBottom: "1px solid var(--line)", background: "var(--shell)" }}>
        {MOBILE_TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            style={{
              flexShrink: 0,
              fontFamily: SANS,
              fontSize: "12.5px",
              fontWeight: 600,
              border: "none",
              borderRadius: "20px",
              padding: "9px 14px",
              minHeight: "44px",
              cursor: "pointer",
              whiteSpace: "nowrap",
              color: t === tab ? "var(--accent-deep)" : "var(--muted)",
              background: t === tab ? "var(--accent-tint)" : "transparent",
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Tonight's picks" && (
        <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "14px" }}>
          {tickets.map((t, i) => (
            <div key={t.title} style={{ background: "var(--paper)", color: "var(--ink)", fontFamily: MONO, borderRadius: "5px", padding: "15px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "10px", letterSpacing: "0.14em" }}>
                <span style={{ color: t.color, fontWeight: 500 }}>{t.label}</span>
                <span style={{ color: "var(--ink-faint)" }}>{t.num || "#124-0" + (i + 1)}</span>
              </div>
              <div style={{ ...dashRule, margin: "10px 0" }} />
              <div style={{ fontFamily: SANS, fontSize: "20px", fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1.15, color: "var(--ink)" }}>{t.title}</div>
              <div style={{ ...dashRule, margin: "10px 0" }} />
              <div style={{ fontFamily: SANS, fontSize: "13.5px", fontStyle: "italic", lineHeight: 1.45, color: "var(--ink)" }}>{t.pitch}</div>
              <div style={{ fontFamily: SANS, fontSize: "12.5px", lineHeight: 1.5, color: "var(--ink-soft)", marginTop: "8px" }}>{t.reason}</div>
            </div>
          ))}

          <div style={{ ...card, padding: "16px" }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: "4px" }}>
              <div style={{ fontSize: "14px", fontWeight: 700, letterSpacing: "-0.02em" }}>Waste risk</div>
              <span style={{ fontFamily: MONO, fontSize: "9.5px", letterSpacing: "0.08em", color: "var(--faint)" }}>{waste.length} AT RISK</span>
            </div>
            {waste.slice(0, 3).map((w) => (
              <div key={w.name} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "11px 0", borderTop: "1px solid var(--line-soft)" }}>
                <span style={{ width: "6px", height: "6px", borderRadius: "50%", flexShrink: 0, background: TONE[w.tone] || TONE.ok }} />
                <span style={{ flex: 1, fontSize: "13px", fontWeight: 600, textTransform: "capitalize" }}>{w.name}</span>
                <span style={{ fontSize: "11.5px", fontWeight: 700, color: TONE[w.tone] || TONE.ok }}>{w.left}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "Metrics" && (
        <div style={{ padding: "16px" }}>
          <MobileMetricsTab stats={stats} />
        </div>
      )}

      {tab === "Waste risk" && (
        <div style={{ padding: "16px" }}>
          <MobileWasteTab waste={waste} />
        </div>
      )}

      {tab === "Week review" && (
        <div style={{ padding: "16px" }}>
          <MobileWeekTab weekData={weekData} weekExtraSold={weekExtraSold} weekWasteSaved={weekWasteSaved} hitRate={hitRate} />
        </div>
      )}

      {tab === "Prices" && (
        <div style={{ padding: "16px" }}>
          <MobilePricesTab Link={Link} />
        </div>
      )}

      <div style={{ display: "flex", borderTop: "1px solid var(--line)", background: "var(--shell)", marginTop: "auto", position: "sticky", bottom: 0 }}>
        {NAV.map((n) => {
          const on = n.key === activeNav;
          return (
            <Link
              key={n.key}
              href={n.href}
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "4px",
                padding: "11px 0 16px",
                minHeight: "44px",
                color: on ? "var(--accent)" : "var(--faint)",
              }}
            >
              <span style={{ width: "16px", height: "16px", borderRadius: "4px", border: "1.5px solid currentColor" }} />
              <span style={{ fontSize: "9.5px", fontWeight: 600 }}>{n.label}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

/* ── Mobile tab panels ────────────────────────────────────────────────── */

function MobileMetricsTab({ stats }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
      {(stats || []).map((s) => (
        <div key={s.label} style={{ background: "var(--shell)", border: "1px solid var(--line)", borderRadius: "10px", padding: "13px 14px" }}>
          <div style={{ fontFamily: MONO, fontSize: "9.5px", letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--faint)", marginBottom: "5px" }}>
            {s.label}
          </div>
          <div style={{ fontSize: "18px", fontWeight: 800, letterSpacing: "-0.02em", color: "var(--text)" }}>{s.value}</div>
        </div>
      ))}
    </div>
  );
}

function MobileWasteTab({ waste }) {
  if (!waste || waste.length === 0) {
    return <div style={{ fontSize: "13px", color: "var(--faint)", textAlign: "center", padding: "24px 0" }}>Nothing at risk right now.</div>;
  }
  return (
    <div style={{ ...card, padding: "6px 16px" }}>
      {waste.map((w) => (
        <div key={w.name} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "12px 0", borderBottom: "1px solid var(--line-soft)" }}>
          <span style={{ width: "7px", height: "7px", borderRadius: "50%", flexShrink: 0, background: TONE[w.tone] || TONE.ok }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: "13.5px", fontWeight: 600, textTransform: "capitalize" }}>{w.name}</div>
            {w.qty && <div style={{ fontSize: "11px", color: "var(--faint)", marginTop: "2px" }}>{w.qty}</div>}
          </div>
          <span style={{ fontSize: "12px", fontWeight: 700, color: TONE[w.tone] || TONE.ok, whiteSpace: "nowrap" }}>{w.left}</span>
        </div>
      ))}
    </div>
  );
}

/* Ported from dashboard3.js's MobileWeekInReview, adapted to take data as
   props (from the parent's single useWeekInReview call) instead of calling
   the hook itself — avoids a second, duplicate fetch of the same data the
   desktop calendar already loaded. */
function MobileWeekTab({ weekData, weekExtraSold, weekWasteSaved, hitRate }) {
  const [openDay, setOpenDay] = useState(null);
  const openDayData = (weekData || []).find((d) => d.date === openDay);

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px", marginBottom: "12px" }}>
        {[
          { l: "Extra sold", v: `${weekExtraSold >= 0 ? "+" : ""}${weekExtraSold}`, c: weekExtraSold >= 0 ? "var(--green)" : "var(--red)", sub: "vs avg" },
          { l: "Waste saved", v: `$${Math.round(weekWasteSaved)}`, c: "var(--green)", sub: "est." },
          { l: "Hit rate", v: `${hitRate}%`, c: "var(--accent)", sub: "days above avg" },
        ].map(({ l, v, c, sub }) => (
          <div key={l} style={{ background: "var(--shell)", border: "1px solid var(--line)", borderRadius: "8px", padding: "10px 8px" }}>
            <div style={{ fontFamily: MONO, fontSize: "9px", color: "var(--faint)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "4px" }}>{l}</div>
            <div style={{ fontFamily: SANS, fontSize: "17px", fontWeight: 700, color: c, lineHeight: 1 }}>{v}</div>
            <div style={{ fontSize: "9px", color: "var(--faint)", marginTop: "3px" }}>{sub}</div>
          </div>
        ))}
      </div>
      {(weekData || []).map((day) => {
        const isOpen = openDay === day.date;
        const extraColor = day.extraSold > 0 ? "var(--green)" : day.extraSold < 0 ? "var(--red)" : "var(--faint)";
        return (
          <div key={day.date} style={{ background: "var(--shell)", border: `1px solid ${isOpen ? "var(--accent)" : "var(--line)"}`, borderRadius: "8px", marginBottom: "8px", overflow: "hidden", transition: "border-color .15s" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "10px 12px", cursor: "pointer" }} onClick={() => setOpenDay((prev) => (prev === day.date ? null : day.date))}>
              <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--text)", width: "28px", flexShrink: 0 }}>{day.dayLabel}</span>
              <span style={{ fontSize: "10px", color: "var(--faint)", width: "32px", flexShrink: 0 }}>{day.date.slice(5).replace("-", "/")}</span>
              <div style={{ flex: 1, display: "flex", gap: "4px", overflow: "hidden" }}>
                {day.dishes.length > 0 ? (
                  day.dishes.map((d, i) => (
                    <span key={i} style={{ fontSize: "9px", fontWeight: 600, padding: "2px 6px", borderRadius: "3px", background: d.ticketColor, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "80px", opacity: 0.85 }}>
                      {d.name.split(" ").slice(0, 2).join(" ")}
                    </span>
                  ))
                ) : (
                  <span style={{ fontSize: "9px", color: "var(--faint)" }}>No recs</span>
                )}
              </div>
              <span style={{ fontFamily: SANS, fontSize: "12px", fontWeight: 700, color: extraColor, flexShrink: 0 }}>{day.extraSold > 0 ? "+" : ""}{day.extraSold}</span>
              <span style={{ fontSize: "9px", color: "var(--faint)", flexShrink: 0 }}>{isOpen ? "▴" : "▾"}</span>
            </div>
            {isOpen && openDayData && (
              <div style={{ padding: "0 12px 12px", borderTop: "1px solid var(--line-soft)" }}>
                <div style={{ fontFamily: MONO, fontSize: "9px", fontWeight: 600, color: "var(--faint)", textTransform: "uppercase", letterSpacing: "0.07em", margin: "10px 0 8px" }}>Dish performance</div>
                {openDayData.dishes.length === 0 && <div style={{ fontSize: "11px", color: "var(--muted)" }}>No recommendations for this day.</div>}
                {openDayData.dishes.map((dish, i) => {
                  const diff = dish.diff;
                  const diffColor = diff !== null ? (diff > 0 ? "var(--green)" : diff < 0 ? "var(--red)" : "var(--muted)") : "var(--muted)";
                  const maxBar = Math.max(dish.sold, dish.avg || 0, 1);
                  return (
                    <div key={i} style={{ marginBottom: "12px" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          <span style={{ fontSize: "9px", fontWeight: 600, color: dish.ticketColor, textTransform: "uppercase" }}>{i === 0 ? "Push" : i === 1 ? "Rec" : "Mention"}</span>
                          <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--text)" }}>{dish.name}</span>
                        </div>
                        <span style={{ fontSize: "11px", fontWeight: 700, color: diffColor }}>{diff !== null ? `${diff > 0 ? "+" : ""}${diff.toFixed(1)}` : "—"}</span>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          <span style={{ fontSize: "9px", color: "var(--faint)", width: "24px", flexShrink: 0 }}>Sold</span>
                          <div style={{ flex: 1, height: "4px", background: "var(--line-soft)", borderRadius: "2px", overflow: "hidden" }}>
                            <div style={{ width: `${(dish.sold / maxBar) * 100}%`, height: "100%", background: "var(--accent)", borderRadius: "2px" }} />
                          </div>
                          <span style={{ fontSize: "9px", fontWeight: 600, color: "var(--accent)", width: "20px", textAlign: "right" }}>{dish.sold}</span>
                        </div>
                        {dish.avg !== null && (
                          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                            <span style={{ fontSize: "9px", color: "var(--faint)", width: "24px", flexShrink: 0 }}>Avg</span>
                            <div style={{ flex: 1, height: "4px", background: "var(--line-soft)", borderRadius: "2px", overflow: "hidden" }}>
                              <div style={{ width: `${(dish.avg / maxBar) * 100}%`, height: "100%", background: "var(--line)", borderRadius: "2px" }} />
                            </div>
                            <span style={{ fontSize: "9px", fontWeight: 600, color: "var(--faint)", width: "20px", textAlign: "right" }}>{dish.avg.toFixed(1)}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
                <div style={{ display: "flex", justifyContent: "space-between", paddingTop: "8px", borderTop: "1px solid var(--line-soft)" }}>
                  <span style={{ fontSize: "10px", color: "var(--faint)" }}>Est. waste prevented</span>
                  <span style={{ fontSize: "10px", fontWeight: 600, color: "var(--green)" }}>${Math.round(day.wasteSaved)}</span>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* Old dashboard3.js had a category-level price-movement tab here
   (MobilePriceMovement, backed by computePriceByCategory). That feature was
   superseded by the richer per-ingredient price history now on
   components/client/IngredientsScreen.js, not carried into this rebuild —
   see chat. This points there instead of re-adding the old scope. */
function MobilePricesTab({ Link }) {
  return (
    <div style={{ ...card, padding: "24px 16px", textAlign: "center" }}>
      <div style={{ fontSize: "14px", fontWeight: 700, marginBottom: "6px" }}>Ingredient price trends</div>
      <div style={{ fontSize: "12.5px", color: "var(--muted)", lineHeight: 1.5, marginBottom: "16px" }}>
        Price history and movement now live on the Ingredients page, with a full trend per ingredient.
      </div>
      <Link
        href="/client/ingredients"
        style={{
          display: "inline-block",
          background: "var(--accent)",
          color: "#fff",
          borderRadius: "22px",
          padding: "10px 22px",
          fontFamily: SANS,
          fontSize: "13px",
          fontWeight: 700,
        }}
      >
        Open Ingredients
      </Link>
    </div>
  );
}

export { DEMO_TICKETS, DEMO_WASTE, DEMO_STATS, DEMO_WEEK };
