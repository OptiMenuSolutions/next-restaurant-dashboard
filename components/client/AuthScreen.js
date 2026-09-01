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

          <div style={{ position: "relative", background: "#14110f", borderRight: "1px solid #eaeeef", overflow: "hidden" }}>
            <div style={{ position: "absolute", inset: 0 }}>
              <div style={{ position: "absolute", inset: 0, backgroundImage: "radial-gradient(#2a2622 1px, transparent 1px)", backgroundSize: "22px 22px", opacity: 0.9 }} />
              <div style={{ position: "absolute", inset: 0, background: "radial-gradient(60% 45% at 30% 78%, rgba(2,164,186,0.16) 0%, transparent 72%)" }} />
              <svg viewBox="0 0 520 660" preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
                <g transform="translate(64 44) rotate(-3.5)">
                  <path d="M0 0 H280 V210 L275.6 217 L271.1 210 L266.7 217 L262.2 210 L257.8 217 L253.3 210 L248.9 217 L244.4 210 L240.0 217 L235.6 210 L231.1 217 L226.7 210 L222.2 217 L217.8 210 L213.3 217 L208.9 210 L204.4 217 L200.0 210 L195.6 217 L191.1 210 L186.7 217 L182.2 210 L177.8 217 L173.3 210 L168.9 217 L164.4 210 L160.0 217 L155.6 210 L151.1 217 L146.7 210 L142.2 217 L137.8 210 L133.3 217 L128.9 210 L124.4 217 L120.0 210 L115.6 217 L111.1 210 L106.7 217 L102.2 210 L97.8 217 L93.3 210 L88.9 217 L84.4 210 L80.0 217 L75.6 210 L71.1 217 L66.7 210 L62.2 217 L57.8 210 L53.3 217 L48.9 210 L44.4 217 L40.0 210 L35.6 217 L31.1 210 L26.7 217 L22.2 210 L17.8 217 L13.3 210 L8.9 217 L4.4 210 L0.0 217 Z" fill="#f6f2e9" opacity="0.95" />
                  <rect x="0" y="0" width="280" height="5" fill="#02a4ba" opacity="0.4" />
                  <rect x="24" y="24" width="30" height="30" fill="none" stroke="#1c1712" strokeWidth="1.5" opacity="0.45" />
                  <path d="M31 32 L38 46 M45 32 L38 46 M31 39 L45 39" stroke="#02a4ba" strokeWidth="1.6" opacity="0.65" fill="none" />
                  <rect x="66" y="27" width="130" height="13" fill="#1c1712" opacity="0.42" />
                  <rect x="24" y="70" width="76" height="7" fill="#02a4ba" opacity="0.5" />
                  <circle cx="28" cy="97" r="3.4" fill="none" stroke="#1c1712" strokeWidth="1.4" opacity="0.5" /><rect x="40" y="94" width="158" height="6" fill="#d9d2c4" opacity="0.6" />
                  <circle cx="28" cy="119" r="3.4" fill="none" stroke="#1c1712" strokeWidth="1.4" opacity="0.5" /><rect x="40" y="116" width="108" height="6" fill="#d9d2c4" opacity="0.6" />
                  <circle cx="28" cy="141" r="3.4" fill="none" stroke="#1c1712" strokeWidth="1.4" opacity="0.5" /><rect x="40" y="138" width="132" height="6" fill="#d9d2c4" opacity="0.6" />
                  <circle cx="28" cy="163" r="3.4" fill="none" stroke="#1c1712" strokeWidth="1.4" opacity="0.5" /><rect x="40" y="160" width="80" height="6" fill="#d9d2c4" opacity="0.6" />
                  <circle cx="204" cy="97" r="8" fill="#02a4ba" opacity="0.18" /><rect x="200" y="94" width="16" height="6" fill="#02a4ba" opacity="0.55" />
                </g>
                <g transform="translate(132 236) rotate(1.5)">
                  <rect x="0" y="0" width="272" height="222" fill="#f6f2e9" opacity="0.95" stroke="#1c1712" strokeWidth="1" strokeOpacity="0.15" />
                  <rect x="0" y="0" width="272" height="5" fill="#02a4ba" opacity="0.4" />
                  <rect x="22" y="24" width="96" height="14" fill="#1c1712" opacity="0.42" />
                  <rect x="180" y="26" width="70" height="6" fill="#d9d2c4" opacity="0.7" />
                  <rect x="188" y="38" width="62" height="6" fill="#d9d2c4" opacity="0.7" />
                  <line x1="22" y1="56" x2="250" y2="56" stroke="#1c1712" strokeWidth="1" opacity="0.3" />
                  <rect x="22" y="68" width="90" height="6" fill="#d9d2c4" opacity="0.65" /><rect x="216" y="68" width="34" height="6" fill="#02a4ba" opacity="0.6" />
                  <rect x="22" y="88" width="70" height="6" fill="#d9d2c4" opacity="0.65" /><rect x="222" y="88" width="28" height="6" fill="#02a4ba" opacity="0.6" />
                  <rect x="22" y="108" width="110" height="6" fill="#d9d2c4" opacity="0.65" /><rect x="210" y="108" width="40" height="6" fill="#02a4ba" opacity="0.6" />
                  <rect x="22" y="128" width="60" height="6" fill="#d9d2c4" opacity="0.65" /><rect x="226" y="128" width="24" height="6" fill="#02a4ba" opacity="0.6" />
                  <line x1="150" y1="66" x2="150" y2="140" stroke="#1c1712" strokeWidth="1" opacity="0.15" />
                  <line x1="22" y1="152" x2="250" y2="152" stroke="#1c1712" strokeWidth="1" opacity="0.3" />
                  <rect x="22" y="176" width="60" height="10" fill="#1c1712" opacity="0.42" />
                  <rect x="178" y="172" width="72" height="20" fill="#02a4ba" opacity="0.9" />
                </g>
                <g transform="translate(198 400) rotate(-1.5)">
                  <path d="M0 8 L4.5 1 L9.1 8 L13.6 1 L18.2 8 L22.7 1 L27.3 8 L31.8 1 L36.4 8 L40.9 1 L45.5 8 L50.0 1 L54.5 8 L59.1 1 L63.6 8 L68.2 1 L72.7 8 L77.3 1 L81.8 8 L86.4 1 L90.9 8 L95.5 1 L100.0 8 L104.5 1 L109.1 8 L113.6 1 L118.2 8 L122.7 1 L127.3 8 L131.8 1 L136.4 8 L140.9 1 L145.5 8 L150.0 1 L154.5 8 L159.1 1 L163.6 8 L168.2 1 L172.7 8 L177.3 1 L181.8 8 L186.4 1 L190.9 8 L195.5 1 L200 8 V270 L195.5 277 L190.9 270 L186.4 277 L181.8 270 L177.3 277 L172.7 270 L168.2 277 L163.6 270 L159.1 277 L154.5 270 L150.0 277 L145.5 270 L140.9 277 L136.4 270 L131.8 277 L127.3 270 L122.7 277 L118.2 270 L113.6 277 L109.1 270 L104.5 277 L100.0 270 L95.5 277 L90.9 270 L86.4 277 L81.8 270 L77.3 277 L72.7 270 L68.2 277 L63.6 270 L59.1 277 L54.5 270 L50.0 277 L45.5 270 L40.9 277 L36.4 270 L31.8 277 L27.3 270 L22.7 277 L18.2 270 L13.6 277 L9.1 270 L4.5 277 L0.0 270 Z" fill="#f6f2e9" opacity="1" />
                  <rect x="16" y="20" width="168" height="12" fill="#1c1712" opacity="0.85" />
                  <rect x="40" y="38" width="120" height="6" fill="#02a4ba" opacity="0.85" />
                  <line x1="16" y1="54" x2="184" y2="54" stroke="#1c1712" strokeWidth="1.5" strokeDasharray="3 3" opacity="0.5" />
                  <rect x="16" y="66" width="70" height="6" fill="#c9bfae" opacity="0.9" /><rect x="150" y="66" width="34" height="6" fill="#c9bfae" opacity="0.9" />
                  <rect x="16" y="84" width="50" height="6" fill="#c9bfae" opacity="0.9" /><rect x="160" y="84" width="24" height="6" fill="#c9bfae" opacity="0.9" />
                  <rect x="16" y="102" width="86" height="6" fill="#c9bfae" opacity="0.9" /><rect x="144" y="102" width="40" height="6" fill="#c9bfae" opacity="0.9" />
                  <rect x="16" y="120" width="42" height="6" fill="#c9bfae" opacity="0.9" /><rect x="164" y="120" width="20" height="6" fill="#c9bfae" opacity="0.9" />
                  <rect x="16" y="138" width="60" height="6" fill="#c9bfae" opacity="0.9" /><rect x="154" y="138" width="30" height="6" fill="#c9bfae" opacity="0.9" />
                  <line x1="16" y1="154" x2="184" y2="154" stroke="#1c1712" strokeWidth="1.5" strokeDasharray="3 3" opacity="0.5" />
                  <rect x="16" y="168" width="40" height="10" fill="#1c1712" opacity="0.85" /><rect x="128" y="164" width="56" height="18" fill="#02a4ba" opacity="1" />
                  <line x1="16" y1="198" x2="184" y2="198" stroke="#1c1712" strokeWidth="1.5" strokeDasharray="3 3" opacity="0.5" />
                  <rect x="20" y="212" width="4" height="30" fill="#1c1712" opacity="0.85" /><rect x="27" y="212" width="2" height="30" fill="#1c1712" opacity="0.85" /><rect x="32" y="212" width="6" height="30" fill="#1c1712" opacity="0.85" /><rect x="41" y="212" width="3" height="30" fill="#1c1712" opacity="0.85" /><rect x="47" y="212" width="2" height="30" fill="#1c1712" opacity="0.85" /><rect x="52" y="212" width="5" height="30" fill="#1c1712" opacity="0.85" /><rect x="60" y="212" width="2" height="30" fill="#1c1712" opacity="0.85" /><rect x="65" y="212" width="7" height="30" fill="#1c1712" opacity="0.85" /><rect x="75" y="212" width="2" height="30" fill="#1c1712" opacity="0.85" /><rect x="80" y="212" width="4" height="30" fill="#1c1712" opacity="0.85" /><rect x="87" y="212" width="3" height="30" fill="#1c1712" opacity="0.85" /><rect x="93" y="212" width="2" height="30" fill="#1c1712" opacity="0.85" /><rect x="98" y="212" width="6" height="30" fill="#1c1712" opacity="0.85" /><rect x="107" y="212" width="2" height="30" fill="#1c1712" opacity="0.85" /><rect x="112" y="212" width="4" height="30" fill="#1c1712" opacity="0.85" /><rect x="119" y="212" width="2" height="30" fill="#1c1712" opacity="0.85" /><rect x="124" y="212" width="7" height="30" fill="#1c1712" opacity="0.85" /><rect x="134" y="212" width="3" height="30" fill="#1c1712" opacity="0.85" /><rect x="140" y="212" width="2" height="30" fill="#1c1712" opacity="0.85" /><rect x="145" y="212" width="5" height="30" fill="#1c1712" opacity="0.85" /><rect x="153" y="212" width="2" height="30" fill="#1c1712" opacity="0.85" /><rect x="158" y="212" width="4" height="30" fill="#1c1712" opacity="0.85" /><rect x="165" y="212" width="2" height="30" fill="#1c1712" opacity="0.85" /><rect x="170" y="212" width="6" height="30" fill="#1c1712" opacity="0.85" />
                </g>
              </svg>
            </div>
          </div>

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
