// pages/admin/restaurants/[id].js
// Drill-down detail page for a single restaurant.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import AdminLayout from '../../../components/admin/AdminLayout';
import { useAdminFetch } from '../../../lib/admin/useAdminFetch';

function timeAgo(dateStr) {
  if (!dateStr) return '—';
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function statusPill(status) {
  const map = {
    active:     { bg: 'rgba(61,232,160,0.1)',  border: 'rgba(61,232,160,0.25)',  text: '#3de8a0' },
    trialing:   { bg: 'rgba(2,164,186,0.1)',   border: 'rgba(2,164,186,0.25)',  text: '#02a4ba' },
    past_due:   { bg: 'rgba(245,166,35,0.1)',  border: 'rgba(245,166,35,0.25)', text: '#f5a623' },
    canceled:   { bg: 'rgba(232,84,84,0.1)',   border: 'rgba(232,84,84,0.25)',  text: '#e85454' },
    completed:  { bg: 'rgba(61,232,160,0.1)',  border: 'rgba(61,232,160,0.25)',  text: '#3de8a0' },
    failed:     { bg: 'rgba(232,84,84,0.1)',   border: 'rgba(232,84,84,0.25)',  text: '#e85454' },
    pending:    { bg: 'rgba(245,166,35,0.1)',  border: 'rgba(245,166,35,0.25)', text: '#f5a623' },
    unknown:    { bg: 'rgba(255,255,255,0.04)', border: '#1e2028',              text: '#5a6080' },
  };
  const c = map[status] || map.unknown;
  return (
    <span style={{ fontSize: 8, fontWeight: 700, padding: '2px 7px', borderRadius: 20,
      textTransform: 'capitalize', letterSpacing: '0.3px',
      background: c.bg, border: `1px solid ${c.border}`, color: c.text }}>
      {(status || 'unknown').replace('_', ' ')}
    </span>
  );
}

function SectionCard({ title, children }) {
  return (
    <div style={s.card}>
      <div style={s.cardTitle}>{title}</div>
      {children}
    </div>
  );
}

function StatBox({ label, value, mono, accent }) {
  return (
    <div style={s.statBox}>
      <div style={s.statLabel}>{label}</div>
      <div style={{ ...s.statValue, fontFamily: mono ? "'DM Mono', monospace" : undefined, color: accent || '#e4e6f0' }}>{value ?? '—'}</div>
    </div>
  );
}

export default function RestaurantDetailPage() {
  const router = useRouter();
  const { id } = router.query;
  const { adminFetch } = useAdminFetch();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    async function load() {
      try {
        const res = await adminFetch(`/api/admin/restaurants/${id}`);
        const json = await res.json();
        setData(json);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id, adminFetch]);

  if (loading) return (
    <AdminLayout title="Restaurant">
      <div style={s.center}><div style={s.spinner} /><span style={{ color: '#3a3e50', fontSize: 12 }}>Loading…</span></div>
    </AdminLayout>
  );

  if (!data?.restaurant) return (
    <AdminLayout title="Restaurant">
      <div style={s.center}><span style={{ color: '#e85454', fontSize: 12 }}>Restaurant not found</span></div>
    </AdminLayout>
  );

  const { restaurant, invoices, menuItems, ingredients, posSales, aiSpend } = data;

  return (
    <AdminLayout title={restaurant.name}>
      <div style={s.page}>

        {/* ── Back + Header ── */}
        <div>
          <button onClick={() => router.push('/admin/restaurants')} style={s.backBtn}>← All Restaurants</button>
          <div style={s.header}>
            <div>
              <h1 style={s.title}>{restaurant.name}</h1>
              <p style={s.subtitle}>
                {restaurant.owner_name && <span>{restaurant.owner_name} · </span>}
                <span style={{ color: '#5a6080' }}>{restaurant.owner_email || 'No email'}</span>
                <span style={{ color: '#3a3e50' }}> · Joined {timeAgo(restaurant.created_at)}</span>
              </p>
            </div>
            {statusPill(restaurant.subscription_status)}
          </div>
        </div>

        {/* ── Stat Row ── */}
        <div style={s.statRow}>
          <StatBox label="Invoice Count" value={invoices.length} mono />
          <StatBox label="Menu Items" value={menuItems.length} mono />
          <StatBox label="Ingredients" value={ingredients.length} mono />
          <StatBox label="AI Spend (all time)" value={`$${aiSpend.total.toFixed(2)}`} mono accent="#02a4ba" />
          <StatBox label="POS Sales Rows" value={posSales.length} mono />
        </div>

        {/* ── AI Spend Breakdown ── */}
        <SectionCard title="AI Spend Breakdown">
          <div style={{ display: 'flex', gap: 20 }}>
            {[
              { label: 'Invoice Parse', key: 'invoice_parse' },
              { label: 'Menu Import',   key: 'menu_import' },
              { label: 'Dish Recs',     key: 'dish_recs' },
            ].map(f => (
              <div key={f.key}>
                <div style={{ fontSize: 9, color: '#3a3e50', marginBottom: 2 }}>{f.label}</div>
                <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 13, color: '#02a4ba' }}>
                  ${(aiSpend.by_feature[f.key] || 0).toFixed(4)}
                </div>
              </div>
            ))}
          </div>
        </SectionCard>

        {/* ── Row 2: Invoices + Menu Items ── */}
        <div style={s.row2}>
          <SectionCard title="Recent Invoices">
            {invoices.length === 0
              ? <p style={s.empty}>No invoices yet</p>
              : invoices.map(inv => (
                <div key={inv.id} style={s.listRow}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, color: '#e4e6f0', fontWeight: 600 }}>{inv.supplier || 'Unknown supplier'}</div>
                    <div style={{ fontSize: 9, color: '#5a6080' }}>#{inv.number || 'N/A'} · {inv.date || timeAgo(inv.created_at)}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {inv.amount && <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: '#7880a0' }}>${parseFloat(inv.amount).toFixed(2)}</span>}
                    {statusPill(inv.parse_status)}
                  </div>
                </div>
              ))
            }
          </SectionCard>

          <SectionCard title="Recent Menu Items">
            {menuItems.length === 0
              ? <p style={s.empty}>No menu items yet</p>
              : menuItems.map(item => (
                <div key={item.id} style={s.listRow}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, color: '#e4e6f0', fontWeight: 600 }}>{item.name}</div>
                    <div style={{ fontSize: 9, color: '#5a6080' }}>{item.category || 'Uncategorized'}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 12 }}>
                    {item.price && <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: '#3de8a0' }}>${parseFloat(item.price).toFixed(2)}</span>}
                    {item.cost  && <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: '#5a6080' }}>cost ${parseFloat(item.cost).toFixed(2)}</span>}
                  </div>
                </div>
              ))
            }
          </SectionCard>
        </div>

        {/* ── Row 3: Ingredients + POS ── */}
        <div style={s.row2}>
          <SectionCard title="Recent Ingredients">
            {ingredients.length === 0
              ? <p style={s.empty}>No ingredients yet</p>
              : ingredients.map(ing => (
                <div key={ing.id} style={s.listRow}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, color: '#e4e6f0', fontWeight: 600 }}>{ing.name}</div>
                    <div style={{ fontSize: 9, color: '#5a6080' }}>Last ordered {timeAgo(ing.last_ordered_at)}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {ing.last_price && <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: '#7880a0' }}>${parseFloat(ing.last_price).toFixed(2)}/{ing.unit}</span>}
                    {ing.is_estimated && <span style={{ fontSize: 8, color: '#f5a623', border: '1px solid rgba(245,166,35,0.3)', borderRadius: 10, padding: '1px 5px' }}>est</span>}
                  </div>
                </div>
              ))
            }
          </SectionCard>

          <SectionCard title="Recent POS Sales">
            {posSales.length === 0
              ? <p style={s.empty}>No POS data yet</p>
              : posSales.map((sale, i) => (
                <div key={i} style={s.listRow}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, color: '#e4e6f0', fontWeight: 600 }}>{sale.item_name}</div>
                    <div style={{ fontSize: 9, color: '#5a6080' }}>{sale.sale_date}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 12 }}>
                    <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: '#7880a0' }}>{sale.quantity_sold} sold</span>
                    <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: '#3de8a0' }}>${parseFloat(sale.revenue || 0).toFixed(2)}</span>
                  </div>
                </div>
              ))
            }
          </SectionCard>
        </div>

      </div>
    </AdminLayout>
  );
}

