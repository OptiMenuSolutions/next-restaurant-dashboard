// pages/client/ingredients.js
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import supabase from '../../lib/supabaseClient';
import { useWindowSize } from '../../lib/useWindowSize';
import ProfileDropdown from '../../components/ProfileDropdown';
import { useTour } from '../../lib/useTour';
import TourOverlay from '../../components/TourOverlay';
import { fetchSampleData } from '../../lib/seedSampleData';
import { isProtein } from '../../lib/shelfLife';
import TourDataBanner from '../../components/TourDataBanner';
import UniversalSearch from '../../components/UniversalSearch';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';


function formatCurrency(amount) {
  if (amount === null || amount === undefined || amount === '') return '--';
  const n = parseFloat(amount);
  if (isNaN(n)) return '--';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

function formatCurrencyShort(amount) {
  if (!amount) return '$0';
  const n = parseFloat(amount);
  if (isNaN(n)) return '$0';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(d) {
  if (!d) return 'Never';
  try { return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }); }
  catch { return 'Invalid date'; }
}

function formatDateShort(d) {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return '—'; }
}

function isRecent(dateStr) {
  if (!dateStr) return false;
  return new Date(dateStr) > new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
}

const CSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { height: 100%; background: var(--bg-root); overflow: hidden; }
  #__next { height: 100%; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes blink { 0%,100%{opacity:1} 50%{opacity:.3} }
  input::placeholder { color: #3a3630 !important; }
  ::-webkit-scrollbar { width: 3px; }
  ::-webkit-scrollbar-track { background: #0f0e0c; }
  ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }

  .ing-root { font-family: 'Inter', sans-serif; background: var(--bg-root); color: var(--text-primary); width: 100%; height: 100vh; display: flex; flex-direction: column; overflow: hidden; }

  .ing-nav { background: var(--bg-elevated); border-bottom: 1px solid var(--border); height: clamp(36px,4vh,48px); padding: 0 clamp(10px,1vw,20px); display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }
  .ing-logo { font-family: 'Playfair Display', serif; font-size: clamp(13px,1.1vw,18px); color: var(--text-primary); letter-spacing: -.3px; }
  .ing-logo span { color: var(--accent); }
  .ing-tab { padding: clamp(2px,.3vh,4px) clamp(6px,.6vw,11px); border-radius: 4px; font-size: clamp(10px,.75vw,13px); color: var(--text-muted); border: none; background: none; cursor: pointer; font-family: 'Inter', sans-serif; transition: all .15s; }
  .ing-tab.active { color: var(--text-primary); background: var(--bg-inset); }

  .ing-wbar { background: var(--bg-surface); border-bottom: 1px solid var(--border); height: clamp(28px,3.2vh,40px); padding: 0 clamp(10px,1vw,16px); display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }
  .ing-wname { font-size: clamp(11px,.82vw,15px); font-weight: 600; color: var(--text-primary); }
  .ing-wsub { font-size: clamp(9px,.62vw,11px); color: var(--text-muted); margin-left: 6px; }
  .ing-wactions { display: flex; align-items: center; gap: clamp(10px,1.2vw,20px); }
  .ing-waction-item { display: flex; align-items: center; gap: 4px; font-size: clamp(9px,.62vw,11px); color: var(--text-muted); }
  .ing-waction-dot { width: 5px; height: 5px; border-radius: 50%; flex-shrink: 0; }
  .ing-waction-val { font-weight: 600; }

  .ing-split { display: flex; gap: clamp(6px,.6vw,10px); padding: clamp(6px,.6vw,10px) clamp(24px,3vw,60px); flex: 1; min-height: 0; overflow: hidden; }

  .ing-list { width: 55%; background: var(--bg-surface); border: 1px solid var(--border); border-radius: 8px; display: flex; flex-direction: column; overflow: hidden; }
  .ing-list-hd { padding: clamp(8px,.8vh,14px) clamp(10px,1vw,18px); border-bottom: 1px solid var(--border); flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; }
  .ing-list-title { font-size: clamp(10px,.78vw,13px); font-weight: 600; color: var(--text-primary); }
  .ing-list-count { font-size: clamp(9px,.65vw,11px); color: var(--text-muted); background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 10px; padding: 1px 8px; }

  .ing-tbl-head { display: grid; grid-template-columns: 2fr 1.2fr .8fr 1.2fr; gap: 8px; padding: clamp(6px,.6vh,10px) clamp(10px,1vw,18px); background: var(--bg-elevated); border-bottom: 1px solid var(--border); flex-shrink: 0; }
  .ing-th { font-size: clamp(8px,.62vw,10px); font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: .8px; cursor: pointer; display: flex; align-items: center; gap: 3px; user-select: none; }
  .ing-th:hover { color: #9a9086; }
  .ing-th.active { color: var(--accent); }

  .ing-tbl-body { flex: 1; overflow-y: auto; }
  .ing-row { display: grid; grid-template-columns: 2fr 1.2fr .8fr 1.2fr; gap: 8px; padding: clamp(7px,.7vh,12px) clamp(10px,1vw,18px); border-bottom: 1px solid var(--border-subtle); cursor: pointer; transition: background .15s; align-items: center; border-left: 2px solid transparent; }
  .ing-row:hover { background: var(--bg-elevated); }
  .ing-row.selected { background: rgba(2,164,186,.08); border-left-color: var(--accent); }
  .ing-td { font-size: clamp(10px,.75vw,12px); color: #9a9086; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ing-td.name { color: var(--text-primary); font-weight: 500; display: flex; align-items: center; gap: 5px; }
  .ing-td.price { color: var(--accent); font-weight: 600; }
  .ing-td.no-price { color: var(--text-muted); font-style: italic; }
  .ing-recent { font-size: clamp(7px,.55vw,9px); padding: 1px 5px; border-radius: 6px; background: rgba(42,138,90,.1); color: var(--color-green); flex-shrink: 0; }

  .ing-detail { flex: 1; background: var(--bg-surface); border: 1px solid var(--border); border-radius: 8px; display: flex; flex-direction: column; overflow: hidden; }
  .ing-detail-hd { padding: clamp(8px,.8vh,14px) clamp(10px,1vw,18px); border-bottom: 1px solid var(--border); flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; }
  .ing-detail-title { font-size: clamp(10px,.78vw,13px); font-weight: 600; color: var(--text-primary); }
  .ing-detail-body { flex: 1; overflow-y: auto; padding: clamp(10px,1vw,16px); display: flex; flex-direction: column; gap: clamp(8px,.8vh,12px); }

  .ing-w-row { display: grid; grid-template-columns: 1fr 1fr; gap: clamp(6px,.6vw,10px); }
  .ing-w { background: var(--bg-elevated); border: 1px solid var(--border-subtle); border-radius: 7px; padding: clamp(7px,.7vw,10px); }
  .ing-wf { background: var(--bg-elevated); border: 1px solid var(--border-subtle); border-radius: 7px; padding: clamp(7px,.7vw,10px); }
  .ing-wlbl { font-size: clamp(8px,.6vw,10px); font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: .8px; margin-bottom: clamp(6px,.6vh,10px); display: flex; align-items: center; gap: 4px; }
  .ing-wlbl svg { width: 10px; height: 10px; stroke: var(--accent); fill: none; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }

  .ing-prog-row { display: flex; align-items: center; gap: 7px; margin-bottom: clamp(4px,.4vh,7px); }
  .ing-prog-row:last-child { margin-bottom: 0; }
  .ing-prog-label { font-size: clamp(8px,.62vw,11px); color: #6b6358; width: clamp(60px,6vw,90px); flex-shrink: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ing-prog-track { flex: 1; background: var(--border-subtle); border-radius: 3px; height: clamp(4px,.35vh,6px); }
  .ing-prog-fill { height: 100%; border-radius: 3px; }
  .ing-prog-val { font-size: clamp(8px,.62vw,11px); font-weight: 600; width: clamp(38px,3.8vw,55px); text-align: right; flex-shrink: 0; }

  .ing-freq-item { display: flex; align-items: center; gap: clamp(5px,.5vw,8px); padding: clamp(4px,.45vh,7px) 0; border-bottom: 1px solid var(--border-subtle); }
  .ing-freq-item:last-child { border-bottom: none; }
  .ing-freq-rank { font-size: clamp(11px,1vw,15px); color: var(--text-muted); width: 16px; flex-shrink: 0; }
  .ing-freq-name { font-size: clamp(9px,.68vw,12px); color: var(--text-primary); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ing-freq-price { font-size: clamp(9px,.65vw,11px); color: var(--accent); font-weight: 600; flex-shrink: 0; margin-left: 6px; }

  .ing-rise-head { display: grid; grid-template-columns: 2fr 1fr 1fr 1fr; gap: 6px; padding: clamp(4px,.4vh,6px) 0; border-bottom: 1px solid var(--border-subtle); margin-bottom: 4px; }
  .ing-rise-th { font-size: clamp(7px,.58vw,9px); color: var(--text-muted); text-transform: uppercase; letter-spacing: .6px; }
  .ing-rise-row { display: grid; grid-template-columns: 2fr 1fr 1fr 1fr; gap: 6px; padding: clamp(5px,.5vh,8px) 0; border-bottom: 1px solid var(--border-subtle); align-items: center; }
  .ing-rise-row:last-child { border-bottom: none; }
  .ing-rise-name { font-size: clamp(10px,.75vw,12px); color: var(--text-primary); font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ing-rise-prev { font-size: clamp(10px,.75vw,12px); color: #6b6358; }
  .ing-rise-curr { font-size: clamp(10px,.75vw,12px); color: var(--accent); font-weight: 600; }
  .ing-rise-chg { font-size: clamp(10px,.75vw,12px); color: var(--color-red); font-weight: 600; }
  .ing-rise-chg.down { color: var(--color-green); }

  .ing-hint { font-size: clamp(8px,.62vw,10px); color: #3a3630; text-align: center; padding: clamp(4px,.4vh,7px); border: 1px dashed var(--border); border-radius: 6px; }

  .ing-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; flex: 1; gap: 8px; }
  .ing-empty-title { font-size: clamp(11px,.85vw,14px); color: #6b6358; font-weight: 500; }
  .ing-empty-sub { font-size: clamp(9px,.68vw,11px); color: var(--text-muted); text-align: center; max-width: 240px; }
`;

export default function ClientIngredients() {
  const router = useRouter();
  const { isMobile } = useWindowSize();

  const [ingredients, setIngredients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [restaurantId, setRestaurantId] = useState(null);
  const [userName, setUserName] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState('name');
  const [sortOrder, setSortOrder] = useState('asc');
  const [selectedIngredient, setSelectedIngredient] = useState(null);
  const [priceHistory, setPriceHistory] = useState([]);
  const [purchaseHistory, setPurchaseHistory] = useState([]);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [mobTab, setMobTab] = useState('ingredients');

  const tabs = ['Dashboard', 'Invoices', 'Ingredients', 'Menu Items', 'Analytics'];
  const isTour = router.query.tour === 'true';

  useEffect(() => { init(); }, []);
  useEffect(() => { if (restaurantId && !isTour) fetchIngredients(); }, [restaurantId]);
  useEffect(() => {
    router.prefetch('/client/dashboard');
    router.prefetch('/client/invoices');
    router.prefetch('/client/ingredients');
    router.prefetch('/client/menu-items');
    router.prefetch('/client/analytics');
  }, [router]);

  const { tourProps } = useTour('ingredients', restaurantId);

  useEffect(() => {
    if (!router.isReady || !isTour) return;
    fetchSampleData().then(sample => { if (sample) { setIngredients(sample.ingredients); setLoading(false); } });
  }, [router.isReady, isTour]);

  async function init() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/client/login'); return; }
      setUserEmail(user.email || '');
      const { data: profile } = await supabase.from('profiles').select('restaurant_id, full_name').eq('id', user.id).single();
      if (!profile?.restaurant_id) { setLoading(false); return; }
      setRestaurantId(profile.restaurant_id);
      setUserName(profile.full_name ? profile.full_name.trim().split(' ')[0] : 'User');
    } catch (err) {
      console.error('[ingredients] init error:', err);
      setLoading(false);
    }
  }

  async function fetchIngredients() {
    setLoading(true);
    try {
      const { data, error } = await supabase.from('ingredients').select('*').eq('restaurant_id', restaurantId).order('name').limit(1000);
      if (error) throw error;
      setIngredients(data || []);
      const { selected } = router.query;
      if (selected && data) { const found = data.find(i => i.id === selected); if (found) selectIngredient(found); }
    } catch (err) {
      console.error('[ingredients] fetchIngredients error:', err);
    } finally {
      setLoading(false);
    }
  }

  async function selectIngredient(ingredient) {
    setSelectedIngredient(ingredient);
    setLoadingDetail(true);
    router.replace(`/client/ingredients?selected=${ingredient.id}${isTour ? '&tour=true' : ''}`, undefined, { shallow: true });

    if (isTour) {
      const currentPrice = parseFloat(ingredient.last_price || 0);
      if (currentPrice > 0) {
        const today = new Date();
        const syntheticHistory = [];
        for (let i = 5; i >= 0; i--) {
          const d = new Date(today);
          d.setMonth(d.getMonth() - i);
          const trendFactor = 0.90 + (5 - i) * 0.022;
          const noiseFactor = 1 + (Math.random() * 0.04 - 0.02);
          const price = parseFloat((currentPrice * trendFactor * noiseFactor).toFixed(4));
          syntheticHistory.push({ date: d.toISOString().split('T')[0], price: i === 0 ? currentPrice : price, supplier: 'Sample Supplier', invoiceNumber: `INV-SAMPLE-${6 - i}` });
        }
        setPriceHistory(syntheticHistory);
        const syntheticPurchases = syntheticHistory.map((h, i) => ({ id: `tour-ph-${i}`, unit_cost: h.price, quantity: Math.floor(Math.random() * 40) + 10, unit: ingredient.unit || 'unit', invoices: { date: h.date, supplier: h.supplier, number: h.invoiceNumber } }));
        setPurchaseHistory(syntheticPurchases);
      } else { setPriceHistory([]); setPurchaseHistory([]); }
      setLoadingDetail(false);
      return;
    }

    const { data } = await supabase
      .from('invoice_items')
      .select(`*, invoices!invoice_items_invoice_id_fkey(id, date, supplier, number, restaurant_id)`)
      .eq('ingredient_id', ingredient.id)
      .not('unit_cost', 'is', null)
      .gt('unit_cost', 0)
      .order('invoices(date)', { ascending: false })
      .limit(500);

    const history = (data || []).filter(i => i.invoices?.date && i.invoices?.restaurant_id === restaurantId);
    setPurchaseHistory(history);
    const chart = history.filter(i => i.invoices?.date && i.unit_cost > 0).map(i => ({ date: i.invoices.date, price: parseFloat(i.unit_cost), supplier: i.invoices.supplier, invoiceNumber: i.invoices.number })).sort((a, b) => new Date(a.date) - new Date(b.date));
    setPriceHistory(chart);
    setLoadingDetail(false);
  }

  function handleSort(col) {
    if (sortBy === col) setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
    else { setSortBy(col); setSortOrder('asc'); }
  }

  function getSortArrow(col) {
    if (sortBy !== col) return ' ↕';
    return sortOrder === 'asc' ? ' ↑' : ' ↓';
  }

  const filtered = ingredients
    .filter(i => { const s = searchTerm.toLowerCase(); return (i.name || '').toLowerCase().includes(s) || (i.unit || '').toLowerCase().includes(s); })
    .sort((a, b) => {
      let va, vb;
      switch (sortBy) {
        case 'name': va = (a.name || '').toLowerCase(); vb = (b.name || '').toLowerCase(); break;
        case 'last_price': va = parseFloat(a.last_price) || 0; vb = parseFloat(b.last_price) || 0; break;
        case 'unit': va = (a.unit || '').toLowerCase(); vb = (b.unit || '').toLowerCase(); break;
        case 'last_ordered_at': va = new Date(a.last_ordered_at || 0); vb = new Date(b.last_ordered_at || 0); break;
        default: return 0;
      }
      if (va < vb) return sortOrder === 'asc' ? -1 : 1;
      if (va > vb) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });

  const priced = ingredients.filter(i => i.last_price && parseFloat(i.last_price) > 0);
  const unpriced = ingredients.filter(i => !i.last_price || parseFloat(i.last_price) === 0);
  const avgPrice = priced.length > 0 ? priced.reduce((s, i) => s + parseFloat(i.last_price), 0) / priced.length : 0;
  const highest = priced.length > 0 ? Math.max(...priced.map(i => parseFloat(i.last_price))) : 0;
  const topExpensive = [...priced].sort((a, b) => parseFloat(b.last_price) - parseFloat(a.last_price)).slice(0, 5);
  const maxPrice = topExpensive[0] ? parseFloat(topExpensive[0].last_price) : 1;
  const expColors = ['var(--color-red)', 'var(--color-amber)', 'var(--color-amber)', 'var(--accent)', 'var(--accent)'];

  const prices = priceHistory.map(p => p.price);
  const avgIng = prices.length > 0 ? prices.reduce((s, p) => s + p, 0) / prices.length : 0;
  const firstPrice = prices[0];
  const lastPrice = prices[prices.length - 1];
  const priceChangePct = firstPrice ? ((lastPrice - firstPrice) / firstPrice) * 100 : 0;

  const NAV_ITEMS = [
    { label: 'Dashboard',   path: '/client/dashboard',   icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg> },
    { label: 'Invoices',    path: '/client/invoices',    icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> },
    { label: 'Ingredients', path: '/client/ingredients', icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 8h1a4 4 0 010 8h-1"/><path d="M3 8h14v9a4 4 0 01-4 4H7a4 4 0 01-4-4V8z"/></svg> },
    { label: 'Menu',        path: '/client/menu-items',  icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg> },
    { label: 'Analytics',   path: '/client/analytics',   icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg> },
  ];

  // ── MOBILE ──────────────────────────────────────────────────────────────────
  if (isMobile) {
    const MOB_TABS = [
      { id: 'ingredients', label: 'Ingredients', badge: filtered.length },
      { id: 'overview',    label: 'Overview' },
      { id: 'prices',      label: 'Prices' },
    ];

    return (
      <>
        <Head>
          <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        </Head>
        <style>{CSS}</style>
        <style>{`
          @keyframes spin { to { transform: rotate(360deg); } }
          @keyframes blink { 0%,100%{opacity:1} 50%{opacity:.3} }
          .mob2-root { font-family:'Inter',sans-serif; background:var(--bg-root); color:var(--text-primary); width:100%; height:100dvh; display:flex; flex-direction:column; overflow:hidden; }
          .mob2-header { background:var(--bg-elevated); border-bottom:1px solid var(--border); padding:10px 16px; padding-top:max(10px,env(safe-area-inset-top)); display:flex; align-items:center; justify-content:space-between; flex-shrink:0; }
          .mob2-logo { font-family:'Inter',sans-serif; font-size:18px; font-weight:700; color:var(--text-primary); letter-spacing:-.3px; }
          .mob2-logo span { color:var(--accent); }
          .mob2-subbar { background:var(--bg-surface); border-bottom:1px solid var(--border); padding:10px 16px; display:flex; align-items:center; justify-content:space-between; flex-shrink:0; }
          .mob2-tabs { background:var(--bg-elevated); border-bottom:1px solid var(--border); display:flex; overflow-x:auto; flex-shrink:0; -webkit-overflow-scrolling:touch; }
          .mob2-tabs::-webkit-scrollbar { display:none; }
          .mob2-tab { flex-shrink:0; padding:10px 14px; font-size:12px; font-weight:500; color:var(--text-muted); border:none; background:none; cursor:pointer; font-family:'Inter',sans-serif; border-bottom:2px solid transparent; white-space:nowrap; -webkit-tap-highlight-color:transparent; display:flex; align-items:center; gap:5px; }
          .mob2-tab.active { color:var(--accent); border-bottom-color:var(--accent); }
          .mob2-tab-badge { background:var(--accent); color:#0a0908; font-size:9px; font-weight:700; border-radius:8px; padding:1px 5px; }
          .mob2-search { padding:10px 16px; background:var(--bg-root); border-bottom:1px solid var(--border); flex-shrink:0; }
          .mob2-search-input { width:100%; background:var(--bg-surface); border:1px solid var(--border); border-radius:8px; padding:10px 14px; font-size:14px; color:var(--text-primary); outline:none; font-family:'Inter',sans-serif; }
          .mob2-scroll { flex:1; overflow-y:auto; -webkit-overflow-scrolling:touch; }
          .mob2-scroll::-webkit-scrollbar { display:none; }
          .mob2-content { flex:1; overflow-y:auto; padding:12px 16px; display:flex; flex-direction:column; gap:12px; -webkit-overflow-scrolling:touch; }
          .mob2-content::-webkit-scrollbar { display:none; }
          .mob2-card { background:var(--bg-surface); border:1px solid var(--border); border-radius:10px; padding:14px; flex-shrink:0; }
          .mob2-card-title { font-size:11px; font-weight:600; color:var(--text-primary); text-transform:uppercase; letter-spacing:.7px; margin-bottom:12px; display:flex; align-items:center; gap:6px; }
          .mob2-card-title svg { width:12px; height:12px; stroke:var(--accent); fill:none; stroke-width:1.5; stroke-linecap:round; stroke-linejoin:round; }
          .mob2-ing-row { display:flex; align-items:center; padding:13px 16px; border-bottom:1px solid var(--border-subtle); cursor:pointer; gap:12px; border-left:3px solid transparent; -webkit-tap-highlight-color:transparent; }
          .mob2-ing-row.selected { background:rgba(2,164,186,.07); border-left-color:var(--accent); }
          .mob2-bottom-nav { background:var(--bg-elevated); border-top:1px solid var(--border); padding:8px 0 0; padding-bottom:env(safe-area-inset-bottom,8px); display:flex; flex-shrink:0; position:sticky; bottom:0; z-index:50; }
          .mob2-nav-item { flex:1; display:flex; flex-direction:column; align-items:center; gap:3px; cursor:pointer; padding:4px 0; -webkit-tap-highlight-color:transparent; }
          .mob2-nav-icon svg { width:20px; height:20px; stroke:var(--text-muted); fill:none; stroke-width:1.5; stroke-linecap:round; stroke-linejoin:round; }
          .mob2-nav-icon.active svg { stroke:var(--accent); }
          .mob2-nav-label { font-size:10px; color:var(--text-muted); }
          .mob2-nav-label.active { color:var(--accent); }
          .mob2-detail-overlay { position:fixed; inset:0; background:var(--bg-root); display:flex; flex-direction:column; z-index:30; overflow:hidden; }
          .mob2-detail-hd { background:var(--bg-elevated); border-bottom:1px solid var(--border); padding:12px 16px; padding-top:max(12px,env(safe-area-inset-top)); display:flex; align-items:center; gap:12px; flex-shrink:0; }
          .mob2-detail-body { flex:1; overflow-y:auto; padding:14px 16px; display:flex; flex-direction:column; gap:12px; padding-bottom:max(24px,env(safe-area-inset-bottom)); }
          .mob2-detail-body::-webkit-scrollbar { display:none; }
        `}</style>

        <div className="mob2-root">

          {/* Header */}
          <div className="mob2-header">
            <div className="mob2-logo">Opti<span>Menu</span></div>
            <ProfileDropdown userName={userName} userEmail={userEmail} isMobile={true} />
          </div>

          {/* Sub bar */}
          <div className="mob2-subbar">
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Ingredient Inventory</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{ingredients.length} ingredients · {priced.length} priced</div>
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              {unpriced.length > 0 && (
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 9, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: .5 }}>Unpriced</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-red)' }}>{unpriced.length}</div>
                </div>
              )}
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 9, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: .5 }}>Avg Price</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)' }}>{avgPrice > 0 ? formatCurrencyShort(avgPrice) : '—'}</div>
              </div>
            </div>
          </div>

          {/* Tab bar */}
          <div className="mob2-tabs">
            {MOB_TABS.map(t => (
              <button key={t.id} className={`mob2-tab${mobTab === t.id ? ' active' : ''}`} onClick={() => setMobTab(t.id)}>
                {t.label}
                {t.badge !== undefined && <span className="mob2-tab-badge">{t.badge}</span>}
              </button>
            ))}
          </div>

          {/* Content */}
          {loading ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 10 }}>
              <div style={{ width: 22, height: 22, border: '2px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loading ingredients...</div>
            </div>
          ) : (
            <>
              {/* ── INGREDIENTS TAB ── */}
              {mobTab === 'ingredients' && (
                <>
                  <div className="mob2-search">
                    <input className="mob2-search-input" placeholder="Search ingredients..."
                      value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
                  </div>
                  <div className="mob2-scroll">
                    {filtered.length === 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 40, gap: 8 }}>
                        <div style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 500 }}>{searchTerm ? `No results for "${searchTerm}"` : 'No ingredients yet'}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-faint)', textAlign: 'center' }}>{searchTerm ? 'Try a different search term' : 'Ingredients appear after invoices are processed'}</div>
                      </div>
                    ) : filtered.map(ing => {
                      const hasPrice = ing.last_price && parseFloat(ing.last_price) > 0;
                      const recent = isRecent(ing.last_ordered_at);
                      return (
                        <div key={ing.id} className="mob2-ing-row" onClick={() => selectIngredient(ing)}>
                          <div style={{ width: 6, height: 6, borderRadius: '50%', background: hasPrice ? 'var(--color-green)' : 'var(--color-amber)', flexShrink: 0 }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ing.name || 'Unnamed'}</div>
                              {recent && <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 6, background: 'rgba(42,138,90,.1)', color: 'var(--color-green)', flexShrink: 0 }}>Recent</span>}
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{ing.unit || '—'} · {ing.last_ordered_at ? formatDateShort(ing.last_ordered_at) : 'Never ordered'}</div>
                          </div>
                          <div style={{ textAlign: 'right', flexShrink: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: hasPrice ? 'var(--accent)' : 'var(--text-muted)', fontStyle: hasPrice ? 'normal' : 'italic' }}>
                              {hasPrice ? formatCurrencyShort(ing.last_price) : 'No price'}
                            </div>
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--text-faint)', flexShrink: 0 }}>›</div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}

              {/* ── OVERVIEW TAB ── */}
              {mobTab === 'overview' && (
                <div className="mob2-content">
                  {/* Stats grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    {[
                      { l: 'Total', v: ingredients.length, c: 'var(--text-primary)' },
                      { l: 'Priced', v: priced.length, c: 'var(--color-green)' },
                      { l: 'Unpriced', v: unpriced.length, c: unpriced.length > 0 ? 'var(--color-red)' : 'var(--color-green)' },
                      { l: 'Avg Price', v: avgPrice > 0 ? formatCurrencyShort(avgPrice) : '—', c: 'var(--accent)' },
                      { l: 'Highest Price', v: highest > 0 ? formatCurrencyShort(highest) : '—', c: 'var(--color-amber)' },
                      { l: 'Priced %', v: ingredients.length > 0 ? `${Math.round((priced.length / ingredients.length) * 100)}%` : '—', c: 'var(--text-primary)' },
                    ].map(({ l, v, c }) => (
                      <div key={l} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px' }}>
                        <div style={{ fontSize: 10, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 6 }}>{l}</div>
                        <div style={{ fontSize: 20, fontWeight: 700, color: c, lineHeight: 1 }}>{v}</div>
                      </div>
                    ))}
                  </div>

                  {/* Most Expensive */}
                  <div className="mob2-card">
                    <div className="mob2-card-title">
                      <svg viewBox="0 0 24 24"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>
                      Most Expensive
                    </div>
                    {topExpensive.length > 0 ? topExpensive.map((ing, i) => (
                      <div key={ing.id} style={{ marginBottom: 12 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                          <div style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '65%' }}>{ing.name}</div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: expColors[i] }}>{formatCurrencyShort(ing.last_price)}</div>
                        </div>
                        <div style={{ height: 5, background: 'var(--border-subtle)', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ width: `${(parseFloat(ing.last_price) / maxPrice) * 100}%`, height: '100%', background: expColors[i], borderRadius: 3 }} />
                        </div>
                      </div>
                    )) : <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No priced ingredients yet</div>}
                  </div>

                  {/* Watch list */}
                  <div className="mob2-card">
                    <div className="mob2-card-title">
                      <svg viewBox="0 0 24 24"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
                      Rising Prices — Watch List
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 6, paddingBottom: 8, borderBottom: '1px solid var(--border-subtle)', marginBottom: 6 }}>
                      {['Ingredient', 'Prev', 'Current', 'Change'].map(h => (
                        <div key={h} style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: .6 }}>{h}</div>
                      ))}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '6px 0' }}>
                      Select an ingredient to view price change history
                    </div>
                  </div>
                  <div style={{ height: 8 }} />
                </div>
              )}

              {/* ── PRICES TAB ── */}
              {mobTab === 'prices' && (
                <div className="mob2-content">
                  <div className="mob2-card">
                    <div className="mob2-card-title">
                      <svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
                      All Priced Ingredients
                    </div>
                    {priced.length > 0 ? [...priced].sort((a, b) => parseFloat(b.last_price) - parseFloat(a.last_price)).map((ing, i) => (
                      <div key={ing.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--border-subtle)', cursor: 'pointer' }}
                        onClick={() => { setMobTab('ingredients'); selectIngredient(ing); }}>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', width: 20, flexShrink: 0, textAlign: 'right' }}>{i + 1}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ing.name}</div>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{ing.unit || '—'}</div>
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)', flexShrink: 0 }}>{formatCurrencyShort(ing.last_price)}</div>
                      </div>
                    )) : <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: 16 }}>No priced ingredients yet</div>}
                  </div>

                  {unpriced.length > 0 && (
                    <div className="mob2-card">
                      <div className="mob2-card-title" style={{ color: 'var(--color-amber)' }}>
                        <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                        Unpriced ({unpriced.length})
                      </div>
                      {unpriced.map(ing => (
                        <div key={ing.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--border-subtle)', cursor: 'pointer' }}
                          onClick={() => { setMobTab('ingredients'); selectIngredient(ing); }}>
                          <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--color-amber)', flexShrink: 0 }} />
                          <div style={{ flex: 1, fontSize: 13, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ing.name}</div>
                          <div style={{ fontSize: 11, color: 'var(--color-amber)', fontStyle: 'italic' }}>No price</div>
                        </div>
                      ))}
                    </div>
                  )}
                  <div style={{ height: 8 }} />
                </div>
              )}
            </>
          )}

          {/* Bottom nav */}
          <div className="mob2-bottom-nav">
            {NAV_ITEMS.map(({ label, path, icon }) => {
              const active = path === '/client/ingredients';
              return (
                <div key={label} className="mob2-nav-item" onClick={() => router.push(path)}>
                  <div className={`mob2-nav-icon${active ? ' active' : ''}`}>{icon}</div>
                  <div className={`mob2-nav-label${active ? ' active' : ''}`}>{label}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Ingredient detail overlay */}
        {selectedIngredient && (
          <div className="mob2-detail-overlay">
            <div className="mob2-detail-hd">
              <button onClick={() => { setSelectedIngredient(null); setPriceHistory([]); setPurchaseHistory([]); router.replace(isTour ? '/client/ingredients?tour=true' : '/client/ingredients', undefined, { shallow: true }); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--accent)', fontFamily: 'Inter,sans-serif', padding: 0, flexShrink: 0 }}>← Back</button>
              <div style={{ flex: 1, fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedIngredient.name}</div>
              {isRecent(selectedIngredient.last_ordered_at) && (
                <span style={{ fontSize: 9, padding: '2px 7px', borderRadius: 8, background: 'rgba(42,138,90,.1)', color: 'var(--color-green)', flexShrink: 0 }}>Recent</span>
              )}
            </div>
            <div className="mob2-detail-body">

              {/* Info fields */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {[
                  { l: 'Unit', v: selectedIngredient.unit || '—' },
                  { l: 'Last Ordered', v: formatDate(selectedIngredient.last_ordered_at) },
                ].map(({ l, v }) => (
                  <div key={l} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px' }}>
                    <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 4 }}>{l}</div>
                    <div style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>{v}</div>
                  </div>
                ))}
              </div>

              {/* Current price */}
              <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 500 }}>Current Price</div>
                <div style={{ fontFamily: "'Inter',sans-serif", fontWeight: 700, fontSize: 20, color: 'var(--accent)' }}>
                  {selectedIngredient.last_price ? formatCurrency(selectedIngredient.last_price) : 'No price'}
                </div>
              </div>

              {/* Price stats */}
              {!loadingDetail && prices.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {[
                    { l: 'Avg Price', v: avgIng > 0 ? formatCurrencyShort(avgIng) : '—', c: 'var(--text-primary)' },
                    { l: 'Price Change', v: prices.length > 1 ? `${priceChangePct > 0 ? '+' : ''}${priceChangePct.toFixed(1)}%` : '—', c: priceChangePct > 0 ? 'var(--color-red)' : priceChangePct < 0 ? 'var(--color-green)' : 'var(--text-muted)' },
                    { l: 'Total Orders', v: purchaseHistory.length, c: 'var(--text-primary)' },
                    { l: 'First Seen', v: priceHistory.length > 0 ? formatDate(priceHistory[0].date) : '—', c: 'var(--text-primary)' },
                  ].map(({ l, v, c }) => (
                    <div key={l} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px' }}>
                      <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 4 }}>{l}</div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: c, lineHeight: 1 }}>{v}</div>
                    </div>
                  ))}
                </div>
              )}

              {loadingDetail && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: 12 }}>
                  <div style={{ width: 16, height: 16, border: '2px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
                  Loading price history...
                </div>
              )}

              {/* Price chart */}
              {!loadingDetail && priceHistory.length > 1 && (
                <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '14px' }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: .7, marginBottom: 10 }}>Price History</div>
                  <ResponsiveContainer width="100%" height={80}>
                    <LineChart data={priceHistory} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                      <Line type="monotone" dataKey="price" stroke="#02a4ba" strokeWidth={1.5}
                        dot={{ r: 2.5, fill: '#02a4ba', strokeWidth: 0 }} activeDot={{ r: 4, fill: '#02a4ba' }} />
                      <Tooltip
                        contentStyle={{ background: '#1a1915', border: '1px solid #2a2520', borderRadius: 4, fontSize: 11, color: '#9a9086' }}
                        formatter={(v) => [formatCurrency(v), 'Price']}
                        labelFormatter={(_, payload) => payload?.[0]?.payload?.date ? formatDateShort(payload[0].payload.date) : ''} />
                      <YAxis domain={['auto', 'auto']} hide />
                      <XAxis dataKey="date" hide />
                    </LineChart>
                  </ResponsiveContainer>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{formatDate(priceHistory[0].date)} · {formatCurrency(priceHistory[0].price)}</div>
                    <div style={{ fontSize: 10, color: 'var(--accent)', fontWeight: 600 }}>{formatDate(priceHistory[priceHistory.length - 1].date)} · {formatCurrency(priceHistory[priceHistory.length - 1].price)}</div>
                  </div>
                </div>
              )}

              {!loadingDetail && priceHistory.length === 1 && (
                <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '14px', fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
                  Only 1 purchase recorded — chart requires 2+ data points
                </div>
              )}

              {/* Purchase history */}
              {!loadingDetail && purchaseHistory.length > 0 && (
                <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '14px' }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: .7, marginBottom: 10 }}>
                    Purchase History ({purchaseHistory.length})
                  </div>
                  {purchaseHistory.map((p, i) => {
                    const price = parseFloat(p.unit_cost);
                    const prev = purchaseHistory[i + 1] ? parseFloat(purchaseHistory[i + 1].unit_cost) : null;
                    const dotColor = prev === null ? 'var(--accent)' : price > prev ? 'var(--color-red)' : price < prev ? 'var(--color-green)' : 'var(--text-faint)';
                    return (
                      <div key={p.id || i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                        <div style={{ width: 6, height: 6, borderRadius: '50%', background: dotColor, flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.invoices?.supplier || p.invoices?.number || 'Invoice'}</div>
                          <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 2 }}>{p.invoices?.date ? formatDateShort(p.invoices.date) : '—'}</div>
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: dotColor, flexShrink: 0 }}>{formatCurrency(p.unit_cost)}</div>
                      </div>
                    );
                  })}
                </div>
              )}

            </div>
          </div>
        )}

        {tourProps && <TourOverlay {...tourProps} />}
        <TourDataBanner />
      </>
    );
  }

  // ── DESKTOP ──────────────────────────────────────────────────────────────────
  return (
    <>
      <style>{CSS}</style>
      <div className="ing-root">

        <div className="ing-nav">
          <div style={{display:'flex',alignItems:'center',gap:'clamp(8px,1vw,16px)'}}>
            <div className="ing-logo">Opti<span>Menu</span></div>
            <div style={{display:'flex',gap:2}}>
              {tabs.map(t=>(
                <button key={t} className={`ing-tab${t==='Ingredients'?' active':''}`}
                  onClick={()=>router.push(t==='Dashboard'?'/client/dashboard':`/client/${t.toLowerCase().replace(' ','-')}`)}>
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:'clamp(6px,.7vw,12px)'}}>
            <div style={{display:'flex',alignItems:'center',gap:4,fontSize:'clamp(9px,.62vw,11px)',color:'var(--accent)'}}>
              <div style={{width:5,height:5,background:'var(--accent)',borderRadius:'50%',animation:'blink 2s infinite'}}/>Active
            </div>
            <div style={{width:'clamp(140px,13vw,240px)',height:'clamp(26px,2.6vh,34px)',overflow:'visible',position:'relative'}}>
              <UniversalSearch restaurantId={restaurantId} placeholder="Search..."/>
            </div>
            <ProfileDropdown userName={userName} userEmail={userEmail} isMobile={false}/>
          </div>
        </div>

        <div className="ing-wbar">
          <div style={{display:'flex',alignItems:'baseline'}}>
            <span className="ing-wname">Ingredient Inventory</span>
            <span className="ing-wsub">· {ingredients.length} ingredients · {priced.length} priced</span>
          </div>
          <div className="ing-wactions">
            <div className="ing-waction-item">
              <div className="ing-waction-dot" style={{background:'var(--color-red)'}}/>
              <span className="ing-waction-val" style={{color:'var(--color-red)'}}>{unpriced.length}</span>
              <span>unpriced</span>
            </div>
            <div className="ing-waction-item">
              <div className="ing-waction-dot" style={{background:'var(--color-amber)'}}/>
              <span className="ing-waction-val" style={{color:'var(--color-amber)'}}>{highest>0?formatCurrencyShort(highest):'—'}</span>
              <span>highest price</span>
            </div>
            <div className="ing-waction-item">
              <div className="ing-waction-dot" style={{background:'var(--accent)'}}/>
              <span className="ing-waction-val" style={{color:'var(--accent)'}}>{avgPrice>0?formatCurrencyShort(avgPrice):'—'}</span>
              <span>avg price</span>
            </div>
          </div>
        </div>

        {loading ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 10 }}>
            <div style={{ width: 22, height: 22, border: '2px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
            <div style={{ fontSize: 'clamp(10px,.8vw,13px)', color: 'var(--text-muted)' }}>Loading ingredients...</div>
          </div>
        ) : (
          <div className="ing-split">
            <div className="ing-list">
              <div className="ing-list-hd">
                <div className="ing-list-title">Ingredient List</div>
                <div className="ing-list-count">{filtered.length} ingredient{filtered.length !== 1 ? 's' : ''}</div>
              </div>
              <div className="ing-tbl-head">
                {[['name', 'Name'], ['last_price', 'Latest Price'], ['unit', 'Unit'], ['last_ordered_at', 'Last Ordered']].map(([col, label]) => (
                  <div key={col} className={`ing-th${sortBy === col ? ' active' : ''}`} onClick={() => handleSort(col)}>
                    {label}{getSortArrow(col)}
                  </div>
                ))}
              </div>
              <div className="ing-tbl-body">
                {filtered.length === 0 ? (
                  <div className="ing-empty" style={{ height: 200 }}>
                    <div className="ing-empty-title">{searchTerm ? `No results for "${searchTerm}"` : 'No ingredients yet'}</div>
                    <div className="ing-empty-sub">{searchTerm ? 'Try a different search term' : 'Ingredients appear automatically after invoices are processed'}</div>
                  </div>
                ) : filtered.map(ing => {
                  const hasPrice = ing.last_price && parseFloat(ing.last_price) > 0;
                  const recent = isRecent(ing.last_ordered_at);
                  return (
                    <div key={ing.id} className={`ing-row${selectedIngredient?.id === ing.id ? ' selected' : ''}`} onClick={() => selectIngredient(ing)}>
                      <div className="ing-td name">
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ing.name || 'Unnamed'}</span>
                        {recent && <span className="ing-recent">Recent</span>}
                      </div>
                      <div className={`ing-td ${hasPrice ? 'price' : 'no-price'}`}>{hasPrice ? formatCurrency(ing.last_price) : 'No price'}</div>
                      <div className="ing-td">{ing.unit || '—'}</div>
                      <div className="ing-td">{ing.last_ordered_at ? formatDateShort(ing.last_ordered_at) : <span style={{ color: 'var(--text-muted)' }}>Never</span>}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="ing-detail">
              <div className="ing-detail-hd">
                <div className="ing-detail-title">{selectedIngredient ? 'Ingredient Detail' : 'Ingredient Overview'}</div>
                <div style={{ fontSize: 'clamp(9px,.65vw,11px)', color: selectedIngredient ? 'var(--accent)' : 'var(--text-muted)' }}>
                  {selectedIngredient ? `${selectedIngredient.name} · ${selectedIngredient.unit || 'no unit'}` : 'Click an ingredient to view details'}
                </div>
              </div>

              {!selectedIngredient && (
                <div className="ing-detail-body">
                  <div className="ing-wf">
                    <div className="ing-wlbl"><div style={{width:6,height:6,borderRadius:'50%',background:'var(--accent)',flexShrink:0}}/>Key Metrics</div>
                    <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'clamp(5px,.5vw,8px)'}}>
                      {[
                        {l:'Total Ingredients',v:ingredients.length,                          c:'var(--text-primary)'},
                        {l:'Priced',           v:priced.length,                                c:'var(--color-green)'},
                        {l:'Unpriced',         v:unpriced.length,                              c:unpriced.length>0?'var(--color-red)':'var(--color-green)'},
                        {l:'Avg Price',        v:avgPrice>0?formatCurrencyShort(avgPrice):'—', c:'var(--accent)'},
                      ].map(({l,v,c})=>(
                        <div key={l} style={{background:'var(--bg-surface)',border:'1px solid var(--border-subtle)',borderRadius:'clamp(4px,.3vw,6px)',padding:'clamp(6px,.6vh,9px) clamp(8px,.7vw,10px)'}}>
                          <div style={{fontSize:'clamp(7px,.55vw,9px)',color:'var(--text-faint)',textTransform:'uppercase',letterSpacing:'.5px',marginBottom:4}}>{l}</div>
                          <div style={{fontFamily:"'Inter',sans-serif",fontSize:'clamp(12px,1vw,16px)',fontWeight:700,color:c}}>{v}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="ing-w-row">
                    <div className="ing-w">
                      <div className="ing-wlbl">
                        <svg viewBox="0 0 24 24"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>
                        Most Expensive
                      </div>
                      {topExpensive.length > 0 ? topExpensive.map((ing, i) => (
                        <div key={ing.id} className="ing-prog-row">
                          <div className="ing-prog-label">{ing.name}</div>
                          <div className="ing-prog-track"><div className="ing-prog-fill" style={{ width: `${(parseFloat(ing.last_price) / maxPrice) * 100}%`, background: expColors[i] }} /></div>
                          <div className="ing-prog-val" style={{ color: expColors[i] }}>{formatCurrencyShort(ing.last_price)}</div>
                        </div>
                      )) : <div style={{ fontSize: 'clamp(9px,.68vw,11px)', color: 'var(--text-muted)' }}>No priced ingredients yet</div>}
                    </div>

                    <div className="ing-w">
                      <div className="ing-wlbl">
                        <svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
                        Recently Ordered
                      </div>
                      {(() => {
                        const recentProteins = ingredients
                          .filter(i => i.last_ordered_at && isProtein(i.name))
                          .sort((a, b) => new Date(b.last_ordered_at) - new Date(a.last_ordered_at))
                          .slice(0, 5);
                        return recentProteins.length > 0 ? recentProteins.map((ing, i) => (
                          <div key={ing.id} className="ing-freq-item">
                            <div className="ing-freq-rank">{i + 1}</div>
                            <div className="ing-freq-name">{ing.name}</div>
                            <div className="ing-freq-price">{formatDateShort(ing.last_ordered_at)}</div>
                          </div>
                        )) : <div style={{ fontSize: 'clamp(9px,.68vw,11px)', color: 'var(--text-muted)' }}>No proteins ordered yet</div>;
                      })()}
                    </div>
                  </div>

                  <div className="ing-wf">
                    <div className="ing-wlbl">
                      <svg viewBox="0 0 24 24"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
                      Rising Prices — Watch List
                    </div>
                    <div className="ing-rise-head">
                      <div className="ing-rise-th">Ingredient</div>
                      <div className="ing-rise-th">Prev</div>
                      <div className="ing-rise-th">Current</div>
                      <div className="ing-rise-th">Change</div>
                    </div>
                    <div style={{ fontSize: 'clamp(9px,.68vw,11px)', color: 'var(--text-muted)', padding: '6px 0' }}>
                      Select an ingredient to view price change history
                    </div>
                  </div>

                  <div className="ing-hint">Select an ingredient to view price history and purchase records →</div>
                </div>
              )}

              {selectedIngredient && (
                <div style={{display:'flex',flexDirection:'column',height:'100%',overflow:'hidden'}}>
                  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'clamp(6px,.6vw,10px) clamp(10px,1vw,16px)',borderBottom:'1px solid var(--border)',flexShrink:0}}>
                    <button onClick={()=>{setSelectedIngredient(null);setPriceHistory([]);setPurchaseHistory([]);router.replace(isTour?'/client/ingredients?tour=true':'/client/ingredients',undefined,{shallow:true});}}
                      style={{background:'none',border:'none',cursor:'pointer',fontSize:'clamp(9px,.68vw,11px)',color:'var(--accent)',fontFamily:"'Inter',sans-serif",display:'flex',alignItems:'center',gap:4,padding:0}}>
                      ← Back to overview
                    </button>
                    {isRecent(selectedIngredient.last_ordered_at)&&<span className="ing-recent">Recent</span>}
                  </div>

                  <div className="ing-detail-body">
                    <div className="ing-wf">
                      <div className="ing-wlbl"><div style={{width:6,height:6,borderRadius:'50%',background:'var(--accent)',flexShrink:0}}/>Ingredient Information</div>
                      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'clamp(5px,.5vw,8px)'}}>
                        {[
                          {l:'Name',          v:selectedIngredient.name||'Unnamed',                                                                   c:'var(--text-primary)'},
                          {l:'Current Price', v:selectedIngredient.last_price?formatCurrency(selectedIngredient.last_price):'No price',               c:'var(--accent)',accent:true},
                          {l:'Unit',          v:selectedIngredient.unit||'—',                                                                         c:'var(--text-primary)'},
                          {l:'Last Ordered',  v:formatDate(selectedIngredient.last_ordered_at),                                                       c:'var(--text-primary)'},
                        ].map(({l,v,c,accent})=>(
                          <div key={l} style={{background:'var(--bg-surface)',border:'1px solid var(--border-subtle)',borderRadius:'clamp(4px,.3vw,6px)',padding:'clamp(6px,.6vh,9px) clamp(8px,.7vw,10px)'}}>
                            <div style={{fontSize:'clamp(7px,.55vw,9px)',color:'var(--text-faint)',textTransform:'uppercase',letterSpacing:'.5px',marginBottom:4}}>{l}</div>
                            <div style={{fontFamily:"'Inter',sans-serif",fontSize:'clamp(11px,.85vw,14px)',fontWeight:accent?700:500,color:c}}>{v}</div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="ing-wf">
                      <div className="ing-wlbl"><div style={{width:6,height:6,borderRadius:'50%',background:'var(--accent)',flexShrink:0}}/>Price Statistics</div>
                      {loadingDetail?(
                        <div style={{display:'flex',alignItems:'center',gap:8,fontSize:'clamp(9px,.68vw,11px)',color:'var(--text-muted)'}}>
                          <div style={{width:14,height:14,border:'2px solid var(--border)',borderTopColor:'var(--accent)',borderRadius:'50%',animation:'spin .7s linear infinite'}}/>
                          Loading price history...
                        </div>
                      ):(
                        <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'clamp(5px,.5vw,8px)'}}>
                          {[
                            {l:'Avg Price',    v:avgIng>0?formatCurrency(avgIng):'—',                                                                                                                        c:'var(--text-primary)'},
                            {l:'Price Change', v:prices.length>1?`${priceChangePct>0?'+':''}${priceChangePct.toFixed(1)}% ${priceChangePct>0?'↑':priceChangePct<0?'↓':'→'}`:'—',                             c:priceChangePct>0?'var(--color-red)':priceChangePct<0?'var(--color-green)':'var(--text-muted)'},
                            {l:'Total Orders', v:purchaseHistory.length,                                                                                                                                      c:'var(--text-primary)'},
                            {l:'First Seen',   v:priceHistory.length>0?formatDate(priceHistory[0].date):'—',                                                                                                  c:'var(--text-primary)'},
                          ].map(({l,v,c})=>(
                            <div key={l} style={{background:'var(--bg-surface)',border:'1px solid var(--border-subtle)',borderRadius:'clamp(4px,.3vw,6px)',padding:'clamp(6px,.6vh,9px) clamp(8px,.7vw,10px)'}}>
                              <div style={{fontSize:'clamp(7px,.55vw,9px)',color:'var(--text-faint)',textTransform:'uppercase',letterSpacing:'.5px',marginBottom:4}}>{l}</div>
                              <div style={{fontFamily:"'Inter',sans-serif",fontSize:'clamp(11px,.85vw,14px)',fontWeight:600,color:c}}>{v}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {!loadingDetail&&priceHistory.length>1&&(
                      <div className="ing-wf">
                        <div className="ing-wlbl"><div style={{width:6,height:6,borderRadius:'50%',background:'var(--accent)',flexShrink:0}}/>Price History</div>
                        <div style={{background:'var(--bg-surface)',border:'1px solid var(--border-subtle)',borderRadius:6,padding:'clamp(8px,.8vw,14px)'}}>
                          <ResponsiveContainer width="100%" height={80}>
                            <LineChart data={priceHistory} margin={{top:4,right:4,bottom:0,left:4}}>
                              <Line type="monotone" dataKey="price" stroke="#02a4ba" strokeWidth={1.5} dot={{r:2.5,fill:'#02a4ba',strokeWidth:0}} activeDot={{r:4,fill:'#02a4ba'}}/>
                              <Tooltip contentStyle={{background:'#1a1915',border:'1px solid #2a2520',borderRadius:4,fontSize:'clamp(9px,.65vw,11px)',color:'#9a9086'}} formatter={(v)=>[formatCurrency(v),'Price']} labelFormatter={(_,payload)=>payload?.[0]?.payload?.date?formatDateShort(payload[0].payload.date):''}/>
                              <YAxis domain={['auto','auto']} hide/>
                              <XAxis dataKey="date" hide/>
                            </LineChart>
                          </ResponsiveContainer>
                          <div style={{display:'flex',justifyContent:'space-between',marginTop:4}}>
                            <div style={{fontSize:'clamp(8px,.6vw,10px)',color:'var(--text-muted)'}}>{formatDate(priceHistory[0].date)} — {formatCurrency(priceHistory[0].price)}</div>
                            <div style={{fontSize:'clamp(8px,.6vw,10px)',color:'var(--accent)',fontWeight:600}}>{formatDate(priceHistory[priceHistory.length-1].date)} — {formatCurrency(priceHistory[priceHistory.length-1].price)}</div>
                          </div>
                        </div>
                      </div>
                    )}

                    {!loadingDetail&&priceHistory.length===1&&(
                      <div className="ing-wf">
                        <div className="ing-wlbl"><div style={{width:6,height:6,borderRadius:'50%',background:'var(--accent)',flexShrink:0}}/>Price History</div>
                        <div style={{background:'var(--bg-surface)',border:'1px solid var(--border-subtle)',borderRadius:6,padding:'clamp(8px,.8vw,14px)',fontSize:'clamp(9px,.68vw,11px)',color:'var(--text-muted)',textAlign:'center'}}>
                          Only 1 purchase recorded — chart requires 2+ data points
                        </div>
                      </div>
                    )}

                    {!loadingDetail&&priceHistory.length===0&&(
                      <div className="ing-wf">
                        <div className="ing-wlbl"><div style={{width:6,height:6,borderRadius:'50%',background:'var(--accent)',flexShrink:0}}/>Price History</div>
                        <div style={{background:'var(--bg-surface)',border:'1px solid var(--border-subtle)',borderRadius:6,padding:'clamp(8px,.8vw,14px)',fontSize:'clamp(9px,.68vw,11px)',color:'var(--text-muted)',textAlign:'center'}}>
                          No price history yet — will appear after first purchase
                        </div>
                      </div>
                    )}

                    {!loadingDetail&&purchaseHistory.length>0&&(
                      <div className="ing-wf" style={{flex:1,minHeight:0,display:'flex',flexDirection:'column',overflow:'hidden'}}>
                        <div className="ing-wlbl"><div style={{width:6,height:6,borderRadius:'50%',background:'var(--accent)',flexShrink:0}}/>Purchase History ({purchaseHistory.length})</div>
                        <div style={{display:'grid',gridTemplateColumns:'2fr 1fr 1fr 1fr',gap:5,padding:'clamp(4px,.4vh,6px) clamp(8px,.7vw,12px)',background:'var(--bg-surface)',border:'1px solid var(--border-subtle)',borderRadius:'clamp(4px,.3vw,6px)',marginBottom:4,flexShrink:0}}>
                          {['Invoice','Supplier','Price','Date'].map(h=>(
                            <div key={h} style={{fontSize:'clamp(7px,.58vw,10px)',fontWeight:600,color:'var(--text-faint)',textTransform:'uppercase',letterSpacing:'.6px'}}>{h}</div>
                          ))}
                        </div>
                        <div style={{flex:1,overflowY:'auto',minHeight:0}}>
                          {purchaseHistory.map((p,i)=>{
                            const price=parseFloat(p.unit_cost);
                            const prev=purchaseHistory[i+1]?parseFloat(purchaseHistory[i+1].unit_cost):null;
                            const dotColor=prev===null?'var(--accent)':price>prev?'var(--color-red)':price<prev?'var(--color-green)':'var(--text-faint)';
                            return (
                              <div key={p.id||i} style={{display:'grid',gridTemplateColumns:'2fr 1fr 1fr 1fr',gap:5,padding:'clamp(5px,.5vh,8px) clamp(8px,.7vw,12px)',borderBottom:'1px solid var(--border-subtle)',alignItems:'center'}}>
                                <div style={{display:'flex',alignItems:'center',gap:6}}>
                                  <div style={{width:6,height:6,borderRadius:'50%',background:dotColor,flexShrink:0}}/>
                                  <div style={{fontSize:'clamp(9px,.65vw,11px)',color:'var(--text-primary)',fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{p.invoices?.number||'Invoice'}</div>
                                </div>
                                <div style={{fontSize:'clamp(9px,.65vw,11px)',color:'var(--text-muted)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{p.invoices?.supplier||'—'}</div>
                                <div style={{fontSize:'clamp(9px,.65vw,11px)',fontWeight:600,color:dotColor}}>{formatCurrency(p.unit_cost)}</div>
                                <div style={{fontSize:'clamp(8px,.6vw,10px)',color:'var(--text-faint)'}}>{p.invoices?.date?formatDateShort(p.invoices.date):'—'}</div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      {tourProps && <TourOverlay {...tourProps} />}
      <TourDataBanner />
    </>
  );
}