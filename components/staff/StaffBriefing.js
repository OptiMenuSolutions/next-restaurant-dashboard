// components/staff/StaffBriefing.js
// The staff briefing screen, shared by /t/[code] (tag links) and the older
// /staff/[token] links. It only ever gets the restaurant name and the three
// tickets. No restaurant id is passed in, so none can show up in the page
// source or the browser dev tools.
import Head from 'next/head';
import { useState, useEffect } from 'react';

const MONO = "'IBM Plex Mono', ui-monospace, Menlo, monospace";
const SANS = "'Manrope', system-ui, -apple-system, sans-serif";

// Darker than the first versions so each label passes contrast on white.
const TICKET_META = [
  { label: 'PUSH TONIGHT', color: '#03707d' },
  { label: 'RECOMMEND',    color: '#2f7a44' },
  { label: 'MENTION',      color: '#8a5e0f' },
];

const SPOTS = [
  { label: 'Host stand',     icon: 'M6 6h12l-1.5 4h-9L6 6zM9 10v10M15 10v10M7 20h10' },
  { label: 'Server station', icon: 'M5 4h14a1 1 0 011 1v9a1 1 0 01-1 1H5a1 1 0 01-1-1V5a1 1 0 011-1zM12 15v5M8.5 20h7' },
  { label: 'Kitchen pass',   icon: 'M4 17h16M6 17a6 6 0 0112 0M12 8.5V6.5M10 6.5h4' },
  { label: 'Bar',            icon: 'M5 4h14l-7 8-7-8zM12 12v8M8 20h8' },
  { label: 'Back office',    icon: 'M6 20V4h12v16M4 20h16M14.5 12h.01' },
];
const OTHER_ICON = 'M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4';

