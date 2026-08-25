// components/landing/LegalPage.js
// Shared shell for /privacy and /terms: sticky nav, dot-grid hero, numbered
// contents, numbered sections and the site footer. Same conventions as
// pages/index.js — inline style objects plus one <style> block for the classes
// and media queries.
import Head from 'next/head';
import Link from 'next/link';

export const ACCENT = '#02a4ba';
export const ACCENT_DARK = '#03808f';
const MONO = "'IBM Plex Mono', monospace";

export const S = {
  p: { fontSize: 15.5, lineHeight: 1.85, color: '#5a6669' },
  pTight: { fontSize: 15.5, lineHeight: 1.8, color: '#5a6669' },
  strong: { color: '#111819', fontWeight: 700 },
  stack: { display: 'flex', flexDirection: 'column', gap: 14 },
  stackTight: { display: 'flex', flexDirection: 'column', gap: 12 },
  subLabel: {
    fontFamily: MONO, fontSize: 11, letterSpacing: '0.12em',
    textTransform: 'uppercase', color: ACCENT_DARK, marginBottom: 12,
  },
};

export function Bullets({ items }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
      {items.map((item, i) => (
        <div
          key={i}
          style={{
            display: 'grid', gridTemplateColumns: '16px 1fr', gap: 12,
            fontSize: 15.5, lineHeight: 1.7, color: '#5a6669',
          }}
        >
          <span style={{ color: ACCENT }}>—</span>
          <span>{item}</span>
        </div>
      ))}
    </div>
  );
}

export function SpecTable({ head, rows }) {
  const row = {
    display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 20, padding: '13px 0',
  };
  return (
    <div style={{ background: '#f7f8f8', borderRadius: 12, padding: '6px 20px' }}>
      <div
        style={{
          ...row, fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.1em',
          textTransform: 'uppercase', color: '#9aa5a7',
        }}
      >
        <span>{head[0]}</span>
        <span>{head[1]}</span>
      </div>
      {rows.map(([name, purpose]) => (
        <div key={name} style={{ ...row, borderTop: '1px solid #e6eaeb', fontSize: 14.5 }}>
          <span style={{ fontWeight: 600, color: '#111819' }}>{name}</span>
          <span style={{ color: '#5a6669' }}>{purpose}</span>
        </div>
      ))}
    </div>
  );
}

