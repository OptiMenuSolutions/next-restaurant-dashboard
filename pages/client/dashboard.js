// pages/client/dashboard.js
import React, { useState, useEffect } from "react";
import { useRouter } from "next/router";
import supabase from "../../lib/supabaseClient";
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/next';

// ─── Helpers ────────────────────────────────────────────────────────────────

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

// ─── Sub-components ──────────────────────────────────────────────────────────

function ScoreRing({ score }) {
  const { color, label } = getScoreInfo(score);
  const circumference = 2 * Math.PI * 40;
  const dash = (score / 100) * circumference;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
      <div style={{ fontSize: 7, color: '#6b6358', textTransform: 'uppercase', letterSpacing: '.5px' }}>AI Profit Score</div>
      <div style={{ position: 'relative', width: 56, height: 56 }}>
        <svg width="56" height="56" viewBox="0 0 100 100" style={{ transform: 'rotate(-90deg)' }}>
          <circle cx="50" cy="50" r="40" stroke="#1a1915" strokeWidth="9" fill="none" />
          <circle cx="50" cy="50" r="40" stroke={color} strokeWidth="9" fill="none"
            strokeDasharray={`${dash} ${circumference}`} strokeLinecap="round" />
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 15, color: '#e8e2d8', lineHeight: 1 }}>{score}</div>
          <div style={{ fontSize: 7, color: '#4a453e' }}>/ 100</div>
        </div>
      </div>
      <div style={{ fontSize: 8, fontWeight: 600, padding: '1px 7px', borderRadius: 10, background: `${color}18`, color }}>{label}</div>
    </div>
  );
}

function MarginBar({ name, pct, color }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 5 }}>
      <div style={{ fontSize: 9, color: '#9a9086', width: 80, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
      <div style={{ flex: 1, background: '#1a1915', borderRadius: 3, height: 3 }}>
        <div style={{ height: 3, borderRadius: 3, background: color, width: `${Math.max(0, Math.min(100, pct))}%` }} />
      </div>
      <div style={{ fontSize: 9, fontWeight: 600, width: 34, textAlign: 'right', flexShrink: 0, color }}>{pct.toFixed(1)}%</div>
    </div>
  );
}

