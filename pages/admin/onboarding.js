// pages/admin/onboarding.js
// Onboarding progress tracker for all restaurants.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import AdminLayout from '../../components/admin/AdminLayout';
import { useAdminFetch } from '../../lib/admin/useAdminFetch';
import { usePagination, Pagination, FilterButton } from '../../lib/admin/usePagination';

const PAGE_SIZE = 12;

function timeAgo(dateStr) {
  if (!dateStr) return '—';
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function StatusChip({ status }) {
  const map = {
    complete:    { bg: 'rgba(61,232,160,0.1)',  border: 'rgba(61,232,160,0.25)',  text: '#3de8a0',  label: 'Complete' },
    in_progress: { bg: 'rgba(2,164,186,0.1)',   border: 'rgba(2,164,186,0.25)',  text: '#02a4ba',  label: 'In Progress' },
    stuck:       { bg: 'rgba(232,84,84,0.1)',   border: 'rgba(232,84,84,0.25)',  text: '#e85454',  label: 'Stuck' },
  };
  const c = map[status] || map.in_progress;
  return (
    <span style={{ fontSize: 8, fontWeight: 700, padding: '2px 7px', borderRadius: 20,
      textTransform: 'uppercase', letterSpacing: '0.5px',
      background: c.bg, border: `1px solid ${c.border}`, color: c.text }}>
      {c.label}
    </span>
  );
}

function ProgressBar({ pct, status }) {
  const color = status === 'complete' ? '#3de8a0' : status === 'stuck' ? '#e85454' : '#02a4ba';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, background: '#1a1c23', borderRadius: 3, height: 5 }}>
        <div style={{ width: `${pct}%`, height: 5, borderRadius: 3, background: color, transition: 'width 0.6s' }} />
      </div>
      <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color, width: 28, textAlign: 'right' }}>{pct}%</span>
    </div>
  );
}

function StepDots({ steps }) {
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
      {steps.map(step => (
        <div key={step.key} title={step.label} style={{
          width: 8, height: 8, borderRadius: '50%',
          background: step.done ? '#3de8a0' : '#1e2028',
          border: step.done ? 'none' : '1px solid #2a2e3a',
          flexShrink: 0,
        }} />
      ))}
    </div>
  );
}

