// pages/index.js
// OptiMenu landing page.
// Structure: hero → at every station → 01 how it works → 02 dashboard (owners)
// → 03 the pass (staff) → 04 POS data → 05 pricing → 06 FAQ → CTA → footer.
import Head from 'next/head';
import Link from 'next/link';
import { useState } from 'react';
import PassMock from '../components/landing/PassMock';
import StaffPhone from '../components/landing/StaffPhone';

const CTA = 'Get started';

const INVOICE_LINES = [
  { item: 'Branzino, whole', price: '$84.30' },
  { item: 'Heirloom tomato', price: '$22.10' },
  { item: 'Burrata, 8 oz', price: '$31.75' },
];

const SCORES = [
  { label: 'Waste risk', value: 'High', width: '82%' },
  { label: 'Margin', value: '72%', width: '72%' },
  { label: 'Popularity', value: 'Steady', width: '54%' },
];

const HERO_TICKETS = [
  {
    label: 'PUSH TONIGHT', num: '#001', color: '#02a4ba', dish: 'Grilled Branzino',
    say: '"Whole branzino came in this morning — we\u2019re grilling it with the last of the summer tomatoes."',
  },
  {
    label: 'RECOMMEND', num: '#002', color: '#4caf50', dish: 'Burrata & Heirloom',
    say: '"The tomatoes are at their peak this week — it\u2019s the last of them."',
  },
];

const STEPS = [
  {
    time: '3:00 AM', title: 'Sync', body: 'Sales close out and vendor invoices are read line by line.',
    icon: (
      <>
        <path d="M14 3v4a1 1 0 0 0 1 1h4" />
        <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2Z" />
        <path d="M9 12h6" /><path d="M9 16h4" />
      </>
    ),
  },
  {
    time: '3:20 AM', title: 'Analyze', body: 'Every dish scored on waste risk, popularity and margin.',
    icon: (
      <>
        <path d="M3 20h18" />
        <rect x="5" y="12" width="3.5" height="6" rx="1" />
        <rect x="10.25" y="8" width="3.5" height="10" rx="1" />
        <rect x="15.5" y="4" width="3.5" height="14" rx="1" />
      </>
    ),
  },
  {
    time: '5:00 AM', title: 'Pick', body: 'Top dishes chosen, each with a line servers can say.',
    icon: <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.7l5.9-.9L12 3.5Z" />,
  },
  {
    time: '4:30 PM', title: 'Tap', body: 'Staff tap any station tag. Briefing opens on their phone.',
    icon: (
      <>
        <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
        <path d="M10.5 5.5h3" /><path d="M12 17.5h.01" />
        <path d="M19.5 8.5a5 5 0 0 1 0 7" /><path d="M4.5 8.5a5 5 0 0 0 0 7" />
      </>
    ),
  },
];

const STAFF_POINTS = [
  'Opens in the browser — nothing to install',
  'No staff logins, no accounts to manage',
  "Costs and margins stay on the owner's side",
];

const DATA_READ = [
  'Menu items and their prices',
  'Item-level sales counts and timestamps',
  'Dayparts, covers and service periods',
  'Voids and comps at the item level',
];

const DATA_NEVER = [
  'Payments, card data or tokens',
  'Guest names, contacts or loyalty records',
  'Employee records or payroll',
  'Any write-back — OptiMenu never changes your POS',
];

const ORDER_TICKETS = [
  { time: '6:12 PM', items: '2 Caesar salads, 1 French onion soup' },
  { time: '6:40 PM', items: '1 roast chicken, 1 steak frites' },
  { time: '7:05 PM', items: '3 mussels marinière, 1 burrata' },
  { time: '7:18 PM', items: '2 grilled branzino' },
  { time: '7:33 PM', items: '1 lamb ragù, 2 cacio e pepe' },
  { time: '7:52 PM', items: '2 cheeseburgers, 1 side of fries' },
  { time: '8:04 PM', items: '1 NY strip, 1 half chicken' },
  { time: '8:21 PM', items: '2 duck confit, 1 beet salad' },
  { time: '8:33 PM', items: '1 pork chop, 2 rigatoni' },
  { time: '8:47 PM', items: '3 fish and chips' },
  { time: '9:02 PM', items: '1 short rib, 1 gnocchi' },
  { time: '9:19 PM', items: '2 crème brûlée, 1 affogato' },
];

const PLAN = [
  'Every feature, including future releases',
  'Unlimited menu items and recipes',
  'Invoice parsing and OCR',
  'Nightly dish recommendation engine',
  'POS analytics and week-over-week',
  'Three NFC tags, priority support',
];

