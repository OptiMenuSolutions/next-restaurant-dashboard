import { useEffect, useState } from "react";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import supabase from "../../lib/supabaseClient";
import ProfileScreen from "../../components/client/ProfileScreen";
import { enforceAccountGuard } from "../../lib/enforceAccountGuard";

/**
 * pages/client/profile.js — data container.
 *
 * onToggleNotif is now genuinely wired — the real restaurants schema has
 * notif_weekly_summary / notif_price_alerts / notif_low_margin boolean
 * columns, whose names map directly onto ProfileScreen's own notifPrefs
 * keys (weekly / priceAlert / lowMargin).
 *
 * onDeleteAccount is now wired too — it deactivates (not hard-deletes) via
 * /api/account/deactivate: cancels Stripe billing immediately, marks the
 * restaurant deactivated_at, and signs out. Data is retained 60 days —
 * pages/api/cron/purge-deactivated-accounts.js does the actual deletion
 * after that window. Reactivating happens on a subsequent login, not here.
 *   - onExportData exports restaurant/menu items/ingredients/invoices as
 *     JSON — my own reasonable guess at scope, not a confirmed spec.
 */
export default function ProfilePage() {
  const router = useRouter();
  const initialTab = typeof router.query.tab === "string" ? router.query.tab : "account";

  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState(null);
  const [restaurantId, setRestaurantId] = useState(null);
  const [userName, setUserName] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [restaurantName, setRestaurantName] = useState("");
  const [targetFoodCost, setTargetFoodCost] = useState(30);
  const [notifPrefs, setNotifPrefs] = useState({ weekly: true, priceAlert: true, lowMargin: false });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { router.push("/client/login"); return; }
        const { data: profile } = await supabase
          .from("profiles").select("restaurant_id, full_name").eq("id", user.id).single();
        if (cancelled) return;
        setUserId(user.id);
        setUserEmail(user.email || "");
        setUserName(profile?.full_name || "");
        if (profile?.restaurant_id) {
          setRestaurantId(profile.restaurant_id);
          const rest = await enforceAccountGuard(supabase, router, profile.restaurant_id);
          if (!rest) return;
          if (!cancelled && rest) {
            setRestaurantName(rest.name || "");
            if (rest.target_food_cost != null) setTargetFoodCost(Number(rest.target_food_cost));
            setNotifPrefs({
              weekly: rest.notif_weekly_summary ?? true,
              priceAlert: rest.notif_price_alerts ?? true,
              lowMargin: rest.notif_low_margin ?? false,
            });
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [router]);

  const saveName = async (name) => {
    const { error: authError } = await supabase.auth.updateUser({ data: { full_name: name } });
    if (authError) throw authError;
    const { error: profileError } = await supabase.from("profiles").update({ full_name: name }).eq("id", userId);
    if (profileError) throw profileError;
    setUserName(name);
  };

  const saveRestaurant = async (name) => {
    if (!restaurantId) throw new Error("No restaurant on this account yet.");
    const { error } = await supabase.from("restaurants").update({ name }).eq("id", restaurantId);
    if (error) throw error;
    setRestaurantName(name);
  };

  const saveFoodCost = async (pct) => {
    if (!restaurantId) throw new Error("No restaurant on this account yet.");
    const { error } = await supabase.from("restaurants").update({ target_food_cost: pct }).eq("id", restaurantId);
    if (error) throw error;
    setTargetFoodCost(pct);
  };

  const savePassword = async (pw) => {
    const { error } = await supabase.auth.updateUser({ password: pw });
    if (error) throw error;
  };

  const toggleNotif = async (key, next) => {
    if (!restaurantId) return;
    const columnMap = {
      weekly: "notif_weekly_summary",
      priceAlert: "notif_price_alerts",
      lowMargin: "notif_low_margin",
    };
    const column = columnMap[key];
    if (!column) { console.warn("Unknown notification key, nothing to persist:", key); return; }
    const { error } = await supabase.from("restaurants").update({ [column]: next }).eq("id", restaurantId);
    if (error) throw error;
    setNotifPrefs((prev) => ({ ...prev, [key]: next }));
  };

  const sendFeedback = async (text) => {
    const { error } = await supabase
      .from("feedback")
      .insert({ user_id: userId, restaurant_id: restaurantId, message: text, type: "general" });
    if (error) throw error;
  };

  const exportData = async () => {
    if (!restaurantId) throw new Error("No restaurant on this account yet.");
    const [{ data: restaurant }, { data: menuItems }, { data: ingredients }, { data: invoices }] = await Promise.all([
      supabase.from("restaurants").select("*").eq("id", restaurantId).single(),
      supabase.from("menu_items").select("*").eq("restaurant_id", restaurantId),
      supabase.from("ingredients").select("*").eq("restaurant_id", restaurantId),
      supabase.from("invoices").select("*").eq("restaurant_id", restaurantId),
    ]);
    const payload = {
      exportedAt: new Date().toISOString(),
      restaurant,
      menuItems: menuItems || [],
      ingredients: ingredients || [],
      invoices: invoices || [],
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `optimenu-export-${new Date().toISOString().split("T")[0]}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    router.push("/client/login");
  };

  const deactivateAccount = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch("/api/account/deactivate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Could not deactivate account.");
    await supabase.auth.signOut();
    router.push("/client/login");
  };

  return (
    <>
      <Head>
        <title>Profile &amp; settings — OptiMenu</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <ProfileScreen
        NavLink={Link}
        initialTab={initialTab}
        user={{ name: userName, email: userEmail }}
        restaurantName={restaurantName}
        targetFoodCost={targetFoodCost}
        notifPrefs={notifPrefs}
        onSaveName={saveName}
        onSaveRestaurant={saveRestaurant}
        onSaveFoodCost={saveFoodCost}
        onSavePassword={savePassword}
        onToggleNotif={toggleNotif}
        onExportData={exportData}
        onDeleteAccount={deactivateAccount}
        onSendFeedback={sendFeedback}
        onRestartTour={() => {
          try { localStorage.removeItem("optimenu_tour_done"); sessionStorage.removeItem("optimenu_tour_step"); } catch {}
          router.push("/client/dashboard?tour=true");
        }}
        onSignOut={signOut}
      />
    </>
  );
}