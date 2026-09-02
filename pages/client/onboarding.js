import { useEffect, useState } from "react";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import supabase from "../../lib/supabaseClient";
import OnboardingScreen from "../../components/onboarding/OnboardingScreen";
import { enforceAccountGuard } from "../../lib/enforceAccountGuard";
import DuplicateInvoiceModal from "../../components/DuplicateInvoiceModal";
import { parseMenuFiles } from "../../lib/parseMenu";
import ParseReviewModal from "../../components/ParseReviewModal";

/**
 * pages/client/onboarding.js — data container.
 *
 * `create_restaurant_trigger` already created a restaurants row when the
 * profiles row was inserted at signup — this UPDATEs that row with the real
 * name/cuisine, rather than inserting a second one (which is what the
 * previous version of this file did, before the trigger was known about).
 *
 * `address` now has real, structured columns (shipping_address_line1,
 * shipping_city, shipping_state, shipping_zip) and gets saved — previously
 * dropped entirely, then briefly a single free-text column, now broken out
 * per the real design (this is also where the address field moved to —
 * step 2, "Pass tag", not step 1 — since it's specifically for shipping the
 * NFC tag).
 * `style` is still dropped — no column exists for it either; same situation
 * as address was, just not asked about yet.
 *
 * Now also enforces that a subscription exists before allowing onboarding
 * at all (this page had no guard whatsoever before) — obviously doesn't
 * require onboarding to already be finished, since that's what this page
 * is for.
 */