const s = {
  page: { padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16, fontFamily: "'Inter', sans-serif" },
  center: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 60 },
  spinner: { width: 16, height: 16, border: '2px solid #1e2028', borderTopColor: '#02a4ba', borderRadius: '50%', animation: 'spin 0.8s linear infinite' },
  backBtn: { background: 'none', border: 'none', color: '#5a6080', fontSize: 11, cursor: 'pointer', fontFamily: "'Inter', sans-serif", padding: '0 0 10px', display: 'block' },
  header: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' },
  title: { fontSize: 22, fontWeight: 700, color: '#e4e6f0', letterSpacing: '-0.5px', fontFamily: "'Playfair Display', serif", margin: 0 },
  subtitle: { fontSize: 10, color: '#7880a0', marginTop: 4 },
  statRow: { display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 },
  statBox: { background: '#111318', border: '1px solid #1e2028', borderRadius: 8, padding: '12px 14px' },
  statLabel: { fontSize: 8, fontWeight: 700, color: '#3a3e50', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 5 },
  statValue: { fontSize: 20, fontWeight: 600, lineHeight: 1 },
  card: { background: '#111318', border: '1px solid #1e2028', borderRadius: 8, padding: 14 },
  cardTitle: { fontSize: 9, fontWeight: 700, color: '#5a6080', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 12 },
  row2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 },
  listRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 8, marginBottom: 8, borderBottom: '1px solid #1a1c23' },
  empty: { fontSize: 11, color: '#3a3e50', margin: 0 },
};