export default function OnboardingPage() {
  const { adminFetch } = useAdminFetch();
  const router = useRouter();
  const [restaurants, setRestaurants] = useState([]);
  const [stats, setStats]             = useState({});
  const [loading, setLoading]         = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch]           = useState('');

  useEffect(() => {
    async function load() {
      try {
        const res  = await adminFetch('/api/admin/onboarding');
        const json = await res.json();
        setRestaurants(json.restaurants || []);
        setStats(json.stats || {});
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [adminFetch]);

  const filtered = restaurants.filter(r => {
    const q = search.toLowerCase();
    if (q && !r.name.toLowerCase().includes(q) && !(r.owner_email || '').toLowerCase().includes(q)) return false;
    if (statusFilter !== 'all' && r.status !== statusFilter) return false;
    return true;
  });

  const { page, setPage, pageItems, totalPages, reset } = usePagination(filtered, PAGE_SIZE);

  function handleFilter(val) { setStatusFilter(val); reset(); }
  function handleSearch(val) { setSearch(val); reset(); }

  return (
    <AdminLayout title="Onboarding">
      <div style={s.page}>

        {/* ── Header ── */}
        <div>
          <h1 style={s.title}>Onboarding</h1>
          <p style={s.subtitle}>Track setup progress across all restaurants</p>
        </div>

        {/* ── Stat Cards ── */}
        <div style={s.statGrid}>
          {[
            { label: 'Total Restaurants', value: stats.total || 0, color: '#e4e6f0' },
            { label: 'Fully Onboarded',   value: stats.complete || 0, color: '#3de8a0' },
            { label: 'In Progress',        value: stats.in_progress || 0, color: '#02a4ba' },
            { label: 'Stuck',              value: stats.stuck || 0, color: '#e85454' },
            { label: 'Avg Progress',       value: `${stats.avg_progress || 0}%`, color: '#f5a623' },
          ].map(stat => (
            <div key={stat.label} style={s.statCard}>
              <div style={s.statLabel}>{stat.label}</div>
              <div style={{ ...s.statValue, color: stat.color }}>{stat.value}</div>
            </div>
          ))}
        </div>

        {/* ── Filters ── */}
        <div style={s.filterRow}>
          <input
            style={s.search}
            placeholder="Search by name or email…"
            value={search}
            onChange={e => handleSearch(e.target.value)}
          />
          {/* FilterButton fixes the focus-ring border bug */}
          <div style={s.filterGroup}>
            {[
              { label: 'All',         value: 'all' },
              { label: 'Stuck',       value: 'stuck' },
              { label: 'In Progress', value: 'in_progress' },
              { label: 'Complete',    value: 'complete' },
            ].map(f => (
              <FilterButton key={f.value} active={statusFilter === f.value} onClick={() => handleFilter(f.value)}>
                {f.label}
              </FilterButton>
            ))}
          </div>
        </div>

        {/* ── Table ── */}
        {loading ? (
          <div style={s.center}><div style={s.spinner} /><span style={{ color: '#3a3e50', fontSize: 12 }}>Loading…</span></div>
        ) : (
          <div style={s.tableWrap}>
            <table style={s.table}>
              <thead>
                <tr>
                  {['Restaurant', 'Owner', 'Progress', 'Steps', 'Status', 'Invoices', 'Menu Items', 'Joined', ''].map(h => (
                    <th key={h} style={s.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageItems.length === 0 ? (
                  <tr><td colSpan={9} style={{ ...s.td, textAlign: 'center', color: '#3a3e50', padding: 32 }}>No restaurants found</td></tr>
                ) : pageItems.map(r => (
                  <tr
                    key={r.id}
                    style={{ ...s.row, background: r.is_stuck ? 'rgba(232,84,84,0.03)' : 'transparent' }}
                    onClick={() => router.push(`/admin/restaurants/${r.id}`)}
                  >
                    <td style={s.td}>
                      <div style={{ fontWeight: 600, color: '#e4e6f0', fontSize: 12 }}>{r.name}</div>
                      {r.is_stuck && <div style={{ fontSize: 9, color: '#e85454', marginTop: 2 }}>⚠ stuck for {r.days_since_join}d</div>}
                    </td>
                    <td style={s.td}>
                      <div style={{ fontSize: 11, color: '#7880a0' }}>{r.owner_name || '—'}</div>
                      <div style={{ fontSize: 9, color: '#3a3e50' }}>{r.owner_email || '—'}</div>
                    </td>
                    <td style={{ ...s.td, minWidth: 120 }}>
                      <ProgressBar pct={r.progress_pct} status={r.status} />
                    </td>
                    <td style={s.td}>
                      <StepDots steps={r.steps} />
                      <div style={{ fontSize: 8, color: '#3a3e50', marginTop: 3 }}>{r.completed_steps}/{r.steps.length} steps</div>
                    </td>
                    <td style={s.td}><StatusChip status={r.status} /></td>
                    <td style={{ ...s.td, fontFamily: "'DM Mono', monospace", fontSize: 11, color: '#7880a0' }}>{r.invoice_count}</td>
                    <td style={{ ...s.td, fontFamily: "'DM Mono', monospace", fontSize: 11, color: '#7880a0' }}>{r.menu_count}</td>
                    <td style={{ ...s.td, fontSize: 10, color: '#5a6080' }}>{timeAgo(r.created_at)}</td>
                    <td style={s.td}><span style={{ fontSize: 10, color: '#02a4ba' }}>View →</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={page} totalPages={totalPages} setPage={setPage} total={filtered.length} pageSize={PAGE_SIZE} />
          </div>
        )}

        {/* ── Step Legend ── */}
        <div style={s.legend}>
          <span style={{ fontSize: 9, color: '#3a3e50', marginRight: 12 }}>Steps:</span>
          {[
            { key: 'account',     label: 'Account created' },
            { key: 'menu',        label: 'Menu imported' },
            { key: 'invoice',     label: 'Invoice parsed' },
            { key: 'ingredients', label: 'Ingredients populated' },
            { key: 'pos',         label: 'POS uploaded' },
          ].map((step, i) => (
            <div key={step.key} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#3de8a0' }} />
              <span style={{ fontSize: 9, color: '#5a6080' }}>{i + 1}. {step.label}</span>
            </div>
          ))}
        </div>

      </div>
    </AdminLayout>
  );
}

const s = {
  page: { padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16, fontFamily: "'Inter', sans-serif" },
  title: { fontSize: 22, fontWeight: 700, color: '#e4e6f0', letterSpacing: '-0.5px', fontFamily: "'Playfair Display', serif", margin: 0 },
  subtitle: { fontSize: 10, color: '#3a3e50', marginTop: 3 },
  statGrid: { display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 },
  statCard: { background: '#111318', border: '1px solid #1e2028', borderRadius: 8, padding: '12px 14px' },
  statLabel: { fontSize: 8, fontWeight: 700, color: '#3a3e50', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 5 },
  statValue: { fontSize: 22, fontWeight: 600, lineHeight: 1, fontFamily: "'DM Mono', monospace" },
  filterRow: { display: 'flex', alignItems: 'center', gap: 8 },
  search: { flex: 1, minWidth: 200, padding: '7px 12px', fontSize: 11, background: '#111318', border: '1px solid #1e2028', borderRadius: 6, color: '#e4e6f0', fontFamily: "'Inter', sans-serif", outline: 'none' },
  filterGroup: { display: 'flex', gap: 4 },
  tableWrap: { background: '#111318', border: '1px solid #1e2028', borderRadius: 8, overflow: 'hidden' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { fontSize: 9, fontWeight: 700, color: '#3a3e50', textTransform: 'uppercase', letterSpacing: '0.8px', padding: '10px 14px', textAlign: 'left', borderBottom: '1px solid #1e2028', background: '#0f1115' },
  td: { padding: '11px 14px', borderBottom: '1px solid #0f1115', verticalAlign: 'middle' },
  row: { cursor: 'pointer', transition: 'background 0.1s' },
  center: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 60 },
  spinner: { width: 16, height: 16, border: '2px solid #1e2028', borderTopColor: '#02a4ba', borderRadius: '50%', animation: 'spin 0.8s linear infinite' },
  legend: { display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0' },
};