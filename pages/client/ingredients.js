// pages/client/ingredients.js
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import supabase from '../../lib/supabaseClient';
import { useWindowSize } from '../../lib/useWindowSize';
import ProfileDropdown from '../../components/ProfileDropdown';

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

function getUserInitials(name) {
  if (!name) return 'U';
  return name.split(' ').map(p => p.charAt(0)).join('').substring(0, 2).toUpperCase();
}

function isRecent(dateStr) {
  if (!dateStr) return false;
  return new Date(dateStr) > new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
}

// ─── CSS ─────────────────────────────────────────────────────────────────────

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400&family=Inter:wght@400;500;600&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { height: 100%; background: #0a0908; overflow: hidden; }
  #__next { height: 100%; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes blink { 0%,100%{opacity:1} 50%{opacity:.3} }
  input::placeholder { color: #3a3630 !important; }
  ::-webkit-scrollbar { width: 3px; }
  ::-webkit-scrollbar-track { background: #0f0e0c; }
  ::-webkit-scrollbar-thumb { background: #2a2620; border-radius: 2px; }

  .ing-root {
    font-family: 'Inter', sans-serif;
    background: #0a0908;
    color: #e8e2d8;
    width: 100%;
    height: 100vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* NAV */
  .ing-nav { background: #0f0e0c; border-bottom: 1px solid #2a2620; height: clamp(36px,4vh,52px); padding: 0 clamp(10px,1vw,20px); display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }
  .ing-logo { font-family: 'Playfair Display', serif; font-size: clamp(13px,1.1vw,18px); color: #e8e2d8; letter-spacing: -.3px; }
  .ing-logo span { color: #02a4ba; }
  .ing-tab { padding: clamp(2px,.3vh,4px) clamp(6px,.6vw,11px); border-radius: 4px; font-size: clamp(10px,.75vw,13px); color: #4a453e; border: none; background: none; cursor: pointer; font-family: 'Inter', sans-serif; transition: all .15s; }
  .ing-tab.active { color: #e8e2d8; background: #1a1915; }
  .ing-search-sm { background: #1a1915; border: 1px solid #2a2620; border-radius: 4px; padding: clamp(3px,.3vh,6px) clamp(8px,.7vw,13px); font-size: clamp(10px,.75vw,13px); color: #e8e2d8; width: clamp(120px,12vw,220px); outline: none; font-family: 'Inter', sans-serif; }
  .ing-avatar { width: clamp(22px,1.8vw,30px); height: clamp(22px,1.8vw,30px); border-radius: 50%; background: #02a4ba; display: flex; align-items: center; justify-content: center; font-size: clamp(8px,.65vw,11px); font-weight: 700; color: #0a0908; flex-shrink: 0; cursor: pointer; }

  /* PAGE HEADER */
  .ing-ph { background: #13120f; border-bottom: 1px solid #2a2620; padding: clamp(8px,.8vh,14px) clamp(10px,1vw,20px); display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }
  .ing-ph-title { font-family: 'Playfair Display', serif; font-size: clamp(14px,1.2vw,20px); color: #e8e2d8; }
  .ing-ph-sub { font-size: clamp(9px,.65vw,11px); color: #4a453e; margin-top: 2px; }
  .ing-search-lg { background: #1a1915; border: 1px solid #2a2620; border-radius: 5px; padding: clamp(5px,.5vh,8px) clamp(10px,.9vw,16px); font-size: clamp(10px,.75vw,13px); color: #e8e2d8; width: clamp(160px,16vw,300px); outline: none; font-family: 'Inter', sans-serif; }
  .ing-add-btn { display: flex; align-items: center; gap: 6px; background: #02a4ba; border: none; border-radius: 5px; padding: clamp(5px,.5vh,8px) clamp(10px,.9vw,16px); font-size: clamp(10px,.75vw,13px); font-weight: 600; color: #0a0908; cursor: pointer; font-family: 'Inter', sans-serif; white-space: nowrap; transition: background .2s; }
  .ing-add-btn:hover { background: #01bcd4; }

  /* STATS BAR */
  .ing-sbar { background: #13120f; border-bottom: 1px solid #2a2620; padding: clamp(6px,.6vh,10px) clamp(10px,1vw,20px); display: flex; gap: clamp(16px,2vw,36px); flex-shrink: 0; }
  .ing-sv { font-family: 'Playfair Display', serif; font-size: clamp(13px,1.1vw,18px); line-height: 1; }
  .ing-sl { font-size: clamp(8px,.6vw,10px); color: #4a453e; margin-top: 2px; text-transform: uppercase; letter-spacing: .5px; }

  /* SPLIT */
  .ing-split { display: flex; gap: clamp(6px,.6vw,10px); padding: clamp(6px,.6vw,10px); flex: 1; min-height: 0; overflow: hidden; }

  /* LIST PANEL */
  .ing-list { width: 55%; background: #13120f; border: 1px solid #2a2620; border-radius: 8px; display: flex; flex-direction: column; overflow: hidden; }
  .ing-list-hd { padding: clamp(8px,.8vh,14px) clamp(10px,1vw,18px); border-bottom: 1px solid #2a2620; flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; }
  .ing-list-title { font-size: clamp(10px,.78vw,13px); font-weight: 600; color: #e8e2d8; }
  .ing-list-count { font-size: clamp(9px,.65vw,11px); color: #4a453e; background: #0f0e0c; border: 1px solid #2a2620; border-radius: 10px; padding: 1px 8px; }

  .ing-tbl-head { display: grid; grid-template-columns: 2fr 1.2fr .8fr 1.2fr; gap: 8px; padding: clamp(6px,.6vh,10px) clamp(10px,1vw,18px); background: #0f0e0c; border-bottom: 1px solid #2a2620; flex-shrink: 0; }
  .ing-th { font-size: clamp(8px,.62vw,10px); font-weight: 600; color: #4a453e; text-transform: uppercase; letter-spacing: .8px; cursor: pointer; display: flex; align-items: center; gap: 3px; user-select: none; }
  .ing-th:hover { color: #9a9086; }
  .ing-th.active { color: #02a4ba; }

  .ing-tbl-body { flex: 1; overflow-y: auto; }
  .ing-row { display: grid; grid-template-columns: 2fr 1.2fr .8fr 1.2fr; gap: 8px; padding: clamp(7px,.7vh,12px) clamp(10px,1vw,18px); border-bottom: 1px solid #1a1915; cursor: pointer; transition: background .15s; align-items: center; border-left: 2px solid transparent; }
  .ing-row:hover { background: #1a1915; }
  .ing-row.selected { background: rgba(2,164,186,.08); border-left-color: #02a4ba; }
  .ing-td { font-size: clamp(10px,.75vw,12px); color: #9a9086; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ing-td.name { color: #e8e2d8; font-weight: 500; display: flex; align-items: center; gap: 5px; }
  .ing-td.price { color: #02a4ba; font-weight: 600; }
  .ing-td.no-price { color: #4a453e; font-style: italic; }
  .ing-recent { font-size: clamp(7px,.55vw,9px); padding: 1px 5px; border-radius: 6px; background: rgba(42,138,90,.1); color: #2a8a5a; flex-shrink: 0; }

  /* DETAIL PANEL */
  .ing-detail { flex: 1; background: #13120f; border: 1px solid #2a2620; border-radius: 8px; display: flex; flex-direction: column; overflow: hidden; }
  .ing-detail-hd { padding: clamp(8px,.8vh,14px) clamp(10px,1vw,18px); border-bottom: 1px solid #2a2620; flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; }
  .ing-detail-title { font-size: clamp(10px,.78vw,13px); font-weight: 600; color: #e8e2d8; }
  .ing-detail-body { flex: 1; overflow-y: auto; padding: clamp(10px,1vw,16px); display: flex; flex-direction: column; gap: clamp(8px,.8vh,12px); }

  /* OVERVIEW WIDGETS */
  .ing-w-row { display: grid; grid-template-columns: 1fr 1fr; gap: clamp(6px,.6vw,10px); }
  .ing-w { background: #0f0e0c; border: 1px solid #2a2620; border-radius: 7px; padding: clamp(8px,.8vw,14px); }
  .ing-wf { background: #0f0e0c; border: 1px solid #2a2620; border-radius: 7px; padding: clamp(8px,.8vw,14px); }
  .ing-wlbl { font-size: clamp(8px,.6vw,10px); font-weight: 600; color: #4a453e; text-transform: uppercase; letter-spacing: .8px; margin-bottom: clamp(6px,.6vh,10px); display: flex; align-items: center; gap: 4px; }
  .ing-wlbl svg { width: 10px; height: 10px; stroke: #02a4ba; fill: none; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }

  /* Trend pills */
  .ing-trend-pills { display: flex; gap: clamp(5px,.5vw,8px); }
  .ing-tpill { flex: 1; background: #0a0908; border-radius: 6px; padding: clamp(6px,.6vh,10px); text-align: center; border: 1px solid #1a1915; }
  .ing-tpill-n { font-family: 'Playfair Display', serif; font-size: clamp(14px,1.3vw,20px); line-height: 1; }
  .ing-tpill-l { font-size: clamp(8px,.6vw,10px); color: #4a453e; margin-top: 3px; }

  /* Progress bars */
  .ing-prog-row { display: flex; align-items: center; gap: 7px; margin-bottom: clamp(4px,.4vh,7px); }
  .ing-prog-row:last-child { margin-bottom: 0; }
  .ing-prog-label { font-size: clamp(8px,.62vw,11px); color: #6b6358; width: clamp(60px,6vw,90px); flex-shrink: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ing-prog-track { flex: 1; background: #1a1915; border-radius: 3px; height: clamp(4px,.35vh,6px); }
  .ing-prog-fill { height: 100%; border-radius: 3px; }
  .ing-prog-val { font-size: clamp(8px,.62vw,11px); font-weight: 600; width: clamp(38px,3.8vw,55px); text-align: right; flex-shrink: 0; }

  /* Freq list */
  .ing-freq-item { display: flex; align-items: center; gap: clamp(5px,.5vw,8px); padding: clamp(4px,.45vh,7px) 0; border-bottom: 1px solid #1a1915; }
  .ing-freq-item:last-child { border-bottom: none; }
  .ing-freq-rank { font-family: 'Playfair Display', serif; font-size: clamp(11px,1vw,15px); color: #4a453e; width: 16px; flex-shrink: 0; }
  .ing-freq-name { font-size: clamp(9px,.68vw,12px); color: #e8e2d8; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ing-freq-count { font-size: clamp(9px,.65vw,11px); color: #4a453e; flex-shrink: 0; }
  .ing-freq-price { font-size: clamp(9px,.65vw,11px); color: #02a4ba; font-weight: 600; flex-shrink: 0; margin-left: 6px; }

  /* Rising prices table */
  .ing-rise-head { display: grid; grid-template-columns: 2fr 1fr 1fr 1fr; gap: 6px; padding: clamp(4px,.4vh,6px) 0; border-bottom: 1px solid #1a1915; margin-bottom: 4px; }
  .ing-rise-th { font-size: clamp(7px,.58vw,9px); color: #4a453e; text-transform: uppercase; letter-spacing: .6px; }
  .ing-rise-row { display: grid; grid-template-columns: 2fr 1fr 1fr 1fr; gap: 6px; padding: clamp(5px,.5vh,8px) 0; border-bottom: 1px solid #1a1915; align-items: center; }
  .ing-rise-row:last-child { border-bottom: none; }
  .ing-rise-name { font-size: clamp(10px,.75vw,12px); color: #e8e2d8; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ing-rise-prev { font-size: clamp(10px,.75vw,12px); color: #6b6358; }
  .ing-rise-curr { font-size: clamp(10px,.75vw,12px); color: #02a4ba; font-weight: 600; }
  .ing-rise-chg { font-size: clamp(10px,.75vw,12px); color: #c04040; font-weight: 600; }
  .ing-rise-chg.down { color: #2a8a5a; }

  /* Hint */
  .ing-hint { font-size: clamp(8px,.62vw,10px); color: #3a3630; text-align: center; padding: clamp(4px,.4vh,7px); border: 1px dashed #2a2620; border-radius: 6px; }

  /* DETAIL VIEW */
  .ing-dsect { margin-bottom: clamp(8px,.8vh,14px); }
  .ing-dsect-title { font-size: clamp(8px,.6vw,10px); font-weight: 600; color: #4a453e; text-transform: uppercase; letter-spacing: .8px; margin-bottom: clamp(6px,.6vh,10px); display: flex; align-items: center; gap: 5px; }
  .ing-dsect-title::after { content: ''; flex: 1; height: 1px; background: #2a2620; }
  .ing-dgrid { display: grid; grid-template-columns: 1fr 1fr; gap: clamp(5px,.5vw,8px); }
  .ing-dfield { background: #0f0e0c; border: 1px solid #1a1915; border-radius: 6px; padding: clamp(6px,.6vh,10px) clamp(8px,.7vw,12px); }
  .ing-dfield-lbl { font-size: clamp(7px,.58vw,9px); color: #4a453e; text-transform: uppercase; letter-spacing: .5px; margin-bottom: 3px; }
  .ing-dfield-val { font-size: clamp(10px,.75vw,13px); color: #e8e2d8; font-weight: 500; }
  .ing-dfield-val.accent { font-family: 'Playfair Display', serif; font-size: clamp(14px,1.2vw,20px); color: #02a4ba; }
  .ing-dfield-val.up { color: #c04040; }
  .ing-dfield-val.down { color: #2a8a5a; }

  /* Sparkline */
  .ing-spark { display: flex; align-items: flex-end; gap: clamp(3px,.28vw,5px); height: clamp(55px,7.5vh,90px); }
  .ing-sp-col { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 2px; height: 100%; }
  .ing-sp-track { flex: 1; width: 100%; display: flex; align-items: flex-end; }
  .ing-sp-bar { width: 100%; border-radius: 2px 2px 0 0; min-height: 2px; }
  .ing-sp-lbl { font-size: clamp(7px,.55vw,9px); color: #3a3630; }

  /* Purchase history */
  .ing-ph-item { display: flex; align-items: center; gap: clamp(6px,.6vw,10px); padding: clamp(5px,.5vh,8px) 0; border-bottom: 1px solid #1a1915; }
  .ing-ph-item:last-child { border-bottom: none; }
  .ing-ph-dot { width: clamp(5px,.42vw,7px); height: clamp(5px,.42vw,7px); border-radius: 50%; flex-shrink: 0; }
  .ing-ph-text { flex: 1; font-size: clamp(9px,.68vw,11px); color: #9a9086; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ing-ph-text strong { color: #e8e2d8; font-weight: 500; }
  .ing-ph-price { font-size: clamp(9px,.68vw,11px); font-weight: 600; flex-shrink: 0; }
  .ing-ph-date { font-size: clamp(8px,.6vw,10px); color: #4a453e; flex-shrink: 0; }

  /* Empty */
  .ing-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; flex: 1; gap: 8px; }
  .ing-empty-title { font-size: clamp(11px,.85vw,14px); color: #6b6358; font-weight: 500; }
  .ing-empty-sub { font-size: clamp(9px,.68vw,11px); color: #4a453e; text-align: center; max-width: 240px; }

  /* Back btn */
  .ing-back-btn { background: none; border: 1px solid #2a2620; border-radius: 5px; padding: clamp(4px,.4vh,7px) clamp(8px,.7vw,12px); font-size: clamp(9px,.68vw,11px); color: #4a453e; cursor: pointer; font-family: 'Inter', sans-serif; align-self: flex-start; transition: all .15s; }
  .ing-back-btn:hover { border-color: #3a3630; color: #9a9086; }
`;

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ClientIngredients() {
  const router = useRouter();
  const { isMobile } = useWindowSize();

  const [ingredients, setIngredients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [restaurantId, setRestaurantId] = useState(null);
  const [userName, setUserName] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState('name');
  const [sortOrder, setSortOrder] = useState('asc');
  const [selectedIngredient, setSelectedIngredient] = useState(null);
  const [priceHistory, setPriceHistory] = useState([]);
  const [purchaseHistory, setPurchaseHistory] = useState([]);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const tabs = ['Dashboard', 'Invoices', 'Ingredients', 'Menu Items'];

  useEffect(() => { init(); }, []);
  useEffect(() => { if (restaurantId) fetchIngredients(); }, [restaurantId]);
  useEffect(() => {
    router.prefetch('/client/dashboard');
    router.prefetch('/client/invoices');
    router.prefetch('/client/ingredients');
    router.prefetch('/client/menu-items');
  }, []);

  async function init() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push('/client/login'); return; }
    const { data: profile } = await supabase.from('profiles').select('restaurant_id, full_name').eq('id', user.id).single();
    if (!profile?.restaurant_id) return;
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
    router.replace(`/client/ingredients?selected=${ingredient.id}`, undefined, { shallow: true });
    const { data } = await supabase
      .from('invoice_items')
      .select('*, invoices(date, supplier, number)')
      .eq('ingredient_id', ingredient.id)
      .not('invoices.date', 'is', null)
      .order('created_at', { ascending: false });

    const history = data || [];
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

  // ── Overview data ──
  const priced = ingredients.filter(i => i.last_price && parseFloat(i.last_price) > 0);
  const unpriced = ingredients.filter(i => !i.last_price || parseFloat(i.last_price) === 0);
  const avgPrice = priced.length > 0 ? priced.reduce((s, i) => s + parseFloat(i.last_price), 0) / priced.length : 0;
  const highest = priced.length > 0 ? Math.max(...priced.map(i => parseFloat(i.last_price))) : 0;

  const topExpensive = [...priced].sort((a, b) => parseFloat(b.last_price) - parseFloat(a.last_price)).slice(0, 5);
  const maxPrice = topExpensive[0] ? parseFloat(topExpensive[0].last_price) : 1;
  const expColors = ['#c04040', '#d4a020', '#d4a020', '#02a4ba', '#02a4ba'];

  // ── Price trend calc (compare last two purchases per ingredient) ──
  const rising = [], falling = [], stable = [], noData = [];
  ingredients.forEach(ing => {
    if (!ing.last_price || parseFloat(ing.last_price) === 0) { noData.push(ing); return; }
    // Without full history per ingredient in this query, we approximate stable
    stable.push(ing);
  });

  // ── Sparkline bars for selected ingredient ──
  const maxSparkPrice = priceHistory.length > 0 ? Math.max(...priceHistory.map(p => p.price), 1) : 1;
  const minSparkPrice = priceHistory.length > 0 ? Math.min(...priceHistory.map(p => p.price)) : 0;
  const sparkRange = maxSparkPrice - minSparkPrice || 1;

  function getSparkColor(price, prev) {
    if (!prev) return '#02a4ba';
    if (price > prev) return '#c04040';
    if (price < prev) return '#2a8a5a';
    return '#02a4ba';
  }

  function getPriceChangeColor(change) {
    if (change > 0) return '#c04040';
    if (change < 0) return '#2a8a5a';
    return '#9a9086';
  }

  // ── Stats for selected ingredient ──
  const prices = priceHistory.map(p => p.price);
  const avgIng = prices.length > 0 ? prices.reduce((s, p) => s + p, 0) / prices.length : 0;
  const firstPrice = prices[0];
  const lastPrice = prices[prices.length - 1];
  const priceChangePct = firstPrice ? ((lastPrice - firstPrice) / firstPrice) * 100 : 0;



// ── PASTE THIS BLOCK INTO ingredients.js IMMEDIATELY BEFORE the desktop return ──
// Find: return ( <> <style>{CSS}</style> <div className="ing-root">
// Paste this entire block above it.

  if (isMobile) {
    const navItems = [
      { label: 'Dashboard', path: '/client/dashboard', icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg> },
      { label: 'Invoices', path: '/client/invoices', icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> },
      { label: 'Ingredients', path: '/client/ingredients', icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 8h1a4 4 0 010 8h-1"/><path d="M3 8h14v9a4 4 0 01-4 4H7a4 4 0 01-4-4V8z"/></svg> },
      { label: 'Menu', path: '/client/menu-items', icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg> },
    ];

    return (
      <>
        <style>{CSS}</style>
        <div className="mob-root" style={{ position: 'relative' }}>

          {/* Header */}
          <div className="mob-header">
            <div className="mob-logo">Opti<span>Menu</span></div>
            <ProfileDropdown userName={userName} userEmail={userEmail} isMobile={isMobile} />
          </div>

          {/* Title bar */}
          <div className="mob-titlebar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div className="mob-page-title">Ingredients</div>
              <div className="mob-page-sub">Monitor costs and price trends</div>
            </div>
            <button className="mob-add-btn">+ Add</button>
          </div>

          {/* Stats */}
          <div className="mob-stats">
            {[
              { v: ingredients.length, l: 'Total', c: '#02a4ba' },
              { v: unpriced.length, l: 'Unpriced', c: '#c04040' },
              { v: priced.length, l: 'Priced', c: '#2a8a5a' },
              { v: highest > 0 ? formatCurrencyShort(highest) : '—', l: 'Highest', c: '#d4a020' },
              { v: avgPrice > 0 ? formatCurrencyShort(avgPrice) : '—', l: 'Avg Price', c: '#e8e2d8' },
            ].map(({ v, l, c }) => (
              <div key={l} className="mob-stat">
                <div className="mob-stat-v" style={{ color: c }}>{v}</div>
                <div className="mob-stat-l">{l}</div>
              </div>
            ))}
          </div>

          {/* Search */}
          <div className="mob-search-bar">
            <input className="mob-search-input" placeholder="Search by name or unit..."
              value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
          </div>

          {/* List header */}
          <div className="mob-list-head" style={{ gridTemplateColumns: '2fr 1.2fr .8fr 1.2fr' }}>
            <div className="mob-list-th">Name</div>
            <div className="mob-list-th">Price</div>
            <div className="mob-list-th">Unit</div>
            <div className="mob-list-th">Last Order</div>
          </div>

          {/* List */}
          {loading ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 10 }}>
              <div style={{ width: 22, height: 22, border: '2px solid #2a2620', borderTopColor: '#02a4ba', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
              <div style={{ fontSize: 12, color: '#4a453e' }}>Loading ingredients...</div>
            </div>
          ) : (
            <div className="mob-list-body">
              {filtered.length === 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 40, gap: 8 }}>
                  <div style={{ fontSize: 13, color: '#6b6358', fontWeight: 500 }}>{searchTerm ? `No results for "${searchTerm}"` : 'No ingredients yet'}</div>
                </div>
              ) : filtered.map(ing => {
                const hasPrice = ing.last_price && parseFloat(ing.last_price) > 0;
                const recent = isRecent(ing.last_ordered_at);
                return (
                  <div key={ing.id}
                    className={`mob-list-row${selectedIngredient?.id === ing.id ? ' selected' : ''}`}
                    style={{ gridTemplateColumns: '2fr 1.2fr .8fr 1.2fr' }}
                    onClick={() => selectIngredient(ing)}>
                    <div>
                      <div className="mob-td primary">{ing.name || 'Unnamed'}</div>
                      {recent && <span style={{ fontSize: 9, background: 'rgba(42,138,90,.1)', color: '#2a8a5a', padding: '1px 5px', borderRadius: 5, marginTop: 2, display: 'inline-block' }}>Recent</span>}
                    </div>
                    <div className={`mob-td${hasPrice ? ' amount' : ''}`} style={!hasPrice ? { color: '#4a453e', fontStyle: 'italic' } : {}}>
                      {hasPrice ? formatCurrency(ing.last_price) : 'No price'}
                    </div>
                    <div className="mob-td">{ing.unit || '—'}</div>
                    <div className="mob-td">{ing.last_ordered_at ? formatDateShort(ing.last_ordered_at) : <span style={{ color: '#4a453e' }}>Never</span>}</div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Detail overlay */}
          {selectedIngredient && (
            <div className="mob-detail-overlay">
              <div className="mob-detail-hd">
                <button className="mob-back-btn" onClick={() => { setSelectedIngredient(null); setPriceHistory([]); setPurchaseHistory([]); router.replace('/client/ingredients', undefined, { shallow: true }); }}>← Back</button>
                <div className="mob-detail-title">{selectedIngredient.name}</div>
                <div style={{ fontSize: 11, color: '#4a453e' }}>{selectedIngredient.unit || 'no unit'}</div>
              </div>
              <div className="mob-detail-body">

                {/* Info */}
                <div className="mob-dfield-grid">
                  <div className="mob-dfield"><div className="mob-dfield-lbl">Name</div><div className="mob-dfield-val">{selectedIngredient.name}</div></div>
                  <div className="mob-dfield"><div className="mob-dfield-lbl">Current Price</div><div className="mob-dfield-val accent">{selectedIngredient.last_price ? formatCurrency(selectedIngredient.last_price) : '—'}</div></div>
                  <div className="mob-dfield"><div className="mob-dfield-lbl">Unit</div><div className="mob-dfield-val">{selectedIngredient.unit || '—'}</div></div>
                  <div className="mob-dfield"><div className="mob-dfield-lbl">Last Ordered</div><div className="mob-dfield-val">{formatDate(selectedIngredient.last_ordered_at)}</div></div>
                </div>

                {/* Stats */}
                {loadingDetail ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#4a453e', fontSize: 12 }}>
                    <div style={{ width: 16, height: 16, border: '2px solid #2a2620', borderTopColor: '#02a4ba', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
                    Loading history...
                  </div>
                ) : (
                  <>
                    <div className="mob-dfield-grid">
                      <div className="mob-dfield"><div className="mob-dfield-lbl">Avg Price</div><div className="mob-dfield-val">{avgIng > 0 ? formatCurrency(avgIng) : '—'}</div></div>
                      <div className="mob-dfield">
                        <div className="mob-dfield-lbl">Price Change</div>
                        <div className="mob-dfield-val" style={{ color: priceChangePct > 0 ? '#c04040' : priceChangePct < 0 ? '#2a8a5a' : '#9a9086' }}>
                          {prices.length > 1 ? `${priceChangePct > 0 ? '+' : ''}${priceChangePct.toFixed(1)}%` : '—'}
                        </div>
                      </div>
                      <div className="mob-dfield"><div className="mob-dfield-lbl">Total Orders</div><div className="mob-dfield-val">{purchaseHistory.length}</div></div>
                      <div className="mob-dfield"><div className="mob-dfield-lbl">First Seen</div><div className="mob-dfield-val">{priceHistory.length > 0 ? formatDate(priceHistory[0].date) : '—'}</div></div>
                    </div>

                    {/* Sparkline */}
                    {priceHistory.length > 1 && (
                      <div style={{ background: '#13120f', border: '1px solid #2a2620', borderRadius: 8, padding: 12 }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: '#4a453e', textTransform: 'uppercase', letterSpacing: '.7px', marginBottom: 10 }}>Price History</div>
                        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 60 }}>
                          {priceHistory.map((p, i) => {
                            const prev = i > 0 ? priceHistory[i - 1].price : null;
                            const maxP = Math.max(...priceHistory.map(x => x.price), 1);
                            const minP = Math.min(...priceHistory.map(x => x.price));
                            const range = maxP - minP || 1;
                            const h = Math.max(5, ((p.price - minP) / range) * 85 + 5);
                            const color = !prev ? '#02a4ba' : p.price > prev ? '#c04040' : p.price < prev ? '#2a8a5a' : '#02a4ba';
                            return (
                              <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, height: '100%' }}>
                                <div style={{ flex: 1, width: '100%', display: 'flex', alignItems: 'flex-end' }}>
                                  <div style={{ width: '100%', height: `${h}%`, background: color, opacity: .75, borderRadius: '2px 2px 0 0' }} />
                                </div>
                                <div style={{ fontSize: 8, color: '#3a3630' }}>{new Date(p.date).toLocaleDateString('en-US', { month: 'short' })}</div>
                              </div>
                            );
                          })}
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
                          <div style={{ fontSize: 10, color: '#4a453e' }}>{formatDate(priceHistory[0].date)} — {formatCurrency(priceHistory[0].price)}</div>
                          <div style={{ fontSize: 10, color: '#02a4ba', fontWeight: 600 }}>{formatDate(priceHistory[priceHistory.length - 1].date)} — {formatCurrency(priceHistory[priceHistory.length - 1].price)}</div>
                        </div>
                      </div>
                    )}

                    {/* Purchase history */}
                    {purchaseHistory.length > 0 && (
                      <div style={{ background: '#13120f', border: '1px solid #2a2620', borderRadius: 8, padding: 12 }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: '#4a453e', textTransform: 'uppercase', letterSpacing: '.7px', marginBottom: 10 }}>Purchase History ({purchaseHistory.length})</div>
                        {purchaseHistory.slice(0, 6).map((p, i) => {
                          const price = parseFloat(p.unit_cost);
                          const prev = purchaseHistory[i + 1] ? parseFloat(purchaseHistory[i + 1].unit_cost) : null;
                          const dotColor = prev === null ? '#02a4ba' : price > prev ? '#c04040' : price < prev ? '#2a8a5a' : '#6b6358';
                          return (
                            <div key={p.id || i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: '1px solid #1a1915' }}>
                              <div style={{ width: 7, height: 7, borderRadius: '50%', background: dotColor, flexShrink: 0 }} />
                              <div style={{ flex: 1, fontSize: 12, color: '#9a9086', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                <span style={{ color: '#e8e2d8', fontWeight: 500 }}>{p.invoices?.number || 'Invoice'}</span>
                                {p.invoices?.supplier ? ` · ${p.invoices.supplier}` : ''}
                              </div>
                              <div style={{ fontSize: 12, fontWeight: 600, color: dotColor, flexShrink: 0 }}>{formatCurrency(p.unit_cost)}</div>
                              <div style={{ fontSize: 11, color: '#4a453e', flexShrink: 0 }}>{p.invoices?.date ? formatDateShort(p.invoices.date) : '—'}</div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          {/* Bottom nav */}
          <div className="mob-bottom-nav">
            {navItems.map(({ label, path, icon }) => {
              const active = path === '/client/ingredients';
              return (
                <div key={label} className="mob-nav-item" onClick={() => router.push(path)}>
                  <div className={`mob-nav-icon${active ? ' active' : ''}`}>{icon}</div>
                  <div className={`mob-nav-label${active ? ' active' : ''}`}>{label}</div>
                  {active && <div className="mob-nav-dot" />}
                </div>
              );
            })}
          </div>

        </div>
      </>
    );
  }

  // ── END MOBILE — desktop return follows ──

  return (
    <>
      <style>{CSS}</style>

      <div className="ing-root">

        {/* NAV */}
        <div className="ing-nav">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'clamp(8px,1vw,16px)' }}>
            <div className="ing-logo">Opti<span>Menu</span></div>
            <div style={{ display: 'flex', gap: 2 }}>
              {tabs.map(t => (
                <button key={t} className={`ing-tab${t === 'Ingredients' ? ' active' : ''}`}
                  onClick={() => router.push(t === 'Dashboard' ? '/client/dashboard' : `/client/${t.toLowerCase().replace(' ', '-')}`)}>
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'clamp(6px,0.7vw,12px)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 'clamp(9px,0.65vw,11px)', color: '#02a4ba' }}>
              <div style={{ width: 4, height: 4, background: '#02a4ba', borderRadius: '50%', animation: 'blink 2s infinite' }} />
              Active
            </div>
            <input className="ing-search-sm" placeholder="Search..." />
            <ProfileDropdown userName={userName} userEmail={userEmail} isMobile={isMobile} />
          </div>
        </div>

        {/* PAGE HEADER */}
        <div className="ing-ph">
          <div>
            <div className="ing-ph-title">Ingredient Inventory</div>
            <div className="ing-ph-sub">Monitor costs and price trends</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input className="ing-search-lg" placeholder="Search by name or unit..."
              value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
            <button className="ing-add-btn">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              Add Ingredient
            </button>
          </div>
        </div>

        {/* STATS BAR */}
        <div className="ing-sbar">
          {[
            { v: ingredients.length, l: 'Total Ingredients', c: '#02a4ba' },
            { v: unpriced.length, l: 'Unpriced', c: '#c04040' },
            { v: priced.length, l: 'Priced', c: '#2a8a5a' },
            { v: highest > 0 ? formatCurrencyShort(highest) : '--', l: 'Highest Price', c: '#d4a020' },
            { v: avgPrice > 0 ? formatCurrencyShort(avgPrice) : '--', l: 'Avg Price', c: '#e8e2d8' },
          ].map(({ v, l, c }) => (
            <div key={l}>
              <div className="ing-sv" style={{ color: c }}>{v}</div>
              <div className="ing-sl">{l}</div>
            </div>
          ))}
        </div>

        {/* SPLIT */}
        {loading ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 10 }}>
            <div style={{ width: 22, height: 22, border: '2px solid #2a2620', borderTopColor: '#02a4ba', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
            <div style={{ fontSize: 'clamp(10px,0.8vw,13px)', color: '#4a453e' }}>Loading ingredients...</div>
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
                  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#e8e2d8" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: .2 }}>
                    <path d="M17 8h1a4 4 0 010 8h-1"/><path d="M3 8h14v9a4 4 0 01-4 4H7a4 4 0 01-4-4V8z"/>
                    <line x1="6" y1="2" x2="6" y2="4"/><line x1="10" y1="2" x2="10" y2="4"/><line x1="14" y1="2" x2="14" y2="4"/>
                  </svg>
                  <div className="ing-empty-title">{searchTerm ? `No results for "${searchTerm}"` : 'No ingredients yet'}</div>
                  <div className="ing-empty-sub">{searchTerm ? 'Try a different search term' : 'Ingredients appear automatically after invoices are processed'}</div>
                  {searchTerm && <button className="ing-add-btn" onClick={() => setSearchTerm('')} style={{ marginTop: 4 }}>Clear Search</button>}
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
                    <div className="ing-td">{ing.last_ordered_at ? formatDateShort(ing.last_ordered_at) : <span style={{ color: '#4a453e' }}>Never</span>}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* DETAIL PANEL */}
          <div className="ing-detail">
            <div className="ing-detail-hd">
              <div className="ing-detail-title">{selectedIngredient ? 'Ingredient Detail' : 'Ingredient Overview'}</div>
              <div style={{ fontSize: 'clamp(9px,0.65vw,11px)', color: selectedIngredient ? '#02a4ba' : '#4a453e' }}>
                {selectedIngredient ? `${selectedIngredient.name} · ${selectedIngredient.unit || 'no unit'}` : 'Click an ingredient to view details'}
              </div>
            </div>

            {/* DEFAULT OVERVIEW */}
            {!selectedIngredient && (
              <div className="ing-detail-body">

                {/* Price Trend Overview */}
                <div className="ing-wf">
                  <div className="ing-wlbl">
                    <svg viewBox="0 0 24 24"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
                    Price Trend Overview
                  </div>
                  <div className="ing-trend-pills">
                    {[
                      { n: rising.length, l: 'Rising ↑', c: '#c04040' },
                      { n: stable.length, l: 'Stable →', c: '#2a8a5a' },
                      { n: falling.length, l: 'Falling ↓', c: '#02a4ba' },
                      { n: noData.length, l: 'No data', c: '#4a453e' },
                    ].map(({ n, l, c }) => (
                      <div key={l} className="ing-tpill">
                        <div className="ing-tpill-n" style={{ color: c }}>{n}</div>
                        <div className="ing-tpill-l">{l}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="ing-w-row">
                  {/* Most Expensive */}
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
                    )) : <div style={{ fontSize: 'clamp(9px,0.68vw,11px)', color: '#4a453e' }}>No priced ingredients yet</div>}
                  </div>

                  {/* Most Frequently Purchased — requires separate query; showing top by name as proxy */}
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
                    {priced.length === 0 && <div style={{ fontSize: 'clamp(9px,0.68vw,11px)', color: '#4a453e' }}>No data yet</div>}
                  </div>
                </div>

                {/* Rising Prices Watch List */}
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
                    const prev = (curr * 0.9).toFixed(2); // placeholder until full price history query
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
                  {topExpensive.length === 0 && <div style={{ fontSize: 'clamp(9px,0.68vw,11px)', color: '#4a453e', padding: '6px 0' }}>No price data available yet</div>}
                </div>

                <div className="ing-hint">Select an ingredient to view price history and purchase records →</div>
              </div>
            )}

            {/* INGREDIENT DETAIL */}
            {selectedIngredient && (
              <div className="ing-detail-body">

                {/* Info */}
                <div className="ing-dsect">
                  <div className="ing-dsect-title">Ingredient Information</div>
                  <div className="ing-dgrid">
                    <div className="ing-dfield"><div className="ing-dfield-lbl">Name</div><div className="ing-dfield-val">{selectedIngredient.name || 'Unnamed'}</div></div>
                    <div className="ing-dfield"><div className="ing-dfield-lbl">Current Price</div><div className="ing-dfield-val accent">{selectedIngredient.last_price ? formatCurrency(selectedIngredient.last_price) : <span style={{ color: '#4a453e', fontStyle: 'italic' }}>No price</span>}</div></div>
                    <div className="ing-dfield"><div className="ing-dfield-lbl">Unit</div><div className="ing-dfield-val">{selectedIngredient.unit || '—'}</div></div>
                    <div className="ing-dfield"><div className="ing-dfield-lbl">Last Ordered</div><div className="ing-dfield-val">{formatDate(selectedIngredient.last_ordered_at)}</div></div>
                  </div>
                </div>

                {/* Stats */}
                <div className="ing-dsect">
                  <div className="ing-dsect-title">Price Statistics</div>
                  <div className="ing-dgrid">
                    <div className="ing-dfield"><div className="ing-dfield-lbl">Avg Price</div><div className="ing-dfield-val">{avgIng > 0 ? formatCurrency(avgIng) : '—'}</div></div>
                    <div className="ing-dfield">
                      <div className="ing-dfield-lbl">Price Change</div>
                      <div className={`ing-dfield-val ${priceChangePct > 0 ? 'up' : priceChangePct < 0 ? 'down' : ''}`}>
                        {prices.length > 1 ? `${priceChangePct > 0 ? '+' : ''}${priceChangePct.toFixed(1)}% ${priceChangePct > 0 ? '↑' : priceChangePct < 0 ? '↓' : '→'}` : '—'}
                      </div>
                    </div>
                    <div className="ing-dfield"><div className="ing-dfield-lbl">Total Orders</div><div className="ing-dfield-val">{purchaseHistory.length}</div></div>
                    <div className="ing-dfield"><div className="ing-dfield-lbl">First Seen</div><div className="ing-dfield-val">{priceHistory.length > 0 ? formatDate(priceHistory[0].date) : '—'}</div></div>
                  </div>
                </div>

                {/* Price history sparkline */}
                {loadingDetail ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'clamp(9px,0.68vw,11px)', color: '#4a453e' }}>
                    <div style={{ width: 14, height: 14, border: '2px solid #2a2620', borderTopColor: '#02a4ba', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
                    Loading price history...
                  </div>
                ) : priceHistory.length > 1 ? (
                  <div className="ing-dsect">
                    <div className="ing-dsect-title">Price History</div>
                    <div style={{ background: '#0f0e0c', border: '1px solid #2a2620', borderRadius: 6, padding: 'clamp(8px,0.8vw,14px)' }}>
                      <div className="ing-spark">
                        {priceHistory.map((p, i) => {
                          const prev = i > 0 ? priceHistory[i - 1].price : null;
                          const heightPct = Math.max(5, ((p.price - minSparkPrice) / sparkRange) * 85 + 5);
                          return (
                            <div key={i} className="ing-sp-col">
                              <div className="ing-sp-track">
                                <div className="ing-sp-bar" style={{ height: `${heightPct}%`, background: getSparkColor(p.price, prev), opacity: .75 }} />
                              </div>
                              <div className="ing-sp-lbl">{new Date(p.date).toLocaleDateString('en-US', { month: 'short' })}</div>
                            </div>
                          );
                        })}
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
                        <div style={{ fontSize: 'clamp(8px,0.6vw,10px)', color: '#4a453e' }}>{formatDate(priceHistory[0].date)} — {formatCurrency(priceHistory[0].price)}</div>
                        <div style={{ fontSize: 'clamp(8px,0.6vw,10px)', color: '#02a4ba', fontWeight: 600 }}>{formatDate(priceHistory[priceHistory.length - 1].date)} — {formatCurrency(priceHistory[priceHistory.length - 1].price)}</div>
                      </div>
                    </div>
                  </div>
                ) : priceHistory.length === 1 ? (
                  <div className="ing-dsect">
                    <div className="ing-dsect-title">Price History</div>
                    <div style={{ background: '#0f0e0c', border: '1px solid #2a2620', borderRadius: 6, padding: 'clamp(8px,0.8vw,14px)', fontSize: 'clamp(9px,0.68vw,11px)', color: '#4a453e', textAlign: 'center' }}>
                      Only 1 purchase recorded — chart requires 2+ data points
                    </div>
                  </div>
                ) : !loadingDetail && (
                  <div className="ing-dsect">
                    <div className="ing-dsect-title">Price History</div>
                    <div style={{ background: '#0f0e0c', border: '1px solid #2a2620', borderRadius: 6, padding: 'clamp(8px,0.8vw,14px)', fontSize: 'clamp(9px,0.68vw,11px)', color: '#4a453e', textAlign: 'center' }}>
                      No price history yet — will appear after first purchase
                    </div>
                  </div>
                )}

                {/* Purchase history */}
                {purchaseHistory.length > 0 && (
                  <div className="ing-dsect">
                    <div className="ing-dsect-title">Purchase History ({purchaseHistory.length})</div>
                    {purchaseHistory.slice(0, 8).map((p, i) => {
                      const price = parseFloat(p.unit_cost);
                      const prev = purchaseHistory[i + 1] ? parseFloat(purchaseHistory[i + 1].unit_cost) : null;
                      const dotColor = prev === null ? '#02a4ba' : price > prev ? '#c04040' : price < prev ? '#2a8a5a' : '#6b6358';
                      return (
                        <div key={p.id || i} className="ing-ph-item">
                          <div className="ing-ph-dot" style={{ background: dotColor }} />
                          <div className="ing-ph-text">
                            <strong>{p.invoices?.number || 'Invoice'}</strong>
                            {p.invoices?.supplier ? ` · ${p.invoices.supplier}` : ''}
                            {p.quantity ? ` · ${p.quantity} ${p.unit || ''}`.trim() : ''}
                          </div>
                          <div className="ing-ph-price" style={{ color: dotColor }}>{formatCurrency(p.unit_cost)}</div>
                          <div className="ing-ph-date">{p.invoices?.date ? formatDateShort(p.invoices.date) : '—'}</div>
                        </div>
                      );
                    })}
                  </div>
                )}

                <button className="ing-back-btn" onClick={() => { setSelectedIngredient(null); setPriceHistory([]); setPurchaseHistory([]); router.replace('/client/ingredients', undefined, { shallow: true }); }}>
                  ← Back to overview
                </button>
              </div>
            )}
          </div>
        </div>
        )}
      </div>
    </>
  );
}