export function Callout({ label, children }) {
  return (
    <div
      style={{
        background: '#f2fbfc', border: '1px solid #bde6ec',
        borderLeft: `3px solid ${ACCENT}`, borderRadius: 12, padding: '24px 26px',
      }}
    >
      <div
        style={{
          fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.14em',
          textTransform: 'uppercase', color: ACCENT_DARK, marginBottom: 14,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

export function MailButton({ email, children }) {
  return (
    <a
      href={`mailto:${email}`}
      style={{
        display: 'inline-block', background: ACCENT, color: '#fff', borderRadius: 26,
        padding: '14px 30px', fontWeight: 700, fontSize: 15,
        boxShadow: '0 10px 24px rgba(2,164,186,0.28)',
      }}
    >
      {children}
    </a>
  );
}

const num = (i) => String(i + 1).padStart(2, '0');

export default function LegalPage({
  title, docNumber, effectiveDate, description, intro, sections, otherDoc,
}) {
  return (
    <>
      <Head>
        <title>{`${title} — OptiMenu`}</title>
        <meta name="description" content={description} />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </Head>

      <div style={{ padding: '26px 26px 0' }}>
        <div
          style={{
            maxWidth: 1080, margin: '0 auto', background: '#fff', borderRadius: 14,
            overflow: 'hidden', boxShadow: '0 22px 60px rgba(17,24,25,0.1)',
          }}
        >
          <div
            style={{
              position: 'sticky', top: 0, zIndex: 30, background: 'rgba(255,255,255,0.94)',
              backdropFilter: 'blur(10px)', borderBottom: '1px solid #edf0f1',
            }}
          >
            <div
              style={{
                padding: '16px 34px', display: 'flex', alignItems: 'center',
                justifyContent: 'space-between', gap: 24,
              }}
            >
              <Link href="/" style={{ display: 'flex', alignItems: 'center' }}>
                <img
                  src="/landing/logo.png"
                  alt="optiMenu Solutions"
                  style={{ display: 'block', height: 38, width: 'auto' }}
                />
              </Link>
              <div
                className="lg-nav-links"
                style={{
                  display: 'flex', alignItems: 'center', gap: 20,
                  fontSize: 14.5, fontWeight: 500,
                }}
              >
                <Link href={otherDoc.href} style={{ color: '#4a575a' }}>{otherDoc.label}</Link>
                <Link
                  href="/"
                  style={{
                    display: 'inline-block', whiteSpace: 'nowrap',
                    border: '1px solid #d7dedf', borderRadius: 22,
                    padding: '9px 20px', color: '#111819',
                  }}
                >
                  ← Back to home
                </Link>
              </div>
            </div>
          </div>

          <section
            className="lg-sec"
            style={{
              background: '#f7f8f8',
              backgroundImage: 'radial-gradient(#dfe4e5 1px, transparent 1px)',
              backgroundSize: '14px 14px', borderBottom: '1px solid #eaeeef',
              padding: '60px 34px 54px',
            }}
          >
            <div style={{ maxWidth: 760, margin: '0 auto' }}>
              <div
                style={{
                  fontFamily: MONO, fontSize: 11, letterSpacing: '0.12em',
                  textTransform: 'uppercase', color: ACCENT_DARK, marginBottom: 14,
                }}
              >
                <span style={{ color: '#9aa5a7' }}>{docNumber}</span>
                {'\u00a0 Legal'}
              </div>
              <h1
                className="lg-h1"
                style={{ fontSize: 'clamp(34px,3.4vw,50px)', fontWeight: 800, marginBottom: 12 }}
              >
                {title}
              </h1>
              <div
                style={{
                  fontFamily: MONO, fontSize: 12, letterSpacing: '0.08em',
                  textTransform: 'uppercase', color: '#7c8789',
                }}
              >
                Effective {effectiveDate}
              </div>
              <p
                style={{
                  fontSize: 16.5, lineHeight: 1.8, color: '#5a6669',
                  maxWidth: '70ch', marginTop: 26,
                }}
              >
                {intro}
              </p>
            </div>
          </section>

          <section className="lg-sec" style={{ padding: 34, borderBottom: '1px solid #eaeeef' }}>
            <div style={{ maxWidth: 760, margin: '0 auto' }}>
              <div
                style={{
                  fontFamily: MONO, fontSize: 11, letterSpacing: '0.12em',
                  textTransform: 'uppercase', color: '#9aa5a7', marginBottom: 18,
                }}
              >
                Contents
              </div>
              <div className="lg-toc">
                {sections.map((s, i) => (
                  <a key={s.id} href={`#${s.id}`} style={{ fontSize: 14, color: '#4a575a' }}>
                    <span style={{ fontFamily: MONO, color: '#9aa5a7', marginRight: 10 }}>
                      {num(i)}
                    </span>
                    {s.tocLabel || s.heading}
                  </a>
                ))}
              </div>
            </div>
          </section>

          <section className="lg-sec" style={{ padding: '14px 34px 70px' }}>
            <div
              style={{
                maxWidth: 760, margin: '0 auto', display: 'flex', flexDirection: 'column',
              }}
            >
              {sections.map((s, i) => {
                const last = i === sections.length - 1;
                return (
                  <section
                    key={s.id}
                    id={s.id}
                    style={{
                      scrollMarginTop: 92,
                      padding: last ? '38px 0 0' : '38px 0',
                      borderBottom: last ? 'none' : '1px solid #eaeeef',
                    }}
                  >
                    <div className="lg-row">
                      <div
                        style={{
                          fontFamily: MONO, fontSize: 13, color: '#9aa5a7', paddingTop: 5,
                        }}
                      >
                        {num(i)}
                      </div>
                      <div>
                        <h2 style={{ fontSize: 26, marginBottom: s.headingGap || 14 }}>
                          {s.heading}
                        </h2>
                        {s.body}
                      </div>
                    </div>
                  </section>
                );
              })}
            </div>
          </section>

          <Footer />
        </div>
        <div style={{ height: 26 }} />
      </div>

      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html { scroll-behavior: smooth; }
        body {
          background: #e6e4e0;
          color: #111819;
          font-family: 'Manrope', system-ui, sans-serif;
          -webkit-font-smoothing: antialiased;
        }
        h1, h2, h3 { font-weight: 700; letter-spacing: -0.03em; line-height: 1.1; }
        a { color: #03808f; text-decoration: none; }
        a:hover { color: #02a4ba; }
        .lg-toc { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 34px; }
        .lg-row { display: grid; grid-template-columns: 54px 1fr; gap: 22px; }
        .lg-foot { display: grid; grid-template-columns: 1.4fr 1fr 1fr; gap: 36px; }
        @media (max-width: 920px) {
          .lg-toc, .lg-foot { grid-template-columns: 1fr; }
          .lg-row { grid-template-columns: 1fr; gap: 8px; }
          .lg-sec { padding-left: 22px !important; padding-right: 22px !important; }
          .lg-h1 { font-size: 38px !important; }
          .lg-nav-links { display: none !important; }
        }
      `}</style>
    </>
  );
}

function Footer() {
  const col = { display: 'flex', flexDirection: 'column', gap: 9, fontSize: 13.5 };
  const head = { fontSize: 13, fontWeight: 700, marginBottom: 13 };
  const muted = { color: '#7c8789' };
  return (
    <footer style={{ borderTop: '1px solid #edf0f1', padding: '44px 34px 30px' }}>
      <div className="lg-foot">
        <div>
          <img
            src="/landing/logo.png"
            alt="optiMenu Solutions"
            style={{ display: 'block', height: 34, width: 'auto', marginBottom: 14 }}
          />
          <p style={{ fontSize: 13.5, lineHeight: 1.7, color: '#7c8789', maxWidth: '32ch' }}>
            Nightly menu intelligence for independent restaurants.
          </p>
        </div>
        <div>
          <div style={head}>Legal</div>
          <div style={col}>
            <Link href="/privacy" style={muted}>Privacy Policy</Link>
            <Link href="/terms" style={muted}>Terms of Service</Link>
          </div>
        </div>
        <div>
          <div style={head}>Company</div>
          <div style={col}>
            <Link href="/" style={muted}>Home</Link>
            <a href="mailto:hello@opti-menu.com" style={muted}>Contact</a>
          </div>
        </div>
      </div>
      <div
        style={{
          marginTop: 32, paddingTop: 20, borderTop: '1px solid #edf0f1', display: 'flex',
          justifyContent: 'space-between', gap: 20, flexWrap: 'wrap',
          fontSize: 12.5, color: '#9aa5a7',
        }}
      >
        <span>© 2026 OptiMenu Solutions LLC</span>
        <span style={{ display: 'flex', gap: 22 }}>
          <Link href="/privacy" style={{ color: '#9aa5a7' }}>Privacy</Link>
          <Link href="/terms" style={{ color: '#9aa5a7' }}>Terms</Link>
        </span>
      </div>
    </footer>
  );
}
