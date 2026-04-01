// pages/client/onboarding.js
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import supabase from '../../lib/supabaseClient';

const CUISINE_TYPES = [
  'American', 'Italian', 'Mexican', 'Asian Fusion', 'Japanese',
  'Chinese', 'Indian', 'Mediterranean', 'French', 'Seafood',
  'Steakhouse', 'Pizza', 'Burger', 'Cafe / Bakery', 'Bar & Grill',
  'Vegetarian / Vegan', 'Other',
];

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;1,400&family=Inter:wght@400;500;600&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { height: 100%; background: #0a0908; }
  #__next { height: 100%; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(16px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  input::placeholder { color: #3a3630 !important; }
  ::-webkit-scrollbar { width: 3px; }
  ::-webkit-scrollbar-track { background: #0f0e0c; }
  ::-webkit-scrollbar-thumb { background: #2a2620; border-radius: 2px; }

  .ob-root {
    font-family: 'Inter', sans-serif;
    background: #0a0908;
    color: #e8e2d8;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 24px 16px;
  }

  .ob-card {
    width: 100%;
    max-width: 480px;
    animation: fadeUp .45s ease both;
  }

  /* LOGO */
  .ob-logo {
    font-family: 'Playfair Display', serif;
    font-size: clamp(22px,2vw,28px);
    color: #e8e2d8;
    letter-spacing: -.4px;
    text-align: center;
    margin-bottom: 6px;
  }
  .ob-logo span { color: #02a4ba; }
  .ob-tagline {
    text-align: center;
    font-size: clamp(12px,.9vw,14px);
    color: #4a453e;
    margin-bottom: clamp(28px,3vw,40px);
  }

  /* STEPS */
  .ob-steps {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    margin-bottom: clamp(24px,2.5vw,36px);
  }
  .ob-step-dot {
    width: 8px; height: 8px;
    border-radius: 50%;
    background: #2a2620;
    transition: background .2s, transform .2s;
  }
  .ob-step-dot.active { background: #02a4ba; transform: scale(1.3); }
  .ob-step-dot.done { background: #02a4ba; opacity: .4; }

  /* CARD */
  .ob-box {
    background: #13120f;
    border: 1px solid #2a2620;
    border-radius: 12px;
    padding: clamp(20px,2.5vw,32px);
    margin-bottom: 16px;
  }
  .ob-step-label {
    font-size: clamp(9px,.68vw,11px);
    font-weight: 600;
    color: #4a453e;
    text-transform: uppercase;
    letter-spacing: .8px;
    margin-bottom: 6px;
  }
  .ob-heading {
    font-family: 'Playfair Display', serif;
    font-size: clamp(18px,1.6vw,24px);
    color: #e8e2d8;
    margin-bottom: 6px;
    line-height: 1.2;
  }
  .ob-sub {
    font-size: clamp(12px,.88vw,14px);
    color: #4a453e;
    margin-bottom: clamp(18px,2vw,24px);
    line-height: 1.5;
  }

  /* INPUTS */
  .ob-label {
    font-size: clamp(10px,.75vw,12px);
    color: #6b6358;
    text-transform: uppercase;
    letter-spacing: .5px;
    margin-bottom: 7px;
    display: block;
  }
  .ob-input {
    width: 100%;
    background: #0f0e0c;
    border: 1px solid #2a2620;
    border-radius: 8px;
    padding: clamp(11px,1.1vw,14px) clamp(12px,1.1vw,16px);
    font-size: clamp(14px,1.05vw,16px);
    color: #e8e2d8;
    outline: none;
    font-family: 'Inter', sans-serif;
    transition: border-color .15s;
    margin-bottom: clamp(14px,1.4vw,20px);
  }
  .ob-input:focus { border-color: #02a4ba; }

  /* CUISINE GRID */
  .ob-cuisine-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 8px;
    margin-bottom: clamp(14px,1.4vw,20px);
  }
  .ob-cuisine-chip {
    padding: 9px 12px;
    border-radius: 8px;
    font-size: clamp(11px,.82vw,13px);
    color: #6b6358;
    background: #0f0e0c;
    border: 1px solid #2a2620;
    cursor: pointer;
    text-align: center;
    transition: all .15s;
    font-family: 'Inter', sans-serif;
  }
  .ob-cuisine-chip:hover { border-color: #3a3630; color: #9a9086; }
  .ob-cuisine-chip.selected { background: rgba(2,164,186,.1); border-color: rgba(2,164,186,.4); color: #02a4ba; }

  /* PLAN CARD */
  .ob-plan {
    background: rgba(2,164,186,.06);
    border: 1px solid rgba(2,164,186,.2);
    border-radius: 10px;
    padding: clamp(14px,1.4vw,20px);
    margin-bottom: clamp(18px,1.8vw,24px);
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .ob-plan-name {
    font-size: clamp(14px,1.05vw,16px);
    font-weight: 600;
    color: #e8e2d8;
    margin-bottom: 4px;
  }
  .ob-plan-features {
    font-size: clamp(11px,.82vw,13px);
    color: #4a453e;
    line-height: 1.6;
  }
  .ob-plan-features li { list-style: none; }
  .ob-plan-features li::before { content: '✓  '; color: #02a4ba; }
  .ob-plan-price {
    text-align: right;
    flex-shrink: 0;
    margin-left: 16px;
  }
  .ob-plan-amount {
    font-family: 'Playfair Display', serif;
    font-size: clamp(26px,2.2vw,34px);
    color: #02a4ba;
    line-height: 1;
  }
  .ob-plan-period {
    font-size: clamp(10px,.75vw,12px);
    color: #4a453e;
    margin-top: 3px;
  }
  .ob-plan-badge {
    font-size: clamp(9px,.68vw,10px);
    font-weight: 600;
    color: #02a4ba;
    text-transform: uppercase;
    letter-spacing: .6px;
    margin-top: 5px;
  }

  /* BUTTONS */
  .ob-btn {
    width: 100%;
    padding: clamp(13px,1.3vw,16px);
    border-radius: 9px;
    font-size: clamp(14px,1.05vw,16px);
    font-weight: 600;
    cursor: pointer;
    font-family: 'Inter', sans-serif;
    border: none;
    transition: all .2s;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
  }
  .ob-btn.primary { background: #02a4ba; color: #0a0908; }
  .ob-btn.primary:hover { background: #01bcd4; }
  .ob-btn.primary:disabled { opacity: .5; cursor: not-allowed; }
  .ob-btn.ghost { background: none; color: #4a453e; border: 1px solid #2a2620; margin-top: 10px; font-size: clamp(12px,.88vw,14px); }
  .ob-btn.ghost:hover { color: #9a9086; border-color: #3a3630; }

  /* ERROR */
  .ob-error {
    font-size: clamp(11px,.82vw,13px);
    color: #c04040;
    margin-bottom: 12px;
    padding: 10px 14px;
    background: rgba(192,64,64,.08);
    border: 1px solid rgba(192,64,64,.2);
    border-radius: 7px;
  }

  /* CANCELED BANNER */
  .ob-canceled {
    font-size: clamp(11px,.82vw,13px);
    color: #b07030;
    margin-bottom: 16px;
    padding: 10px 14px;
    background: rgba(176,112,48,.08);
    border: 1px solid rgba(176,112,48,.2);
    border-radius: 7px;
    text-align: center;
  }

  .ob-spinner {
    width: 18px; height: 18px;
    border: 2px solid rgba(10,9,8,.3);
    border-top-color: #0a0908;
    border-radius: 50%;
    animation: spin .6s linear infinite;
    flex-shrink: 0;
  }
`;

export default function OnboardingPage() {
  const router = useRouter();
  const { canceled } = router.query;

  const [step, setStep] = useState(1); // 1 = restaurant info, 2 = payment
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [userId, setUserId] = useState(null);
  const [userEmail, setUserEmail] = useState('');
  const [restaurantId, setRestaurantId] = useState(null);

  const [restaurantName, setRestaurantName] = useState('');
  const [cuisineType, setCuisineType] = useState('');

  useEffect(() => { init(); }, []);

  async function init() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push('/client/login'); return; }

    setUserId(user.id);
    setUserEmail(user.email || '');

    const { data: profile } = await supabase
      .from('profiles')
      .select('restaurant_id')
      .eq('id', user.id)
      .single();

    if (profile?.restaurant_id) {
      // Check if already subscribed — skip onboarding
      const { data: rest } = await supabase
        .from('restaurants')
        .select('subscription_status, name')
        .eq('id', profile.restaurant_id)
        .single();

      if (rest?.subscription_status === 'active') {
        router.replace('/client/dashboard');
        return;
      }
      setRestaurantId(profile.restaurant_id);
      setRestaurantName(rest?.name || '');
    }

    setLoading(false);
  }

  async function handleStep1() {
    if (!restaurantName.trim()) { setError('Please enter your restaurant name'); return; }
    if (!cuisineType) { setError('Please select a cuisine type'); return; }
    setError('');
    setSubmitting(true);

    try {
      if (restaurantId) {
        // Update existing restaurant
        await supabase
          .from('restaurants')
          .update({ name: restaurantName.trim(), cuisine_type: cuisineType })
          .eq('id', restaurantId);
      } else {
        // Create restaurant and link to profile
        const { data: newRest, error: restErr } = await supabase
          .from('restaurants')
          .insert([{ name: restaurantName.trim(), cuisine_type: cuisineType, target_food_cost: 30 }])
          .select()
          .single();

        if (restErr) throw restErr;

        await supabase
          .from('profiles')
          .update({ restaurant_id: newRest.id })
          .eq('id', userId);

        setRestaurantId(newRest.id);
      }
      setStep(2);
    } catch (err) {
      setError('Something went wrong. Please try again.');
      console.error(err);
    }
    setSubmitting(false);
  }

  async function handleCheckout() {
    setSubmitting(true);
    setError('');

    try {
      const res = await fetch('/api/stripe/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restaurantId, userId, email: userEmail }),
      });
      const { url, error: apiError } = await res.json();
      if (apiError) throw new Error(apiError);
      window.location.href = url;
    } catch (err) {
      setError('Failed to start checkout. Please try again.');
      setSubmitting(false);
    }
  }

  if (loading) return (
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
      <div className="ob-root">
        <div className="ob-card">

          <div className="ob-logo">Opti<span>Menu</span></div>
          <div className="ob-tagline">Smart cost management for independent restaurants</div>

          {/* Step indicators */}
          <div className="ob-steps">
            <div className={`ob-step-dot ${step === 1 ? 'active' : 'done'}`} />
            <div className={`ob-step-dot ${step === 2 ? 'active' : ''}`} />
          </div>

          {canceled && (
            <div className="ob-canceled">
              Checkout was canceled — no charge was made. You can try again whenever you're ready.
            </div>
          )}

          {error && <div className="ob-error">{error}</div>}

          {/* ── STEP 1: Restaurant info ── */}
          {step === 1 && (
            <div className="ob-box">
              <div className="ob-step-label">Step 1 of 2</div>
              <div className="ob-heading">Tell us about your restaurant</div>
              <div className="ob-sub">This takes 30 seconds. You can change everything later.</div>

              <label className="ob-label">Restaurant Name</label>
              <input
                className="ob-input"
                placeholder="e.g. The Oak Room"
                value={restaurantName}
                onChange={e => setRestaurantName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleStep1()}
                autoFocus
              />

              <label className="ob-label">Cuisine Type</label>
              <div className="ob-cuisine-grid">
                {CUISINE_TYPES.map(c => (
                  <button
                    key={c}
                    className={`ob-cuisine-chip${cuisineType === c ? ' selected' : ''}`}
                    onClick={() => setCuisineType(c)}
                  >
                    {c}
                  </button>
                ))}
              </div>

              <button className="ob-btn primary" onClick={handleStep1} disabled={submitting}>
                {submitting ? <><div className="ob-spinner" />Saving...</> : 'Continue →'}
              </button>
            </div>
          )}

          {/* ── STEP 2: Payment ── */}
          {step === 2 && (
            <div className="ob-box">
              <div className="ob-step-label">Step 2 of 2</div>
              <div className="ob-heading">Start your subscription</div>
              <div className="ob-sub">You're signing up as a Founding Member — this rate is locked in for as long as you stay subscribed.</div>

              <div className="ob-plan">
                <div>
                  <div className="ob-plan-name">Founding Member</div>
                  <ul className="ob-plan-features">
                    <li>Invoice & ingredient tracking</li>
                    <li>Menu cost analysis</li>
                    <li>AI dish recommendations</li>
                    <li>POS analytics</li>
                  </ul>
                  <div className="ob-plan-badge">Rate locked for life</div>
                </div>
                <div className="ob-plan-price">
                  <div className="ob-plan-amount">$59</div>
                  <div className="ob-plan-period">/month</div>
                </div>
              </div>

              <button className="ob-btn primary" onClick={handleCheckout} disabled={submitting}>
                {submitting ? <><div className="ob-spinner" />Redirecting to checkout...</> : '🔒 Pay with Stripe'}
              </button>
              <button className="ob-btn ghost" onClick={() => setStep(1)}>← Back</button>
            </div>
          )}

        </div>
      </div>
    </>
  );
}