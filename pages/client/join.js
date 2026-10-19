import { useEffect, useRef, useState } from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import supabase from "../../lib/supabaseClient";
import { Shell, useTheme, FONT_LINKS, MONO, SANS } from "../../components/client/ClientChrome";

/**
 * pages/client/join.js — a staff member enters the 6-digit scanner code the
 * owner sent them. Reached from "I have a scanner code" on the login screen,
 * or from the invite link (/join/482913 fills the code in).
 *
 * Joining signs this phone in without an email (a Supabase anonymous login,
 * kept on the phone) and links it to the restaurant. Scanners never get a
 * profile or a restaurant_id, so nothing else in OptiMenu opens for them.
 */

const CamIcon = ({ size = 28, color = "var(--accent-deep)" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h1.8l1.4-2h6.6l1.4 2h1.8A2.5 2.5 0 0 1 21 8.5v9A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5z" /><circle cx="12" cy="13" r="3.6" />
  </svg>
);

export default function JoinPage() {
  const router = useRouter();
  const [theme] = useTheme();
  const inputRef = useRef(null);
  const [code, setCode] = useState("");
  const [preview, setPreview] = useState(null); // { restaurantName, name }
  const [checking, setChecking] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState("");
  const [ownerSignedIn, setOwnerSignedIn] = useState(false);

  // Code from the invite link.
  useEffect(() => {
    if (!router.isReady) return;
    const q = String(router.query.code || "").replace(/\D/g, "").slice(0, 6);
    if (q) setCode(q);
  }, [router.isReady, router.query.code]);

  // An owner already signed in on this phone would be signed out by joining.
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setOwnerSignedIn(!!session?.user && !session.user.is_anonymous);
    });
  }, []);

  // Look the code up as soon as all 6 digits are in.
  useEffect(() => {
    setPreview(null);
    setError("");
    if (code.length !== 6) return;
    let cancelled = false;
    setChecking(true);
    fetch(`/api/scanner/join?code=${code}`)
      .then(async (r) => {
        const json = await r.json().catch(() => ({}));
        if (cancelled) return;
        if (!r.ok) setError(json.error || "That code did not work.");
        else setPreview(json);
      })
      .catch(() => { if (!cancelled) setError("No connection. Check your signal and try again."); })
      .finally(() => { if (!cancelled) setChecking(false); });
    return () => { cancelled = true; };
  }, [code]);

  const start = async () => {
    if (!preview || joining) return;
    setJoining(true);
    setError("");
    try {
      let { data: { session } } = await supabase.auth.getSession();
      if (session?.user && !session.user.is_anonymous) {
        await supabase.auth.signOut();
        session = null;
      }
      if (!session) {
        const { data, error: signInError } = await supabase.auth.signInAnonymously();
        if (signInError) throw signInError;
        session = data.session;
      }
      const res = await fetch("/api/scanner/join", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ code }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not join right now.");
      router.replace("/client/scan");
    } catch (e) {
      setError(e.message || "Could not join right now.");
      setJoining(false);
    }
  };

  const digits = code.padEnd(6, " ").split("");

  return (
    <>
      <Head>
        <title>Scanner code · OptiMenu</title>
        {FONT_LINKS}
      </Head>
      <Shell theme={theme} style={{ position: "fixed", inset: 0, minHeight: 0, overflow: "hidden" }}>
        <div style={{ flexShrink: 0, padding: "env(safe-area-inset-top, 0px) 12px 0", height: "calc(52px + env(safe-area-inset-top, 0px))", display: "flex", alignItems: "center", background: "var(--shell)" }}>
          <button type="button" onClick={() => router.push("/client/login")} style={{ minHeight: 44, display: "flex", alignItems: "center", gap: 4, background: "none", border: "none", padding: "0 4px", fontFamily: SANS, fontSize: 14, fontWeight: 600, color: "var(--accent-deep)", cursor: "pointer" }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
            Back
          </button>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", background: "var(--shell)" }}>
          <div style={{ flex: 1, width: "100%", maxWidth: 440, margin: "0 auto", padding: "22px 26px calc(32px + env(safe-area-inset-bottom, 0px))", display: "flex", flexDirection: "column" }}>
            <div style={{ width: 56, height: 56, borderRadius: 16, background: "var(--accent-tint)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <CamIcon />
            </div>
            <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--accent-deep)", marginTop: 22 }}>Invoice scanner</div>
            <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.035em", lineHeight: 1.12, marginTop: 6 }}>Enter your scanner code</div>
            <div style={{ fontSize: 14, color: "var(--muted)", lineHeight: 1.55, marginTop: 8 }}>
              Your manager sent you a 6-digit code. It links this phone to your restaurant so you can scan deliveries.
            </div>

            {/* One real input under six boxes: the number pad, paste and
                the code suggestion above the keyboard all work. */}
            <div onClick={() => inputRef.current?.focus()} style={{ position: "relative", display: "flex", justifyContent: "center", gap: 6, marginTop: 28, cursor: "text" }}>
              {digits.map((d, i) => (
                <span key={i} style={{ display: "flex", alignItems: "center" }}>
                  {i === 3 && <span style={{ width: 10 }} />}
                  <span style={{ width: 44, height: 58, borderRadius: 10, border: `1.5px solid ${d.trim() || i === code.length ? "var(--accent)" : "var(--line)"}`, background: d.trim() ? "var(--accent-tint)" : "var(--shell)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: MONO, fontSize: 26, fontWeight: 500, color: "var(--text)" }}>
                    {d.trim()}
                  </span>
                </span>
              ))}
              <input
                ref={inputRef}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={6}
                autoFocus
                aria-label="Scanner code"
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0, fontSize: 16, border: "none", background: "transparent", color: "transparent", caretColor: "transparent" }}
              />
            </div>

            {checking && (
              <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: "0.12em", color: "var(--faint)", textAlign: "center", marginTop: 16 }}>CHECKING CODE…</div>
            )}

            {error && (
              <div role="alert" style={{ marginTop: 18, padding: "12px 14px", borderRadius: 10, border: "1px solid var(--red)", background: "color-mix(in srgb, var(--red) 8%, var(--shell))", color: "var(--red)", fontSize: 13.5, lineHeight: 1.5 }}>{error}</div>
            )}

            {preview && (
              <div style={{ marginTop: 22, border: "1px solid var(--line)", borderRadius: 12, padding: "13px 14px", display: "flex", alignItems: "center", gap: 12, background: "var(--panel)" }}>
                <span style={{ width: 36, height: 36, borderRadius: "50%", background: "var(--accent)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 13, flexShrink: 0 }}>
                  {initialsOf(preview.restaurantName)}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 14.5, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{preview.restaurantName}</span>
                  <span style={{ display: "block", fontSize: 12.5, color: "var(--muted)", marginTop: 1 }}>You&rsquo;ll scan invoices as <strong style={{ color: "var(--text)" }}>{preview.name}</strong></span>
                </span>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>
              </div>
            )}

            {preview && ownerSignedIn && (
              <div style={{ marginTop: 12, fontSize: 12.5, color: "var(--muted)", lineHeight: 1.5 }}>
                This phone is signed in to an owner account. Starting will sign it out and use this phone for scanning only.
              </div>
            )}

            <div style={{ flex: 1, minHeight: 28 }} />
            <button
              type="button"
              onClick={start}
              disabled={!preview || joining}
              style={{ height: 52, borderRadius: 26, border: "none", background: "var(--accent)", color: "#fff", fontFamily: SANS, fontSize: 16, fontWeight: 700, cursor: preview ? "pointer" : "default", opacity: preview && !joining ? 1 : 0.45, boxShadow: preview ? "0 10px 24px rgba(2,164,186,0.28)" : "none" }}
            >
              {joining ? "Joining…" : "Start scanning"}
            </button>
            <div style={{ fontFamily: MONO, fontSize: 10.5, color: "var(--faint)", textAlign: "center", marginTop: 12, letterSpacing: "0.04em" }}>CODES WORK ONCE · EXPIRE AFTER 7 DAYS</div>
          </div>
        </div>
      </Shell>
    </>
  );
}

function initialsOf(name) {
  return String(name || "?").split(/\s+/).filter((w) => /[a-z0-9]/i.test(w)).map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "?";
}