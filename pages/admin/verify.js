import { useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import supabase from '../../lib/supabaseClient';
import { CSS, FONT_LINKS, MONO, useTheme } from '../../components/client/ClientChrome';

const FACTOR_NAME = 'OptiMenu admin codes';

export default function AdminVerify() {
  const router = useRouter();
  const [theme] = useTheme();
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
        alignItems: 'center',
        justifyContent: 'center',
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
          padding: 24,
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
        }}
      >
        <div>
          <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.14em', color: 'var(--muted)' }}>
            OPTIMENU · ADMIN
          </div>
          <h1 style={{ margin: '8px 0 0', fontSize: 23, fontWeight: 800 }}>
            {loading ? 'Checking your account…' : !factorId ? 'Set up verification' : 'Enter your code'}
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
            <ol style={{ margin: 0, paddingLeft: 20, fontSize: 14, lineHeight: 1.7 }}>
              <li>Copy the setup key below.</li>
              <li>Open the Passwords app on your iPhone.</li>
              <li>Open your saved OptiMenu login, then tap Edit and Set Up Code.</li>
              <li>Choose Enter Setup Key and paste the key.</li>
              <li>Return here and enter the six-digit code from Passwords.</li>
            </ol>
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
    </div>
  );
}