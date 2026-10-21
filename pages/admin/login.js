// pages/admin/login.js
// Admin login page. Uses same Supabase auth as the client app.
// After login, middleware checks role === 'admin' before allowing access.
// Same tokens, fonts, logo and light/dark choice as the new admin.

import { useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import supabase from '../../lib/supabaseClient';
import { CSS, FONT_LINKS, MONO, useTheme } from '../../components/client/ClientChrome';

const LOGIN_CSS = `
.om-app{--red-tint:#fbeceb;--amber-tint:#fbf3e2;--on-accent:#ffffff}
.om-app[data-theme="dark"],html[data-om-theme="dark"] .om-app{--red-tint:#2b1a18;--amber-tint:#2a2214;--on-accent:#0e1516}
.om-login-field{width:100%;min-height:44px;border:1px solid var(--line);border-radius:10px;padding:0 12px;background:var(--shell);color:var(--text);font:500 14.5px 'Manrope',sans-serif}
.om-login-field::placeholder{color:var(--faint)}
.om-login-field:focus{outline:2px solid var(--accent);outline-offset:-1px;border-color:transparent}
.om-login-btn{width:100%;min-height:46px;border:0;border-radius:23px;background:var(--accent-deep);color:var(--on-accent);font:700 14px 'Manrope',sans-serif;cursor:pointer}
.om-login-btn:hover{filter:brightness(1.06)}
.om-login-btn:disabled{opacity:.6;cursor:default}
`;

export default function AdminLogin() {
  const router = useRouter();
  const [theme, toggleTheme] = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const { data, error: authError } = await supabase.auth.signInWithPassword({ email, password });

    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }

    // Check role before redirecting
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', data.user.id)
      .single();

    if (!profile || profile.role !== 'admin') {
      await supabase.auth.signOut();
      setError('This account does not have admin access.');
      setLoading(false);
      return;
    }

    // Small delay to ensure session cookie is set before middleware checks
    await new Promise(resolve => setTimeout(resolve, 500));
    router.replace('/admin');
  };

  return (
    <div className="om-app" data-theme={theme} style={{ minHeight: '100vh', background: 'var(--ground)', display: 'flex', flexDirection: 'column' }}>
      <Head>
        <title>Admin sign in · OptiMenu</title>
        <meta name="robots" content="noindex, nofollow" />
        {FONT_LINKS}
      </Head>
      <style>{CSS + LOGIN_CSS}</style>

      <main style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 16px' }}>
        <div style={{ width: '100%', maxWidth: 400, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ background: 'var(--shell)', border: '1px solid var(--line)', borderRadius: 18, boxShadow: 'var(--shadow-lg)', padding: '30px 30px 26px', display: 'flex', flexDirection: 'column', gap: 22 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <img className="om-logo-light" src="/landing/logo.png" alt="optiMenu Solutions" style={{ height: 24, width: 'auto' }} />
              <img className="om-logo-dark" src="/landing/logo-knockout.png" alt="optiMenu Solutions" style={{ height: 24, width: 'auto' }} />
              <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 600, letterSpacing: '0.16em', color: 'var(--shell)', background: 'var(--text)', borderRadius: 4, padding: '3px 6px' }}>ADMIN</span>
            </div>

            <div>
              <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.03em' }}>Sign in</h1>
              <p style={{ marginTop: 6, fontSize: 14, color: 'var(--muted)' }}>Restricted to OptiMenu admins.</p>
            </div>

            {router.query.redirected && !error && (
              <div role="status" style={{ background: 'var(--amber-tint)', color: 'var(--amber)', borderRadius: 10, padding: '10px 12px', fontSize: 13, fontWeight: 600 }}>
                Your session ended. Sign in again to continue.
              </div>
            )}

            <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.12em', color: 'var(--muted)' }}>EMAIL</span>
                <input className="om-login-field" type="email" autoComplete="username" autoFocus required
                  value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@opti-menu.com" />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.12em', color: 'var(--muted)' }}>PASSWORD</span>
                <span style={{ position: 'relative', display: 'block' }}>
                  <input className="om-login-field" type={show ? 'text' : 'password'} autoComplete="current-password" required
                    value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" style={{ paddingRight: 64 }} />
                  <button type="button" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'}
                    style={{ position: 'absolute', right: 6, top: 6, height: 32, padding: '0 10px', border: 0, borderRadius: 8, background: 'transparent', color: 'var(--accent-deep)', font: "700 12px 'Manrope',sans-serif", cursor: 'pointer' }}>
                    {show ? 'Hide' : 'Show'}
                  </button>
                </span>
              </label>

              {error && (
                <div role="alert" style={{ background: 'var(--red-tint)', color: 'var(--red)', borderRadius: 10, padding: '10px 12px', fontSize: 13, fontWeight: 600 }}>
                  {error}
                </div>
              )}

              <button type="submit" className="om-login-btn" disabled={loading} style={{ marginTop: 4 }}>
                {loading ? 'Signing in…' : 'Sign in to the admin'}
              </button>
            </form>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 6px', fontSize: 12.5 }}>
            <Link href="/" style={{ color: 'var(--muted)' }}>← Back to OptiMenu</Link>
            <button type="button" onClick={toggleTheme}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8, border: 0, background: 'none', color: 'var(--muted)', font: "500 12.5px 'Manrope',sans-serif", cursor: 'pointer' }}>
              {theme === 'dark' ? 'Light mode' : 'Dark mode'}
              <span aria-hidden="true" style={{ width: 30, height: 17, borderRadius: 9, border: '1px solid var(--line)', position: 'relative', background: theme === 'dark' ? 'var(--accent)' : 'var(--line)' }}>
                <span style={{ position: 'absolute', top: 1, left: theme === 'dark' ? 14 : 1, width: 13, height: 13, borderRadius: '50%', background: '#fff', transition: 'left .2s' }} />
              </span>
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}