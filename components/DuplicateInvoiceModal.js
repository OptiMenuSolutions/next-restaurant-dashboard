// components/DuplicateInvoiceModal.js
// Replaces window.confirm() for the "this looks like a duplicate invoice"
// decision — a native browser dialog looked jarring and out of place next
// to the rest of the app's own styled modals. Used from both
// pages/client/invoices.js and pages/client/onboarding.js, since both call
// through the same lib/uploadInvoice.js duplicate-detection flow.

const DIM_CSS = `
  @keyframes dim-up { from { transform: translateY(100%); } to { transform: translateY(0); } }
  @media (max-width: 900px) {
    .dim-overlay { align-items: flex-end !important; padding: 0 !important; }
    .dim-panel {
      max-width: none !important; border-radius: 18px 18px 0 0 !important; border-bottom: none !important;
      padding: 12px 20px calc(20px + env(safe-area-inset-bottom)) !important;
      animation: dim-up .22s ease;
    }
    .dim-panel::before {
      content: ""; display: block; width: 36px; height: 4px; border-radius: 2px;
      background: var(--line, #d8dfe0); margin: 0 auto 16px;
    }
    .dim-title { font-size: 17px !important; }
    .dim-body { font-size: 15px !important; }
    .dim-actions { flex-direction: column-reverse; gap: 8px !important; }
    .dim-btn { min-height: 50px; font-size: 16px !important; border-radius: 12px !important; }
  }
`;

export default function DuplicateInvoiceModal({ fileName, existing, onMerge, onSaveNew }) {
  return (
    <div className="dim-overlay" style={{ position: "fixed", inset: 0, zIndex: 600, background: "rgba(17,24,25,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <style>{DIM_CSS}</style>
      <div className="dim-panel" style={{ width: "100%", maxWidth: 440, background: "var(--shell,#fff)", border: "1px solid var(--line,#d8dfe0)", borderRadius: 14, boxShadow: "0 24px 60px rgba(17,24,25,0.25)", padding: "22px 24px", fontFamily: "'Manrope',sans-serif" }}>
        <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10.5, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--accent-deep,#03808f)", marginBottom: 8 }}>
          Possible duplicate
        </div>
        <div className="dim-title" style={{ fontSize: 15, fontWeight: 700, color: "var(--text,#111819)", marginBottom: 10, lineHeight: 1.4, wordBreak: "break-word" }}>
          {fileName} looks like invoice #{existing?.existing_number}
        </div>
        <div className="dim-body" style={{ fontSize: 13.5, color: "var(--muted,#4b585b)", lineHeight: 1.55, marginBottom: 22 }}>
          Already on file from {existing?.existing_supplier}, dated {existing?.existing_date}. Add these items to that
          same invoice, or save this as a separate new one?
        </div>
        <div className="dim-actions" style={{ display: "flex", gap: 10 }}>
          <button
            type="button"
            onClick={onSaveNew}
            className="dim-btn"
            style={{ flex: 1, padding: "11px 14px", borderRadius: 8, border: "1px solid var(--line,#d8dfe0)", background: "none", color: "var(--text,#111819)", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}
          >
            Save as new
          </button>
          <button
            type="button"
            onClick={onMerge}
            className="dim-btn"
            style={{ flex: 1, padding: "11px 14px", borderRadius: 8, border: "none", background: "var(--accent,#02a4ba)", color: "#fff", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}
          >
            Add to that invoice
          </button>
        </div>
      </div>
    </div>
  );
}