import { useEffect, useState } from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import supabase from "../../lib/supabaseClient";

/**
 * pages/client/connect-shift4.js — Shift4 location picker.
 *
 * The OAuth callback lands the merchant here after they sign in to Shift4 and
 * click Allow. We list their Shift4 locations (unavailable ones are shown but
 * can't be picked, which Shift4 certification test OA-007 checks), then
 * install OptiMenu on the one they choose and send them back to where they
 * started (onboarding or profile).
 */
const ALLOWED_RETURNS = ["/client/profile", "/client/dashboard?justOnboarded=true"];
const REASON_LABELS = { INSTALLED: "Already connected to OptiMenu" };

export default function ConnectShift4Page() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [locations, setLocations] = useState([]);
  const [selected, setSelected] = useState(null);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState("");
  const [restart, setRestart] = useState(false);

  const returnTo = ALLOWED_RETURNS.includes(router.query.returnTo) ? router.query.returnTo : "/client/profile";
  const goBack = (query) => router.push(`${returnTo}${returnTo.includes("?") ? "&" : "?"}${query}`);

  const authHeaders = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.push("/client/login"); return null; }
    return { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` };
  };

  useEffect(() => {
    if (!router.isReady) return;
    let cancelled = false;
    (async () => {
      try {
        const headers = await authHeaders();
        if (!headers) return;
        const res = await fetch("/api/pos/shift4/locations", { headers });
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(json.error || "Could not load your Shift4 locations.");
          setRestart(!!json.restart);
          return;
        }
        const list = json.locations || [];
        setLocations(list);
        const available = list.filter((l) => l.isAvailable);
        if (available.length === 1) setSelected(available[0].id);
      } catch {
        if (!cancelled) setError("Could not load your Shift4 locations.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady]);

  const install = async () => {
    if (!selected || installing) return;
    setInstalling(true);
    setError("");
    try {
      const headers = await authHeaders();
      if (!headers) return;
      const res = await fetch("/api/pos/shift4/install", {
        method: "POST",
        headers,
        body: JSON.stringify({ locationId: selected }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Could not connect that location.");
        setRestart(!!json.restart);
        return;
      }
      goBack("pos=connected&provider=shift4");
    } catch {
      setError("Could not connect that location.");
    } finally {
      setInstalling(false);
    }
  };

  const hasAvailable = locations.some((l) => l.isAvailable);

  return (
    <>
      <Head>
        <title>Connect Shift4 — OptiMenu</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <div style={{ minHeight: "100vh", background: "#eef0ef", display: "flex", alignItems: "center", justifyContent: "center", padding: "36px 20px", fontFamily: "'Manrope',system-ui,sans-serif", color: "#111819" }}>
        <div style={{ width: "100%", maxWidth: 520, background: "#fff", border: "1px solid #d8dfe0", borderRadius: 14, boxShadow: "0 22px 60px rgba(17,24,25,0.12)", padding: "36px 34px" }}>
          <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10.5, letterSpacing: "0.14em", textTransform: "uppercase", color: "#03808f", marginBottom: 8 }}>Connect Shift4</div>
          <div style={{ fontSize: 21, fontWeight: 800, letterSpacing: "-0.03em", marginBottom: 6 }}>Choose your location</div>
          <div style={{ fontSize: 13.5, color: "#4b585b", lineHeight: 1.5, marginBottom: 20 }}>
            OptiMenu will sync this location&apos;s sales every night. You can disconnect anytime from your profile.
          </div>

          {loading && <div style={{ fontSize: 13.5, color: "#4b585b" }}>Loading your Shift4 locations...</div>}

          {!loading && locations.length === 0 && !error && (
            <div style={{ fontSize: 13.5, color: "#4b585b" }}>We didn&apos;t find any Shift4 locations on this account.</div>
          )}

          {!loading && locations.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {locations.map((loc) => {
                const isSelected = selected === loc.id;
                const disabled = !loc.isAvailable;
                return (
                  <button
                    key={loc.id}
                    type="button"
                    disabled={disabled}
                    onClick={() => setSelected(loc.id)}
                    style={{
                      display: "flex", alignItems: "center", gap: 12, textAlign: "left",
                      background: isSelected ? "#e8f7f9" : "#fff",
                      border: `1px solid ${isSelected ? "#02a4ba" : "#d8dfe0"}`,
                      borderRadius: 10, padding: "13px 14px",
                      cursor: disabled ? "not-allowed" : "pointer",
                      opacity: disabled ? 0.55 : 1,
                      fontFamily: "'Manrope',sans-serif",
                    }}
                  >
                    <span style={{ flex: 1 }}>
                      <span style={{ display: "block", fontSize: 14, fontWeight: 600, color: "#111819" }}>{loc.name}</span>
                      {disabled && (
                        <span style={{ display: "block", fontSize: 12, color: "#78868a", marginTop: 2 }}>
                          {REASON_LABELS[loc.reason] || "Not available to connect"}
                        </span>
                      )}
                    </span>
                    {isSelected && (
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#03808f" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {error && (
            <div style={{ marginTop: 16, background: "#faeae8", border: "1px solid #c4473e", borderRadius: 10, padding: "12px 14px", fontSize: 13, color: "#c4473e", fontWeight: 600 }}>
              {error}
            </div>
          )}

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 30, paddingTop: 24, borderTop: "1px solid #eef1f2" }}>
            <button
              type="button"
              onClick={() => goBack(restart ? "pos=error" : "pos=cancelled")}
              style={{ background: "transparent", border: "1px solid #d8dfe0", color: "#111819", borderRadius: 24, padding: "12px 22px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}
            >
              {restart ? "Go back" : "Cancel"}
            </button>
            {!restart && hasAvailable && (
              <button
                type="button"
                onClick={install}
                disabled={!selected || installing}
                style={{ background: "#02a4ba", color: "#fff", border: "none", borderRadius: 24, padding: "12px 26px", fontSize: 14, fontWeight: 700, cursor: !selected || installing ? "default" : "pointer", opacity: !selected || installing ? 0.6 : 1 }}
              >
                {installing ? "Connecting..." : "Connect location"}
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}