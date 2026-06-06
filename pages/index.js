// pages/index.js
import Head from 'next/head';
import Link from 'next/link';
import { useState, useEffect, useRef } from 'react';

const TONIGHT_DISHES = [
  { label: 'PUSH TONIGHT', color: '#02a4ba', name: 'Grilled Branzino', reason: 'Received fresh this morning · 72% margin' },
  { label: 'RECOMMEND',    color: '#4caf80', name: 'Short Rib Tagliatelle', reason: 'Slow week · highest margin on menu' },
  { label: 'MENTION',      color: '#c4a35a', name: 'Burrata & Heirloom', reason: 'Tomatoes peak season · moving slow' },
];

const FEATURES = [
  {
    label: 'WASTE PREVENTION',
    title: "Turn expiring inventory into tonight's special.",
    desc: 'OptiMenu tracks every delivery against your shelf-life data. When something needs to move, your staff hears about it before service — not after you throw it away.',
  },
  {
    label: 'MENU INTELLIGENCE',
    title: 'Know which dishes are costing you money.',
    desc: 'Upload invoices, build your recipes, and OptiMenu calculates true food cost per dish — updated automatically every time a supplier price changes.',
  },
  {
    label: 'STAFF BRIEFING',
    title: 'Three dishes. Every night. On their phone.',
    desc: "The Tonight's Dish engine pushes a ranked list of what to sell via NFC tag or QR code. No manager briefing required. No forgotten talking points.",
  },
  {
    label: 'POS ANALYTICS',
    title: "See what's selling and what's sitting.",
    desc: 'Connect your POS data and surface slow movers before they become write-offs. Week-over-week comparisons that actually mean something.',
  },
];

const FAQS = [
  {
    q: 'What kind of restaurants is OptiMenu built for?',
    a: "Independent operators — single-location restaurants, small multi-location groups, and chef-owned concepts that don't have a full finance team. If you're managing food costs in a spreadsheet or not tracking them at all, OptiMenu is built for you.",
  },
  {
    q: "How does Tonight's Dish work?",
    a: "Each night, OptiMenu analyzes your inventory, sales data, and margin data to select three dishes for staff to push. The list is ranked by urgency — waste risk first, then margin opportunity. Staff access it by tapping an NFC tag or scanning a QR code at the start of their shift.",
  },
  {
    q: 'How long does setup take?',
    a: "Most operators are fully set up within a single afternoon. Upload your menu, add your invoices, and you're live. No onboarding call required.",
  },
  {
    q: 'What does the founding member rate include?',
    a: "Full access to every feature — including all future features as they're released — at $59/month, locked for life. The standard rate after the founding cohort closes is $79/month.",
  },
  {
    q: 'Does OptiMenu integrate with my POS system?',
    a: 'Shift4 SkyTab integration is in progress. Square, Lightspeed, and Clover are next. Currently OptiMenu supports CSV import from any POS system.',
  },
  {
    q: 'Can I cancel anytime?',
    a: 'Yes. No long-term contracts, no cancellation fees. Cancel anytime from your account settings and retain access through the end of your billing period.',
  },
];

function FaqItem({ q, a }) {
  const [open, setOpen] = useState(false);
  return (
    <div onClick={() => setOpen(!open)} style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', padding: '22px 0', cursor: 'pointer' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
        <span style={{ fontSize: 15, fontWeight: 400, color: '#c8c0b4', fontFamily: "'DM Sans', sans-serif", letterSpacing: '-0.2px' }}>{q}</span>
        <div style={{
          width: 22, height: 22, borderRadius: '50%',
          border: `1px solid ${open ? '#02a4ba' : 'rgba(255,255,255,0.12)'}`,
          background: open ? 'rgba(2,164,186,0.15)' : 'transparent',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0, color: open ? '#02a4ba' : '#6b6358',
          fontSize: 16, fontWeight: 300, transition: 'all 0.2s',
        }}>
          {open ? '−' : '+'}
        </div>
      </div>
      {open && (
        <p style={{ fontSize: 13, color: '#6b6358', lineHeight: 1.75, fontWeight: 400, marginTop: 12, fontFamily: "'DM Sans', sans-serif", maxWidth: 580 }}>
          {a}
        </p>
      )}
    </div>
  );
}

