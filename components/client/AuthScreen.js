import { useState } from "react";

/**
 * AuthScreen — OptiMenu login + signup, ported from OptiMenu Auth.dc.html.
 * One component serves both modes (mode="login" | "signup") so the visual
 * design stays in one place; pages/client/login.js and signup.js each mount
 * it with a fixed mode, matching the two existing repo pages.
 *
 * Props
 *   mode            "login" | "signup"
 *   onSubmit        ({ fullName?, email, password }) => Promise|void — throw/reject to show errorText
 *   NavLink         component, defaults to <a>. Pass a next/link wrapper.
 *   showConfirmEmail boolean — show the "check your email" success state (signup only)
 */
export default function AuthScreen({ mode = "login", onSubmit, NavLink = DefaultLink, showConfirmEmail = false }) {
  const isLogin = mode === "login";
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pwShown, setPwShown] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [confirmEmail, setConfirmEmail] = useState(showConfirmEmail);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorText("");
    setLoading(true);
    try {
      await onSubmit?.({ ...(isLogin ? {} : { fullName }), email, password });
      if (!isLogin) setConfirmEmail(true);
    } catch (err) {
      setErrorText(err?.message || (isLogin ? "Invalid login credentials." : "Password must be at least 8 characters."));
    } finally {
      setLoading(false);
    }
  };

  const input = { width: "100%", background: "#fff", border: "1px solid #d7dedf", borderRadius: 10, padding: "10px 15px", fontSize: 15, color: "#111819" };
  const label = { display: "block", fontFamily: "'IBM Plex Mono',monospace", fontSize: 10.5, letterSpacing: "0.12em", textTransform: "uppercase", color: "#7c8789", marginBottom: 6 };

  return (
    <div className="om-auth" style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 22 }}>
      <div style={{ width: "100%", maxWidth: 1080, height: "min(100%,720px)", margin: "0 auto", background: "#fff", borderRadius: 14, overflow: "hidden", boxShadow: "0 22px 60px rgba(17,24,25,0.1)" }}>
        <div className="au-grid" style={{ display: "grid", gridTemplateColumns: "1.02fr 1fr", height: "100%" }}>

          <div style={{ position: "relative", background: "#14110f", borderRight: "1px solid #eaeeef", overflow: "hidden" }} />

          <div className="au-form" style={{ display: "flex", flexDirection: "column", justifyContent: "center", padding: "18px 46px", overflowY: "auto" }}>
            <div style={{ width: "100%", maxWidth: 392, margin: "0 auto" }}>
              <img src="/landing/logo.png" alt="optiMenu Solutions" style={{ display: "block", height: 24, width: "auto", marginBottom: 12 }} />

              {isLogin ? (
                <div>
                  <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "#03808f", marginBottom: 6 }}>Member access</div>
                  <h1 style={{ fontSize: 28, marginBottom: 4, fontWeight: 800, letterSpacing: "-0.035em" }}>Welcome back</h1>
                  <p style={{ fontSize: 13, color: "#7c8789", marginBottom: 12 }}>Sign in to your operator account</p>
                </div>
              ) : (
                <div>
                  <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10.5, letterSpacing: "0.14em", textTransform: "uppercase", color: "#03808f", marginBottom: 6 }}>Create account</div>
                  <h1 style={{ fontSize: 24, marginBottom: 4, fontWeight: 800, letterSpacing: "-0.035em" }}>Join OptiMenu</h1>
                  <p style={{ fontSize: 13, color: "#7c8789", marginBottom: 12 }}>Set up your account — takes under a minute</p>
                </div>
              )}

              {errorText && (
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10, background: "#fdf2f2", border: "1px solid #f3d4d4", borderLeft: "3px solid #c0392b", borderRadius: 8, padding: "12px 14px", marginBottom: 22 }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#c0392b" strokeWidth="1.5" strokeLinecap="round" style={{ flex: "none", marginTop: 1 }}><circle cx="12" cy="12" r="9" /><path d="M12 8v5" /><path d="M12 16.5v.01" /></svg>
                  <span style={{ fontSize: 14, lineHeight: 1.5, color: "#8f3229" }}>{errorText}</span>
                </div>
              )}

              {!isLogin && confirmEmail && (
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10, background: "#f0fafb", border: "1px solid #cfe9ec", borderLeft: "3px solid #02a4ba", borderRadius: 8, padding: "12px 14px", marginBottom: 22 }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#03808f" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flex: "none", marginTop: 1 }}><path d="M4 6h16v12H4z" /><path d="m4 7 8 6 8-6" /></svg>
                  <span style={{ fontSize: 14, lineHeight: 1.5, color: "#0d5c66" }}>Check your email to confirm your account, then sign in.</span>
                </div>
              )}

              <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 11 }}>
                {!isLogin && (
                  <div>
                    <label htmlFor="au-name" style={label}>Full Name</label>
                    <input id="au-name" name="fullName" type="text" placeholder="Your full name" autoComplete="name" style={input} value={fullName} onChange={(e) => setFullName(e.target.value)} />
                  </div>
                )}

                <div>
                  <label htmlFor="au-email" style={label}>{isLogin ? "Email address" : "Email Address"}</label>
                  <input id="au-email" name="email" type="email" placeholder="you@restaurant.com" autoComplete="email" style={input} value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>

                <div>
                  <label htmlFor="au-pw" style={label}>Password</label>
                  <div style={{ position: "relative" }}>
                    <input
                      id="au-pw" name="password" type={pwShown ? "text" : "password"} placeholder="••••••••••"
                      autoComplete={isLogin ? "current-password" : "new-password"}
                      style={{ ...input, padding: "10px 46px 10px 15px" }}
                      value={password} onChange={(e) => setPassword(e.target.value)}
                    />
                    <button type="button" onClick={() => setPwShown((v) => !v)} aria-label="Show or hide password" style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", border: "none", borderRadius: 8, cursor: "pointer" }}>
                      {pwShown ? (
                        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#8b989b" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" /><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
                      ) : (
                        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#8b989b" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                      )}
                    </button>
                  </div>
                  {!isLogin && <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, letterSpacing: "0.06em", color: "#9aa5a7", marginTop: 6 }}>Minimum 8 characters</div>}
                </div>

                {isLogin && (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 9, cursor: "pointer" }}>
                      <input type="checkbox" name="remember-me" style={{ width: 15, height: 15, accentColor: "#02a4ba", cursor: "pointer" }} />
                      <span style={{ fontSize: 14, color: "#5a6669" }}>Remember me</span>
                    </label>
                    <a href="#" style={{ fontSize: 14, fontWeight: 500 }}>Forgot password?</a>
                  </div>
                )}

                <button type="submit" disabled={loading} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, background: "#02a4ba", color: "#fff", border: "none", borderRadius: 26, padding: 12, fontSize: 15.5, fontWeight: 700, cursor: "pointer", boxShadow: "0 10px 24px rgba(2,164,186,0.28)", opacity: loading ? 0.72 : 1 }}>
                  {loading && <span style={{ width: 16, height: 16, border: "2px solid rgba(255,255,255,0.35)", borderTopColor: "#fff", borderRadius: "50%", animation: "au-spin 0.7s linear infinite" }} />}
                  {loading ? (isLogin ? "Signing in…" : "Creating account…") : isLogin ? "Sign in" : "Create Account"}
                </button>
              </form>

              <div style={{ display: "flex", alignItems: "center", gap: 14, margin: "14px 0 10px" }}>
                <span style={{ flex: 1, height: 1, background: "#eaeeef" }} />
                <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10.5, letterSpacing: "0.12em", textTransform: "uppercase", color: "#9aa5a7" }}>{isLogin ? "New to OptiMenu?" : "Already a member?"}</span>
                <span style={{ flex: 1, height: 1, background: "#eaeeef" }} />
              </div>

              <NavLink href={isLogin ? "/client/signup" : "/client/login"} style={{ display: "block", width: "100%", textAlign: "center", background: "transparent", border: "1px solid #d7dedf", borderRadius: 26, padding: 11, fontSize: 15, fontWeight: 600, color: "#111819" }}>
                {isLogin ? "Create your account" : "Sign in to your account"}
              </NavLink>

              {!isLogin && (
                <p style={{ fontSize: 11.5, lineHeight: 1.4, color: "#9aa5a7", textAlign: "center", marginTop: 8 }}>
                  By creating an account you agree to our <NavLink href="/terms" style={{ color: "#03808f" }}>Terms of Service</NavLink> and <NavLink href="/privacy" style={{ color: "#03808f" }}>Privacy Policy</NavLink>
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      <style>{`
        .om-auth h1,.om-auth h2{font-weight:800;letter-spacing:-0.035em;line-height:1.08}
        .om-auth a{color:#03808f;text-decoration:none}
        .om-auth a:hover{color:#02a4ba}
        .om-auth input:focus-visible{outline:none;border-color:#02a4ba;box-shadow:0 0 0 3px rgba(2,164,186,0.16)}
        .om-auth button:focus-visible,.om-auth a:focus-visible{outline:2px solid #02a4ba;outline-offset:2px}
        @keyframes au-spin{to{transform:rotate(360deg)}}
        @media (max-width:900px){
          .om-auth .au-grid{grid-template-columns:1fr}
          .om-auth .au-grid > div:first-child{display:none}
        }
      `}</style>
    </div>
  );
}

function DefaultLink({ href, children, style }) {
  return <a href={href} style={style}>{children}</a>;
}
