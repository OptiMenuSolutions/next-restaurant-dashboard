import { useState } from "react";

/**
 * AccountChrome — shared header/nav/notification/profile-dropdown for the
 * settings-style screens (Profile, Billing). Same cream/teal shell as
 * PassDashboard and ClientChrome, condensed to a single top bar (no
 * mobile bottom nav — these are secondary screens).
 *
 * Conventions: inline style objects + one <style> block (tokens, keyframes),
 * ported 1:1 from OptiMenu Profile.dc.html / OptiMenu Billing.dc.html.
 */

export const CSS = `
.om-acct *,.om-acct *::before,.om-acct *::after{box-sizing:border-box;margin:0;padding:0}
.om-acct{
  --ground:#e6e4e0;--shell:#ffffff;--panel:#eef0ef;--line:#d8dfe0;--line-soft:#eef1f2;
  --text:#111819;--muted:#4b585b;--faint:#78868a;
  --accent:#02a4ba;--accent-deep:#03808f;--accent-tint:#e8f7f9;
  --green:#3f9c56;--amber:#c1871c;--red:#c4473e;--red-tint:#faeae8;
  --shadow:0 18px 40px rgba(17,24,25,0.10);--shadow-lg:0 22px 60px rgba(17,24,25,0.12);
  --card-lift:0 1px 1px rgba(17,24,25,0.05),0 3px 6px rgba(17,24,25,0.07),0 10px 22px rgba(17,24,25,0.10);
  background:var(--shell);color:var(--text);font-family:'Manrope',system-ui,sans-serif;-webkit-font-smoothing:antialiased;
}
.om-acct[data-theme="dark"]{
  --ground:#0c1113;--shell:#141c1f;--panel:#0f1618;--line:#354549;--line-soft:#222c30;
  --text:#e9f0f0;--muted:#adbcbe;--faint:#8b9a9d;
  --accent:#26c2d6;--accent-deep:#63d5e2;--accent-tint:#0d2b31;
  --green:#5cc077;--amber:#dda23c;--red:#e0685d;--red-tint:#2a1917;
  --shadow:0 18px 40px rgba(0,0,0,0.45);--shadow-lg:0 24px 60px rgba(0,0,0,0.55);
  --card-lift:0 1px 1px rgba(0,0,0,0.35),0 3px 8px rgba(0,0,0,0.4),0 12px 26px rgba(0,0,0,0.45);
}
.om-acct a{color:var(--accent-deep);text-decoration:none}
.om-acct a:hover{color:var(--accent)}
.om-acct .om-logo-dark{display:none}
.om-acct[data-theme="dark"] .om-logo-light{display:none}
.om-acct[data-theme="dark"] .om-logo-dark{display:block}
.om-acct .pf-input::placeholder{color:var(--faint)}
@keyframes om-blink{0%,100%{opacity:1}50%{opacity:.25}}
.om-acct ::-webkit-scrollbar{width:4px;height:4px}
.om-acct ::-webkit-scrollbar-thumb{background:var(--line);border-radius:3px}
.om-acct ::-webkit-scrollbar-track{background:transparent}
`;

export const FONT_LINKS = (
  <>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
    <link
      href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500&display=swap"
      rel="stylesheet"
    />
  </>
);

export const DEMO_NOTIFS = [
  { id: 1, title: "Ingredient price alert", body: "Parmigiano Reggiano is up 14% this week.", time: "2h ago", color: "var(--red)", unread: true },
  { id: 2, title: "Weekly cost summary ready", body: "This week's summary is ready to review.", time: "1d ago", color: "var(--accent)", unread: true },
  { id: 3, title: "Low margin alert", body: "A menu item dropped below your target food cost.", time: "2d ago", color: "var(--amber)", unread: false },
  { id: 4, title: "Invoice processed", body: "Your latest invoice was matched to ingredients.", time: "3d ago", color: "var(--green)", unread: false },
];

const NAV = [
  { key: "dashboard", label: "Dashboard", href: "/client/dashboard" },
  { key: "invoices", label: "Invoices", href: "/client/invoices" },
  { key: "ingredients", label: "Ingredients", href: "/client/ingredients" },
  { key: "menu-items", label: "Menu items", href: "/client/menu-items" },
  { key: "analytics", label: "Analytics", href: "/client/analytics" },
];

/**
 * useAccountChrome — theme + dropdown/notification state shared by Profile
 * and Billing. Returns the header element to render plus the current theme.
 *
 * Props: theme/onThemeChange (controlled, else internal), user {name,email},
 * notifItems (defaults to DEMO_NOTIFS), NavLink (defaults to <a>), onSignOut.
 */
