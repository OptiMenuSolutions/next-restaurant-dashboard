import { useEffect, useState } from 'react';

export default function TestimonialApprovalPage() {
  const [status, setStatus] = useState('loading');

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
      .then(({ ok }) => {
        if (active) setStatus(ok ? 'approved' : 'invalid');
      })
      .catch(() => {
        if (active) setStatus('error');
      });

    return () => { active = false; };
  }, []);

  const title = {
    loading: 'Recording your approval…',
    approved: 'Thank you. Your approval is recorded.',
    invalid: 'This approval link is expired or has already been used.',
    error: 'We could not record your approval.',
  }[status];

  const message = status === 'approved'
    ? 'OptiMenu may use the quote with the attribution shown in the email.'
    : status === 'loading'
      ? 'This will only take a moment.'
      : 'Please reply to Nick’s email and he can send you a new approval link.';

  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: '#f4f6f6', color: '#111819', fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" }}>
      <section style={{ width: '100%', maxWidth: 520, boxSizing: 'border-box', padding: 28, border: '1px solid #d8dfe0', borderRadius: 14, background: '#ffffff' }}>
        <div style={{ marginBottom: 18, color: '#03808f', fontSize: 15, fontWeight: 800 }}>OptiMenu</div>
        <h1 style={{ margin: '0 0 12px', fontSize: 25, lineHeight: 1.2 }}>{title}</h1>
        <p style={{ margin: 0, color: '#4b585b', fontSize: 15, lineHeight: 1.6 }}>{message}</p>
      </section>
    </main>
  );
}