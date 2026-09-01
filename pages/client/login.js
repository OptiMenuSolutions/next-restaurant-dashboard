import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import supabase from "../../lib/supabaseClient";
import AuthScreen from "../../components/client/AuthScreen";

/**
 * pages/client/login.js — data container.
 *
 * Real fix (see chat): this used to redirect unconditionally to
 * /client/dashboard, which meant a user who never finished checkout — or
 * finished checkout but never finished onboarding — could still reach the
 * dashboard just by logging in, completely bypassing payment and setup.
 * Now checks restaurants.stripe_subscription_id and
 * restaurants.onboarding_completed_at and routes to whichever step is
 * actually next: checkout -> onboarding -> dashboard.
 *
 * Also includes a fallback: if signup.js couldn't create the profiles row
 * yet (no session at signup time — see its comment on email confirmation),
 * this is the first point a session is guaranteed to exist, so it creates
 * the profile here instead if it's still missing. That insert is what fires
 * create_restaurant_trigger and auto-creates the restaurant.
 *
 * Also checks for a deactivated account and offers reactivation — this is
 * the only place in the app that clears restaurants.deactivated_at short of
 * the 60-day purge cron deleting the account outright.
 */
export default function LoginPage() {
  const router = useRouter();

  const handleSubmit = async ({ email, password }) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;

    const { data: existing } = await supabase
      .from("profiles").select("id, restaurant_id").eq("id", data.user.id).single();

    let restaurantId = existing?.restaurant_id || null;

    if (!existing) {
      // First-ever login after a signup that happened with email
      // confirmation on (no session existed at signup time to create this
      // row then). Insert now, and read back the restaurant_id the trigger
      // creates in the same transaction.
      const { data: created, error: profileError } = await supabase
        .from("profiles")
        .insert({
          id: data.user.id,
          email: data.user.email,
          full_name: data.user.user_metadata?.full_name || "",
        })
        .select("restaurant_id")
        .single();
      if (profileError) {
        console.error("[login] fallback profile creation failed:", profileError.message);
      } else {
        restaurantId = created?.restaurant_id || null;
      }
    }

    if (!restaurantId) {
      // No restaurant at all yet (shouldn't normally happen if the trigger
      // fired) — send to checkout anyway; it will surface its own clear
      // error rather than silently landing on a broken dashboard.
      router.push("/client/checkout");
      return;
    }

    const { data: restaurant } = await supabase
      .from("restaurants")
      .select("deactivated_at, stripe_subscription_id, onboarding_completed_at")
      .eq("id", restaurantId)
      .single();

    if (restaurant?.deactivated_at) {
      const wantsReactivation = window.confirm(
        "This account was deactivated. Your data is still here — reactivate to pick up where you left off?"
      );
      if (!wantsReactivation) {
        await supabase.auth.signOut();
        throw new Error("Account remains deactivated.");
      }
      const res = await fetch("/api/account/reactivate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` },
      });
      const json = await res.json();
      if (!res.ok) {
        await supabase.auth.signOut();
        throw new Error(json.error || "Could not reactivate this account.");
      }
    }

    if (!restaurant?.stripe_subscription_id) {
      router.push("/client/checkout");
      return;
    }
    if (!restaurant?.onboarding_completed_at) {
      router.push("/client/onboarding");
      return;
    }
    router.push("/client/dashboard");
  };

  return (
    <>
      <Head>
        <title>Sign in — OptiMenu</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <AuthScreen mode="login" onSubmit={handleSubmit} NavLink={Link} />
    </>
  );
}
