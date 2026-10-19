import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import supabase from "../../lib/supabaseClient";
import { Shell, MONO, SANS } from "./ClientChrome";

/**
 * WebsiteOnly — wraps pages that sell or manage a subscription (signup,
 * checkout, billing, payment problems). In a browser the page renders as
 * usual. Inside the OptiMenu iPhone and Android app (its user agent contains
 * OptiMenuApp) a plain "not available in the app" screen shows instead, since
 * App Store and Google Play rules do not allow buying or managing a
 * subscription in the app, or pointing people to where they can.
 *
 * The wrapped page never mounts in the app, so none of its Stripe calls run
 * there. Renders nothing for the first moment while it checks.
 */
export default function WebsiteOnly({ children }) {
  const [inApp, setInApp] = useState(null); // null until checked in the browser
  useEffect(() => {
    let v = false;
    try { v = /OptiMenuApp/i.test(navigator.userAgent); } catch {}
    setInApp(v);
  }, []);
  if (inApp === null) return null;
  if (inApp) return <NotInApp />;
  return children;
}

function NotInApp() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const signOut = async () => {
    setBusy(true);
    try { await supabase.auth.signOut(); } catch {}
    router.replace("/client/login");
  };

  const goBack = () => {
    if (window.history.length > 1) router.back();
    else router.replace("/client/dashboard");
  };

  const btn = { flex: 1, minHeight: 46, borderRadius: 23, fontFamily: SANS, fontSize: 14, fontWeight: 700, cursor: "pointer" };

  return (
    <Shell style={{ minHeight: "100dvh", justifyContent: "center", background: "var(--panel)", padding: "calc(24px + env(safe-area-inset-top, 0px)) 20px calc(24px + env(safe-area-inset-bottom, 0px))" }}>
      <div style={{ width: "100%", maxWidth: 420, margin: "0 auto", background: "var(--shell)", border: "1px solid var(--line)", borderRadius: 14, padding: "28px 22px" }}>
        <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--accent-deep)" }}>OptiMenu</div>
        <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1.15, marginTop: 8 }}>Not available in the app</div>
        <div style={{ fontSize: 14, color: "var(--muted)", lineHeight: 1.6, marginTop: 10 }}>
          Plans, payments and account setup are handled outside the app. Once your plan is active, everything else works here.
        </div>
        <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6, marginTop: 12 }}>
          Questions? <a href="mailto:support@opti-menu.com">support@opti-menu.com</a>
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
          <button type="button" onClick={goBack} style={{ ...btn, background: "none", border: "1px solid var(--line)", color: "var(--text)" }}>Back</button>
          <button type="button" onClick={signOut} disabled={busy} style={{ ...btn, background: "var(--accent)", border: "none", color: "#fff", opacity: busy ? 0.7 : 1 }}>{busy ? "Signing out…" : "Sign out"}</button>
        </div>
      </div>
    </Shell>
  );
}