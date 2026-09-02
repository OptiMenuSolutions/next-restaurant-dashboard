import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import supabase from "../../lib/supabaseClient";
import InvoicesScreen from "../../components/client/InvoicesScreen";
import { FONT_LINKS } from "../../components/client/ClientChrome";
import TourOverlay from "../../components/TourOverlay";
import { useTour } from "../../lib/useTour";
import UniversalSearch from "../../components/UniversalSearch";
import { enforceAccountGuard } from "../../lib/enforceAccountGuard";
import DuplicateInvoiceModal from "../../components/DuplicateInvoiceModal";

/**
 * pages/client/invoices.js — invoices screen, v5 shell.
 *
 * Data container only. Same auth guard and same queries as the current
 * pages/client/invoices.js (invoices list, then invoice_items + ingredients for
 * the selected invoice); all markup lives in
 * components/client/InvoicesScreen.js.
 *
 * NOT carried over from the old page: the upload / OCR pipeline. `handleFiles`
 * below is a placeholder — paste the existing uploader body into it (see
 * README-screens.md).
 */

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function shortDate(iso) {
  if (!iso) return "—";
  const [y, m, d] = String(iso).split("T")[0].split("-").map(Number);
  if (!y) return String(iso);
  return `${MONTHS[(m || 1) - 1].toUpperCase()} ${d}`;
}
const yearOf = (iso) => (iso ? Number(String(iso).split("-")[0]) : new Date().getFullYear());

/* invoices row -> screen invoice. `status` mirrors the old page's logic:
   processed once the OCR run has both a number and an amount. */
function toInvoice(row) {
  const processed = row.processed === true || (row.number && row.amount != null);
  const flagged = row.needs_review === true || row.status === "review";
  return {
    id: row.id,
    number: row.number || null,
    file: row.file_name || (row.file_url ? String(row.file_url).split("/").pop() : ""),
    fileUrl: row.file_url || null,
    supplier: row.supplier || "Unknown supplier",
    date: shortDate(row.date),
    year: yearOf(row.date),
    isoDate: row.date || null,
    amount: row.amount == null ? null : Math.round(parseFloat(row.amount) * 100) / 100,
    status: flagged ? "review" : processed ? "processed" : "pending",
    items: [],
  };
}

/* invoice_items row -> receipt line. */
function toLine(row) {
  const unit = row.unit || (row.ingredients && row.ingredients.unit) || "";
  return {
    name: row.item_name || row.name || "Item",
    qty: [row.quantity, unit].filter(Boolean).join(" ") || "1",
    unitCost: Number(row.unit_cost != null ? row.unit_cost : row.amount) || 0,
    link: row.ingredients ? row.ingredients.name : null,
  };
}

const NavLink = ({ href, style, className, children }) => (
  <Link href={href} style={style} className={className}>{children}</Link>
);

