// pages/index.js
import Head from 'next/head';
import Link from 'next/link';
import { useState } from 'react';

const FEATURES = [
  {
    title: 'Real-time cost tracking',
    desc: 'Connect your invoices and track ingredient costs as they change. Know immediately when a supplier price spike hits your margins.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="#02a4ba" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M3 9h18M9 21V9" />
      </svg>
    ),
  },
  {
    title: 'Margin alerts',
    desc: 'Set food cost targets per item. Get notified the moment a dish exceeds your threshold — before it quietly erodes your bottom line.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="#02a4ba" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 6v6l4 2" />
      </svg>
    ),
  },
  {
    title: 'AI menu optimization',
    desc: 'OptiMenu analyzes your full menu and surfaces which dishes to reprice, reposition, or rework to maximize profitability.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="#02a4ba" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
      </svg>
    ),
  },
  {
    title: 'Invoice management',
    desc: 'Upload supplier invoices and let OptiMenu extract and categorize line items automatically. One less thing to manage manually.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="#02a4ba" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
      </svg>
    ),
  },
  {
    title: 'Profitability reports',
    desc: 'Weekly and monthly summaries of food cost trends, best-performing dishes, and where you\'re leaving money on the table.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="#02a4ba" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
        <line x1="18" y1="20" x2="18" y2="10" />
        <line x1="12" y1="20" x2="12" y2="4" />
        <line x1="6" y1="20" x2="6" y2="14" />
      </svg>
    ),
  },
  {
    title: 'Built for independents',
    desc: 'No per-location enterprise pricing. No mandatory onboarding calls. Get set up in an afternoon and start seeing value the same day.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="#02a4ba" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
        <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 00-3-3.87" />
        <path d="M16 3.13a4 4 0 010 7.75" />
      </svg>
    ),
  },
];

const FAQS = [
  {
    q: 'What kind of restaurants is OptiMenu built for?',
    a: "OptiMenu is designed specifically for independent operators — single-location restaurants, small multi-location groups, and chef-owned concepts that don't have a full finance team. If you're manually tracking food costs in a spreadsheet (or not tracking them at all), OptiMenu is built for you.",
  },
  {
    q: 'How long does setup take?',
    a: "Most operators are fully set up within a single afternoon. You'll enter your menu items, add ingredient costs (or upload a supplier invoice), and you're live. There's no onboarding call required — though we're happy to jump on one if you'd like.",
  },
  {
    q: 'What does the founding member rate include?',
    a: 'Founding members get full access to every feature in OptiMenu — including all future features as they\'re released — at $59/month, locked for life. The standard rate after the founding cohort closes is $79/month. Only the first 25 operators qualify.',
  },
  {
    q: 'Does OptiMenu integrate with my POS system?',
    a: 'POS integrations are on the roadmap, with Positouch/Shift4 prioritized first. Currently OptiMenu works as a standalone cost and menu management tool. You can import data via CSV or enter it manually — simpler than it sounds.',
  },
  {
    q: 'Can I cancel anytime?',
    a: 'Yes, absolutely. There are no long-term contracts or cancellation fees. You can cancel your subscription at any time from your account settings and retain access through the end of your billing period.',
  },
];

const DASH_ITEMS = [
  { name: 'Truffle Risotto', cost: '24.1%', target: '30%', pct: 55, good: true },
  { name: 'Burrata Salad',   cost: '38.7%', target: '30%', pct: 88, good: false },
  { name: 'Grilled Salmon',  cost: '27.3%', target: '30%', pct: 64, good: true },
  { name: 'Short Rib Tacos', cost: '34.2%', target: '28%', pct: 78, good: false },
];

function CheckIcon() {
  return (
    <svg viewBox="0 0 12 12" width="8" height="8" fill="none" stroke="#02a4ba" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="2,6 5,9 10,3" />
    </svg>
  );
}