const FAQS = [
  {
    q: 'What if my invoice data is a mess?',
    a: "That's the normal starting point. OptiMenu reads scanned or photographed vendor invoices and pulls line items, units and prices — you don't reformat anything. Where a line is unreadable we flag it for you instead of guessing.",
  },
  {
    q: 'How much history do you need before the scores are worth anything?',
    a: 'Two weeks of item-level sales gives usable rankings. Four weeks and the popularity signal gets sharp enough to separate a slow dish from a slow week. Waste risk works from your first invoices, since it reads perishables and dates rather than sales patterns.',
  },
  {
    q: 'Will it tell me to push my highest-margin dish every night?',
    a: 'No. Waste risk ranks first, margin second, and rotation logic blocks the same dish from being pushed on consecutive nights. The point is to move what\u2019s about to turn, not to hammer one plate until guests notice.',
  },
  {
    q: 'Who can see cost and margin numbers?',
    a: 'Only accounts you give dashboard access to. The staff briefing carries the dish, the priority and a line to say at the table — no costs, no margins, no percentages. Servers never see the money side.',
  },
  {
    q: 'Does it work with my POS?',
    a: 'Any POS today by CSV import of item-level sales. Direct integrations are in progress; when one covers your terminal, the nightly sync replaces the import and nothing else about your setup changes.',
  },
  {
    q: 'What happens to my data if I cancel?',
    a: 'You can export your menu, invoice line items and score history at any time. Cancel and we delete your account data within thirty days — no contract, no cancellation fee, no exit call required.',
  },
];

const FOOTER_COLS = [
  {
    title: 'Product',
    links: [
      { label: 'How it works', href: '#how' },
      { label: 'Platform', href: '#platform' },
      { label: 'Staff view', href: '#staff' },
      { label: 'POS data', href: '#pos' },
    ],
  },
  {
    title: 'Company',
    links: [
      { label: 'Pricing', href: '#pricing' },
      { label: 'FAQ', href: '#faq' },
      { label: 'Contact', href: 'mailto:hello@opti-menu.com' },
    ],
  },
  {
    title: 'Get in touch',
    links: [
      { label: 'hello@opti-menu.com', href: 'mailto:hello@opti-menu.com' },
      { label: 'Book a walkthrough', href: '#contact' },
    ],
  },
];

