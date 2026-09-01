import { useEffect, useState } from "react";
import Head from "next/head";
import Link from "next/link";
import supabase from "../../lib/supabaseClient";
import BillingScreen from "../../components/client/BillingScreen";

/**
 * pages/client/billing.js — data container.
 *
 * Card/plan info and billing history are now both real, via
 * /api/stripe/subscription-summary and /api/stripe/billing-history.
 * onDownloadReceipt just opens the invoice PDF Stripe already generated —
 * no custom receipt system needed, which resolves what was previously
 * flagged as blocked on "what does a receipt even look like here."
 */
export default function BillingPage() {
  const [card, setCard] = useState(null);
  const [plan, setPlan] = useState(null);
  const [billingHistory, setBillingHistory] = useState(null); // null = still loading, use BillingScreen's own demo fallback

  useEffect(() => {
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;

        const [summaryRes, historyRes] = await Promise.all([
          fetch("/api/stripe/subscription-summary", { headers: { Authorization: `Bearer ${session.access_token}` } }),
          fetch("/api/stripe/billing-history", { headers: { Authorization: `Bearer ${session.access_token}` } }),
        ]);

        if (summaryRes.ok) {
          const json = await summaryRes.json();
          if (json.last4) {
            setCard({
              last4: json.last4,
              exp: json.expMonth && json.expYear
                ? `${String(json.expMonth).padStart(2, "0")}/${String(json.expYear).slice(-2)}`
                : "",
            });
          }
          if (json.planName || json.amount) {
            setPlan({
              name: json.planName || "Founding member",
              price: json.amount ? `${json.amount}/mo` : "$59/mo",
            });
          }
        }

        if (historyRes.ok) {
          const json = await historyRes.json();
          setBillingHistory(json.history || []);
        }
      } catch (err) {
        console.error("[billing] Failed to load billing data:", err);
      }
    })();
  }, []);

  const downloadReceipt = async (row) => {
    const url = row.invoicePdf || row.hostedInvoiceUrl;
    if (!url) return;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <>
      <Head>
        <title>Billing &amp; subscription — OptiMenu</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <BillingScreen
        NavLink={Link}
        {...(card ? { card } : {})}
        {...(plan ? { plan } : {})}
        {...(billingHistory !== null ? { billingHistory } : {})}
        onDownloadReceipt={downloadReceipt}
      />
    </>
  );
}
