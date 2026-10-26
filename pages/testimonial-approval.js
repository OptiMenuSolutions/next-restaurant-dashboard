import { useEffect, useState } from 'react';
import Head from 'next/head';
import { CSS, FONT_LINKS, MONO, useTheme } from '../components/client/ClientChrome';

export default function TestimonialApprovalPage() {
  const [theme] = useTheme();
  const [status, setStatus] = useState('loading');
  const [approved, setApproved] = useState(null);

  useEffect(() => {
    let active = true;
    const token = new URLSearchParams(window.location.hash.slice(1)).get('token');

    window.history.replaceState(null, '', window.location.pathname);

    if (!token) {
      setStatus('invalid');
      return () => { active = false; };
    }

    fetch('/api/public/testimonial-approval', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then(async (res) => ({ ok: res.ok, body: await res.json() }))
      .then(({ ok, body }) => {
        if (!active) return;
        setApproved(ok ? body : null);
        setStatus(ok ? 'approved' : 'invalid');
      })
      .catch(() => {
        if (active) setStatus('error');
      });

    return () => { active = false; };
  }, []);

  const firstName = String(approved?.person || '').split(' ')[0];
  const attribution = [approved?.person, approved?.restaurant].filter(Boolean).join(' · ');

  const title = {
    loading: 'Recording your approval…',
    approved: firstName ? `Thanks, ${firstName}. Your approval is saved.` : 'Thank you. Your approval is saved.',
    invalid: 'This approval link is expired or has already been used.',
    error: 'We could not record your approval.',
  }[status];

  const message = status === 'approved'
    ? 'OptiMenu may share this quote with the name shown.'
    : status === 'loading'
      ? 'This will only take a moment.'
      : 'Please reply to Nick’s email and he can send you a new approval link.';

  const tone = status === 'approved'
    ? ['var(--green-tint, #e9f5ec)', 'var(--green)', <path key="ok" d="M5 12.5l4.5 4.5L19 7.5" />]
    : status === 'loading'
      ? ['var(--accent-tint)', 'var(--accent-deep)', <path key="wait" d="M12 7v5l3 2" />]
      : ['var(--red-tint, #fbeceb)', 'var(--red)', <path key="no" d="M12 7v6M12 16.5v.01" />];

  return (
    <div className="om-app" data-theme={theme} style={{ minHeight: '100dvh', background: 'var(--ground)', color: 'var(--text)', fontFamily: "'Manrope', system-ui, sans-serif", display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px 16px', boxSizing: 'border-box' }}>
      <Head>
        <title>Quote approval · OptiMenu</title>
        <meta name="robots" content="noindex, nofollow" />
        {FONT_LINKS}
      </Head>
      <style>{CSS}</style>

      <main style={{ width: '100%', maxWidth: 480, boxSizing: 'border-box', background: 'var(--shell)', border: '1px solid var(--line)', borderRadius: 16, boxShadow: 'var(--shadow)', padding: '28px 26px', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div>
          <img className="om-logo-light" src="/landing/logo.png" alt="optiMenu Solutions" style={{ height: 22, width: 'auto' }} />
          <img className="om-logo-dark" src="/landing/logo-knockout.png" alt="optiMenu Solutions" style={{ height: 22, width: 'auto' }} />
        </div>

        <span style={{ width: 44, height: 44, borderRadius: '50%', background: tone[0], color: tone[1], display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {status === 'loading' && <circle cx="12" cy="12" r="9" />}
            {tone[2]}
          </svg>
        </span>

        <div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1.2 }}>{title}</h1>
          <p style={{ margin: '8px 0 0', color: 'var(--muted)', fontSize: 14, lineHeight: 1.6 }}>{message}</p>
        </div>

        {status === 'approved' && approved?.quote && (
          <figure style={{ margin: 0, background: 'var(--paper)', color: 'var(--ink)', borderRadius: 4, padding: '16px 18px', boxShadow: '0 1px 1px rgba(17,24,25,0.05), 0 3px 6px rgba(17,24,25,0.07)' }}>
            <blockquote style={{ margin: 0, fontSize: 16, fontWeight: 700, lineHeight: 1.45 }}>
              “{approved.quote}”
            </blockquote>
            {attribution && (
              <figcaption style={{ marginTop: 10, paddingTop: 8, borderTop: '1px dashed var(--paper-line)', fontFamily: MONO, fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>
                {attribution}
              </figcaption>
            )}
          </figure>
        )}

        {status === 'approved' && (
          <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.55, color: 'var(--muted)' }}>
            Changed your mind? Reply to Nick’s email and we’ll take it down.
          </p>
        )}

        <a href="https://www.opti-menu.com" style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent-deep)', textDecoration: 'none' }}>
          opti-menu.com →
        </a>
      </main>
    </div>
  );
}