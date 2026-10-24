import React, { useCallback, useEffect, useMemo, useState } from "react";
import { MobileHeader, MobileNav, LoadingState, ErrorState, useTheme } from "../client/ClientChrome";
import NotificationBell from "../client/NotificationBell";

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
.om-dash[data-theme="dark"],html[data-om-theme="dark"] .om-dash{
  --ground:#0e0f11;--shell:#1a1b1e;--panel:#121315;--line:#26272b;--line-soft:#1f2023;
  --text:#eceae4;--muted:#a9a7a0;--faint:#7f7d77;
  --accent:#43bccb;--accent-deep:#6fd0dc;--accent-tint:#16292c;
  --green:#6cc287;--amber:#e3ab4c;--red:#ee7d70;
  --shadow-lg:0 24px 60px rgba(0,0,0,0.6);
  --rail:#2a2b2f;--rail-2:#36373c;
  --card-lift:0 1px 1px rgba(0,0,0,0.4),0 3px 8px rgba(0,0,0,0.4),0 12px 26px rgba(0,0,0,0.45);
  --paper:#c9cec6;--paper-line:#b2b8b0;--ink:#111617;--ink-soft:#3d4648;--ink-faint:#687270;
}
.om-dash[data-theme="dark"] [style*="var(--paper)"],html[data-om-theme="dark"] .om-dash [style*="var(--paper)"]{
  --accent:#047a88;--accent-deep:#035f6b;--green:#24603a;--amber:#7a5410;--red:#9c3328;
  --text:#111617;--muted:#3d4648;--faint:#687270;--line:#b2b8b0;--line-soft:#bfc4bc;
}
.om-dash[data-theme="dark"] [style*="background: var(--accent)"],html[data-om-theme="dark"] .om-dash [style*="background: var(--accent)"]{color:#0e1516 !important}
.om-dash[data-theme="dark"] [style*="background: var(--accent)"] svg,html[data-om-theme="dark"] .om-dash [style*="background: var(--accent)"] svg{stroke:#0e1516}
html[data-om-theme="dark"]{
  --shell:#1a1b1e;--panel:#121315;--line:#26272b;--line-soft:#1f2023;
  --text:#eceae4;--muted:#a9a7a0;--faint:#7f7d77;
  --accent:#43bccb;--accent-deep:#6fd0dc;--accent-tint:#16292c;
  --green:#6cc287;--amber:#e3ab4c;--red:#ee7d70;--red-tint:#2b1a18;--amber-tint:#2a2214;
}
html[data-om-theme="dark"] [style*="background: var(--accent,"]{color:#0e1516 !important}
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

const STAT_TONE = { ok: "var(--text)", warn: "var(--amber)", bad: "var(--red)" };

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
  { label: "Avg margin", value: "64.2%", note: "target 70% · 18 priced", tone: "bad" },
  { label: "Low-margin", value: "7", note: "dishes under 50%", tone: "bad" },
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
  ticketsStatus = "ready",
  onRetryTickets,
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
  onSignOut,
  serviceNumber = "001",
  logoSrc = "/landing/logo.png",
  logoDarkSrc = "/landing/logo-knockout.png",
}) {
  // Shared, saved theme (same as every other page).
  const [theme, toggleTheme] = useTheme(themeProp, defaultTheme, onThemeChange);
  const dark = theme === "dark";
  const isMobile = useMediaQuery("(max-width: 900px)");
  const [flipped, setFlipped] = useState(null);
  const [openCalendarDay, setOpenCalendarDay] = useState(null);
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);

  const Link = NavLink || (({ href, children, style, className }) => (
    <a href={href} style={style} className={className}>{children}</a>
  ));

  const visibleWaste = waste;

  const buckets = optiScore.buckets || [];
  const scoreTone =
    optiScore.label === "Strong" ? "var(--green)" : optiScore.label === "Good" ? "var(--accent-deep)" : optiScore.label === "Needs work" ? "var(--amber)" : "var(--faint)";

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
      const noData = v === null; // on or before signup: no real history
      const has = v !== undefined && v !== null;
      const future = week.todayDay ? d > week.todayDay : false;
      const today = week.todayDay === d;
      out.push({
        key: "d" + d,
        day: d,
        today,
        sub: noData ? "—" : has ? (v > 0 ? "+" + v : String(v)) : "",
        // Plain cells; only the number carries color: green for a gain,
        // grey for flat or a dip. Tonight is outlined in teal.
        bg: has || noData ? "var(--panel)" : "transparent",
        border: openCalendarDay === d || today ? "var(--accent)" : has || noData ? "var(--line)" : "transparent",
        numColor: today ? "var(--accent-deep)" : future ? "var(--faint)" : has || noData ? "var(--text)" : "var(--muted)",
        subColor: noData ? "var(--faint)" : has ? (v > 0 ? "var(--green)" : "var(--muted)") : "transparent",
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
        <NotificationBell onOpen={() => setProfileDropdownOpen(false)} />
        <div style={{ position: "relative", paddingLeft: "6px", borderLeft: "1px solid var(--line)" }}>
          <div
            onClick={() => setProfileDropdownOpen((v) => !v)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "9px",
              cursor: "pointer",
              padding: "3px",
              borderRadius: "20px",
              border: `1.5px solid ${profileDropdownOpen ? "var(--accent)" : "transparent"}`,
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
                flexShrink: 0,
              }}
            >
              {user.initials}
            </div>
            <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--text)" }}>{user.firstName}</span>
          </div>
          {profileDropdownOpen && (
            <>
              <div onClick={() => setProfileDropdownOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 199, background: "transparent" }} />
              <div
                style={{
                  position: "absolute",
                  top: "calc(100% + 8px)",
                  right: 0,
                  background: "var(--shell)",
                  border: "1px solid var(--line)",
                  borderRadius: "10px",
                  width: "230px",
                  overflow: "hidden",
                  boxShadow: "var(--shadow-lg)",
                  zIndex: 200,
                }}
              >
                <div style={{ padding: "13px 15px", borderBottom: "1px solid var(--line-soft)" }}>
                  <div style={{ fontSize: "13.5px", fontWeight: 700, color: "var(--text)" }}>{user.firstName}</div>
                  <div style={{ fontSize: "11.5px", color: "var(--faint)", marginTop: "2px" }}>{restaurantName}</div>
                </div>
                <div style={{ padding: "6px" }}>
                  <Link
                    href="/client/profile"
                    style={{ display: "flex", alignItems: "center", gap: "10px", padding: "9px 10px", borderRadius: "7px", color: "var(--text)", fontSize: "13px", fontWeight: 500 }}
                  >
                    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="var(--faint)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
                    Profile &amp; settings
                  </Link>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "9px 10px", borderRadius: "7px" }}>
                    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="var(--faint)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>
                    <span style={{ fontSize: "13px", color: "var(--text)", fontWeight: 500, flex: 1 }}>{dark ? "Light mode" : "Dark mode"}</span>
                    <button
                      type="button"
                      onClick={toggleTheme}
                      style={{
                        width: "34px",
                        height: "19px",
                        borderRadius: "10px",
                        border: "1px solid var(--line)",
                        position: "relative",
                        cursor: "pointer",
                        flexShrink: 0,
                        background: dark ? "var(--accent)" : "var(--line)",
                      }}
                    >
                      <div style={{ position: "absolute", top: "1px", left: dark ? "17px" : "1px", width: "15px", height: "15px", borderRadius: "50%", background: "#fff", transition: "left .2s" }} />
                    </button>
                  </div>
                  <Link
                    href="/client/profile?tab=support"
                    style={{ display: "flex", alignItems: "center", gap: "10px", padding: "9px 10px", borderRadius: "7px", color: "var(--text)", fontSize: "13px", fontWeight: 500 }}
                  >
                    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="var(--faint)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
                    Support &amp; feedback
                  </Link>
                  <div style={{ height: "1px", background: "var(--line-soft)", margin: "4px 0" }} />
                  <div
                    onClick={onSignOut}
                    style={{ display: "flex", alignItems: "center", gap: "10px", padding: "9px 10px", borderRadius: "7px", color: "var(--red)", fontSize: "13px", fontWeight: 500, cursor: "pointer" }}
                  >
                    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="var(--red)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
                    Sign out
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );

  let body;

  if (loading && isMobile) {
    body = (
      <div style={{ background: "var(--panel)", flex: 1, display: "flex", flexDirection: "column" }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          <LoadingState label="Setting the pass…" mobile />
        </div>
        <MobileNav active={activeNav} NavLink={Link} />
      </div>
    );
  } else if (loading) {
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
  } else if (error && isMobile) {
    body = (
      <div style={{ background: "var(--panel)", flex: 1, display: "flex", flexDirection: "column" }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          <ErrorState message="We couldn’t reach your restaurant’s data. Nothing was lost, and tonight’s pass prints as soon as the connection is back." onRetry={onRetry} />
        </div>
        <MobileNav active={activeNav} NavLink={Link} />
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
    // Phones: the same month calendar as desktop, then the week numbers as
    // three tiles and the top performer, all in one card.
    const monthBtn = (enabled) => ({ width: "36px", height: "36px", border: "1px solid var(--line)", borderRadius: "9px", background: "none", color: enabled ? "var(--muted)" : "var(--faint)", opacity: enabled ? 1 : 0.45, cursor: enabled ? "pointer" : "default", fontSize: "16px", lineHeight: 1 });
    const statColor = (tone) => (tone === "green" ? "var(--green)" : tone === "red" ? "var(--red)" : tone === "muted" ? "var(--muted)" : "var(--accent-deep)");
    const mobileWeek = (
      <div style={{ background: "var(--shell)", border: "1px solid var(--line)", borderRadius: "14px", padding: "14px", boxShadow: "0 1px 1px rgba(17,24,25,0.05), 0 3px 6px rgba(17,24,25,0.07)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
          <div style={{ fontSize: "15px", fontWeight: 800, letterSpacing: "-0.02em" }}>Month in review</div>
          <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <button type="button" onClick={onPrevMonth} aria-label="Previous month" style={monthBtn(true)}>&lsaquo;</button>
            <span style={{ fontSize: "13px", fontWeight: 700, padding: "0 6px", whiteSpace: "nowrap" }}>{week.month}</span>
            <button type="button" onClick={onNextMonth} disabled={!canGoNextMonth} aria-label="Next month" style={monthBtn(canGoNextMonth)}>&rsaquo;</button>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: "4px", marginBottom: "5px" }}>
          {DOWS.map((d) => (
            <span key={d} style={{ fontFamily: MONO, fontSize: "10px", letterSpacing: "0.08em", color: "var(--faint)", textAlign: "center" }}>{d}</span>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gridAutoRows: "44px", gap: "4px" }}>
          {cells.map((c) =>
            c.blank ? (
              <span key={c.key} />
            ) : (
              <button
                key={c.key}
                type="button"
                onClick={() => c.clickable && setOpenCalendarDay((prev) => (prev === c.day ? null : c.day))}
                aria-label={"Day " + c.day}
                style={{ padding: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "3px", borderRadius: "8px", border: (c.today || openCalendarDay === c.day ? "1.5px solid " : "1px solid ") + c.border, background: openCalendarDay === c.day ? "var(--accent-tint)" : c.bg, cursor: c.clickable ? "pointer" : "default", fontFamily: SANS }}
              >
                <span style={{ fontSize: "13px", fontWeight: c.today ? 800 : 600, color: c.numColor, lineHeight: 1 }}>{c.day}</span>
                <span style={{ fontFamily: MONO, fontSize: "9.5px", fontWeight: 500, lineHeight: 1, color: c.subColor }}>{c.sub}</span>
              </button>
            )
          )}
        </div>

        {openCalendarDayEntry && (
          <div style={{ marginTop: "12px", background: "var(--paper)", border: "1px dashed var(--paper-line)", borderRadius: "10px", padding: "10px 12px", fontFamily: MONO, color: "var(--ink)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
              <span style={{ fontSize: "10px", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ink-soft)" }}>{openCalendarDayEntry.dayLabel} · dish performance</span>
              <button type="button" onClick={() => setOpenCalendarDay(null)} style={{ minHeight: "32px", background: "none", border: "none", padding: "0 0 0 10px", fontFamily: MONO, fontSize: "10px", letterSpacing: "0.08em", color: "var(--ink-soft)", cursor: "pointer" }}>CLOSE ✕</button>
            </div>
            {openCalendarDayEntry.dishes.length === 0 && (
              <div style={{ fontFamily: SANS, fontSize: "12px", color: "var(--ink-soft)", padding: "4px 0" }}>No recommendations for this day.</div>
            )}
            {openCalendarDayEntry.dishes.map((dish, k) => {
              const tagInfo = k === 0 ? ["PUSH", "var(--accent-deep)"] : k === 1 ? ["REC", "var(--green)"] : ["MENTION", "var(--amber)"];
              const diffColor = dish.diff != null ? (dish.diff > 0 ? "var(--green)" : dish.diff < 0 ? "var(--red)" : "var(--ink-soft)") : "var(--ink-soft)";
              return (
                <div key={k} style={{ display: "flex", alignItems: "baseline", gap: "7px", padding: "4px 0", fontSize: "11.5px" }}>
                  <span style={{ fontSize: "9px", letterSpacing: "0.1em", color: tagInfo[1], width: "52px", flexShrink: 0 }}>{tagInfo[0]}</span>
                  <span style={{ fontFamily: SANS, fontSize: "13px", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{dish.name}</span>
                  <span style={{ flex: 1, minWidth: "8px", borderBottom: "1px dotted var(--ink-faint)", transform: "translateY(-3px)" }} />
                  <span style={{ fontWeight: 500, color: diffColor, whiteSpace: "nowrap" }}>
                    {dish.diff != null ? `${dish.diff > 0 ? "+" : ""}${dish.diff.toFixed(1)}` : "—"} sold
                  </span>
                </div>
              );
            })}
            <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px dashed var(--paper-line)", marginTop: "5px", paddingTop: "7px", fontSize: "10.5px" }}>
              <span style={{ color: "var(--ink-soft)" }}>EST. WASTE PREVENTED</span>
              <span style={{ color: "var(--green)", fontWeight: 500 }}>${Math.round(openCalendarDayEntry.wasteSaved)}</span>
            </div>
          </div>
        )}

        <div style={{ marginTop: "12px", display: "grid", gridTemplateColumns: `repeat(${Math.max(1, week.stats.length)}, minmax(0,1fr))`, gap: "8px" }}>
          {week.stats.map((k) => (
            <div key={k.label} style={{ background: "var(--panel)", borderRadius: "10px", padding: "10px", minWidth: 0 }}>
              <div style={{ fontFamily: MONO, fontSize: "9px", letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--muted)" }}>{k.label}</div>
              <div style={{ fontSize: "19px", fontWeight: 800, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums", marginTop: "3px", color: statColor(k.tone) }}>{k.value}</div>
              {k.sub && <div style={{ fontFamily: MONO, fontSize: "8.5px", letterSpacing: "0.04em", lineHeight: 1.35, color: "var(--muted)", marginTop: "3px" }}>{k.sub}</div>}
            </div>
          ))}
        </div>
        {week.top && (
          <div style={{ marginTop: "8px", background: "var(--accent-tint)", borderRadius: "10px", padding: "11px 12px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: MONO, fontSize: "9.5px", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--accent-deep)" }}>Top performer{week.top.date ? " · " + week.top.date : ""}</div>
              <div style={{ fontSize: "14px", fontWeight: 700, marginTop: "3px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{week.top.name}</div>
            </div>
            {week.top.delta && <div style={{ fontSize: "19px", fontWeight: 800, letterSpacing: "-0.03em", color: "var(--green)", flexShrink: 0 }}>{week.top.delta}</div>}
          </div>
        )}
      </div>
    );
    body = (
      <MobileView
        weekView={mobileWeek}
        restaurantName={restaurantName}
        user={user}
        dateLabel={dateLabel}
        timeLabel={timeLabel}
        optiScore={optiScore}
        buckets={buckets}
        scoreTone={scoreTone}
        stats={stats}
        tickets={tickets}
        ticketsStatus={ticketsStatus}
        onRetryTickets={onRetryTickets}
        serviceNumber={serviceNumber}
        waste={waste}
        activeNav={activeNav}
        Link={Link}
        tourActive={tourActive}
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
            gridTemplateColumns: "264px 1fr",
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

            <div
              data-tour="db-panel"
              style={{ ...card, padding: "13px 14px", flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: "9px", overflow: "hidden" }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={kicker}>OptiScore</div>
                <div
                  style={{
                    fontSize: "10.5px",
                    fontWeight: 700,
                    letterSpacing: "0.04em",
                    textTransform: "uppercase",
                    color: scoreTone,
                    background: `color-mix(in srgb, ${scoreTone} 14%, var(--shell))`,
                    borderRadius: "20px",
                    padding: "3px 9px",
                  }}
                >
                  {optiScore.label}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: "6px" }}>
                <span style={{ fontSize: "28px", fontWeight: 800, letterSpacing: "-0.04em", lineHeight: 0.9 }}>
                  {optiScore.value == null ? "—" : optiScore.value}
                </span>
                <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--faint)" }}>/ {optiScore.max || 100}</span>
              </div>
              {/* score bar; the tick marks 65, where "Good" starts */}
              <div style={{ position: "relative", height: "6px", borderRadius: "4px", background: "var(--line)", flexShrink: 0 }}>
                <div
                  style={{
                    height: "6px",
                    width: ((optiScore.value || 0) / (optiScore.max || 100)) * 100 + "%",
                    borderRadius: "4px",
                    background: "var(--accent)",
                  }}
                />
                <div style={{ position: "absolute", top: "-3px", left: "65%", width: "2px", height: "12px", background: "var(--text)" }} />
              </div>

              {buckets.length > 0 && (
                <div
                  style={{
                    flex: 1,
                    minHeight: 0,
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-evenly",
                    gap: "8px",
                    padding: "6px 0 4px",
                    borderTop: "1px solid var(--line-soft)",
                  }}
                >
                  {buckets.map((b) => (
                    <div key={b.name} style={{ display: "grid", gridTemplateColumns: "62px minmax(0,1fr) 48px", alignItems: "center", gap: "8px" }}>
                      <span style={{ fontSize: "11.5px", fontWeight: 600 }}>{b.name}</span>
                      <div style={{ height: "4px", borderRadius: "2px", background: "var(--line-soft)", overflow: "hidden" }}>
                        <div style={{ height: "100%", width: (b.max ? Math.min(100, (b.score / b.max) * 100) : 0) + "%", background: "var(--accent)" }} />
                      </div>
                      <span style={{ fontFamily: MONO, fontSize: "10px", textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", color: "var(--muted)" }}>
                        {b.max ? `${Math.round(b.score)}/${Math.round(b.max)}` : "day 31+"}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: "8px", flexShrink: 0, marginTop: buckets.length ? 0 : "auto" }}>
                {stats.map((s) => (
                  <div key={s.label} style={{ background: "var(--panel)", border: "1px solid var(--line-soft)", borderRadius: "8px", padding: "8px 10px", minWidth: 0 }}>
                    <div style={{ ...kicker, fontSize: "9px", letterSpacing: "0.08em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.label}</div>
                    <div style={{ fontSize: "17px", fontWeight: 800, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums", marginTop: "3px", color: STAT_TONE[s.tone] || "var(--text)" }}>
                      {s.value}
                    </div>
                    {s.note && (
                      <div style={{ fontSize: "10px", color: "var(--muted)", marginTop: "1px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.note}</div>
                    )}
                  </div>
                ))}
              </div>
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
                {(() => { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"; })()}, {user.firstName}.{" "}
                <span style={{ color: "var(--faint)", fontWeight: 700 }}>
                  {tickets.length
                    ? "Tonight\u2019s pass is set."
                    : ticketsStatus === "loading"
                      ? "Printing tonight\u2019s tickets\u2026"
                      : "Tonight\u2019s pass is waiting."}
                </span>
              </div>
              <div style={{ ...kicker, fontSize: "10.5px", letterSpacing: "0.1em", whiteSpace: "nowrap" }}>
                {tickets.length ? tickets.length + " dishes on the rail" : ticketsStatus === "loading" ? "Printing\u2026" : "Rail is empty"}
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
                  {ticketsStatus === "loading" ? (
                    <>Printing tonight&rsquo;s tickets&hellip; the first look each day can take up to a minute.</>
                  ) : ticketsStatus === "error" ? (
                    <>
                      Tonight&rsquo;s tickets didn&rsquo;t load.{" "}
                      <button type="button" onClick={onRetryTickets} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit", fontSize: "inherit", fontWeight: 700, color: "var(--accent-deep)", textDecoration: "underline" }}>
                        Try again
                      </button>
                    </>
                  ) : (
                    <>No tickets on the rail yet — tonight&rsquo;s dishes print here once the day&rsquo;s sales and invoices are in.</>
                  )}
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
          <div data-tour="db-waste" style={{ ...card, padding: "12px 14px", display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
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
              <span style={{ flexShrink: 0, fontFamily: MONO, fontSize: "10.5px", color: "var(--muted)" }}>
                {waste.length} at risk
              </span>
            </div>

            <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column" }}>
              {visibleWaste.map((w) => {
                const col = TONE[w.tone] || TONE.ok;
                return (
                  <div
                    key={w.name}
                    style={{
                      flex: "0 0 auto",
                      minHeight: "46px",
                      boxSizing: "border-box",
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

          <div data-tour="db-week" style={{ ...card, padding: "12px 14px", display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "16px",
                marginBottom: "10px",
                flexShrink: 0,
              }}
            >
              <div style={{ fontSize: "12.5px", fontWeight: 700, letterSpacing: "-0.02em" }}>Month in review</div>
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <button
                  type="button"
                  onClick={onPrevMonth}
                  aria-label="Previous month"
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
                  aria-label="Next month"
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

            <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 190px", gap: "16px", flex: 1, minHeight: "230px" }}>
              {/* calendar */}
              <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
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
                          border: (c.today ? "1.5px solid " : "1px solid ") + c.border,
                          background: c.bg,
                          cursor: c.clickable ? "pointer" : "default",
                        }}
                      >
                        <span style={{ fontSize: "13px", fontWeight: c.today ? 800 : 600, color: c.numColor, lineHeight: 1 }}>{c.day}</span>
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
                      const diffColor = dish.diff != null ? (dish.diff > 0 ? "var(--green)" : "var(--muted)") : "var(--muted)";
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

              {/* metrics, as one vertical list to the right of the calendar */}
              <div style={{ borderLeft: "1px solid var(--line)", paddingLeft: "16px", display: "flex", flexDirection: "column", minHeight: 0 }}>
                {[
                  ...week.stats.map((k) => ({
                    label: k.label,
                    value: k.value,
                    sub: k.sub,
                    color: k.tone === "green" ? "var(--green)" : k.tone === "red" ? "var(--red)" : k.tone === "muted" ? "var(--muted)" : "var(--accent-deep)",
                    size: "16px",
                  })),
                  { label: "Top performer", value: week.top.name, sub: "", color: "var(--text)", size: "14px" },
                ].map((k, i) => (
                  <div
                    key={k.label}
                    style={{
                      flex: "1 1 0",
                      minHeight: 0,
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "center",
                      gap: "3px",
                      borderTop: i ? "1px solid var(--line-soft)" : "none",
                    }}
                  >
                    <div style={{ fontFamily: MONO, fontSize: "9.5px", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--faint)", whiteSpace: "nowrap" }}>
                      {k.label}
                    </div>
                    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "8px", minWidth: 0 }}>
                      <span style={{ fontSize: k.size, fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1.15, fontVariantNumeric: "tabular-nums", color: k.color, minWidth: 0 }}>
                        {k.value}
                      </span>
                      {k.sub && (
                        <span style={{ fontFamily: MONO, fontSize: "9px", letterSpacing: "0.04em", color: "var(--faint)", whiteSpace: "nowrap" }}>{k.sub}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Phones use the same pinned header as the other client pages: logo,
  // search, and the account menu under the initials.
  const mobileHeader = (
    <MobileHeader theme={theme} onToggleTheme={toggleTheme} onSearch={onSearch} onSignOut={onSignOut} restaurantName={restaurantName} NavLink={Link} user={user} logoSrc={logoSrc} logoDarkSrc={logoDarkSrc} />
  );

  return (
    <>
      <style>{CSS}</style>
      <div
        className="om-dash"
        data-theme={theme}
        style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}
      >
        {isMobile ? mobileHeader : header}
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
              {t.why && (
                <div style={{ borderLeft: "2px solid var(--ink-faint)", padding: "1px 0 1px 8px", marginTop: "8px" }}>
                  <div style={{ fontSize: "8px", letterSpacing: "0.16em", color: "var(--ink-soft)" }}>WHY TONIGHT</div>
                  <div style={{ fontFamily: SANS, fontSize: "10px", lineHeight: 1.45, color: "var(--ink)", marginTop: "3px" }}>{t.why}</div>
                </div>
              )}
            </div>
            <div style={dashRule} />
            <div style={{ display: "flex", gap: "5px", flexWrap: "wrap" }}>
              {t.margin && <span style={pill}>{t.margin}</span>}
              {t.cover && <span style={pill}>{t.cover}</span>}
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
            <div style={{ fontSize: "9.5px", fontWeight: 500, letterSpacing: "0.08em", color: "var(--ink-soft)" }}>{t.riskNote}</div>
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

/* One scroll, ordered for a pre-service glance: OptiScore and its
   barometers, then tonight's tickets one at a time (Back / Next), then
   waste risk, then the month in review. */
function MobileView({ restaurantName, user, dateLabel, timeLabel, optiScore, buckets, scoreTone, stats, tickets, ticketsStatus, onRetryTickets, serviceNumber, waste, activeNav, Link, weekView, tourActive }) {
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [allWaste, setAllWaste] = useState(false);

  const n = tickets.length;
  const i = Math.min(idx, Math.max(0, n - 1));
  const go = (k) => { setIdx(Math.max(0, Math.min(n - 1, k))); setFlipped(false); };
  const atStart = i === 0;
  const atEnd = i === n - 1;

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const visibleWaste = allWaste ? waste : waste.slice(0, 4);

  const monoK = { fontFamily: MONO, fontSize: "10px", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--muted)" };
  const mcard = { background: "var(--shell)", border: "1px solid var(--line)", borderRadius: "14px", boxShadow: "0 1px 1px rgba(17,24,25,0.05), 0 3px 6px rgba(17,24,25,0.07)" };
  const stepBtn = { height: "44px", display: "flex", alignItems: "center", gap: "6px", borderRadius: "22px", fontFamily: SANS, fontSize: "13.5px", fontWeight: 700 };

  return (
    <div style={{ background: "var(--panel)", flex: 1, display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "14px 16px 28px", display: "flex", flexDirection: "column", gap: "18px" }}>

        {/* live line, greeting, OptiScore + barometers */}
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <div style={{ ...monoK, display: "flex", alignItems: "center", gap: "7px", minWidth: 0 }}>
            <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "var(--accent)", animation: "om-blink 2.4s infinite", flexShrink: 0 }} />
            <span style={{ color: "var(--accent-deep)", flexShrink: 0 }}>Live</span>
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>· {restaurantName} · {dateLabel} · {timeLabel}</span>
          </div>
          <div style={{ fontSize: "22px", fontWeight: 800, letterSpacing: "-0.035em", lineHeight: 1.2, marginBottom: "4px" }}>
            {greeting}, {user.firstName}.{" "}
            <span style={{ color: "var(--faint)", fontWeight: 700 }}>
              {n ? "Tonight\u2019s pass is set." : ticketsStatus === "loading" ? "Printing tonight\u2019s tickets\u2026" : "Tonight\u2019s pass is waiting."}
            </span>
          </div>

          <div data-tour="db-panel" style={{ ...mcard, padding: "14px", display: "flex", flexDirection: "column", gap: "13px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ ...monoK, letterSpacing: "0.14em" }}>OptiScore</span>
              <span style={{ fontSize: "10.5px", fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: scoreTone, background: `color-mix(in srgb, ${scoreTone} 14%, var(--shell))`, borderRadius: "20px", padding: "3px 10px" }}>
                {optiScore.label}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: "14px" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: "5px", flexShrink: 0 }}>
                <span style={{ fontSize: "42px", fontWeight: 800, letterSpacing: "-0.05em", lineHeight: 0.9 }}>{optiScore.value == null ? "—" : optiScore.value}</span>
                <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--muted)" }}>/ {optiScore.max || 100}</span>
              </div>
              <div style={{ flex: 1, paddingBottom: "4px" }}>
                {/* score bar; the tick marks 65, where "Good" starts */}
                <div style={{ position: "relative", height: "7px", borderRadius: "4px", background: "var(--line)" }}>
                  <div style={{ height: "7px", width: ((optiScore.value || 0) / (optiScore.max || 100)) * 100 + "%", borderRadius: "4px", background: "var(--accent)" }} />
                  <div style={{ position: "absolute", top: "-4px", left: "65%", width: "2px", height: "15px", background: "var(--text)" }} />
                </div>
                <div style={{ position: "relative", height: "12px", marginTop: "6px" }}>
                  <span style={{ position: "absolute", left: "65%", transform: "translateX(-50%)", fontFamily: MONO, fontSize: "9.5px", color: "var(--muted)", whiteSpace: "nowrap" }}>GOOD 65+</span>
                </div>
              </div>
            </div>

            {buckets.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: "10px", paddingTop: "12px", borderTop: "1px solid var(--line-soft)" }}>
                {buckets.map((b) => (
                  <div key={b.name} style={{ display: "grid", gridTemplateColumns: "74px minmax(0,1fr) 54px", alignItems: "center", gap: "10px" }}>
                    <span style={{ fontSize: "13px", fontWeight: 600 }}>{b.name}</span>
                    <span style={{ height: "5px", borderRadius: "3px", background: "var(--line-soft)", overflow: "hidden" }}>
                      <span style={{ display: "block", height: "100%", width: (b.max ? Math.min(100, (b.score / b.max) * 100) : 0) + "%", background: "var(--accent)" }} />
                    </span>
                    <span style={{ fontFamily: MONO, fontSize: "11px", textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", color: "var(--muted)" }}>
                      {b.max ? `${Math.round(b.score)}/${Math.round(b.max)}` : "day 31+"}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {stats.length > 0 && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: "8px" }}>
                {stats.map((s) => (
                  <div key={s.label} style={{ background: "var(--panel)", border: "1px solid var(--line-soft)", borderRadius: "10px", padding: "10px 12px", minWidth: 0 }}>
                    <div style={{ fontFamily: MONO, fontSize: "9.5px", letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.label}</div>
                    <div style={{ fontSize: "20px", fontWeight: 800, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums", marginTop: "3px", color: STAT_TONE[s.tone] || "var(--text)" }}>{s.value}</div>
                    {s.note && <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "1px" }}>{s.note}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* tonight's pass: one ticket at a time */}
        <div data-tour="db-grid-wrap" style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: "12px" }}>
            <div style={{ fontSize: "17px", fontWeight: 800, letterSpacing: "-0.03em" }}>Tonight&rsquo;s pass</div>
            <span style={monoK}>{n ? n + " dishes on the rail" : ticketsStatus === "loading" ? "Printing\u2026" : "Rail is empty"}</span>
          </div>
          <div style={{ height: "9px", borderRadius: "6px", background: "linear-gradient(to bottom,var(--rail-2),var(--rail))", position: "relative", zIndex: 2 }} />

          {n === 0 ? (
            <div style={{ marginTop: "14px", border: "1px dashed var(--line)", borderRadius: "10px", padding: "22px 18px", textAlign: "center", fontSize: "13px", lineHeight: 1.5, color: "var(--muted)" }}>
              {ticketsStatus === "loading" ? (
                <>Printing tonight&rsquo;s tickets&hellip; the first look each day can take up to a minute.</>
              ) : ticketsStatus === "error" ? (
                <>
                  Tonight&rsquo;s tickets didn&rsquo;t load.{" "}
                  <button type="button" onClick={onRetryTickets} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit", fontSize: "inherit", fontWeight: 700, color: "var(--accent-deep)", textDecoration: "underline" }}>Try again</button>
                </>
              ) : (
                <>No tickets on the rail yet — tonight&rsquo;s dishes print here once the day&rsquo;s sales and invoices are in.</>
              )}
            </div>
          ) : (
            <>
              <MobileTicket
                key={i}
                t={tickets[i]}
                i={i}
                flipped={flipped}
                onFlip={() => !tourActive && setFlipped((f) => !f)}
                restaurantName={restaurantName}
                serviceNumber={serviceNumber}
                timeLabel={timeLabel}
              />
              {n > 1 && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", gap: "10px", marginTop: "16px" }}>
                  <button type="button" onClick={() => go(i - 1)} disabled={atStart} aria-label="Previous ticket" style={{ ...stepBtn, justifySelf: "start", padding: "0 16px 0 12px", border: "1px solid var(--line)", background: "var(--shell)", color: "var(--text)", opacity: atStart ? 0.45 : 1, cursor: atStart ? "default" : "pointer" }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
                    Back
                  </button>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "6px" }}>
                    <div style={{ display: "flex", gap: "6px" }}>
                      {tickets.map((tk, k) => (
                        <button key={k} type="button" onClick={() => go(k)} aria-label={`Ticket ${k + 1}, ${tk.title}`} style={{ width: "24px", height: "24px", padding: 0, border: "none", background: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                          <span style={{ width: k === i ? "22px" : "8px", height: "8px", borderRadius: "4px", background: k === i ? tk.color : "var(--rail-2)", transition: "width .2s" }} />
                        </button>
                      ))}
                    </div>
                    <span style={{ fontFamily: MONO, fontSize: "10px", letterSpacing: "0.1em", color: "var(--muted)" }}>TICKET {i + 1} OF {n}</span>
                  </div>
                  <button type="button" onClick={() => go(i + 1)} disabled={atEnd} aria-label="Next ticket" style={{ ...stepBtn, justifySelf: "end", padding: "0 12px 0 16px", border: "none", background: atEnd ? "var(--accent-tint)" : "var(--accent)", color: atEnd ? "var(--accent-deep)" : "#fff", cursor: atEnd ? "default" : "pointer" }}>
                    Next
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* waste risk */}
        <div data-tour="db-waste" style={{ ...mcard, padding: "14px 14px 12px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", marginBottom: "4px" }}>
            <div>
              <div style={{ fontSize: "15px", fontWeight: 800, letterSpacing: "-0.02em" }}>Waste risk</div>
              <div style={{ fontSize: "12px", color: "var(--muted)", marginTop: "2px" }}>Use these first, or they go in the bin</div>
            </div>
            {waste.length > 4 && (
              <button type="button" onClick={() => setAllWaste((v) => !v)} style={{ flexShrink: 0, minHeight: "36px", background: "none", border: "1px solid var(--line)", borderRadius: "20px", padding: "0 13px", fontFamily: SANS, fontSize: "12px", fontWeight: 600, color: "var(--muted)", cursor: "pointer" }}>
                {allWaste ? "Show fewer" : "See all " + waste.length}
              </button>
            )}
          </div>
          {waste.length === 0 && (
            <div style={{ fontSize: "13px", color: "var(--muted)", padding: "14px 0 6px", borderTop: "1px solid var(--line-soft)" }}>Nothing at risk right now.</div>
          )}
          {visibleWaste.map((w) => {
            const col = TONE[w.tone] || TONE.ok;
            return (
              <div key={w.name} style={{ padding: "11px 0 10px", borderTop: "1px solid var(--line-soft)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "9px" }}>
                  <span style={{ width: "7px", height: "7px", borderRadius: "50%", flexShrink: 0, background: col }} />
                  <span style={{ flex: 1, minWidth: 0, fontSize: "14px", fontWeight: 600, textTransform: "capitalize", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{w.name}</span>
                  {w.qty && <span style={{ fontFamily: MONO, fontSize: "10.5px", color: "var(--muted)", whiteSpace: "nowrap" }}>{w.qty}</span>}
                  <span style={{ fontSize: "12.5px", fontWeight: 700, whiteSpace: "nowrap", color: col, minWidth: "74px", textAlign: "right" }}>{w.left}</span>
                </div>
                <div style={{ height: "3px", borderRadius: "2px", background: "var(--line)", margin: "7px 0 0 16px", overflow: "hidden" }}>
                  <div style={{ height: "3px", borderRadius: "2px", background: col, width: w.pct + "%" }} />
                </div>
              </div>
            );
          })}
          {waste.length > 0 && (
            <div style={{ display: "flex", gap: "14px", paddingTop: "10px", borderTop: "1px solid var(--line-soft)", fontFamily: MONO, fontSize: "9.5px", letterSpacing: "0.06em", color: "var(--muted)" }}>
              <span style={{ display: "flex", alignItems: "center", gap: "5px" }}><span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "var(--red)" }} />TODAY</span>
              <span style={{ display: "flex", alignItems: "center", gap: "5px" }}><span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "var(--amber)" }} />2 DAYS</span>
              <span style={{ display: "flex", alignItems: "center", gap: "5px" }}><span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "var(--accent)" }} />3–7 DAYS</span>
            </div>
          )}
        </div>

        {/* month in review (built in the parent so it shares the desktop calendar state) */}
        <div data-tour="db-week">{weekView}</div>
      </div>

      <MobileNav active={activeNav} NavLink={Link} />
    </div>
  );
}

/* One phone ticket: front is the pitch, tap flips to the recipe. */
function MobileTicket({ t, i, flipped, onFlip, restaurantName, serviceNumber, timeLabel }) {
  const num = t.num || "#124-0" + (i + 1);
  const why = t.why || t.reason;
  const face = { width: "100%", height: "350px", display: "flex", flexDirection: "column", textAlign: "left", border: "none", cursor: "pointer", background: "var(--paper)", color: "var(--ink)", fontFamily: MONO, borderRadius: "4px", padding: "12px 14px", boxShadow: "0 14px 30px rgba(17,24,25,0.14)" };
  const rule = { display: "block", width: "100%", borderTop: "1px dashed var(--paper-line)" };
  const tag = { fontSize: "8.5px", fontWeight: 500, letterSpacing: "0.06em", border: "1px solid var(--ink-faint)", borderRadius: "3px", padding: "2px 6px", color: "var(--ink-soft)" };

  return (
    <div style={{ position: "relative", padding: "9px 14px 0" }}>
      <div style={{ position: "absolute", top: "-7px", left: "50%", transform: "translateX(-50%)", width: "46px", height: "16px", borderRadius: "4px 4px 3px 3px", background: "linear-gradient(to bottom,var(--rail-2),var(--rail))", zIndex: 3 }} />
      <div style={{ transform: `rotate(${TILT[i % TILT.length]})`, transformOrigin: "top center", animation: "om-print .4s cubic-bezier(.25,.8,.35,1) both" }}>
        {!flipped ? (
          <button type="button" onClick={onFlip} aria-label="Show recipe" style={face}>
            <span style={{ display: "block", width: "100%", textAlign: "center" }}>
              <span style={{ display: "block", fontSize: "10px", fontWeight: 500, letterSpacing: "0.06em" }}>{restaurantName}</span>
              <span style={{ display: "block", fontSize: "8px", letterSpacing: "0.16em", color: "var(--ink-faint)", marginTop: "2px" }}>TONIGHT · SERVICE {serviceNumber}</span>
            </span>
            <span style={{ display: "flex", width: "100%", justifyContent: "space-between", fontSize: "9px", letterSpacing: "0.08em", color: "var(--ink-soft)", marginTop: "7px" }}>
              <span>{num}</span><span>{timeLabel}</span>
            </span>
            <span style={{ ...rule, margin: "8px 0" }} />
            <span style={{ display: "block", fontSize: "9.5px", fontWeight: 500, letterSpacing: "0.16em", color: t.color }}>{t.label}</span>
            <span style={{ display: "block", fontFamily: SANS, fontSize: "18px", fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1.12, marginTop: "4px" }}>{t.title}</span>
            <span style={{ ...rule, margin: "10px 0 8px" }} />
            <span style={{ display: "block", width: "100%", fontSize: "8px", letterSpacing: "0.16em", color: "var(--ink-faint)", textAlign: "center" }}>TONIGHT&rsquo;S PITCH</span>
            <span style={{ display: "block", flex: 1, minHeight: 0, overflow: "hidden", marginTop: "7px" }}>
              <span style={{ display: "block", fontFamily: SANS, fontSize: "13px", fontStyle: "italic", lineHeight: 1.45 }}>{t.pitch}</span>
              {why && (
                <span style={{ display: "block", borderLeft: "2px solid var(--ink-faint)", padding: "1px 0 1px 9px", marginTop: "10px" }}>
                  <span style={{ display: "block", fontSize: "8px", letterSpacing: "0.16em", color: "var(--ink-soft)" }}>WHY TONIGHT</span>
                  <span style={{ display: "block", fontFamily: SANS, fontSize: "11.5px", lineHeight: 1.45, marginTop: "3px" }}>{why}</span>
                </span>
              )}
            </span>
            <span style={{ ...rule, margin: "8px 0" }} />
            <span style={{ display: "flex", gap: "5px", flexWrap: "wrap" }}>
              {t.margin && <span style={tag}>{t.margin}</span>}
              {t.cover && <span style={tag}>{t.cover}</span>}
              {t.urgency && <span style={{ ...tag, color: t.color, border: "1px solid " + t.color }}>{t.urgency}</span>}
            </span>
            <span style={{ display: "block", width: "100%", textAlign: "center", fontSize: "8px", letterSpacing: "0.14em", color: "var(--ink-faint)", marginTop: "8px" }}>· · · TAP FOR RECIPE · · ·</span>
          </button>
        ) : (
          <button type="button" onClick={onFlip} aria-label="Back to the pitch" style={face}>
            <span style={{ display: "flex", width: "100%", justifyContent: "space-between", fontSize: "9px", letterSpacing: "0.12em", color: "var(--ink-soft)" }}>
              <span>RECIPE · {num}</span><span>↻ FLIP</span>
            </span>
            <span style={{ ...rule, margin: "9px 0" }} />
            <span style={{ display: "block", fontFamily: SANS, fontSize: "17px", fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1.12 }}>{t.title}</span>
            <span style={{ ...rule, margin: "10px 0" }} />
            <span style={{ display: "block", width: "100%", flex: 1, minHeight: 0, overflowY: "auto" }}>
              {(t.recipe || []).map((c) => (
                <span key={c.name} style={{ display: "block", marginBottom: "11px" }}>
                  <span style={{ display: "block", fontSize: "8.5px", fontWeight: 500, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--ink-soft)", marginBottom: "2px" }}>{c.name}</span>
                  {(c.ings || []).map((g) => {
                    const col = g.risk ? "var(--red)" : "var(--ink-soft)";
                    return (
                      <span key={g.name} style={{ display: "flex", alignItems: "baseline", gap: "7px", fontSize: "10.5px", lineHeight: 1.65, color: col }}>
                        <span style={{ whiteSpace: "nowrap" }}>{g.name}</span>
                        <span style={{ flex: 1, borderBottom: "1px dotted var(--ink-faint)", transform: "translateY(-3px)" }} />
                        <span style={{ whiteSpace: "nowrap" }}>{g.qty}</span>
                      </span>
                    );
                  })}
                </span>
              ))}
            </span>
            <span style={{ ...rule, margin: "8px 0" }} />
            {t.riskNote && <span style={{ display: "block", fontSize: "9px", fontWeight: 500, letterSpacing: "0.06em", color: "var(--red)" }}>{t.riskNote}</span>}
            <span style={{ display: "block", width: "100%", textAlign: "center", fontSize: "8px", letterSpacing: "0.14em", color: "var(--ink-faint)", marginTop: "8px" }}>· · · TAP TO FLIP BACK · · ·</span>
          </button>
        )}
      </div>
    </div>
  );
}

export { DEMO_TICKETS, DEMO_WASTE, DEMO_STATS, DEMO_WEEK };