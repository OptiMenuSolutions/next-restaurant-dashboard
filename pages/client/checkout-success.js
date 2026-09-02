import { useEffect, useState } from "react";
import Head from "next/head";
import Link from "next/link";
import supabase from "../../lib/supabaseClient";
import CheckoutSuccessScreen from "../../components/billing/CheckoutSuccessScreen";

/**
 * pages/client/checkout-success.js — data container. Was previously a bare
 * pass-through showing CheckoutSuccessScreen's hardcoded demo defaults
 * ("Luna Osteria", "$59.00", card ending 4242) regardless of who actually
 * just subscribed. Now fetches the real values from /api/stripe/
 * subscription-summary.
 */
export default function CheckoutSuccessPage() {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const res = await fetch("/api/stripe/subscription-summary", {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (res.ok) setSummary(await res.json());
      } catch (err) {
        console.error("[checkout-success] Failed to load subscription summary:", err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <>
      <Head>
        <title>You're in — OptiMenu</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      {!loading && (
        <CheckoutSuccessScreen
          NavLink={Link}
          {...(summary?.restaurantName ? { restaurantName: summary.restaurantName } : {})}
          {...(summary?.amount ? { amount: summary.amount } : {})}
          {...(summary?.last4 ? { last4: summary.last4 } : {})}
        />
      )}
    </>
  );
}