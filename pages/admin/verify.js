import { useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import supabase from '../../lib/supabaseClient';
import { CSS, FONT_LINKS, MONO, useTheme } from '../../components/client/ClientChrome';

const FACTOR_NAME = 'OptiMenu admin codes';

export default function AdminVerify() {
  const router = useRouter();
  const [theme, toggleTheme] = useTheme();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [factorId, setFactorId] = useState('');
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        if (!session) {
          router.replace('/client/login');
          return;
        }

        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', session.user.id)
          .single();

        if (profileError) throw profileError;
        if (profile?.role !== 'admin') {
          router.replace('/client/login');
          return;
        }

        const { data: assurance, error: assuranceError } =
          await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

        if (assuranceError) throw assuranceError;
        if (assurance?.currentLevel === 'aal2') {
          router.replace('/admin');
          return;
        }

        const { data: factors, error: factorsError } = await supabase.auth.mfa.listFactors();
        if (factorsError) throw factorsError;

        const verified = factors.totp.find((f) => f.status === 'verified');
        if (active) setFactorId(verified?.id || '');
      } catch (err) {
        if (active) setError(err.message || 'Could not check verification settings.');
      } finally {
        if (active) setLoading(false);
      }
    }

    load();

    return () => {
      active = false;
    };
  }, [router]);

  async function startSetup() {
    setBusy(true);
    setError('');
    setCopied(false);

    try {
      const { data: factors, error: factorsError } = await supabase.auth.mfa.listFactors();
      if (factorsError) throw factorsError;

      const verified = factors.totp.find((f) => f.status === 'verified');
      if (verified) {
        setFactorId(verified.id);
        return;
      }

      // Remove only unfinished setup attempts created by this page.
      for (const factor of factors.all || []) {
        if (
          factor.factor_type === 'totp' &&
          factor.status === 'unverified' &&
          factor.friendly_name === FACTOR_NAME
        ) {
          const { error: removeError } = await supabase.auth.mfa.unenroll({
            factorId: factor.id,
          });
          if (removeError) throw removeError;
        }
      }

      const { data, error: enrollError } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: FACTOR_NAME,
        issuer: 'OptiMenu',
      });

      if (enrollError) throw enrollError;

      setSetup(data);
      setFactorId(data.id);
      setCode('');
    } catch (err) {
      setError(err.message || 'Could not start setup.');
    } finally {
      setBusy(false);
    }
  }

  async function verify(e) {
    e.preventDefault();
    if (!factorId || !/^\d{6}$/.test(code)) return;

    setBusy(true);
    setError('');

    try {
      const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({
        factorId,
        code,
      });

      if (verifyError) throw verifyError;

      setSetup(null);
      setCode('');
      await router.replace('/admin');
    } catch (err) {
      setError(err.message || 'That code did not work. Try the current code from Passwords.');
      setCode('');
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    setBusy(true);
    setError('');

    try {
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) throw signOutError;

      setSetup(null);
      setCode('');
      await router.replace('/client/login');
    } catch (err) {
      setError(err.message || 'Could not sign out.');
      setBusy(false);
    }
  }

  async function copyKey() {
    try {
      await navigator.clipboard.writeText(setup.totp.secret);
      setCopied(true);
    } catch {
      setError('Press and hold the setup key to copy it manually.');
    }
  }

  const fieldStyle = {
    width: '100%',
    minWidth: 0,
    boxSizing: 'border-box',
    minHeight: 46,
    border: '1px solid var(--line)',
    borderRadius: 10,
    padding: '10px 12px',
    background: 'var(--shell)',
    color: 'var(--text)',
    fontSize: 16,
  };

  const buttonStyle = {
    width: '100%',
    minHeight: 46,
    border: 0,
    borderRadius: 24,
    background: 'var(--accent-deep)',
    color: 'var(--on-accent)',
    font: "700 14px 'Manrope', sans-serif",
    cursor: 'pointer',
    opacity: busy ? 0.6 : 1,
  };

  return (
    <div
      className="om-app"
      data-theme={theme}
      style={{
        minHeight: '100dvh',
        background: 'var(--ground)',
        color: 'var(--text)',
        fontFamily: "'Manrope', sans-serif",
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 18,
        padding: '24px 16px',
        boxSizing: 'border-box',
      }}
    >
      <Head>
        <title>Admin verification · OptiMenu</title>
        <meta name="robots" content="noindex, nofollow" />
        {FONT_LINKS}
      </Head>
      <style>{CSS}</style>

      <main
        style={{
          width: '100%',
          maxWidth: 420,
          minWidth: 0,
          boxSizing: 'border-box',
          border: '1px solid var(--line)',
          borderRadius: 18,
          background: 'var(--shell)',
          boxShadow: 'var(--shadow)',
          padding: 28,
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <img className="om-logo-light" src="/landing/logo.png" alt="optiMenu Solutions" style={{ height: 22, width: 'auto' }} />
          <img className="om-logo-dark" src="/landing/logo-knockout.png" alt="optiMenu Solutions" style={{ height: 22, width: 'auto' }} />
          <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 600, letterSpacing: '0.16em', color: 'var(--shell)', background: 'var(--text)', borderRadius: 4, padding: '3px 6px' }}>ADMIN</span>
        </div>

        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.14em', color: 'var(--muted)' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" /></svg>
            {setup || !factorId ? 'FIRST-TIME SETUP' : 'TWO-STEP VERIFICATION'}
          </div>
          <h1 style={{ margin: '8px 0 0', fontSize: 24, fontWeight: 800, letterSpacing: '-0.03em' }}>
            {loading ? 'Checking your account…' : !factorId || setup ? 'Set up verification' : 'Enter your code'}
          </h1>
        </div>

        {error && (
          <div role="alert" style={{ color: 'var(--red)', fontSize: 13, overflowWrap: 'anywhere' }}>
            {error}
          </div>
        )}

        {!loading && !factorId && (
          <>
            <p style={{ margin: 0, color: 'var(--muted)', fontSize: 14, lineHeight: 1.6 }}>
              Save an OptiMenu verification code in Apple Passwords.
              After setup, you will use its six-digit code when signing in to admin.
            </p>
            <button type="button" disabled={busy} onClick={startSetup} style={buttonStyle}>
              {busy ? 'Preparing…' : 'Set up verification'}
            </button>
          </>
        )}

        {!loading && setup && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[
                ['Copy the setup key below', 'Or scan the code with your iPhone camera.'],
                ['Open Passwords on your iPhone', 'Open your saved OptiMenu login, tap Edit, then Set Up Code.'],
                ['Choose Enter Setup Key and paste it', 'Then come back here for the six-digit code.'],
              ].map(([title, detail], index) => (
                <li key={title} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <span style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--accent-tint)', color: 'var(--accent-deep)', fontFamily: MONO, fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{index + 1}</span>
                  <span>
                    <span style={{ display: 'block', fontSize: 14, fontWeight: 700 }}>{title}</span>
                    <span style={{ display: 'block', marginTop: 2, fontSize: 12.5, lineHeight: 1.45, color: 'var(--muted)' }}>{detail}</span>
                  </span>
                </li>
              ))}
            </ol>
            {setup.totp.qr_code && (
              <div style={{ display: 'flex', gap: 14, alignItems: 'center', background: 'var(--panel)', borderRadius: 12, padding: 12 }}>
                <img src={setup.totp.qr_code} alt="Setup QR code" width={96} height={96} style={{ background: '#ffffff', borderRadius: 6, padding: 6, flexShrink: 0 }} />
                <span style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--muted)' }}>Scan with your iPhone camera to add the code to Passwords.</span>
              </div>
            )}
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 700 }}>Setup key</span>
              <input
                readOnly
                value={setup.totp.secret}
                aria-label="Verification setup key"
                onFocus={(e) => e.target.select()}
                style={{ ...fieldStyle, fontFamily: MONO, fontSize: 14 }}
              />
            </label>
            <button
              type="button"
              onClick={copyKey}
              style={{ ...buttonStyle, background: 'var(--panel)', color: 'var(--text)' }}
            >
              {copied ? 'Copied' : 'Copy setup key'}
            </button>
          </div>
        )}

        {!loading && factorId && (
          <form onSubmit={verify} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {!setup && (
              <p style={{ margin: 0, color: 'var(--muted)', fontSize: 14, lineHeight: 1.6 }}>
                Use the six-digit code for OptiMenu in Apple Passwords or your authenticator app.
              </p>
            )}
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 700 }}>Verification code</span>
              <input
                type="text"
                name="verification-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                style={{ ...fieldStyle, fontFamily: MONO, fontSize: 22, textAlign: 'center', letterSpacing: '0.2em' }}
              />
            </label>
            <button type="submit" disabled={busy || code.length !== 6} style={buttonStyle}>
              {busy ? 'Checking…' : setup ? 'Finish setup and open admin' : 'Verify and open admin'}
            </button>
          </form>
        )}

        <button
          type="button"
          disabled={busy}
          onClick={cancel}
          style={{ ...buttonStyle, background: 'transparent', color: 'var(--muted)', border: '1px solid var(--line)' }}
        >
          Sign out
        </button>
      </main>

      <div style={{ display: 'flex', alignItems: 'center', gap: 18, fontSize: 13 }}>
        <a href="/" style={{ color: 'var(--accent-deep)', fontWeight: 700, textDecoration: 'none' }}>← Back to OptiMenu</a>
        <button
          type="button"
          onClick={toggleTheme}
          style={{ minHeight: 34, padding: '0 14px', border: '1px solid var(--line)', borderRadius: 17, background: 'var(--shell)', color: 'var(--text)', font: "600 12.5px 'Manrope', sans-serif", cursor: 'pointer' }}
        >
          {theme === 'dark' ? 'Light mode' : 'Dark mode'}
        </button>
      </div>
    </div>
  );
}