function FaqItem({ q, a }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      onClick={() => setOpen(!open)}
      style={{
        borderBottom: '1px solid #e8e4de',
        padding: '18px 0',
        cursor: 'pointer',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
        <span style={{ fontSize: 14, fontWeight: 500, color: '#1a1a1a' }}>{q}</span>
        <div style={{
          width: 20, height: 20, borderRadius: '50%',
          border: `1px solid ${open ? '#02a4ba' : '#e8e4de'}`,
          background: open ? '#02a4ba' : 'transparent',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0, color: open ? '#0f0e0c' : '#9a9086',
          fontSize: 14, fontWeight: 300,
          transition: 'all 0.2s',
        }}>
          {open ? '−' : '+'}
        </div>
      </div>
      {open && (
        <p style={{ fontSize: 13, color: '#7a7268', lineHeight: 1.7, fontWeight: 400, marginTop: 10 }}>
          {a}
        </p>
      )}
    </div>
  );
}

export default function Landing() {
  return (
    <>
      <Head>
        <title>OptiMenu — Restaurant Intelligence for Independent Operators</title>
        <meta name="description" content="Real-time food cost tracking, AI-powered menu optimization, and margin insights — built for independent restaurants." />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;1,400&family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet" />
      </Head>

      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html { scroll-behavior: smooth; }
        body { font-family: 'Inter', sans-serif; background: #ffffff; color: #1a1a1a; }

        .lp-nav-link { font-size: 13px; color: #7a7268; font-weight: 400; cursor: pointer; transition: color 0.2s; text-decoration: none; }
        .lp-nav-link:hover { color: #e8e2d8; }

        .lp-btn-ghost { background: transparent; border: 1px solid #2a2620; border-radius: 8px; padding: 13px 26px; font-family: 'Inter', sans-serif; font-size: 13px; font-weight: 400; color: #7a7268; cursor: pointer; transition: border-color 0.2s, color 0.2s; }
        .lp-btn-ghost:hover { border-color: #4a453e; color: #e8e2d8; }

        .lp-feature-card { background: #ffffff; border: 1px solid #e8e4de; border-radius: 12px; padding: 22px 20px; }
        .lp-price-card { background: #ffffff; border: 1px solid #e8e4de; border-radius: 14px; padding: 30px 26px; position: relative; }
        .lp-price-card.featured { border: 2px solid #02a4ba; }

        .lp-price-btn-outline { width: 100%; border-radius: 8px; padding: 11px; font-family: 'Inter', sans-serif; font-size: 13px; font-weight: 600; cursor: pointer; background: transparent; border: 1px solid #e8e4de; color: #7a7268; transition: all 0.2s; }
        .lp-price-btn-outline:hover { border-color: #02a4ba; color: #02a4ba; }

        .lp-footer-link { font-size: 12px; color: #4a453e; text-decoration: none; transition: color 0.2s; }
        .lp-footer-link:hover { color: #7a7268; }

        .lp-dash-row { display: grid; grid-template-columns: 2fr 1fr 1fr 1fr; padding: 8px 12px; border-bottom: 1px solid #1a1915; align-items: center; }
        .lp-dash-row:last-child { border-bottom: none; }
      `}</style>

      <div style={{ fontFamily: "'Inter', sans-serif", background: '#ffffff', color: '#1a1a1a' }}>

        {/* ── NAV ── */}
        <nav style={{
          background: '#0f0e0c', padding: '0 48px', height: 60,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          borderBottom: '1px solid #2a2620', position: 'sticky', top: 0, zIndex: 100,
        }}>
          <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 20, fontWeight: 500, color: '#e8e2d8', letterSpacing: '-0.3px' }}>
            Opti<span style={{ color: '#02a4ba' }}>Menu</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 32 }}>
            <a href="#features" className="lp-nav-link">Features</a>
            <a href="#pricing" className="lp-nav-link">Pricing</a>
            <a href="#faq" className="lp-nav-link">FAQ</a>
            <Link href="/client/login" className="lp-nav-link">Sign in</Link>
            <Link href="/client/signup">
              <button style={{
                background: '#02a4ba', border: 'none', borderRadius: 6,
                padding: '8px 18px', fontFamily: "'Inter', sans-serif",
                fontSize: 12, fontWeight: 600, color: '#0f0e0c',
                cursor: 'pointer', letterSpacing: '0.6px', textTransform: 'uppercase',
                transition: 'background 0.2s',
              }}>
                Get started
              </button>
            </Link>
          </div>
        </nav>

        {/* ── HERO ── */}
        <section style={{
          background: '#0f0e0c', padding: '88px 48px 96px',
          textAlign: 'center', position: 'relative', overflow: 'hidden',
        }}>
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
            background: 'radial-gradient(ellipse at 50% 60%, rgba(2,164,186,0.1) 0%, transparent 65%)',
            pointerEvents: 'none',
          }} />
          <div style={{
            display: 'inline-block', fontSize: 11, letterSpacing: '2.5px',
            textTransform: 'uppercase', color: '#02a4ba', fontWeight: 500,
            marginBottom: 20, border: '1px solid rgba(2,164,186,0.25)',
            padding: '5px 14px', borderRadius: 20,
          }}>
            Now in early access
          </div>
          <h1 style={{
            fontFamily: "'Playfair Display', serif", fontSize: 52, fontWeight: 400,
            color: '#e8e2d8', lineHeight: 1.15, letterSpacing: '-0.5px',
            marginBottom: 22, maxWidth: 680, marginLeft: 'auto', marginRight: 'auto',
          }}>
            The back office your restaurant{' '}
            <em style={{ fontStyle: 'italic', color: '#02a4ba' }}>actually</em> deserves.
          </h1>
          <p style={{
            fontSize: 15, color: '#7a7268', lineHeight: 1.7, fontWeight: 300,
            maxWidth: 480, margin: '0 auto 40px',
          }}>
            Real-time food cost tracking, AI-powered menu optimization, and margin insights — built for independent operators, not enterprise chains.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, marginBottom: 56 }}>
            <Link href="/client/signup">
              <button style={{
                background: '#02a4ba', border: 'none', borderRadius: 8,
                padding: '13px 26px', fontFamily: "'Inter', sans-serif",
                fontSize: 13, fontWeight: 600, color: '#0f0e0c',
                cursor: 'pointer', transition: 'background 0.2s',
              }}>
                Start free — no card required
              </button>
            </Link>
            <a href="#features">
              <button className="lp-btn-ghost">See how it works</button>
            </a>
          </div>
          <div style={{ fontSize: 12, color: '#4a453e', fontWeight: 300, letterSpacing: '0.2px' }}>
            Founding member rate: $59/mo locked for life &nbsp;·&nbsp; First 25 operators only
          </div>
        </section>

        {/* ── DASHBOARD MOCKUP ── */}
        <div style={{ background: '#0f0e0c', padding: '0 48px', display: 'flex', justifyContent: 'center' }}>
          <div style={{
            background: '#1a1915', border: '1px solid #2a2620',
            borderRadius: '12px 12px 0 0', width: '100%', maxWidth: 760,
            padding: 16, borderBottom: 'none',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 14 }}>
              {[0,1,2].map(i => <div key={i} style={{ width: 8, height: 8, borderRadius: '50%', background: '#3a3630' }} />)}
              <div style={{
                flex: 1, background: '#0f0e0c', borderRadius: 4, height: 20,
                marginLeft: 8, display: 'flex', alignItems: 'center', padding: '0 8px',
              }}>
                <span style={{ fontSize: 10, color: '#4a453e', fontFamily: 'monospace' }}>app.optimenu.io/dashboard</span>
              </div>
            </div>

            {/* Stat cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 10 }}>
              {[
                { label: 'Avg food cost',      val: '28.4%',  delta: '▲ 1.2% vs last week',    accent: true },
                { label: 'Menu items tracked', val: '42',     delta: 'across 3 categories',     neutral: true },
                { label: 'Items over target',  val: '5',      delta: 'needs attention',          warn: true },
                { label: 'Est. monthly savings', val: '$1,240', delta: 'vs. 90-day avg',         accent: true },
              ].map(({ label, val, delta, accent, warn, neutral }) => (
                <div key={label} style={{ background: '#0f0e0c', border: '1px solid #2a2620', borderRadius: 8, padding: '10px 12px' }}>
                  <div style={{ fontSize: 10, color: '#4a453e', marginBottom: 4, letterSpacing: '0.3px' }}>{label}</div>
                  <div style={{
                    fontSize: 18, fontFamily: "'Playfair Display', serif",
                    color: warn ? '#e07060' : accent ? '#02a4ba' : '#e8e2d8',
                  }}>{val}</div>
                  <div style={{ fontSize: 10, marginTop: 2, color: warn ? '#e07060' : neutral ? '#4a453e' : '#3a8a5a' }}>{delta}</div>
                </div>
              ))}
            </div>

            {/* Table */}
            <div style={{ background: '#0f0e0c', border: '1px solid #2a2620', borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', padding: '7px 12px', borderBottom: '1px solid #2a2620' }}>
                {['Menu item', 'Food cost %', 'Target', 'Status'].map(h => (
                  <span key={h} style={{ fontSize: 9, color: '#4a453e', letterSpacing: '1px', textTransform: 'uppercase' }}>{h}</span>
                ))}
              </div>
              {DASH_ITEMS.map(({ name, cost, target, pct, good }) => (
                <div key={name} className="lp-dash-row">
                  <span style={{ fontSize: 11, color: '#e8e2d8' }}>{name}</span>
                  <span style={{ fontSize: 11, color: good ? '#3a8a5a' : '#e07060' }}>{cost}</span>
                  <span style={{ fontSize: 11, color: '#9a9086' }}>{target}</span>
                  <div style={{ background: '#2a2620', borderRadius: 3, height: 4, width: 60 }}>
                    <div style={{ height: 4, borderRadius: 3, background: good ? '#02a4ba' : '#e07060', width: `${pct}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── TRANSITION ── */}
        <div style={{ background: 'linear-gradient(to bottom, #0f0e0c 0%, #f8f7f4 100%)', height: 80 }} />

        {/* ── FEATURES ── */}
        <section id="features" style={{ background: '#f8f7f4', padding: '72px 48px' }}>
          <div style={{ fontSize: 11, letterSpacing: '2px', textTransform: 'uppercase', color: '#02a4ba', fontWeight: 600, textAlign: 'center', marginBottom: 10 }}>What you get</div>
          <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 36, fontWeight: 400, color: '#1a1a1a', textAlign: 'center', marginBottom: 10, letterSpacing: '-0.3px', lineHeight: 1.2 }}>
            Everything you need to run a <em style={{ fontStyle: 'italic', color: '#02a4ba' }}>tighter kitchen</em>
          </h2>
          <p style={{ fontSize: 14, color: '#7a7268', textAlign: 'center', fontWeight: 400, lineHeight: 1.65, maxWidth: 500, margin: '0 auto 52px' }}>
            No bloated enterprise features. No learning curve. Just the tools independent operators actually use every day.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, maxWidth: 900, margin: '0 auto' }}>
            {FEATURES.map(({ title, desc, icon }) => (
              <div key={title} className="lp-feature-card">
                <div style={{
                  width: 32, height: 32, background: 'rgba(2,164,186,0.08)',
                  borderRadius: 7, display: 'flex', alignItems: 'center',
                  justifyContent: 'center', marginBottom: 12,
                }}>
                  {icon}
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a', marginBottom: 6, letterSpacing: '-0.1px' }}>{title}</div>
                <div style={{ fontSize: 12, color: '#7a7268', lineHeight: 1.6, fontWeight: 400 }}>{desc}</div>
              </div>
            ))}
          </div>
        </section>

        {/* ── HOW IT WORKS ── */}
        <section style={{ background: '#ffffff', padding: '72px 48px' }}>
          <div style={{ fontSize: 11, letterSpacing: '2px', textTransform: 'uppercase', color: '#02a4ba', fontWeight: 600, textAlign: 'center', marginBottom: 10 }}>How it works</div>
          <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 36, fontWeight: 400, color: '#1a1a1a', textAlign: 'center', marginBottom: 10, letterSpacing: '-0.3px', lineHeight: 1.2 }}>
            Up and running in <em style={{ fontStyle: 'italic', color: '#02a4ba' }}>one afternoon</em>
          </h2>
          <p style={{ fontSize: 14, color: '#7a7268', textAlign: 'center', fontWeight: 400, lineHeight: 1.65, maxWidth: 500, margin: '0 auto 52px' }}>
            No IT department required. OptiMenu is designed to be set up by the person who actually runs the restaurant.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', maxWidth: 820, margin: '0 auto' }}>
            {[
              { n: '1', title: 'Add your menu', desc: 'Enter your dishes and their ingredients. Import from a spreadsheet or build from scratch in minutes.' },
              { n: '2', title: 'Connect your costs', desc: 'Upload supplier invoices or enter ingredient costs manually. OptiMenu maps everything to your menu automatically.' },
              { n: '3', title: 'Act on the insights', desc: 'See exactly which dishes are over target, which to reprice, and how to improve your margins starting today.' },
            ].map(({ n, title, desc }) => (
              <div key={n} style={{ textAlign: 'center', padding: '0 28px' }}>
                <div style={{
                  width: 40, height: 40, borderRadius: '50%', background: '#0f0e0c',
                  color: '#02a4ba', fontFamily: "'Playfair Display', serif",
                  fontSize: 18, display: 'flex', alignItems: 'center',
                  justifyContent: 'center', margin: '0 auto 14px',
                }}>
                  {n}
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#1a1a1a', marginBottom: 8 }}>{title}</div>
                <div style={{ fontSize: 12, color: '#7a7268', lineHeight: 1.65, fontWeight: 400 }}>{desc}</div>
              </div>
            ))}
          </div>
        </section>

        {/* ── PRICING ── */}
        <section id="pricing" style={{ background: '#f8f7f4', padding: '72px 48px' }}>
          <div style={{ fontSize: 11, letterSpacing: '2px', textTransform: 'uppercase', color: '#02a4ba', fontWeight: 600, textAlign: 'center', marginBottom: 10 }}>Pricing</div>
          <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 36, fontWeight: 400, color: '#1a1a1a', textAlign: 'center', marginBottom: 10, letterSpacing: '-0.3px' }}>
            Simple, honest pricing
          </h2>
          <p style={{ fontSize: 14, color: '#7a7268', textAlign: 'center', fontWeight: 400, lineHeight: 1.65, maxWidth: 480, margin: '0 auto 52px' }}>
            No hidden fees. No per-location upcharges. One flat rate that works whether you run one location or five.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 20, maxWidth: 640, margin: '0 auto' }}>

            {/* Founding card */}
            <div className="lp-price-card featured">
              <div style={{
                position: 'absolute', top: -11, left: '50%', transform: 'translateX(-50%)',
                background: '#02a4ba', color: '#0f0e0c', fontSize: 10, fontWeight: 700,
                letterSpacing: '0.8px', textTransform: 'uppercase', padding: '3px 12px',
                borderRadius: 10, whiteSpace: 'nowrap',
              }}>
                Founding member
              </div>
              <div style={{ fontSize: 11, letterSpacing: '1.5px', textTransform: 'uppercase', color: '#9a9086', fontWeight: 600, marginBottom: 14 }}>Founding rate</div>
              <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 44, fontWeight: 400, color: '#1a1a1a', lineHeight: 1, marginBottom: 4 }}>
                <sup style={{ fontSize: 20, verticalAlign: 'super', fontFamily: "'Inter', sans-serif", fontWeight: 300 }}>$</sup>59
              </div>
              <div style={{ fontSize: 12, color: '#9a9086', fontWeight: 400, marginBottom: 20 }}>per month, locked for life</div>
              <div style={{ height: 1, background: '#e8e4de', marginBottom: 18 }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginBottom: 24 }}>
                {['All features included', 'Unlimited menu items', 'Invoice upload & parsing', 'AI recommendations', 'Priority support', 'Rate locked forever'].map(f => (
                  <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 12, color: '#4a453e', fontWeight: 400 }}>
                    <div style={{ width: 15, height: 15, borderRadius: '50%', background: 'rgba(2,164,186,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <CheckIcon />
                    </div>
                    {f}
                  </div>
                ))}
              </div>
              <Link href="/client/signup">
                <button style={{
                  width: '100%', background: '#02a4ba', border: 'none', borderRadius: 8,
                  padding: 11, fontFamily: "'Inter', sans-serif", fontSize: 13,
                  fontWeight: 600, color: '#0f0e0c', cursor: 'pointer', transition: 'background 0.2s',
                }}>
                  Claim founding rate
                </button>
              </Link>
            </div>

            {/* Standard card */}
            <div className="lp-price-card">
              <div style={{ fontSize: 11, letterSpacing: '1.5px', textTransform: 'uppercase', color: '#9a9086', fontWeight: 600, marginBottom: 14 }}>Standard</div>
              <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 44, fontWeight: 400, color: '#1a1a1a', lineHeight: 1, marginBottom: 4 }}>
                <sup style={{ fontSize: 20, verticalAlign: 'super', fontFamily: "'Inter', sans-serif", fontWeight: 300 }}>$</sup>79
              </div>
              <div style={{ fontSize: 12, color: '#9a9086', fontWeight: 400, marginBottom: 20 }}>per month</div>
              <div style={{ height: 1, background: '#e8e4de', marginBottom: 18 }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginBottom: 24 }}>
                {['All features included', 'Unlimited menu items', 'Invoice upload & parsing', 'AI recommendations', 'Standard support'].map(f => (
                  <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 12, color: '#4a453e', fontWeight: 400 }}>
                    <div style={{ width: 15, height: 15, borderRadius: '50%', background: 'rgba(2,164,186,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <CheckIcon />
                    </div>
                    {f}
                  </div>
                ))}
              </div>
              <Link href="/client/signup">
                <button className="lp-price-btn-outline">Get started</button>
              </Link>
            </div>
          </div>
          <p style={{ textAlign: 'center', fontSize: 12, color: '#9a9086', marginTop: 18, fontWeight: 400 }}>
            14-day free trial. No credit card required to start.
          </p>
        </section>

        {/* ── FAQ ── */}
        <section id="faq" style={{ background: '#ffffff', padding: '72px 48px' }}>
          <div style={{ fontSize: 11, letterSpacing: '2px', textTransform: 'uppercase', color: '#02a4ba', fontWeight: 600, textAlign: 'center', marginBottom: 10 }}>FAQ</div>
          <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 36, fontWeight: 400, color: '#1a1a1a', textAlign: 'center', marginBottom: 10, letterSpacing: '-0.3px' }}>
            Common questions
          </h2>
          <p style={{ fontSize: 14, color: '#7a7268', textAlign: 'center', fontWeight: 400, lineHeight: 1.65, maxWidth: 480, margin: '0 auto 48px' }}>
            Everything you need to know before getting started.
          </p>
          <div style={{ maxWidth: 620, margin: '0 auto' }}>
            {FAQS.map(({ q, a }) => <FaqItem key={q} q={q} a={a} />)}
          </div>
        </section>

        {/* ── CTA BAND ── */}
        <section style={{
          background: '#0f0e0c', padding: '72px 48px',
          textAlign: 'center', position: 'relative', overflow: 'hidden',
        }}>
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
            background: 'radial-gradient(ellipse at 50% 50%, rgba(2,164,186,0.09) 0%, transparent 65%)',
            pointerEvents: 'none',
          }} />
          <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 36, fontWeight: 400, color: '#e8e2d8', marginBottom: 10, letterSpacing: '-0.3px' }}>
            Ready to take control of your <em style={{ fontStyle: 'italic', color: '#02a4ba' }}>margins?</em>
          </h2>
          <p style={{ fontSize: 14, color: '#7a7268', fontWeight: 400, marginBottom: 30 }}>
            Join the founding cohort. First 25 operators lock in $59/month for life.
          </p>
          <Link href="/client/signup">
            <button style={{
              background: '#02a4ba', border: 'none', borderRadius: 8,
              padding: '13px 26px', fontFamily: "'Inter', sans-serif",
              fontSize: 13, fontWeight: 600, color: '#0f0e0c',
              cursor: 'pointer', transition: 'background 0.2s',
            }}>
              Get started free
            </button>
          </Link>
        </section>

        {/* ── FOOTER ── */}
        <footer style={{
          background: '#0f0e0c', borderTop: '1px solid #2a2620',
          padding: '28px 48px', display: 'flex',
          justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 16, color: '#4a453e' }}>
            Opti<span style={{ color: '#02a4ba' }}>Menu</span>
          </div>
          <div style={{ display: 'flex', gap: 24 }}>
            <a href="#" className="lp-footer-link">Privacy</a>
            <a href="#" className="lp-footer-link">Terms</a>
            <a href="#" className="lp-footer-link">Contact</a>
          </div>
          <div style={{ fontSize: 11, color: '#3a3630' }}>© 2026 OptiMenu. All rights reserved.</div>
        </footer>

      </div>
    </>
  );
}