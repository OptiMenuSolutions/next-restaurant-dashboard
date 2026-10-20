// components/staff/StaffBriefing.js
// The staff briefing screen, shared by /t/[code] (tag links) and the older
// /staff/[token] links. It only ever gets the restaurant name and the three
// tickets. No restaurant id is passed in, so none can show up in the page
// source or the browser dev tools.
import Head from 'next/head';
import { useState, useEffect } from 'react';

const TICKET_META = [
  { label: 'PUSH TONIGHT', color: '#02a4ba' },
  { label: 'RECOMMEND',    color: '#4caf50' },
  { label: 'MENTION',      color: '#f5a623' },
];

const SPOTS = ['Host stand', 'Server station', 'Kitchen pass', 'Bar', 'Back office'];

function ReceiptTicket({ rec, index, loading }) {
  const meta = TICKET_META[index] || TICKET_META[2];

  if (loading) {
    return (
      <div style={styles.ticket}>
        <div style={styles.ticketHeader}>
          <span style={{ ...styles.ticketLabel, color: meta.color }}>{meta.label}</span>
          <span style={styles.ticketNum}>#{String(index + 1).padStart(3, '0')}</span>
        </div>
        <div style={styles.dashed} />
        <div style={styles.loadingLines}>
          <div style={{ ...styles.loadingBar, width: '60%' }} />
          <div style={{ ...styles.loadingBar, width: '80%' }} />
          <div style={{ ...styles.loadingBar, width: '45%' }} />
        </div>
        <div style={styles.dashed} />
        <div style={{ ...styles.loadingBar, width: '90%', marginTop: 8 }} />
        <div style={{ ...styles.loadingBar, width: '70%', marginTop: 6 }} />
        <div style={styles.ticketFooter}>opti-menu.com</div>
      </div>
    );
  }

  return (
    <div style={styles.ticket}>
      <div style={styles.ticketHeader}>
        <span style={{ ...styles.ticketLabel, color: meta.color }}>{meta.label}</span>
        <span style={styles.ticketNum}>#{String(index + 1).padStart(3, '0')}</span>
      </div>
      <div style={styles.dashed} />
      <div style={{ ...styles.dishName, color: meta.color }}>{rec.title}</div>
      <div style={styles.dashed} />
      <div style={styles.descText}>{rec.description}</div>
      {rec.talking_point && (
        <>
          <div style={styles.dashed} />
          <div style={styles.sayLabel}>SAY THIS:</div>
          <div style={styles.sayText}>"{rec.talking_point}"</div>
        </>
      )}
      <div style={styles.ticketFooter}>opti-menu.com</div>
    </div>
  );
}

// Shown on a tag's first tap only, so we know which tag sits where.
function SpotPrompt({ onSave }) {
  const [other, setOther] = useState('');
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState(false);

  async function save(spot) {
    if (!spot || saving) return;
    setSaving(true);
    setFailed(false);
    const ok = await onSave(spot);
    setSaving(false);
    if (ok) setDone(true);
    else setFailed(true);
  }

  if (done) {
    return (
      <div style={styles.spotCard}>
        <div style={styles.spotDone}>Thanks, saved.</div>
      </div>
    );
  }

  return (
    <div style={styles.spotCard}>
      <div style={styles.spotTitle}>Where is this tag?</div>
      <div style={styles.spotSub}>Only asked once. Pick where it sits so we know which tag is which.</div>
      <div style={styles.spotGrid}>
        {SPOTS.map((s) => (
          <button key={s} type="button" style={styles.spotBtn} disabled={saving} onClick={() => save(s)}>{s}</button>
        ))}
      </div>
      <div style={styles.spotOtherRow}>
        <input
          style={styles.spotInput}
          value={other}
          maxLength={40}
          placeholder="Somewhere else"
          aria-label="Somewhere else"
          onChange={(e) => setOther(e.target.value)}
        />
        <button type="button" style={styles.spotSave} disabled={saving || !other.trim()} onClick={() => save(other.trim())}>Save</button>
      </div>
      {failed && <div style={styles.spotError}>Could not save. Try again.</div>}
    </div>
  );
}

