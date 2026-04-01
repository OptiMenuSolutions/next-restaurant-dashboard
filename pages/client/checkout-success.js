// pages/client/checkout-success.js
import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import supabase from '../../lib/supabaseClient';

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;1,400&family=Inter:wght@400;500;600&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { height: 100%; background: #0a0908; }
  #__next { height: 100%; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(20px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes pop {
    0%   { transform: scale(0.5); opacity: 0; }
    70%  { transform: scale(1.15); }
    100% { transform: scale(1); opacity: 1; }
  }

  .cs-root {
    font-family: 'Inter', sans-serif;
    background: #0a0908;
    color: #e8e2d8;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px 16px;
  }

  .cs-card {
    width: 100%;
    max-width: 440px;
    text-align: center;
    animation: fadeUp .5s ease both;
  }

  .cs-icon {
    width: 72px; height: 72px;
    border-radius: 50%;
    background: rgba(2,164,186,.12);
    border: 2px solid rgba(2,164,186,.3);
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 0 auto 24px;
    animation: pop .5s cubic-bezier(.175,.885,.32,1.275) .2s both;
  }

  .cs-heading {
    font-family: 'Playfair Display', serif;
    font-size: clamp(22px,2vw,30px);
    color: #e8e2d8;
    margin-bottom: 10px;
    line-height: 1.2;
  }

  .cs-sub {
    font-size: clamp(13px,.95vw,15px);
    color: #4a453e;
    line-height: 1.6;
    margin-bottom: 32px;
  }

  .cs-features {
    background: #13120f;
    border: 1px solid #2a2620;
    border-radius: 10px;
    padding: 20px;
    margin-bottom: 24px;
    text-align: left;
  }
  .cs-features-title {
    font-size: clamp(9px,.68vw,11px);
    font-weight: 600;
    color: #4a453e;
    text-transform: uppercase;
    letter-spacing: .8px;
    margin-bottom: 12px;
  }
  .cs-feature {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 0;
    border-bottom: 1px solid #1a1915;
    font-size: clamp(12px,.88vw,14px);
    color: #9a9086;
  }
  .cs-feature:last-child { border-bottom: none; }
  .cs-feature-dot {
    width: 6px; height: 6px;
    border-radius: 50%;
    background: #02a4ba;
    flex-shrink: 0;
  }

  .cs-btn {
    width: 100%;
    padding: clamp(13px,1.3vw,16px);
    border-radius: 9px;
    font-size: clamp(14px,1.05vw,16px);
    font-weight: 600;
    cursor: pointer;
    font-family: 'Inter', sans-serif;
    border: none;
    background: #02a4ba;
    color: #0a0908;
    transition: background .2s;
  }
  .cs-btn:hover { background: #01bcd4; }
  .cs-btn:disabled { opacity: .5; cursor: not-allowed; }

  .cs-logo {
    font-family: 'Playfair Display', serif;
    font-size: clamp(14px,1.1vw,18px);
    color: #e8e2d8;
    letter-spacing: -.3px;
    margin-bottom: 32px;
  }
  .cs-logo span { color: #02a4ba; }
`;

export default function CheckoutSuccessPage() {
  const router = useRouter();
  const [verified, setVerified] = useState(false);
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    // Give the webhook a moment to fire and update Supabase,
    // then verify the user is authenticated before showing the page
    const timer = setTimeout(async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/client/login'); return; }
      setVerified(true);
    }, 1000);
    return () => clearTimeout(timer);
  }, []);

  function handleGoToDashboard() {
    setRedirecting(true);
    router.push('/client/dashboard?tour=true');
  }

  if (!verified) return (
    <>
      <style>{CSS}</style>
      <div style={{ background: '#0a0908', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 26, height: 26, border: '2px solid #2a2620', borderTopColor: '#02a4ba', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
      </div>
    </>
  );

  return (
    <>
      <style>{CSS}</style>
      <div className="cs-root">
        <div className="cs-card">

          <div className="cs-logo">Opti<span>Menu</span></div>

          <div className="cs-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#02a4ba" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          </div>

          <div className="cs-heading">You're in.</div>
          <div className="cs-sub">
            Welcome to OptiMenu. Your Founding Member rate of $59/month is locked in for life.
          </div>

          <div className="cs-features">
            <div className="cs-features-title">Everything included</div>
            {[
              'Invoice & supplier tracking',
              'Ingredient cost management',
              'Menu engineering & margin analysis',
              'POS analytics & sales insights',
              'AI daily dish recommendations',
            ].map(f => (
              <div key={f} className="cs-feature">
                <div className="cs-feature-dot" />
                {f}
              </div>
            ))}
          </div>

          <button className="cs-btn" onClick={handleGoToDashboard} disabled={redirecting}>
            {redirecting ? 'Loading your dashboard...' : 'Go to Dashboard →'}
          </button>

        </div>
      </div>
    </>
  );
}