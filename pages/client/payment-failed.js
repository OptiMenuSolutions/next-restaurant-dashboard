// pages/client/payment-failed.js
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import supabase from "../../lib/supabaseClient";
import PaymentFailedScreen from "../../components/billing/PaymentFailedScreen";

export default function PaymentFailedPage() {
  const router = useRouter();

  const handleRetry = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.push("/client/login"); return; }

    const res = await fetch("/api/stripe/retry-payment", {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "That payment still failed. Please update your card instead.");

    router.push("/client/dashboard");
  };

  return (
    <>
      <Head>
        <title>Payment failed — OptiMenu</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <PaymentFailedScreen onRetry={handleRetry} NavLink={Link} />
    </>
  );
}