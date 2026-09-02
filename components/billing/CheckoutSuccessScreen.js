/**
 * CheckoutSuccessScreen — ported from OptiMenu Checkout Success.dc.html.
 * Shown right after a NEW subscription's initial payment (distinct from
 * CheckoutScreen, which only updates the card on an existing subscription).
 *
 * Props: restaurantName, amount, last4, NavLink
 */
export default function CheckoutSuccessScreen({
  restaurantName = "",
  amount = "$59.00",
  last4 = "4242",
  NavLink = DefaultLink,
}) {
  const vars = {
    "--panel": "#eef0ef", "--shell": "#ffffff", "--line": "#d8dfe0", "--line-soft": "#eef1f2",
    "--text": "#111819", "--muted": "#4b585b", "--faint": "#78868a",
    "--accent": "#02a4ba", "--accent-deep": "#03808f", "--accent-tint": "#e8f7f9",
    "--shadow-lg": "0 22px 60px rgba(17,24,25,0.12)",
  };
  const row = { display: "flex", alignItems: "baseline", justifyContent: "space-between", padding: "13px 16px", borderBottom: "1px solid var(--line-soft)" };

  return (
    <div style={{ ...vars, minHeight: "100vh", display: "flex", flexDirection: "column", background: "var(--panel)", color: "var(--text)", fontFamily: "'Manrope',system-ui,sans-serif" }}>
      <div style={{ padding: "26px 34px" }}>
        <img src="/landing/logo.png" alt="optiMenu Solutions" style={{ display: "block", height: 22, width: "auto" }} />
      </div>

      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "20px 24px 70px" }}>
        <div style={{ width: "100%", maxWidth: 460 }}>
          <div style={{ background: "var(--shell)", border: "1px solid var(--line)", borderRadius: 14, boxShadow: "var(--shadow-lg)", padding: "40px 36px", textAlign: "center" }}>
            <div style={{ width: 52, height: 52, borderRadius: "50%", background: "var(--accent-tint)", color: "var(--accent-deep)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" }}>
              <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
            </div>
            <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--accent-deep)", marginBottom: 10 }}>Payment confirmed</div>
            <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.035em", lineHeight: 1.15, marginBottom: 10 }}>You're in{restaurantName ? `, ${restaurantName}` : ""}!</div>
            <div style={{ fontSize: 14, color: "var(--muted)", lineHeight: 1.6, marginBottom: 28 }}>Your founding member subscription is active. Next, let's get your kitchen set up — it takes about ten minutes.</div>

            <div style={{ border: "1px solid var(--line-soft)", borderRadius: 10, overflow: "hidden", marginBottom: 28, textAlign: "left" }}>
              <div style={row}><span style={{ fontSize: 12.5, color: "var(--muted)" }}>Plan</span><span style={{ fontSize: 13, fontWeight: 700 }}>Founding member</span></div>
              <div style={row}><span style={{ fontSize: 12.5, color: "var(--muted)" }}>Amount charged today</span><span style={{ fontSize: 13, fontWeight: 700 }}>{amount}</span></div>
              <div style={row}><span style={{ fontSize: 12.5, color: "var(--muted)" }}>Card</span><span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 13, color: "var(--muted)" }}>•••• {last4}</span></div>
              <div style={{ ...row, borderBottom: "none" }}><span style={{ fontSize: 12.5, color: "var(--muted)" }}>Billing</span><span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 13, color: "var(--muted)" }}>Monthly, recurring</span></div>
            </div>

            <NavLink href="/client/onboarding" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: "var(--accent)", color: "#fff", borderRadius: 26, padding: 14, fontSize: 15, fontWeight: 700, marginBottom: 14 }}>
              Set up your kitchen
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg>
            </NavLink>
            <NavLink href="/client/dashboard" style={{ fontSize: 13, fontWeight: 600, color: "var(--muted)" }}>Skip to dashboard</NavLink>
          </div>
          <div style={{ textAlign: "center", fontSize: 11, color: "var(--faint)", marginTop: 16 }}>A receipt has been sent to your email.</div>
        </div>
      </div>
    </div>
  );
}

function DefaultLink({ href, children, style }) {
  return <a href={href} style={style}>{children}</a>;
}