import { useCallback, useEffect, useRef, useState } from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import supabase from "../../lib/supabaseClient";
import { Shell, useTheme, FONT_LINKS, MONO, SANS } from "../../components/client/ClientChrome";

/**
 * pages/client/scan.js — the whole app for an invoice scanner.
 *
 * Home: their initials top right (opens their account sheet), a greeting,
 * their own two numbers, one big Scan button and today's scans.
 * Scanning: the camera opens; each photo becomes a page; Send uploads the
 * pages straight to storage and the server reads and saves them while the
 * thank-you screen shows. Today's list updates as each scan is read.
 *
 * A scanner never sees anything else from the restaurant. Every number here
 * comes from /api/scanner, which only returns their own scans.
 */

const Cam = ({ size = 20, color = "currentColor" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h1.8l1.4-2h6.6l1.4 2h1.8A2.5 2.5 0 0 1 21 8.5v9A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5z" /><circle cx="12" cy="13" r="3.6" />
  </svg>
);
const Check = ({ size = 14, color = "currentColor" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>
);

const timeOf = (iso) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); };
const greetingWord = () => { const h = new Date().getHours(); return h < 12 ? "Morning" : h < 17 ? "Afternoon" : "Evening"; };
const firstOf = (name) => String(name || "").trim().split(/\s+/)[0] || "";

/* Phone photos go up as JPEGs no wider than 2400px: much faster on a
   delivery-dock signal, and iPhone HEIC photos become something the reader
   understands. Falls back to the original file if the browser cannot draw it. */
