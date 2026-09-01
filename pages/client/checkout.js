import { useEffect, useState } from "react";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { Elements } from "@stripe/react-stripe-js";
import supabase from "../../lib/supabaseClient";
import { getStripe } from "../../lib/stripeClient";
import CheckoutScreen from "../../components/billing/CheckoutScreen";

/**
 * pages/client/checkout.js — data container for BOTH first-time
 * subscription checkout and card-update. /api/stripe/create-intent decides
 * which mode this is (based on whether the restaurant already has a
 * stripe_subscription_id) — this page just renders whatever it's told.
 */
export default function CheckoutPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [intent, setIntent] = useState(null); // { clientSecret, mode, subscriptionId? }

  useEffect(() => {
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) { router.push("/client/login"); return; }

        const res = await fetch("/api/stripe/create-intent", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Could not start checkout.");
        setIntent(json);
      } catch (err) {
        setError(err.message || "Could not start checkout.");
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  const handleConfirmed = async ({ mode, subscriptionId, setupIntentId }) => {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch("/api/stripe/finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify({ mode, subscriptionId, setupIntentId }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Could not confirm — try again.");
    return { last4: json.last4 || null };
  };

  return (
    <>
      <Head>
        <title>{intent?.mode === "subscribe" ? "Subscribe" : "Update payment method"} — OptiMenu</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      {loading && (
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Manrope',sans-serif", color: "#4b585b" }}>
          Loading…
        </div>
      )}

      {!loading && error && (
        <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, fontFamily: "'Manrope',sans-serif", padding: 24, textAlign: "center" }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#c4473e" }}>{error}</div>
          <Link href="/client/billing" style={{ fontSize: 13, color: "#03808f" }}>Back to billing</Link>
        </div>
      )}

      {!loading && !error && intent && (
        <Elements stripe={getStripe()} options={{ clientSecret: intent.clientSecret }}>
          <CheckoutScreen
            NavLink={Link}
            mode={intent.mode}
            clientSecret={intent.clientSecret}
            subscriptionId={intent.subscriptionId}
            onConfirmed={handleConfirmed}
            backHref={intent.mode === "subscribe" ? "/client/checkout-success" : "/client/billing"}
          />
        </Elements>
      )}
    </>
  );
}
