// pages/staff/[token].js
import { createClient } from '@supabase/supabase-js';
import Head from 'next/head';
import { useState, useEffect } from 'react';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const TICKET_META = [
  { label: 'PUSH TONIGHT', color: '#02a4ba' },
  { label: 'RECOMMEND',    color: '#4caf50' },
  { label: 'MENTION',      color: '#f5a623' },
];

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
      <div style={styles.dashed} />
      <div style={styles.sayLabel}>SAY THIS:</div>
      <div style={styles.sayText}>"{rec.talking_point}"</div>
      <div style={styles.dashed} />
      <div style={styles.whyLabel}>WHY TONIGHT:</div>
      <div style={styles.whyText}>{rec.reason_selected}</div>
      <div style={styles.ticketFooter}>opti-menu.com</div>
    </div>
  );
}

export default function StaffPage({ restaurant, cachedRecommendations, restaurantId, error }) {
  const [recommendations, setRecommendations] = useState(cachedRecommendations || []);
  const [loading, setLoading] = useState(!cachedRecommendations?.length);

  useEffect(() => {
    if (cachedRecommendations?.length) return;
    async function generate() {
      try {
        const baseUrl = window.location.origin;
        const res = await fetch(`${baseUrl}/api/ai-recommendations`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ restaurantId }),
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

  if (error || !restaurant) {
    return (
      <>
        <Head>
          <title>OptiMenu</title>
          <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
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
        <title>Tonight's Dish — {restaurant.name}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
        <meta name="robots" content="noindex, nofollow" />
      </Head>

      <div style={styles.page}>
        <div style={styles.header}>
          <div style={styles.logo}>OptiMenu</div>
          <div style={styles.restaurantName}>{restaurant.name}</div>
          <div style={styles.date}>{today}</div>
          <div style={styles.subtitle}>Tonight's Dish — Staff Briefing</div>
        </div>

        <div style={styles.divider} />

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
  whyLabel: {
    fontSize: 9,
    letterSpacing: '1.2px',
    color: '#9a9080',
    marginBottom: 4,
  },
  whyText: {
    fontSize: 11,
    color: '#9a8878',
    lineHeight: 1.6,
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

export async function getServerSideProps({ params }) {
  const { token } = params;

  const { data: restaurant, error: restError } = await supabase
    .from('restaurants')
    .select('id, name, nfc_token')
    .eq('nfc_token', token)
    .single();

  if (restError || !restaurant) {
    return { props: { error: true, restaurant: null, cachedRecommendations: [], restaurantId: null } };
  }

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

  const { data: recRow } = await supabase
    .from('ai_recommendations')
    .select('recommendations')
    .eq('restaurant_id', restaurant.id)
    .eq('generated_date', today)
    .single();

  return {
    props: {
      restaurant: { name: restaurant.name },
      cachedRecommendations: recRow?.recommendations ?? [],
      restaurantId: restaurant.id,
      error: false,
    },
  };
}