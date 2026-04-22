// pages/admin/view-as.js
// Browse any restaurant's data as if you're looking at their client-side pages.
// Stays logged in as admin — renders their data in a read-only client view.

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import AdminLayout from '../../components/admin/AdminLayout';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const VIEWS = [
  { id: 'overview',     label: 'Overview' },
  { id: 'invoices',     label: 'Invoices' },
  { id: 'ingredients',  label: 'Ingredients' },
  { id: 'menu',         label: 'Menu Items' },
];

function StatPill({ label, value, color = '#02a4ba' }) {
  return (
    <div style={{ background: '#0d0f14', border: '1px solid #1e2028', borderRadius: 8, padding: '12px 16px', minWidth: 100 }}>
      <div style={{ fontSize: 20, fontWeight: 700, color, fontFamily: "'Playfair Display', serif" }}>{value}</div>
      <div style={{ fontSize: 9, color: '#4a5068', textTransform: 'uppercase', letterSpacing: '0.7px', marginTop: 3 }}>{label}</div>
    </div>
  );
}

// ── Overview Panel ────────────────────────────────────────────────────────────
function OverviewView({ restaurant, invoices, ingredients, menuItems }) {
  const totalSpend = invoices.reduce((s, i) => s + parseFloat(i.amount || 0), 0);
  const failedInvoices = invoices.filter(i => i.parse_status === 'failed');
  const unpricedIngredients = ingredients.filter(i => !i.last_price || i.last_price === 0);
  const lowMarginItems = menuItems.filter(i => i.food_cost_pct > (restaurant.target_food_cost || 30));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Stats */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <StatPill label="Invoices" value={invoices.length} />
        <StatPill label="Total Spend" value={`$${totalSpend.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} />
        <StatPill label="Ingredients" value={ingredients.length} />
        <StatPill label="Menu Items" value={menuItems.length} />
        <StatPill label="Failed Parses" value={failedInvoices.length} color={failedInvoices.length > 0 ? '#e85454' : '#02a4ba'} />
        <StatPill label="Unpriced Ingredients" value={unpricedIngredients.length} color={unpricedIngredients.length > 0 ? '#f5a623' : '#02a4ba'} />
        <StatPill label="Low Margin Items" value={lowMarginItems.length} color={lowMarginItems.length > 0 ? '#e85454' : '#02a4ba'} />
      </div>

      {/* Recent invoices */}
      <div style={vs.card}>
        <div style={vs.cardTitle}>Recent Invoices</div>
        {invoices.slice(0, 8).map((inv) => (
          <div key={inv.id} style={vs.row}>
            <div style={{ flex: 2, minWidth: 0 }}>
              <div style={vs.rowMain}>{inv.supplier || 'Unknown Supplier'}</div>
              <div style={vs.rowSub}>{inv.number || '—'} · {inv.date || '—'}</div>
            </div>
            <div style={{ fontSize: 12, color: '#9aa0b8' }}>${parseFloat(inv.amount || 0).toFixed(2)}</div>
            <div style={{ marginLeft: 12 }}>
              <span style={{
                fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 20,
                background: inv.parse_status === 'completed' ? 'rgba(2,164,186,0.1)' : inv.parse_status === 'failed' ? 'rgba(232,84,84,0.1)' : 'rgba(90,96,128,0.1)',
                color: inv.parse_status === 'completed' ? '#02a4ba' : inv.parse_status === 'failed' ? '#e85454' : '#5a6080',
                border: `1px solid ${inv.parse_status === 'completed' ? 'rgba(2,164,186,0.25)' : inv.parse_status === 'failed' ? 'rgba(232,84,84,0.25)' : '#1e2028'}`,
              }}>
                {inv.parse_status || 'pending'}
              </span>
            </div>
          </div>
        ))}
        {invoices.length === 0 && <div style={vs.empty}>No invoices uploaded yet</div>}
      </div>

      {/* Failed invoices alert */}
      {failedInvoices.length > 0 && (
        <div style={{ background: 'rgba(232,84,84,0.07)', border: '1px solid rgba(232,84,84,0.2)', borderRadius: 8, padding: '14px 16px' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#e85454', marginBottom: 8 }}>
            ⚠ {failedInvoices.length} Failed Invoice Parse{failedInvoices.length > 1 ? 's' : ''}
          </div>
          {failedInvoices.map((inv) => (
            <div key={inv.id} style={{ fontSize: 11, color: '#9aa0b8', marginBottom: 4 }}>
              {inv.supplier || 'Unknown'} · {inv.date || '—'} · ID: {inv.id.slice(0, 8)}…
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Invoices Panel ────────────────────────────────────────────────────────────
function InvoicesView({ invoices, restaurantId, onReparse }) {
  const [reparsing, setReparsing] = useState(null);

  async function handleReparse(invoiceId) {
    setReparsing(invoiceId);
    await onReparse(invoiceId);
    setReparsing(null);
  }

  return (
    <div style={vs.card}>
      <div style={vs.cardTitle}>All Invoices ({invoices.length})</div>
      {invoices.length === 0 && <div style={vs.empty}>No invoices</div>}
      {invoices.map((inv) => (
        <div key={inv.id} style={vs.row}>
          <div style={{ flex: 2, minWidth: 0 }}>
            <div style={vs.rowMain}>{inv.supplier || 'Unknown Supplier'}</div>
            <div style={vs.rowSub}>{inv.number || '—'} · {inv.date || '—'} · ${parseFloat(inv.amount || 0).toFixed(2)}</div>
          </div>
          <span style={{
            fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 20, marginRight: 10,
            background: inv.parse_status === 'completed' ? 'rgba(2,164,186,0.1)' : inv.parse_status === 'failed' ? 'rgba(232,84,84,0.1)' : 'rgba(90,96,128,0.1)',
            color: inv.parse_status === 'completed' ? '#02a4ba' : inv.parse_status === 'failed' ? '#e85454' : '#5a6080',
            border: `1px solid ${inv.parse_status === 'completed' ? 'rgba(2,164,186,0.25)' : inv.parse_status === 'failed' ? 'rgba(232,84,84,0.25)' : '#1e2028'}`,
          }}>
            {inv.parse_status || 'pending'}
          </span>
          {(inv.parse_status === 'failed' || inv.parse_status === 'completed') && (
            <button
              onClick={() => handleReparse(inv.id)}
              disabled={reparsing === inv.id}
              style={{ background: 'none', border: '1px solid #1e2028', borderRadius: 6, padding: '3px 10px', fontSize: 10, color: reparsing === inv.id ? '#3a3e50' : '#02a4ba', cursor: reparsing === inv.id ? 'not-allowed' : 'pointer', fontFamily: "'Inter', sans-serif" }}
            >
              {reparsing === inv.id ? 'Parsing...' : '↺ Re-parse'}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Ingredients Panel ─────────────────────────────────────────────────────────
function IngredientsView({ ingredients }) {
  return (
    <div style={vs.card}>
      <div style={vs.cardTitle}>Ingredients ({ingredients.length})</div>
      {ingredients.length === 0 && <div style={vs.empty}>No ingredients</div>}
      {ingredients.map((ing) => (
        <div key={ing.id} style={vs.row}>
          <div style={{ flex: 2, minWidth: 0 }}>
            <div style={vs.rowMain}>{ing.name}</div>
            <div style={vs.rowSub}>{ing.unit} · {ing.category || 'Uncategorized'}</div>
          </div>
          <div style={{ fontSize: 12, color: ing.last_price ? '#9aa0b8' : '#3a3e50' }}>
            {ing.last_price ? `$${parseFloat(ing.last_price).toFixed(2)}` : 'Unpriced'}
          </div>
          {ing.is_estimated && (
            <span style={{ marginLeft: 8, fontSize: 9, color: '#f5a623', border: '1px solid rgba(245,166,35,0.3)', borderRadius: 10, padding: '1px 6px' }}>est.</span>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Menu Items Panel ──────────────────────────────────────────────────────────
function MenuView({ menuItems, targetFoodCost }) {
  return (
    <div style={vs.card}>
      <div style={vs.cardTitle}>Menu Items ({menuItems.length})</div>
      {menuItems.length === 0 && <div style={vs.empty}>No menu items</div>}
      {menuItems.map((item) => {
        const isLow = item.food_cost_pct > (targetFoodCost || 30);
        return (
          <div key={item.id} style={vs.row}>
            <div style={{ flex: 2, minWidth: 0 }}>
              <div style={vs.rowMain}>{item.name}</div>
              <div style={vs.rowSub}>{item.category || 'Uncategorized'} · ${parseFloat(item.price || 0).toFixed(2)}</div>
            </div>
            <div style={{ fontSize: 12, color: isLow ? '#e85454' : '#02a4ba' }}>
              {item.food_cost_pct != null ? `${parseFloat(item.food_cost_pct).toFixed(1)}%` : '—'}
            </div>
            {isLow && (
              <span style={{ marginLeft: 8, fontSize: 9, fontWeight: 700, color: '#e85454', border: '1px solid rgba(232,84,84,0.3)', borderRadius: 10, padding: '1px 6px' }}>LOW</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function ViewAsPage() {
  const router = useRouter();
  const [restaurants, setRestaurants] = useState([]);
  const [selected, setSelected] = useState(null);
  const [view, setView] = useState('overview');
  const [loading, setLoading] = useState(true);
  const [dataLoading, setDataLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [toast, setToast] = useState(null);

  // Restaurant data
  const [invoices, setInvoices] = useState([]);
  const [ingredients, setIngredients] = useState([]);
  const [menuItems, setMenuItems] = useState([]);

  useEffect(() => { fetchRestaurants(); }, []);

  async function fetchRestaurants() {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/restaurants?action=list');
      const data = await res.json();
      setRestaurants(data.restaurants || []);
    } catch {
      const { data } = await supabaseAdmin
        .from('restaurants')
        .select('id, name, owner_email, target_food_cost, created_at')
        .order('created_at', { ascending: false });
      setRestaurants(data || []);
    }
    setLoading(false);
  }

  async function fetchRestaurantData(restaurantId) {
    setDataLoading(true);
    const [inv, ing, menu] = await Promise.all([
      supabaseAdmin.from('invoices').select('*').eq('restaurant_id', restaurantId).order('created_at', { ascending: false }),
      supabaseAdmin.from('ingredients').select('*').eq('restaurant_id', restaurantId).order('name'),
      supabaseAdmin.from('menu_items').select('*').eq('restaurant_id', restaurantId).order('name'),
    ]);
    setInvoices(inv.data || []);
    setIngredients(ing.data || []);
    setMenuItems(menu.data || []);
    setDataLoading(false);
  }

  function selectRestaurant(r) {
    setSelected(r);
    setView('overview');
    fetchRestaurantData(r.id);
  }

  function showToast(text, type = 'success') {
    setToast({ text, type });
    setTimeout(() => setToast(null), 4000);
  }

  async function handleReparse(invoiceId) {
    try {
      const res = await fetch('/api/admin/reparse-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showToast('Invoice re-parsed successfully');
      // Refresh invoice list
      if (selected) fetchRestaurantData(selected.id);
    } catch (err) {
      showToast(err.message || 'Re-parse failed', 'error');
    }
  }

  const filtered = restaurants.filter((r) => {
    const q = search.toLowerCase();
    return r.name?.toLowerCase().includes(q) || r.owner_email?.toLowerCase().includes(q);
  });

  return (
    <AdminLayout title="View As">
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 200,
          background: toast.type === 'success' ? 'rgba(2,164,186,0.15)' : 'rgba(232,84,84,0.15)',
          border: `1px solid ${toast.type === 'success' ? 'rgba(2,164,186,0.3)' : 'rgba(232,84,84,0.3)'}`,
          color: toast.type === 'success' ? '#02a4ba' : '#e85454',
          borderRadius: 8, padding: '10px 16px', fontSize: 12, fontWeight: 500,
        }}>
          {toast.type === 'success' ? '✓ ' : '✕ '}{toast.text}
        </div>
      )}

      <div style={s.page}>
        {/* Header */}
        <div style={s.header}>
          <div>
            <div style={s.title}>View As Customer</div>
            <div style={s.sub}>Browse any restaurant's data — you stay logged in as admin</div>
          </div>
        </div>

        <div style={s.grid}>
          {/* Left: restaurant list */}
          <div style={s.panel}>
            <div style={s.panelHead}>
              <div style={s.panelLabel}>Restaurants</div>
              <input
                style={s.searchInput}
                placeholder="Search..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div style={{ overflowY: 'auto', maxHeight: 'calc(100vh - 200px)' }}>
              {loading ? (
                <div style={s.empty}>Loading...</div>
              ) : filtered.map((r) => {
                const active = selected?.id === r.id;
                return (
                  <button
                    key={r.id}
                    onClick={() => selectRestaurant(r)}
                    style={{ ...s.restRow, ...(active ? s.restRowActive : {}) }}
                    onMouseEnter={e => { if (!active) e.currentTarget.style.background = '#1a1d24'; }}
                    onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
                  >
                    <div style={{ ...s.restAvatar, background: active ? 'rgba(2,164,186,0.15)' : '#1e2028', color: active ? '#02a4ba' : '#5a6080' }}>
                      {(r.name || 'R').charAt(0).toUpperCase()}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: active ? '#e4e6f0' : '#9aa0b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</div>
                      <div style={{ fontSize: 10, color: '#3a3e50', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.owner_email || '—'}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right: data view */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0, minWidth: 0 }}>
            {!selected ? (
              <div style={{ ...s.panel, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 300 }}>
                <div style={{ fontSize: 13, color: '#3a3e50', textAlign: 'center' }}>
                  <div style={{ fontSize: 24, marginBottom: 10 }}>👈</div>
                  Select a restaurant to view their data
                </div>
              </div>
            ) : (
              <>
                {/* Restaurant header banner */}
                <div style={s.viewBanner}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={s.bannerAvatar}>{selected.name.charAt(0).toUpperCase()}</div>
                    <div>
                      <div style={s.bannerName}>{selected.name}</div>
                      <div style={s.bannerEmail}>{selected.owner_email || '—'} · Target food cost: {selected.target_food_cost || 30}%</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => router.push(`/admin/messaging?prefill=${encodeURIComponent(selected.owner_email || '')}&name=${encodeURIComponent(selected.name || '')}`)}
                      style={s.bannerBtn}
                    >
                      ✉ Message
                    </button>
                  </div>
                </div>

                {/* View tabs */}
                <div style={s.viewTabs}>
                  {VIEWS.map((v) => (
                    <button
                      key={v.id}
                      onClick={() => setView(v.id)}
                      style={{ ...s.viewTab, ...(view === v.id ? s.viewTabActive : {}) }}
                    >
                      {v.label}
                    </button>
                  ))}
                </div>

                {/* View content */}
                <div style={s.viewContent}>
                  {dataLoading ? (
                    <div style={{ padding: 32, textAlign: 'center', fontSize: 12, color: '#3a3e50' }}>Loading data...</div>
                  ) : (
                    <>
                      {view === 'overview'    && <OverviewView restaurant={selected} invoices={invoices} ingredients={ingredients} menuItems={menuItems} />}
                      {view === 'invoices'    && <InvoicesView invoices={invoices} restaurantId={selected.id} onReparse={handleReparse} />}
                      {view === 'ingredients' && <IngredientsView ingredients={ingredients} />}
                      {view === 'menu'        && <MenuView menuItems={menuItems} targetFoodCost={selected.target_food_cost} />}
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}

// ── Shared view styles ────────────────────────────────────────────────────────
const vs = {
  card: { background: '#111318', border: '1px solid #1e2028', borderRadius: 10, overflow: 'hidden' },
  cardTitle: { fontSize: 10, fontWeight: 700, color: '#4a5068', textTransform: 'uppercase', letterSpacing: '0.8px', padding: '12px 16px', borderBottom: '1px solid #1e2028' },
  row: { display: 'flex', alignItems: 'center', padding: '10px 16px', borderBottom: '1px solid #1a1d24' },
  rowMain: { fontSize: 12, fontWeight: 500, color: '#e4e6f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  rowSub: { fontSize: 10, color: '#4a5068', marginTop: 2 },
  empty: { padding: '24px 16px', fontSize: 12, color: '#3a3e50', textAlign: 'center' },
};

const s = {
  page: { padding: 24, display: 'flex', flexDirection: 'column', gap: 20, height: '100%' },
  header: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' },
  title: { fontSize: 20, fontWeight: 700, color: '#e4e6f0', fontFamily: "'Playfair Display', serif" },
  sub: { fontSize: 11, color: '#4a5068', marginTop: 4 },

  grid: { display: 'grid', gridTemplateColumns: '240px 1fr', gap: 16, flex: 1, alignItems: 'start' },

  panel: { background: '#111318', border: '1px solid #1e2028', borderRadius: 10, overflow: 'hidden' },
  panelHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', borderBottom: '1px solid #1e2028' },
  panelLabel: { fontSize: 10, fontWeight: 700, color: '#4a5068', textTransform: 'uppercase', letterSpacing: '0.8px' },
  searchInput: { background: '#0a0908', border: '1px solid #1e2028', borderRadius: 6, padding: '4px 8px', fontSize: 11, color: '#e4e6f0', outline: 'none', width: 100, fontFamily: "'Inter', sans-serif" },
  restRow: { width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', transition: 'background 0.1s', fontFamily: "'Inter', sans-serif", borderBottom: '1px solid #1a1d24' },
  restRowActive: { background: 'rgba(2,164,186,0.07)', borderLeft: '2px solid #02a4ba' },
  restAvatar: { width: 30, height: 30, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0 },
  empty: { padding: '24px 16px', fontSize: 12, color: '#3a3e50', textAlign: 'center' },

  viewBanner: { background: '#111318', border: '1px solid #1e2028', borderRadius: '10px 10px 0 0', padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  bannerAvatar: { width: 36, height: 36, borderRadius: '50%', background: 'rgba(2,164,186,0.15)', border: '1px solid rgba(2,164,186,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: '#02a4ba' },
  bannerName: { fontSize: 14, fontWeight: 700, color: '#e4e6f0' },
  bannerEmail: { fontSize: 10, color: '#4a5068', marginTop: 2 },
  bannerBtn: { background: 'none', border: '1px solid #1e2028', borderRadius: 7, padding: '6px 12px', fontSize: 11, color: '#02a4ba', cursor: 'pointer', fontFamily: "'Inter', sans-serif" },

  viewTabs: { display: 'flex', background: '#0d0f14', borderLeft: '1px solid #1e2028', borderRight: '1px solid #1e2028', borderBottom: '1px solid #1e2028' },
  viewTab: { padding: '10px 18px', fontSize: 11, fontWeight: 500, color: '#5a6080', background: 'none', border: 'none', cursor: 'pointer', fontFamily: "'Inter', sans-serif", borderBottom: '2px solid transparent', transition: 'all 0.15s' },
  viewTabActive: { color: '#02a4ba', borderBottomColor: '#02a4ba', background: 'rgba(2,164,186,0.05)' },
  viewContent: { background: '#111318', border: '1px solid #1e2028', borderTop: 'none', borderRadius: '0 0 10px 10px', padding: 16 },
};