export default function InvoicesPage() {
  const tour = useTour("invoices");
  const router = useRouter();
  const fileInput = useRef(null);

  const signOut = async () => {
    await supabase.auth.signOut();
    router.push("/client/login");
  };

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [restaurantId, setRestaurantId] = useState(null);
  const [restaurantName, setRestaurantName] = useState("");
  const [userName, setUserName] = useState("");
  const [invoices, setInvoices] = useState([]);
  const [lines, setLines] = useState({}); // invoiceId -> line items

  const loadInvoices = useCallback(async (restId) => {
    const { data, error: qErr } = await supabase
      .from("invoices")
      .select("*")
      .eq("restaurant_id", restId)
      .order("date", { ascending: false, nullsFirst: false })
      .limit(1000);
    if (qErr) throw qErr;
    setInvoices((data || []).map(toInvoice));
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { router.push("/client/login"); return; }

        const { data: profile } = await supabase
          .from("profiles").select("restaurant_id, full_name").eq("id", user.id).single();
        if (!profile?.restaurant_id) { setLoading(false); return; }
        if (cancelled) return;

        setRestaurantId(profile.restaurant_id);
        setUserName(profile.full_name || "");

        const rest = await enforceAccountGuard(supabase, router, profile.restaurant_id);
        if (!rest) return;
        if (!cancelled) setRestaurantName(rest?.name || "");

        await loadInvoices(profile.restaurant_id);
      } catch (e) {
        if (!cancelled) setError(e.message || "Could not load your invoices");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [router, loadInvoices]);

  /* Line items are fetched lazily when a row is selected — same two queries the
     old detail page ran, minus the ocr_text fetch (not shown in this design). */
  const handleSelect = useCallback(async (invoice) => {
    if (!invoice || lines[invoice.id]) return;
    const { data } = await supabase
      .from("invoice_items")
      .select("*, ingredients(name, unit)")
      .eq("invoice_id", invoice.id)
      .order("item_name");
    setLines((prev) => ({ ...prev, [invoice.id]: (data || []).map(toLine) }));
  }, [lines]);

  /* Pre-load the first invoice's lines so the receipt is never blank. */
  useEffect(() => {
    if (invoices.length) handleSelect(invoices[0]);
  }, [invoices, handleSelect]);

  const withLines = useMemo(
    () => invoices.map((v) => ({ ...v, items: lines[v.id] || v.items })),
    [invoices, lines]
  );

  const now = new Date();
  const monthLabel = now.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const lastUpload = invoices[0]?.isoDate
    ? "Last invoice " + new Date(invoices[0].isoDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : "";

  const initials = (userName || "Chef")
    .split(" ").map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();

  const [uploadStatus, setUploadStatus] = useState(null); // { message, detail } | null
  const [searchOpen, setSearchOpen] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [duplicateModal, setDuplicateModal] = useState(null);

  // Promise-based stand-in for what window.confirm() used to do
  // synchronously — resolves once the person clicks a button on the real
  // in-app modal instead of a native browser dialog.
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

  async function handleFiles(fileList) {
    if (!fileList || !fileList.length || !restaurantId) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    setUploadError("");
    const { parseInvoiceBatch, groupParsedInvoices, saveParsedInvoice, confirmDuplicateInvoice } = await import("../../lib/uploadInvoice");

    const files = Array.from(fileList);

    // Parse every file at once — this is the actual speed change. One
    // file's OCR-and-Claude pipeline never depended on another's; only
    // SAVING has an order dependency (a continuation page needs to know
    // the first page's resulting invoice id), so that part stays
    // sequential below, after all parsing is already done.
    setUploadStatus({ message: files.length > 1 ? `Reading ${files.length} files...` : `Reading ${files[0].name}...`, detail: null });
    const parsed = await parseInvoiceBatch(files, restaurantId, session.access_token, (i, fileName, message, detail) => {
      setUploadStatus({ message: files.length > 1 ? `[${i + 1}/${files.length}] ${fileName}: ${message}` : message, detail });
    });

    // Group by (supplier, invoice_number) — NOT "everything selected
    // together is one invoice". A batch can be several pages of one
    // invoice, several separate invoices, or a mix of both; see
    // groupParsedInvoices's own comment in lib/uploadInvoice.js for the
    // full reasoning. Each group gets its own independent save: the first
    // successfully-parsed file in a group can trigger the "this looks like
    // a duplicate of something already on file" prompt; every file after
    // it in that SAME group always appends into whatever invoice resulted.
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
          console.error("[invoices] Save failed:", err);
          setUploadError(`${item.file.name}: ${err.message}`);
        }
      }
    }

    setUploadStatus(null);
    await loadInvoices(restaurantId);
  }

  return (
    <>
      <Head>
        <title>Invoices · OptiMenu</title>
        {FONT_LINKS}
      </Head>
      <input
        ref={fileInput}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png,.heic"
        multiple
        style={{ display: "none" }}
        onChange={(e) => handleFiles(e.target.files)}
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
      <InvoicesScreen
        invoices={withLines}
        loading={loading}
        error={error}
        onRetry={() => router.reload()}
        onUpload={() => fileInput.current && fileInput.current.click()}
        onSelect={handleSelect}
        onOpen={(v) => router.push(`/client/invoices/${v.id}`)}
        onFlag={(v) => router.push(`/client/invoices/${v.id}?flag=1`)}
        onSearch={() => setSearchOpen(true)}
        onSignOut={signOut}
        restaurantName={restaurantName || "Your restaurant"}
        periodLabel={monthLabel}
        lastUploadLabel={lastUpload}
        user={{ initials: initials || "MR", firstName: (userName || "").split(" ")[0] || "Chef" }}
        NavLink={NavLink}
      />
      {tour.active && <TourOverlay tour={tour} />}

      <UniversalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
    </>
  );
}