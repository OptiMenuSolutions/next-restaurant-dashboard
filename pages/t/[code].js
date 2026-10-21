// pages/t/[code].js
// Where every NFC tag points: opti-menu.com/t/<code>. The code is random and
// means nothing on its own. It is looked up here on the server, the tap is
// logged, and the page gets only the restaurant name and tonight's tickets.
// The restaurant id and staff token never leave the server.
import { createClient } from '@supabase/supabase-js';
import StaffBriefing from '../../components/staff/StaffBriefing';

const CODE_RE = /^[a-z0-9]{12}$/;

export default function TagPage({ restaurantName, cachedRecommendations, code, askSpot, testTap }) {
  async function saveSpot(spot) {
    try {
      const res = await fetch('/api/t/spot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, spot }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  if (testTap) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f0ece4', fontFamily: "'Courier New', monospace", padding: 24, textAlign: 'center', color: '#1a1612' }}>
        <div>
          <div style={{ fontSize: 44, color: '#2f8a47' }}>✓</div>
          <div style={{ fontSize: 20, fontWeight: 700, marginTop: 8 }}>{testTap.label} works</div>
          <div style={{ fontSize: 14, color: '#7a6e60', marginTop: 6 }}>Written for {testTap.restaurantName}. It goes live when the kit is delivered.</div>
        </div>
      </div>
    );
  }

  return (
    <StaffBriefing
      restaurantName={restaurantName}
      cachedRecommendations={cachedRecommendations}
      requestBody={{ tagCode: code }}
      askSpot={askSpot}
      onSaveSpot={saveSpot}
    />
  );
}

// Only what the ticket shows. The operator notes (reason_selected, type)
// stay on the server.
const forStaff = (r) => ({
  title: r?.title ?? null,
  description: r?.description ?? null,
  talking_point: r?.talking_point ?? null,
});

export async function getServerSideProps({ params, res }) {
  res.setHeader('Cache-Control', 'no-store');
  const dead = { props: { restaurantName: null, cachedRecommendations: [], code: null, askSpot: false, testTap: null } };

  const code = String(params.code || '').toLowerCase();
  if (!CODE_RE.test(code)) return dead;

  // Service role, created inside getServerSideProps so the key stays on the
  // server. Tags and taps have RLS on with no policies, so nothing else can
  // read them.
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const { data: tags } = await supabase
    .from('nfc_tags')
    .select('id, restaurant_id, label, status, spot, tap_count, first_tap_at, confirmed_at, restaurants(name)')
    .eq('code', code)
    .in('status', ['active', 'pending'])
    .limit(1);
  const tag = tags?.[0];
  if (!tag || !tag.restaurants?.name) return dead;

  // A tag you just wrote, before it is delivered: this tap is your test.
  // Confirm it and stop. No tap is logged and nobody is asked for a spot.
  if (tag.status === 'pending') {
    if (!tag.confirmed_at) await supabase.from('nfc_tags').update({ confirmed_at: new Date().toISOString() }).eq('id', tag.id);
    return { props: { ...dead.props, testTap: { label: tag.label, restaurantName: tag.restaurants.name } } };
  }

  // Log the tap. A failed log never blocks the page.
  const now = new Date().toISOString();
  try {
    await Promise.all([
      supabase.from('nfc_tag_taps').insert({ tag_id: tag.id, restaurant_id: tag.restaurant_id }),
      supabase
        .from('nfc_tags')
        .update({ tap_count: (tag.tap_count || 0) + 1, last_tap_at: now, first_tap_at: tag.first_tap_at || now })
        .eq('id', tag.id),
    ]);
  } catch (e) {
    console.error('[t] tap log failed:', e.message);
  }

  // Same date logic as /api/ai-recommendations.
  const estDate = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const today = estDate.toISOString().split('T')[0];

  const { data: cachedRows } = await supabase
    .from('ai_recommendations')
    .select('recommendations')
    .eq('restaurant_id', tag.restaurant_id)
    .eq('generated_date', today)
    .limit(1);

  return {
    props: {
      restaurantName: tag.restaurants.name,
      cachedRecommendations: (cachedRows?.[0]?.recommendations || []).slice(0, 3).map(forStaff),
      code,
      askSpot: !tag.spot,
    },
  };
}