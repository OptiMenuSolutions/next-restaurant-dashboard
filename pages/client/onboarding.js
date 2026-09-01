import { useEffect, useState } from "react";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import supabase from "../../lib/supabaseClient";
import OnboardingScreen from "../../components/onboarding/OnboardingScreen";

/**
 * pages/client/onboarding.js — data container.
 *
 * `create_restaurant_trigger` already created a restaurants row when the
 * profiles row was inserted at signup — this UPDATEs that row with the real
 * name/cuisine, rather than inserting a second one (which is what the
 * previous version of this file did, before the trigger was known about).
 *
 * `address` and `style` are collected by OnboardingScreen's UI but dropped
 * here — the real restaurants schema has no columns for either, only
 * `cuisine_type` (not `cuisine`, mapped below). If you want those fields
 * persisted, they need actual columns added first.
 */
export default function OnboardingPage() {
  const router = useRouter();
  const [restaurantId, setRestaurantId] = useState(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile } = await supabase
        .from("profiles").select("restaurant_id").eq("id", user.id).single();
      if (profile?.restaurant_id) setRestaurantId(profile.restaurant_id);
    })();
  }, []);

  const finishOnboarding = async ({ name, address, style, cuisine }) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push("/client/login"); return; }

    const { data: profile } = await supabase
      .from("profiles").select("restaurant_id").eq("id", user.id).single();

    if (profile?.restaurant_id) {
      const { error } = await supabase
        .from("restaurants")
        .update({ name, cuisine_type: cuisine, onboarding_completed_at: new Date().toISOString() })
        .eq("id", profile.restaurant_id);
      if (error) throw error;
    } else {
      // Defensive fallback only — shouldn't normally happen. If it does,
      // the profiles row itself never got created (see signup.js/login.js's
      // comments on the email-confirmation timing case), so the trigger
      // never fired. Create both explicitly rather than fail here.
      const { data: restaurant, error: restError } = await supabase
        .from("restaurants")
        .insert({ name, user_id: user.id, cuisine_type: cuisine, onboarding_completed_at: new Date().toISOString() })
        .select()
        .single();
      if (restError) throw restError;

      const { error: profileError } = await supabase
        .from("profiles")
        .upsert({ id: user.id, email: user.email, restaurant_id: restaurant.id }, { onConflict: "id" });
      if (profileError) throw profileError;
    }

    router.push("/client/dashboard");
  };

  return (
    <>
      <Head>
        <title>Set up your kitchen — OptiMenu</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <OnboardingScreen
        NavLink={Link}
        onFinish={finishOnboarding}
        onUploadMenuPhotos={(files) => {
          console.warn("Menu photo upload has no AI recipe-draft pipeline wired — not implemented:", files);
        }}
        onSelectPos={async (key) => {
          if (key === "upload") return; // "I'll upload manually" — no OAuth, just continue the wizard
          if (!restaurantId) return;
          try {
            const { data: { session } } = await supabase.auth.getSession();
            const res = await fetch("/api/pos/oauth-start", {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
              body: JSON.stringify({ restaurantId, provider: key }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || "Could not start POS connection.");
            window.location.href = json.url;
          } catch (err) {
            console.error("[onboarding] POS connect failed:", err);
            window.alert(err.message || "Could not connect that POS right now.");
          }
        }}
        onUploadInvoices={async (files) => {
          if (!files || !files.length || !restaurantId) return;
          const { data: { session } } = await supabase.auth.getSession();
          if (!session) return;
          const { uploadInvoice, confirmDuplicateInvoice } = await import("../../lib/uploadInvoice");
          // No dedicated progress UI in this wizard step — logs progress and
          // surfaces only failures, unlike invoices.js's fuller status banner.
          for (const file of Array.from(files)) {
            try {
              const result = await uploadInvoice(file, restaurantId, session.access_token, (message) => {
                console.log(`[onboarding upload] ${file.name}: ${message}`);
              });
              if (result.status === "duplicate") {
                const merge = window.confirm(
                  `${file.name} looks like invoice #${result.existing.existing_number}, already on file. Add to that invoice? (Cancel = save as new)`
                );
                await confirmDuplicateInvoice(result.parseResult, restaurantId, session.access_token, merge);
              }
            } catch (err) {
              console.error("[onboarding] Invoice upload failed:", err);
              window.alert(`${file.name}: ${err.message}`);
            }
          }
        }}
      />
    </>
  );
}