function Icon({ d, size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#03707d" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

function ReceiptTicket({ rec, index, loading }) {
  const meta = TICKET_META[index] || TICKET_META[2];

  return (
    <article style={styles.ticket}>
      <div style={styles.ticketHeader}>
        <span style={{ fontWeight: 700, color: meta.color }}>{meta.label}</span>
        <span style={styles.ticketNum}>#{String(index + 1).padStart(3, '0')}</span>
      </div>
      <div style={styles.dashed} />
      {loading ? (
        <div style={styles.loadingLines}>
          <span style={{ ...styles.loadingBar, height: 16, width: '62%', background: '#ebe5db' }} />
          <span style={{ ...styles.loadingBar, width: '92%' }} />
          <span style={{ ...styles.loadingBar, width: '78%' }} />
        </div>
      ) : (
        <>
          <h2 style={{ ...styles.dishName, color: meta.color }}>{rec.title}</h2>
          {rec.description && <p style={styles.descText}>{rec.description}</p>}
          {rec.talking_point && (
            <>
              <div style={styles.dashed} />
              <div style={styles.sayLabel}>SAY THIS</div>
              <p style={styles.sayText}>“{rec.talking_point}”</p>
            </>
          )}
        </>
      )}
    </article>
  );
}

// Shown on a tag's first tap only, so we know which tag sits where.
// The save cannot be changed from this page, so a spot is confirmed first.
function SpotSheet({ tagLabel, takenSpots, onSave, onSkip, onSaved }) {
  const [step, setStep] = useState('pick'); // pick, other or confirm
  const [other, setOther] = useState('');
  const [pending, setPending] = useState(null);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  const taken = new Set((takenSpots || []).map((spot) => String(spot).toLowerCase()));
  const kicker = `NEW TAG${tagLabel ? ` · ${String(tagLabel).toUpperCase()}` : ''}`;

  function ask(label, icon, from) {
    setPending({ label, icon, from });
    setFailed(false);
    setStep('confirm');
  }

  async function confirm() {
    if (!pending || saving) return;
    setSaving(true);
    setFailed(false);
    const result = await onSave(pending.label);
    setSaving(false);
    if (result === 'ok') onSaved(pending.label);
    else if (result === 'taken') onSaved(null);
    else setFailed(true);
  }

  return (
    <div style={styles.scrim}>
      <section role="dialog" aria-modal="true" aria-labelledby="spot-title" style={styles.sheet}>
        <div aria-hidden="true" style={styles.grabber} />

        {step === 'confirm' && pending ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 4 }}>
            <div style={styles.confirmHead}>
              <span style={styles.confirmIcon}><Icon d={pending.icon} size={28} /></span>
              <div style={styles.kicker}>{kicker}</div>
              <h2 id="spot-title" style={styles.sheetTitle}>Save this tag as {pending.label}?</h2>
              <p style={{ ...styles.sheetSub, maxWidth: 290 }}>
                This only gets asked once, so make sure it is right. It cannot be changed from this page.
              </p>
            </div>
            {failed && (
              <div role="alert" style={styles.spotError}>Could not save. Check your connection and try again.</div>
            )}
            <div style={styles.confirmRow}>
              <button type="button" style={styles.backBtn} disabled={saving} onClick={() => setStep(pending.from)}>
                Back
              </button>
              <button type="button" style={styles.yesBtn} disabled={saving} onClick={confirm}>
                {saving ? 'Saving…' : 'Yes, save'}
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={styles.kicker}><span style={styles.kickerDot} />{kicker}</div>
              <h2 id="spot-title" style={styles.sheetTitle}>Where did you just tap?</h2>
              <p style={styles.sheetSub}>Pick the spot once. Every tap after this goes straight to tonight&rsquo;s picks.</p>
            </div>

            <div style={styles.spotGrid}>
              {SPOTS.map((spot) => (
                <button key={spot.label} type="button" style={styles.spotBtn} onClick={() => ask(spot.label, spot.icon, 'pick')}>
                  <Icon d={spot.icon} />
                  <span>{spot.label}</span>
                  {taken.has(spot.label.toLowerCase()) && <span style={styles.spotNote}>HAS A TAG</span>}
                </button>
              ))}
              <button
                type="button"
                aria-pressed={step === 'other'}
                style={step === 'other' ? { ...styles.spotBtn, ...styles.spotBtnOn } : styles.spotBtn}
                onClick={() => setStep('other')}
              >
                <Icon d={OTHER_ICON} />
                <span>Somewhere else</span>
              </button>
            </div>

            {step === 'other' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label htmlFor="spot-other" style={styles.otherLabel}>Name the spot</label>
                <div style={styles.spotOtherRow}>
                  <input
                    id="spot-other"
                    style={styles.spotInput}
                    value={other}
                    maxLength={40}
                    autoFocus
                    placeholder="Like Patio stand or Expo"
                    onChange={(e) => setOther(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && other.trim()) ask(other.trim(), OTHER_ICON, 'other');
                    }}
                  />
                  <button
                    type="button"
                    style={{ ...styles.spotSave, opacity: other.trim() ? 1 : 0.45 }}
                    disabled={!other.trim()}
                    onClick={() => ask(other.trim(), OTHER_ICON, 'other')}
                  >
                    Save
                  </button>
                </div>
              </div>
            )}

            <div style={styles.skipRow}>
              <span style={styles.skipText}>Not sure? Skip and the next person who taps here gets asked.</span>
              <button type="button" style={styles.skipBtn} onClick={onSkip}>Skip</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

const FONT_LINK = 'https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500;600;700&display=swap';

export default function StaffBriefing({ restaurantName, cachedRecommendations, requestBody, askSpot, onSaveSpot, tagLabel, takenSpots }) {
  const [recommendations, setRecommendations] = useState(cachedRecommendations || []);
  const [loading, setLoading] = useState(!cachedRecommendations?.length);
  const [sheetOpen, setSheetOpen] = useState(Boolean(askSpot && onSaveSpot));
  const [toast, setToast] = useState(null);

  useEffect(() => {
    if (!restaurantName || cachedRecommendations?.length) return;
    async function generate() {
      try {
        // requestBody is { tagCode } or { nfcToken }. The endpoint resolves
        // the restaurant from it server side.
        const res = await fetch('/api/ai-recommendations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        });
        const data = await res.json();
        setRecommendations(data.recommendations ?? []);
      } catch (e) {
        console.error('[staff] generation failed:', e);
      } finally {
        setLoading(false);
      }
    }
    generate();
  }, []);

  // Keep the page behind the sheet from scrolling while it is open.
  useEffect(() => {
    if (!sheetOpen) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [sheetOpen]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  function handleSaved(spot) {
    setSheetOpen(false);
    setToast(spot
      ? { title: 'Saved.', text: `This tag is at the ${spot.toLowerCase()}.` }
      : { title: 'All set.', text: 'Someone already saved where this tag is.' });
  }

  if (!restaurantName) {
    return (
      <>
        <Head>
          <title>OptiMenu</title>
          <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
          <meta name="robots" content="noindex, nofollow" />
          <link rel="stylesheet" href={FONT_LINK} />
        </Head>
        <div style={styles.page}>
          <div style={styles.errorWrap}>
            <p style={styles.errorText}>This link is no longer active.</p>
          </div>
        </div>
      </>
    );
  }

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  });
  const pickCount = Math.min(recommendations.length, 3);

  return (
    <>
      <Head>
        <title>{`Tonight's Dish — ${restaurantName}`}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
        <meta name="robots" content="noindex, nofollow" />
        <link rel="stylesheet" href={FONT_LINK} />
      </Head>

      <div style={styles.page}>
        <header style={styles.header}>
          <div style={styles.headerTop}>
            <span style={{ color: '#03707d', fontWeight: 600 }}>TONIGHT&rsquo;S DISH</span>
            <span>STAFF ONLY</span>
          </div>
          <h1 style={styles.restaurantName}>{restaurantName}</h1>
          <div style={styles.date}>
            {today}
            {!loading && pickCount > 0 ? ` · ${pickCount} ${pickCount === 1 ? 'pick' : 'picks'} for tonight` : ''}
          </div>
        </header>

        {loading && (
          <div role="status" style={styles.generatingWrap}>
            <span style={styles.spinner} aria-hidden="true" />
            <span><b>Writing tonight&rsquo;s picks.</b> <span style={{ color: '#6b6358' }}>About 10 seconds.</span></span>
          </div>
        )}

        <main style={styles.cards}>
          {loading
            ? [0, 1, 2].map((i) => <ReceiptTicket key={i} index={i} loading />)
            : recommendations.length === 0
            ? (
              <div style={styles.emptyState}>
                <p style={styles.emptyText}>No picks for tonight yet.</p>
                <p style={styles.emptySubtext}>Check back after the daily briefing is ready.</p>
              </div>
            )
            : recommendations.slice(0, 3).map((rec, i) => (
              <ReceiptTicket key={i} rec={rec} index={i} loading={false} />
            ))
          }
          <div style={styles.footerText}>OPTIMENU · STAFF USE ONLY</div>
        </main>
      </div>

      {sheetOpen && (
        <SpotSheet
          tagLabel={tagLabel}
          takenSpots={takenSpots}
          onSave={onSaveSpot}
          onSkip={() => setSheetOpen(false)}
          onSaved={handleSaved}
        />
      )}

      {toast && (
        <div role="status" style={styles.toast}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#7fd6a0" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
          <span style={{ flex: 1, minWidth: 0 }}><b>{toast.title}</b> {toast.text}</span>
        </div>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%, 100% { opacity: 0.55; } 50% { opacity: 1; } }
      `}</style>
    </>
  );
}

const styles = {
  page: {
    background: '#f0ece4',
    minHeight: '100vh',
    fontFamily: SANS,
    color: '#1a1612',
    paddingBottom: 'calc(32px + env(safe-area-inset-bottom))',
  },
  header: {
    margin: '0 16px',
    padding: '22px 4px 16px',
    borderBottom: '1px dashed #cfc6b9',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  headerTop: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontFamily: MONO,
    fontSize: 10.5,
    letterSpacing: '0.16em',
    color: '#6b6358',
  },
  restaurantName: {
    margin: '6px 0 0',
    fontFamily: MONO,
    fontSize: 24,
    fontWeight: 700,
    letterSpacing: '-0.01em',
    lineHeight: 1.15,
  },
  date: {
    fontSize: 13.5,
    color: '#6b6358',
  },
  generatingWrap: {
    margin: '16px 16px 0',
    padding: '10px 14px',
    borderRadius: 10,
    background: '#ffffff',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    fontSize: 13,
  },
  spinner: {
    width: 16,
    height: 16,
    flexShrink: 0,
    border: '2px solid #d6cec2',
    borderTopColor: '#03707d',
    borderRadius: '50%',
    animation: 'spin 0.7s linear infinite',
  },
  cards: {
    padding: '16px 16px 0',
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  ticket: {
    background: '#ffffff',
    borderRadius: 4,
    padding: '16px 16px 14px',
    boxShadow: '0 1px 1px rgba(26,22,18,0.05), 0 3px 8px rgba(26,22,18,0.08)',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  ticketHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontFamily: MONO,
    fontSize: 11,
    letterSpacing: '0.14em',
  },
  ticketNum: {
    color: '#6b6358',
  },
  dashed: {
    borderTop: '1px dashed #d6cec2',
  },
  dishName: {
    margin: 0,
    fontFamily: MONO,
    fontSize: 20,
    fontWeight: 700,
    lineHeight: 1.25,
    overflowWrap: 'anywhere',
  },
  descText: {
    margin: 0,
    fontSize: 14,
    lineHeight: 1.5,
    color: '#3a332c',
  },
  sayLabel: {
    fontFamily: MONO,
    fontSize: 10.5,
    letterSpacing: '0.14em',
    color: '#6b6358',
  },
  sayText: {
    margin: '-4px 0 0',
    fontSize: 15,
    lineHeight: 1.5,
    fontWeight: 600,
  },
  loadingLines: {
    display: 'flex',
    flexDirection: 'column',
    gap: 9,
    padding: '2px 0 4px',
  },
  loadingBar: {
    display: 'block',
    height: 10,
    borderRadius: 3,
    background: '#f1ece4',
    animation: 'pulse 1.4s ease-in-out infinite',
  },
  emptyState: {
    textAlign: 'center',
    padding: '40px 24px',
  },
  emptyText: {
    margin: '0 0 8px',
    color: '#5a524a',
    fontSize: 15,
    fontWeight: 600,
  },
  emptySubtext: {
    margin: 0,
    color: '#6b6358',
    fontSize: 13.5,
  },
  footerText: {
    textAlign: 'center',
    fontFamily: MONO,
    fontSize: 11,
    letterSpacing: '0.08em',
    color: '#6b6358',
    padding: '6px 0 0',
  },
  scrim: {
    position: 'fixed',
    inset: 0,
    zIndex: 50,
    background: 'rgba(26,22,18,0.42)',
    display: 'flex',
    alignItems: 'flex-end',
  },
  sheet: {
    width: '100%',
    maxWidth: 520,
    margin: '0 auto',
    maxHeight: '92dvh',
    overflowY: 'auto',
    boxSizing: 'border-box',
    background: '#faf8f4',
    borderRadius: '22px 22px 0 0',
    padding: '10px 16px calc(26px + env(safe-area-inset-bottom))',
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
    boxShadow: '0 -12px 40px rgba(26,22,18,0.25)',
    fontFamily: SANS,
    color: '#1a1612',
  },
  grabber: {
    width: 40,
    height: 5,
    borderRadius: 3,
    background: '#cfc6b9',
    alignSelf: 'center',
  },
  kicker: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontFamily: MONO,
    fontSize: 10.5,
    letterSpacing: '0.14em',
    color: '#03707d',
    fontWeight: 600,
  },
  kickerDot: {
    width: 7,
    height: 7,
    borderRadius: '50%',
    background: '#02a4ba',
  },
  sheetTitle: {
    margin: 0,
    fontSize: 22,
    fontWeight: 800,
    letterSpacing: '-0.02em',
    lineHeight: 1.25,
  },
  sheetSub: {
    margin: 0,
    fontSize: 14,
    lineHeight: 1.45,
    color: '#5a524a',
  },
  spotGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: 8,
  },
  spotBtn: {
    minHeight: 82,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: '10px 6px',
    borderRadius: 12,
    border: '1px solid #d6cec2',
    background: '#ffffff',
    color: '#1a1612',
    fontFamily: SANS,
    fontSize: 13.5,
    fontWeight: 700,
    lineHeight: 1.2,
    textAlign: 'center',
    cursor: 'pointer',
  },
  spotBtnOn: {
    border: '1.5px solid #03707d',
    background: '#e8f4f5',
  },
  spotNote: {
    fontFamily: MONO,
    fontSize: 9.5,
    fontWeight: 600,
    letterSpacing: '0.06em',
    color: '#6b6358',
  },
  otherLabel: {
    fontSize: 12.5,
    fontWeight: 700,
  },
  spotOtherRow: {
    display: 'flex',
    gap: 8,
  },
  spotInput: {
    flex: 1,
    minWidth: 0,
    minHeight: 48,
    boxSizing: 'border-box',
    borderRadius: 10,
    border: '1.5px solid #03707d',
    padding: '0 12px',
    fontFamily: SANS,
    fontSize: 16,
    color: '#1a1612',
    background: '#ffffff',
  },
  spotSave: {
    minHeight: 48,
    padding: '0 20px',
    borderRadius: 24,
    border: 0,
    background: '#03707d',
    color: '#ffffff',
    fontFamily: SANS,
    fontSize: 15,
    fontWeight: 700,
    cursor: 'pointer',
  },
  skipRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingTop: 12,
    borderTop: '1px dashed #cfc6b9',
  },
  skipText: {
    fontSize: 13,
    lineHeight: 1.4,
    color: '#5a524a',
  },
  skipBtn: {
    minHeight: 44,
    padding: '0 18px',
    flexShrink: 0,
    borderRadius: 22,
    border: '1px solid #cfc6b9',
    background: 'transparent',
    color: '#1a1612',
    fontFamily: SANS,
    fontSize: 14,
    fontWeight: 700,
    cursor: 'pointer',
  },
  confirmHead: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 10,
    textAlign: 'center',
    padding: '8px 0 4px',
  },
  confirmIcon: {
    width: 56,
    height: 56,
    borderRadius: '50%',
    background: '#e8f4f5',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 10,
  },
  backBtn: {
    minHeight: 50,
    borderRadius: 25,
    border: '1px solid #cfc6b9',
    background: '#ffffff',
    color: '#1a1612',
    fontFamily: SANS,
    fontSize: 15,
    fontWeight: 700,
    cursor: 'pointer',
  },
  yesBtn: {
    minHeight: 50,
    borderRadius: 25,
    border: 0,
    background: '#03707d',
    color: '#ffffff',
    fontFamily: SANS,
    fontSize: 15,
    fontWeight: 700,
    cursor: 'pointer',
  },
  spotError: {
    padding: '10px 12px',
    borderRadius: 10,
    background: '#fbeceb',
    color: '#a8372f',
    fontSize: 13,
    textAlign: 'center',
  },
  toast: {
    position: 'fixed',
    zIndex: 60,
    left: 16,
    right: 16,
    bottom: 'calc(24px + env(safe-area-inset-bottom))',
    maxWidth: 488,
    margin: '0 auto',
    boxSizing: 'border-box',
    background: '#1a1612',
    color: '#f7f3ec',
    borderRadius: 14,
    padding: '14px 16px',
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    boxShadow: '0 12px 30px rgba(26,22,18,0.30)',
    fontFamily: SANS,
    fontSize: 14,
    lineHeight: 1.35,
  },
  errorWrap: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    padding: 24,
  },
  errorText: {
    color: '#5a524a',
    fontSize: 15,
    textAlign: 'center',
  },
};