function ReceiptTicket({ dish, index, visible }) {
  return (
    <div style={{
      background: '#faf8f4',
      borderRadius: 3,
      padding: '16px 18px 12px',
      fontFamily: "'Courier Prime', 'Courier New', monospace",
      color: '#1a1612',
      boxShadow: '0 8px 32px rgba(0,0,0,0.35), 0 2px 8px rgba(0,0,0,0.2)',
      opacity: visible ? 1 : 0,
      transform: visible ? 'translateY(0) rotate(0deg)' : 'translateY(12px) rotate(-1deg)',
      transition: `opacity 0.5s ease ${index * 0.18}s, transform 0.5s ease ${index * 0.18}s`,
      position: 'relative',
    }}>
      <div style={{
        position: 'absolute', top: -1, left: 8, right: 8, height: 1,
        backgroundImage: 'repeating-linear-gradient(to right, transparent, transparent 4px, #e8e4de 4px, #e8e4de 8px)',
      }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 9, fontWeight: 700, color: dish.color, letterSpacing: '1.5px' }}>{dish.label}</span>
        <span style={{ fontSize: 9, color: '#9a9086' }}>#{String(index + 1).padStart(3, '0')}</span>
      </div>
      <div style={{ borderTop: '1px dashed #d0c8c0', margin: '8px 0' }} />
      <div style={{ fontSize: 15, fontWeight: 700, color: dish.color, lineHeight: 1.2, marginBottom: 6 }}>{dish.name}</div>
      <div style={{ borderTop: '1px dashed #d0c8c0', margin: '8px 0' }} />
      <div style={{ fontSize: 10, color: '#7a7268', lineHeight: 1.5 }}>{dish.reason}</div>
      <div style={{ fontSize: 8, color: '#c0b8b0', textAlign: 'center', marginTop: 10, letterSpacing: '0.5px' }}>opti-menu.com</div>
    </div>
  );
}

