// pages/admin/login.js
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import supabase from '../../lib/supabaseClient';

export default function AdminLogin() {
  const router = useRouter();
  const [email, setEmail]               = useState('');
  const [password, setPassword]         = useState('');
  const [loading, setLoading]           = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError]               = useState('');
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    const checkAuthAndRole = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          const { data: profile } = await supabase.from('profiles').select('role').eq('id', session.user.id).single();
          if (profile?.role === 'admin') { router.replace('/admin'); return; }
          await supabase.auth.signOut();
          setError('Access denied. Admin privileges required.');
        }
      } catch {
        setError('Authentication check failed. Please try again.');
      } finally {
        setInitialLoading(false);
      }
    };

    checkAuthAndRole();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        const { data: profile } = await supabase.from('profiles').select('role').eq('id', session.user.id).single();
        if (profile?.role === 'admin') router.replace('/admin');
        else { await supabase.auth.signOut(); setError('Access denied. Admin privileges required.'); }
      }
    });

    return () => subscription?.unsubscribe();
  }, [router]);

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!email || !password) { setError('Please fill in all fields.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setError('Please enter a valid email address.'); return; }

    setLoading(true);
    setError('');

    try {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });

      if (signInError) {
        const msgs = {
          'Invalid login credentials': 'Invalid email or password.',
          'Email not confirmed':        'Please confirm your email first.',
          'Too many requests':          'Too many attempts. Please wait and try again.',
        };
        setError(msgs[signInError.message] || 'Login failed. Please try again.');
        return;
      }

      if (data.user) {
        const { data: profile } = await supabase.from('profiles').select('role').eq('id', data.user.id).single();
        if (profile?.role !== 'admin') {
          await supabase.auth.signOut();
          setError('Access denied. Admin privileges required.');
        }
      }
    } catch {
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // ── Initial auth check spinner ─────────────────────────────────────────
  if (initialLoading) {
    return (
      <div style={{
        minHeight: '100vh', background: '#0a0908',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: "'Inter', system-ui, sans-serif",
      }}>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600&family=Inter:wght@300;400;500&display=swap');`}</style>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
          <div style={{ width: 28, height: 28, border: '2px solid rgba(255,255,255,0.1)', borderTopColor: '#02a4ba', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
          <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.82rem', margin: 0 }}>Verifying access…</p>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: '#0a0908',
      backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.03) 1px, transparent 0)',
      backgroundSize: '24px 24px',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24,
      fontFamily: "'Inter', system-ui, sans-serif",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600&family=Inter:wght@300;400;500;600&display=swap');
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }

        .login-input {
          width: 100%;
          background: #1c1a18;
          border: 1px solid rgba(255,255,255,0.07);
          border-radius: 8px;
          color: #f5f3f0;
          font-family: 'Inter', system-ui, sans-serif;
          font-size: 0.88rem;
          padding: 11px 14px;
          outline: none;
          transition: border-color 0.2s ease, box-shadow 0.2s ease;
          box-sizing: border-box;
        }
        .login-input::placeholder { color: #5c5650; }
        .login-input:focus {
          border-color: #02a4ba;
          box-shadow: 0 0 0 3px rgba(2,164,186,0.2);
        }
        .login-input:disabled { opacity: 0.5; cursor: not-allowed; }

        .login-btn {
          width: 100%;
          background: #02a4ba;
          color: #000;
          border: none;
          border-radius: 8px;
          padding: 12px 20px;
          font-family: 'Inter', system-ui, sans-serif;
          font-size: 0.88rem;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.2s ease, box-shadow 0.2s ease;
          display: flex; align-items: center; justify-content: center; gap: 8px;
        }
        .login-btn:hover:not(:disabled) {
          background: #03bdd6;
          box-shadow: 0 0 24px rgba(2,164,186,0.3);
        }
        .login-btn:disabled { opacity: 0.5; cursor: not-allowed; }

        .pw-toggle {
          position: absolute; right: 12px; top: 50%; transform: translateY(-50%);
          background: none; border: none; color: #5c5650; cursor: pointer;
          padding: 4px; display: flex; align-items: center; justify-content: center;
          transition: color 0.15s ease;
        }
        .pw-toggle:hover { color: #9b9590; }
      `}</style>

      <div style={{ width: '100%', maxWidth: 400, animation: 'fadeUp 0.4s ease forwards' }}>

        {/* Logo + title */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
            <img
              src="/optimenu-logo-collapsed.png"
              alt="OptiMenu"
              style={{ height: 52, width: 'auto', objectFit: 'contain' }}
            />
          </div>
          <h1 style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: '1.5rem', fontWeight: 600, color: '#f5f3f0', margin: '0 0 6px' }}>
            Admin Portal
          </h1>
          <p style={{ fontSize: '0.8rem', color: '#5c5650', margin: 0 }}>
            Sign in to manage OptiMenu
          </p>
        </div>

        {/* Card */}
        <div style={{
          background: '#131211',
          border: '1px solid rgba(255,255,255,0.07)',
          borderRadius: 14,
          padding: 28,
          boxShadow: '0 24px 48px rgba(0,0,0,0.5)',
        }}>
          {/* Error */}
          {error && (
            <div style={{
              background: 'rgba(244,63,94,0.08)',
              border: '1px solid rgba(244,63,94,0.2)',
              borderRadius: 8,
              padding: '10px 14px',
              marginBottom: 20,
              fontSize: '0.82rem',
              color: '#f43f5e',
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}>
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              {error}
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleLogin}>
            {/* Email */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: '#9b9590', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 7 }}>
                Email Address
              </label>
              <input
                className="login-input"
                type="email"
                autoComplete="email"
                placeholder="admin@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                disabled={loading}
                required
              />
            </div>

            {/* Password */}
            <div style={{ marginBottom: 24 }}>
              <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: '#9b9590', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 7 }}>
                Password
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  className="login-input"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  disabled={loading}
                  style={{ paddingRight: 40 }}
                  required
                />
                <button
                  type="button"
                  className="pw-toggle"
                  onClick={() => setShowPassword(s => !s)}
                  disabled={loading}
                  tabIndex={-1}
                >
                  {showPassword ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                      <line x1="1" y1="1" x2="23" y2="23"/>
                    </svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                      <circle cx="12" cy="12" r="3"/>
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {/* Submit */}
            <button type="submit" className="login-btn" disabled={loading}>
              {loading ? (
                <>
                  <div style={{ width: 15, height: 15, border: '2px solid rgba(0,0,0,0.3)', borderTopColor: '#000', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                  Signing in…
                </>
              ) : 'Sign In'}
            </button>
          </form>

          {/* Footer */}
          <div style={{ marginTop: 24, paddingTop: 20, borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#02a4ba', boxShadow: '0 0 6px rgba(2,164,186,0.6)' }} />
            <span style={{ fontSize: '0.72rem', color: '#5c5650' }}>Secured connection</span>
          </div>
        </div>

        {/* Bottom tagline */}
        <p style={{ textAlign: 'center', fontSize: '0.72rem', color: '#3a3735', marginTop: 20 }}>
          OptiMenu Admin · Restricted Access
        </p>
      </div>
    </div>
  );
}