const mono = { fontFamily: "'IBM Plex Mono', monospace" };
const eyebrow = { ...mono, fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#03808f' };
const dashed = { borderTop: '1px dashed #d0c8c0', margin: '9px 0' };
const check = { display: 'flex', gap: 11, alignItems: 'baseline' };

function Eyebrow({ n, children, mb = 14 }) {
  return (
    <div style={{ ...eyebrow, marginBottom: mb }}>
      <span style={{ color: '#9aa5a7' }}>{n}</span>
      &nbsp;&nbsp;{children}
    </div>
  );
}

function OrderTicket({ lane, top, delay }) {
  const [idx, setIdx] = useState(lane);
  const t = ORDER_TICKETS[idx % ORDER_TICKETS.length];
  return (
    <div
      onAnimationIteration={() => setIdx((i) => (i + 3) % ORDER_TICKETS.length)}
      style={{
        position: 'absolute', top, display: 'flex', alignItems: 'center', gap: 9, whiteSpace: 'nowrap',
        background: '#fff', border: '1px solid #e2e8e9', borderLeft: '2px solid #02a4ba', borderRadius: 5,
        padding: '5px 12px', boxShadow: '0 2px 6px rgba(17,24,25,0.06)',
        animation: 'om-flow 9s linear infinite', animationDelay: delay,
      }}
    >
      <span style={{ ...mono, fontSize: 10, color: '#02a4ba' }}>{t.time}</span>
      <span style={{ fontSize: 11.5, color: '#3c4749' }}>{t.items}</span>
    </div>
  );
}

function FaqItem({ q, a, open, onToggle }) {
  return (
    <div style={{ background: '#fff', borderRadius: 12, padding: '4px 20px' }}>
      <button
        onClick={onToggle}
        style={{
          width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 20,
          background: 'none', border: 0, padding: '18px 0', cursor: 'pointer', textAlign: 'left',
          fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 16, color: '#111819',
        }}
      >
        {q}
        <span style={{ color: '#02a4ba', fontSize: 20, lineHeight: 1, flex: 'none' }}>{open ? '−' : '+'}</span>
      </button>
      {open && (
        <p style={{ fontSize: 14.5, lineHeight: 1.8, color: '#5a6669', maxWidth: '70ch', paddingBottom: 20 }}>{a}</p>
      )}
    </div>
  );
}

export default function Landing() {
  const [openFaq, setOpenFaq] = useState(0);

  return (
    <>
      <Head>
        <title>OptiMenu — Menu data that actually reaches the floor</title>
        <meta
          name="description"
          content="OptiMenu scores every dish overnight on waste risk, popularity and margin, then puts tonight's picks on your staff's phones with one tap."
        />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </Head>

      <style>{`
        .om-page *, .om-page *::before, .om-page *::after { box-sizing: border-box; margin: 0; padding: 0; }
        .om-page { background:#e6e4e0; color:#111819; font-family:'Manrope', system-ui, sans-serif; -webkit-font-smoothing:antialiased; }
        .om-page h1, .om-page h2, .om-page h3 { font-weight:700; letter-spacing:-0.03em; line-height:1.06; }
        .om-page a { color:#03808f; text-decoration:none; }
        .om-page a:hover { color:#02a4ba; }
        .om-4 { display:grid; grid-template-columns:repeat(4,1fr); gap:26px; }
        .om-2 { display:grid; grid-template-columns:1fr 1fr; gap:54px; align-items:center; }
        .om-foot { display:grid; grid-template-columns:1.4fr 1fr 1fr 1fr; gap:36px; }
        .om-nav-links { flex:none; }
        .om-nav-links a { white-space:nowrap; }
        .om-hero { display:grid; grid-template-columns:minmax(180px,250px) minmax(300px,1fr) minmax(190px,266px);
          gap:clamp(18px,2.4vw,34px); align-items:center; max-width:1180px; margin:0 auto; }
        .om-side { display:flex; flex-direction:column; gap:22px; }
        .om-card { background:#fff; border-radius:14px; padding:18px; box-shadow:0 18px 40px rgba(17,24,25,0.12); }
        .om-staff { display:grid; grid-template-columns:290px 1fr; gap:56px; align-items:center; max-width:1060px; }
        .om-flow { display:grid; grid-template-columns:repeat(4,1fr); }
        .om-flow-cell { padding:22px; border-left:1px solid #eaeeef; }
        .om-flow-cell:first-child { border-left:0; }
        @keyframes om-flow { from { left:-14px } to { left:calc(100% + 14px) } }
        @media (prefers-reduced-motion: reduce) { .om-page [style*="om-flow"] { animation:none !important; } }
        @media (max-width:1150px) { .om-4 { grid-template-columns:1fr 1fr; } }
        @media (max-width:900px) { .om-flow { grid-template-columns:1fr 1fr; } .om-flow-cell:nth-child(3) { border-left:0; } }
        @media (max-width:860px) { .om-staff { grid-template-columns:1fr; gap:32px; max-width:420px; margin:0 auto; } }
        @media (max-width:820px) {
          .om-hero { grid-template-columns:1fr; gap:44px; max-width:660px; }
          .om-hero > div:nth-child(2) { order:-1; }
          .om-side { flex-direction:row; flex-wrap:wrap; justify-content:center; }
          .om-side > * { flex:1 1 240px; max-width:300px; transform:none !important; }
          .om-hero-right { display:flex; justify-content:center; }
          .om-hero-right > * { transform:none !important; width:100%; max-width:300px; }
        }
        @media (max-width:920px) {
          .om-4, .om-2, .om-foot { grid-template-columns:1fr; gap:24px; }
          .om-nav-links { display:none !important; }
          .om-h1 { font-size:42px !important; }
          .om-h2 { font-size:29px !important; }
          .om-sec { padding-left:22px !important; padding-right:22px !important; }
        }
        @media (max-width:600px) {
          .om-flow { grid-template-columns:1fr; }
          .om-flow-cell { border-left:0; border-top:1px solid #eaeeef; }
          .om-flow-cell:first-child { border-top:0; }
        }
      `}</style>

      <div className="om-page" style={{ padding: '26px 26px 0' }}>
        <div style={{
          maxWidth: 1280, margin: '0 auto', background: '#fff', borderRadius: 14,
          overflow: 'hidden', boxShadow: '0 22px 60px rgba(17,24,25,0.1)',
        }}>
          {/* NAV */}
          <div style={{
            position: 'sticky', top: 0, zIndex: 30, background: 'rgba(255,255,255,0.94)',
            backdropFilter: 'blur(10px)', borderBottom: '1px solid #edf0f1',
          }}>
            <div style={{ padding: '16px 34px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24 }}>
              <a href="#top" style={{ display: 'flex', alignItems: 'center' }}>
                <img src="/landing/logo.png" alt="optiMenu Solutions" style={{ display: 'block', height: 38, width: 'auto' }} />
              </a>
              <div className="om-nav-links" style={{ display: 'flex', alignItems: 'center', gap: 30, fontSize: 14.5, fontWeight: 500 }}>
                <a href="#how" style={{ color: '#4a575a' }}>How it works</a>
                <a href="#platform" style={{ color: '#4a575a' }}>Platform</a>
                <a href="#staff" style={{ color: '#4a575a' }}>Staff view</a>
                <a href="#pricing" style={{ color: '#4a575a' }}>Pricing</a>
              </div>
              <div className="om-nav-links" style={{ display: 'flex', alignItems: 'center', gap: 20, fontSize: 14.5, fontWeight: 500 }}>
                <Link href="/client/login" style={{ color: '#4a575a' }}>Sign in</Link>
                <Link href="/client/signup" style={{ border: '1px solid #d7dedf', borderRadius: 22, padding: '9px 20px', color: '#111819' }}>{CTA}</Link>
              </div>
            </div>
          </div>

          {/* HERO */}
          <section id="top" style={{
            position: 'relative', overflow: 'hidden', background: '#f7f8f8',
            backgroundImage: 'radial-gradient(#dfe4e5 1px, transparent 1px)', backgroundSize: '14px 14px',
            padding: '26px 34px 34px',
          }}>
            <div className="om-hero">
              <div className="om-side">
                <div className="om-card" style={{ transform: 'rotate(-3deg) scale(0.9)', transformOrigin: 'center left' }}>
                  <div style={{ ...mono, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#9aa5a7', marginBottom: 12 }}>
                    Invoice parsed · 06:02
                  </div>
                  {INVOICE_LINES.map((line) => (
                    <div key={line.item} style={{
                      display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12.5,
                      padding: '7px 0', borderTop: '1px solid #f0f3f3',
                    }}>
                      <span style={{ color: '#111819' }}>{line.item}</span>
                      <span style={{ color: '#7c8789' }}>{line.price}</span>
                    </div>
                  ))}
                </div>
                <div className="om-card" style={{ transform: 'rotate(2deg) scale(0.9)', transformOrigin: 'center left' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 14 }}>Dish score</div>
                  {SCORES.map((s) => (
                    <div key={s.label} style={{ marginBottom: 11 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: '#5a6669', marginBottom: 5 }}>
                        <span>{s.label}</span>
                        <span style={{ color: '#111819', fontWeight: 600 }}>{s.value}</span>
                      </div>
                      <div style={{ height: 5, borderRadius: 3, background: '#eef1f2' }}>
                        <div style={{ height: 5, borderRadius: 3, background: '#02a4ba', width: s.width }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ position: 'relative', textAlign: 'center', zIndex: 2 }}>
                <img
                  src="/landing/nfc-tag.png"
                  alt="The OptiMenu NFC tag"
                  style={{ display: 'block', width: 88, height: 'auto', margin: '0 auto 20px', filter: 'drop-shadow(0 14px 22px rgba(17,24,25,0.18))' }}
                />
                <h1 className="om-h1" style={{ fontSize: 'clamp(34px,3.6vw,54px)', fontWeight: 800, marginBottom: 22 }}>
                  Menu data that actually<br />
                  <span style={{ color: '#7c8789', fontWeight: 700 }}>reaches the floor</span>
                </h1>
                <p style={{ fontSize: 'clamp(14.5px,1.35vw,17.5px)', color: '#5a6669', maxWidth: '52ch', margin: '0 auto 30px' }}>
                  Every dish scored overnight on waste risk, popularity and margin. Tonight&rsquo;s picks on your staff&rsquo;s phones with one tap.
                </p>
                <Link href="/client/signup" style={{
                  display: 'inline-block', background: '#02a4ba', color: '#fff', borderRadius: 26,
                  padding: '15px 34px', fontWeight: 700, fontSize: 15.5, boxShadow: '0 10px 24px rgba(2,164,186,0.28)',
                }}>{CTA}</Link>
              </div>

              <div className="om-hero-right">
                <div style={{
                  background: '#f0ece4', borderRadius: 12, padding: '14px 12px',
                  boxShadow: '0 18px 40px rgba(17,24,25,0.14)', transform: 'rotate(2.5deg) scale(0.84)',
                  transformOrigin: 'center right', fontFamily: "'Courier New', monospace", color: '#1a1612', width: '100%',
                }}>
                  <div style={{ textAlign: 'center', marginBottom: 14 }}>
                    <div style={{ fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#02a4ba', marginBottom: 8 }}>OptiMenu</div>
                    <div style={{ fontSize: 17, fontWeight: 600, lineHeight: 1.2 }}>Harbour & Vine</div>
                    <div style={{ fontSize: 10.5, color: '#7a6e60', marginTop: 3 }}>Friday, August 21</div>
                    <div style={{ fontSize: 9.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#02a4ba', fontWeight: 600, marginTop: 3 }}>
                      Tonight&rsquo;s Dish — Staff Briefing
                    </div>
                  </div>
                  <div style={{ height: 1, background: 'linear-gradient(90deg,transparent,#d0c8c0,transparent)', marginBottom: 14 }} />
                  {HERO_TICKETS.map((t, i) => (
                    <div key={t.num} style={{
                      background: '#fff', borderRadius: 4, padding: '14px 13px 11px',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.12)', marginTop: i === 0 ? 0 : 12,
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 9.5, letterSpacing: '1.4px' }}>
                        <span style={{ color: t.color, fontWeight: 700 }}>{t.label}</span>
                        <span style={{ color: '#9a9080' }}>{t.num}</span>
                      </div>
                      <div style={dashed} />
                      <div style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.2, color: t.color }}>{t.dish}</div>
                      <div style={dashed} />
                      <div style={{ fontSize: 8.5, letterSpacing: '1.2px', color: '#9a9080', marginBottom: 3 }}>SAY THIS:</div>
                      <div style={{ fontSize: 11, lineHeight: 1.5, fontStyle: 'italic' }}>{t.say}</div>
                      <div style={{ fontSize: 8.5, color: '#c0b8b0', textAlign: 'center', marginTop: 10, letterSpacing: '0.8px' }}>opti-menu.com</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* AT EVERY STATION */}
          <section className="om-sec" style={{ padding: '72px 34px 12px', borderTop: '1px solid #edf0f1' }}>
            <div className="om-2" style={{ gridTemplateColumns: '300px minmax(0,1fr)', maxWidth: 860, margin: '0 auto', gap: 40 }}>
              <div style={{ borderRadius: 14, overflow: 'hidden', aspectRatio: '4 / 3', boxShadow: '0 16px 36px rgba(17,24,25,0.12)' }}>
                <img
                  src="/landing/staff-tap-counter.png"
                  alt="A server tapping a phone to the OptiMenu tag at the counter"
                  style={{
                    display: 'block', width: '100%', height: '100%', objectFit: 'cover', objectPosition: '60% 58%',
                    transform: 'scale(1.9)', transformOrigin: '60% 58%', filter: 'saturate(0.8) brightness(1.05)',
                  }}
                />
              </div>
              <div>
                <div style={{
                  ...mono, display: 'inline-block', fontSize: 12, fontWeight: 700, letterSpacing: '0.14em',
                  textTransform: 'uppercase', color: '#036e7e', background: '#effafb', borderRadius: 20,
                  padding: '6px 14px', marginBottom: 16,
                }}>At every station</div>
                <h2 className="om-h2" style={{ fontSize: 34, marginBottom: 14 }}>A tap is the whole interface.</h2>
                <p style={{ fontSize: 16, lineHeight: 1.7, color: '#5a6669', maxWidth: '44ch' }}>
                  Put a tag at the pass, on the server station, beside the bar terminal — anywhere your staff already stand.
                  Tonight&rsquo;s briefing opens on their own phone in about a second.
                </p>
              </div>
            </div>
          </section>

          {/* 01 HOW IT WORKS */}
          <section className="om-sec" id="how" style={{ borderTop: '1px solid #eaeeef', padding: '64px 34px 60px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 24, flexWrap: 'wrap', marginBottom: 24 }}>
              <div>
                <Eyebrow n="01" mb={10}>How it works</Eyebrow>
                <h2 className="om-h2" style={{ fontSize: 34 }}>One cycle, run overnight.</h2>
              </div>
              <p style={{ fontSize: 14.5, color: '#7c8789', maxWidth: '34ch' }}>
                Nobody on your team touches any of it. They tap once at the start of the shift.
              </p>
            </div>

            <div style={{ border: '1px solid #eaeeef', borderRadius: 16, overflow: 'hidden' }}>
              <div className="om-flow">
                {STEPS.map((s, i) => (
                  <div className="om-flow-cell" key={s.title}>
                    <div style={{ marginBottom: 14 }}>
                      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#02a4ba" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        {s.icon}
                      </svg>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 8 }}>
                      <span style={{
                        ...mono, width: 22, height: 22, borderRadius: '50%', background: '#02a4ba', color: '#fff',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, flex: 'none',
                      }}>{i + 1}</span>
                      <span style={{ ...mono, fontSize: 11, letterSpacing: '0.08em', color: '#8b989b' }}>{s.time}</span>
                    </div>
                    <h3 style={{ fontSize: 17, marginBottom: 5 }}>{s.title}</h3>
                    <p style={{ fontSize: 13.5, lineHeight: 1.55, color: '#5a6669' }}>{s.body}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* 02 THE DASHBOARD */}
          <section className="om-sec" id="platform" style={{ borderTop: '1px solid #eaeeef', padding: '64px 34px 80px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 24, flexWrap: 'wrap', marginBottom: 26 }}>
              <div>
                <Eyebrow n="02" mb={10}>The dashboard · owners and managers</Eyebrow>
                <h2 className="om-h2" style={{ fontSize: 34 }}>Everything behind tonight&rsquo;s call.</h2>
              </div>
              <p style={{ fontSize: 14.5, color: '#7c8789', maxWidth: '36ch' }}>
                Managers only. Tonight&rsquo;s three tickets on the pass, menu health, what&rsquo;s about to spoil, and how last week&rsquo;s
                picks actually sold — costs and margins never leave this screen.{' '}
                <span style={{ color: '#03808f' }}>Hover a number to see what each part does.</span>
              </p>
            </div>
            <PassMock />
          </section>

          {/* 03 THE PASS — STAFF */}
          <section className="om-sec" id="staff" style={{ background: '#f7f8f8', borderTop: '1px solid #eaeeef', padding: '84px 34px' }}>
            <div className="om-staff">
              <StaffPhone />
              <div>
                <Eyebrow n="03">The pass · the staff side</Eyebrow>
                <h2 className="om-h2" style={{ fontSize: 36, marginBottom: 16 }}>What the floor actually gets.</h2>
                <p style={{ fontSize: 16, lineHeight: 1.7, color: '#5a6669', maxWidth: '46ch', marginBottom: 26 }}>
                  One tap opens this in the phone&rsquo;s browser. Three tickets, ranked by priority, and a line servers can say at
                  the table. No margins, no dashboards, no account to manage.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 32 }}>
                  {STAFF_POINTS.map((p) => (
                    <div key={p} style={{ ...check, fontSize: 14.5, color: '#3c4749' }}>
                      <span style={{ color: '#02a4ba' }}>✓</span>{p}
                    </div>
                  ))}
                </div>
                <div style={{
                  display: 'grid', gridTemplateColumns: '120px 1fr', gap: 26, alignItems: 'center',
                  borderTop: '1px solid #eaeeef', paddingTop: 26,
                }}>
                  <img src="/landing/nfc-tag.png" alt="The OptiMenu NFC tag" style={{ display: 'block', width: '100%' }} />
                  <div>
                    <h3 style={{ fontSize: 18, marginBottom: 8 }}>The tag</h3>
                    <p style={{ fontSize: 14.5, lineHeight: 1.65, color: '#5a6669' }}>
                      Stick it by the pass, the POS, or the service window. Staff tap on their way out to the floor.
                      Every restaurant gets three.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* 04 POS DATA */}
          <section className="om-sec" id="pos" style={{ background: '#f7f8f8', borderTop: '1px solid #dfe5e6', padding: '84px 34px' }}>
            <Eyebrow n="04">POS data</Eyebrow>
            <h2 className="om-h2" style={{ fontSize: 36, marginBottom: 12 }}>Read-only, and narrow on purpose.</h2>
            <p style={{ fontSize: 16, lineHeight: 1.7, color: '#5a6669', maxWidth: '56ch', marginBottom: 38 }}>
              OptiMenu needs item-level sales history to score a menu. Nothing else. The connection is read-only, so nothing
              OptiMenu does can change what happens at the terminal.
            </p>

            <div style={{
              display: 'grid', gridTemplateColumns: 'minmax(120px,1fr) minmax(160px,2fr) minmax(120px,1fr)',
              alignItems: 'center', background: '#fff', borderRadius: 14, padding: '30px 26px',
              boxShadow: '0 6px 18px rgba(17,24,25,0.05)', marginBottom: 26,
            }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ border: '1px solid #d7dedf', borderRadius: 10, padding: '18px 12px' }}>
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#5a6669" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', margin: '0 auto 10px' }}>
                    <rect x="3" y="4" width="18" height="12" rx="1.5" />
                    <path d="M7 20h10M12 16v4" />
                    <path d="M7 8h6M7 11h3" />
                  </svg>
                  <div style={{ ...mono, fontSize: 9.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#9aa5a7', marginBottom: 6 }}>Your POS</div>
                  <div style={{ fontSize: 14.5, fontWeight: 700 }}>Item-level sales</div>
                </div>
              </div>

              <div style={{ position: 'relative', height: 112, overflow: 'hidden' }}>
                <div style={{
                  position: 'absolute', top: 56, left: 0, right: 0, height: 1,
                  background: 'repeating-linear-gradient(90deg,#c8d2d4 0 6px,transparent 6px 12px)',
                }} />
                <OrderTicket lane={0} top={22} delay="0s" />
                <OrderTicket lane={1} top={50} delay="-3s" />
                <OrderTicket lane={2} top={78} delay="-6s" />
                <div style={{
                  ...mono, position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)',
                  fontSize: 9.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#03808f',
                  background: '#fff', padding: '0 8px', zIndex: 2, whiteSpace: 'nowrap',
                }}>Read-only · nothing written back</div>
              </div>

              <div style={{ textAlign: 'center' }}>
                <div style={{ border: '1px solid #02a4ba', borderRadius: 10, padding: '18px 12px', background: '#effafb' }}>
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#02a4ba" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', margin: '0 auto 10px' }}>
                    <path d="M3 17l5-6 4 3 5-7" /><path d="M14 7h4v4" /><path d="M3 21h18" />
                  </svg>
                  <div style={{ ...mono, fontSize: 9.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#03808f', marginBottom: 6 }}>OptiMenu</div>
                  <div style={{ fontSize: 14.5, fontWeight: 700 }}>Overnight scoring</div>
                </div>
              </div>
            </div>

            <div className="om-2" style={{ gap: 26, alignItems: 'stretch' }}>
              <div style={{ background: '#fff', borderRadius: 14, padding: 28, boxShadow: '0 6px 18px rgba(17,24,25,0.05)' }}>
                <h3 style={{ fontSize: 17, marginBottom: 16 }}>What we read</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 11, fontSize: 14.5, color: '#3c4749' }}>
                  {DATA_READ.map((d) => (
                    <div key={d} style={check}><span style={{ color: '#02a4ba' }}>✓</span>{d}</div>
                  ))}
                </div>
              </div>
              <div style={{ background: '#fff', borderRadius: 14, padding: 28, boxShadow: '0 6px 18px rgba(17,24,25,0.05)' }}>
                <h3 style={{ fontSize: 17, marginBottom: 16 }}>What we never touch</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 11, fontSize: 14.5, color: '#3c4749' }}>
                  {DATA_NEVER.map((d) => (
                    <div key={d} style={check}><span style={{ color: '#9aa5a7' }}>✕</span>{d}</div>
                  ))}
                </div>
              </div>
            </div>

            <p style={{
              fontSize: 14.5, lineHeight: 1.7, color: '#5a6669', maxWidth: '62ch',
              marginTop: 30, borderTop: '1px solid #eaeeef', paddingTop: 26,
            }}>
              Direct POS integrations are in progress. Any restaurant can import item-level sales by CSV today.
            </p>
          </section>

          {/* 05 PRICING */}
          <section className="om-sec" id="pricing" style={{ borderTop: '1px solid #eaeeef', padding: '84px 34px' }}>
            <div className="om-2" style={{ gap: 52 }}>
              <div>
                <Eyebrow n="05">Pricing</Eyebrow>
                <h2 className="om-h2" style={{ fontSize: 38, marginBottom: 14 }}>Flat rate, per restaurant.</h2>
                <p style={{ fontSize: 16, lineHeight: 1.7, color: '#5a6669', maxWidth: '44ch', marginBottom: 26 }}>
                  No per-location fees, no setup fees, no contract. One price whether you run twelve covers a night or two hundred.
                </p>
                <div style={{
                  display: 'flex', flexDirection: 'column', gap: 11, fontSize: 14.5, color: '#3c4749',
                  borderTop: '1px solid #eaeeef', paddingTop: 24,
                }}>
                  <div style={check}><span style={{ color: '#02a4ba' }}>✓</span>Cancel any time from your account</div>
                  <div style={check}><span style={{ color: '#02a4ba' }}>✓</span>We set it up with you, start to finish</div>
                  <div style={check}><span style={{ color: '#02a4ba' }}>✓</span>Three tags in the box</div>
                </div>
              </div>
              <div style={{ border: '1.5px solid #02a4ba', borderRadius: 16, padding: 32, boxShadow: '0 14px 34px rgba(2,164,186,0.12)' }}>
                <div style={{ ...mono, fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#7c8789', marginBottom: 14 }}>
                  Per restaurant
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4 }}>
                  <span style={{ fontSize: 22, fontWeight: 600, color: '#7c8789', marginTop: 10 }}>$</span>
                  <span style={{ fontSize: 58, fontWeight: 800, lineHeight: 1, letterSpacing: '-0.04em' }}>59</span>
                  <span style={{ fontSize: 14, color: '#7c8789', marginTop: 32, marginLeft: 5 }}>/ month</span>
                </div>
                <div style={{ height: 1, background: '#eaeeef', margin: '22px 0' }} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 14, color: '#3c4749', marginBottom: 26 }}>
                  {PLAN.map((line) => (
                    <div key={line} style={check}><span style={{ color: '#02a4ba' }}>✓</span>{line}</div>
                  ))}
                </div>
                <Link href="/client/signup" style={{
                  display: 'block', textAlign: 'center', background: '#02a4ba', color: '#fff',
                  borderRadius: 24, padding: 13, fontWeight: 700, fontSize: 14.5,
                }}>{CTA}</Link>
              </div>
            </div>
          </section>

          {/* 06 FAQ */}
          <section className="om-sec" id="faq" style={{ background: '#f7f8f8', borderTop: '1px solid #eaeeef', padding: '84px 34px' }}>
            <div style={{ maxWidth: 860, margin: '0 auto' }}>
              <Eyebrow n="06">FAQ</Eyebrow>
              <h2 className="om-h2" style={{ fontSize: 38, marginBottom: 30 }}>Questions operators ask.</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {FAQS.map((f, i) => (
                  <FaqItem
                    key={f.q}
                    q={f.q}
                    a={f.a}
                    open={openFaq === i}
                    onToggle={() => setOpenFaq(openFaq === i ? -1 : i)}
                  />
                ))}
              </div>
            </div>
          </section>

          {/* CTA */}
          <section className="om-sec" id="contact" style={{ borderTop: '1px solid #eaeeef', padding: '84px 34px' }}>
            <div style={{
              background: '#0f1c20', borderRadius: 18, padding: '64px 48px', display: 'flex',
              gap: 44, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <div style={{ maxWidth: '50ch' }}>
                <h2 className="om-h2" style={{ fontSize: 36, color: '#fff', marginBottom: 14 }}>Stop guessing what to sell tonight.</h2>
                <p style={{ fontSize: 16, lineHeight: 1.7, color: '#a8b8bc' }}>
                  Invoices and sales in, a scored menu out, tonight&rsquo;s picks on the floor before service. Setup takes an
                  afternoon, and we do it with you.
                </p>
              </div>
              <div style={{ display: 'flex', gap: 13, flexWrap: 'wrap' }}>
                <Link href="/client/signup" style={{
                  background: '#02a4ba', color: '#fff', borderRadius: 26, padding: '15px 30px', fontWeight: 700, fontSize: 15,
                }}>{CTA}</Link>
                <a href="#pricing" style={{
                  border: '1px solid rgba(255,255,255,0.3)', color: '#fff', borderRadius: 26,
                  padding: '15px 30px', fontWeight: 700, fontSize: 15,
                }}>See pricing</a>
              </div>
            </div>
          </section>

          {/* FOOTER */}
          <footer style={{ borderTop: '1px solid #edf0f1', padding: '44px 34px 30px' }}>
            <div className="om-foot">
              <div>
                <img src="/landing/logo.png" alt="optiMenu Solutions" style={{ display: 'block', height: 34, width: 'auto', marginBottom: 14 }} />
                <p style={{ fontSize: 13.5, lineHeight: 1.7, color: '#7c8789', maxWidth: '32ch' }}>
                  Nightly menu intelligence for independent restaurants.
                </p>
              </div>
              {FOOTER_COLS.map((col) => (
                <div key={col.title}>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 13 }}>{col.title}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 9, fontSize: 13.5 }}>
                    {col.links.map((l) => (
                      <a key={l.label} href={l.href} style={{ color: '#7c8789' }}>{l.label}</a>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div style={{
              marginTop: 32, paddingTop: 20, borderTop: '1px solid #edf0f1', display: 'flex',
              justifyContent: 'space-between', gap: 20, flexWrap: 'wrap', fontSize: 12.5, color: '#9aa5a7',
            }}>
              <span>© 2026 OptiMenu Solutions LLC</span>
              <span style={{ display: 'flex', gap: 22 }}>
                <a href="/privacy" style={{ color: '#9aa5a7' }}>Privacy</a>
                <a href="/terms" style={{ color: '#9aa5a7' }}>Terms</a>
              </span>
            </div>
          </footer>
        </div>
        <div style={{ height: 26 }} />
      </div>
    </>
  );
}