function SpendBar({ month, pct, color }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, height: '100%' }}>
      <div style={{ flex: 1, width: '100%', display: 'flex', alignItems: 'flex-end' }}>
        <div style={{ width: '100%', borderRadius: '2px 2px 0 0', background: color, height: `${Math.max(2, pct)}%` }} />
      </div>
      <div style={{ fontSize: 7, color: '#3a3630' }}>{month}</div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

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

  const [dashboardData, setDashboardData] = useState({
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
    processingStats: { processed: 0, pending: 0 },
    lowMarginCount: 0,
  });

  const LOW_MARGIN_THRESHOLD = 40;

  useEffect(() => { getRestaurantId(); }, []);
  useEffect(() => { if (restaurantId) fetchDashboardData(); }, [restaurantId]);

  async function getRestaurantId() {
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) { setError("Authentication required"); setLoading(false); return; }
      const { data, error } = await supabase.from("profiles").select("restaurant_id, full_name").eq("id", user.id).single();
      if (error || !data?.restaurant_id) { setError("Could not determine restaurant access"); setLoading(false); return; }
      setRestaurantId(data.restaurant_id);
      setUserName(data.full_name ? data.full_name.split(' ')[0] : "User");
      const { data: rd } = await supabase.from("restaurants").select("name").eq("id", data.restaurant_id).single();
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
      setDashboardData(processed);
      setLoading(false);
      fetchAIRecommendations(processed);
    } catch (err) {
      setError("Failed to fetch dashboard data: " + err.message);
      setLoading(false);
    }
  }

  async function fetchAIRecommendations(data) {
    try {
      setAiLoading(true);
      const res = await fetch('/api/ai-recommendations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dashboardData: data, restaurantId, restaurantName: userName }),
      });
      if (!res.ok) throw new Error(`API ${res.status}`);
      const json = await res.json();
      setDashboardData(prev => ({ ...prev, aiRecommendations: json.recommendations }));
    } catch {
      setDashboardData(prev => ({
        ...prev,
        aiRecommendations: [
          { title: "Check High Margins", description: "Review top performing items" },
          { title: "Monitor Costs", description: "Track ingredient pricing changes" },
          { title: "Optimize Menu", description: "Update low margin dishes" },
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

    const spendValues = (dashboardData.monthlySpending || []).map(m => m.total);
    const maxSpend = spendValues.length > 0 ? Math.max(...spendValues, 1) : 1;

    const aiProfitScore = calculateAIProfitScore({ itemsWithMargins, averageMargin, unpricedIngredients, totalIngredients: ingredients.length, totalMenuItems: menuItems.length, processedInvoices, totalInvoices: invoices.length });

    return {
      totalInvoices: invoices.length,
      totalIngredients: ingredients.length,
      totalMenuItems: menuItems.length,
      recentInvoices, ingredientTrends, menuItemAnalysis, monthlySpending,
      unpricedIngredients, averageMargin, totalSpending, aiProfitScore,
      lowMarginCount, maxSpend,
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
    const items = dashboardData.menuItemAnalysis.filter(i => i.hasCompleteData && i.price > 0);
    if (!items.length) return [];
    const sorted = [...items].sort((a, b) => b.margin - a.margin);
    return marginView === 'high' ? sorted.slice(0, 5) : sorted.slice(-5).reverse();
  }

  function getBarColor(total) {
    if (total > 5000) return '#c04040';
    if (total > 2000) return '#d4a020';
    if (total > 0) return '#02a4ba';
    return '#1e1c18';
  }

  const tabs = ["Dashboard", "Invoices", "Ingredients", "Menu Items"];

  const s = {
    // Layout
    wrap: { fontFamily: "'Inter', sans-serif", background: '#0a0908', color: '#e8e2d8', width: '100%', height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
    nav: { background: '#0f0e0c', borderBottom: '1px solid #2a2620', padding: '4px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 },
    logo: { fontFamily: "'Playfair Display', serif", fontSize: 13, color: '#e8e2d8', letterSpacing: '-.3px' },
    tab: (active) => ({ padding: '1px 5px', borderRadius: 3, fontSize: 9, color: active ? '#e8e2d8' : '#4a453e', border: 'none', background: active ? '#1a1915' : 'none', cursor: 'pointer', fontFamily: "'Inter', sans-serif", lineHeight: 1.6 }),
    search: { background: '#1a1915', border: '1px solid #2a2620', borderRadius: 3, padding: '2px 7px', fontSize: 9, color: '#e8e2d8', width: 120, outline: 'none', fontFamily: "'Inter', sans-serif" },
    avatar: { width: 18, height: 18, borderRadius: '50%', background: '#02a4ba', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 700, color: '#0a0908', flexShrink: 0, cursor: 'pointer' },
    wbar: { background: '#13120f', borderBottom: '1px solid #2a2620', padding: '4px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 },
    grid: { display: 'grid', gridTemplateColumns: '155px 1fr 1fr 1fr', gridTemplateRows: '1fr 1fr', gap: 6, padding: 6, flex: 1, overflow: 'hidden', minHeight: 0 },
    panel: { gridColumn: 1, gridRow: '1/3', background: '#13120f', border: '1px solid #2a2620', borderRadius: 6, padding: 9, display: 'flex', flexDirection: 'column', gap: 7, overflow: 'hidden' },
    card: { background: '#13120f', border: '1px solid #2a2620', borderRadius: 6, padding: '8px 10px', display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 },
    cardHd: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, flexShrink: 0 },
    cardTitle: { fontSize: 9, fontWeight: 600, color: '#e8e2d8', display: 'flex', alignItems: 'center', gap: 4 },
    cardAct: { fontSize: 8, color: '#02a4ba', background: 'none', border: 'none', cursor: 'pointer', fontFamily: "'Inter', sans-serif" },
    pill: { background: '#0f0e0c', borderRadius: 4, padding: '4px 7px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', border: '1px solid #1a1915' },
    row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 7px', background: '#0f0e0c', borderRadius: 4, marginBottom: 3, flexShrink: 0 },
    aiItem: { display: 'flex', gap: 5, padding: '5px 7px', background: '#0f0e0c', borderRadius: 5, borderLeft: '2px solid #02a4ba', marginBottom: 4, flexShrink: 0 },
    tog: { display: 'flex', background: '#0f0e0c', borderRadius: 3, padding: 1 },
    togBtn: (active) => ({ padding: '1px 5px', borderRadius: 2, fontSize: 8, cursor: 'pointer', border: 'none', fontFamily: "'Inter', sans-serif", color: active ? '#e8e2d8' : '#4a453e', background: active ? '#1a1915' : 'transparent', lineHeight: 1.6 }),
  };

  if (loading) return (
    <div style={{ ...s.wrap, alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ width: 32, height: 32, border: '2px solid #2a2620', borderTopColor: '#02a4ba', borderRadius: '50%', animation: 'spin .7s linear infinite', margin: '0 auto 12px' }} />
        <div style={{ fontSize: 13, color: '#e8e2d8', marginBottom: 4 }}>Loading Dashboard</div>
        <div style={{ fontSize: 11, color: '#4a453e' }}>Analyzing your restaurant data...</div>
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  if (error) return (
    <div style={{ ...s.wrap, alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 13, color: '#e8e2d8', marginBottom: 8 }}>Unable to Load Dashboard</div>
        <div style={{ fontSize: 11, color: '#4a453e', marginBottom: 16 }}>{error}</div>
        <button onClick={() => window.location.reload()} style={{ background: '#02a4ba', border: 'none', borderRadius: 6, padding: '8px 16px', color: '#0a0908', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Try Again</button>
      </div>
    </div>
  );

  const marginItems = getMarginItems();
  const maxSpend = Math.max(...(dashboardData.monthlySpending || []).map(m => m.total), 1);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400&family=Inter:wght@400;500;600&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { height: 100%; overflow: hidden; background: #0a0908; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:.3} }
        input::placeholder { color: #3a3630; }
        ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: #0f0e0c; } ::-webkit-scrollbar-thumb { background: #2a2620; border-radius: 2px; }
      `}</style>

      <div style={s.wrap}>

        {/* NAV */}
        <div style={s.nav}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={s.logo}>Opti<span style={{ color: '#02a4ba' }}>Menu</span></div>
            <div style={{ display: 'flex', gap: 1 }}>
              {tabs.map(t => (
                <button key={t} style={s.tab(activeTab === t)} onClick={() => {
                  setActiveTab(t);
                  if (t !== 'Dashboard') router.push(`/client/${t.toLowerCase().replace(' ', '-')}`);
                }}>{t}</button>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 8, color: '#02a4ba' }}>
              <div style={{ width: 4, height: 4, background: '#02a4ba', borderRadius: '50%', animation: 'blink 2s infinite' }} />
              Active
            </div>
            <input style={s.search} placeholder="Search..." />
            <div style={s.avatar}>{getUserInitials(userName)}</div>
          </div>
        </div>

        {/* WELCOME BAR */}
        <div style={s.wbar}>
          <div style={{ display: 'flex', alignItems: 'baseline' }}>
            <span style={{ fontSize: 10, fontWeight: 600, color: '#e8e2d8' }}>Welcome back, {userName}</span>
            <span style={{ fontSize: 8, color: '#4a453e', marginLeft: 5 }}>· {new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} · {restaurantName}</span>
          </div>
          <div style={{ display: 'flex', gap: 14 }}>
            {[
              { v: dashboardData.totalInvoices, l: 'Invoices', c: '#02a4ba' },
              { v: dashboardData.totalIngredients, l: 'Ingredients', c: '#e8e2d8' },
              { v: dashboardData.totalMenuItems, l: 'Menu Items', c: '#e8e2d8' },
              { v: `${dashboardData.averageMargin.toFixed(1)}%`, l: 'Avg Margin', c: getMarginColor(dashboardData.averageMargin) },
              { v: formatCurrency(dashboardData.totalSpending), l: 'YTD Spend', c: '#d4a020' },
            ].map(({ v, l, c }) => (
              <div key={l}>
                <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 12, color: c, lineHeight: 1 }}>{v}</div>
                <div style={{ fontSize: 7, color: '#4a453e', marginTop: 1 }}>{l}</div>
              </div>
            ))}
          </div>
        </div>

        {/* MAIN GRID */}
        <div style={s.grid}>

          {/* LEFT PANEL */}
          <div style={s.panel}>
            {/* Restaurant */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 3, paddingBottom: 7, borderBottom: '1px solid #2a2620', flexShrink: 0 }}>
              <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'rgba(2,164,186,.1)', border: '1px solid rgba(2,164,186,.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#02a4ba" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 8h1a4 4 0 010 8h-1"/><path d="M3 8h14v9a4 4 0 01-4 4H7a4 4 0 01-4-4V8z"/>
                  <line x1="6" y1="2" x2="6" y2="4"/><line x1="10" y1="2" x2="10" y2="4"/><line x1="14" y1="2" x2="14" y2="4"/>
                </svg>
              </div>
              <div style={{ fontSize: 9, fontWeight: 600, color: '#e8e2d8' }}>{restaurantName}</div>
              <div style={{ fontSize: 7, color: '#4a453e' }}>Management Dashboard</div>
            </div>

            {/* Score ring */}
            <div style={{ flexShrink: 0 }}>
              <ScoreRing score={dashboardData.aiProfitScore.score} />
            </div>

            {/* Stat pills */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, overflow: 'hidden' }}>
              {[
                { l: 'Invoices', v: dashboardData.totalInvoices, c: '#02a4ba' },
                { l: 'Unpriced', v: dashboardData.unpricedIngredients, c: '#d4a020' },
                { l: 'Low Margin', v: dashboardData.lowMarginCount, c: '#c04040' },
                { l: 'Food Cost', v: `${dashboardData.averageMargin > 0 ? (100 - dashboardData.averageMargin).toFixed(1) : 0}%`, c: '#2a8a5a' },
                { l: 'YTD Spend', v: formatCurrency(dashboardData.totalSpending), c: '#d4a020' },
              ].map(({ l, v, c }) => (
                <div key={l} style={s.pill}>
                  <div style={{ fontSize: 8, color: '#6b6358' }}>{l}</div>
                  <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 12, color: c }}>{v}</div>
                </div>
              ))}
            </div>
          </div>

          {/* AI RECOMMENDATIONS */}
          <div style={{ ...s.card, gridColumn: 2, gridRow: 1 }}>
            <div style={s.cardHd}>
              <div style={s.cardTitle}>
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#02a4ba" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                </svg>
                AI Recommendations
              </div>
              {aiLoading && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 7, color: '#4a453e' }}>
                  <div style={{ width: 6, height: 6, border: '1.5px solid #2a2620', borderTopColor: '#02a4ba', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
                  Analyzing
                </div>
              )}
            </div>
            {dashboardData.aiRecommendations.length > 0 ? dashboardData.aiRecommendations.slice(0, 3).map((rec, i) => (
              <div key={i} style={s.aiItem}>
                <div style={{ width: 4, height: 4, borderRadius: '50%', background: '#02a4ba', marginTop: 3, flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: 9, fontWeight: 600, color: '#e8e2d8', marginBottom: 1 }}>{rec.title}</div>
                  <div style={{ fontSize: 8, color: '#6b6358', lineHeight: 1.4 }}>{rec.description}</div>
                </div>
              </div>
            )) : (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: '#4a453e' }}>
                Preparing recommendations...
              </div>
            )}
          </div>

          {/* MENU ANALYSIS */}
          <div style={{ ...s.card, gridColumn: 3, gridRow: 1 }}>
            <div style={s.cardHd}>
              <div style={s.cardTitle}>
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#02a4ba" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
                </svg>
                Menu Analysis
              </div>
              <div style={s.tog}>
                <button style={s.togBtn(marginView === 'high')} onClick={() => setMarginView('high')}>High</button>
                <button style={s.togBtn(marginView === 'low')} onClick={() => setMarginView('low')}>Low</button>
              </div>
            </div>
            {marginItems.length > 0 ? marginItems.map(item => (
              <MarginBar key={item.id} name={item.name} pct={item.margin} color={getMarginColor(item.margin)} />
            )) : (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: '#4a453e' }}>
                No menu data yet
              </div>
            )}
          </div>

          {/* RECENT INVOICES */}
          <div style={{ ...s.card, gridColumn: 4, gridRow: 1 }}>
            <div style={s.cardHd}>
              <div style={s.cardTitle}>
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#02a4ba" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>
                </svg>
                Recent Invoices
              </div>
              <button style={s.cardAct} onClick={() => router.push('/client/invoices')}>View all →</button>
            </div>
            {dashboardData.recentInvoices.length > 0 ? dashboardData.recentInvoices.map(inv => (
              <div key={inv.id} style={s.row}>
                <div>
                  <div style={{ fontSize: 9, fontWeight: 500, color: '#e8e2d8' }}>{inv.number}</div>
                  <div style={{ fontSize: 7, color: '#4a453e' }}>{inv.supplier}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 9, fontWeight: 600, color: '#e8e2d8' }}>{formatCurrency(inv.amount)}</div>
                  <div style={{ fontSize: 7, color: '#4a453e' }}>{formatDate(inv.date)}</div>
                </div>
              </div>
            )) : (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: '#4a453e' }}>No invoices yet</div>
            )}
          </div>

          {/* MONTHLY SPENDING CHART */}
          <div style={{ ...s.card, gridColumn: '2/4', gridRow: 2 }}>
            <div style={s.cardHd}>
              <div style={s.cardTitle}>
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#02a4ba" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
                </svg>
                Monthly Spending
              </div>
              <button style={s.cardAct} onClick={() => router.push('/client/invoices')}>View all →</button>
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, flex: 1, minHeight: 0 }}>
                {(dashboardData.monthlySpending || []).map(({ month, total }) => (
                  <SpendBar key={month} month={month.slice(0, 1)} pct={(total / maxSpend) * 90} color={getBarColor(total)} />
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 4, flexShrink: 0 }}>
                {[
                  { c: '#c04040', l: 'High (>$5k)' },
                  { c: '#d4a020', l: 'Moderate' },
                  { c: '#02a4ba', l: 'Normal' },
                  { c: '#1e1c18', l: 'No spend', border: '1px solid #2a2620' },
                ].map(({ c, l, border }) => (
                  <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 7, color: '#4a453e' }}>
                    <div style={{ width: 5, height: 5, borderRadius: '50%', background: c, border, flexShrink: 0 }} />
                    {l}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* TOP INGREDIENT COSTS */}
          <div style={{ ...s.card, gridColumn: 4, gridRow: 2 }}>
            <div style={s.cardHd}>
              <div style={s.cardTitle}>
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#02a4ba" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>
                </svg>
                Top Ingredient Costs
              </div>
            </div>
            {dashboardData.ingredientTrends.length > 0 ? dashboardData.ingredientTrends.map(ing => (
              <div key={ing.name} style={{ ...s.row, marginBottom: 3 }}>
                <div>
                  <div style={{ fontSize: 9, color: '#9a9086' }}>{ing.name}</div>
                  <div style={{ fontSize: 7, color: '#4a453e' }}>per {ing.unit}</div>
                </div>
                <div style={{ fontSize: 9, fontWeight: 600, color: '#02a4ba' }}>{formatCurrencyDetailed(ing.price)}</div>
              </div>
            )) : (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: '#4a453e' }}>No ingredient data yet</div>
            )}
          </div>

        </div>
      </div>

      <Analytics />
      <SpeedInsights />
    </>
  );
}