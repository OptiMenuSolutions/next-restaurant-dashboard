// pages/client/dashboard2.js
// NEW LAYOUT — sidebar nav, Canva-inspired card structure
// All data fetching, state, and sub-components preserved from dashboard.js
import React, { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/router";
import supabase from "../../lib/supabaseClient";
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { useWindowSize } from "../../lib/useWindowSize";
import ProfileDropdown from '../../components/ProfileDropdown';
import { useTour } from '../../lib/useTour';
import TourOverlay from '../../components/TourOverlay';
import { fetchSampleData } from '../../lib/seedSampleData';
import TourDataBanner from "../../components/TourDataBanner";
import UniversalSearch from '../../components/UniversalSearch';
import Head from "next/head";
import { getShelfLife, isProtein, PROTEIN_KEYS } from "../../lib/shelfLife";
import { computeWasteRisk } from "../../lib/computeWasteRisk";
import { useWeekInReview } from "../../lib/useWeekInReview";
import RecipePanel from "../../components/RecipePanel";

const fmt  = (n) => !n ? "$0"    : isNaN(parseFloat(n)) ? "$0"    : parseFloat(n).toLocaleString('en-US',{style:'currency',currency:'USD',minimumFractionDigits:0,maximumFractionDigits:0});
const fmtD = (n) => !n ? "$0.00" : isNaN(parseFloat(n)) ? "$0.00" : parseFloat(n).toLocaleString('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2});
function formatDate(d) { if (!d) return "N/A"; try { return new Date(d).toLocaleDateString('en-US',{month:'short',day:'numeric'}); } catch { return "N/A"; } }

function getMarginColor(m) {
  if (m >= 70) return "var(--color-green)";
  if (m >= 60) return "var(--accent)";
  return "var(--color-red)";
}
function getWasteUrgencyColor(daysLeft) {
  if (daysLeft <= 1) return "var(--color-red)";
  if (daysLeft <= 2) return "var(--color-amber)";
  return "var(--accent)";
}
function getTicketMeta(index) {
  if (index === 0) return { label:'PUSH TONIGHT', color:'var(--accent)' };
  if (index === 1) return { label:'RECOMMEND',    color:'var(--color-green)' };
  return              { label:'MENTION',         color:'var(--color-amber)' };
}

function Sparkline({ points, color, globalMin, globalMax, width=70, height=24 }) {
  const validPoints = points ? points.filter(p => p !== null && p !== undefined && isFinite(p)) : [];
  if (validPoints.length < 2) return null;
  const minV = globalMin !== undefined ? globalMin : Math.min(...validPoints);
  const maxV = globalMax !== undefined ? globalMax : Math.max(...validPoints);
  const range = maxV - minV || 1;
  const pad = 2;
  const coords = validPoints.map((p,i) => {
    const x = pad + (i/(validPoints.length-1))*(width-pad*2);
    const y = pad + ((maxV-p)/range)*(height-pad*2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const lastPt = coords.split(' ').pop().split(',');
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} style={{overflow:'visible',flexShrink:0}}>
      <polyline points={coords} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.8"/>
      <circle cx={lastPt[0]} cy={lastPt[1]} r="2.5" fill={color}/>
    </svg>
  );
}

const SELL_COPY = [
  "Just came in fresh — one of the best things on the menu tonight.",
  "The kitchen is really proud of this one tonight — worth every bite.",
  "Guests have been loving this lately — a great choice tonight.",
  "This one is exceptional right now — highly recommend it.",
  "A personal favorite of the chef tonight — you won't be disappointed.",
  "Incredibly fresh tonight — this is the one to get.",
];

// ── NAV ITEMS ────────────────────────────────────────────────────────────────
const NAV_ITEMS = [
  {
    label: 'Dashboard', path: '/client/dashboard2',
    icon: <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
  },
  {
    label: 'Invoices', path: '/client/invoices',
    icon: <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
  },
  {
    label: 'Ingredients', path: '/client/ingredients',
    icon: <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 8h1a4 4 0 010 8h-1"/><path d="M3 8h14v9a4 4 0 01-4 4H7a4 4 0 01-4-4V8z"/></svg>
  },
  {
    label: 'Menu Items', path: '/client/menu-items',
    icon: <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
  },
  {
    label: 'Analytics', path: '/client/analytics',
    icon: <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
  },
];

// ── CSS ──────────────────────────────────────────────────────────────────────
const GLOBAL_CSS = `
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
  html,body{height:100%;background:var(--bg-root);overflow:hidden;}
  #__next{height:100%;}
  @keyframes spin{to{transform:rotate(360deg);}}
  @keyframes blink{0%,100%{opacity:1}50%{opacity:.3}}
  @keyframes fadeIn{from{opacity:0;transform:translateY(4px);}to{opacity:1;transform:translateY(0);}}
  @keyframes slideIn{from{opacity:0;transform:translateX(-6px);}to{opacity:1;transform:translateX(0);}}
  input::placeholder{color:var(--text-faint)!important;}
  ::-webkit-scrollbar{width:3px;}
  ::-webkit-scrollbar-track{background:var(--bg-root);}
  ::-webkit-scrollbar-thumb{background:var(--border);border-radius:2px;}

  .db2-root{font-family:'Inter',sans-serif;background:var(--bg-root);color:var(--text-primary);width:100%;height:100vh;display:flex;overflow:hidden;}

  /* ── SIDEBAR ── */
  .db2-sidebar{
    width:176px;flex-shrink:0;
    background:#0f0e0c;
    border-right:1px solid rgba(255,255,255,0.06);
    display:flex;flex-direction:column;justify-content:space-between;
    padding:14px 10px;
    overflow:hidden;
  }
  .db2-brand{display:flex;align-items:center;gap:8px;padding:4px 8px;margin-bottom:20px;}
  .db2-brand-mark{width:26px;height:26px;border-radius:8px;background:var(--accent);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12px;color:#0a0908;flex-shrink:0;}
  .db2-brand-name{font-family:'Playfair Display',serif;font-size:14px;font-weight:500;color:var(--text-primary);letter-spacing:-.2px;line-height:1;}
  .db2-brand-sub{font-size:8px;color:#3a3630;text-transform:uppercase;letter-spacing:.12em;margin-top:2px;}
  .db2-nav{display:flex;flex-direction:column;gap:2px;}
  .db2-nav-item{
    display:flex;align-items:center;gap:8px;
    padding:8px 10px;border-radius:8px;
    font-size:11px;font-weight:400;
    color:#4a453e;
    background:transparent;border:none;cursor:pointer;
    font-family:'Inter',sans-serif;
    transition:background .15s,color .15s;
    text-align:left;width:100%;
  }
  .db2-nav-item:hover{background:rgba(255,255,255,0.04);color:#9a9086;}
  .db2-nav-item.active{background:rgba(2,164,186,0.1);border:1px solid rgba(2,164,186,0.15);color:var(--accent);font-weight:500;}
  .db2-nav-item svg{flex-shrink:0;}
  .db2-sidebar-footer{border-top:1px solid rgba(255,255,255,0.06);padding-top:12px;display:flex;align-items:center;gap:8px;padding-left:8px;}
  .db2-avatar{width:26px;height:26px;border-radius:50%;background:rgba(2,164,186,0.15);color:var(--accent);display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:600;flex-shrink:0;}

  /* ── MAIN AREA ── */
  .db2-main{flex:1;min-width:0;background:#0f0e0c;display:flex;flex-direction:column;overflow:hidden;}
  .db2-header{
    display:flex;justify-content:space-between;align-items:flex-start;
    padding:16px 20px 12px;
    border-bottom:1px solid rgba(255,255,255,0.06);
    flex-shrink:0;
  }
  .db2-header-greeting{font-family:'Playfair Display',serif;font-size:clamp(16px,1.4vw,22px);font-weight:400;color:var(--text-primary);letter-spacing:-.3px;line-height:1.1;}
  .db2-header-sub{font-size:clamp(9px,.68vw,11px);color:#4a453e;margin-top:4px;}
  .db2-header-date{font-size:9px;text-transform:uppercase;letter-spacing:.14em;color:#3a3630;font-weight:600;margin-bottom:4px;}
  .db2-search-row{display:flex;align-items:center;gap:8px;}
  .db2-search{display:flex;align-items:center;gap:6px;background:#1a1915;border:1px solid rgba(255,255,255,0.06);border-radius:8px;padding:6px 10px;width:180px;cursor:text;}
  .db2-search-placeholder{font-size:11px;color:#3a3630;}
  .db2-icon-btn{width:30px;height:30px;background:#1a1915;border:1px solid rgba(255,255,255,0.06);border-radius:8px;display:flex;align-items:center;justify-content:center;color:#4a453e;cursor:pointer;transition:color .15s,border-color .15s;flex-shrink:0;}
  .db2-icon-btn:hover{color:var(--accent);border-color:rgba(2,164,186,0.2);}

  /* ── STAT CARDS ── */
  .db2-stats-row{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;padding:12px 20px;flex-shrink:0;}
  .db2-stat{background:#1a1915;border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:12px 14px;display:flex;justify-content:space-between;align-items:flex-start;}
  .db2-stat-label{font-size:8px;text-transform:uppercase;letter-spacing:.1em;color:#4a453e;font-weight:600;margin-bottom:6px;}
  .db2-stat-value{font-size:clamp(16px,1.6vw,22px);font-weight:600;line-height:1;}
  .db2-stat-sub{font-size:9px;color:#4a453e;margin-top:4px;}
  .db2-stat-icon{width:26px;height:26px;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0;}

  /* ── BODY GRID ── */
  .db2-body{flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,.8fr) minmax(0,1.4fr);gap:8px;padding:0 20px 12px;overflow:hidden;}
  .db2-left{display:flex;flex-direction:column;gap:8px;min-height:0;overflow:hidden;}
  .db2-right{display:flex;flex-direction:column;gap:8px;min-height:0;overflow:hidden;}

  /* ── CARDS ── */
  .db2-card{background:#1a1915;border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:14px;display:flex;flex-direction:column;overflow:hidden;min-height:0;}
  .db2-card-hd{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;flex-shrink:0;}
  .db2-card-title{font-size:clamp(11px,.85vw,14px);font-weight:600;color:var(--text-primary);}
  .db2-card-sub{font-size:9px;color:#4a453e;margin-top:2px;}
  .db2-card-action{font-size:9px;color:var(--accent);font-weight:500;display:flex;align-items:center;gap:3px;cursor:pointer;background:none;border:none;font-family:'Inter',sans-serif;}

  /* ── TONIGHT'S DISH ── */
  .db2-dish-row{display:grid;grid-template-columns:auto 1fr auto;gap:8px;align-items:center;padding:9px 0;border-bottom:1px solid rgba(255,255,255,0.04);}
  .db2-dish-row:last-child{border-bottom:none;}
  .db2-dish-icon{width:26px;height:26px;border-radius:8px;background:rgba(2,164,186,0.1);color:var(--accent);display:flex;align-items:center;justify-content:center;flex-shrink:0;}
  .db2-dish-name{font-size:clamp(10px,.78vw,12px);font-weight:500;color:#c8c0b4;}
  .db2-dish-reason{font-size:clamp(8px,.6vw,10px);color:#4a453e;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .db2-priority-badge{font-size:8px;font-weight:700;padding:3px 7px;border-radius:20px;text-transform:uppercase;letter-spacing:.04em;white-space:nowrap;flex-shrink:0;}

  /* ── WASTE RISK ── */
  .db2-waste-row{display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.04);}
  .db2-waste-row:last-child{border-bottom:none;}
  .db2-waste-name{font-size:clamp(10px,.78vw,12px);font-weight:500;color:#c8c0b4;}
  .db2-waste-note{font-size:clamp(8px,.6vw,10px);color:#4a453e;margin-top:2px;}

  /* ── WEEK IN REVIEW ── */
  .db2-wir-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding-bottom:10px;border-bottom:1px solid rgba(255,255,255,0.06);margin-bottom:8px;flex-shrink:0;}
  .db2-wir-stat-label{font-size:8px;text-transform:uppercase;letter-spacing:.08em;color:#4a453e;font-weight:600;margin-bottom:4px;}
  .db2-wir-stat-value{font-size:clamp(12px,1vw,15px);font-weight:600;line-height:1;}
  .db2-wir-stat-sub{font-size:8px;margin-top:2px;}
  .db2-wir-day-row{display:grid;grid-template-columns:40px 1fr auto;gap:8px;align-items:center;padding:7px 0;border-bottom:1px solid rgba(255,255,255,0.04);cursor:pointer;}
  .db2-wir-day-row:last-child{border-bottom:none;}
  .db2-wir-day-box{background:#13120f;border:1px solid rgba(255,255,255,0.06);border-radius:8px;padding:4px;text-align:center;}
  .db2-wir-day-label{font-size:8px;font-weight:600;color:#c8c0b4;line-height:1;}
  .db2-wir-day-date{font-size:7px;color:#4a453e;margin-top:2px;}
  .db2-wir-day-pills{display:flex;align-items:center;gap:4px;flex:1;overflow:hidden;}
  .db2-wir-day-pill{font-size:7px;font-weight:700;padding:2px 5px;border-radius:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:90px;}
  .db2-wir-day-result{font-size:clamp(10px,.78vw,12px);font-weight:600;flex-shrink:0;}
  .db2-wir-scroll{flex:1;overflow-y:auto;min-height:0;}
  .db2-wir-scroll::-webkit-scrollbar{width:2px;}

  /* ── PRICE MOVEMENT ── */
  .db2-pm-row{display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.04);}
  .db2-pm-row:last-child{border-bottom:none;}
  .db2-pm-name{font-size:clamp(10px,.78vw,12px);font-weight:500;color:#c8c0b4;}
  .db2-pm-prices{font-size:clamp(8px,.6vw,10px);color:#4a453e;margin-top:2px;}
  .db2-pm-delta{font-size:clamp(10px,.78vw,12px);font-weight:600;flex-shrink:0;}

  /* ── LOADING / EMPTY ── */
  .db2-empty{flex:1;display:flex;align-items:center;justify-content:center;font-size:clamp(10px,.75vw,12px);color:#4a453e;text-align:center;}
  .db2-spinner{width:16px;height:16px;border:2px solid rgba(255,255,255,0.08);border-top-color:var(--accent);border-radius:50%;animation:spin .7s linear infinite;}

  /* ── TICKET ── */
  .db2-ticket{background:var(--ticket-bg);border:1px solid var(--ticket-border);border-radius:clamp(4px,.35vw,7px);font-family:'Courier New',monospace;animation:fadeIn .3s ease both;position:relative;cursor:pointer;transition:border-color .15s;}
  .db2-ticket:hover{border-color:rgba(255,255,255,0.15);}
  .db2-ticket.active{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent);}
  .db2-receipt-divider{border:none;border-top:1px dashed rgba(255,255,255,0.08);margin:clamp(3px,.3vh,5px) 0;flex-shrink:0;}
  .db2-recipe-panel{overflow:hidden;transition:max-height .35s cubic-bezier(.4,0,.2,1),opacity .25s ease;max-height:0;opacity:0;flex-shrink:0;margin-top:4px;}
  .db2-recipe-panel.open{max-height:500px;opacity:1;}

  /* ── MOBILE ── */
  @media (max-width: 768px) {
    .db2-sidebar{display:none;}
    .db2-stats-row{grid-template-columns:1fr 1fr;padding:10px 14px;}
    .db2-body{grid-template-columns:1fr;padding:0 14px 12px;}
    .db2-header{padding:12px 14px 10px;}
  }
`;

// ── WASTE ROW (new style) ─────────────────────────────────────────────────────
function WasteRow2({ item, router }) {
  const daysLeft = item.daysLeft;
  const isExpired = daysLeft < 0;
  const urgencyColor = isExpired ? 'var(--color-red)' : getWasteUrgencyColor(daysLeft);
  const label = isExpired ? `Expired ${Math.abs(daysLeft)}d ago` : daysLeft===0 ? 'Use today' : daysLeft===1 ? '1 day left' : `${daysLeft} days left`;
  const qtyText = item.remainingQty>0 ? `${item.remainingQty.toFixed(1)} ${item.unit||'units'} on hand` : item.invoicedQty>0 ? `${item.invoicedQty.toFixed(1)} ${item.unit||'units'} invoiced` : '';
  return (
    <div className="db2-waste-row">
      <div style={{flex:1,minWidth:0}}>
        <div className="db2-waste-name">{item.name}</div>
        <div className="db2-waste-note">{qtyText}{qtyText&&' · '}{label}</div>
      </div>
      <span className="db2-priority-badge" style={{background:`color-mix(in srgb, ${urgencyColor} 12%, transparent)`,color:urgencyColor}}>
        {isExpired||daysLeft<=1?'High':daysLeft<=2?'Med':'Low'}
      </span>
    </div>
  );
}

// ── PRICE MOVEMENT SIMPLE (new style) ────────────────────────────────────────
function PriceMovementSimple({ priceByCategory }) {
  const allIngs = useMemo(() => {
    const list = [];
    Object.values(priceByCategory).forEach(cat => {
      cat.ingredients.forEach(ing => list.push(ing));
    });
    return list.sort((a,b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct)).slice(0,6);
  }, [priceByCategory]);

  if (!allIngs.length) return <div className="db2-empty">No price history yet</div>;

  return (
    <div style={{flex:1,overflow:'hidden',display:'flex',flexDirection:'column'}}>
      {allIngs.map((ing,i) => {
        const isUp = ing.deltaPct > 0;
        const color = isUp ? 'var(--color-red)' : 'var(--color-green)';
        return (
          <div key={i} className="db2-pm-row">
            <div style={{flex:1,minWidth:0}}>
              <div className="db2-pm-name" style={{textTransform:'capitalize'}}>{ing.name}</div>
              <div className="db2-pm-prices">{fmtD(ing.firstPrice)} → {fmtD(ing.lastPrice)} / unit</div>
            </div>
            <div className="db2-pm-delta" style={{color}}>{isUp?'+':''}{ing.deltaPct.toFixed(1)}%</div>
          </div>
        );
      })}
    </div>
  );
}

// ── WEEK IN REVIEW (new style) ───────────────────────────────────────────────
function WeekInReviewNew({ restaurantId, wasteRisk, menuItems }) {
  const { weekData, weekExtraSold, weekWasteSaved, hitRate, loading } = useWeekInReview(restaurantId, wasteRisk, menuItems);

  if (loading) return (
    <div className="db2-empty">
      <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:8}}>
        <div className="db2-spinner"/>
        <span>Loading...</span>
      </div>
    </div>
  );

  return (
    <>
      {/* Stats row */}
      <div className="db2-wir-stats">
        <div style={{borderRight:'1px solid rgba(255,255,255,0.06)',paddingRight:8}}>
          <div className="db2-wir-stat-label">Revenue</div>
          <div className="db2-wir-stat-value" style={{color:'var(--color-green)'}}>
            {weekData.length > 0 ? `${weekData.reduce((s,d)=>s+(d.extraSold||0),0)>=0?'+':''}${weekData.reduce((s,d)=>s+(d.extraSold||0),0)}` : '—'}
          </div>
          <div className="db2-wir-stat-sub" style={{color:'var(--color-green)'}}>extra sold vs avg</div>
        </div>
        <div style={{borderRight:'1px solid rgba(255,255,255,0.06)',paddingRight:8}}>
          <div className="db2-wir-stat-label">Waste saved</div>
          <div className="db2-wir-stat-value" style={{color:'var(--color-green)'}}>${weekWasteSaved}</div>
          <div className="db2-wir-stat-sub" style={{color:'var(--color-green)'}}>estimated</div>
        </div>
        <div>
          <div className="db2-wir-stat-label">Hit rate</div>
          <div className="db2-wir-stat-value" style={{color:'var(--accent)'}}>{hitRate}%</div>
          <div className="db2-wir-stat-sub" style={{color:'var(--accent)'}}>days above avg</div>
        </div>
      </div>

      {/* Day rows */}
      <div className="db2-wir-scroll">
        {weekData.length === 0 && <div className="db2-empty">No weekly data yet</div>}
        {weekData.map(day => {
          const extraColor = day.extraSold>0?'var(--color-green)':day.extraSold<0?'var(--color-red)':'#4a453e';
          return (
            <div key={day.date} className="db2-wir-day-row">
              <div className="db2-wir-day-box">
                <div className="db2-wir-day-label">{day.dayLabel}</div>
                <div className="db2-wir-day-date">{day.date.slice(5).replace('-','/')}</div>
              </div>
              <div className="db2-wir-day-pills">
                {day.dishes.length > 0 ? day.dishes.map((d,i) => (
                  <span key={i} className="db2-wir-day-pill" style={{background:`color-mix(in srgb, ${d.ticketColor} 12%, transparent)`,color:d.ticketColor}}>
                    {d.name.split(' ').slice(0,2).join(' ')}
                  </span>
                )) : <span style={{fontSize:9,color:'#3a3630'}}>No recs</span>}
              </div>
              <div className="db2-wir-day-result" style={{color:extraColor}}>
                {day.extraSold > 0 ? '+' : ''}{day.extraSold}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ── MAIN EXPORT ───────────────────────────────────────────────────────────────
export default function ClientDashboard2() {
  const router = useRouter();
  const { isMobile } = useWindowSize();
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState("");
  const [restaurantId, setRestaurantId] = useState(null);
  const [userName, setUserName]         = useState("");
  const [userEmail, setUserEmail]       = useState("");
  const [restaurantName, setRestaurantName] = useState("Your Restaurant");
  const [aiLoading, setAiLoading]       = useState(false);
  const [menuItemsFull, setMenuItemsFull] = useState([]);
  const [selectedRec, setSelectedRec]   = useState(null);
  const [data, setData] = useState({
    totalInvoices:0,totalIngredients:0,totalMenuItems:0,
    ingredientTrends:[],menuItemAnalysis:[],
    unpricedIngredients:0,averageMargin:0,
    totalSpending:0,aiProfitScore:{score:0},aiRecommendations:[],
    lowMarginCount:0,highMarginCount:0,wasteRisk:[],priceByCategory:{},
  });
  const LOW_MARGIN_THRESHOLD = 60;

  useEffect(() => { ['dashboard','invoices','ingredients','menu-items','analytics'].forEach(p => router.prefetch(`/client/${p}`)); },[router]);
  useEffect(() => {
    if (router.query.tour==='true') return;
    const handler=()=>{ if(restaurantId) fetchDashboardData(restaurantId); };
    window.addEventListener('optimenu-tour-seeded',handler);
    return ()=>window.removeEventListener('optimenu-tour-seeded',handler);
  },[restaurantId]);
  useEffect(()=>{
    if(!router.isReady||router.query.tour!=='true'||!restaurantId)return;
    fetchSampleData().then(sample=>{if(!sample)return;const processed=processDashboardData(sample.invoices,sample.ingredients,sample.menuItems,[],{});setData(processed);setMenuItemsFull(sample.menuItems||[]);setLoading(false);});
  },[router.isReady,router.query.tour,restaurantId]);
  useEffect(()=>{getRestaurantId();},[]);
  const { tourProps }=useTour('dashboard',restaurantId);
  const isTour=router.query.tour==='true';

  async function getRestaurantId(){
    try{
      const {data:{user},error:userError}=await supabase.auth.getUser();
      if(userError||!user){setError("Authentication required");setLoading(false);return;}
      setUserEmail(user.email||'');
      const {data:profile,error:profileError}=await supabase.from("profiles").select("restaurant_id,full_name").eq("id",user.id).single();
      if(profileError||!profile?.restaurant_id){setError("Could not determine restaurant access");setLoading(false);return;}
      setRestaurantId(profile.restaurant_id);
      setUserName(profile.full_name?.split(' ')[0]?.trim()||"User");
      const {data:rd}=await supabase.from("restaurants").select("name").eq("id",profile.restaurant_id).single();
      setRestaurantName(rd?.name||"Your Restaurant");
      if(router.query.tour!=='true') await fetchDashboardData(profile.restaurant_id);
      else setLoading(false);
    }catch{setError("An unexpected error occurred");setLoading(false);}
  }

  async function fetchDashboardData(restId){
    try{
      setLoading(true);
      const sixMonthsAgo=new Date();sixMonthsAgo.setMonth(sixMonthsAgo.getMonth()-6);
      const fromDate=sixMonthsAgo.toISOString().split('T')[0];
      const [{data:invoices},{data:ingredients},{data:menuItems},{data:invoiceItems},{data:posSales}]=await Promise.all([
        supabase.from("invoices").select("*").eq("restaurant_id",restId).order("date",{ascending:false}),
        supabase.from("ingredients").select("*").eq("restaurant_id",restId).limit(1000),
        supabase.from("menu_items").select(`id,name,price,cost,category,menu_item_components(id,name,cost,component_ingredients(quantity,unit,ingredients(id,name,last_price,is_estimated)))`).eq("restaurant_id",restId).limit(500),
        supabase.from("invoice_items").select("*,invoices!inner(id,date,restaurant_id)").eq("invoices.restaurant_id",restId).gte("invoices.date",fromDate).order("invoices(date)",{ascending:true}),
        supabase.from("pos_sales").select("item_name,quantity_sold,sale_date").eq("restaurant_id",restId).gte("sale_date", (() => { const d=new Date(); d.setDate(d.getDate()-90); return d.toISOString().split('T')[0]; })()),
      ]);
      setMenuItemsFull(menuItems||[]);
      const wasteRisk = computeWasteRisk(invoiceItems||[], invoices||[], posSales||[], menuItems||[]);
      const priceByCategory=computePriceByCategory(invoiceItems||[]);
      const processed=processDashboardData(invoices||[],ingredients||[],menuItems||[],wasteRisk,priceByCategory);
      setData(processed);setLoading(false);
      fetchAIRecommendations(restId);
    }catch(err){setError("Failed to fetch dashboard data: "+err.message);setLoading(false);}
  }

  function computePriceByCategory(invoiceItems){
    const catMap={};
    (invoiceItems||[]).forEach(item=>{
      if(!item.unit_cost||!item.invoices?.date)return;
      const name=(item.ingredient_name_normalized||item.item_name||'').trim();if(!name)return;
      const cat=(item.category||'Uncategorized').trim();
      const date=new Date(item.invoices.date);
      const monthKey=`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;
      const price=parseFloat(item.unit_cost);
      if(!catMap[cat])catMap[cat]={};if(!catMap[cat][name])catMap[cat][name]={};if(!catMap[cat][name][monthKey])catMap[cat][name][monthKey]=[];
      catMap[cat][name][monthKey].push(price);
    });
    const buckets=Array.from({length:6},(_,i)=>{const d=new Date();d.setMonth(d.getMonth()-(5-i));return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;});
    const result={};
    Object.entries(catMap).forEach(([cat,ingredients])=>{
      const ingList=[];
      Object.entries(ingredients).forEach(([ingName,monthData])=>{
        const history=buckets.map(b=>{const vals=monthData[b];if(!vals||!vals.length)return null;return vals.reduce((a,v)=>a+v,0)/vals.length;});
        let last=null;
        const filled=history.map(v=>{if(v!==null){last=v;return v;}return last;});
        const filled2=filled.slice().reverse().map(v=>{if(v!==null){last=v;return v;}return last;}).reverse();
        const validPts=filled2.filter(Boolean);if(validPts.length<2)return;
        const firstPrice=validPts[0],lastPrice=validPts[validPts.length-1];
        if(!firstPrice)return;
        const deltaPct=((lastPrice-firstPrice)/firstPrice)*100;if(Math.abs(deltaPct)<2)return;
        ingList.push({name:ingName,history:filled2,deltaPct,firstPrice,lastPrice});
      });
      if(!ingList.length)return;
      ingList.sort((a,b)=>Math.abs(b.deltaPct)-Math.abs(a.deltaPct));
      result[cat]={ingredients:ingList,avgDelta:ingList.reduce((s,i)=>s+i.deltaPct,0)/ingList.length};
    });
    return result;
  }

  async function fetchAIRecommendations(restId){
    try{
      setAiLoading(true);
      const { data: { session } } = await supabase.auth.getSession();
      const res=await fetch('/api/ai-recommendations',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${session?.access_token}`},body:JSON.stringify({restaurantId:restId})});
      if(!res.ok)throw new Error(`API ${res.status}`);
      const json=await res.json();
      const recs=(json.recommendations||[]).map(r=>({title:r.title,description:r.description,sellCopy:r.talking_point||null,type:r.type,margin:r.margin||null,confidence:r.confidence||null,urgency:r.urgency||null}));
      setData(prev=>({...prev,aiRecommendations:recs}));
    }catch(err){
      console.error('[fetchAIRecommendations]',err);
      setData(prev=>({...prev,aiRecommendations:[]}));
    }finally{setAiLoading(false);}
  }

  function processDashboardData(invoices,ingredients,menuItems,wasteRisk,priceByCategory){
    const processedInvoices=invoices.filter(i=>i.number&&i.supplier&&i.amount);
    const totalSpending=invoices.filter(i=>parseFloat(i.amount||0)>0).reduce((s,i)=>s+parseFloat(i.amount||0),0);
    const unpricedIngredients=ingredients.filter(i=>!i.last_price||parseFloat(i.last_price)===0).length;
    const menuItemAnalysis=menuItems.map(item=>{
      const price=parseFloat(item.price||0);let cost=0,hasCompleteData=false;
      if(item.menu_item_components?.length>0){cost=item.menu_item_components.reduce((t,c)=>t+parseFloat(c.cost||0),0);hasCompleteData=item.menu_item_components.every(c=>(c.component_ingredients||[]).length>0&&(c.component_ingredients||[]).every(ci=>ci.ingredients?.last_price&&parseFloat(ci.ingredients.last_price)>0));}
      else if(item.cost&&parseFloat(item.cost)>0){cost=parseFloat(item.cost);hasCompleteData=price>0;}
      const margin=price>0&&cost>0?((price-cost)/price)*100:0;
      const hasEstimated=item.menu_item_components?.some(c=>(c.component_ingredients||[]).some(ci=>ci.ingredients?.is_estimated===true))||false;
      return {id:item.id,name:item.name,price,cost,margin,hasCompleteData,hasEstimated};
    });
    const itemsWithMargins=menuItemAnalysis.filter(i=>i.hasCompleteData&&i.price>0&&!i.hasEstimated);
    const averageMargin=itemsWithMargins.length>0?itemsWithMargins.reduce((s,i)=>s+i.margin,0)/itemsWithMargins.length:0;
    const lowMarginCount=itemsWithMargins.filter(i=>i.margin<LOW_MARGIN_THRESHOLD).length;
    const highMarginCount=itemsWithMargins.filter(i=>i.margin>=60).length;
    const ingredientTrends=ingredients.filter(i=>i.last_price>0).sort((a,b)=>parseFloat(b.last_price)-parseFloat(a.last_price)).slice(0,8).map(i=>({name:i.name,price:parseFloat(i.last_price),unit:i.unit}));
    const aiProfitScore=calculateAIProfitScore({itemsWithMargins,averageMargin,unpricedIngredients,totalIngredients:ingredients.length,totalMenuItems:menuItems.length,processedInvoices,totalInvoices:invoices.length});
    return {totalInvoices:invoices.length,totalIngredients:ingredients.length,totalMenuItems:menuItems.length,ingredientTrends,menuItemAnalysis,unpricedIngredients,averageMargin,totalSpending,aiProfitScore,lowMarginCount,highMarginCount,wasteRisk:wasteRisk||[],priceByCategory:priceByCategory||{}};
  }

  function calculateAIProfitScore({itemsWithMargins,averageMargin,unpricedIngredients,totalIngredients,totalMenuItems,processedInvoices,totalInvoices}){
    let score=0;
    score+=Math.min((averageMargin/60)*35,35);
    score+=totalIngredients>0?((totalIngredients-unpricedIngredients)/totalIngredients)*15:0;
    score+=totalMenuItems>0?(itemsWithMargins.length/totalMenuItems)*15:0;
    score+=totalInvoices>0?(processedInvoices.length/totalInvoices)*10:0;
    if(itemsWithMargins.length>0){const high=itemsWithMargins.filter(i=>i.margin>=50).length;const low=itemsWithMargins.filter(i=>i.margin<25).length;score+=Math.max(0,Math.min(15,((high/itemsWithMargins.length)*15)-((low/itemsWithMargins.length)*8)+5));}
    const thirtyAgo=new Date();thirtyAgo.setDate(thirtyAgo.getDate()-30);
    score+=Math.min((processedInvoices.filter(i=>new Date(i.date||i.created_at)>=thirtyAgo).length/2)*10,10);
    return {score:Math.max(0,Math.min(100,Math.round(score)))};
  }

  // ── GREETING ─────────────────────────────────────────────────────────────
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  // ── STAT CARDS CONFIG ─────────────────────────────────────────────────────
  const statCards = [
    {
      label: 'Avg food cost',
      value: `${(100 - data.averageMargin).toFixed(1)}%`,
      sub: `${data.averageMargin.toFixed(1)}% avg margin`,
      color: getMarginColor(data.averageMargin),
      iconBg: 'rgba(2,164,186,0.1)',
      iconColor: 'var(--accent)',
      icon: <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></svg>,
    },
    {
      label: 'Items over target',
      value: data.lowMarginCount,
      sub: data.lowMarginCount > 0 ? `${data.lowMarginCount} below ${LOW_MARGIN_THRESHOLD}%` : 'All items healthy',
      color: data.lowMarginCount > 0 ? 'var(--color-red)' : 'var(--color-green)',
      iconBg: data.lowMarginCount > 0 ? 'rgba(224,112,96,0.1)' : 'rgba(76,175,128,0.1)',
      iconColor: data.lowMarginCount > 0 ? 'var(--color-red)' : 'var(--color-green)',
      icon: <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>,
    },
    {
      label: 'Est. monthly savings',
      value: fmt(data.totalSpending * 0.03),
      sub: 'From pricing actions',
      color: 'var(--color-green)',
      iconBg: 'rgba(76,175,128,0.1)',
      iconColor: 'var(--color-green)',
      icon: <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>,
    },
    {
      label: 'Waste alerts',
      value: data.wasteRisk.length,
      sub: data.wasteRisk.length > 0 ? `${data.wasteRisk.filter(w=>w.protein).length} protein, ${data.wasteRisk.filter(w=>!w.protein).length} other` : 'Nothing expiring',
      color: data.wasteRisk.length > 0 ? 'var(--color-amber)' : 'var(--color-green)',
      iconBg: data.wasteRisk.length > 0 ? 'rgba(212,160,74,0.1)' : 'rgba(76,175,128,0.1)',
      iconColor: data.wasteRisk.length > 0 ? 'var(--color-amber)' : 'var(--color-green)',
      icon: <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
    },
  ];

  // ── DISH ICONS ────────────────────────────────────────────────────────────
  const dishIcons = [
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a10 10 0 100 20A10 10 0 0012 2z"/><path d="M12 6v6l4 2"/></svg>,
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 8h1a4 4 0 010 8h-1"/><path d="M3 8h14v9a4 4 0 01-4 4H7a4 4 0 01-4-4V8z"/></svg>,
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>,
  ];

  if (error) return (
    <>
      <style>{GLOBAL_CSS}</style>
      <div style={{background:'var(--bg-root)',height:'100vh',display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:12}}>
        <div style={{fontSize:16,color:'var(--text-primary)'}}>Unable to Load Dashboard</div>
        <div style={{fontSize:13,color:'var(--text-muted)',marginBottom:8}}>{error}</div>
        <button onClick={()=>window.location.reload()} style={{background:'var(--accent)',border:'none',borderRadius:6,padding:'8px 18px',color:'#0a0908',fontSize:13,fontWeight:600,cursor:'pointer',fontFamily:"'Inter',sans-serif"}}>Try Again</button>
      </div>
    </>
  );

  const wasteItems = [...data.wasteRisk.filter(w=>w.protein), ...data.wasteRisk.filter(w=>!w.protein)].slice(0,5);

  return (
    <>
      <style>{GLOBAL_CSS}</style>
      <Head>
        <title>Dashboard — OptiMenu</title>
      </Head>

      <div className="db2-root">

        {/* ── SIDEBAR ── */}
        <aside className="db2-sidebar">
          <div>
            {/* Brand */}
            <div className="db2-brand">
              <div className="db2-brand-mark">O</div>
              <div>
                <div className="db2-brand-name">OptiMenu</div>
                <div className="db2-brand-sub">Kitchen Intelligence</div>
              </div>
            </div>

            {/* Nav */}
            <nav className="db2-nav">
              {NAV_ITEMS.map(({ label, path, icon }) => {
                const active = path.includes('dashboard');
                return (
                  <button
                    key={label}
                    className={`db2-nav-item${active ? ' active' : ''}`}
                    onClick={() => router.push(path === '/client/dashboard2' ? '/client/dashboard' : path)}
                  >
                    {icon}
                    {label}
                  </button>
                );
              })}
            </nav>
          </div>

          {/* Footer */}
          <div className="db2-sidebar-footer">
            <div className="db2-avatar">{userName ? userName.slice(0,2).toUpperCase() : 'JM'}</div>
            <div>
              <div style={{fontSize:10,fontWeight:500,color:'#9a9086',lineHeight:1}}>{userName || 'User'}</div>
              <div style={{fontSize:8,color:'#3a3630',marginTop:2}}>General Manager</div>
            </div>
          </div>
        </aside>

        {/* ── MAIN ── */}
        <main className="db2-main">

          {/* Header */}
          <header className="db2-header">
            <div>
              <div className="db2-header-date">{new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'})}</div>
              <div className="db2-header-greeting">{greeting}, {userName}.</div>
              <div className="db2-header-sub">Here's what deserves your attention before tonight's service.</div>
            </div>
            <div className="db2-search-row">
              <div className="db2-search">
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="#3a3630" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <span className="db2-search-placeholder">Search menu items</span>
              </div>
              <div className="db2-icon-btn">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>
              </div>
              <ProfileDropdown userName={userName} userEmail={userEmail} isMobile={false}/>
            </div>
          </header>

          {/* Stat cards */}
          <div className="db2-stats-row">
            {statCards.map(({ label, value, sub, color, iconBg, iconColor, icon }) => (
              <div key={label} className="db2-stat">
                <div>
                  <div className="db2-stat-label">{label}</div>
                  <div className="db2-stat-value" style={{color}}>{value}</div>
                  <div className="db2-stat-sub">{sub}</div>
                </div>
                <div className="db2-stat-icon" style={{background:iconBg,color:iconColor}}>
                  {icon}
                </div>
              </div>
            ))}
          </div>

          {/* Body grid */}
          {loading ? (
            <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:10}}>
              <div className="db2-spinner" style={{width:22,height:22,borderWidth:2}}/>
              <div style={{fontSize:'clamp(10px,.78vw,13px)',color:'#4a453e'}}>Loading dashboard...</div>
            </div>
          ) : (
            <div className="db2-body">

              {/* ── LEFT COLUMN ── */}
              <div className="db2-left">

                {/* Tonight's Dish */}
                <div className="db2-card" style={{flex:'1 1 0'}}>
                  <div className="db2-card-hd">
                    <div>
                      <div className="db2-card-title">Tonight's Dish</div>
                      <div className="db2-card-sub">High-impact dishes to spotlight during service.</div>
                    </div>
                    <button className="db2-card-action">
                      View all
                      <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17L17 7"/><path d="M7 7h10v10"/></svg>
                    </button>
                  </div>

                  {aiLoading ? (
                    <div className="db2-empty">
                      <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:8}}>
                        <div className="db2-spinner"/>
                        <span style={{fontFamily:'Courier New,monospace',fontSize:10}}>Analyzing menu...</span>
                      </div>
                    </div>
                  ) : (data.aiRecommendations||[]).length > 0 ? (
                    <div style={{flex:1,overflow:'hidden',display:'flex',flexDirection:'column'}}>
                      {(data.aiRecommendations||[]).slice(0,3).map((rec, i) => {
                        const { label: ticketLabel, color: ticketColor } = getTicketMeta(i);
                        const badgeStyle = {
                          background: `color-mix(in srgb, ${ticketColor} 12%, transparent)`,
                          color: ticketColor,
                        };
                        return (
                          <div key={i} className="db2-dish-row">
                            <div className="db2-dish-icon">{dishIcons[i]}</div>
                            <div style={{flex:1,minWidth:0}}>
                              <div className="db2-dish-name">{rec.title||'—'}</div>
                              <div className="db2-dish-reason">{rec.description||''}</div>
                            </div>
                            <span className="db2-priority-badge" style={badgeStyle}>{ticketLabel}</span>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="db2-empty">No recommendations yet for today</div>
                  )}
                </div>

                {/* Waste Risk */}
                <div className="db2-card" style={{flex:'1 1 0'}}>
                  <div className="db2-card-hd">
                    <div>
                      <div className="db2-card-title">Waste Risk</div>
                      <div className="db2-card-sub">Ingredients requiring attention before service.</div>
                    </div>
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
                  </div>
                  <div style={{flex:1,overflow:'hidden',display:'flex',flexDirection:'column'}}>
                    {wasteItems.length === 0 ? (
                      <div className="db2-empty">No at-risk ingredients detected</div>
                    ) : (
                      wasteItems.map((item, i) => <WasteRow2 key={i} item={item} router={router}/>)
                    )}
                  </div>
                </div>

              </div>

              {/* ── RIGHT COLUMN ── */}
              <div className="db2-right">

                {/* Week in Review */}
                <div className="db2-card" style={{flex:'1.4 1 0'}}>
                  <div className="db2-card-hd">
                    <div>
                      <div className="db2-card-title">Week in Review</div>
                      <div className="db2-card-sub">Last seven days of nightly focus dishes.</div>
                    </div>
                    <span style={{fontSize:9,fontWeight:700,padding:'3px 8px',borderRadius:20,background:'rgba(76,175,128,0.1)',color:'var(--color-green)'}}>+6.4%</span>
                  </div>
                  <WeekInReviewNew
                    restaurantId={restaurantId}
                    wasteRisk={data.wasteRisk}
                    menuItems={menuItemsFull}
                  />
                </div>

                {/* Price Movement */}
                <div className="db2-card" style={{flex:'0.8 1 0'}}>
                  <div className="db2-card-hd">
                    <div>
                      <div className="db2-card-title">Price Movement</div>
                      <div className="db2-card-sub">Recent supplier price changes.</div>
                    </div>
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
                  </div>
                  <PriceMovementSimple priceByCategory={data.priceByCategory}/>
                </div>

              </div>

            </div>
          )}
        </main>

      </div>

      <Analytics/><SpeedInsights/>
      {tourProps&&<TourOverlay {...tourProps}/>}
      <TourDataBanner/>
    </>
  );
}