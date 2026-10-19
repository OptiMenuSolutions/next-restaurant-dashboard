import { useCallback, useEffect, useState } from "react";
import supabase from "../../lib/supabaseClient";

/**
 * ScannersCard — Profile › Restaurant tab. The owner's list of invoice
 * scanners: staff who scan invoices from their own phone and see nothing
 * else. Add a scanner makes a 6-digit code the owner sends from their own
 * phone (share menu: Messages, WhatsApp, email). Loads its own data from
 * /api/scanners, so profile.js does not pass anything in.
 *
 * Props: card, cardHead (the Profile card styles), isMobile
 */

const MONO = "'IBM Plex Mono',monospace";
const SITE = "https://www.opti-menu.com";

const spaced = (code) => `${String(code).slice(0, 3)} ${String(code).slice(3)}`;
const shortDate = (iso) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

function inviteMessage(restaurantName, code) {
  return `${restaurantName || "Your restaurant"} added you to scan invoices in OptiMenu. Open ${SITE}/join/${code} on your phone, or in the OptiMenu app tap I have a scanner code and enter ${spaced(code)}. The code works once and expires in 7 days.`;
}

async function api(method, body) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch("/api/scanners", {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "Something went wrong. Please try again.");
  return json;
}

export default function ScannersCard({ card, cardHead, isMobile }) {
  const [data, setData] = useState(null); // { restaurantName, scanners, invites }
  const [error, setError] = useState("");
  const [modal, setModal] = useState(null); // { step: "name" | "code", invite? }
  const [confirmRemove, setConfirmRemove] = useState(null);
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    try { setData(await api("GET")); setError(""); }
    catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const act = async (key, body, after) => {
    setBusy(key);
    setError("");
    try {
      const json = await api("POST", body);
      if (after) after(json);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  const linkBtn = (color) => ({ background: "none", border: "none", padding: isMobile ? "8px 4px" : 0, fontSize: 12.5, fontWeight: 700, color, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" });
  const avatar = (pending) => ({ width: 38, height: 38, borderRadius: "50%", background: pending ? "var(--panel)" : "var(--accent)", color: pending ? "var(--muted)" : "#fff", border: pending ? "1.5px dashed var(--line)" : "none", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800, flexShrink: 0 });
  const row = { display: "flex", alignItems: "center", gap: 12, padding: "14px 18px", borderTop: "1px solid var(--line-soft)" };

  const scanners = data?.scanners || [];
  const invites = data?.invites || [];

  return (
    <div style={{ ...card, marginBottom: 20 }}>
      <div style={{ ...cardHead, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, borderBottom: "none" }}>
        <span>Invoice scanners</span>
        <span style={{ color: "var(--accent-deep)", fontSize: 10 }}>Included in your plan</span>
      </div>
      <div style={{ padding: "0 18px 14px", fontSize: 13, color: "var(--muted)", lineHeight: 1.55 }}>
        Whoever receives your deliveries can scan invoices from their own phone. They see their own scans and nothing else in OptiMenu.
      </div>

      {error && (
        <div role="alert" style={{ margin: "0 18px 12px", padding: "10px 12px", borderRadius: 8, fontSize: 12.5, background: "var(--red-tint, #faeae8)", border: "1px solid var(--red)", color: "var(--red)" }}>{error}</div>
      )}

      {!data && !error && (
        <div style={{ ...row, color: "var(--faint)", fontFamily: MONO, fontSize: 10.5, letterSpacing: "0.12em" }}>LOADING…</div>
      )}

      {scanners.map((s) => (
        <div key={s.id} style={{ ...row, flexWrap: confirmRemove === s.id ? "wrap" : "nowrap" }}>
          <span style={avatar(false)}>{(s.name[0] || "?").toUpperCase()}</span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: "block", fontSize: 14.5, fontWeight: 700 }}>{s.name}</span>
            <span style={{ display: "block", fontSize: 12, color: "var(--faint)", marginTop: 2 }}>
              Joined {shortDate(s.joinedAt)} · {s.monthScans} scan{s.monthScans === 1 ? "" : "s"} this month
              {s.needsRetake > 0 && <span style={{ color: "var(--amber)" }}> · {s.needsRetake} photo{s.needsRetake === 1 ? "" : "s"} to retake</span>}
            </span>
          </span>
          {confirmRemove === s.id ? (
            <span style={{ display: "flex", alignItems: "center", gap: 14, flexBasis: isMobile ? "100%" : "auto", justifyContent: "flex-end", fontSize: 12.5 }}>
              <span style={{ color: "var(--muted)" }}>Their phone stops scanning right away.</span>
              <button type="button" disabled={!!busy} style={linkBtn("var(--red)")} onClick={() => act("remove-" + s.id, { action: "remove", scanner_id: s.id }, () => setConfirmRemove(null))}>
                {busy === "remove-" + s.id ? "Removing…" : "Remove"}
              </button>
              <button type="button" style={linkBtn("var(--faint)")} onClick={() => setConfirmRemove(null)}>Keep</button>
            </span>
          ) : (
            <button type="button" style={linkBtn("var(--red)")} onClick={() => setConfirmRemove(s.id)}>Remove</button>
          )}
        </div>
      ))}

      {invites.map((inv) => (
        <div key={inv.id} style={row}>
          <span style={avatar(true)}>{(inv.name[0] || "?").toUpperCase()}</span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: "block", fontSize: 14.5, fontWeight: 700 }}>{inv.name}</span>
            <span style={{ display: "block", fontSize: 12, color: "var(--faint)", marginTop: 2 }}>
              Invite sent {shortDate(inv.createdAt)} · expires {shortDate(inv.expiresAt)}
            </span>
          </span>
          <span style={{ display: "flex", gap: 16 }}>
            <button type="button" disabled={!!busy} style={linkBtn("var(--accent-deep)")} onClick={() => act("resend-" + inv.id, { action: "resend", invite_id: inv.id }, (j) => setModal({ step: "code", invite: j.invite }))}>
              {busy === "resend-" + inv.id ? "…" : "Resend"}
            </button>
            <button type="button" disabled={!!busy} style={linkBtn("var(--faint)")} onClick={() => act("cancel-" + inv.id, { action: "cancel", invite_id: inv.id })}>Cancel</button>
          </span>
        </div>
      ))}

      <div style={{ padding: "14px 18px", borderTop: "1px solid var(--line-soft)" }}>
        <button type="button" onClick={() => setModal({ step: "name" })} style={{ display: "inline-flex", alignItems: "center", gap: 8, height: 40, padding: "0 16px", borderRadius: 20, border: "none", background: "var(--accent)", color: "#fff", fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          Add a scanner
        </button>
      </div>

      {modal && (
        <InviteModal
          isMobile={isMobile}
          restaurantName={data?.restaurantName}
          initial={modal}
          onClose={() => { setModal(null); load(); }}
        />
      )}
    </div>
  );
}

function InviteModal({ isMobile, restaurantName, initial, onClose }) {
  const [step, setStep] = useState(initial.step);
  const [invite, setInvite] = useState(initial.invite || null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [canShare, setCanShare] = useState(false);
  useEffect(() => { setCanShare(typeof navigator !== "undefined" && !!navigator.share); }, []);

  const create = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const json = await api("POST", { action: "invite", name: name.trim() });
      setInvite(json.invite);
      setStep("code");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const message = invite ? inviteMessage(restaurantName, invite.code) : "";

  const copy = async () => {
    try { await navigator.clipboard.writeText(message); setCopied(true); setTimeout(() => setCopied(false), 2500); }
    catch { setError("Could not copy. Press and hold the message to copy it."); }
  };
  const share = async () => {
    try { await navigator.share({ text: message }); }
    catch (e) { if (e?.name !== "AbortError") copy(); }
  };

  const field = { width: "100%", height: 46, border: "1px solid var(--line)", borderRadius: 10, background: "var(--panel)", padding: "0 14px", fontSize: 16, color: "var(--text)", fontFamily: "inherit", outline: "none" };
  const primary = { flex: 1, height: 44, borderRadius: 22, border: "none", background: "var(--accent)", color: "#fff", fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, cursor: "pointer", fontFamily: "inherit" };
  const secondary = { flex: 1, height: 44, borderRadius: 22, border: "1px solid var(--line)", background: "none", color: "var(--text)", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(10,14,15,0.55)", zIndex: 100, display: "flex", alignItems: isMobile ? "flex-end" : "center", justifyContent: "center", padding: isMobile ? 0 : 20 }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" style={{ background: "var(--shell)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: isMobile ? "18px 18px 0 0" : 14, boxShadow: "var(--shadow-lg)", padding: isMobile ? "22px 18px calc(22px + env(safe-area-inset-bottom, 0px))" : "22px 22px 20px", width: "100%", maxWidth: isMobile ? "none" : 420 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.03em" }}>{step === "name" ? "Add an invoice scanner" : `Invite for ${invite?.name || ""}`}</div>
            <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4, lineHeight: 1.5 }}>They&rsquo;ll get a code to join from their own phone.</div>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} style={{ width: 36, height: 36, border: "none", background: "none", cursor: "pointer", color: "var(--muted)", fontSize: 20, lineHeight: 1 }}>&times;</button>
        </div>

        {step === "name" ? (
          <>
            <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--faint)", margin: "16px 0 6px" }}>Name</div>
            <input autoFocus value={name} maxLength={40} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") create(); }} placeholder="First name is fine" style={field} />
            <div style={{ fontSize: 12, color: "var(--faint)", marginTop: 6 }}>Shown on the invoices they scan.</div>
            {error && <div role="alert" style={{ fontSize: 12.5, color: "var(--red)", marginTop: 10 }}>{error}</div>}
            <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
              <button type="button" onClick={create} disabled={!name.trim() || busy} style={{ ...primary, opacity: name.trim() && !busy ? 1 : 0.5 }}>{busy ? "Making code…" : "Make their code"}</button>
            </div>
          </>
        ) : (
          <>
            <div style={{ marginTop: 18, border: "1px dashed var(--accent)", borderRadius: 12, background: "var(--accent-tint)", padding: 16, textAlign: "center" }}>
              <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--accent-deep)" }}>Scanner code</div>
              <div style={{ fontFamily: MONO, fontSize: 34, fontWeight: 500, letterSpacing: "0.12em", marginTop: 6 }}>{spaced(invite.code)}</div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>Works once · expires {shortDate(invite.expiresAt)}</div>
            </div>
            <div style={{ marginTop: 14, background: "var(--panel)", borderRadius: 10, padding: "12px 13px", fontSize: 12.5, lineHeight: 1.55, color: "var(--muted)", userSelect: "text" }}>
              <span style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.12em", color: "var(--faint)", display: "block", marginBottom: 4 }}>THE MESSAGE</span>
              {message}
            </div>
            {error && <div role="alert" style={{ fontSize: 12.5, color: "var(--red)", marginTop: 10 }}>{error}</div>}
            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              {canShare && (
                <button type="button" onClick={share} style={primary}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7" /><path d="M16 6l-4-4-4 4" /><path d="M12 2v13" /></svg>
                  Send invite
                </button>
              )}
              <button type="button" onClick={copy} style={canShare ? secondary : primary}>{copied ? "Copied" : "Copy invite"}</button>
            </div>
            <div style={{ fontSize: 11.5, color: "var(--faint)", textAlign: "center", marginTop: 10 }}>
              {canShare ? "Send invite opens your phone\u2019s share menu: Messages, WhatsApp, email." : "Paste it into a text or email to them."}
            </div>
          </>
        )}
      </div>
    </div>
  );
}