async function toJpeg(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = url; });
    const scale = Math.min(1, 2400 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((ok) => canvas.toBlob(ok, "image/jpeg", 0.85));
    return blob || file;
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function ScanPage() {
  const router = useRouter();
  const [theme, toggleTheme] = useTheme();
  const dark = theme === "dark";
  const camera = useRef(null);

  const [token, setToken] = useState(null);
  const [me, setMe] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [removed, setRemoved] = useState(false);

  const [pages, setPages] = useState([]); // [{ blob, url }]
  const [retakeOf, setRetakeOf] = useState(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [done, setDone] = useState(null); // { pages, at, monthCount }
  const [sheet, setSheet] = useState(null); // "account" | "how" | null
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [leaving, setLeaving] = useState(false);

  // Only a scanner's email-less login belongs here.
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session?.user) { router.replace("/client/login"); return; }
      if (!session.user.is_anonymous) { router.replace("/client/dashboard"); return; }
      setToken(session.access_token);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session?.access_token) setToken(session.access_token);
    });
    return () => sub.subscription.unsubscribe();
  }, [router]);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`/api/scanner?since=${encodeURIComponent(startOfToday())}`, { headers: { Authorization: `Bearer ${token}` } });
      const json = await res.json().catch(() => ({}));
      if (res.status === 403 && json.removed) { setRemoved(true); return; }
      if (!res.ok) throw new Error(json.error || "Could not load your scans.");
      setMe(json);
      setLoadError("");
    } catch (e) {
      setLoadError(e.message || "Could not load your scans.");
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  // While a scan is being read, check back every few seconds.
  const anySending = !!me?.today?.some((s) => s.status === "sending");
  useEffect(() => {
    if (!anySending) return;
    const t = setInterval(load, 6000);
    return () => clearInterval(t);
  }, [anySending, load]);

  // Coming back to the app refreshes the list.
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [load]);

  const openCamera = (retakeId = null) => {
    setRetakeOf(retakeId);
    setSendError("");
    camera.current?.click();
  };

  const onPhotos = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length) return;
    setDone(null);
    const added = [];
    for (const f of files) {
      const blob = await toJpeg(f);
      added.push({ blob, url: URL.createObjectURL(blob) });
    }
    setPages((prev) => [...prev, ...added].slice(0, 10));
  };

  const clearPages = () => {
    pages.forEach((p) => URL.revokeObjectURL(p.url));
    setPages([]);
    setRetakeOf(null);
    setSendError("");
  };

  const send = async () => {
    if (!pages.length || sending) return;
    setSending(true);
    setSendError("");
    try {
      const res = await fetch("/api/scanner", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: "start", pages: pages.length, retake_of: retakeOf }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 403 && json.removed) { setRemoved(true); return; }
      if (!res.ok) throw new Error(json.error || "Could not send. Try again.");

      for (let i = 0; i < json.uploads.length; i++) {
        const { path, token: uploadToken } = json.uploads[i];
        const { error } = await supabase.storage.from("invoices").uploadToSignedUrl(path, uploadToken, pages[i].blob, { contentType: "image/jpeg" });
        if (error) throw new Error("A page did not upload. Check your signal and try again.");
      }

      // Reading takes a minute or two; it carries on while they see the
      // thank-you, and today's list shows it as Sending until it is done.
      fetch("/api/scanner/process", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ scan_id: json.scanId }),
        keepalive: false,
      }).then(load).catch(load);

      const stillSending = (me?.today || []).filter((s) => s.status === "sending").length;
      setDone({ pages: pages.length, at: new Date().toISOString(), monthCount: (me?.monthScans || 0) + stillSending + 1 });
      clearPages();
      load();
    } catch (e) {
      setSendError(e.message || "Could not send. Try again.");
    } finally {
      setSending(false);
    }
  };

  const leave = async () => {
    setLeaving(true);
    try {
      await fetch("/api/scanner", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: "leave" }),
      });
    } catch {}
    await supabase.auth.signOut({ scope: "local" });
    router.replace("/client/login");
  };

  const startOver = async () => {
    await supabase.auth.signOut({ scope: "local" });
    router.replace("/client/join");
  };

  const name = firstOf(me?.name);
  const initial = (name[0] || "•").toUpperCase();
  const today = me?.today || [];

  const cameraInput = (
    <input ref={camera} type="file" accept="image/*" capture="environment" multiple onChange={onPhotos} style={{ display: "none" }} />
  );

  const shellStyle = { position: "fixed", inset: 0, minHeight: 0, overflow: "hidden" };
  const page = (children) => (
    <>
      <Head>
        <title>Scan · OptiMenu</title>
        {FONT_LINKS}
      </Head>
      <Shell theme={theme} style={shellStyle}>
        {cameraInput}
        {children}
      </Shell>
    </>
  );

  const primaryBtn = { height: 52, borderRadius: 26, border: "none", background: "var(--accent)", color: "#fff", fontFamily: SANS, fontSize: 16, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 9, cursor: "pointer", boxShadow: "0 10px 24px rgba(2,164,186,0.28)", width: "100%" };
  const ghostBtn = { height: 50, borderRadius: 26, border: "1px solid var(--line)", background: "var(--shell)", color: "var(--text)", fontFamily: SANS, fontSize: 15, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, cursor: "pointer", width: "100%" };
  const column = { flex: 1, minHeight: 0, overflowY: "auto", width: "100%" };
  const inner = { width: "100%", maxWidth: 480, margin: "0 auto" };

  /* ── No longer on a restaurant ── */
  if (removed) {
    return page(
      <div style={{ ...column, background: "var(--shell)", display: "flex" }}>
        <div style={{ ...inner, padding: "calc(60px + env(safe-area-inset-top, 0px)) 28px calc(36px + env(safe-area-inset-bottom, 0px))", display: "flex", flexDirection: "column", textAlign: "center", alignItems: "center" }}>
          <div style={{ flex: 1 }} />
          <div style={{ width: 64, height: 64, borderRadius: 18, background: "var(--panel)", display: "flex", alignItems: "center", justifyContent: "center" }}><Cam size={30} color="var(--muted)" /></div>
          <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.035em", marginTop: 20 }}>This phone isn&rsquo;t scanning for a restaurant</div>
          <div style={{ fontSize: 14.5, color: "var(--muted)", lineHeight: 1.55, marginTop: 10, maxWidth: 320 }}>If that&rsquo;s a mistake, ask your manager for a new scanner code.</div>
          <div style={{ flex: 1.2 }} />
          <button type="button" onClick={startOver} style={primaryBtn}>Enter a new code</button>
        </div>
      </div>
    );
  }

  /* ── Pages ready to send ── */
  if (pages.length) {
    return page(
      <>
        <div style={{ flexShrink: 0, padding: "env(safe-area-inset-top, 0px) 8px 0", height: "calc(56px + env(safe-area-inset-top, 0px))", display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", background: "var(--shell)", borderBottom: "1px solid var(--line)" }}>
          <button type="button" onClick={clearPages} disabled={sending} style={{ justifySelf: "start", minHeight: 44, padding: "0 10px", background: "none", border: "none", fontFamily: SANS, fontSize: 14, fontWeight: 600, color: "var(--accent-deep)", cursor: "pointer" }}>Cancel</button>
          <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: "0.14em", color: "var(--muted)" }}>{pages.length} PAGE{pages.length === 1 ? "" : "S"}</div>
          <span />
        </div>
        <div style={{ ...column, background: "var(--panel)" }}>
          <div style={{ ...inner, padding: "20px 16px calc(28px + env(safe-area-inset-bottom, 0px))", display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.035em" }}>Every page in?</div>
              <div style={{ fontSize: 14, color: "var(--muted)", lineHeight: 1.5, marginTop: 4 }}>Add each page of the invoice, then send. More than one invoice in one go is fine too.</div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
              {pages.map((p, i) => (
                <div key={p.url} style={{ position: "relative", aspectRatio: "3 / 4", borderRadius: 10, overflow: "hidden", background: "var(--shell)", border: "1px solid var(--line)" }}>
                  <img src={p.url} alt={`Page ${i + 1}`} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                  <span style={{ position: "absolute", left: 6, bottom: 6, fontFamily: MONO, fontSize: 10, letterSpacing: "0.08em", color: "#fff", background: "rgba(17,24,25,0.7)", borderRadius: 8, padding: "2px 7px" }}>P{i + 1}</span>
                  {!sending && (
                    <button type="button" aria-label={`Remove page ${i + 1}`} onClick={() => { URL.revokeObjectURL(p.url); setPages((prev) => prev.filter((x) => x !== p)); }} style={{ position: "absolute", right: 4, top: 4, width: 30, height: 30, borderRadius: "50%", border: "none", background: "rgba(17,24,25,0.7)", color: "#fff", fontSize: 16, lineHeight: 1, cursor: "pointer" }}>&times;</button>
                  )}
                </div>
              ))}
              {pages.length < 10 && !sending && (
                <button type="button" onClick={() => camera.current?.click()} style={{ aspectRatio: "3 / 4", borderRadius: 10, border: "1.5px dashed var(--accent)", background: "var(--accent-tint)", color: "var(--accent-deep)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, fontFamily: SANS, fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
                  <Cam size={22} color="var(--accent-deep)" />Add page
                </button>
              )}
            </div>
            {sendError && (
              <div role="alert" style={{ padding: "12px 14px", borderRadius: 10, border: "1px solid var(--red)", background: "color-mix(in srgb, var(--red) 8%, var(--shell))", color: "var(--red)", fontSize: 13.5, lineHeight: 1.5 }}>{sendError}</div>
            )}
            <button type="button" onClick={send} disabled={sending} style={{ ...primaryBtn, opacity: sending ? 0.7 : 1, marginTop: 4 }}>
              {sending ? "Sending…" : `Send ${pages.length} page${pages.length === 1 ? "" : "s"}`}
            </button>
          </div>
        </div>
      </>
    );
  }

  /* ── Thank-you after a send ── */
  if (done) {
    return page(
      <div style={{ ...column, display: "flex", background: "linear-gradient(180deg, var(--accent-tint) 0%, var(--shell) 55%)" }}>
        <div style={{ ...inner, padding: "calc(30px + env(safe-area-inset-top, 0px)) 26px calc(36px + env(safe-area-inset-bottom, 0px))", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
          <div style={{ flex: 1 }} />
          <div style={{ position: "relative", width: 132, height: 132, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "var(--accent)", opacity: 0.12 }} />
            <span style={{ position: "absolute", inset: 18, borderRadius: "50%", background: "var(--accent)", opacity: 0.2 }} />
            <span style={{ width: 76, height: 76, borderRadius: "50%", background: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 12px 28px rgba(2,164,186,0.4)" }}><Check size={38} color="#fff" /></span>
          </div>
          <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-0.04em", marginTop: 26 }}>Got it{name ? `, ${name}` : ""}.</div>
          <div style={{ fontSize: 15.5, color: "var(--muted)", lineHeight: 1.55, marginTop: 10, maxWidth: 290 }}>Thanks. Every invoice you scan keeps tonight&rsquo;s specials accurate.</div>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, marginTop: 22, padding: "7px 14px", borderRadius: 20, background: "var(--shell)", border: "1px solid var(--line)", fontFamily: MONO, fontSize: 11, letterSpacing: "0.06em", color: "var(--muted)" }}>
            {done.pages} PAGE{done.pages === 1 ? "" : "S"} SENT · {timeOf(done.at).toUpperCase()}
          </div>
          <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: "0.06em", color: "var(--accent-deep)", marginTop: 12 }}>THAT&rsquo;S {done.monthCount} THIS MONTH</div>
          <div style={{ flex: 1.2 }} />
          <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 10 }}>
            <button type="button" onClick={() => openCamera()} style={primaryBtn}><Cam size={18} color="#fff" />Scan another</button>
            <button type="button" onClick={() => setDone(null)} style={ghostBtn}>Done</button>
          </div>
        </div>
      </div>
    );
  }

  /* ── Home ── */
  const dateKicker = new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }).toUpperCase().replace(",", " ·");
  const stat = (value, label) => (
    <div style={{ background: "var(--shell)", border: "1px solid var(--line)", borderRadius: 12, padding: "12px 14px" }}>
      <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.04em" }}>{value}</div>
      <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.1em", color: "var(--faint)", marginTop: 2 }}>{label}</div>
    </div>
  );
  const monthShort = new Date().toLocaleDateString("en-US", { month: "short" }).toUpperCase();

  return page(
    <>
      {/* Header: same as the main platform, initials top right. */}
      <div style={{ flexShrink: 0, background: "var(--shell)", padding: "calc(12px + env(safe-area-inset-top, 0px)) 16px 12px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <img src={dark ? "/landing/logo-knockout.png" : "/landing/logo.png"} alt="optiMenu" style={{ height: 22, width: "auto" }} />
        <button type="button" aria-label="Account" onClick={() => setSheet("account")} style={{ width: 34, height: 34, borderRadius: "50%", background: "var(--accent)", color: "#fff", border: "none", boxShadow: sheet ? "0 0 0 2px var(--shell), 0 0 0 4px var(--accent)" : "none", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: SANS, fontSize: 13, fontWeight: 700, cursor: "pointer", padding: 0 }}>
          {initial}
        </button>
      </div>

      <div className="om-mscroll" style={{ ...column, background: "var(--panel)" }}>
        <div style={{ ...inner, padding: "22px 16px calc(30px + env(safe-area-inset-bottom, 0px))", display: "flex", flexDirection: "column", gap: 18 }}>
          {loadError && !me && (
            <div role="alert" style={{ padding: "12px 14px", borderRadius: 10, border: "1px solid var(--red)", color: "var(--red)", fontSize: 13.5, lineHeight: 1.5, background: "var(--shell)" }}>
              {loadError} <button type="button" onClick={load} style={{ background: "none", border: "none", padding: 0, color: "var(--accent-deep)", fontWeight: 700, cursor: "pointer", fontFamily: SANS }}>Try again</button>
            </div>
          )}

          <div>
            <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: "0.14em", color: "var(--faint)" }}>{dateKicker}</div>
            <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-0.04em", marginTop: 6, lineHeight: 1.05 }}>
              {greetingWord()}{name ? `, ${name}` : ""}.
            </div>
            {me && (
              <div style={{ display: "inline-flex", alignItems: "center", gap: 7, marginTop: 10, padding: "5px 12px", borderRadius: 16, background: "var(--accent-tint)", color: "var(--accent-deep)", fontSize: 12.5, fontWeight: 700, maxWidth: "100%" }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent)", flexShrink: 0 }} />
                <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>Invoice scanner · {me.restaurantName}</span>
              </div>
            )}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {stat(me ? me.monthScans : "–", `SCANS · ${monthShort}`)}
            {stat(me ? me.pricesUpdated : "–", "PRICES UPDATED")}
          </div>

          <button type="button" onClick={() => openCamera()} disabled={!me} style={{ border: "none", textAlign: "left", cursor: "pointer", borderRadius: 20, background: "var(--accent)", color: "#fff", minHeight: 150, padding: "20px 22px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 12, boxShadow: "0 14px 30px rgba(2,164,186,0.32)", fontFamily: SANS, opacity: me ? 1 : 0.6 }}>
            <span style={{ width: 54, height: 54, borderRadius: "50%", background: "rgba(255,255,255,0.2)", display: "flex", alignItems: "center", justifyContent: "center" }}><Cam size={26} color="#fff" /></span>
            <span>
              <span style={{ display: "block", fontSize: 23, fontWeight: 800, letterSpacing: "-0.03em" }}>Scan an invoice</span>
              <span style={{ display: "block", fontSize: 13, opacity: 0.88, marginTop: 2 }}>Lay it flat. Add every page.</span>
            </span>
          </button>

          <div style={{ background: "var(--shell)", border: "1px solid var(--line)", borderRadius: 12, padding: "6px 14px 4px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "6px 0 4px" }}>
              <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.14em", color: "var(--faint)" }}>TODAY</span>
              <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.08em", color: "var(--faint)" }}>{today.length} SCANNED</span>
            </div>
            {!today.length && (
              <div style={{ padding: "12px 0 14px", fontSize: 13.5, color: "var(--muted)" }}>Nothing yet today. Your scans show up here.</div>
            )}
            {today.map((s, i) => (
              <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderTop: i ? "1px solid var(--line-soft)" : "none" }}>
                <span style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "baseline", gap: 10 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, whiteSpace: "nowrap" }}>{timeOf(s.at)}</span>
                  <span style={{ fontSize: 12, color: s.status === "retake" || s.status === "failed" ? "var(--amber)" : "var(--faint)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {s.status === "retake" || s.status === "failed" ? (s.error || "Could not read") : `${s.pages} page${s.pages === 1 ? "" : "s"}`}
                  </span>
                </span>
                {s.status === "read" && (
                  <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12.5, fontWeight: 700, color: "var(--green)" }}><Check color="var(--green)" />Read</span>
                )}
                {s.status === "sending" && (
                  <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 700, color: "var(--accent-deep)" }}>
                    <span style={{ width: 12, height: 12, border: "2px solid var(--line)", borderTopColor: "var(--accent)", borderRadius: "50%", animation: "om-spin .8s linear infinite" }} />Sending
                  </span>
                )}
                {(s.status === "retake" || s.status === "failed") && (
                  <button type="button" onClick={() => openCamera(s.id)} style={{ height: 32, padding: "0 12px", borderRadius: 16, border: "1.5px solid var(--amber)", background: "none", color: "var(--amber)", fontFamily: SANS, fontSize: 12.5, fontWeight: 700, display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                    <Cam size={13} color="var(--amber)" />{s.status === "retake" ? "Retake" : "Try again"}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {sheet && (
        <ScannerSheet onClose={() => { setSheet(null); setConfirmLeave(false); }}>
          {sheet === "account" ? (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "4px 4px 16px", borderBottom: "1px solid var(--line-soft)" }}>
                <span style={{ width: 48, height: 48, borderRadius: "50%", background: "var(--accent)", color: "#fff", fontSize: 16, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{initial}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 17, fontWeight: 800, letterSpacing: "-0.02em" }}>{me?.name || ""}</span>
                  <span style={{ display: "block", fontSize: 13, color: "var(--muted)", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>Invoice scanner · {me?.restaurantName || ""}</span>
                </span>
                <CloseBtn onClick={() => { setSheet(null); setConfirmLeave(false); }} />
              </div>
              {me?.joinedAt && (
                <div style={{ fontSize: 12.5, color: "var(--faint)", padding: "12px 4px 4px" }}>
                  On the team since {new Date(me.joinedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </div>
              )}
              <SheetRow icon={<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />} label="Dark mode">
                <button type="button" role="switch" aria-checked={dark} aria-label="Dark mode" onClick={toggleTheme} style={{ width: 52, height: 32, borderRadius: 16, border: "1px solid var(--line)", position: "relative", cursor: "pointer", flexShrink: 0, padding: 0, background: dark ? "var(--accent)" : "var(--line)" }}>
                  <span style={{ position: "absolute", top: 3, left: dark ? 23 : 3, width: 24, height: 24, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 3px rgba(17,24,25,0.25)", transition: "left .2s" }} />
                </button>
              </SheetRow>
              <SheetRow icon={<><circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><path d="M12 17h.01" /></>} label="How scanning works" onClick={() => setSheet("how")} chevron />
              {!confirmLeave ? (
                <SheetRow icon={<><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" /><path d="M10 17l-5-5 5-5" /><path d="M5 12h11" /></>} label="Leave this restaurant" danger last onClick={() => setConfirmLeave(true)} />
              ) : (
                <div style={{ padding: "14px 4px 4px" }}>
                  <div style={{ fontSize: 14, lineHeight: 1.5, color: "var(--text)" }}>
                    Leave {me?.restaurantName || "this restaurant"}? You&rsquo;ll need a new code from your manager to scan for them again.
                  </div>
                  <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                    <button type="button" onClick={leave} disabled={leaving} style={{ flex: 1, height: 46, borderRadius: 23, border: "none", background: "var(--red)", color: "#fff", fontFamily: SANS, fontSize: 14.5, fontWeight: 700, cursor: "pointer", opacity: leaving ? 0.7 : 1 }}>{leaving ? "Leaving…" : "Leave"}</button>
                    <button type="button" onClick={() => setConfirmLeave(false)} style={{ flex: 1, height: 46, borderRadius: 23, border: "1px solid var(--line)", background: "none", color: "var(--text)", fontFamily: SANS, fontSize: 14.5, fontWeight: 700, cursor: "pointer" }}>Stay</button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "4px 4px 14px", borderBottom: "1px solid var(--line-soft)" }}>
                <span style={{ flex: 1, fontSize: 17, fontWeight: 800, letterSpacing: "-0.02em" }}>How scanning works</span>
                <CloseBtn onClick={() => setSheet(null)} />
              </div>
              {[
                ["Lay it flat", "On a counter, in good light, with no shadow across the page."],
                ["Fill the frame", "The whole page, edge to edge. Closer is better than tilted."],
                ["Every page", "One photo per page. Tap Add page before you send."],
                ["Blurry?", "If a photo can't be read you'll see Retake in today's list."],
              ].map(([t, b], i) => (
                <div key={t} style={{ display: "flex", gap: 12, padding: "13px 4px", borderBottom: i < 3 ? "1px solid var(--line-soft)" : "none" }}>
                  <span style={{ fontFamily: MONO, fontSize: 11, color: "var(--accent-deep)", paddingTop: 2 }}>{i + 1}</span>
                  <span>
                    <span style={{ display: "block", fontSize: 14.5, fontWeight: 700 }}>{t}</span>
                    <span style={{ display: "block", fontSize: 13, color: "var(--muted)", marginTop: 2, lineHeight: 1.5 }}>{b}</span>
                  </span>
                </div>
              ))}
            </>
          )}
        </ScannerSheet>
      )}
    </>
  );
}

function ScannerSheet({ onClose, children }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <>
      <style>{"@keyframes om-sheet-up{from{transform:translateY(100%)}to{transform:translateY(0)}}@keyframes om-fade-in{from{opacity:0}to{opacity:1}}"}</style>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(17,24,25,0.42)", animation: "om-fade-in .2s ease both" }} />
      <div role="dialog" aria-modal="true" style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 301, maxWidth: 520, margin: "0 auto", maxHeight: "85vh", overflowY: "auto", background: "var(--shell)", borderRadius: "22px 22px 0 0", padding: "8px 16px calc(24px + env(safe-area-inset-bottom, 0px))", boxShadow: "0 -18px 40px rgba(17,24,25,0.18)", animation: "om-sheet-up .28s cubic-bezier(.25,.8,.35,1) both", fontFamily: SANS, color: "var(--text)" }}>
        <div style={{ width: 40, height: 5, borderRadius: 3, background: "var(--line)", margin: "0 auto 14px" }} />
        {children}
      </div>
    </>
  );
}

function CloseBtn({ onClick }) {
  return (
    <button type="button" aria-label="Close" onClick={onClick} style={{ width: 44, height: 44, display: "flex", alignItems: "center", justifyContent: "center", background: "none", border: "none", borderRadius: "50%", cursor: "pointer", padding: 0, flexShrink: 0 }}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="var(--muted)" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
    </button>
  );
}

function SheetRow({ icon, label, onClick, children, chevron, danger, last }) {
  const color = danger ? "var(--red)" : "var(--text)";
  return (
    <div onClick={onClick} role={onClick ? "button" : undefined} style={{ display: "flex", alignItems: "center", gap: 14, minHeight: 52, padding: "0 4px", fontSize: 15, fontWeight: 600, color, borderBottom: last ? "none" : "1px solid var(--line-soft)", cursor: onClick ? "pointer" : "default" }}>
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke={danger ? "var(--red)" : "var(--muted)"} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icon}</svg>
      <span style={{ flex: 1 }}>{label}</span>
      {children}
      {chevron && (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="var(--faint)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
      )}
    </div>
  );
}