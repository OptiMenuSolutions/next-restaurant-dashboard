// pages/client/signup.js
import React, { useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import Image from 'next/image';
import supabase from '../../lib/supabaseClient';

export default function ClientSignup() {
  const [formData, setFormData] = useState({ email: '', password: '', fullName: '' });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const router = useRouter();

  function handleChange(e) {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setError('');
    setMessage('');

    if (formData.password.length < 8) {
      setError('Password must be at least 8 characters.');
      setLoading(false);
      return;
    }

    const { data, error: signUpError } = await supabase.auth.signUp({
      email: formData.email,
      password: formData.password,
      options: {
        data: { full_name: formData.fullName },
      },
    });

    if (signUpError) {
      setError(signUpError.message);
      setLoading(false);
      return;
    }

    // Email confirmation required — user not immediately available
    if (!data.user || !data.session) {
      setMessage('Check your email to confirm your account, then sign in.');
      setLoading(false);
      return;
    }

    // Create profile row
    const { error: insertError } = await supabase.from('profiles').insert([{
      id: data.user.id,
      email: formData.email,
      full_name: formData.fullName,
      restaurant_id: null,
    }]);

    if (insertError) {
      // Profile may already exist from a trigger — non-fatal
      console.warn('Profile insert warning:', insertError.message);
    }

    setLoading(false);
    router.push('/client/onboarding');
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;1,400&family=DM+Sans:wght@300;400;500&display=swap');

        .om-signup-root {
          min-height: 100vh;
          display: flex;
          background: #0f0e0c;
          font-family: 'DM Sans', sans-serif;
          color: #e8e2d8;
        }

        /* ── Left panel ── */
        .om-left {
          width: 44%;
          background: #0f0e0c;
          padding: 48px 40px;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          position: relative;
          border-right: 1px solid #2a2620;
          overflow: hidden;
        }
        .om-left::before {
          content: '';
          position: absolute;
          top: 0; left: 0; right: 0; bottom: 0;
          background: radial-gradient(ellipse at 20% 60%, rgba(2,164,186,0.09) 0%, transparent 65%);
          pointer-events: none;
        }

        .om-wordmark {
          font-family: 'Playfair Display', serif;
          font-size: 26px;
          font-weight: 500;
          letter-spacing: -0.5px;
          color: #e8e2d8;
          line-height: 1;
        }
        .om-wordmark-accent { color: #02a4ba; }

        .om-tagline {
          font-size: 11px;
          letter-spacing: 2.5px;
          text-transform: uppercase;
          color: #6b6358;
          font-weight: 400;
          margin-top: 6px;
        }

        .om-hero {
          flex: 1;
          display: flex;
          flex-direction: column;
          justify-content: center;
          padding: 40px 0;
        }

        .om-headline {
          font-family: 'Playfair Display', serif;
          font-size: 34px;
          font-weight: 400;
          line-height: 1.25;
          color: #e8e2d8;
          margin-bottom: 20px;
          letter-spacing: -0.3px;
        }
        .om-headline-em { font-style: italic; color: #02a4ba; }

        .om-descriptor {
          font-size: 14px;
          color: #7a7268;
          line-height: 1.7;
          font-weight: 300;
          max-width: 280px;
          margin-bottom: 36px;
        }

        .om-features { display: flex; flex-direction: column; gap: 14px; }
        .om-feature { display: flex; align-items: center; gap: 12px; }
        .om-feature-dot {
          width: 6px; height: 6px;
          background: #02a4ba;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .om-feature-text {
          font-size: 13px;
          color: #9a9086;
          font-weight: 300;
          letter-spacing: 0.2px;
        }

        .om-divider-line { width: 32px; height: 1px; background: #2a2620; margin-bottom: 16px; }
        .om-stat-row { display: flex; gap: 28px; }
        .om-stat-num {
          font-family: 'Playfair Display', serif;
          font-size: 22px;
          color: #02a4ba;
          font-weight: 400;
          line-height: 1;
        }
        .om-stat-label {
          font-size: 10px;
          letter-spacing: 1.5px;
          text-transform: uppercase;
          color: #4a453e;
          margin-top: 4px;
          font-weight: 400;
        }

        /* ── Right panel ── */
        .om-right {
          flex: 1;
          background: #13120f;
          padding: 48px 44px;
          display: flex;
          flex-direction: column;
          justify-content: center;
        }

        .om-form-eyebrow {
          font-size: 10px;
          letter-spacing: 2.5px;
          text-transform: uppercase;
          color: #02a4ba;
          font-weight: 500;
          margin-bottom: 10px;
        }
        .om-form-title {
          font-family: 'Playfair Display', serif;
          font-size: 28px;
          font-weight: 400;
          color: #e8e2d8;
          line-height: 1.2;
        }
        .om-form-subtitle {
          font-size: 13px;
          color: #5a5449;
          font-weight: 300;
          margin-top: 6px;
          margin-bottom: 32px;
        }

        /* ── Messages ── */
        .om-error {
          background: rgba(163,45,45,0.12);
          border: 1px solid rgba(163,45,45,0.3);
          border-radius: 6px;
          padding: 10px 14px;
          font-size: 12px;
          color: #e07070;
          margin-bottom: 20px;
          font-weight: 300;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .om-success {
          background: rgba(42,138,90,0.1);
          border: 1px solid rgba(42,138,90,0.25);
          border-radius: 6px;
          padding: 10px 14px;
          font-size: 12px;
          color: #2a8a5a;
          margin-bottom: 20px;
          font-weight: 300;
        }

        /* ── Fields ── */
        .om-field { margin-bottom: 20px; }
        .om-label {
          font-size: 11px;
          letter-spacing: 1.5px;
          text-transform: uppercase;
          color: #6b6358;
          font-weight: 500;
          display: block;
          margin-bottom: 8px;
        }
        .om-input-wrap { position: relative; }
        .om-input {
          width: 100%;
          background: #1a1915;
          border: 1px solid #2a2620;
          border-radius: 8px;
          padding: 13px 16px;
          font-family: 'DM Sans', sans-serif;
          font-size: 14px;
          color: #e8e2d8;
          font-weight: 300;
          box-sizing: border-box;
          outline: none;
          transition: border-color 0.2s;
        }
        .om-input::placeholder { color: #3a3630; }
        .om-input:focus { border-color: #02a4ba; }
        .om-input-has-icon { padding-right: 44px; }

        .om-eye-btn {
          position: absolute;
          right: 14px; top: 50%;
          transform: translateY(-50%);
          background: none;
          border: none;
          cursor: pointer;
          padding: 0;
          opacity: 0.35;
          transition: opacity 0.2s;
          display: flex;
          align-items: center;
        }
        .om-eye-btn:hover { opacity: 0.7; }

        .om-hint {
          font-size: 11px;
          color: #3a3630;
          margin-top: 5px;
        }

        /* ── Buttons ── */
        .om-btn-primary {
          width: 100%;
          background: #02a4ba;
          border: none;
          border-radius: 8px;
          padding: 14px;
          font-family: 'DM Sans', sans-serif;
          font-size: 13px;
          letter-spacing: 1.5px;
          text-transform: uppercase;
          font-weight: 500;
          color: #0f0e0c;
          cursor: pointer;
          transition: background 0.2s, transform 0.1s;
          margin-bottom: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
        }
        .om-btn-primary:hover:not(:disabled) { background: #01bcd4; }
        .om-btn-primary:active:not(:disabled) { transform: scale(0.99); }
        .om-btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }

        .om-divider {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 20px;
        }
        .om-divider-bar { flex: 1; height: 1px; background: #1f1e1b; }
        .om-divider-label {
          font-size: 11px;
          color: #3a3630;
          letter-spacing: 1px;
          text-transform: uppercase;
        }

        .om-btn-secondary {
          width: 100%;
          background: transparent;
          border: 1px solid #2a2620;
          border-radius: 8px;
          padding: 13px;
          font-family: 'DM Sans', sans-serif;
          font-size: 13px;
          color: #7a7268;
          cursor: pointer;
          transition: border-color 0.2s, color 0.2s;
          letter-spacing: 0.3px;
          font-weight: 300;
          text-decoration: none;
          display: block;
          text-align: center;
        }
        .om-btn-secondary:hover { border-color: #3a3630; color: #9a9086; }

        .om-terms {
          font-size: 11px;
          color: #3a3630;
          text-align: center;
          margin-top: 16px;
          line-height: 1.6;
        }
        .om-terms a { color: #02a4ba; text-decoration: none; opacity: 0.8; }
        .om-terms a:hover { opacity: 1; }

        /* ── Spinner ── */
        @keyframes om-spin { to { transform: rotate(360deg); } }
        .om-spinner {
          width: 16px; height: 16px;
          border: 2px solid rgba(15,14,12,0.3);
          border-top-color: #0f0e0c;
          border-radius: 50%;
          animation: om-spin 0.7s linear infinite;
        }

        /* ── Responsive ── */
        @media (max-width: 1024px) { .om-left { display: none; } }
        @media (max-width: 640px) { .om-right { padding: 36px 24px; } }
      `}</style>

      <div className="om-signup-root">

        {/* ── Left branding panel ── */}
        <div className="om-left">
          <div>
            <div className="om-wordmark">Opti<span className="om-wordmark-accent">Menu</span></div>
            <div className="om-tagline">Restaurant Intelligence</div>
          </div>

          <div className="om-hero">
            <div className="om-headline">
              Your kitchen&apos;s<br />
              <em className="om-headline-em">smartest</em><br />
              back office.
            </div>
            <p className="om-descriptor">
              Take control of food costs, optimize your menu, and protect
              your margins — all in one place built for independent operators.
            </p>
            <div className="om-features">
              {[
                'Real-time ingredient cost tracking',
                'AI-powered menu optimization',
                'Profit margin alerts & insights',
                'Invoice & supplier management',
              ].map((f) => (
                <div className="om-feature" key={f}>
                  <div className="om-feature-dot" />
                  <span className="om-feature-text">{f}</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="om-divider-line" />
            <div className="om-stat-row">
              <div>
                <div className="om-stat-num">$59</div>
                <div className="om-stat-label">Founding rate / mo</div>
              </div>
              <div>
                <div className="om-stat-num">150K+</div>
                <div className="om-stat-label">Addressable operators</div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Right signup form ── */}
        <div className="om-right">
          <div style={{ maxWidth: 360, width: '100%', margin: '0 auto' }}>

            <div style={{ marginBottom: 32 }}>
              <Image
                src="/optimenu-logo.png"
                alt="OptiMenu"
                width={160}
                height={48}
                style={{ objectFit: 'contain', display: 'block' }}
                priority
              />
            </div>

            <div className="om-form-eyebrow">Create account</div>
            <div className="om-form-title">Join OptiMenu</div>
            <div className="om-form-subtitle">Set up your account — takes under a minute</div>

            {error && (
              <div className="om-error">
                <svg width="14" height="14" viewBox="0 0 20 20" fill="#e07070">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
                {error}
              </div>
            )}

            {message && <div className="om-success">{message}</div>}

            <form onSubmit={handleSubmit}>
              <div className="om-field">
                <label className="om-label" htmlFor="fullName">Full Name</label>
                <input
                  id="fullName"
                  name="fullName"
                  type="text"
                  placeholder="Your full name"
                  value={formData.fullName}
                  onChange={handleChange}
                  required
                  autoComplete="name"
                  className="om-input"
                />
              </div>

              <div className="om-field">
                <label className="om-label" htmlFor="email">Email Address</label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  placeholder="you@restaurant.com"
                  value={formData.email}
                  onChange={handleChange}
                  required
                  autoComplete="email"
                  className="om-input"
                />
              </div>

              <div className="om-field">
                <label className="om-label" htmlFor="password">Password</label>
                <div className="om-input-wrap">
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••••"
                    value={formData.password}
                    onChange={handleChange}
                    required
                    autoComplete="new-password"
                    className="om-input om-input-has-icon"
                  />
                  <button
                    type="button"
                    className="om-eye-btn"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#e8e2d8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" />
                        <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" />
                        <line x1="1" y1="1" x2="23" y2="23" />
                      </svg>
                    ) : (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#e8e2d8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    )}
                  </button>
                </div>
                <div className="om-hint">Minimum 8 characters</div>
              </div>

              <button type="submit" disabled={loading} className="om-btn-primary">
                {loading ? (
                  <><div className="om-spinner" />Creating account...</>
                ) : (
                  'Create Account'
                )}
              </button>
            </form>

            <div className="om-divider">
              <div className="om-divider-bar" />
              <span className="om-divider-label">Already a member?</span>
              <div className="om-divider-bar" />
            </div>

            <Link href="/client/login" className="om-btn-secondary">
              Sign in to your account
            </Link>

            <div className="om-terms">
              By creating an account you agree to our{' '}
              <Link href="/terms">Terms of Service</Link>{' '}
              and{' '}
              <Link href="/privacy">Privacy Policy</Link>
            </div>

          </div>
        </div>

      </div>
    </>
  );
}