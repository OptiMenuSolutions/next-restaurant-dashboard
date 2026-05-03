// pages/staff/[token].js
// Public page - no auth required. Opened via NFC tag tap.
// URL: /staff/[nfc_token]

import { createClient } from '@supabase/supabase-js';
import Head from 'next/head';

// Public Supabase client - only reads public data via token lookup
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const TYPE_CONFIG = {
  inventory: {
    label: 'Move Tonight',
    color: '#e8621a',
    bg: 'rgba(232, 98, 26, 0.12)',
    border: 'rgba(232, 98, 26, 0.3)',
    icon: '⚡',
  },
  margin: {
    label: 'High Margin',
    color: '#02a4ba',
    bg: 'rgba(2, 164, 186, 0.12)',
    border: 'rgba(2, 164, 186, 0.3)',
    icon: '★',
  },
  trending: {
    label: 'Trending',
    color: '#7c5cbf',
    bg: 'rgba(124, 92, 191, 0.12)',
    border: 'rgba(124, 92, 191, 0.3)',
    icon: '↑',
  },
};

export default function StaffPage({ restaurant, recommendations, error }) {
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
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  return (
    <>
      <Head>
        <title>Tonight's Dish — {restaurant.name}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
        <meta name="robots" content="noindex, nofollow" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600&family=Inter:wght@300;400;500&display=swap"
          rel="stylesheet"
        />
      </Head>

      <div style={styles.page}>
        {/* Header */}
        <div style={styles.header}>
          <div style={styles.logo}>OptiMenu</div>
          <div style={styles.restaurantName}>{restaurant.name}</div>
          <div style={styles.date}>{today}</div>
          <div style={styles.subtitle}>Tonight's Dish — Staff Briefing</div>
        </div>

        {/* Divider */}
        <div style={styles.divider} />

        {/* Recommendations */}
        <div style={styles.cards}>
          {recommendations.length === 0 ? (
            <div style={styles.emptyState}>
              <p style={styles.emptyText}>No recommendations available yet for today.</p>
              <p style={styles.emptySubtext}>Check back after the daily briefing is generated.</p>
            </div>
          ) : (
            recommendations.map((rec, i) => {
              const config = TYPE_CONFIG[rec.type] || TYPE_CONFIG.margin;
              return (
                <div key={i} style={{ ...styles.card, borderColor: config.border }}>
                  {/* Card header */}
                  <div style={styles.cardHeader}>
                    <div style={styles.priorityRow}>
                      <span style={styles.priority}>{i + 1}</span>
                      <span
                        style={{
                          ...styles.badge,
                          color: config.color,
                          background: config.bg,
                          borderColor: config.border,
                        }}
                      >
                        {config.icon} {config.label}
                      </span>
                    </div>
                    <h2 style={styles.dishTitle}>{rec.title}</h2>
                    <p style={styles.description}>{rec.description}</p>
                  </div>

                  {/* Talking point */}
                  <div style={{ ...styles.talkingPoint, borderLeftColor: config.color }}>
                    <div style={styles.tpLabel}>Say this to guests:</div>
                    <p style={styles.tpText}>"{rec.talking_point}"</p>
                  </div>

                  {/* Why selected */}
                  <div style={styles.reasonWrap}>
                    <div style={styles.reasonLabel}>Why tonight</div>
                    <p style={styles.reasonText}>{rec.reason_selected}</p>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div style={styles.footer}>
          <p style={styles.footerText}>Powered by OptiMenu · Staff use only</p>
        </div>
      </div>
    </>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────

const styles = {
  page: {
    background: '#0a0908',
    minHeight: '100vh',
    fontFamily: "'Inter', sans-serif",
    color: '#f0ece4',
    padding: '0 0 48px',
  },
  header: {
    padding: '40px 24px 24px',
    textAlign: 'center',
  },
  logo: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 13,
    letterSpacing: '0.18em',
    color: '#02a4ba',
    textTransform: 'uppercase',
    marginBottom: 16,
  },
  restaurantName: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 26,
    fontWeight: 600,
    color: '#f0ece4',
    marginBottom: 6,
    lineHeight: 1.2,
  },
  date: {
    fontSize: 13,
    color: '#7a7268',
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
    background: 'linear-gradient(90deg, transparent, #2a2520, transparent)',
    margin: '0 24px 28px',
  },
  cards: {
    padding: '0 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  card: {
    background: '#141210',
    border: '1px solid',
    borderRadius: 12,
    overflow: 'hidden',
  },
  cardHeader: {
    padding: '20px 20px 16px',
  },
  priorityRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  priority: {
    width: 26,
    height: 26,
    borderRadius: '50%',
    background: '#1e1b18',
    border: '1px solid #2a2520',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 12,
    fontWeight: 500,
    color: '#7a7268',
    flexShrink: 0,
    lineHeight: '26px',
    textAlign: 'center',
  },
  badge: {
    fontSize: 11,
    fontWeight: 500,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    padding: '3px 10px',
    borderRadius: 20,
    border: '1px solid',
  },
  dishTitle: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 22,
    fontWeight: 600,
    color: '#f0ece4',
    margin: '0 0 8px',
    lineHeight: 1.25,
  },
  description: {
    fontSize: 14,
    color: '#8a8278',
    lineHeight: 1.55,
    margin: 0,
    fontWeight: 300,
  },
  talkingPoint: {
    borderLeft: '3px solid',
    margin: '0 20px',
    padding: '14px 16px',
    background: 'rgba(255,255,255,0.03)',
    borderRadius: '0 8px 8px 0',
  },
  tpLabel: {
    fontSize: 10,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: '#5a5248',
    fontWeight: 500,
    marginBottom: 6,
  },
  tpText: {
    fontSize: 15,
    color: '#d4cfc8',
    lineHeight: 1.6,
    margin: 0,
    fontStyle: 'italic',
    fontFamily: "'Playfair Display', serif",
  },
  reasonWrap: {
    padding: '14px 20px 20px',
  },
  reasonLabel: {
    fontSize: 10,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: '#5a5248',
    fontWeight: 500,
    marginBottom: 6,
  },
  reasonText: {
    fontSize: 12,
    color: '#5a5248',
    lineHeight: 1.6,
    margin: 0,
    fontWeight: 300,
  },
  footer: {
    textAlign: 'center',
    padding: '32px 24px 0',
  },
  footerText: {
    fontSize: 11,
    color: '#3a3530',
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
    color: '#5a5248',
    fontSize: 15,
    textAlign: 'center',
  },
};

// ─── Data fetching ──────────────────────────────────────────────────────────

export async function getServerSideProps({ params }) {
  const { token } = params;

  // 1. Look up restaurant by NFC token
  const { data: restaurant, error: restError } = await supabase
    .from('restaurants')
    .select('id, name, nfc_token')
    .eq('nfc_token', token)
    .single();

  if (restError || !restaurant) {
    return { props: { error: true, restaurant: null, recommendations: [] } };
  }

  // 2. Fetch today's recommendations
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

  const { data: recRow, error: recError } = await supabase
    .from('ai_recommendations')
    .select('recommendations')
    .eq('restaurant_id', restaurant.id)
    .eq('generated_date', today)
    .eq('type', 'general')
    .single();

  const recommendations = recRow?.recommendations ?? [];

  return {
    props: {
      restaurant: { name: restaurant.name },
      recommendations,
      error: false,
    },
  };
}