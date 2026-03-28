// pages/client/dashboard.js
import React, { useState, useEffect } from "react";
import { useRouter } from "next/router";
import supabase from "../../lib/supabaseClient";
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/next';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatCurrency(amount) {
  if (!amount) return "$0";
  const n = parseFloat(amount);
  if (isNaN(n)) return "$0";
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function formatCurrencyDetailed(amount) {
  if (!amount) return "$0.00";
  const n = parseFloat(amount);
  if (isNaN(n)) return "$0.00";
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(d) {
  if (!d) return "N/A";
  try { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
  catch { return "N/A"; }
}

function getMarginColor(m) {
  if (m >= 60) return "#2a8a5a";
  if (m >= 40) return "#02a4ba";
  if (m >= 25) return "#d4a020";
  return "#c04040";
}

function getScoreInfo(score) {
  if (score >= 85) return { color: "#2a8a5a", label: "Excellent" };
  if (score >= 70) return { color: "#02a4ba", label: "Good" };
  if (score >= 55) return { color: "#d4a020", label: "Fair" };
  return { color: "#c04040", label: "Needs Work" };
}

function getUserInitials(name) {
  if (!name) return "U";
  return name.split(' ').map(p => p.charAt(0)).join('').substring(0, 2).toUpperCase();
}

function getBarColor(total) {
  if (total > 5000) return '#c04040';
  if (total > 2000) return '#d4a020';
  if (total > 0) return '#02a4ba';
  return '#1e1c18';
}

// ─── CSS ─────────────────────────────────────────────────────────────────────

const GLOBAL_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400&family=Inter:wght@400;500;600&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { height: 100%; overflow: hidden; background: #0a0908; }

  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes blink { 0%,100%{opacity:1} 50%{opacity:.3} }

  :root {
    --nav-h: clamp(36px, 3.5vh, 54px);
    --wbar-h: clamp(30px, 3vh, 48px);
    --pad: clamp(6px, 0.55vw, 14px);
    --gap: clamp(6px, 0.5vw, 12px);
    --r: clamp(5px, 0.35vw, 8px);

    --fs-logo: clamp(13px, 1.05vw, 19px);
    --fs-tab: clamp(10px, 0.72vw, 13px);
    --fs-search-w: clamp(110px, 11vw, 220px);
    --fs-wl: clamp(11px, 0.82vw, 16px);
    --fs-ws: clamp(9px, 0.62vw, 12px);
    --fs-wv: clamp(12px, 1vw, 19px);
    --fs-wlb: clamp(8px, 0.58vw, 11px);

    --fs-card-title: clamp(10px, 0.72vw, 13px);
    --fs-body: clamp(10px, 0.68vw, 13px);
    --fs-sub: clamp(8px, 0.58vw, 11px);
    --fs-val: clamp(13px, 1.05vw, 18px);
    --fs-pill-l: clamp(9px, 0.62vw, 12px);
    --fs-pill-v: clamp(13px, 1.05vw, 17px);
    --fs-score: clamp(16px, 1.5vw, 25px);
    --fs-score-lbl: clamp(8px, 0.58vw, 11px);
    --fs-rname: clamp(10px, 0.78vw, 14px);
    --fs-rsub: clamp(8px, 0.6vw, 11px);

    --ring-sz: clamp(54px, 5.2vw, 90px);
    --icon-sz: clamp(24px, 2.1vw, 42px);
    --avatar-sz: clamp(20px, 1.7vw, 32px);
    --dot-sz: clamp(4px, 0.32vw, 6px);
    --aid-sz: clamp(4px, 0.32vw, 6px);
    --bar-h: clamp(3px, 0.28vh, 6px);
    --bar-gap: clamp(3px, 0.28vw, 6px);
    --legend-dot: clamp(5px, 0.42vw, 8px);

    --panel-w: clamp(158px, 12.5vw, 235px);
    --row1-h: clamp(235px, 27vh, 345px);
    --row2-h: clamp(205px, 24vh, 305px);

    --ai-pad-v: clamp(6px, 0.55vh, 11px);
    --ai-pad-h: clamp(8px, 0.65vw, 13px);
    --row-pad-v: clamp(5px, 0.48vh, 10px);
    --row-pad-h: clamp(7px, 0.58vw, 12px);
    --pill-pad-v: clamp(5px, 0.48vh, 10px);
    --pill-pad-h: clamp(7px, 0.58vw, 13px);
  }

  /* Breakpoints */
  @media (max-width: 1280px) {
    :root {
      --panel-w: clamp(148px, 13vw, 180px);
      --row1-h: clamp(210px, 26vh, 290px);
      --row2-h: clamp(185px, 23vh, 260px);
    }
  }

  @media (max-width: 1024px) {
    .db-grid {
      grid-template-columns: 1fr 1fr !important;
      grid-template-rows: auto auto auto !important;
    }
    .db-panel {
      grid-column: 1 / 3 !important;
      grid-row: 1 !important;
      flex-direction: row !important;
      gap: clamp(10px, 2vw, 24px) !important;
      align-items: center !important;
    }
    .db-panel-top {
      border-bottom: none !important;
      border-right: 1px solid #2a2620 !important;
      padding-bottom: 0 !important;
      padding-right: clamp(10px, 2vw, 20px) !important;
    }
    .db-pills {
      flex-direction: row !important;
      flex-wrap: wrap !important;
    }
    .db-pill { min-width: 100px !important; }
    .db-card-ai { grid-column: 1 !important; grid-row: 2 !important; }
    .db-card-menu { grid-column: 2 !important; grid-row: 2 !important; }
    .db-card-inv { grid-column: 1 !important; grid-row: 3 !important; }
    .db-card-chart { grid-column: 2 !important; grid-row: 3 !important; }
    .db-card-ing { grid-column: 1 / 3 !important; grid-row: 4 !important; }
  }

  input::placeholder { color: #3a3630; }
  ::-webkit-scrollbar { width: 3px; }
  ::-webkit-scrollbar-track { background: #0f0e0c; }
  ::-webkit-scrollbar-thumb { background: #2a2620; border-radius: 2px; }
`;

// ─── Sub-components ───────────────────────────────────────────────────────────

function ScoreRing({ score }) {
  const { color, label } = getScoreInfo(score);
  const circumference = 2 * Math.PI * 40;
  const dash = (score / 100) * circumference;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'clamp(3px,0.3vh,6px)', flexShrink: 0 }}>
      <div style={{ fontSize: 'var(--fs-score-lbl)', color: '#6b6358', textTransform: 'uppercase', letterSpacing: '.5px' }}>AI Profit Score</div>
      <div style={{ position: 'relative', width: 'var(--ring-sz)', height: 'var(--ring-sz)' }}>
        <svg width="100%" height="100%" viewBox="0 0 100 100" style={{ transform: 'rotate(-90deg)' }}>
          <circle cx="50" cy="50" r="40" stroke="#1a1915" strokeWidth="9" fill="none" />
          <circle cx="50" cy="50" r="40" stroke={color} strokeWidth="9" fill="none"
            strokeDasharray={`${dash} ${circumference}`} strokeLinecap="round" />
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 'var(--fs-score)', color: '#e8e2d8', lineHeight: 1 }}>{score}</div>
          <div style={{ fontSize: 'clamp(7px,0.55vw,10px)', color: '#4a453e' }}>/ 100</div>
        </div>
      </div>
      <div style={{ fontSize: 'clamp(9px,0.62vw,12px)', fontWeight: 600, padding: 'clamp(2px,0.2vh,3px) clamp(6px,0.5vw,10px)', borderRadius: 10, background: `${color}18`, color }}>{label}</div>
    </div>
  );
}

function MarginBar({ name, pct, color }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'clamp(5px,0.4vw,8px)', marginBottom: 'clamp(5px,0.55vh,9px)' }}>
      <div style={{ fontSize: 'var(--fs-body)', color: '#9a9086', width: 'clamp(70px,7.5vw,120px)', flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
      <div style={{ flex: 1, background: '#1a1915', borderRadius: 3, height: 'var(--bar-h)' }}>
        <div style={{ height: '100%', borderRadius: 3, background: color, width: `${Math.max(0, Math.min(100, pct))}%` }} />
      </div>
      <div style={{ fontSize: 'var(--fs-body)', fontWeight: 600, width: 'clamp(30px,2.8vw,44px)', textAlign: 'right', flexShrink: 0, color }}>{pct.toFixed(1)}%</div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ClientDashboard() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [restaurantId, setRestaurantId] = useState(null);
  const [userName, setUserName] = useState("");
  const [restaurantName, setRestaurantName] = useState("Your Restaurant");
  const [marginView, setMarginView] = useState("high");
  const [aiLoading, setAiLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("Dashboard");

  const [data, setData] = useState({
    totalInvoices: 0,
    totalIngredients: 0,
    totalMenuItems: 0,
    recentInvoices: [],
    ingredientTrends: [],
    menuItemAnalysis: [],
    monthlySpending: [],
    unpricedIngredients: 0,
    averageMargin: 0,
    totalSpending: 0,
    aiProfitScore: { score: 0 },
    aiRecommendations: [],
    lowMarginCount: 0,
  });

  const LOW_MARGIN_THRESHOLD = 40;

  useEffect(() => { getRestaurantId(); }, []);
  useEffect(() => { if (restaurantId) fetchDashboardData(); }, [restaurantId]);

  async function getRestaurantId() {
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) { setError("Authentication required"); setLoading(false); return; }
      const { data: profile, error: profileError } = await supabase.from("profiles").select("restaurant_id, full_name").eq("id", user.id).single();
      if (profileError || !profile?.restaurant_id) { setError("Could not determine restaurant access"); setLoading(false); return; }
      setRestaurantId(profile.restaurant_id);
      setUserName(profile.full_name ? profile.full_name.split(' ')[0] : "User");
      const { data: rd } = await supabase.from("restaurants").select("name").eq("id", profile.restaurant_id).single();
      setRestaurantName(rd?.name || "Your Restaurant");
    } catch { setError("An unexpected error occurred"); setLoading(false); }
  }

  async function fetchDashboardData() {
    try {
      setLoading(true);
      const [{ data: invoices }, { data: ingredients }, { data: menuItems }] = await Promise.all([
        supabase.from("invoices").select("*").eq("restaurant_id", restaurantId).order("created_at", { ascending: false }),
        supabase.from("ingredients").select("*").eq("restaurant_id", restaurantId),
        supabase.from("menu_items").select(`*, menu_item_components(id, name, cost, component_ingredients(quantity, ingredients(last_price)))`).eq("restaurant_id", restaurantId),
      ]);
      const processed = processDashboardData(invoices || [], ingredients || [], menuItems || []);
      setData(processed);
      setLoading(false);
      fetchAIRecommendations(processed);
    } catch (err) {
      setError("Failed to fetch dashboard data: " + err.message);
      setLoading(false);
    }
  }

  async function fetchAIRecommendations(dashData) {
    try {
      setAiLoading(true);
      const res = await fetch('/api/ai-recommendations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dashboardData: dashData, restaurantId, restaurantName: userName }),
      });
      if (!res.ok) throw new Error(`API ${res.status}`);
      const json = await res.json();
      setData(prev => ({ ...prev, aiRecommendations: json.recommendations || [] }));
    } catch {
      setData(prev => ({
        ...prev,
        aiRecommendations: [
          { title: "Check High Margins", description: "Review top performing items on your menu to identify dishes worth promoting." },
          { title: "Monitor Costs", description: "Track ingredient pricing changes and update unpriced items for accuracy." },
          { title: "Optimize Menu", description: "Add ingredient costs to get accurate margin calculations across your menu." },
        ]
      }));
    } finally { setAiLoading(false); }
  }

  function processDashboardData(invoices, ingredients, menuItems) {
    const processedInvoices = invoices.filter(i => i.number && i.supplier && i.amount);
    const totalSpending = processedInvoices.reduce((s, i) => s + parseFloat(i.amount || 0), 0);
    const unpricedIngredients = ingredients.filter(i => !i.last_price || parseFloat(i.last_price) === 0).length;
    const recentInvoices = processedInvoices.slice(0, 4).map(i => ({ id: i.id, number: i.number, supplier: i.supplier, amount: i.amount, date: i.date }));

    const menuItemAnalysis = menuItems.map(item => {
      const cost = (item.menu_item_components || []).reduce((t, c) => t + parseFloat(c.cost || 0), 0);
      const price = parseFloat(item.price || 0);
      const margin = price > 0 ? ((price - cost) / price) * 100 : 0;
      const hasData = (item.menu_item_components || []).length > 0 &&
        (item.menu_item_components || []).every(c =>
          (c.component_ingredients || []).length > 0 &&
          (c.component_ingredients || []).every(ci => ci.ingredients?.last_price && parseFloat(ci.ingredients.last_price) > 0)
        );
      return { id: item.id, name: item.name, price, cost, margin, hasCompleteData: hasData };
    });

    const itemsWithMargins = menuItemAnalysis.filter(i => i.hasCompleteData && i.price > 0);
    const averageMargin = itemsWithMargins.length > 0
      ? itemsWithMargins.reduce((s, i) => s + i.margin, 0) / itemsWithMargins.length : 0;
    const lowMarginCount = itemsWithMargins.filter(i => i.margin < LOW_MARGIN_THRESHOLD).length;

    const ingredientTrends = ingredients
      .filter(i => i.last_price > 0)
      .sort((a, b) => parseFloat(b.last_price) - parseFloat(a.last_price))
      .slice(0, 5)
      .map(i => ({ name: i.name, price: parseFloat(i.last_price), unit: i.unit }));

    const currentYear = new Date().getFullYear();
    const monthlySpending = Array.from({ length: 12 }, (_, m) => {
      const name = new Date(currentYear, m).toLocaleDateString('en-US', { month: 'short' });
      const total = processedInvoices
        .filter(i => i.date && new Date(i.date).getFullYear() === currentYear && new Date(i.date).getMonth() === m)
        .reduce((s, i) => s + parseFloat(i.amount || 0), 0);
      return { month: name, total, monthNumber: m + 1 };
    });

    const aiProfitScore = calculateAIProfitScore({ itemsWithMargins, averageMargin, unpricedIngredients, totalIngredients: ingredients.length, totalMenuItems: menuItems.length, processedInvoices, totalInvoices: invoices.length });

    return {
      totalInvoices: invoices.length,
      totalIngredients: ingredients.length,
      totalMenuItems: menuItems.length,
      recentInvoices, ingredientTrends, menuItemAnalysis, monthlySpending,
      unpricedIngredients, averageMargin, totalSpending, aiProfitScore,
      lowMarginCount,
      processingStats: { processed: processedInvoices.length, pending: invoices.length - processedInvoices.length },
    };
  }

  function calculateAIProfitScore({ itemsWithMargins, averageMargin, unpricedIngredients, totalIngredients, totalMenuItems, processedInvoices, totalInvoices }) {
    let score = 0;
    score += Math.min((averageMargin / 60) * 30, 30);
    score += totalIngredients > 0 ? ((totalIngredients - unpricedIngredients) / totalIngredients) * 10 : 0;
    score += totalMenuItems > 0 ? (itemsWithMargins.length / totalMenuItems) * 10 : 0;
    score += totalInvoices > 0 ? (processedInvoices.length / totalInvoices) * 5 : 0;
    if (itemsWithMargins.length > 0) {
      const high = itemsWithMargins.filter(i => i.margin >= 50).length;
      const low = itemsWithMargins.filter(i => i.margin < 25).length;
      score += Math.max(Math.min(((high / itemsWithMargins.length) * 15) - ((low / itemsWithMargins.length) * 10) + 10, 20), 0);
    }
    const recent = processedInvoices.filter(i => { const d = new Date(i.created_at); const ago = new Date(); ago.setDate(ago.getDate() - 30); return d >= ago; }).length;
    score += Math.min((recent / 10) * 15, 15);
    return { score: Math.max(0, Math.min(100, Math.round(score))) };
  }

  function getMarginItems() {
    const items = (data.menuItemAnalysis || []).filter(i => i.hasCompleteData && i.price > 0);
    if (!items.length) return [];
    const sorted = [...items].sort((a, b) => b.margin - a.margin);
    return marginView === 'high' ? sorted.slice(0, 5) : sorted.slice(-5).reverse();
  }

  const tabs = ["Dashboard", "Invoices", "Ingredients", "Menu Items"];
  const marginItems = getMarginItems();
  const spendValues = (data.monthlySpending || []).map(m => m.total);
  const maxSpend = spendValues.length > 0 ? Math.max(...spendValues, 1) : 1;

  if (loading) return (
    <>
      <style>{GLOBAL_CSS}</style>
      <div style={{ background: '#0a0908', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12 }}>
        <div style={{ width: 'clamp(24px,2vw,36px)', height: 'clamp(24px,2vw,36px)', border: '2px solid #2a2620', borderTopColor: '#02a4ba', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
        <div style={{ fontSize: 'clamp(12px,1vw,16px)', color: '#e8e2d8' }}>Loading Dashboard</div>
        <div style={{ fontSize: 'clamp(10px,0.8vw,13px)', color: '#4a453e' }}>Analyzing your restaurant data...</div>
      </div>
    </>
  );

  if (error) return (
    <>
      <style>{GLOBAL_CSS}</style>
      <div style={{ background: '#0a0908', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 'clamp(12px,1vw,16px)', color: '#e8e2d8' }}>Unable to Load Dashboard</div>
        <div style={{ fontSize: 'clamp(10px,0.8vw,13px)', color: '#4a453e', marginBottom: 8 }}>{error}</div>
        <button onClick={() => window.location.reload()} style={{ background: '#02a4ba', border: 'none', borderRadius: 6, padding: 'clamp(6px,0.5vh,10px) clamp(12px,1vw,20px)', color: '#0a0908', fontSize: 'clamp(11px,0.85vw,14px)', fontWeight: 600, cursor: 'pointer', fontFamily: "'Inter', sans-serif" }}>Try Again</button>
      </div>
    </>
  );

  return (
    <>
      <style>{GLOBAL_CSS}</style>

      <div style={{ fontFamily: "'Inter', sans-serif", background: '#0a0908', color: '#e8e2d8', width: '100%', height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* ── NAV ── */}
        <div style={{ background: '#0f0e0c', borderBottom: '1px solid #2a2620', height: 'var(--nav-h)', padding: '0 var(--pad)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'clamp(8px,1vw,16px)' }}>
            <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 'var(--fs-logo)', color: '#e8e2d8', letterSpacing: '-.3px' }}>
              Opti<span style={{ color: '#02a4ba' }}>Menu</span>
            </div>
            <div style={{ display: 'flex', gap: 2 }}>
              {tabs.map(t => (
                <button key={t}
                  style={{ padding: 'clamp(2px,0.2vh,4px) clamp(5px,0.55vw,10px)', borderRadius: 'var(--r)', fontSize: 'var(--fs-tab)', color: activeTab === t ? '#e8e2d8' : '#4a453e', border: 'none', background: activeTab === t ? '#1a1915' : 'none', cursor: 'pointer', fontFamily: "'Inter', sans-serif", lineHeight: 1.5 }}
                  onClick={() => { setActiveTab(t); if (t !== 'Dashboard') router.push(`/client/${t.toLowerCase().replace(' ', '-')}`); }}
                >{t}</button>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'clamp(6px,0.7vw,12px)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'clamp(3px,0.25vw,5px)', fontSize: 'var(--fs-sub)', color: '#02a4ba' }}>
              <div style={{ width: 'var(--dot-sz)', height: 'var(--dot-sz)', background: '#02a4ba', borderRadius: '50%', animation: 'blink 2s infinite' }} />
              Active
            </div>
            <input style={{ background: '#1a1915', border: '1px solid #2a2620', borderRadius: 'var(--r)', padding: 'clamp(3px,0.28vh,6px) clamp(7px,0.6vw,12px)', fontSize: 'var(--fs-tab)', color: '#e8e2d8', width: 'var(--fs-search-w)', outline: 'none', fontFamily: "'Inter', sans-serif" }} placeholder="Search..." />
            <div style={{ width: 'var(--avatar-sz)', height: 'var(--avatar-sz)', borderRadius: '50%', background: '#02a4ba', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 'clamp(8px,0.62vw,11px)', fontWeight: 700, color: '#0a0908', flexShrink: 0 }}>
              {getUserInitials(userName)}
            </div>
          </div>
        </div>

        {/* ── WELCOME BAR ── */}
        <div style={{ background: '#13120f', borderBottom: '1px solid #2a2620', height: 'var(--wbar-h)', padding: '0 var(--pad)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline' }}>
            <span style={{ fontSize: 'var(--fs-wl)', fontWeight: 600, color: '#e8e2d8' }}>Welcome back, {userName}</span>
            <span style={{ fontSize: 'var(--fs-ws)', color: '#4a453e', marginLeft: 6 }}>· {new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} · {restaurantName}</span>
          </div>
          <div style={{ display: 'flex', gap: 'clamp(14px,1.8vw,32px)' }}>
            {[
              { v: data.totalInvoices, l: 'Invoices', c: '#02a4ba' },
              { v: data.totalIngredients, l: 'Ingredients', c: '#e8e2d8' },
              { v: data.totalMenuItems, l: 'Menu Items', c: '#e8e2d8' },
              { v: `${data.averageMargin.toFixed(1)}%`, l: 'Avg Margin', c: getMarginColor(data.averageMargin) },
              { v: formatCurrency(data.totalSpending), l: 'YTD Spend', c: '#d4a020' },
            ].map(({ v, l, c }) => (
              <div key={l}>
                <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 'var(--fs-wv)', color: c, lineHeight: 1 }}>{v}</div>
                <div style={{ fontSize: 'var(--fs-wlb)', color: '#4a453e', marginTop: 1 }}>{l}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ── MAIN GRID ── */}
        <div className="db-grid" style={{ display: 'grid', gridTemplateColumns: 'var(--panel-w) 1fr 1fr 1fr', gridTemplateRows: 'var(--row1-h) var(--row2-h)', gap: 'var(--gap)', padding: 'var(--pad)', flex: 1, overflow: 'hidden', minHeight: 0 }}>

          {/* LEFT PANEL */}
          <div className="db-panel" style={{ gridColumn: 1, gridRow: '1/3', background: '#13120f', border: '1px solid #2a2620', borderRadius: 'var(--r)', padding: 'clamp(10px,0.8vw,16px)', display: 'flex', flexDirection: 'column', gap: 'clamp(8px,0.7vh,14px)', overflow: 'hidden' }}>

            <div className="db-panel-top" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 'clamp(3px,0.3vh,5px)', paddingBottom: 'clamp(8px,0.7vh,12px)', borderBottom: '1px solid #2a2620', flexShrink: 0 }}>
              <div style={{ width: 'var(--icon-sz)', height: 'var(--icon-sz)', borderRadius: '50%', background: 'rgba(2,164,186,.1)', border: '1px solid rgba(2,164,186,.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg style={{ width: '55%', height: '55%' }} viewBox="0 0 24 24" fill="none" stroke="#02a4ba" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 8h1a4 4 0 010 8h-1"/><path d="M3 8h14v9a4 4 0 01-4 4H7a4 4 0 01-4-4V8z"/>
                  <line x1="6" y1="2" x2="6" y2="4"/><line x1="10" y1="2" x2="10" y2="4"/><line x1="14" y1="2" x2="14" y2="4"/>
                </svg>
              </div>
              <div style={{ fontSize: 'var(--fs-rname)', fontWeight: 600, color: '#e8e2d8' }}>{restaurantName}</div>
              <div style={{ fontSize: 'var(--fs-rsub)', color: '#4a453e' }}>Management Dashboard</div>
            </div>

            <ScoreRing score={data.aiProfitScore.score} />

            <div className="db-pills" style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(4px,0.4vh,8px)', flex: 1, overflow: 'hidden' }}>
              {[
                { l: 'Invoices', v: data.totalInvoices, c: '#02a4ba' },
                { l: 'Unpriced', v: data.unpricedIngredients, c: '#d4a020' },
                { l: 'Low Margin', v: data.lowMarginCount, c: '#c04040' },
                { l: 'Avg Food Cost', v: `${data.averageMargin > 0 ? (100 - data.averageMargin).toFixed(1) : 0}%`, c: '#2a8a5a' },
                { l: 'YTD Spend', v: formatCurrency(data.totalSpending), c: '#d4a020' },
              ].map(({ l, v, c }) => (
                <div key={l} className="db-pill" style={{ background: '#0f0e0c', borderRadius: 'clamp(4px,0.3vw,6px)', padding: 'var(--pill-pad-v) var(--pill-pad-h)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', border: '1px solid #1a1915', flexShrink: 0 }}>
                  <div style={{ fontSize: 'var(--fs-pill-l)', color: '#6b6358' }}>{l}</div>
                  <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 'var(--fs-pill-v)', color: c }}>{v}</div>
                </div>
              ))}
            </div>
          </div>

          {/* AI RECOMMENDATIONS */}
          <div className="db-card-ai" style={{ gridColumn: 2, gridRow: 1, background: '#13120f', border: '1px solid #2a2620', borderRadius: 'var(--r)', padding: 'clamp(10px,0.8vw,16px) clamp(10px,0.9vw,18px)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'clamp(7px,0.7vh,12px)', flexShrink: 0 }}>
              <div style={{ fontSize: 'var(--fs-card-title)', fontWeight: 600, color: '#e8e2d8', display: 'flex', alignItems: 'center', gap: 'clamp(4px,0.3vw,6px)' }}>
                <svg style={{ width: 'clamp(10px,0.8vw,14px)', height: 'clamp(10px,0.8vw,14px)' }} viewBox="0 0 24 24" fill="none" stroke="#02a4ba" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                </svg>
                AI Recommendations
              </div>
              {aiLoading && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 'var(--fs-sub)', color: '#4a453e' }}>
                  <div style={{ width: 'clamp(7px,0.6vw,10px)', height: 'clamp(7px,0.6vw,10px)', border: '1.5px solid #2a2620', borderTopColor: '#02a4ba', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
                  Analyzing
                </div>
              )}
            </div>
            {(data.aiRecommendations || []).length > 0
              ? (data.aiRecommendations || []).slice(0, 3).map((rec, i) => (
                <div key={i} style={{ display: 'flex', gap: 'clamp(5px,0.4vw,8px)', padding: 'var(--ai-pad-v) var(--ai-pad-h)', background: '#0f0e0c', borderRadius: 'clamp(4px,0.3vw,6px)', borderLeft: '2px solid #02a4ba', marginBottom: 'clamp(5px,0.5vh,8px)', flexShrink: 0 }}>
                  <div style={{ width: 'var(--aid-sz)', height: 'var(--aid-sz)', borderRadius: '50%', background: '#02a4ba', marginTop: 'clamp(3px,0.3vh,5px)', flexShrink: 0 }} />
                  <div>
                    <div style={{ fontSize: 'var(--fs-body)', fontWeight: 600, color: '#e8e2d8', marginBottom: 2 }}>{rec.title}</div>
                    <div style={{ fontSize: 'var(--fs-sub)', color: '#6b6358', lineHeight: 1.45 }}>{rec.description}</div>
                  </div>
                </div>
              ))
              : <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 'var(--fs-body)', color: '#4a453e' }}>Preparing recommendations...</div>
            }
          </div>

          {/* MENU ANALYSIS */}
          <div className="db-card-menu" style={{ gridColumn: 3, gridRow: 1, background: '#13120f', border: '1px solid #2a2620', borderRadius: 'var(--r)', padding: 'clamp(10px,0.8vw,16px) clamp(10px,0.9vw,18px)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'clamp(7px,0.7vh,12px)', flexShrink: 0 }}>
              <div style={{ fontSize: 'var(--fs-card-title)', fontWeight: 600, color: '#e8e2d8', display: 'flex', alignItems: 'center', gap: 'clamp(4px,0.3vw,6px)' }}>
                <svg style={{ width: 'clamp(10px,0.8vw,14px)', height: 'clamp(10px,0.8vw,14px)' }} viewBox="0 0 24 24" fill="none" stroke="#02a4ba" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
                </svg>
                Menu Analysis
              </div>
              <div style={{ display: 'flex', background: '#0f0e0c', borderRadius: 'clamp(3px,0.25vw,5px)', padding: 2 }}>
                {['high', 'low'].map(v => (
                  <button key={v} onClick={() => setMarginView(v)}
                    style={{ padding: 'clamp(2px,0.2vh,4px) clamp(6px,0.5vw,10px)', borderRadius: 'clamp(2px,0.2vw,4px)', fontSize: 'var(--fs-sub)', cursor: 'pointer', border: 'none', fontFamily: "'Inter', sans-serif", color: marginView === v ? '#e8e2d8' : '#4a453e', background: marginView === v ? '#1a1915' : 'transparent', lineHeight: 1.5, textTransform: 'capitalize' }}>
                    {v.charAt(0).toUpperCase() + v.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            {marginItems.length > 0
              ? marginItems.map(item => <MarginBar key={item.id} name={item.name} pct={item.margin} color={getMarginColor(item.margin)} />)
              : <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 'var(--fs-body)', color: '#4a453e' }}>No menu data yet</div>
            }
          </div>

          {/* RECENT INVOICES */}
          <div className="db-card-inv" style={{ gridColumn: 4, gridRow: 1, background: '#13120f', border: '1px solid #2a2620', borderRadius: 'var(--r)', padding: 'clamp(10px,0.8vw,16px) clamp(10px,0.9vw,18px)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'clamp(7px,0.7vh,12px)', flexShrink: 0 }}>
              <div style={{ fontSize: 'var(--fs-card-title)', fontWeight: 600, color: '#e8e2d8', display: 'flex', alignItems: 'center', gap: 'clamp(4px,0.3vw,6px)' }}>
                <svg style={{ width: 'clamp(10px,0.8vw,14px)', height: 'clamp(10px,0.8vw,14px)' }} viewBox="0 0 24 24" fill="none" stroke="#02a4ba" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>
                </svg>
                Recent Invoices
              </div>
              <button onClick={() => router.push('/client/invoices')} style={{ fontSize: 'var(--fs-sub)', color: '#02a4ba', background: 'none', border: 'none', cursor: 'pointer', fontFamily: "'Inter', sans-serif", whiteSpace: 'nowrap' }}>View all →</button>
            </div>
            {data.recentInvoices.length > 0
              ? data.recentInvoices.map(inv => (
                <div key={inv.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--row-pad-v) var(--row-pad-h)', background: '#0f0e0c', borderRadius: 'clamp(4px,0.3vw,6px)', marginBottom: 'clamp(4px,0.4vh,7px)', flexShrink: 0 }}>
                  <div>
                    <div style={{ fontSize: 'var(--fs-body)', fontWeight: 500, color: '#e8e2d8' }}>{inv.number}</div>
                    <div style={{ fontSize: 'var(--fs-sub)', color: '#4a453e', marginTop: 1 }}>{inv.supplier}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 'var(--fs-body)', fontWeight: 600, color: '#e8e2d8' }}>{formatCurrency(inv.amount)}</div>
                    <div style={{ fontSize: 'var(--fs-sub)', color: '#4a453e', marginTop: 1 }}>{formatDate(inv.date)}</div>
                  </div>
                </div>
              ))
              : <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 'var(--fs-body)', color: '#4a453e' }}>No invoices yet</div>
            }
          </div>

          {/* MONTHLY SPENDING CHART */}
          <div className="db-card-chart" style={{ gridColumn: '2/4', gridRow: 2, background: '#13120f', border: '1px solid #2a2620', borderRadius: 'var(--r)', padding: 'clamp(10px,0.8vw,16px) clamp(10px,0.9vw,18px)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'clamp(7px,0.7vh,12px)', flexShrink: 0 }}>
              <div style={{ fontSize: 'var(--fs-card-title)', fontWeight: 600, color: '#e8e2d8', display: 'flex', alignItems: 'center', gap: 'clamp(4px,0.3vw,6px)' }}>
                <svg style={{ width: 'clamp(10px,0.8vw,14px)', height: 'clamp(10px,0.8vw,14px)' }} viewBox="0 0 24 24" fill="none" stroke="#02a4ba" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
                </svg>
                Monthly Spending
              </div>
              <button onClick={() => router.push('/client/invoices')} style={{ fontSize: 'var(--fs-sub)', color: '#02a4ba', background: 'none', border: 'none', cursor: 'pointer', fontFamily: "'Inter', sans-serif" }}>View all →</button>
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--bar-gap)', flex: 1, minHeight: 0 }}>
                {(data.monthlySpending || []).map(({ month, total }) => (
                  <div key={month} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'clamp(2px,0.2vh,4px)', height: '100%' }}>
                    <div style={{ flex: 1, width: '100%', display: 'flex', alignItems: 'flex-end' }}>
                      <div style={{ width: '100%', borderRadius: 'clamp(2px,0.2vw,4px) clamp(2px,0.2vw,4px) 0 0', background: getBarColor(total), height: `${Math.max(2, (total / maxSpend) * 90)}%` }} />
                    </div>
                    <div style={{ fontSize: 'clamp(8px,0.6vw,11px)', color: '#3a3630' }}>{month.slice(0, 3)}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 'clamp(8px,0.8vw,16px)', marginTop: 'clamp(5px,0.5vh,9px)', flexShrink: 0, flexWrap: 'wrap' }}>
                {[{ c: '#c04040', l: 'High (>$5k)' }, { c: '#d4a020', l: 'Moderate' }, { c: '#02a4ba', l: 'Normal' }, { c: '#1e1c18', l: 'No spend', b: '1px solid #2a2620' }].map(({ c, l, b }) => (
                  <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 'clamp(3px,0.25vw,5px)', fontSize: 'clamp(8px,0.6vw,11px)', color: '#4a453e' }}>
                    <div style={{ width: 'var(--legend-dot)', height: 'var(--legend-dot)', borderRadius: '50%', background: c, border: b, flexShrink: 0 }} />
                    {l}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* TOP INGREDIENT COSTS */}
          <div className="db-card-ing" style={{ gridColumn: 4, gridRow: 2, background: '#13120f', border: '1px solid #2a2620', borderRadius: 'var(--r)', padding: 'clamp(10px,0.8vw,16px) clamp(10px,0.9vw,18px)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'clamp(7px,0.7vh,12px)', flexShrink: 0 }}>
              <div style={{ fontSize: 'var(--fs-card-title)', fontWeight: 600, color: '#e8e2d8', display: 'flex', alignItems: 'center', gap: 'clamp(4px,0.3vw,6px)' }}>
                <svg style={{ width: 'clamp(10px,0.8vw,14px)', height: 'clamp(10px,0.8vw,14px)' }} viewBox="0 0 24 24" fill="none" stroke="#02a4ba" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>
                </svg>
                Top Ingredient Costs
              </div>
            </div>
            {data.ingredientTrends.length > 0
              ? data.ingredientTrends.map(ing => (
                <div key={ing.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--row-pad-v) var(--row-pad-h)', background: '#0f0e0c', borderRadius: 'clamp(4px,0.3vw,6px)', marginBottom: 'clamp(4px,0.4vh,7px)', flexShrink: 0 }}>
                  <div>
                    <div style={{ fontSize: 'var(--fs-body)', color: '#9a9086' }}>{ing.name}</div>
                    <div style={{ fontSize: 'var(--fs-sub)', color: '#4a453e', marginTop: 1 }}>per {ing.unit}</div>
                  </div>
                  <div style={{ fontSize: 'var(--fs-body)', fontWeight: 600, color: '#02a4ba' }}>{formatCurrencyDetailed(ing.price)}</div>
                </div>
              ))
              : <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 'var(--fs-body)', color: '#4a453e' }}>No ingredient data yet</div>
            }
          </div>

        </div>
      </div>

      <Analytics />
      <SpeedInsights />
    </>
  );
}