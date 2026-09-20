export default function ReactivateAccountModal({ onConfirm, onCancel }) {
  return (
    <div
      onClick={onCancel}
      style={{ position: "fixed", inset: 0, background: "rgba(17,24,25,0.55)", zIndex: 700, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, fontFamily: "'Manrope',sans-serif" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 420, background: "#fff", border: "1px solid #d8dfe0", borderRadius: 14, boxShadow: "0 24px 60px rgba(17,24,25,0.25)", padding: "28px 26px" }}
      >
        <div style={{ fontSize: 18, fontWeight: 800, color: "#111819", marginBottom: 10 }}>
          Reactivate your account?
        </div>
        <div style={{ fontSize: 13.5, color: "#4b585b", lineHeight: 1.6, marginBottom: 24 }}>
          This account was deactivated. Your data is still here — reactivate to pick up where you left off?
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button
            type="button"
            onClick={onCancel}
            style={{ flex: 1, padding: "12px 16px", borderRadius: 10, border: "1px solid #d8dfe0", background: "none", color: "#111819", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}
          >
            Not now
          </button>
          <button
            type="button"
            onClick={onConfirm}
            style={{ flex: 1, padding: "12px 16px", borderRadius: 10, border: "none", background: "#02a4ba", color: "#fff", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}
          >
            Reactivate
          </button>
        </div>
      </div>
    </div>
  );
}