export default function Landing() {
  const [ticketsVisible, setTicketsVisible] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setTicketsVisible(true), 600);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <>
      <Head>
        <title>OptiMenu — Tonight's Dish. Every Night.</title>
        <meta name="description" content="OptiMenu turns your food cost data into a nightly staff briefing. Three dishes to push, ranked by waste risk and margin. Built for independent restaurants." />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;1,400&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;1,9..40,300&family=Courier+Prime:wght@400;700&display=swap" rel="stylesheet" />
      </Head>

      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html { scroll-behavior: smooth; }
        body { font-family: 'DM Sans', sans-serif; background: #0a0908; color: #e8e2d8; -webkit-font-smoothing: antialiased; }

        @keyframes fadeUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes float { 0%, 100% { transform: translateY(0px); } 50% { transform: translateY(-6px); } }
        @keyframes grain {
          0%, 100% { transform: translate(0,0); }
          10% { transform: translate(-2%,-3%); }
          20% { transform: translate(-4%,2%); }
          30% { transform: translate(3%,-1%); }
          40% { transform: translate(-1%,4%); }
          50% { transform: translate(-3%,1%); }
          60% { transform: translate(4%,1%); }
          70% { transform: translate(-2%,3%); }
          80% { transform: translate(1%,-3%); }
          90% { transform: translate(3%,2%); }
        }

        .lp-nav-link {
          font-size: 13px; color: #6b6358; font-weight: 400;
          cursor: pointer; transition: color 0.2s; text-decoration: none;
          letter-spacing: 0.2px;
        }
        .lp-nav-link:hover { color: #c8c0b4; }

        .grain-overlay {
          position: fixed; top: -50%; left: -50%; width: 200%; height: 200%;
          pointer-events: none; z-index: 9999; opacity: 0.025;
          background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E");
          animation: grain 0.5s steps(2) infinite;
        }

        .feature-card {
          border: 1px solid rgba(255,255,255,0.06);
          border-radius: 12px; padding: 28px;
          background: rgba(255,255,255,0.02);
          transition: border-color 0.3s, background 0.3s;
        }
        .feature-card:hover {
          border-color: rgba(2,164,186,0.2);
          background: rgba(2,164,186,0.03);
        }

        .lp-btn-primary {
          background: #02a4ba; border: none; border-radius: 7px;
          padding: 13px 26px; font-family: 'DM Sans', sans-serif;
          font-size: 13px; font-weight: 500; color: #0a0908;
          cursor: pointer; transition: background 0.2s, transform 0.1s;
          letter-spacing: 0.2px; display: inline-block;
        }
        .lp-btn-primary:hover { background: #01bcd4; }
        .lp-btn-primary:active { transform: scale(0.98); }

        .lp-btn-ghost {
          background: transparent; border: 1px solid rgba(255,255,255,0.1);
          border-radius: 7px; padding: 13px 26px;
          font-family: 'DM Sans', sans-serif; font-size: 13px;
          font-weight: 400; color: #6b6358; cursor: pointer;
          transition: border-color 0.2s, color 0.2s;
        }
        .lp-btn-ghost:hover { border-color: rgba(255,255,255,0.2); color: #c8c0b4; }

        .check-icon { width: 16px; height: 16px; border-radius: 50%; background: rgba(2,164,186,0.1); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }

        @media (max-width: 768px) {
          .hero-grid { grid-template-columns: 1fr !important; }
          .features-grid { grid-template-columns: 1fr !important; }
          .stats-grid { grid-template-columns: 1fr 1fr !important; }
          .pricing-grid { grid-template-columns: 1fr !important; }
          .nav-links { display: none !important; }
          .hero-title { font-size: 36px !important; }
          .section-title { font-size: 30px !important; }
          .lp-section { padding: 56px 24px !important; }
          .lp-nav { padding: 0 24px !important; }
          .tickets-col { display: none !important; }
          .callout-section { margin: 0 24px 64px !important; padding: 40px 28px !important; }
          .footer-inner { flex-direction: column !important; gap: 16px !important; text-align: center !important; }
        }
      `}</style>

      {/* Grain overlay */}
      <div className="grain-overlay" />

      {/* NAV */}
      <nav className="lp-nav" style={{
        background: scrolled ? 'rgba(10,9,8,0.95)' : 'transparent',
        backdropFilter: scrolled ? 'blur(12px)' : 'none',
        padding: '0 56px', height: 64,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100,
        borderBottom: scrolled ? '1px solid rgba(255,255,255,0.06)' : '1px solid transparent',
        transition: 'all 0.3s',
      }}>
        <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 20, fontWeight: 500, color: '#e8e2d8', letterSpacing: '-0.3px' }}>
          Opti<span style={{ color: '#02a4ba' }}>Menu</span>
        </div>
        <div className="nav-links" style={{ display: 'flex', alignItems: 'center', gap: 36 }}>
          <a href="#how-it-works" className="lp-nav-link">How it works</a>
          <a href="#pricing" className="lp-nav-link">Pricing</a>
          <a href="#faq" className="lp-nav-link">FAQ</a>
          <Link href="/client/login" className="lp-nav-link">Sign in</Link>
          <Link href="/client/signup">
            <button className="lp-btn-primary" style={{ padding: '8px 18px', fontSize: 12 }}>Get started</button>
          </Link>
        </div>
      </nav>

      {/* HERO */}
      <section style={{
        minHeight: '100vh', padding: '0 56px',
        display: 'flex', alignItems: 'center',
        position: 'relative', overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', top: '30%', left: '15%',
          width: 700, height: 600,
          background: 'radial-gradient(ellipse, rgba(2,164,186,0.07) 0%, transparent 70%)',
          pointerEvents: 'none',
        }} />

        <div className="hero-grid" style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr',
          gap: 80, alignItems: 'center',
          maxWidth: 1100, margin: '0 auto', width: '100%',
          paddingTop: 80,
        }}>
          {/* Left */}
          <div style={{ animation: 'fadeUp 0.7s ease both' }}>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              fontSize: 11, letterSpacing: '2px', textTransform: 'uppercase',
              color: '#02a4ba', fontWeight: 500, marginBottom: 24,
              border: '1px solid rgba(2,164,186,0.2)', padding: '5px 14px',
              borderRadius: 20,
            }}>
              <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#02a4ba', animation: 'float 2s ease-in-out infinite' }} />
              Founding member rate — $59/mo
            </div>

            <h1 className="hero-title" style={{
              fontFamily: "'Playfair Display', serif",
              fontSize: 52, fontWeight: 400, lineHeight: 1.12,
              color: '#e8e2d8', letterSpacing: '-0.8px', marginBottom: 24,
            }}>
              Your data tells you what to sell.{' '}
              <em style={{ fontStyle: 'italic', color: '#02a4ba' }}>We make sure your staff sells it.</em>
            </h1>

            <p style={{
              fontSize: 16, color: '#6b6358', lineHeight: 1.7,
              fontWeight: 300, marginBottom: 36, maxWidth: 460,
            }}>
              OptiMenu tracks food costs, identifies waste risk, and delivers a nightly staff briefing — three dishes to push tonight, ranked by urgency and margin.
            </p>

            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 32 }}>
              <Link href="/client/signup">
                <button className="lp-btn-primary">Start free trial</button>
              </Link>
              <a href="#how-it-works">
                <button className="lp-btn-ghost">See how it works</button>
              </a>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
              {['No credit card required', 'Cancel anytime', 'Setup in an afternoon'].map(t => (
                <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#4a453e' }}>
                  <svg viewBox="0 0 10 10" width="8" height="8" fill="none" stroke="#02a4ba" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="1.5,5 4,7.5 8.5,2.5" />
                  </svg>
                  {t}
                </div>
              ))}
            </div>
          </div>

          {/* Right — tickets */}
          <div className="tickets-col" style={{
            display: 'flex', flexDirection: 'column', gap: 12,
            animation: 'fadeUp 0.7s ease 0.2s both',
          }}>
            <div style={{ fontSize: 10, letterSpacing: '2px', textTransform: 'uppercase', color: '#4a453e', marginBottom: 4, fontFamily: "'Courier Prime', monospace" }}>
              Tonight's Dish — Staff Briefing
            </div>
            {TONIGHT_DISHES.map((dish, i) => (
              <ReceiptTicket key={dish.name} dish={dish} index={i} visible={ticketsVisible} />
            ))}
            <div style={{ fontSize: 11, color: '#3a3630', textAlign: 'center', marginTop: 4, fontFamily: "'Courier Prime', monospace" }}>
              Generated nightly · Delivered via NFC or QR
            </div>
          </div>
        </div>
      </section>

      {/* STATS */}
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', borderBottom: '1px solid rgba(255,255,255,0.06)', padding: '48px 56px' }}>
        <div className="stats-grid" style={{
          display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 40, maxWidth: 900, margin: '0 auto', textAlign: 'center',
        }}>
          {[
            { num: '3–7%', label: 'Average food cost reduction' },
            { num: '$800+', label: 'Monthly waste prevented' },
            { num: '< 1 day', label: 'Time to full setup' },
            { num: '0', label: 'Onboarding calls required' },
          ].map(({ num, label }) => (
            <div key={label}>
              <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 42, fontWeight: 400, color: '#e8e2d8', letterSpacing: '-1px', lineHeight: 1 }}>{num}</div>
              <div style={{ fontSize: 12, color: '#4a453e', marginTop: 8, letterSpacing: '0.2px', lineHeight: 1.5 }}>{label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* HOW IT WORKS */}
      <section id="how-it-works" className="lp-section" style={{ padding: '96px 56px' }}>
        <div style={{ maxWidth: 1000, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 64 }}>
            <div style={{ fontSize: 11, letterSpacing: '2px', textTransform: 'uppercase', color: '#02a4ba', fontWeight: 500, marginBottom: 14 }}>How it works</div>
            <h2 className="section-title" style={{
              fontFamily: "'Playfair Display', serif", fontSize: 38,
              fontWeight: 400, color: '#e8e2d8', letterSpacing: '-0.5px',
              lineHeight: 1.15, marginBottom: 16,
            }}>
              From invoice to staff briefing,{' '}
              <em style={{ fontStyle: 'italic', color: '#02a4ba' }}>automatically.</em>
            </h2>
            <p style={{ fontSize: 15, color: '#6b6358', lineHeight: 1.7, maxWidth: 480, margin: '0 auto' }}>
              OptiMenu connects your back office to your front of house so nothing falls through the cracks.
            </p>
          </div>

          <div className="features-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
            {FEATURES.map(({ label, title, desc }) => (
              <div key={label} className="feature-card">
                <div style={{ fontSize: 10, letterSpacing: '2px', textTransform: 'uppercase', color: '#02a4ba', fontWeight: 600, marginBottom: 14 }}>{label}</div>
                <div style={{ fontSize: 17, fontWeight: 400, color: '#e8e2d8', marginBottom: 12, lineHeight: 1.3, letterSpacing: '-0.2px', fontFamily: "'Playfair Display', serif" }}>{title}</div>
                <div style={{ fontSize: 13, color: '#6b6358', lineHeight: 1.7, fontWeight: 300 }}>{desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* TONIGHT'S DISH CALLOUT */}
      <section className="callout-section" style={{
        margin: '0 56px 96px', borderRadius: 16,
        background: 'linear-gradient(135deg, rgba(2,164,186,0.08) 0%, rgba(2,164,186,0.03) 100%)',
        border: '1px solid rgba(2,164,186,0.15)',
        padding: '56px 64px',
        position: 'relative', overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', top: -60, right: -60,
          width: 300, height: 300,
          background: 'radial-gradient(ellipse, rgba(2,164,186,0.12) 0%, transparent 70%)',
          pointerEvents: 'none',
        }} />
        <div style={{ maxWidth: 540 }}>
          <div style={{ fontSize: 10, letterSpacing: '2px', textTransform: 'uppercase', color: '#02a4ba', fontWeight: 600, marginBottom: 16 }}>Tonight's Dish Engine</div>
          <h2 style={{
            fontFamily: "'Playfair Display', serif", fontSize: 34,
            fontWeight: 400, color: '#e8e2d8', lineHeight: 1.2,
            letterSpacing: '-0.3px', marginBottom: 20,
          }}>
            The briefing your manager forgot to give.
          </h2>
          <p style={{ fontSize: 14, color: '#6b6358', lineHeight: 1.75, marginBottom: 28, fontWeight: 300 }}>
            Every night at 6am, OptiMenu analyzes your inventory, POS sales, and recipe margins to pick three dishes. Staff tap an NFC tag at the host stand to see what to push — and why. No meeting. No whiteboard. No forgotten talking points.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[
              'Expiring proteins surface first — always',
              'Talking points written for your servers, not your accountant',
              'Rotation logic prevents pushing the same dish every night',
            ].map(point => (
              <div key={point} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, fontSize: 13, color: '#9a9086' }}>
                <div style={{ width: 18, height: 18, borderRadius: '50%', background: 'rgba(2,164,186,0.1)', border: '1px solid rgba(2,164,186,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2 }}>
                  <svg viewBox="0 0 10 10" width="7" height="7" fill="none" stroke="#02a4ba" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="1.5,5 4,7.5 8.5,2.5" />
                  </svg>
                </div>
                {point}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section id="pricing" className="lp-section" style={{ padding: '96px 56px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ maxWidth: 780, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 56 }}>
            <div style={{ fontSize: 11, letterSpacing: '2px', textTransform: 'uppercase', color: '#02a4ba', fontWeight: 500, marginBottom: 14 }}>Pricing</div>
            <h2 className="section-title" style={{
              fontFamily: "'Playfair Display', serif", fontSize: 38,
              fontWeight: 400, color: '#e8e2d8', letterSpacing: '-0.5px',
              lineHeight: 1.15, marginBottom: 14,
            }}>
              Simple. Honest. Flat.
            </h2>
            <p style={{ fontSize: 15, color: '#6b6358', lineHeight: 1.7, maxWidth: 420, margin: '0 auto' }}>
              No per-location pricing. No mandatory onboarding fee. No surprises.
            </p>
          </div>

          <div className="pricing-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            {/* Founding */}
            <div style={{
              border: '1px solid rgba(2,164,186,0.3)', borderRadius: 14,
              padding: '36px 32px', background: 'rgba(2,164,186,0.04)', position: 'relative',
            }}>
              <div style={{
                position: 'absolute', top: -12, left: 28,
                background: '#02a4ba', color: '#0a0908',
                fontSize: 10, fontWeight: 700, letterSpacing: '1px',
                textTransform: 'uppercase', padding: '4px 14px', borderRadius: 10,
              }}>
                Founding member
              </div>
              <div style={{ fontSize: 11, letterSpacing: '1.5px', textTransform: 'uppercase', color: '#6b6358', marginBottom: 18 }}>Founding rate</div>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4, marginBottom: 6 }}>
                <span style={{ fontFamily: "'Playfair Display', serif", fontSize: 18, color: '#9a9086', marginTop: 10 }}>$</span>
                <span style={{ fontFamily: "'Playfair Display', serif", fontSize: 52, color: '#e8e2d8', lineHeight: 1, letterSpacing: '-2px' }}>59</span>
              </div>
              <div style={{ fontSize: 12, color: '#6b6358', marginBottom: 28 }}>per month · locked for life</div>
              <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', marginBottom: 24 }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 28 }}>
                {["All features included", "Unlimited menu items", "Invoice parsing & OCR", "Tonight's Dish engine", "POS analytics", "Rate locked forever"].map(f => (
                  <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: '#9a9086' }}>
                    <div className="check-icon">
                      <svg viewBox="0 0 10 10" width="7" height="7" fill="none" stroke="#02a4ba" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="1.5,5 4,7.5 8.5,2.5" /></svg>
                    </div>
                    {f}
                  </div>
                ))}
              </div>
              <Link href="/client/signup">
                <button className="lp-btn-primary" style={{ width: '100%', textAlign: 'center' }}>Claim founding rate</button>
              </Link>
            </div>

            {/* Standard */}
            <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: '36px 32px', background: 'rgba(255,255,255,0.02)' }}>
              <div style={{ fontSize: 11, letterSpacing: '1.5px', textTransform: 'uppercase', color: '#6b6358', marginBottom: 18 }}>Standard</div>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4, marginBottom: 6 }}>
                <span style={{ fontFamily: "'Playfair Display', serif", fontSize: 18, color: '#4a453e', marginTop: 10 }}>$</span>
                <span style={{ fontFamily: "'Playfair Display', serif", fontSize: 52, color: '#9a9086', lineHeight: 1, letterSpacing: '-2px' }}>79</span>
              </div>
              <div style={{ fontSize: 12, color: '#4a453e', marginBottom: 28 }}>per month</div>
              <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', marginBottom: 24 }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 28 }}>
                {["All features included", "Unlimited menu items", "Invoice parsing & OCR", "Tonight's Dish engine", "POS analytics"].map(f => (
                  <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: '#6b6358' }}>
                    <div style={{ width: 16, height: 16, borderRadius: '50%', background: 'rgba(255,255,255,0.04)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <svg viewBox="0 0 10 10" width="7" height="7" fill="none" stroke="#4a453e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="1.5,5 4,7.5 8.5,2.5" /></svg>
                    </div>
                    {f}
                  </div>
                ))}
              </div>
              <Link href="/client/signup">
                <button className="lp-btn-ghost" style={{ width: '100%' }}>Get started</button>
              </Link>
            </div>
          </div>

          <p style={{ textAlign: 'center', fontSize: 12, color: '#3a3630', marginTop: 20 }}>
            14-day free trial included · No credit card required to start
          </p>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="lp-section" style={{ padding: '96px 56px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ maxWidth: 660, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 56 }}>
            <div style={{ fontSize: 11, letterSpacing: '2px', textTransform: 'uppercase', color: '#02a4ba', fontWeight: 500, marginBottom: 14 }}>FAQ</div>
            <h2 className="section-title" style={{
              fontFamily: "'Playfair Display', serif", fontSize: 38,
              fontWeight: 400, color: '#e8e2d8', letterSpacing: '-0.5px', lineHeight: 1.15,
            }}>
              Common questions
            </h2>
          </div>
          {FAQS.map(({ q, a }) => <FaqItem key={q} q={q} a={a} />)}
        </div>
      </section>

      {/* CTA */}
      <section style={{
        padding: '96px 56px', textAlign: 'center',
        borderTop: '1px solid rgba(255,255,255,0.06)',
        position: 'relative', overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 700, height: 400,
          background: 'radial-gradient(ellipse, rgba(2,164,186,0.07) 0%, transparent 70%)',
          pointerEvents: 'none',
        }} />
        <div style={{ fontSize: 11, letterSpacing: '2px', textTransform: 'uppercase', color: '#02a4ba', fontWeight: 500, marginBottom: 20 }}>Get started</div>
        <h2 style={{
          fontFamily: "'Playfair Display', serif", fontSize: 44,
          fontWeight: 400, color: '#e8e2d8', letterSpacing: '-0.8px',
          lineHeight: 1.12, marginBottom: 16, maxWidth: 560, margin: '0 auto 16px',
        }}>
          Stop guessing what to sell tonight.
        </h2>
        <p style={{ fontSize: 15, color: '#6b6358', fontWeight: 300, marginBottom: 36, lineHeight: 1.65 }}>
          Join the founding cohort. First 25 operators lock in $59/month for life.
        </p>
        <Link href="/client/signup">
          <button className="lp-btn-primary" style={{ fontSize: 14, padding: '14px 32px' }}>Start your free trial</button>
        </Link>
      </section>

      {/* FOOTER */}
      <footer style={{ borderTop: '1px solid rgba(255,255,255,0.06)', padding: '28px 56px' }}>
        <div className="footer-inner" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 16, color: '#3a3630' }}>
            Opti<span style={{ color: '#02a4ba' }}>Menu</span>
          </div>
          <div style={{ display: 'flex', gap: 28 }}>
            {['Privacy', 'Terms', 'Contact'].map(l => (
              <a key={l} href="#" style={{ fontSize: 12, color: '#3a3630', textDecoration: 'none' }}>{l}</a>
            ))}
          </div>
          <div style={{ fontSize: 11, color: '#2a2620' }}>© 2026 OptiMenu LLC</div>
        </div>
      </footer>
    </>
  );
}