export function useAccountChrome({
  theme: themeProp,
  onThemeChange,
  user = { name: "Marco Rossi", email: "marco@lunaosteria.com" },
  notifItems = DEMO_NOTIFS,
  NavLink = DefaultLink,
  logoSrc = "/landing/logo.png",
  logoDarkSrc = "/landing/logo-knockout.png",
  onSignOut,
}) {
  const [themeState, setThemeState] = useState("light");
  const theme = themeProp ?? themeState;
  const setTheme = (t) => (onThemeChange ? onThemeChange(t) : setThemeState(t));

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifs, setNotifs] = useState(notifItems);

  const initials = (user.name || "U").split(" ").map((p) => p.charAt(0)).join("").substring(0, 2).toUpperCase();
  const firstName = (user.name || "").split(" ")[0] || user.name;
  const hasUnread = notifs.some((n) => n.unread);

  const header = (
    <div
      style={{
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14,
        padding: "9px max(20px, calc((100vw - 1460px) / 2))", borderBottom: "1px solid var(--line)", flexWrap: "wrap",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 20, minWidth: 0, flexShrink: 1 }}>
        <img className="om-logo-light" src={logoSrc} alt="optiMenu Solutions" style={{ display: "block", height: 22, width: "auto", flexShrink: 0 }} />
        <img className="om-logo-dark" src={logoDarkSrc} alt="optiMenu Solutions" style={{ height: 22, width: "auto", flexShrink: 0 }} />
        <div style={{ display: "flex", alignItems: "center", gap: 2, minWidth: 0, overflow: "hidden" }}>
          {NAV.map((n) => (
            <NavLink key={n.key} href={n.href} style={{ fontSize: 12.5, fontWeight: 500, color: "var(--muted)", padding: "5px 9px", whiteSpace: "nowrap" }}>
              {n.label}
            </NavLink>
          ))}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--accent-deep)", whiteSpace: "nowrap" }}>
          <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--accent)", animation: "om-blink 2.4s infinite" }} />Live
        </div>

        <div style={{ position: "relative" }}>
          <button
            type="button"
            onClick={() => { setNotifOpen((v) => !v); setDropdownOpen(false); }}
            title="Notifications"
            style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, border: "1px solid var(--line)", borderRadius: "50%", background: "none", cursor: "pointer", flexShrink: 0 }}
          >
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="var(--faint)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 01-3.46 0" />
            </svg>
            {hasUnread && <span style={{ position: "absolute", top: 4, right: 5, width: 7, height: 7, borderRadius: "50%", background: "var(--red)", border: "1.5px solid var(--shell)" }} />}
          </button>
          {notifOpen && (
            <>
              <div onClick={() => setNotifOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 199, background: "transparent" }} />
              <div style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, background: "var(--shell)", border: "1px solid var(--line)", borderRadius: 10, width: 320, overflow: "hidden", boxShadow: "var(--shadow-lg)", zIndex: 200 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 15px", borderBottom: "1px solid var(--line-soft)" }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700 }}>Notifications</div>
                  <button type="button" onClick={() => setNotifs((ns) => ns.map((n) => ({ ...n, unread: false })))} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 11.5, fontWeight: 600, color: "var(--accent-deep)", padding: 0 }}>
                    Mark all read
                  </button>
                </div>
                <div style={{ maxHeight: 360, overflowY: "auto" }}>
                  {notifs.map((n) => (
                    <div key={n.id} style={{ display: "flex", gap: 11, padding: "12px 15px", borderBottom: "1px solid var(--line-soft)", background: n.unread ? "var(--accent-tint)" : "transparent" }}>
                      <div style={{ width: 4, borderRadius: 3, background: n.color, flexShrink: 0 }} />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{n.title}</div>
                          {n.unread && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent)", flexShrink: 0 }} />}
                        </div>
                        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3, lineHeight: 1.4 }}>{n.body}</div>
                        <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, color: "var(--faint)", marginTop: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>{n.time}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        <div style={{ position: "relative", paddingLeft: 6, borderLeft: "1px solid var(--line)" }}>
          <div
            onClick={() => { setDropdownOpen((v) => !v); setNotifOpen(false); }}
            style={{ display: "flex", alignItems: "center", gap: 9, cursor: "pointer", padding: 3, borderRadius: 20, border: `1.5px solid ${dropdownOpen ? "var(--accent)" : "transparent"}` }}
          >
            <div style={{ width: 26, height: 26, borderRadius: "50%", background: "var(--accent)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>{initials}</div>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text)" }}>{firstName}</span>
          </div>
          {dropdownOpen && (
            <>
              <div onClick={() => setDropdownOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 199, background: "transparent" }} />
              <div style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, background: "var(--shell)", border: "1px solid var(--line)", borderRadius: 10, width: 230, overflow: "hidden", boxShadow: "var(--shadow-lg)", zIndex: 200 }}>
                <div style={{ padding: "13px 15px", borderBottom: "1px solid var(--line-soft)" }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700 }}>{user.name}</div>
                  <div style={{ fontSize: 11.5, color: "var(--faint)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user.email}</div>
                </div>
                <div style={{ padding: 6 }}>
                  <NavLink href="/client/profile" style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", borderRadius: 7, color: "var(--text)", fontSize: 13, fontWeight: 500 }}>
                    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="var(--faint)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
                    Profile &amp; settings
                  </NavLink>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", borderRadius: 7 }}>
                    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="var(--faint)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>
                    <span style={{ fontSize: 13, color: "var(--text)", fontWeight: 500, flex: 1 }}>{theme === "dark" ? "Light mode" : "Dark mode"}</span>
                    <button
                      type="button"
                      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                      style={{ width: 34, height: 19, borderRadius: 10, border: "1px solid var(--line)", position: "relative", cursor: "pointer", flexShrink: 0, background: theme === "dark" ? "var(--accent)" : "var(--line)" }}
                    >
                      <div style={{ position: "absolute", top: 1, left: theme === "dark" ? 17 : 1, width: 15, height: 15, borderRadius: "50%", background: "#fff", transition: "left .2s" }} />
                    </button>
                  </div>
                  <NavLink href="/client/profile?tab=support" style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", borderRadius: 7, color: "var(--text)", fontSize: 13, fontWeight: 500 }}>
                    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="var(--faint)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
                    Support &amp; feedback
                  </NavLink>
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

  return { header, theme };
}

function DefaultLink({ href, children, style }) {
  return <a href={href} style={style}>{children}</a>;
}
