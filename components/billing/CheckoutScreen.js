import { useState } from "react";
import { CardElement, useStripe, useElements } from "@stripe/react-stripe-js";

/**
 * CheckoutScreen — handles BOTH first-time subscription checkout and
 * card-update, distinguished by `mode` (set by the page container based on
 * whether the restaurant already has a stripe_subscription_id — never
 * decided here). Must be rendered inside a Stripe <Elements> provider
 * (pages/client/checkout.js does this) — useStripe()/useElements() only
 * work on a descendant of that provider.
 *
 * Props:
 *   mode            "subscribe" | "update"
 *   plan            {name, price}
 *   clientSecret    the PaymentIntent (subscribe) or SetupIntent (update)
 *                   client_secret from /api/stripe/create-intent
 *   subscriptionId  only used in "subscribe" mode — passed straight through
 *                   to onConfirmed, not re-derived from Stripe's response
 *   onConfirmed     ({mode, subscriptionId?, setupIntentId?}) => Promise<{last4}>
 *                   — the page's job: call /api/stripe/finalize and return
 *                   its result
 *   NavLink, backHref
 */
export default function CheckoutScreen({
  mode = "update",
  plan = { name: "Founding member plan", price: "$59" },
  clientSecret,
  subscriptionId,
  onConfirmed,
  NavLink = DefaultLink,
  backHref = "/client/billing",
}) {
  const stripe = useStripe();
  const elements = useElements();

  const [email, setEmail] = useState("");
  const [cardName, setCardName] = useState("");
  const [country, setCountry] = useState("US");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null); // { last4 }

  const isSubscribe = mode === "subscribe";

  const inputCls = { width: "100%", background: "var(--shell)", border: "1px solid var(--line)", borderRadius: 8, padding: "10px 12px", fontSize: 14, color: "var(--text)", fontFamily: "'Manrope',sans-serif", outline: "none" };
  const labelCls = { fontSize: 11.5, fontWeight: 600, color: "var(--muted)", marginBottom: 5, display: "block" };
  const cardElementOptions = {
    style: {
      base: { fontSize: "14px", fontFamily: "'Manrope', sans-serif", color: "#111819", "::placeholder": { color: "#78868a" } },
      invalid: { color: "#c4473e" },
    },
  };

  const submit = async () => {
    if (!stripe || !elements || !clientSecret) return;
    if (!email.trim()) { setError("Enter an email address."); return; }
    if (!cardName.trim()) { setError("Enter the name on the card."); return; }
    setError("");
    setSubmitting(true);
    try {
      const cardElement = elements.getElement(CardElement);
      const billingDetails = { name: cardName, email, address: { country } };

      if (isSubscribe) {
        const { error: stripeError, paymentIntent } = await stripe.confirmCardPayment(clientSecret, {
          payment_method: { card: cardElement, billing_details: billingDetails },
        });
        if (stripeError) throw new Error(stripeError.message);
        if (paymentIntent.status !== "succeeded") throw new Error("Payment was not completed.");
        const res = await onConfirmed?.({ mode, subscriptionId });
        setResult(res || {});
      } else {
        const { error: stripeError, setupIntent } = await stripe.confirmCardSetup(clientSecret, {
          payment_method: { card: cardElement, billing_details: billingDetails },
        });
        if (stripeError) throw new Error(stripeError.message);
        if (setupIntent.status !== "succeeded") throw new Error("Card setup was not completed.");
        const res = await onConfirmed?.({ mode, setupIntentId: setupIntent.id });
        setResult(res || {});
      }
    } catch (err) {
      setError(err?.message || "Something went wrong. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="om-checkout"
      style={{
        "--ground": "#e6e4e0", "--shell": "#ffffff", "--panel": "#eef0ef", "--line": "#d8dfe0", "--line-soft": "#eef1f2",
        "--text": "#111819", "--muted": "#4b585b", "--faint": "#78868a",
        "--accent": "#02a4ba", "--accent-deep": "#03808f", "--accent-tint": "#e8f7f9",
        "--red": "#c4473e", "--red-tint": "#faeae8", "--shadow-lg": "0 22px 60px rgba(17,24,25,0.12)",
        width: "100%", minHeight: "100vh", display: "flex", flexWrap: "wrap",
        background: "var(--panel)", color: "var(--text)", fontFamily: "'Manrope',system-ui,sans-serif",
      }}
    >
      <div style={{ flex: "1 1 340px", background: "var(--shell)", padding: "48px 44px", borderRight: "1px solid var(--line)" }}>
        <NavLink href={backHref} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600, color: "var(--faint)", marginBottom: 36 }}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
          {isSubscribe ? "Back" : "Back to billing"}
        </NavLink>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 28 }}>
          <img src="/landing/logo.png" alt="optiMenu Solutions" style={{ height: 20, width: "auto" }} />
        </div>
        <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10.5, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--faint)", marginBottom: 6 }}>
          {isSubscribe ? "Start your subscription" : "Update payment method"}
        </div>
        <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-0.03em", marginBottom: 20 }}>{plan.name}</div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 6 }}>
          <div style={{ fontSize: 32, fontWeight: 800, letterSpacing: "-0.03em" }}>{plan.price}</div>
          <div style={{ fontSize: 14, color: "var(--faint)" }}>/month</div>
        </div>
        <div style={{ fontSize: 12.5, color: "var(--faint)", lineHeight: 1.6, marginBottom: 28 }}>
          {isSubscribe
            ? "Locked-in founding rate for as long as you stay subscribed."
            : "Locked-in founding rate. Your subscription continues uninterrupted — this only updates the card on file."}
        </div>
        <div style={{ height: 1, background: "var(--line-soft)", marginBottom: 20 }} />
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12.5, color: "var(--muted)" }}>
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="var(--accent-deep)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><rect x="3" y="11" width="18" height="10" rx="2" /><path d="M7 11V7a5 5 0 0110 0v4" /></svg>
          Payments are processed securely off-site. optiMenu never stores your card details.
        </div>
      </div>

      <div style={{ flex: "1.4 1 480px", display: "flex", alignItems: "center", justifyContent: "center", padding: "48px 24px" }}>
        <div style={{ width: "100%", maxWidth: 420 }}>
          {!result ? (
            <div style={{ background: "var(--shell)", border: "1px solid var(--line)", borderRadius: 12, boxShadow: "var(--shadow-lg)", padding: "28px 26px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 22 }}>
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="var(--accent-deep)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><rect x="3" y="11" width="18" height="10" rx="2" /><path d="M7 11V7a5 5 0 0110 0v4" /></svg>
                <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.01em" }}>{isSubscribe ? "Secure checkout" : "Secure card update"}</span>
              </div>

              <div style={{ marginBottom: 20 }}>
                <span style={labelCls}>Email</span>
                <input style={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@restaurant.com" />
              </div>

              <div style={{ marginBottom: 20 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 5 }}>
                  <span style={{ ...labelCls, marginBottom: 0 }}>Card details</span>
                  <div style={{ display: "flex", gap: 4 }}>
                    {["VISA", "MC", "AMEX"].map((b) => (
                      <div key={b} style={{ width: 24, height: 16, borderRadius: 2, background: "var(--panel)", border: "1px solid var(--line)", fontFamily: "'IBM Plex Mono',monospace", fontSize: 6.5, fontWeight: 700, color: "var(--faint)", display: "flex", alignItems: "center", justifyContent: "center" }}>{b}</div>
                    ))}
                  </div>
                </div>
                <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: "10px 12px", background: "var(--shell)" }}>
                  <CardElement options={cardElementOptions} />
                </div>
              </div>

              <div style={{ marginBottom: 20 }}>
                <span style={labelCls}>Name on card</span>
                <input style={inputCls} value={cardName} onChange={(e) => setCardName(e.target.value)} placeholder="Marco Rossi" />
              </div>

              <div style={{ marginBottom: 24 }}>
                <span style={labelCls}>Country</span>
                <select style={{ ...inputCls, cursor: "pointer" }} value={country} onChange={(e) => setCountry(e.target.value)}>
                  <option value="US">United States</option>
                  <option value="CA">Canada</option>
                  <option value="GB">United Kingdom</option>
                  <option value="IT">Italy</option>
                </select>
              </div>

              {error && (
                <div style={{ marginBottom: 16, padding: "10px 13px", borderRadius: 8, fontSize: 12.5, fontWeight: 500, background: "var(--red-tint)", border: "1px solid var(--red)", color: "var(--red)" }}>{error}</div>
              )}

              <button
                type="button"
                onClick={submit}
                disabled={submitting || !stripe || !clientSecret}
                style={{ width: "100%", background: "var(--accent)", color: "#fff", border: "none", borderRadius: 8, padding: 13, fontSize: 14.5, fontWeight: 700, cursor: "pointer", opacity: submitting || !stripe || !clientSecret ? 0.6 : 1 }}
              >
                {submitting ? (isSubscribe ? "Subscribing…" : "Updating…") : isSubscribe ? `Subscribe — ${plan.price}/mo` : "Update card"}
              </button>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 16 }}>
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="var(--faint)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><rect x="3" y="11" width="18" height="10" rx="2" /><path d="M7 11V7a5 5 0 0110 0v4" /></svg>
                <span style={{ fontSize: 10.5, color: "var(--faint)" }}>PCI-compliant · 256-bit TLS encryption</span>
              </div>
            </div>
          ) : (
            <div style={{ textAlign: "center", padding: "20px 0" }}>
              <div style={{ width: 52, height: 52, borderRadius: "50%", background: "var(--accent-tint)", color: "var(--accent-deep)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 18px" }}>
                <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
              </div>
              <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 6 }}>{isSubscribe ? "You're in" : "Card updated"}</div>
              <div style={{ fontSize: 13.5, color: "var(--muted)", lineHeight: 1.6, marginBottom: 26 }}>
                {result.last4
                  ? `Your card ending in ${result.last4} will be used for future charges.`
                  : "Your subscription is active."}
              </div>
              <NavLink href={backHref} style={{ display: "inline-flex", background: "var(--accent)", color: "#fff", borderRadius: 8, padding: "11px 22px", fontSize: 14, fontWeight: 700 }}>
                {isSubscribe ? "Continue" : "Return to billing"}
              </NavLink>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DefaultLink({ href, children, style }) {
  return <a href={href} style={style}>{children}</a>;
}
