// OptiMenu-styled "leave anyway?" prompt used with lib/useLeaveGuard.
const LGM_CSS = `
  @keyframes lgm-up { from { transform: translateY(100%); } to { transform: translateY(0); } }
  @media (max-width: 900px) {
    .lgm-overlay { align-items: flex-end !important; padding: 0 !important; }
    .lgm-panel {
      max-width: none !important; border-radius: 18px 18px 0 0 !important; border-bottom: none !important;
      padding: 12px 20px calc(20px + env(safe-area-inset-bottom)) !important;
      animation: lgm-up .22s ease;
    }
    .lgm-panel::before {
      content: ""; display: block; width: 36px; height: 4px; border-radius: 2px;
      background: var(--line, #d8dfe0); margin: 0 auto 16px;
    }
    .lgm-body { font-size: 15px !important; }
    .lgm-actions { flex-direction: column-reverse; gap: 8px !important; }
    .lgm-btn { min-height: 50px; font-size: 16px !important; border-radius: 12px !important; }
  }
`;

export default function LeaveGuardModal({ open, title, body, onStay, onLeave }) {
  if (!open) return null;
  return (
    <div className="lgm-overlay" style={{ position: "fixed", inset: 0, zIndex: 700, background: "rgba(17,24,25,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <style>{LGM_CSS}</style>
      <div className="lgm-panel" style={{ width: "100%", maxWidth: 420, background: "var(--shell,#fff)", border: "1px solid var(--line,#d8dfe0)", borderRadius: 14, boxShadow: "0 24px 60px rgba(17,24,25,0.25)", padding: "26px 28px", fontFamily: "'Manrope',sans-serif" }}>
        <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10.5, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--accent-deep,#03808f)", marginBottom: 8 }}>
          Still working
        </div>
        <div style={{ fontSize: 17, fontWeight: 800, color: "var(--text,#111819)", marginBottom: 10, lineHeight: 1.35 }}>{title}</div>
        <div className="lgm-body" style={{ fontSize: 13.5, color: "var(--muted,#4b585b)", lineHeight: 1.55, marginBottom: 22 }}>{body}</div>
        <div className="lgm-actions" style={{ display: "flex", gap: 10 }}>
          <button type="button" className="lgm-btn" onClick={onLeave} style={{ flex: 1, padding: "12px 16px", borderRadius: 10, border: "1px solid var(--line,#d8dfe0)", background: "none", color: "#c4473e", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}>
            Leave anyway
          </button>
          <button type="button" className="lgm-btn" onClick={onStay} style={{ flex: 1, padding: "12px 16px", borderRadius: 10, border: "none", background: "var(--accent,#02a4ba)", color: "#fff", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}>
            Stay on this page
          </button>
        </div>
      </div>
    </div>
  );
}