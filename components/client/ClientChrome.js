import React, { useCallback, useEffect, useState } from "react";

/**
 * ClientChrome — shared shell for the ported client screens
 * (invoices, ingredients, menu items, analytics).
 *
 * Everything the four screens have in common lives here: the token block,
 * the header bar with nav, the theme toggle, loading / empty states and the
 * mobile breakpoint hook. Same conventions as the rest of the repo: inline
 * style objects, one <style> block, no new dependencies.
 *
 * The dashboard port (components/dashboard/PassDashboard.js) carries its own
 * copy of these tokens so it can stay a single self-contained file — if you
 * refactor it later, it can import from here instead.
 */

export const MONO = "'IBM Plex Mono',ui-monospace,SFMono-Regular,Menlo,monospace";
export const SANS = "'Manrope',system-ui,-apple-system,sans-serif";

export const CSS = `
.om-app *,.om-app *::before,.om-app *::after{box-sizing:border-box;margin:0;padding:0}
.om-app{
  --ground:#e6e4e0;--shell:#ffffff;--panel:#eef0ef;--line:#d8dfe0;--line-soft:#eef1f2;
  --text:#111819;--muted:#4b585b;--faint:#78868a;
  --accent:#02a4ba;--accent-deep:#03808f;--accent-tint:#e8f7f9;
  --green:#3f9c56;--amber:#c1871c;--red:#c4473e;
  --shadow:0 18px 40px rgba(17,24,25,0.10);--shadow-lg:0 22px 60px rgba(17,24,25,0.12);
  --card-lift:0 1px 1px rgba(17,24,25,0.05),0 3px 6px rgba(17,24,25,0.07),0 10px 22px rgba(17,24,25,0.10);
  --paper:#f7f7f5;--paper-line:#e0e2e0;--ink:#141a1b;--ink-soft:#5a6669;--ink-faint:#98a1a1;
  background:var(--shell);color:var(--text);
  font-family:'Manrope',system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased;
}
.om-app[data-theme="dark"]{
  --ground:#0c1113;--shell:#141c1f;--panel:#0f1618;--line:#354549;--line-soft:#222c30;
  --text:#e9f0f0;--muted:#adbcbe;--faint:#8b9a9d;
  --accent:#26c2d6;--accent-deep:#63d5e2;--accent-tint:#0d2b31;
  --green:#5cc077;--amber:#dda23c;--red:#e0685d;
  --shadow:0 18px 40px rgba(0,0,0,0.45);--shadow-lg:0 24px 60px rgba(0,0,0,0.55);
  --card-lift:0 1px 1px rgba(0,0,0,0.35),0 3px 8px rgba(0,0,0,0.4),0 12px 26px rgba(0,0,0,0.45);
  --paper:#1b2427;--paper-line:#33403f;--ink:#e6eeee;--ink-soft:#9fadad;--ink-faint:#6e7d7e;
}
.om-app a{color:var(--accent-deep);text-decoration:none}
.om-app a:hover{color:var(--accent)}
.om-app button:focus-visible,.om-app a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.om-hover-accent:hover{border-color:var(--accent) !important;color:var(--accent-deep) !important}
.om-nav-link:hover{color:var(--text) !important}
.om-row:hover{background:var(--panel) !important}
.om-logo-dark{display:none}
.om-app[data-theme="dark"] .om-logo-light{display:none}
.om-app[data-theme="dark"] .om-logo-dark{display:block}
@keyframes om-spin{to{transform:rotate(360deg)}}
@keyframes om-blink{0%,100%{opacity:1}50%{opacity:.25}}
@keyframes om-print{from{opacity:0;transform:translateY(-14px)}to{opacity:1;transform:translateY(0)}}
.om-app ::-webkit-scrollbar{width:4px;height:4px}
.om-app ::-webkit-scrollbar-thumb{background:var(--line);border-radius:3px}
.om-app ::-webkit-scrollbar-track{background:transparent}
.om-scroll-x{overflow-x:auto;scrollbar-width:none}
.om-scroll-x::-webkit-scrollbar{display:none}
`;

export const NAV = [
  { key: "dashboard", label: "Dashboard", href: "/client/dashboard" },
  { key: "invoices", label: "Invoices", href: "/client/invoices" },
  { key: "ingredients", label: "Ingredients", href: "/client/ingredients" },
  { key: "menu-items", label: "Menu items", href: "/client/menu-items" },
  { key: "analytics", label: "Analytics", href: "/client/analytics" },
];

/** Uncontrolled unless `theme` is passed. */
export function useTheme(theme, defaultTheme = "light", onThemeChange) {
  const [internal, setInternal] = useState(defaultTheme);
  const value = theme || internal;
  const toggle = useCallback(() => {
    const next = value === "dark" ? "light" : "dark";
    if (!theme) setInternal(next);
    if (onThemeChange) onThemeChange(next);
  }, [value, theme, onThemeChange]);
  return [value, toggle];
}