export default function StaffBriefing({ restaurantName, cachedRecommendations, requestBody, askSpot, onSaveSpot }) {
  const [recommendations, setRecommendations] = useState(cachedRecommendations || []);
  const [loading, setLoading] = useState(!cachedRecommendations?.length);

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

  if (!restaurantName) {
    return (
      <>
        <Head>
          <title>OptiMenu</title>
          <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
          <meta name="robots" content="noindex, nofollow" />
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

  return (
    <>
      <Head>
        <title>{`Tonight's Dish — ${restaurantName}`}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
        <meta name="robots" content="noindex, nofollow" />
      </Head>

      <div style={styles.page}>
        <div style={styles.header}>
          <div style={styles.logo}>OptiMenu</div>
          <div style={styles.restaurantName}>{restaurantName}</div>
          <div style={styles.date}>{today}</div>
          <div style={styles.subtitle}>Tonight's Dish — Staff Briefing</div>
        </div>

        <div style={styles.divider} />

        {askSpot && onSaveSpot && <SpotPrompt onSave={onSaveSpot} />}

        {loading && (
          <div style={styles.generatingWrap}>
            <div style={styles.spinner} />
            <div style={styles.generatingText}>Generating tonight's picks...</div>
          </div>
        )}

        <div style={styles.cards}>
          {loading
            ? [0, 1, 2].map(i => <ReceiptTicket key={i} index={i} loading={true} />)
            : recommendations.length === 0
            ? (
              <div style={styles.emptyState}>
                <p style={styles.emptyText}>No recommendations available yet.</p>
                <p style={styles.emptySubtext}>Check back after the daily briefing is generated.</p>
              </div>
            )
            : recommendations.slice(0, 3).map((rec, i) => (
              <ReceiptTicket key={i} rec={rec} index={i} loading={false} />
            ))
          }
        </div>

        <div style={styles.footer}>
          <p style={styles.footerText}>Powered by OptiMenu · Staff use only</p>
        </div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%, 100% { opacity: 0.5; } 50% { opacity: 1; } }
      `}</style>
    </>
  );
}

const styles = {
  page: {
    background: '#f0ece4',
    minHeight: '100vh',
    fontFamily: "'Inter', sans-serif",
    color: '#1a1612',
    padding: '0 0 48px',
  },
  header: {
    padding: '40px 24px 24px',
    textAlign: 'center',
  },
  logo: {
    fontFamily: "'Courier New', monospace",
    fontSize: 13,
    letterSpacing: '0.18em',
    color: '#02a4ba',
    textTransform: 'uppercase',
    marginBottom: 16,
  },
  restaurantName: {
    fontFamily: "'Courier New', monospace",
    fontSize: 26,
    fontWeight: 600,
    color: '#1a1612',
    marginBottom: 6,
    lineHeight: 1.2,
  },
  date: {
    fontSize: 13,
    color: '#7a6e60',
    fontWeight: 300,
    letterSpacing: '0.04em',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 12,
    color: '#02a4ba',
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    fontWeight: 500,
  },
  divider: {
    height: 1,
    background: 'linear-gradient(90deg, transparent, #d0c8c0, transparent)',
    margin: '0 24px 28px',
  },
  spotCard: {
    margin: '0 16px 24px',
    background: '#ffffff',
    borderRadius: 8,
    padding: '16px 16px 14px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.10)',
    border: '1.5px solid #02a4ba',
  },
  spotTitle: {
    fontSize: 16,
    fontWeight: 700,
    marginBottom: 4,
  },
  spotSub: {
    fontSize: 12.5,
    color: '#7a6e60',
    lineHeight: 1.5,
    marginBottom: 12,
  },
  spotGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 8,
    marginBottom: 10,
  },
  spotBtn: {
    minHeight: 44,
    borderRadius: 8,
    border: '1px solid #d0c8c0',
    background: '#faf8f4',
    color: '#1a1612',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
  },
  spotOtherRow: {
    display: 'flex',
    gap: 8,
  },
  spotInput: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    borderRadius: 8,
    border: '1px solid #d0c8c0',
    padding: '0 12px',
    fontSize: 16,
    color: '#1a1612',
    background: '#ffffff',
  },
  spotSave: {
    minHeight: 44,
    padding: '0 18px',
    borderRadius: 8,
    border: 0,
    background: '#02a4ba',
    color: '#ffffff',
    fontSize: 14,
    fontWeight: 700,
    cursor: 'pointer',
  },
  spotDone: {
    fontSize: 14,
    fontWeight: 600,
    color: '#2f8a47',
    textAlign: 'center',
  },
  spotError: {
    fontSize: 12.5,
    color: '#b83c33',
    marginTop: 8,
  },
  generatingWrap: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 10,
    marginBottom: 20,
  },
  spinner: {
    width: 20,
    height: 20,
    border: '2px solid #d0c8c0',
    borderTopColor: '#02a4ba',
    borderRadius: '50%',
    animation: 'spin 0.7s linear infinite',
  },
  generatingText: {
    fontSize: 12,
    color: '#9a9080',
    letterSpacing: '0.08em',
    fontFamily: "'Courier New', monospace",
  },
  cards: {
    padding: '0 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 20,
  },
  ticket: {
    background: '#ffffff',
    borderRadius: 4,
    padding: '20px 18px 14px',
    fontFamily: "'Courier New', monospace",
    color: '#1a1612',
    boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
    position: 'relative',
  },
  ticketHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  ticketLabel: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '1.5px',
  },
  ticketNum: {
    fontSize: 10,
    color: '#9a9080',
  },
  dashed: {
    borderTop: '1px dashed #d0c8c0',
    margin: '10px 0',
  },
  dishName: {
    fontSize: 20,
    fontWeight: 700,
    lineHeight: 1.2,
    marginBottom: 2,
  },
  descText: {
    fontSize: 12,
    color: '#2a2420',
    lineHeight: 1.55,
  },
  sayLabel: {
    fontSize: 9,
    letterSpacing: '1.2px',
    color: '#9a9080',
    marginBottom: 4,
  },
  sayText: {
    fontSize: 13,
    color: '#1a1612',
    lineHeight: 1.55,
    fontStyle: 'italic',
  },
  ticketFooter: {
    fontSize: 9,
    color: '#c0b8b0',
    textAlign: 'center',
    marginTop: 12,
    letterSpacing: '0.8px',
  },
  loadingLines: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    padding: '4px 0',
  },
  loadingBar: {
    height: 10,
    background: '#e8e0d8',
    borderRadius: 2,
    animation: 'pulse 1.4s ease-in-out infinite',
  },
  emptyState: {
    textAlign: 'center',
    padding: '40px 24px',
  },
  emptyText: {
    color: '#7a6e60',
    fontSize: 15,
    marginBottom: 8,
  },
  emptySubtext: {
    color: '#9a9080',
    fontSize: 13,
  },
  footer: {
    textAlign: 'center',
    padding: '32px 24px 0',
  },
  footerText: {
    fontSize: 11,
    color: '#9a9080',
    letterSpacing: '0.06em',
  },
  errorWrap: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    padding: 24,
  },
  errorText: {
    color: '#7a6e60',
    fontSize: 15,
    textAlign: 'center',
  },
};