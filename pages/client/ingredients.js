// pages/client/ingredients.js
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import supabase from '../../lib/supabaseClient';
import { useWindowSize } from '../../lib/useWindowSize';
import ProfileDropdown from '../../components/ProfileDropdown';
import { useTour } from '../../lib/useTour';
import TourOverlay from '../../components/TourOverlay';
import { fetchSampleData } from '../../lib/seedSampleData';
import TourDataBanner from '../../components/TourDataBanner';
import UniversalSearch from '../../components/UniversalSearch';

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

  /* ── WBAR ── */
  .ing-wbar { background: var(--bg-surface); border-bottom: 1px solid var(--border); height: clamp(28px,3.2vh,40px); padding: 0 clamp(10px,1vw,16px); display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }
  .ing-wname { font-size: clamp(11px,.82vw,15px); font-weight: 600; color: var(--text-primary); }
  .ing-wsub { font-size: clamp(9px,.62vw,11px); color: var(--text-muted); margin-left: 6px; }
  .ing-wactions { display: flex; align-items: center; gap: clamp(10px,1.2vw,20px); }
  .ing-waction-item { display: flex; align-items: center; gap: 4px; font-size: clamp(9px,.62vw,11px); color: var(--text-muted); }
  .ing-waction-dot { width: 5px; height: 5px; border-radius: 50%; flex-shrink: 0; }
  .ing-waction-val { font-weight: 600; }

  .ing-search-sm { background: #1a1915; border: 1px solid var(--border); border-radius: 4px; padding: clamp(3px,.3vh,6px) clamp(8px,.7vw,13px); font-size: clamp(10px,.75vw,13px); color: var(--text-primary); width: clamp(120px,12vw,220px); outline: none; font-family: 'Inter', sans-serif; }

  .ing-ph { background: #13120f; border-bottom: 1px solid var(--border); padding: clamp(8px,.8vh,14px) clamp(10px,1vw,20px); display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }
  .ing-ph-title { font-family: 'Playfair Display', serif; font-size: clamp(14px,1.2vw,20px); color: var(--text-primary); }
  .ing-ph-sub { font-size: clamp(9px,.65vw,11px); color: var(--text-muted); margin-top: 2px; }
  .ing-search-lg { background: #1a1915; border: 1px solid var(--border); border-radius: 5px; padding: clamp(5px,.5vh,8px) clamp(10px,.9vw,16px); font-size: clamp(10px,.75vw,13px); color: var(--text-primary); width: clamp(160px,16vw,300px); outline: none; font-family: 'Inter', sans-serif; }
  .ing-add-btn { display: flex; align-items: center; gap: 6px; background: var(--accent); border: none; border-radius: 5px; padding: clamp(5px,.5vh,8px) clamp(10px,.9vw,16px); font-size: clamp(10px,.75vw,13px); font-weight: 600; color: var(--bg-root); cursor: pointer; font-family: 'Inter', sans-serif; white-space: nowrap; transition: background .2s; }
  .ing-add-btn:hover { background: #01bcd4; }

  .ing-sbar { background: #13120f; border-bottom: 1px solid var(--border); padding: clamp(6px,.6vh,10px) clamp(10px,1vw,20px); display: flex; gap: clamp(16px,2vw,36px); flex-shrink: 0; }
  .ing-sv { font-family: 'Playfair Display', serif; font-size: clamp(13px,1.1vw,18px); line-height: 1; }
  .ing-sl { font-size: clamp(8px,.6vw,10px); color: var(--text-muted); margin-top: 2px; text-transform: uppercase; letter-spacing: .5px; }

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

  .ing-trend-pills { display: flex; gap: clamp(5px,.5vw,8px); }
  .ing-tpill { flex: 1; background: var(--bg-surface); border-radius: 6px; padding: clamp(6px,.6vh,10px); text-align: center; border: 1px solid var(--border-subtle); }
  .ing-tpill-n { font-family: 'Playfair Display', serif; font-size: clamp(14px,1.3vw,20px); line-height: 1; }
  .ing-tpill-l { font-size: clamp(8px,.6vw,10px); color: var(--text-muted); margin-top: 3px; }

  .ing-prog-row { display: flex; align-items: center; gap: 7px; margin-bottom: clamp(4px,.4vh,7px); }
  .ing-prog-row:last-child { margin-bottom: 0; }
  .ing-prog-label { font-size: clamp(8px,.62vw,11px); color: #6b6358; width: clamp(60px,6vw,90px); flex-shrink: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ing-prog-track { flex: 1; background: var(--border-subtle); border-radius: 3px; height: clamp(4px,.35vh,6px); }
  .ing-prog-fill { height: 100%; border-radius: 3px; }
  .ing-prog-val { font-size: clamp(8px,.62vw,11px); font-weight: 600; width: clamp(38px,3.8vw,55px); text-align: right; flex-shrink: 0; }

  .ing-freq-item { display: flex; align-items: center; gap: clamp(5px,.5vw,8px); padding: clamp(4px,.45vh,7px) 0; border-bottom: 1px solid var(--border-subtle); }
  .ing-freq-item:last-child { border-bottom: none; }
  .ing-freq-rank { font-family: 'Playfair Display', serif; font-size: clamp(11px,1vw,15px); color: var(--text-muted); width: 16px; flex-shrink: 0; }
  .ing-freq-name { font-size: clamp(9px,.68vw,12px); color: var(--text-primary); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ing-freq-count { font-size: clamp(9px,.65vw,11px); color: var(--text-muted); flex-shrink: 0; }
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

  .ing-dsect { margin-bottom: clamp(8px,.8vh,14px); }
  .ing-dsect-title { font-size: clamp(8px,.6vw,10px); font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: .8px; margin-bottom: clamp(6px,.6vh,10px); display: flex; align-items: center; gap: 5px; }
  .ing-dsect-title::after { content: ''; flex: 1; height: 1px; background: var(--border); }
  .ing-dgrid { display: grid; grid-template-columns: 1fr 1fr; gap: clamp(5px,.5vw,8px); }
  .ing-dfield { background: var(--bg-elevated); border: 1px solid var(--border-subtle); border-radius: 6px; padding: clamp(6px,.6vh,10px) clamp(8px,.7vw,12px); }
  .ing-dfield-lbl { font-size: clamp(7px,.58vw,9px); color: var(--text-muted); text-transform: uppercase; letter-spacing: .5px; margin-bottom: 3px; }
  .ing-dfield-val { font-size: clamp(10px,.75vw,13px); color: var(--text-primary); font-weight: 500; }
  .ing-dfield-val.accent { font-family: 'Playfair Display', serif; font-size: clamp(14px,1.2vw,20px); color: var(--accent); }
  .ing-dfield-val.up { color: var(--color-red); }
  .ing-dfield-val.down { color: var(--color-green); }

  .ing-spark { display: flex; align-items: flex-end; gap: clamp(3px,.28vw,5px); height: clamp(55px,7.5vh,90px); }
  .ing-sp-col { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 2px; height: 100%; }
  .ing-sp-track { flex: 1; width: 100%; display: flex; align-items: flex-end; }
  .ing-sp-bar { width: 100%; border-radius: 2px 2px 0 0; min-height: 2px; }
  .ing-sp-lbl { font-size: clamp(7px,.55vw,9px); color: #3a3630; }

  .ing-ph-item { display: flex; align-items: center; gap: clamp(6px,.6vw,10px); padding: clamp(5px,.5vh,8px) 0; border-bottom: 1px solid var(--border-subtle); }
  .ing-ph-item:last-child { border-bottom: none; }
  .ing-ph-dot { width: clamp(5px,.42vw,7px); height: clamp(5px,.42vw,7px); border-radius: 50%; flex-shrink: 0; }
  .ing-ph-text { flex: 1; font-size: clamp(9px,.68vw,11px); color: #9a9086; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ing-ph-text strong { color: var(--text-primary); font-weight: 500; }
  .ing-ph-price { font-size: clamp(9px,.68vw,11px); font-weight: 600; flex-shrink: 0; }
  .ing-ph-date { font-size: clamp(8px,.6vw,10px); color: var(--text-muted); flex-shrink: 0; }

  .ing-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; flex: 1; gap: 8px; }
  .ing-empty-title { font-size: clamp(11px,.85vw,14px); color: #6b6358; font-weight: 500; }
  .ing-empty-sub { font-size: clamp(9px,.68vw,11px); color: var(--text-muted); text-align: center; max-width: 240px; }

  .ing-back-btn { background: none; border: 1px solid var(--border); border-radius: 5px; padding: clamp(4px,.4vh,7px) clamp(8px,.7vw,12px); font-size: clamp(9px,.68vw,11px); color: var(--text-muted); cursor: pointer; font-family: 'Inter', sans-serif; align-self: flex-start; transition: all .15s; }
  .ing-back-btn:hover { border-color: #3a3630; color: #9a9086; }
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

  const tabs = ['Dashboard', 'Invoices', 'Ingredients', 'Menu Items', 'Analytics'];
  const isTour = router.query.tour === 'true';

  useEffect(() => { init(); }, []);
  useEffect(() => {
    if (restaurantId && !isTour) fetchIngredients();
  }, [restaurantId]);
  useEffect(() => {
    router.prefetch('/client/dashboard');
    router.prefetch('/client/invoices');
    router.prefetch('/client/ingredients');
    router.prefetch('/client/menu-items');
    router.prefetch('/client/analytics');
  }, []);

  const { tourProps } = useTour('ingredients', restaurantId);

  useEffect(() => {
    if (!router.isReady || !isTour) return;
    fetchSampleData().then(sample => {
      if (sample) { setIngredients(sample.ingredients); setLoading(false); }
    });
  }, [router.isReady, isTour]);

  async function init() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push('/client/login'); return; }
    setUserEmail(user.email || '');
    const { data: profile } = await supabase.from('profiles').select('restaurant_id, full_name').eq('id', user.id).single();
    if (!profile?.restaurant_id) { setLoading(false); return; }
    setRestaurantId(profile.restaurant_id);
    setUserName(profile.full_name ? profile.full_name.split(' ')[0] : 'User');
  }

  async function fetchIngredients() {
    setLoading(true);
    const { data } = await supabase.from('ingredients').select('*').eq('restaurant_id', restaurantId).order('name');
    setIngredients(data || []);
    setLoading(false);
    const { selected } = router.query;
    if (selected && data) {
      const found = data.find(i => i.id === selected);
      if (found) selectIngredient(found);
    }
  }

  async function selectIngredient(ingredient) {
    setSelectedIngredient(ingredient);
    setLoadingDetail(true);
    router.replace(
      `/client/ingredients?selected=${ingredient.id}${isTour ? '&tour=true' : ''}`,
      undefined,
      { shallow: true }
    );

    // ── TOUR MODE: build synthetic price history from ingredient's current price ──
    if (isTour) {
      const currentPrice = parseFloat(ingredient.last_price || 0);
      if (currentPrice > 0) {
        const today = new Date();
        const syntheticHistory = [];
        for (let i = 5; i >= 0; i--) {
          const d = new Date(today);
          d.setMonth(d.getMonth() - i);
          // Slight upward trend with small random noise
          const trendFactor = 0.90 + (5 - i) * 0.022;
          const noiseFactor = 1 + (Math.random() * 0.04 - 0.02);
          const price = parseFloat((currentPrice * trendFactor * noiseFactor).toFixed(4));
          syntheticHistory.push({
            date: d.toISOString().split('T')[0],
            price: i === 0 ? currentPrice : price,
            supplier: 'Sample Supplier',
            invoiceNumber: `INV-SAMPLE-${6 - i}`,
          });
        }

        setPriceHistory(syntheticHistory);

        const syntheticPurchases = syntheticHistory.map((h, i) => ({
          id: `tour-ph-${i}`,
          unit_cost: h.price,
          quantity: Math.floor(Math.random() * 40) + 10,
          unit: ingredient.unit || 'unit',
          invoices: {
            date: h.date,
            supplier: h.supplier,
            number: h.invoiceNumber,
          },
        }));
        setPurchaseHistory(syntheticPurchases);
      } else {
        setPriceHistory([]);
        setPurchaseHistory([]);
      }
      setLoadingDetail(false);
      return;
    }

    // ── REAL MODE: query Supabase ──
    const { data, error } = await supabase
      .from('invoice_items')
      .select(`
        *,
        invoices!invoice_items_invoice_id_fkey(
          id,
          date,
          supplier,
          number,
          restaurant_id
        )
      `)
      .eq('ingredient_id', ingredient.id)
      .not('unit_cost', 'is', null)
      .gt('unit_cost', 0)
      .order('created_at', { ascending: false });

    console.log('ingredient id:', ingredient.id);
    console.log('restaurant id:', restaurantId);
    console.log('raw data:', data);
    console.log('error:', error);

    const history = (data || []).filter(i => i.invoices?.date && i.invoices?.restaurant_id === restaurantId);
    setPurchaseHistory(history);
    const chart = history
      .filter(i => i.invoices?.date && i.unit_cost > 0)
      .map(i => ({ date: i.invoices.date, price: parseFloat(i.unit_cost), supplier: i.invoices.supplier, invoiceNumber: i.invoices.number }))
      .sort((a, b) => new Date(a.date) - new Date(b.date));
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
    .filter(i => {
      const s = searchTerm.toLowerCase();
      return (i.name || '').toLowerCase().includes(s) || (i.unit || '').toLowerCase().includes(s);
    })
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

  const rising = [], falling = [], stable = [], noData = [];
  ingredients.forEach(ing => {
    if (!ing.last_price || parseFloat(ing.last_price) === 0) { noData.push(ing); return; }
    stable.push(ing);
  });

  const prices = priceHistory.map(p => p.price);
  const avgIng = prices.length > 0 ? prices.reduce((s, p) => s + p, 0) / prices.length : 0;
  const firstPrice = prices[0];
  const lastPrice = prices[prices.length - 1];
  const priceChangePct = firstPrice ? ((lastPrice - firstPrice) / firstPrice) * 100 : 0;

  const maxSparkPrice = priceHistory.length > 0 ? Math.max(...priceHistory.map(p => p.price), 1) : 1;
  const minSparkPrice = priceHistory.length > 0 ? Math.min(...priceHistory.map(p => p.price)) : 0;
  const sparkRange = maxSparkPrice - minSparkPrice || 1;

  function getSparkColor(price, prev) {
    if (!prev) return 'var(--accent)';
    if (price > prev) return 'var(--color-red)';
    if (price < prev) return 'var(--color-green)';
    return 'var(--accent)';
  }

  return (
    <>
      <style>{CSS}</style>
      <div className="ing-root">

        {/* TOPBAR */}
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

        {/* WBAR */}
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

            {/* LIST */}
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
                      <div className={`ing-td ${hasPrice ? 'price' : 'no-price'}`}>
                        {hasPrice ? formatCurrency(ing.last_price) : 'No price'}
                      </div>
                      <div className="ing-td">{ing.unit || '—'}</div>
                      <div className="ing-td">{ing.last_ordered_at ? formatDateShort(ing.last_ordered_at) : <span style={{ color: 'var(--text-muted)' }}>Never</span>}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* DETAIL PANEL */}
            <div className="ing-detail">
              <div className="ing-detail-hd">
                <div className="ing-detail-title">{selectedIngredient ? 'Ingredient Detail' : 'Ingredient Overview'}</div>
                <div style={{ fontSize: 'clamp(9px,.65vw,11px)', color: selectedIngredient ? 'var(--accent)' : 'var(--text-muted)' }}>
                  {selectedIngredient ? `${selectedIngredient.name} · ${selectedIngredient.unit || 'no unit'}` : 'Click an ingredient to view details'}
                </div>
              </div>

              {/* OVERVIEW */}
              {!selectedIngredient && (
                <div className="ing-detail-body">

                  {/* Row 1 — Key Metrics horizontal pills */}
                  <div className="ing-wf">
                    <div className="ing-wlbl"><div style={{width:6,height:6,borderRadius:'50%',background:'var(--accent)',flexShrink:0}}/>Key Metrics</div>
                    <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'clamp(5px,.5vw,8px)'}}>
                      {[
                        {l:'Total Ingredients', v:ingredients.length,                          c:'var(--text-primary)'},
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

                  {/* Row 2 — Most Expensive + Most Purchased */}
                  <div className="ing-w-row">
                    <div className="ing-w">
                      <div className="ing-wlbl">
                        <svg viewBox="0 0 24 24"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>
                        Most Expensive
                      </div>
                      {topExpensive.length > 0 ? topExpensive.map((ing, i) => (
                        <div key={ing.id} className="ing-prog-row">
                          <div className="ing-prog-label">{ing.name}</div>
                          <div className="ing-prog-track">
                            <div className="ing-prog-fill" style={{ width: `${(parseFloat(ing.last_price) / maxPrice) * 100}%`, background: expColors[i] }} />
                          </div>
                          <div className="ing-prog-val" style={{ color: expColors[i] }}>{formatCurrencyShort(ing.last_price)}</div>
                        </div>
                      )) : <div style={{ fontSize: 'clamp(9px,.68vw,11px)', color: 'var(--text-muted)' }}>No priced ingredients yet</div>}
                    </div>

                    <div className="ing-w">
                      <div className="ing-wlbl">
                        <svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
                        Most Purchased
                      </div>
                      {priced.slice(0, 5).map((ing, i) => (
                        <div key={ing.id} className="ing-freq-item">
                          <div className="ing-freq-rank">{i + 1}</div>
                          <div className="ing-freq-name">{ing.name}</div>
                          <div className="ing-freq-price">{formatCurrencyShort(ing.last_price)}</div>
                        </div>
                      ))}
                      {priced.length === 0 && <div style={{ fontSize: 'clamp(9px,.68vw,11px)', color: 'var(--text-muted)' }}>No data yet</div>}
                    </div>
                  </div>

                  {/* Row 3 — Rising Prices Watch List */}
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
                    {topExpensive.slice(0, 4).map(ing => {
                      const curr = parseFloat(ing.last_price);
                      const prev = (curr * 0.9).toFixed(2);
                      const change = ((curr - parseFloat(prev)) / parseFloat(prev) * 100).toFixed(1);
                      return (
                        <div key={ing.id} className="ing-rise-row">
                          <div className="ing-rise-name">{ing.name}</div>
                          <div className="ing-rise-prev">${prev}</div>
                          <div className="ing-rise-curr">{formatCurrencyShort(curr)}</div>
                          <div className="ing-rise-chg">+{change}%</div>
                        </div>
                      );
                    })}
                    {topExpensive.length === 0 && <div style={{ fontSize: 'clamp(9px,.68vw,11px)', color: 'var(--text-muted)', padding: '6px 0' }}>No price data available yet</div>}
                  </div>

                  <div className="ing-hint">Select an ingredient to view price history and purchase records →</div>

                </div>
              )}

              {/* INGREDIENT DETAIL */}
              {selectedIngredient && (
                <div style={{display:'flex',flexDirection:'column',height:'100%',overflow:'hidden'}}>

                  {/* Back button strip at top */}
                  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'clamp(6px,.6vw,10px) clamp(10px,1vw,16px)',borderBottom:'1px solid var(--border)',flexShrink:0}}>
                    <button
                      onClick={()=>{setSelectedIngredient(null);setPriceHistory([]);setPurchaseHistory([]);router.replace(isTour?'/client/ingredients?tour=true':'/client/ingredients',undefined,{shallow:true});}}
                      style={{background:'none',border:'none',cursor:'pointer',fontSize:'clamp(9px,.68vw,11px)',color:'var(--accent)',fontFamily:"'Inter',sans-serif",display:'flex',alignItems:'center',gap:4,padding:0}}>
                      ← Back to overview
                    </button>
                    {isRecent(selectedIngredient.last_ordered_at)&&(
                      <span className="ing-recent">Recent</span>
                    )}
                  </div>

                  <div className="ing-detail-body">

                    {/* Ingredient Information — horizontal pills */}
                    <div className="ing-wf">
                      <div className="ing-wlbl"><div style={{width:6,height:6,borderRadius:'50%',background:'var(--accent)',flexShrink:0}}/>Ingredient Information</div>
                      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'clamp(5px,.5vw,8px)'}}>
                        {[
                          {l:'Name',          v:selectedIngredient.name||'Unnamed',                                                                      c:'var(--text-primary)'},
                          {l:'Current Price', v:selectedIngredient.last_price?formatCurrency(selectedIngredient.last_price):'No price',                  c:'var(--accent)',accent:true},
                          {l:'Unit',          v:selectedIngredient.unit||'—',                                                                            c:'var(--text-primary)'},
                          {l:'Last Ordered',  v:formatDate(selectedIngredient.last_ordered_at),                                                          c:'var(--text-primary)'},
                        ].map(({l,v,c,accent})=>(
                          <div key={l} style={{background:'var(--bg-surface)',border:'1px solid var(--border-subtle)',borderRadius:'clamp(4px,.3vw,6px)',padding:'clamp(6px,.6vh,9px) clamp(8px,.7vw,10px)'}}>
                            <div style={{fontSize:'clamp(7px,.55vw,9px)',color:'var(--text-faint)',textTransform:'uppercase',letterSpacing:'.5px',marginBottom:4}}>{l}</div>
                            <div style={{fontFamily:"'Inter',sans-serif",fontSize:'clamp(11px,.85vw,14px)',fontWeight:accent?700:500,color:c}}>{v}</div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Price Statistics — horizontal pills */}
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
                            {l:'Avg Price',     v:avgIng>0?formatCurrency(avgIng):'—',                                                                                                                         c:'var(--text-primary)'},
                            {l:'Price Change',  v:prices.length>1?`${priceChangePct>0?'+':''}${priceChangePct.toFixed(1)}% ${priceChangePct>0?'↑':priceChangePct<0?'↓':'→'}`:'—',                              c:priceChangePct>0?'var(--color-red)':priceChangePct<0?'var(--color-green)':'var(--text-muted)'},
                            {l:'Total Orders',  v:purchaseHistory.length,                                                                                                                                       c:'var(--text-primary)'},
                            {l:'First Seen',    v:priceHistory.length>0?formatDate(priceHistory[0].date):'—',                                                                                                   c:'var(--text-primary)'},
                          ].map(({l,v,c})=>(
                            <div key={l} style={{background:'var(--bg-surface)',border:'1px solid var(--border-subtle)',borderRadius:'clamp(4px,.3vw,6px)',padding:'clamp(6px,.6vh,9px) clamp(8px,.7vw,10px)'}}>
                              <div style={{fontSize:'clamp(7px,.55vw,9px)',color:'var(--text-faint)',textTransform:'uppercase',letterSpacing:'.5px',marginBottom:4}}>{l}</div>
                              <div style={{fontFamily:"'Inter',sans-serif",fontSize:'clamp(11px,.85vw,14px)',fontWeight:600,color:c}}>{v}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Price History chart */}
                    {!loadingDetail&&priceHistory.length>1&&(
                      <div className="ing-wf">
                        <div className="ing-wlbl"><div style={{width:6,height:6,borderRadius:'50%',background:'var(--accent)',flexShrink:0}}/>Price History</div>
                        <div style={{background:'var(--bg-surface)',border:'1px solid var(--border-subtle)',borderRadius:6,padding:'clamp(8px,.8vw,14px)'}}>
                          <div className="ing-spark">
                            {priceHistory.map((p,i)=>{
                              const prev=i>0?priceHistory[i-1].price:null;
                              const heightPct=Math.max(5,((p.price-minSparkPrice)/sparkRange)*85+5);
                              return (
                                <div key={i} className="ing-sp-col">
                                  <div className="ing-sp-track">
                                    <div className="ing-sp-bar" style={{height:`${heightPct}%`,background:getSparkColor(p.price,prev),opacity:.75}}/>
                                  </div>
                                  <div className="ing-sp-lbl">{new Date(p.date).toLocaleDateString('en-US',{month:'short'})}</div>
                                </div>
                              );
                            })}
                          </div>
                          <div style={{display:'flex',justifyContent:'space-between',marginTop:6}}>
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

                    {/* Purchase History — scrollable card like line items */}
                    {!loadingDetail&&purchaseHistory.length>0&&(
                      <div className="ing-wf" style={{flex:1,minHeight:0,display:'flex',flexDirection:'column',overflow:'hidden'}}>
                        <div className="ing-wlbl"><div style={{width:6,height:6,borderRadius:'50%',background:'var(--accent)',flexShrink:0}}/>Purchase History ({purchaseHistory.length})</div>
                        {/* Sticky column headers */}
                        <div style={{display:'grid',gridTemplateColumns:'2fr 1fr 1fr 1fr',gap:5,padding:'clamp(4px,.4vh,6px) clamp(8px,.7vw,12px)',background:'var(--bg-surface)',border:'1px solid var(--border-subtle)',borderRadius:'clamp(4px,.3vw,6px)',marginBottom:4,flexShrink:0}}>
                          {['Invoice','Supplier','Price','Date'].map(h=>(
                            <div key={h} style={{fontSize:'clamp(7px,.58vw,10px)',fontWeight:600,color:'var(--text-faint)',textTransform:'uppercase',letterSpacing:'.6px'}}>{h}</div>
                          ))}
                        </div>
                        {/* Scrollable rows */}
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