export function useIsMobile(breakpoint = 900) {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width:${breakpoint}px)`);
    const on = () => setMobile(mq.matches);
    on();
    mq.addEventListener ? mq.addEventListener("change", on) : mq.addListener(on);
    return () => (mq.removeEventListener ? mq.removeEventListener("change", on) : mq.removeListener(on));
  }, [breakpoint]);
  return mobile;
}

export const PAGE_PAD = "max(20px, calc((100vw - 1460px) / 2))";

export function Shell({ theme, children, style }) {
  return (
    <div className="om-app" data-theme={theme} style={{ minHeight: "100vh", maxWidth: "100vw", display: "flex", flexDirection: "column", ...style }}>
      <style>{CSS}</style>
      {children}
    </div>
  );
}

function A({ NavLink, href, style, className, children }) {
  if (NavLink) return <NavLink href={href} style={style} className={className}>{children}</NavLink>;
  return <a href={href} style={style} className={className}>{children}</a>;
}

export function Header({
  active,
  NavLink,
  user = { initials: "MR", firstName: "Marco" },
  restaurantName = "",
  theme,
  onToggleTheme,
  onSearch,
  onSignOut,
  logoSrc = "/landing/logo.png",
  logoDarkSrc = "/landing/logo-knockout.png",
}) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dark = theme === "dark";

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, padding: `9px ${PAGE_PAD}`, borderBottom: "1px solid var(--line)", flexWrap: "wrap", flexShrink: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 20, minWidth: 0, flexShrink: 1 }}>
        <img className="om-logo-light" src={logoSrc} alt="optiMenu Solutions" style={{ display: "block", height: 22, width: "auto", flexShrink: 0 }} />
        <img className="om-logo-dark" src={logoDarkSrc} alt="optiMenu Solutions" style={{ height: 22, width: "auto", flexShrink: 0 }} />
        <div style={{ display: "flex", alignItems: "center", gap: 2, minWidth: 0, overflow: "hidden" }}>
          {NAV.map((n) =>
            n.key === active ? (
              <span key={n.key} style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text)", background: "var(--accent-tint)", borderRadius: 16, padding: "5px 11px", whiteSpace: "nowrap" }}>{n.label}</span>
            ) : (
              <A key={n.key} NavLink={NavLink} href={n.href} className="om-nav-link" style={{ fontSize: 12.5, fontWeight: 500, color: "var(--muted)", padding: "5px 9px", whiteSpace: "nowrap" }}>{n.label}</A>
            )
          )}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: MONO, fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--accent-deep)", whiteSpace: "nowrap" }}>
          <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--accent)", animation: "om-blink 2.4s infinite" }} />
          Live
        </div>
        <button type="button" title="Search" onClick={onSearch} className="om-hover-accent" style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, border: "1px solid var(--line)", borderRadius: "50%", background: "none", cursor: "pointer", flexShrink: 0 }}>
          <SearchIcon />
        </button>
        <div style={{ position: "relative", paddingLeft: 6, borderLeft: "1px solid var(--line)" }}>
          <div
            onClick={() => setDropdownOpen((v) => !v)}
            style={{ display: "flex", alignItems: "center", gap: 9, cursor: "pointer", padding: 3, borderRadius: 20, border: `1.5px solid ${dropdownOpen ? "var(--accent)" : "transparent"}` }}
          >
            <div style={{ width: 26, height: 26, borderRadius: "50%", background: "var(--accent)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>{user.initials}</div>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text)" }}>{user.firstName}</span>
          </div>
          {dropdownOpen && (
            <>
              <div onClick={() => setDropdownOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 199, background: "transparent" }} />
              <div style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, background: "var(--shell)", border: "1px solid var(--line)", borderRadius: 10, width: 230, overflow: "hidden", boxShadow: "var(--shadow-lg)", zIndex: 200 }}>
                <div style={{ padding: "13px 15px", borderBottom: "1px solid var(--line-soft)" }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--text)" }}>{user.firstName}</div>
                  <div style={{ fontSize: 11.5, color: "var(--faint)", marginTop: 2 }}>{restaurantName}</div>
                </div>
                <div style={{ padding: 6 }}>
                  <A NavLink={NavLink} href="/client/profile" style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", borderRadius: 7, color: "var(--text)", fontSize: 13, fontWeight: 500 }}>
                    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="var(--faint)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
                    Profile &amp; settings
                  </A>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", borderRadius: 7 }}>
                    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="var(--faint)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>
                    <span style={{ fontSize: 13, color: "var(--text)", fontWeight: 500, flex: 1 }}>{dark ? "Light mode" : "Dark mode"}</span>
                    <button
                      type="button"
                      onClick={onToggleTheme}
                      style={{ width: 34, height: 19, borderRadius: 10, border: "1px solid var(--line)", position: "relative", cursor: "pointer", flexShrink: 0, background: dark ? "var(--accent)" : "var(--line)" }}
                    >
                      <div style={{ position: "absolute", top: 1, left: dark ? 17 : 1, width: 15, height: 15, borderRadius: "50%", background: "#fff", transition: "left .2s" }} />
                    </button>
                  </div>
                  <A NavLink={NavLink} href="/client/profile?tab=support" style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", borderRadius: 7, color: "var(--text)", fontSize: 13, fontWeight: 500 }}>
                    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="var(--faint)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
                    Support &amp; feedback
                  </A>
                  <div style={{ height: 1, background: "var(--line-soft)", margin: "4px 0" }} />
                  <div onClick={onSignOut} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", borderRadius: 7, color: "var(--red)", fontSize: 13, fontWeight: 500, cursor: "pointer" }}>
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
}

export function MobileHeader({ theme, onToggleTheme, user = { initials: "MR" }, logoSrc = "/landing/logo.png", logoDarkSrc = "/landing/logo-knockout.png" }) {
  return (
    <div style={{ padding: 16, borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <span style={{ display: "flex", alignItems: "center" }}>
        <img className="om-logo-light" src={logoSrc} alt="optiMenu" style={{ display: "block", height: 22, width: "auto" }} />
        <img className="om-logo-dark" src={logoDarkSrc} alt="optiMenu" style={{ height: 22, width: "auto" }} />
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button type="button" onClick={onToggleTheme} style={{ background: "none", border: "1px solid var(--line)", borderRadius: 20, padding: "6px 11px", fontFamily: MONO, fontSize: 10, letterSpacing: "0.06em", color: "var(--muted)", cursor: "pointer" }}>{theme === "dark" ? "LIGHT" : "DARK"}</button>
        <div style={{ width: 28, height: 28, borderRadius: "50%", background: "var(--accent)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11.5, fontWeight: 700 }}>{user.initials}</div>
      </div>
    </div>
  );
}

export function MobileNav({ active, NavLink }) {
  return (
    <div style={{ display: "flex", borderTop: "1px solid var(--line)", background: "var(--shell)", position: "sticky", bottom: 0 }}>
      {NAV.map((n) => {
        const color = n.key === active ? "var(--accent)" : "var(--faint)";
        return (
          <A key={n.key} NavLink={NavLink} href={n.href} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: "11px 0 16px", color }}>
            <span style={{ width: 16, height: 16, borderRadius: 4, border: `1.5px solid ${color}` }} />
            <span style={{ fontSize: 9.5, fontWeight: 600, color }}>{n.key === "menu-items" ? "Menu" : n.label}</span>
          </A>
        );
      })}
    </div>
  );
}

export function LoadingState({ label = "Loading…" }) {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, background: "var(--panel)", padding: 40 }}>
      <div style={{ width: 26, height: 26, border: "2px solid var(--line)", borderTopColor: "var(--accent)", borderRadius: "50%", animation: "om-spin .8s linear infinite" }} />
      <div style={{ fontFamily: MONO, fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--faint)" }}>{label}</div>
    </div>
  );
}

export function EmptyState({ kicker, title, body, children }) {
  return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--panel)", padding: 40 }}>
      <div style={{ maxWidth: 520, textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
        {kicker && <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--faint)" }}>{kicker}</div>}
        <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1.15 }}>{title}</div>
        {body && <div style={{ fontSize: 14, lineHeight: 1.55, color: "var(--muted)", textWrap: "pretty" }}>{body}</div>}
        {children}
      </div>
    </div>
  );
}

export function ErrorState({ message, onRetry }) {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, background: "var(--panel)", padding: 40, textAlign: "center" }}>
      <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--red)" }}>Something went wrong</div>
      <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.02em", maxWidth: 460 }}>{message}</div>
      {onRetry && (
        <button type="button" onClick={onRetry} style={{ background: "var(--accent)", color: "#fff", border: "none", borderRadius: 22, padding: "10px 22px", fontFamily: SANS, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Try again</button>
      )}
    </div>
  );
}

export function SearchIcon({ size = 15, color = "var(--faint)" }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round">
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.6-3.6" />
    </svg>
  );
}

/** Fonts. Screens render this inside next/head. */
export const FONT_LINKS = (
  <>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
    <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet" />
  </>
);

export const money = (n, dp = 2) =>
  "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
export const money0 = (n) => "$" + Math.round(Number(n) || 0).toLocaleString("en-US");