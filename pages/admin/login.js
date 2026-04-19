// pages/admin/login.js
// Admin login page. Uses same Supabase auth as the client app.
// After login, middleware checks role === 'admin' before allowing access.

import { useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import supabase from '../../lib/admin/supabaseAdmin';

export default function AdminLogin() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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

    router.push('/admin');
  };

  return (
    <>
      <Head>
        <title>Admin Login — OptiMenu</title>
        <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet" />
      </Head>
      <div style={s.page}>
        <div style={s.card}>
          <div style={s.logo}>
            Opti<span style={s.accent}>Menu</span>
            <span style={s.sub}>admin</span>
          </div>
          <p style={s.tagline}>Restricted access. Admin only.</p>

          {router.query.redirected && (
            <div style={s.infoBox}>Session expired or not logged in.</div>
          )}

          <form onSubmit={handleLogin} style={s.form}>
            <div style={s.field}>
              <label style={s.label}>Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                style={s.input}
              />
            </div>
            <div style={s.field}>
              <label style={s.label}>Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                style={s.input}
              />
            </div>
            {error && <div style={s.errorBox}>{error}</div>}
            <button type="submit" disabled={loading} style={s.btn}>
              {loading ? 'Signing in…' : 'Sign in to Admin'}
            </button>
          </form>
        </div>
      </div>
    </>
  );
}

const s = {
  page: {
    minHeight: '100vh',
    background: '#0a0908',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: "'Inter', sans-serif",
  },
  card: {
    background: '#111318',
    border: '1px solid #1e2028',
    borderRadius: 12,
    padding: '40px 36px',
    width: '100%',
    maxWidth: 380,
  },
  logo: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 24,
    fontWeight: 700,
    color: '#e4e6f0',
    marginBottom: 6,
  },
  accent: { color: '#02a4ba' },
  sub: {
    fontFamily: "'Inter', sans-serif",
    fontSize: 10,
    fontWeight: 500,
    color: '#3a3e50',
    marginLeft: 8,
    textTransform: 'uppercase',
    letterSpacing: '1px',
    verticalAlign: 'middle',
  },
  tagline: {
    fontSize: 12,
    color: '#4a5068',
    marginBottom: 28,
  },
  form: { display: 'flex', flexDirection: 'column', gap: 16 },
  field: { display: 'flex', flexDirection: 'column', gap: 6 },
  label: { fontSize: 11, fontWeight: 600, color: '#7880a0', textTransform: 'uppercase', letterSpacing: '0.5px' },
  input: {
    background: '#0a0908',
    border: '1px solid #1e2028',
    borderRadius: 7,
    padding: '10px 12px',
    fontSize: 13,
    color: '#e4e6f0',
    fontFamily: "'Inter', sans-serif",
    outline: 'none',
    transition: 'border-color 0.15s',
  },
  btn: {
    background: '#02a4ba',
    color: '#0a0908',
    border: 'none',
    borderRadius: 7,
    padding: '11px 0',
    fontSize: 13,
    fontWeight: 700,
    fontFamily: "'Inter', sans-serif",
    cursor: 'pointer',
    marginTop: 4,
    transition: 'background 0.15s',
  },
  errorBox: {
    background: 'rgba(232,84,84,0.1)',
    border: '1px solid rgba(232,84,84,0.25)',
    borderRadius: 6,
    padding: '9px 12px',
    fontSize: 12,
    color: '#e85454',
  },
  infoBox: {
    background: 'rgba(245,166,35,0.1)',
    border: '1px solid rgba(245,166,35,0.25)',
    borderRadius: 6,
    padding: '9px 12px',
    fontSize: 12,
    color: '#f5a623',
    marginBottom: 16,
  },
};