export default function OnboardingPage() {
  const router = useRouter();
  const [restaurantId, setRestaurantId] = useState(null);
  const [duplicateModal, setDuplicateModal] = useState(null);
  const [menuParsing, setMenuParsing] = useState(false);
  const [menuParseError, setMenuParseError] = useState("");
  const [menuReviewData, setMenuReviewData] = useState(null); // { dishes, ingredientLibrary, resolve } | null

  // Returns a promise that only resolves once the review is actually done
  // (committed or discarded) — this is what OnboardingScreen's continueStep
  // awaits before advancing past step 3, so the wizard can't move on mid-parse.
  function parseMenuAndWaitForReview(files) {
    return new Promise(async (resolve) => {
      if (!restaurantId) { resolve(); return; }
      setMenuParseError("");
      setMenuParsing(true);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const result = await parseMenuFiles(files, restaurantId, session?.access_token);
        setMenuParsing(false);
        setMenuReviewData({ ...result, resolve });
      } catch (err) {
        console.error("[onboarding] Menu parse failed:", err);
        // Don't trap them on step 3 over a failed parse — they can always
        // upload a menu later from the real Menu Items page. Show the error,
        // let them continue.
        setMenuParseError(err.message);
        setMenuParsing(false);
        resolve();
      }
    });
  }
  const [uploadStatus, setUploadStatus] = useState(null); // { message, detail } | null
  const [uploadError, setUploadError] = useState("");

  function askDuplicateConfirm(fileName, existing) {
    return new Promise((resolve) => {
      setDuplicateModal({
        fileName,
        existing,
        onMerge: () => { setDuplicateModal(null); resolve(true); },
        onSaveNew: () => { setDuplicateModal(null); resolve(false); },
      });
    });
  }

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile } = await supabase
        .from("profiles").select("restaurant_id").eq("id", user.id).single();
      if (!profile?.restaurant_id) return;

      const rest = await enforceAccountGuard(supabase, router, profile.restaurant_id, { requireOnboarding: false });
      if (!rest) return;

      setRestaurantId(profile.restaurant_id);
    })();
  }, []);

  const finishOnboarding = async ({ name, addrLine1, addrCity, addrState, addrZip, style, cuisine }) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push("/client/login"); return; }

    const { data: profile } = await supabase
      .from("profiles").select("restaurant_id").eq("id", user.id).single();

    if (profile?.restaurant_id) {
      const { error } = await supabase
        .from("restaurants")
        .update({
          name,
          shipping_address_line1: addrLine1,
          shipping_city: addrCity,
          shipping_state: addrState,
          shipping_zip: addrZip,
          cuisine_type: cuisine,
          onboarding_completed_at: new Date().toISOString(),
        })
        .eq("id", profile.restaurant_id);
      if (error) throw error;
    } else {
      // Defensive fallback only — shouldn't normally happen. If it does,
      // the profiles row itself never got created (see signup.js/login.js's
      // comments on the email-confirmation timing case), so the trigger
      // never fired. Create both explicitly rather than fail here.
      const { data: restaurant, error: restError } = await supabase
        .from("restaurants")
        .insert({
          name,
          user_id: user.id,
          shipping_address_line1: addrLine1,
          shipping_city: addrCity,
          shipping_state: addrState,
          shipping_zip: addrZip,
          cuisine_type: cuisine,
          onboarding_completed_at: new Date().toISOString(),
        })
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
        onParseMenu={parseMenuAndWaitForReview}
        parsingMenu={menuParsing}
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
          setUploadError("");
          const { uploadInvoice, confirmDuplicateInvoice } = await import("../../lib/uploadInvoice");
          // Same batching rule as invoices.js — files selected together in
          // one action are pages of one invoice, regardless of what each
          // page's own OCR reads for its invoice number.
          let batchInvoiceId = null;
          for (const file of Array.from(files)) {
            try {
              setUploadStatus({ message: `Uploading ${file.name}...`, detail: null });
              const result = await uploadInvoice(
                file, restaurantId, session.access_token,
                (message, detail) => setUploadStatus({ message, detail }),
                batchInvoiceId
              );
              if (result.status === "duplicate") {
                const merge = await askDuplicateConfirm(file.name, result.existing);
                const saved = await confirmDuplicateInvoice(result.parseResult, restaurantId, session.access_token, merge);
                batchInvoiceId = saved.invoiceId;
              } else if (result.status === "saved") {
                batchInvoiceId = result.invoiceId;
              }
            } catch (err) {
              console.error("[onboarding] Invoice upload failed:", err);
              setUploadError(`${file.name}: ${err.message}`);
            }
          }
          setUploadStatus(null);
        }}
      />
      {(uploadStatus || uploadError) && (
        <div
          style={{
            position: "fixed", bottom: 16, right: 16, zIndex: 500, maxWidth: 340,
            background: uploadError ? "#faeae8" : "#e8f7f9",
            border: `1px solid ${uploadError ? "#c4473e" : "#02a4ba"}`,
            borderRadius: 10, padding: "12px 16px", fontFamily: "'Manrope',sans-serif",
            fontSize: 13, color: uploadError ? "#c4473e" : "#03808f", boxShadow: "0 10px 30px rgba(17,24,25,0.15)",
          }}
        >
          {uploadError ? (
            <div style={{ fontWeight: 700 }}>{uploadError}</div>
          ) : (
            <>
              <div style={{ fontWeight: 700 }}>{uploadStatus.message}</div>
              {uploadStatus.detail && <div style={{ fontSize: 11.5, marginTop: 3, opacity: 0.85 }}>{uploadStatus.detail}</div>}
            </>
          )}
        </div>
      )}
      {duplicateModal && (
        <DuplicateInvoiceModal
          fileName={duplicateModal.fileName}
          existing={duplicateModal.existing}
          onMerge={duplicateModal.onMerge}
          onSaveNew={duplicateModal.onSaveNew}
        />
      )}
      {menuReviewData && (
        <ParseReviewModal
          dishes={menuReviewData.dishes}
          ingredientLibrary={menuReviewData.ingredientLibrary}
          restaurantId={restaurantId}
          onCommitted={() => { menuReviewData.resolve?.(); setMenuReviewData(null); }}
          onClose={() => { menuReviewData.resolve?.(); setMenuReviewData(null); }}
        />
      )}
      {menuParseError && (
        <div style={{ position: "fixed", bottom: 16, right: 16, zIndex: 500, maxWidth: 340, background: "#faeae8", border: "1px solid #c4473e", borderRadius: 10, padding: "12px 16px", fontFamily: "'Manrope',sans-serif", fontSize: 13, color: "#c4473e", boxShadow: "0 10px 30px rgba(17,24,25,0.15)" }}>
          <div style={{ fontWeight: 700 }}>{menuParseError}</div>
        </div>
      )}
    </>
  );
}