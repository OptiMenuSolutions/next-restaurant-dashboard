import { useState } from "react";
import { useAccountChrome, CSS as CHROME_CSS } from "./AccountChrome";

/**
 * BillingScreen — ported from OptiMenu Billing.dc.html: current plan,
 * payment method (with a link out to the checkout/card-update flow), and
 * billing history.
 *
 * Props: user, billingHistory [{date,desc,amount,onDownload}], card {last4,exp},
 * NavLink, onSignOut.
 */
const DEMO_HISTORY = [
  { date: "Aug 1, 2026", desc: "Founding member plan", amount: "$59.00" },
  { date: "Jul 1, 2026", desc: "Founding member plan", amount: "$59.00" },
  { date: "Jun 1, 2026", desc: "Founding member plan", amount: "$59.00" },
];

export default function BillingScreen({
  user = { name: "Marco Rossi", email: "marco@lunaosteria.com" },
  plan = { name: "Founding member", price: "$59/mo" },
  billingHistory = DEMO_HISTORY,
  card = { last4: "4242", exp: "04/28" },
  onDownloadReceipt,
  NavLink,
  onSignOut,
}) {
  const { header, theme } = useAccountChrome({ user, NavLink, onSignOut });
  const [message, setMessage] = useState(null);
  const flash = (text) => { setMessage(text); setTimeout(() => setMessage(null), 3500); };

  const cardStyle = { background: "var(--shell)", border: "1px solid var(--line)", borderRadius: 12, boxShadow: "var(--card-lift)", overflow: "hidden", marginBottom: 16 };
  const cardHead = { fontFamily: "'IBM Plex Mono',monospace", fontSize: 10.5, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--faint)", padding: "13px 18px", borderBottom: "1px solid var(--line-soft)" };

  return (
    <div className="om-acct" data-theme={theme} style={{ width: "100%", minHeight: "100vh" }}>
      {header}

      <div style={{ background: "var(--panel)", minHeight: "calc(100vh - 41px)", display: "flex", flexDirection: "column", alignItems: "center", padding: "0 20px 60px" }}>
        <div style={{ width: "100%", maxWidth: 640, paddingTop: 24 }}>
          <NavLink href="/client/profile" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600, color: "var(--faint)", marginBottom: 14 }}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
            Back to profile
          </NavLink>

          <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11.5, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--faint)", marginBottom: 5 }}>Account settings</div>
          <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.035em", lineHeight: 1.1, marginBottom: 16 }}>Billing &amp; subscription</div>

          {message && (
            <div style={{ marginBottom: 14, padding: "11px 15px", borderRadius: 8, fontSize: 13, fontWeight: 500, background: "var(--accent-tint)", border: "1px solid var(--accent)", color: "var(--accent-deep)" }}>{message}</div>
          )}

          <div style={cardStyle}>
            <div style={cardHead}>Current plan</div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 18px" }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{plan.name}</div>
                <div style={{ fontSize: 12.5, color: "var(--faint)", marginTop: 3 }}>Renews monthly · locked-in rate for life</div>
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "var(--accent-deep)" }}>{plan.price}</div>
            </div>
          </div>

          <div style={cardStyle}>
            <div style={cardHead}>Payment method</div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 32, height: 21, borderRadius: 3, background: "var(--text)", opacity: 0.85, flexShrink: 0 }} />
                <div style={{ fontSize: 14, fontWeight: 600 }}>•••• {card.last4}</div>
                <div style={{ fontSize: 12, color: "var(--faint)" }}>Exp {card.exp}</div>
              </div>
              <NavLink href="/client/checkout" style={{ fontSize: 13, fontWeight: 700, color: "var(--accent-deep)" }}>Update</NavLink>
            </div>
            <div style={{ padding: "0 18px 16px", fontSize: 12, color: "var(--faint)", lineHeight: 1.5 }}>Updating your card or cancelling redirects to our payment processor's secure portal.</div>
          </div>

          <div style={{ ...cardStyle, marginBottom: 20 }}>
            <div style={cardHead}>Billing history</div>
            {billingHistory.map((b, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 18px", borderBottom: "1px solid var(--line-soft)" }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{b.date}</div>
                  <div style={{ fontSize: 12, color: "var(--faint)", marginTop: 2 }}>{b.desc}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600 }}>{b.amount}</span>
                  <a href="#" onClick={async (e) => { e.preventDefault(); await onDownloadReceipt?.(b); flash("Downloading receipt…"); }} style={{ fontSize: 12.5, fontWeight: 600, color: "var(--accent-deep)" }}>Download ↓</a>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <style>{CHROME_CSS}</style>
    </div>
  );
}
