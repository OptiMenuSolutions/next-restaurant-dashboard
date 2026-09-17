import { useEffect, useState } from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import supabase from "../../lib/supabaseClient";

/**
 * pages/client/reset-password.js
 *
 * Landing page for the link sent by supabase.auth.resetPasswordForEmail
 * (see login.js's handleForgotPassword). Supabase's client library reads
 * the recovery token out of the URL hash automatically on load and fires
 * a PASSWORD_RECOVERY auth event once a temporary session is established
 * from it. We listen for that event to know the link was valid before
 * showing the "set a new password" form. If the link is missing, expired,
 * or already used, no PASSWORD_RECOVERY event fires and we show an error
 * with a way back to request a new one.
 */
export default function ResetPasswordPage() {
  const router = useRouter();
  const [status, setStatus] = useState("checking"); // checking | ready | invalid | done
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errorText, setErrorText] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setStatus("ready");
      }
    });

    // Fallback: if a PASSWORD_RECOVERY event already fired before this
    // listener attached, or if there's already a valid session on load,
    // check directly rather than waiting indefinitely.
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        setStatus((current) => (current === "checking" ? "ready" : current));
      } else {
        // Give the URL-hash parsing a moment before deciding it's invalid.
        setTimeout(() => {
          setStatus((current) => (current === "checking" ? "invalid" : current));
        }, 2500);
      }
    });

    return () => listener?.subscription?.unsubscribe();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorText("");

    if (password.length < 8) {
      setErrorText("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setErrorText("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setStatus("done");
    } catch (err) {
      setErrorText(err?.message || "Could not update your password. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const input = { width: "100%", background: "#fff", border: "1px solid #d7dedf", borderRadius: 10, padding: "10px 15px", fontSize: 15, color: "#111819" };
  const label = { display: "block", fontFamily: "'IBM Plex Mono',monospace", fontSize: 10.5, letterSpacing: "0.12em", textTransform: "uppercase", color: "#7c8789", marginBottom: 6 };

  return (
    <>
      <Head>
        <title>Reset password — OptiMenu</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 22, background: "#f6f2e9" }}>
        <div style={{ width: "100%", maxWidth: 420, background: "#fff", borderRadius: 14, padding: "36px 32px", boxShadow: "0 22px 60px rgba(17,24,25,0.1)" }}>
          <img src="/landing/logo.png" alt="optiMenu Solutions" style={{ display: "block", height: 24, width: "auto", marginBottom: 20 }} />

          {status === "checking" && (
            <p style={{ fontSize: 14, color: "#7c8789" }}>Checking your reset link…</p>
          )}

          {status === "invalid" && (
            <div>
              <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 8 }}>This link has expired</h1>
              <p style={{ fontSize: 14, color: "#7c8789", marginBottom: 20 }}>
                Password reset links only work once and expire after a short time. Head back to
                the login page and click "Forgot password?" again to get a new one.
              </p>
              <button
                type="button"
                onClick={() => router.push("/client/login")}
                style={{ width: "100%", background: "#02a4ba", color: "#fff", border: "none", borderRadius: 26, padding: 12, fontSize: 15.5, fontWeight: 700, cursor: "pointer" }}
              >
                Back to login
              </button>
            </div>
          )}

          {status === "ready" && (
            <div>
              <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>Set a new password</h1>
              <p style={{ fontSize: 14, color: "#7c8789", marginBottom: 20 }}>Choose a new password for your account.</p>

              {errorText && (
                <div style={{ background: "#fdf2f2", border: "1px solid #f3d4d4", borderLeft: "3px solid #c0392b", borderRadius: 8, padding: "10px 14px", marginBottom: 16, fontSize: 14, color: "#8f3229" }}>
                  {errorText}
                </div>
              )}

              <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div>
                  <label htmlFor="rp-pw" style={label}>New password</label>
                  <input id="rp-pw" type="password" placeholder="••••••••••" autoComplete="new-password" style={input} value={password} onChange={(e) => setPassword(e.target.value)} />
                  <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, color: "#9aa5a7", marginTop: 6 }}>Minimum 8 characters</div>
                </div>
                <div>
                  <label htmlFor="rp-pw2" style={label}>Confirm new password</label>
                  <input id="rp-pw2" type="password" placeholder="••••••••••" autoComplete="new-password" style={input} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
                </div>
                <button type="submit" disabled={loading} style={{ width: "100%", background: "#02a4ba", color: "#fff", border: "none", borderRadius: 26, padding: 12, fontSize: 15.5, fontWeight: 700, cursor: "pointer", opacity: loading ? 0.72 : 1 }}>
                  {loading ? "Updating…" : "Update password"}
                </button>
              </form>
            </div>
          )}

          {status === "done" && (
            <div>
              <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 8 }}>Password updated</h1>
              <p style={{ fontSize: 14, color: "#7c8789", marginBottom: 20 }}>
                Your password has been changed. Sign in with your new password to continue.
              </p>
              <button
                type="button"
                onClick={() => router.push("/client/login")}
                style={{ width: "100%", background: "#02a4ba", color: "#fff", border: "none", borderRadius: 26, padding: 12, fontSize: 15.5, fontWeight: 700, cursor: "pointer" }}
              >
                Go to login
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}