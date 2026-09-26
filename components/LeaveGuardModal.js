// OptiMenu-styled "leave anyway?" prompt used with lib/useLeaveGuard.
export default function LeaveGuardModal({ open, title, body, onStay, onLeave }) {
  if (!open) return null;
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 700, background: "rgba(17,24,25,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ width: "100%", maxWidth: 420, background: "var(--shell,#fff)", border: "1px solid var(--line,#d8dfe0)", borderRadius: 14, boxShadow: "0 24px 60px rgba(17,24,25,0.25)", padding: "26px 28px", fontFamily: "'Manrope',sans-serif" }}>
        <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10.5, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--accent-deep,#03808f)", marginBottom: 8 }}>
          Still working
        </div>
        <div style={{ fontSize: 17, fontWeight: 800, color: "var(--text,#111819)", marginBottom: 10, lineHeight: 1.35 }}>{title}</div>
        <div style={{ fontSize: 13.5, color: "var(--muted,#4b585b)", lineHeight: 1.55, marginBottom: 22 }}>{body}</div>
        <div style={{ display: "flex", gap: 10 }}>
          <button type="button" onClick={onLeave} style={{ flex: 1, padding: "12px 16px", borderRadius: 10, border: "1px solid var(--line,#d8dfe0)", background: "none", color: "#c4473e", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}>
            Leave anyway
          </button>
          <button type="button" onClick={onStay} style={{ flex: 1, padding: "12px 16px", borderRadius: 10, border: "none", background: "var(--accent,#02a4ba)", color: "#fff", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}>
            Stay on this page
          </button>
        </div>
      </div>
    </div>
  );
}