import { useEffect, useState } from "react";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import supabase from "../../lib/supabaseClient";
import OnboardingScreen from "../../components/onboarding/OnboardingScreen";
import { enforceAccountGuard } from "../../lib/enforceAccountGuard";
import DuplicateInvoiceModal from "../../components/DuplicateInvoiceModal";
import { parseMenuFiles } from "../../lib/parseMenu";
import RecipeWorkspace, {
  recipeRequest,
} from "../../components/client/RecipeWorkspace";
import LeaveGuardModal from "../../components/LeaveGuardModal";
import { useLeaveGuard } from "../../lib/useLeaveGuard";
import { mutate } from "swr";

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
  const [recipeBusy, setRecipeBusy] = useState(false);
  const menuFlowActive = menuParsing || recipeBusy;

  async function parseMenuAndWaitForReview(files) {
    if (!restaurantId) {
      throw new Error(
        "Your account is still loading. Please try again."
      );
    }

    setMenuParseError("");
    setMenuParsing(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();

      const result = await parseMenuFiles(
        files,
        restaurantId,
        session?.access_token,
        { catalogOnly: true }
      );

      const workspace = await recipeRequest(restaurantId);

      await recipeRequest(restaurantId, {
        action: 'catalog',
        revision: workspace.revision,
        items: result.dishes,
      });
    } catch (error) {
      setMenuParseError(error.message);
      throw error;
    } finally {
      setMenuParsing(false);
    }
  }
  const [uploadStatus, setUploadStatus] = useState(null); // { message, detail } | null
  const [uploadError, setUploadError] = useState("");
  const [parsingInvoices, setParsingInvoices] = useState(false);

  // The menu step is already guarded above; the invoice step needs the same
  // protection while parsing or while the duplicate prompt is open.
  const invoiceFlowActive = parsingInvoices || !!duplicateModal;
  const leaveGuard = useLeaveGuard(menuFlowActive || invoiceFlowActive);

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

  const saveOnboardingStep = async (stepNumber, data) => {
    if (!restaurantId) {
      // Effect that loads restaurantId hasn't finished yet — throw rather
      // than silently no-op, so continueStep's catch blocks it from
      // advancing (and losing this step's data) instead of pretending it saved.
      throw new Error("Still setting up your account — please wait a moment and try again.");
    }
    const updates =
      stepNumber === 1
        ? {
            name: data.name, cuisine_type: data.cuisine, // `style` still has no column, same as before
            freezes_beef: !!data.freezesBeef,
            freezes_poultry: !!data.freezesPoultry,
            freezes_pork: !!data.freezesPork,
            freezes_seafood: !!data.freezesSeafood,
            freezes_bakery: !!data.freezesBakery,
          }
        : {
            shipping_address_line1: data.addrLine1,
            shipping_city: data.addrCity,
            shipping_state: data.addrState,
            shipping_zip: data.addrZip,
            // Name + address are the only two things actually required to use
            // the app (see enforceAccountGuard's requireOnboarding check) —
            // menu/invoices/POS on steps 3-5 are genuinely optional and can be
            // added later from their real pages. So this is the point
            // "onboarding" is considered done for gating purposes, not step 5.
            onboarding_completed_at: new Date().toISOString(),
          };
    const { error } = await supabase.from("restaurants").update(updates).eq("id", restaurantId);
    if (error) throw error;
  };

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

    // Refresh the shared account copy, so the dashboard sees the
    // subscription and finished onboarding instead of an older cached copy.
    // No redirect here: the wizard's "Your kitchen is set up" screen stays up
    // until the owner clicks Go to dashboard.
    await mutate("account");
  };

  return (
    <>
      <Head>
        <title>Set up your kitchen — OptiMenu</title>
      </Head>
      <OnboardingScreen
        NavLink={Link}
        onFinish={finishOnboarding}
        onSaveStep={saveOnboardingStep}
        skipHref="/client/dashboard?justOnboarded=true"
        doneHref="/client/dashboard?justOnboarded=true"
        onParseMenu={parseMenuAndWaitForReview}
        parsingMenu={menuParsing}
        recipeSetup={
          <RecipeWorkspace
            restaurantId={restaurantId}
            onBusyChange={setRecipeBusy}
          />
        }
        recipeBusy={recipeBusy}
        blockNavigation={menuFlowActive || invoiceFlowActive}
        onSelectPos={async (key) => {
          if (key === "upload") return; // "I'll upload manually" — no OAuth, just continue the wizard
          if (!restaurantId) return;
          try {
            const { data: { session } } = await supabase.auth.getSession();
            const res = await fetch("/api/pos/oauth-start", {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
              body: JSON.stringify({ restaurantId, provider: key, returnTo: "/client/dashboard?justOnboarded=true" }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || "Could not start POS connection.");
            window.location.href = json.url;
          } catch (err) {
            console.error("[onboarding] POS connect failed:", err);
            window.alert(err.message || "Could not connect that POS right now.");
          }
        }}
        onParseInvoices={async (files) => {
          if (!files || !files.length || !restaurantId) return;
          const { data: { session } } = await supabase.auth.getSession();
          if (!session) return;
          setUploadError("");
          setParsingInvoices(true);
          const { parseInvoiceBatch, groupParsedInvoices, saveParsedInvoice, confirmDuplicateInvoice } = await import("../../lib/uploadInvoice");

          const fileArr = Array.from(files);

          // Same speed change as invoices.js — parse every file at once,
          // since one file's OCR-and-Claude pipeline never depended on
          // another's. Only saving stays sequential (see below).
          setUploadStatus({ message: fileArr.length > 1 ? `Reading ${fileArr.length} files...` : `Reading ${fileArr[0].name}...`, detail: null });
          const parsed = await parseInvoiceBatch(fileArr, restaurantId, session.access_token, (i, fileName, message, detail) => {
            setUploadStatus({ message: fileArr.length > 1 ? `[${i + 1}/${fileArr.length}] ${fileName}: ${message}` : message, detail });
          });

          // Group by (supplier, invoice_number) — NOT "everything selected
          // together is one invoice". See groupParsedInvoices's own
          // comment in lib/uploadInvoice.js for the full reasoning.
          const groups = groupParsedInvoices(parsed);

          for (const group of groups) {
            let groupInvoiceId = null;
            for (const item of group.items) {
              if (item.error) {
                setUploadError(`${item.file.name}: ${item.error}`);
                continue;
              }
              try {
                setUploadStatus({ message: `Saving ${item.file.name}...`, detail: null });
                if (groupInvoiceId) {
                  const saved = await saveParsedInvoice(item.parseResult, item.publicUrl, restaurantId, session.access_token, groupInvoiceId);
                  groupInvoiceId = saved.invoiceId;
                } else if (item.parseResult.duplicate) {
                  const merge = await askDuplicateConfirm(item.file.name, item.parseResult.duplicate);
                  const saved = await confirmDuplicateInvoice(item.parseResult, item.publicUrl, restaurantId, session.access_token, merge);
                  groupInvoiceId = saved.invoiceId;
                } else {
                  const saved = await saveParsedInvoice(item.parseResult, item.publicUrl, restaurantId, session.access_token, null);
                  groupInvoiceId = saved.invoiceId;
                }
              } catch (err) {
                console.error("[onboarding] Invoice save failed:", err);
                setUploadError(`${item.file.name}: ${err.message}`);
              }
            }
          }
          setUploadStatus(null);
          setParsingInvoices(false);
        }}
        parsingInvoices={parsingInvoices}
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
      {/* Recipes are now configured inside the onboarding wizard. */}
      <LeaveGuardModal
        open={!!leaveGuard.pendingUrl}
        title="Your upload is still being processed"
        body="It hasn't been saved yet. If you leave now, you'll need to upload it again."
        onStay={leaveGuard.stay}
        onLeave={leaveGuard.leave}
      />
      {menuParseError && (
        <div style={{ position: "fixed", bottom: 16, right: 16, zIndex: 500, maxWidth: 340, background: "#faeae8", border: "1px solid #c4473e", borderRadius: 10, padding: "12px 16px", fontFamily: "'Manrope',sans-serif", fontSize: 13, color: "#c4473e", boxShadow: "0 10px 30px rgba(17,24,25,0.15)" }}>
          <div style={{ fontWeight: 700 }}>{menuParseError}</div>
        </div>
      )}
    </>
  );
}