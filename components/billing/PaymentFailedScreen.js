// components/billing/PaymentFailedScreen.js
// Presentational only. Blocks access entirely until payment is resolved —
// no dashboard link, no way around it, matching the "immediate hard lock"
// policy for a past_due subscription.

import { useState } from "react";

export default function PaymentFailedScreen({ onRetry, updateCardHref = "/client/checkout", NavLink = DefaultLink }) {
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState("");

  const handleRetry = async () => {
    setError("");
    setRetrying(true);
    try {
      await onRetry?.();
    } catch (err) {
      setError(err?.message || "That payment still failed. Please update your card instead.");
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, background: "#eef0ef", fontFamily: "'Manrope',system-ui,sans-serif" }}>
      <div style={{ width: "100%", maxWidth: 440, background: "#fff", border: "1px solid #d8dfe0", borderRadius: 14, boxShadow: "0 22px 60px rgba(17,24,25,0.12)", padding: "36px 32px", textAlign: "center" }}>
        <div style={{ width: 52, height: 52, borderRadius: "50%", background: "#faeae8", color: "#c4473e", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" }}>
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 8v5" /><path d="M12 16.5v.01" /></svg>
        </div>
        <div style={{ fontSize: 21, fontWeight: 800, letterSpacing: "-0.02em", marginBottom: 10 }}>Your payment failed</div>
        <div style={{ fontSize: 14, color: "#4b585b", lineHeight: 1.6, marginBottom: 26 }}>
          We couldn't charge your card on file. Update your payment method or try the charge again to restore access to your account.
        </div>

        {error && (
          <div style={{ marginBottom: 18, padding: "10px 14px", borderRadius: 8, fontSize: 13, background: "#faeae8", border: "1px solid #c4473e", color: "#c4473e", textAlign: "left" }}>
            {error}
          </div>
        )}

        <button
          type="button"
          onClick={handleRetry}
          disabled={retrying}
          style={{ width: "100%", background: "#02a4ba", color: "#fff", border: "none", borderRadius: 26, padding: 13, fontSize: 14.5, fontWeight: 700, cursor: retrying ? "default" : "pointer", opacity: retrying ? 0.7 : 1, marginBottom: 10 }}
        >
          {retrying ? "Retrying…" : "Retry payment now"}
        </button>

        <NavLink
          href={updateCardHref}
          style={{ display: "block", width: "100%", textAlign: "center", background: "none", border: "1px solid #d8dfe0", borderRadius: 26, padding: 12, fontSize: 14, fontWeight: 600, color: "#111819", boxSizing: "border-box" }}
        >
          Update payment method
        </NavLink>
      </div>
    </div>
  );
}

function DefaultLink({ href, children, style }) {
  return <a href={href} style={style}>{children}</a>;
}