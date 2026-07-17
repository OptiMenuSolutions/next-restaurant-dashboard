// pages/client/analytics.js
// "SERVICE INTEL" — redesigned analytics.
// Same design language as The Pass dashboard: a dark room, quiet cards,
// exactly one hero. The old page's eight cards answered four questions
// with overlap; this page answers each question once:
//   1. How's revenue trending?     → Revenue (hero, top row)
//   2. What's moving up or down?   → Menu Movers (Top / Rising / Falling)
//   3. When are we busy?           → Service Rhythm (Day / Hour)
//   4. What's the menu mix?        → Category Mix
// Inventory Risk was removed — it's an ingredients/purchasing concern and
// its dish↔ingredient matching belongs next to real inventory data.
// All CSV upload, duplicate-detection, and persistence logic preserved.
import { useState, useEffect, useRef, useMemo } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import supabase from '../../lib/supabaseClient';
import { useWindowSize } from '../../lib/useWindowSize';
import { parseCSV, detectPOSSystem, buildColumnMapping, normalizeRows } from '../../lib/parsePOScsv';
import ProfileDropdown from '../../components/ProfileDropdown';
import { useTour } from '../../lib/useTour';
import TourOverlay from '../../components/TourOverlay';
import { fetchSampleData } from '../../lib/seedSampleData';
import TourDataBanner from '../../components/TourDataBanner';

// ── helpers ──────────────────────────────────────────────────────────────────
const fmt  = (n) => (!n && n !== 0) || isNaN(parseFloat(n)) ? '$0'
  : parseFloat(n).toLocaleString('en-US', { style:'currency', currency:'USD', minimumFractionDigits:0, maximumFractionDigits:0 });
const fmtD = (n) => (!n && n !== 0) || isNaN(parseFloat(n)) ? '$0.00'
  : parseFloat(n).toLocaleString('en-US', { style:'currency', currency:'USD', minimumFractionDigits:2, maximumFractionDigits:2 });
const dateOf = (s) => typeof s.sale_date === 'string' ? s.sale_date.slice(0, 10) : s.sale_date;
function formatHour(h) {
  if (h === 0) return '12am'; if (h === 12) return '12pm';
  return h < 12 ? `${h}am` : `${h - 12}pm`;
}
function formatDateLabel(str) {
  if (!str) return '';
  const [, m, d] = str.split('-');
  return `${parseInt(m)}/${parseInt(d)}`;
}
function shiftDateStr(str, days) {
  const d = new Date(`${str}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

const DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const DATE_RANGES = ['7d','14d','30d','All'];
const CAT_COLORS = ['var(--accent)','var(--color-amber)','var(--color-green)','var(--color-red)','#9b7ee8','#e85e8a','#4a9ede'];
const NAV_TABS = [
  { label:'Dashboard',   path:'/client/dashboard' },
  { label:'Invoices',    path:'/client/invoices' },
  { label:'Ingredients', path:'/client/ingredients' },
  { label:'Menu Items',  path:'/client/menu-items' },
  { label:'Analytics',   path:'/client/analytics' },
];
const MAPPER_FIELDS = [
  { f:'item_name',     req:true  }, { f:'sale_date',  req:true  },
  { f:'quantity_sold', req:true  }, { f:'revenue',    req:true  },
  { f:'category',      req:false }, { f:'unit_price', req:false },
  { f:'hour_of_day',   req:false }, { f:'voids',      req:false }, { f:'comps', req:false },
];

// ── CSS ──────────────────────────────────────────────────────────────────────
const GLOBAL_CSS = `
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
  html,body{height:100%;background:var(--bg-root);overflow:hidden;}
  #__next{height:100%;}
  @keyframes spin{to{transform:rotate(360deg);}}
  @keyframes blink{0%,100%{opacity:1}50%{opacity:.3}}
  @keyframes fadeIn{from{opacity:0;transform:translateY(4px);}to{opacity:1;transform:translateY(0);}}
  @media (prefers-reduced-motion: reduce){
    *,*::before,*::after{animation-duration:.01ms!important;transition-duration:.01ms!important;}
  }
  input::placeholder{color:var(--text-faint)!important;}
  ::-webkit-scrollbar{width:3px;}
  ::-webkit-scrollbar-track{background:transparent;}
  ::-webkit-scrollbar-thumb{background:var(--border);border-radius:2px;}

  .an4-root{font-family:'Inter',sans-serif;background:var(--bg-root);color:var(--text-primary);width:100%;height:100vh;display:flex;flex-direction:column;overflow:hidden;}

  /* ── TOP BAR (matches dashboard) ── */
  .an4-topbar{height:clamp(40px,4.4vh,50px);flex-shrink:0;display:flex;align-items:center;justify-content:space-between;padding:0 clamp(16px,2vw,32px);border-bottom:1px solid var(--border);background:var(--bg-elevated);}
  .an4-logo{font-family:'Inter',sans-serif;font-weight:700;font-size:clamp(15px,1.15vw,20px);letter-spacing:-.3px;color:var(--text-primary);}
  .an4-logo span{color:var(--accent);}
  .an4-tabs{display:flex;gap:2px;}
  .an4-tab{padding:5px 12px;border-radius:6px;font-size:clamp(10px,.78vw,13px);color:var(--text-muted);border:none;background:none;cursor:pointer;font-family:'Inter',sans-serif;transition:color .15s,background .15s;}
  .an4-tab:hover{color:var(--text-secondary);}
  .an4-tab.active{color:var(--text-primary);background:var(--bg-inset);}
  .an4-tab:focus-visible,button:focus-visible{outline:2px solid var(--accent);outline-offset:2px;}

  /* ── PAGE HEADER ── */
  .an4-ph{flex-shrink:0;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:clamp(8px,1vh,14px) clamp(16px,2vw,32px) 0;max-width:1600px;width:100%;margin:0 auto;}
  .an4-ph-title{font-family:'Inter',sans-serif;font-weight:600;font-size:clamp(15px,1.3vw,21px);letter-spacing:-.3px;color:var(--text-primary);line-height:1.2;}
  .an4-ph-title em{font-style:italic;color:var(--accent);}
  .an4-ph-stats{display:flex;align-items:center;gap:clamp(10px,1.2vw,20px);flex-wrap:wrap;}
  .an4-ph-stat{display:flex;align-items:baseline;gap:5px;}
  .an4-ph-stat-v{font-family:'Inter',sans-serif;font-variant-numeric:tabular-nums;font-size:clamp(11px,.92vw,15px);font-weight:700;letter-spacing:-.01em;}
  .an4-ph-stat-l{font-size:clamp(8px,.62vw,10px);color:var(--text-faint);white-space:nowrap;}
  .an4-sync{display:flex;align-items:center;gap:4px;font-size:clamp(8px,.6vw,10px);color:var(--color-green);background:color-mix(in srgb, var(--color-green) 8%, transparent);border:1px solid color-mix(in srgb, var(--color-green) 18%, transparent);border-radius:12px;padding:2px 8px;white-space:nowrap;}
  .an4-sync-dot{width:4px;height:4px;border-radius:50%;background:var(--color-green);animation:blink 2s infinite;flex-shrink:0;}
  .an4-range{display:flex;background:var(--bg-elevated);border:1px solid var(--border);border-radius:6px;padding:2px;gap:2px;}
  .an4-range-btn{padding:3px clamp(7px,.6vw,11px);border-radius:4px;font-size:clamp(9px,.66vw,11px);font-weight:500;cursor:pointer;border:none;font-family:'Inter',sans-serif;color:var(--text-muted);background:transparent;transition:color .15s,background .15s;font-variant-numeric:tabular-nums;}
  .an4-range-btn.active{background:var(--bg-inset);color:var(--text-primary);}
  .an4-btn-p{background:var(--accent);border:none;border-radius:6px;padding:clamp(4px,.45vh,7px) clamp(10px,.9vw,16px);font-size:clamp(9px,.7vw,12px);font-weight:600;color:#0a0908;cursor:pointer;font-family:'Inter',sans-serif;white-space:nowrap;transition:filter .15s;}
  .an4-btn-p:hover{filter:brightness(1.1);}
  .an4-btn-g{background:none;border:1px solid var(--border);border-radius:6px;padding:clamp(4px,.45vh,7px) clamp(10px,.9vw,16px);font-size:clamp(9px,.7vw,12px);color:var(--text-muted);cursor:pointer;font-family:'Inter',sans-serif;white-space:nowrap;transition:color .15s,border-color .15s;}
  .an4-btn-g:hover{color:var(--text-primary);border-color:var(--text-faint);}

  /* ── BODY GRID ── */
  .an4-body{flex:1;min-height:0;display:grid;grid-template-columns:2fr 1fr;grid-template-rows:1.15fr 1fr;gap:clamp(10px,1.2vw,18px);padding:clamp(8px,1vh,14px) clamp(16px,2vw,32px) clamp(10px,1.2vh,16px);overflow:hidden;max-width:1600px;width:100%;margin:0 auto;}
  .an4-card{background:var(--bg-surface);border:1px solid var(--border);border-radius:10px;padding:clamp(10px,1vw,16px);display:flex;flex-direction:column;overflow:hidden;min-height:0;animation:fadeIn .3s ease both;}
  .an4-card.hero{border-color:color-mix(in srgb, var(--accent) 22%, var(--border));}
  .an4-card-hd{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:clamp(6px,.7vh,10px);flex-shrink:0;flex-wrap:wrap;}
  .an4-card-title{font-size:clamp(10px,.78vw,13px);font-weight:600;color:var(--text-primary);display:flex;align-items:baseline;gap:6px;}
  .an4-card-sub{font-size:clamp(8px,.58vw,10px);color:var(--text-faint);font-weight:400;}
  .an4-toggle{display:flex;background:var(--bg-elevated);border-radius:6px;padding:2px;gap:2px;}
  .an4-toggle-btn{padding:2px clamp(7px,.6vw,11px);border-radius:4px;font-size:clamp(8px,.62vw,10px);cursor:pointer;border:none;font-family:'Inter',sans-serif;color:var(--text-muted);background:transparent;transition:color .15s,background .15s;}
  .an4-toggle-btn.active{background:var(--bg-inset);color:var(--text-primary);}
  .an4-empty{flex:1;display:flex;align-items:center;justify-content:center;font-size:clamp(10px,.72vw,12px);color:var(--text-muted);text-align:center;padding:8px;line-height:1.5;}
  .an4-spinner{width:16px;height:16px;border:2px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:spin .7s linear infinite;}
  .an4-scroll{flex:1;min-height:0;overflow-y:auto;}

  /* bar rows */
  .an4-row{display:flex;align-items:center;gap:clamp(6px,.55vw,9px);padding:clamp(3px,.35vh,6px) 0;}
  .an4-row-label{font-size:clamp(9px,.68vw,12px);color:var(--text-secondary);width:clamp(70px,7vw,120px);flex-shrink:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .an4-track{flex:1;height:4px;background:var(--border-subtle);border-radius:2px;overflow:hidden;}
  .an4-fill{height:100%;border-radius:2px;transition:width .4s ease;}
  .an4-row-val{font-family:'Inter',sans-serif;font-variant-numeric:tabular-nums;font-size:clamp(9px,.68vw,12px);font-weight:600;width:clamp(40px,3.8vw,64px);text-align:right;flex-shrink:0;}
  .an4-row-pct{font-family:'Inter',sans-serif;font-variant-numeric:tabular-nums;font-size:clamp(8px,.6vw,10px);color:var(--text-faint);width:30px;text-align:right;flex-shrink:0;}
  .an4-delta{font-family:'Inter',sans-serif;font-variant-numeric:tabular-nums;font-size:clamp(9px,.66vw,11px);font-weight:700;width:clamp(38px,3.4vw,50px);text-align:right;flex-shrink:0;}
  .an4-badge{font-size:clamp(7px,.55vw,9px);font-weight:700;letter-spacing:.06em;padding:1px 6px;border-radius:8px;white-space:nowrap;text-transform:uppercase;}
  .an4-badge.slow{background:color-mix(in srgb, var(--color-red) 10%, transparent);color:var(--color-red);border:1px solid color-mix(in srgb, var(--color-red) 22%, transparent);}
  .an4-mini{font-family:'Inter',sans-serif;font-variant-numeric:tabular-nums;font-size:clamp(8px,.58vw,10px);color:var(--text-faint);white-space:nowrap;flex-shrink:0;}

  /* rhythm: hour strip */
  .an4-hours{display:flex;gap:3px;align-items:stretch;flex-shrink:0;}
  .an4-hour{flex:1;border-radius:5px;display:flex;align-items:flex-end;justify-content:center;cursor:pointer;min-height:clamp(30px,4.5vh,58px);border:none;padding:0 0 3px;transition:outline .15s;outline:2px solid transparent;outline-offset:2px;}
  .an4-hour span{font-size:clamp(7px,.5vw,9px);font-family:'Inter',sans-serif;}
  .an4-legend{display:flex;gap:10px;flex-wrap:wrap;margin-top:clamp(5px,.5vh,8px);padding-top:clamp(5px,.5vh,7px);border-top:1px solid var(--border-subtle);flex-shrink:0;font-size:clamp(7px,.55vw,9px);color:var(--text-faint);}
  .an4-dot{width:6px;height:6px;border-radius:2px;display:inline-block;margin-right:3px;}
  .an4-hour-detail{margin-top:clamp(6px,.6vh,9px);background:var(--bg-elevated);border:1px solid var(--border-subtle);border-radius:8px;padding:clamp(7px,.7vh,11px) clamp(9px,.85vw,13px);display:flex;gap:clamp(14px,1.6vw,26px);align-items:center;flex-shrink:0;animation:fadeIn .2s ease both;}
  .an4-hd-stat-l{font-size:clamp(7px,.52vw,9px);color:var(--text-faint);text-transform:uppercase;letter-spacing:.08em;margin-bottom:2px;}
  .an4-hd-stat-v{font-family:'Inter',sans-serif;font-variant-numeric:tabular-nums;font-size:clamp(12px,1vw,16px);font-weight:700;line-height:1;}

  /* modals */
  .an4-overlay{position:fixed;inset:0;z-index:50;background:color-mix(in srgb, var(--bg-root) 90%, transparent);backdrop-filter:blur(2px);display:flex;align-items:center;justify-content:center;padding:16px;}
  .an4-modal{background:var(--bg-surface);border:1px solid var(--border);border-radius:12px;width:min(680px,94%);max-height:86vh;display:flex;flex-direction:column;overflow:hidden;animation:fadeIn .2s ease both;}
  .an4-modal-hd{padding:clamp(12px,1.3vw,20px);border-bottom:1px solid var(--border);display:flex;align-items:flex-start;justify-content:space-between;gap:10px;flex-shrink:0;}
  .an4-modal-title{font-size:clamp(13px,1vw,16px);font-weight:600;color:var(--text-primary);}
  .an4-modal-sub{font-size:clamp(9px,.68vw,11px);color:var(--text-muted);margin-top:3px;}
  .an4-modal-x{background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:18px;line-height:1;padding:4px;flex-shrink:0;}
  .an4-modal-bd{flex:1;overflow-y:auto;padding:clamp(10px,1.1vw,18px);min-height:0;}
  .an4-modal-ft{padding:clamp(10px,1vw,16px);border-top:1px solid var(--border);display:flex;gap:10px;flex-shrink:0;}
  .an4-map-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:clamp(8px,.8vw,12px);}
  .an4-map-lbl{font-size:clamp(8px,.62vw,10px);color:var(--text-faint);text-transform:uppercase;letter-spacing:.06em;font-weight:600;margin-bottom:4px;}
  .an4-map-lbl.req::after{content:' *';color:var(--color-red);}
  .an4-map-sel{background:var(--bg-elevated);border:1px solid var(--border);border-radius:6px;padding:7px 10px;font-size:clamp(10px,.78vw,13px);color:var(--text-primary);outline:none;font-family:'Inter',sans-serif;width:100%;cursor:pointer;}
  .an4-map-sel:focus{border-color:var(--accent);}
  .an4-err{font-size:clamp(9px,.72vw,12px);color:var(--color-red);margin-top:10px;}
  .an4-upload-row{background:var(--bg-elevated);border:1px solid var(--border-subtle);border-radius:8px;padding:clamp(9px,.9vw,14px);margin-bottom:8px;}
  .an4-link-btn{font-size:clamp(8px,.62vw,10px);color:var(--accent);background:none;border:none;cursor:pointer;font-family:'Inter',sans-serif;padding:0;opacity:.85;}
  .an4-link-btn:hover{opacity:1;}
`;

// ── TrendLine (responsive SVG) ───────────────────────────────────────────────
const PAD = { left: 52, right: 12, top: 10, bottom: 24 };

function TrendLine({ data, valueKey = 'rev', color = 'var(--accent)' }) {
  const wrapRef = useRef(null);
  const [dims, setDims] = useState({ width: 0, height: 0 });
  const [tip, setTip] = useState(null);
  const [activeIdx, setActiveIdx] = useState(null);

  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      setDims({ width: Math.floor(width), height: Math.floor(height) });
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  const pts = data;
  const { width: W, height: H } = dims;
  const cW = W - PAD.left - PAD.right;
  const cH = H - PAD.top - PAD.bottom;

  if (!W || !H) return <div ref={wrapRef} style={{ flex:1, minHeight:0 }} />;
  if (!pts || pts.length < 2) {
    return (
      <div ref={wrapRef} style={{ flex:1, minHeight:0, display:'flex', alignItems:'center', justifyContent:'center' }}>
        <div style={{ fontSize:11, color:'var(--text-muted)', textAlign:'center', lineHeight:1.5 }}>Not enough data yet — upload at least 2 days of sales</div>
      </div>
    );
  }

  const vals = pts.map(d => d[valueKey]);
  const rawMax = Math.max(...vals, 1);
  const rawMin = Math.min(...vals, 0);
  const mag = Math.pow(10, Math.floor(Math.log10(rawMax)));
  const yMax = Math.ceil((rawMax * 1.08) / mag) * mag;
  const yMin = Math.max(0, rawMin - (rawMax - rawMin) * 0.15);
  const xOf = i => PAD.left + (i / (pts.length - 1)) * cW;
  const yOf = v => PAD.top + cH - ((v - yMin) / (yMax - yMin || 1)) * cH;

  const linePath = pts.map((d, i) => `${i === 0 ? 'M' : 'L'}${xOf(i).toFixed(1)},${yOf(d[valueKey]).toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L${xOf(pts.length - 1).toFixed(1)},${yOf(yMin).toFixed(1)} L${xOf(0).toFixed(1)},${yOf(yMin).toFixed(1)} Z`;
  const yTicks = [yMin, (yMin + yMax) / 2, yMax];
  const xLabelIdxs = (() => {
    if (pts.length <= 6) return pts.map((_, i) => i);
    const step = Math.ceil((pts.length - 1) / 5);
    const idxs = [];
    for (let i = 0; i < pts.length; i += step) idxs.push(i);
    if (idxs[idxs.length - 1] !== pts.length - 1) idxs.push(pts.length - 1);
    return [...new Set(idxs)];
  })();
  const gradId = `an4g_${valueKey}`;
  const clipId = `an4c_${valueKey}`;

  return (
    <div ref={wrapRef} style={{ flex:1, minHeight:0, position:'relative' }}>
      <svg width={W} height={H} style={{ display:'block', overflow:'visible' }} role="img" aria-label="Daily trend">
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.12" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
          <clipPath id={clipId}><rect x={PAD.left} y={PAD.top} width={cW} height={cH} /></clipPath>
        </defs>
        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={PAD.left} y1={yOf(t)} x2={W - PAD.right} y2={yOf(t)} stroke="var(--border-subtle)" strokeWidth={0.75} />
            <text x={PAD.left - 6} y={yOf(t)} textAnchor="end" dominantBaseline="middle" fontSize={10} fill="var(--text-faint)" fontFamily="Inter, sans-serif">
              {valueKey === 'rev' ? fmt(t) : Math.round(t)}
            </text>
          </g>
        ))}
        <line x1={PAD.left} y1={yOf(yMin)} x2={W - PAD.right} y2={yOf(yMin)} stroke="var(--border)" strokeWidth={0.75} />
        <path d={areaPath} fill={`url(#${gradId})`} clipPath={`url(#${clipId})`} />
        <path d={linePath} fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" clipPath={`url(#${clipId})`} />
        {pts.map((d, i) => (
          <circle key={`d${i}`} cx={xOf(i)} cy={yOf(d[valueKey])} r={activeIdx === i ? 5 : 3} fill={color}
            stroke={activeIdx === i ? 'var(--bg-root)' : 'none'} strokeWidth={activeIdx === i ? 2 : 0}
            style={{ transition:'r .1s', pointerEvents:'none' }} />
        ))}
        {pts.map((d, i) => (
          <circle key={`h${i}`} cx={xOf(i)} cy={yOf(d[valueKey])} r={24} fill="transparent" style={{ cursor:'crosshair' }}
            onMouseEnter={e => { setActiveIdx(i); setTip({ x:e.clientX, y:e.clientY, d }); }}
            onMouseMove={e => setTip(prev => prev ? { ...prev, x:e.clientX, y:e.clientY } : null)}
            onMouseLeave={() => { setActiveIdx(null); setTip(null); }} />
        ))}
        {activeIdx !== null && (
          <line x1={xOf(activeIdx)} y1={PAD.top} x2={xOf(activeIdx)} y2={PAD.top + cH}
            stroke={color} strokeWidth={1} strokeDasharray="3 3" opacity={0.4} />
        )}
        {xLabelIdxs.map(i => (
          <text key={i} x={xOf(i)} y={H - 5}
            textAnchor={i === 0 ? 'start' : i === pts.length - 1 ? 'end' : 'middle'}
            fontSize={10} fill={activeIdx === i ? color : 'var(--text-faint)'} fontFamily="Inter, sans-serif">
            {formatDateLabel(pts[i].date)}
          </text>
        ))}
      </svg>
      {tip && (
        <div style={{ position:'fixed', left:tip.x + 14, top:tip.y - 52, background:'var(--bg-elevated)', border:'1px solid var(--border)', borderRadius:7, padding:'6px 10px', fontSize:11, pointerEvents:'none', whiteSpace:'nowrap', zIndex:999, boxShadow:'0 4px 14px rgba(0,0,0,.45)' }}>
          <div style={{ fontWeight:700, color, marginBottom:2, fontVariantNumeric:'tabular-nums' }}>
            {valueKey === 'rev' ? fmtD(tip.d[valueKey]) : `${Math.round(tip.d[valueKey])} items`}
          </div>
          <div style={{ color:'var(--text-muted)', fontSize:10 }}>{formatDateLabel(tip.d.date)}</div>
        </div>
      )}
    </div>
  );
}

// ── Menu Movers card body ────────────────────────────────────────────────────
function MoversList({ tab, metric, topSellers, risers, fallers }) {
  if (tab === 'top') {
    if (!topSellers.length) return <div className="an4-empty">No items yet</div>;
    const max = Math.max(...topSellers.map(i => metric === 'qty' ? i.qty : i.rev), 1);
    return (
      <div className="an4-scroll">
        {topSellers.map((item, i) => (
          <div key={item.name} className="an4-row">
            <span className="an4-mini" style={{ width:16, textAlign:'right' }}>{i + 1}</span>
            <div className="an4-row-label" style={{ color:'var(--text-primary)' }}>{item.name}</div>
            <div className="an4-track"><div className="an4-fill" style={{ width:`${((metric === 'qty' ? item.qty : item.rev) / max) * 100}%`, background:'var(--accent)' }} /></div>
            <div className="an4-row-val" style={{ color:'var(--accent)' }}>{metric === 'qty' ? Math.round(item.qty) : fmt(item.rev)}</div>
          </div>
        ))}
      </div>
    );
  }
  const list = tab === 'rising' ? risers : fallers;
  const color = tab === 'rising' ? 'var(--color-green)' : 'var(--color-red)';
  if (!list.length) return <div className="an4-empty">{tab === 'rising' ? 'Nothing trending up this week' : 'Nothing falling off — all items on pace'}</div>;
  return (
    <div className="an4-scroll">
      {list.map(item => (
        <div key={item.name} className="an4-row">
          <div className="an4-row-label" style={{ color:'var(--text-primary)' }}>{item.name}</div>
          <span className="an4-mini">{Math.round(item.prev)} → {Math.round(item.curr)}</span>
          <div className="an4-track"><div className="an4-fill" style={{ width:`${Math.min(100, Math.abs(item.change))}%`, background:color }} /></div>
          <div className="an4-delta" style={{ color }}>{item.change > 0 ? '+' : ''}{item.change.toFixed(0)}%</div>
          {tab === 'falling' && item.change <= -20 && <span className="an4-badge slow">slow</span>}
        </div>
      ))}
    </div>
  );
}

// ── Service Rhythm card body ─────────────────────────────────────────────────
function RhythmBody({ view, metric, dayOfWeekData, hourlyData }) {
  const [openHour, setOpenHour] = useState(null);

  if (view === 'day') {
    if (!dayOfWeekData.some(d => d.qty > 0)) return <div className="an4-empty">No data yet</div>;
    const max = Math.max(...dayOfWeekData.map(d => metric === 'qty' ? d.qty : d.rev), 1);
    return (
      <div style={{ flex:1, minHeight:0, display:'flex', flexDirection:'column', justifyContent:'space-evenly' }}>
        {dayOfWeekData.map(d => {
          const v = metric === 'qty' ? d.qty : d.rev;
          const has = d.qty > 0;
          return (
            <div key={d.day} className="an4-row">
              <div className="an4-row-label" style={{ width:34, fontWeight:600, color: has ? 'var(--text-primary)' : 'var(--text-faint)' }}>{d.day.slice(0, 3)}</div>
              <div className="an4-track"><div className="an4-fill" style={{ width: has ? `${(v / max) * 100}%` : '0%', background:'var(--color-amber)' }} /></div>
              <div className="an4-row-val" style={{ color:'var(--color-amber)' }}>{has ? (metric === 'qty' ? Math.round(v) : fmt(v)) : '—'}</div>
            </div>
          );
        })}
      </div>
    );
  }

  if (!hourlyData.length) return <div className="an4-empty">No hourly data — map an hour column when uploading</div>;
  const maxHourQty = Math.max(...hourlyData.map(h => h.qty), 1);
  const totalQty = hourlyData.reduce((s, h) => s + h.qty, 0);
  const open = openHour !== null ? hourlyData.find(h => h.hour === openHour) : null;
  return (
    <div style={{ flex:1, minHeight:0, display:'flex', flexDirection:'column', justifyContent:'center' }}>
      <div className="an4-hours">
        {hourlyData.map(h => {
          const t = h.qty / maxHourQty;
          const bg = t > 0.7 ? 'var(--color-red)' : t > 0.4 ? 'var(--color-amber)' : t > 0.1 ? 'var(--accent)' : 'var(--border-subtle)';
          const active = openHour === h.hour;
          return (
            <button key={h.hour} type="button" className="an4-hour" aria-pressed={active}
              onClick={() => setOpenHour(active ? null : h.hour)}
              style={{ background:bg, opacity: t > 0 ? 0.3 + t * 0.7 : 0.25, outlineColor: active ? bg : 'transparent' }}>
              <span style={{ color: t > 0.5 ? '#0a0908' : 'var(--text-muted)' }}>{formatHour(h.hour)}</span>
            </button>
          );
        })}
      </div>
      {open && (
        <div className="an4-hour-detail">
          <div style={{ fontSize:'clamp(11px,.85vw,14px)', fontWeight:700, color:'var(--text-primary)' }}>{formatHour(open.hour)}</div>
          <div><div className="an4-hd-stat-l">Items sold</div><div className="an4-hd-stat-v" style={{ color:'var(--accent)' }}>{Math.round(open.qty)}</div></div>
          <div><div className="an4-hd-stat-l">% of day</div><div className="an4-hd-stat-v" style={{ color:'var(--color-amber)' }}>{totalQty > 0 ? ((open.qty / totalQty) * 100).toFixed(1) : 0}%</div></div>
          <div><div className="an4-hd-stat-l">vs peak</div><div className="an4-hd-stat-v" style={{ color:'var(--color-green)' }}>{((open.qty / maxHourQty) * 100).toFixed(0)}%</div></div>
          <button type="button" className="an4-modal-x" style={{ marginLeft:'auto' }} onClick={() => setOpenHour(null)} aria-label="Close">×</button>
        </div>
      )}
      <div className="an4-legend">
        {[{ c:'var(--color-red)', l:'Peak' }, { c:'var(--color-amber)', l:'Busy' }, { c:'var(--accent)', l:'Steady' }, { c:'var(--border-subtle)', l:'Quiet' }].map(({ c, l }) => (
          <span key={l}><span className="an4-dot" style={{ background:c }} />{l}</span>
        ))}
        <span style={{ marginLeft:'auto' }}>tap an hour to expand</span>
      </div>
    </div>
  );
}

// ── Upload Manager Modal ─────────────────────────────────────────────────────
function UploadManagerModal({ restaurantId, onClose, onDeleted }) {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(null);
  const [deleteStep, setDeleteStep] = useState(0);
  const [deleteInput, setDeleteInput] = useState('');

  useEffect(() => { loadSessions(); }, []);

  async function loadSessions() {
    setLoading(true);
    const { data } = await supabase.from('upload_sessions').select('*').eq('restaurant_id', restaurantId).order('uploaded_at', { ascending:false });
    setSessions(data || []);
    setLoading(false);
  }
  function startDelete(s) { setDeleting(s); setDeleteStep(1); setDeleteInput(''); }
  function cancelDelete() { setDeleting(null); setDeleteStep(0); setDeleteInput(''); }
  async function confirmDelete() {
    if (!deleting) return;
    const { error } = await supabase.from('upload_sessions').delete().eq('id', deleting.id);
    if (!error) {
      try {
        await supabase.from('activity_logs').insert({
          restaurant_id: restaurantId, activity_type:'pos_upload_deleted', title:'POS Upload Deleted',
          subtitle: deleting.filename || 'Unknown file',
          details: `Deleted ${deleting.row_count} records from ${deleting.date_from} to ${deleting.date_to}`,
          metadata: { session_id: deleting.id, row_count: deleting.row_count },
        });
      } catch {}
      cancelDelete();
      await loadSessions();
      onDeleted();
    }
  }

  return (
    <div className="an4-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="an4-modal">
        <div className="an4-modal-hd">
          <div>
            <div className="an4-modal-title">Upload History</div>
            <div className="an4-modal-sub">Manage your uploaded POS files</div>
          </div>
          <button className="an4-modal-x" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="an4-modal-bd">
          {loading ? (
            <div style={{ display:'flex', alignItems:'center', justifyContent:'center', padding:40, gap:10, color:'var(--text-muted)', fontSize:13 }}>
              <div className="an4-spinner" />Loading...
            </div>
          ) : sessions.length === 0 ? (
            <div style={{ textAlign:'center', padding:40, fontSize:13, color:'var(--text-muted)' }}>No uploads yet</div>
          ) : sessions.map(s => (
            <div key={s.id} className="an4-upload-row">
              {deleting?.id === s.id ? (
                <div>
                  {deleteStep === 1 && (<>
                    <div style={{ fontSize:13, fontWeight:600, color:'var(--color-red)', marginBottom:6 }}>Delete this upload?</div>
                    <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:12, lineHeight:1.5 }}>
                      This permanently removes <strong style={{ color:'var(--text-primary)' }}>{s.row_count.toLocaleString()} records</strong> from {s.date_from} to {s.date_to}.
                    </div>
                    <div style={{ display:'flex', gap:8 }}>
                      <button className="an4-btn-g" style={{ color:'var(--color-red)', borderColor:'color-mix(in srgb, var(--color-red) 30%, transparent)' }} onClick={() => setDeleteStep(2)}>Yes, continue</button>
                      <button className="an4-btn-g" onClick={cancelDelete}>Cancel</button>
                    </div>
                  </>)}
                  {deleteStep === 2 && (<>
                    <div style={{ fontSize:13, fontWeight:600, color:'var(--color-red)', marginBottom:6 }}>Final confirmation</div>
                    <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:10 }}>Type <strong style={{ color:'var(--text-primary)', fontFamily:'monospace' }}>DELETE</strong> to permanently remove this data.</div>
                    <input autoFocus value={deleteInput} onChange={e => setDeleteInput(e.target.value)} placeholder="Type DELETE"
                      style={{ background:'var(--bg-surface)', border:`1px solid ${deleteInput === 'DELETE' ? 'var(--color-red)' : 'var(--border)'}`, borderRadius:6, padding:'7px 10px', fontSize:12, color:'var(--text-primary)', outline:'none', fontFamily:'monospace', width:'100%', marginBottom:10 }} />
                    <div style={{ display:'flex', gap:8 }}>
                      <button className="an4-btn-g" disabled={deleteInput !== 'DELETE'}
                        style={{ color: deleteInput === 'DELETE' ? 'var(--color-red)' : 'var(--text-faint)', borderColor: deleteInput === 'DELETE' ? 'color-mix(in srgb, var(--color-red) 40%, transparent)' : 'var(--border)', cursor: deleteInput === 'DELETE' ? 'pointer' : 'not-allowed' }}
                        onClick={confirmDelete}>Permanently Delete</button>
                      <button className="an4-btn-g" onClick={cancelDelete}>Cancel</button>
                    </div>
                  </>)}
                </div>
              ) : (
                <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:12, fontWeight:600, color:'var(--text-primary)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{s.filename || 'Uploaded file'}</div>
                    <div style={{ fontSize:10, color:'var(--text-muted)', marginTop:2, fontVariantNumeric:'tabular-nums' }}>{s.date_from} → {s.date_to} · {s.row_count.toLocaleString()} records · {s.pos_system || 'unknown POS'}</div>
                    <div style={{ fontSize:10, color:'var(--text-faint)', marginTop:1 }}>{new Date(s.uploaded_at).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric', hour:'2-digit', minute:'2-digit' })}</div>
                  </div>
                  <button className="an4-btn-g" style={{ color:'var(--color-red)', borderColor:'color-mix(in srgb, var(--color-red) 20%, transparent)', flexShrink:0 }} onClick={() => startDelete(s)}>Delete</button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Duplicate Detection Modal ────────────────────────────────────────────────
function DuplicateModal({ incoming, existing, onProceed, onCancel }) {
  return (
    <div className="an4-overlay" style={{ zIndex:60 }}>
      <div className="an4-modal" style={{ borderColor:'color-mix(in srgb, var(--color-amber) 30%, var(--border))' }}>
        <div className="an4-modal-hd">
          <div>
            <div className="an4-modal-title" style={{ color:'var(--color-amber)' }}>Duplicate upload detected</div>
            <div className="an4-modal-sub">This file covers dates that overlap with an existing upload.</div>
          </div>
        </div>
        <div className="an4-modal-bd" style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
          {[
            { label:'Existing upload', name: existing.filename || 'Previous upload', from: existing.date_from, to: existing.date_to, count: existing.row_count, hl:false },
            { label:'New upload', name: incoming.filename, from: incoming.dateFrom, to: incoming.dateTo, count: incoming.rowCount, hl:true },
          ].map(x => (
            <div key={x.label} className="an4-upload-row" style={{ margin:0, borderColor: x.hl ? 'color-mix(in srgb, var(--color-amber) 25%, transparent)' : 'var(--border-subtle)' }}>
              <div style={{ fontSize:9, color: x.hl ? 'var(--color-amber)' : 'var(--text-faint)', textTransform:'uppercase', letterSpacing:'.08em', marginBottom:8, fontWeight:700 }}>{x.label}</div>
              <div style={{ fontSize:12, color:'var(--text-primary)', fontWeight:600, marginBottom:4, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{x.name}</div>
              <div style={{ fontSize:11, color:'var(--text-muted)', fontVariantNumeric:'tabular-nums' }}>{x.from} → {x.to}</div>
              <div style={{ fontSize:11, color:'var(--text-muted)', fontVariantNumeric:'tabular-nums' }}>{x.count?.toLocaleString()} records</div>
            </div>
          ))}
        </div>
        <div className="an4-modal-ft">
          <button className="an4-btn-p" onClick={onProceed}>Import anyway</button>
          <button className="an4-btn-g" onClick={onCancel}>Cancel upload</button>
        </div>
      </div>
    </div>
  );
}

// ── MAIN EXPORT ──────────────────────────────────────────────────────────────
export default function AnalyticsPage() {
  const router = useRouter();
  const { width } = useWindowSize();
  const isMobile = width < 480;
  const fileInputRef = useRef(null);
  const pendingUploadRef = useRef(null);

  const [restaurantId, setRestaurantId] = useState(null);
  const [userName, setUserName] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedPOS, setSelectedPOS] = useState('other');
  const [detectedPOS, setDetectedPOS] = useState(null);
  const [uploadStep, setUploadStep] = useState('idle'); // idle | mapping | uploading | done
  const [csvRows, setCsvRows] = useState([]);
  const [csvHeaders, setCsvHeaders] = useState([]);
  const [columnMapping, setColumnMapping] = useState({});
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadMsg, setUploadMsg] = useState('');
  const [pendingFilename, setPendingFilename] = useState('');
  const [uploadSuccessMsg, setUploadSuccessMsg] = useState('');
  const [duplicateInfo, setDuplicateInfo] = useState(null);
  const [showUploadManager, setShowUploadManager] = useState(false);

  const [dateRange, setDateRange] = useState('14d');
  const [moversTab, setMoversTab] = useState('top');       // top | rising | falling
  const [moversMetric, setMoversMetric] = useState('qty'); // qty | rev
  const [rhythmView, setRhythmView] = useState('day');     // day | hour
  const [rhythmMetric, setRhythmMetric] = useState('qty');
  const [trendView, setTrendView] = useState('rev');       // rev | qty
  const [mobTab, setMobTab] = useState('overview');

  const [allSales, setAllSales] = useState([]);
  const [hasSalesData, setHasSalesData] = useState(false);
  const [salesMeta, setSalesMeta] = useState({ lastSync:null, posSystem:null });

  const { tourProps } = useTour('analytics', restaurantId);
  const isTour = router.isReady && router.query.tour === 'true';

  useEffect(() => { if (router.isReady) init(); }, [router.isReady]);

  useEffect(() => {
    if (!router.isReady || !isTour) return;
    fetchSampleData().then(sample => {
      if (!sample?.posSales) return;
      setAllSales(sample.posSales);
      setHasSalesData(true);
      setSalesMeta({ lastSync: sample.posSales[0]?.sale_date || null, posSystem:'tour' });
    });
  }, [router.isReady, isTour]);

  async function init() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/client/login'); return; }
      setUserEmail(user.email || '');
      const { data: profile } = await supabase.from('profiles').select('restaurant_id, full_name').eq('id', user.id).single();
      if (!profile?.restaurant_id) { setLoading(false); return; }
      if (!isTour) { setRestaurantId(profile.restaurant_id); await loadSalesData(profile.restaurant_id); }
      setUserName(profile.full_name ? profile.full_name.trim().split(' ')[0] : 'User');
    } catch (err) {
      console.error('[analytics] init error:', err);
    } finally {
      setLoading(false);
    }
  }

  async function loadSalesData(restId) {
    const PAGE_SIZE = 1000;
    const MAX_PAGES = 10; // hard cap at 10k rows
    let rows = [];
    let from = 0;
    let pages = 0;
    while (pages < MAX_PAGES) {
      const { data, error } = await supabase
        .from('pos_sales').select('*').eq('restaurant_id', restId)
        .order('sale_date', { ascending:false })
        .range(from, from + PAGE_SIZE - 1);
      if (error || !data?.length) break;
      rows = rows.concat(data);
      pages++;
      if (data.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }
    if (!rows.length) { setHasSalesData(false); setAllSales([]); return; }
    setHasSalesData(true);
    setAllSales(rows);
    setSalesMeta({ lastSync: rows[0]?.sale_date || null, posSystem: rows[0]?.pos_system || null });
  }

  // ── All analytics derived in one pass. Windows are anchored to the latest
  //    sale date in the data (not "today"), so an old upload still reads sanely.
  const A = useMemo(() => {
    if (!allSales.length) return null;
    const anchor = allSales.reduce((a, s) => { const d = dateOf(s); return d > a ? d : a; }, '0000-00-00');

    let filtered = allSales;
    if (dateRange !== 'All') {
      const days = dateRange === '7d' ? 7 : dateRange === '14d' ? 14 : 30;
      const cutoff = shiftDateStr(anchor, -(days - 1));
      filtered = allSales.filter(s => dateOf(s) >= cutoff);
    }
    if (!filtered.length) return null;

    // stats + daily trend
    const dailyMap = {};
    let totalRevenue = 0;
    for (const s of filtered) {
      const d = dateOf(s);
      const rev = parseFloat(s.revenue || 0);
      const qty = parseFloat(s.quantity_sold || 0);
      totalRevenue += rev;
      if (!dailyMap[d]) dailyMap[d] = { date:d, rev:0, qty:0 };
      dailyMap[d].rev += rev;
      dailyMap[d].qty += qty;
    }
    const trendData = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));
    const totalDays = trendData.length;
    const stats = { totalDays, totalRevenue, avgDailyRevenue: totalDays > 0 ? totalRevenue / totalDays : 0 };

    // per-item totals (within range)
    const itemMap = {};
    for (const s of filtered) {
      if (!itemMap[s.item_name]) itemMap[s.item_name] = { name:s.item_name, qty:0, rev:0, category:s.category };
      itemMap[s.item_name].qty += parseFloat(s.quantity_sold || 0);
      itemMap[s.item_name].rev += parseFloat(s.revenue || 0);
    }
    const items = Object.values(itemMap).sort((a, b) => b.qty - a.qty);
    const topSellers = items.slice(0, 8);

    // rising / falling: last 7d vs prior 7d, anchored to latest sale date,
    // computed over ALL sales so the comparison doesn't depend on the range toggle
    const recentCut = shiftDateStr(anchor, -6);
    const prevCut = shiftDateStr(anchor, -13);
    const recentMap = {}, prevMap = {};
    for (const s of allSales) {
      const d = dateOf(s);
      const qty = parseFloat(s.quantity_sold || 0);
      if (d >= recentCut) recentMap[s.item_name] = (recentMap[s.item_name] || 0) + qty;
      else if (d >= prevCut) prevMap[s.item_name] = (prevMap[s.item_name] || 0) + qty;
    }
    const movers = Object.keys({ ...recentMap, ...prevMap }).map(name => {
      const curr = recentMap[name] || 0;
      const prev = prevMap[name] || 0;
      const change = prev > 0 ? ((curr - prev) / prev) * 100 : curr > 0 ? 100 : 0;
      return { name, curr, prev, change };
    });
    const risers = movers.filter(m => m.change > 0 && m.curr > 0).sort((a, b) => b.change - a.change).slice(0, 6);
    const fallers = movers.filter(m => m.change < 0 && m.prev > 0).sort((a, b) => a.change - b.change).slice(0, 6);

    // day-of-week
    const dayMap = {};
    for (const d of DAYS) dayMap[d] = { day:d, qty:0, rev:0 };
    for (const s of filtered) {
      if (s.day_of_week && dayMap[s.day_of_week]) {
        dayMap[s.day_of_week].qty += parseFloat(s.quantity_sold || 0);
        dayMap[s.day_of_week].rev += parseFloat(s.revenue || 0);
      }
    }
    const dayOfWeekData = DAYS.map(d => dayMap[d]);

    // hourly (trimmed to open hours)
    const hourMap = {};
    for (const s of filtered) {
      if (s.hour_of_day !== null && s.hour_of_day !== undefined) {
        const h = parseInt(s.hour_of_day);
        hourMap[h] = (hourMap[h] || 0) + parseFloat(s.quantity_sold || 0);
      }
    }
    const hoursWithData = Object.keys(hourMap).map(Number).filter(h => hourMap[h] > 0).sort((a, b) => a - b);
    let hourlyData = [];
    if (hoursWithData.length) {
      const minH = hoursWithData[0], maxH = hoursWithData[hoursWithData.length - 1];
      hourlyData = Array.from({ length: maxH - minH + 1 }, (_, i) => ({ hour: minH + i, qty: hourMap[minH + i] || 0 }));
    }

    // category mix
    const catMap = {};
    for (const s of filtered) {
      const cat = s.category || 'Uncategorized';
      catMap[cat] = (catMap[cat] || 0) + parseFloat(s.revenue || 0);
    }
    const categoryData = Object.entries(catMap).sort((a, b) => b[1] - a[1]).map(([name, value]) => ({ name, value }));

    // trend delta for the hero header
    const first = trendData[0]?.[trendView] || 0;
    const last = trendData[trendData.length - 1]?.[trendView] || 0;
    const trendPct = first > 0 ? ((last - first) / first) * 100 : 0;

    return { stats, trendData, topSellers, risers, fallers, dayOfWeekData, hourlyData, categoryData, trendPct };
  }, [allSales, dateRange, trendView]);

  // ── Upload flow (logic preserved) ──────────────────────────────────────────
  function handleFileSelect(files) {
    const file = files[0]; if (!file) return;
    setPendingFilename(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const rows = parseCSV(e.target.result);
        const headers = Object.keys(rows[0] || {});
        const det = detectPOSSystem(headers);
        const mapping = buildColumnMapping(headers, selectedPOS !== 'other' ? selectedPOS : det);
        setCsvRows(rows); setCsvHeaders(headers); setColumnMapping(mapping);
        if (det !== 'other') { setSelectedPOS(det); setDetectedPOS(det); }
        setUploadStep('mapping'); setUploadMsg('');
      } catch (err) { setUploadMsg('Failed to parse CSV: ' + err.message); }
    };
    reader.readAsText(file);
  }

  async function checkForDuplicates(normalized) {
    if (!restaurantId) return null;
    const dates = normalized.map(r => r.sale_date).sort();
    const dateFrom = dates[0], dateTo = dates[dates.length - 1];
    const { data: overlapping } = await supabase.from('upload_sessions').select('*')
      .eq('restaurant_id', restaurantId).lte('date_from', dateTo).gte('date_to', dateFrom).limit(1);
    return overlapping?.length ? overlapping[0] : null;
  }

  async function handleUploadConfirm() {
    if (!restaurantId || isTour) return;
    setUploadStep('uploading'); setUploadProgress(0);
    try {
      const normalized = normalizeRows(csvRows, columnMapping, restaurantId, selectedPOS);
      if (!normalized.length) throw new Error('No valid rows found. Check your column selections.');
      const duplicate = await checkForDuplicates(normalized);
      if (duplicate) {
        const dates = normalized.map(r => r.sale_date).sort();
        setDuplicateInfo({
          incoming: { filename: pendingFilename, dateFrom: dates[0], dateTo: dates[dates.length - 1], rowCount: normalized.length },
          existing: duplicate,
        });
        pendingUploadRef.current = normalized;
        setUploadStep('mapping');
        return;
      }
      await executeUpload(normalized);
    } catch (err) { setUploadMsg('Upload failed: ' + err.message); setUploadStep('mapping'); }
  }

  async function executeUpload(normalized) {
    try {
      const dates = normalized.map(r => r.sale_date).sort();
      const dateFrom = dates[0], dateTo = dates[dates.length - 1];
      const { data: session, error: sessionErr } = await supabase.from('upload_sessions')
        .insert({ restaurant_id: restaurantId, filename: pendingFilename, row_count: normalized.length, date_from: dateFrom, date_to: dateTo, pos_system: selectedPOS })
        .select().single();
      if (sessionErr) throw sessionErr;
      const taggedRows = normalized.map(r => ({ ...r, upload_session_id: session.id }));
      const CHUNK = 500;
      const insertedIds = [];
      for (let i = 0; i < taggedRows.length; i += CHUNK) {
        const { data: inserted, error } = await supabase.from('pos_sales').insert(taggedRows.slice(i, i + CHUNK)).select('id');
        if (error) {
          // roll back any rows we already inserted this session
          if (insertedIds.length) await supabase.from('pos_sales').delete().in('id', insertedIds);
          throw error;
        }
        inserted?.forEach(r => insertedIds.push(r.id));
        setUploadProgress(Math.min(90, Math.round(((i + CHUNK) / taggedRows.length) * 90)));
      }
      // only delete the old rows once all new rows are safely inserted
      await supabase.from('pos_sales').delete().eq('restaurant_id', restaurantId)
        .gte('sale_date', dateFrom).lte('sale_date', dateTo).not('upload_session_id', 'eq', session.id);
      try {
        await supabase.from('activity_logs').insert({
          restaurant_id: restaurantId, activity_type:'pos_upload', title:'POS Data Uploaded', subtitle: pendingFilename,
          details: `Imported ${normalized.length} records from ${dateFrom} to ${dateTo}`,
          metadata: { session_id: session.id, row_count: normalized.length, date_from: dateFrom, date_to: dateTo },
        });
      } catch {}
      setUploadProgress(100);
      setUploadSuccessMsg(`Imported ${normalized.length} records across ${[...new Set(normalized.map(r => r.sale_date))].length} days.`);
      setUploadStep('done');
      setDuplicateInfo(null);
      pendingUploadRef.current = null;
      await loadSalesData(restaurantId);
    } catch (err) { setUploadMsg('Upload failed: ' + err.message); setUploadStep('mapping'); }
  }

  // ── shared pieces ──────────────────────────────────────────────────────────
  const rangeToggle = (
    <div className="an4-range" role="tablist" aria-label="Date range">
      {DATE_RANGES.map(r => (
        <button key={r} className={`an4-range-btn${dateRange === r ? ' active' : ''}`} onClick={() => setDateRange(r)}>{r}</button>
      ))}
    </div>
  );

  const hiddenFileInput = (
    <input ref={fileInputRef} type="file" accept=".csv" style={{ display:'none' }}
      onChange={e => { handleFileSelect(e.target.files); e.target.value = ''; }} />
  );

  const mappingModal = uploadStep === 'mapping' && !duplicateInfo && (
    <div className="an4-overlay" onClick={e => e.target === e.currentTarget && (setUploadStep('idle'), setUploadMsg(''))}>
      <div className="an4-modal">
        <div className="an4-modal-hd">
          <div>
            <div className="an4-modal-title">Map your columns</div>
            <div className="an4-modal-sub">
              {csvRows.length.toLocaleString()} rows detected{detectedPOS ? ` · Looks like a ${detectedPOS.charAt(0).toUpperCase() + detectedPOS.slice(1)} export` : ''}
            </div>
          </div>
          <button className="an4-modal-x" onClick={() => { setUploadStep('idle'); setUploadMsg(''); }} aria-label="Close">×</button>
        </div>
        <div className="an4-modal-bd">
          <div className="an4-map-grid">
            {MAPPER_FIELDS.map(({ f, req }) => (
              <div key={f}>
                <div className={`an4-map-lbl${req ? ' req' : ''}`}>{f.replace(/_/g, ' ')}</div>
                <select className="an4-map-sel" value={columnMapping[f] || ''}
                  onChange={e => setColumnMapping(prev => ({ ...prev, [f]: e.target.value || null }))}>
                  <option value="">— not in CSV —</option>
                  {csvHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
            ))}
          </div>
          {uploadMsg && <div className="an4-err">{uploadMsg}</div>}
        </div>
        <div className="an4-modal-ft">
          <button className="an4-btn-p" onClick={handleUploadConfirm}>Import {csvRows.length.toLocaleString()} rows</button>
          <button className="an4-btn-g" onClick={() => { setUploadStep('idle'); setUploadMsg(''); }}>Cancel</button>
        </div>
      </div>
    </div>
  );

  const uploadingOverlay = uploadStep === 'uploading' && (
    <div className="an4-overlay" style={{ flexDirection:'column', gap:12 }}>
      <div className="an4-spinner" style={{ width:28, height:28 }} />
      <div style={{ fontSize:14, fontWeight:600, color:'var(--text-primary)' }}>Importing sales data...</div>
      <div style={{ fontSize:12, color:'var(--text-muted)', fontVariantNumeric:'tabular-nums' }}>{uploadProgress}%</div>
      <div style={{ width:260, background:'var(--border-subtle)', borderRadius:4, height:4 }}>
        <div style={{ height:4, borderRadius:4, background:'var(--accent)', width:`${uploadProgress}%`, transition:'width .3s' }} />
      </div>
    </div>
  );

  const duplicateModal = duplicateInfo && (
    <DuplicateModal
      incoming={duplicateInfo.incoming}
      existing={duplicateInfo.existing}
      onProceed={async () => { setDuplicateInfo(null); setUploadStep('uploading'); await executeUpload(pendingUploadRef.current); }}
      onCancel={() => { setDuplicateInfo(null); setUploadStep('idle'); pendingUploadRef.current = null; }}
    />
  );

  const uploadManagerModal = showUploadManager && restaurantId && (
    <UploadManagerModal restaurantId={restaurantId} onClose={() => setShowUploadManager(false)}
      onDeleted={async () => { await loadSalesData(restaurantId); }} />
  );

  // ── MOBILE ─────────────────────────────────────────────────────────────────
  if (isMobile) {
    const MOB_TABS = [
      { id:'overview', label:'Overview' },
      { id:'movers',   label:'Movers' },
      { id:'rhythm',   label:'Rhythm' },
      { id:'upload',   label:'Upload' },
    ];
    return (
      <>
        <Head>
          <title>Analytics — OptiMenu</title>
          <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        </Head>
        <style>{GLOBAL_CSS}</style>
        <style>{`
          .anm-root{font-family:'Inter',sans-serif;background:var(--bg-root);color:var(--text-primary);width:100%;height:100dvh;display:flex;flex-direction:column;overflow:hidden;}
          .anm-header{background:var(--bg-elevated);border-bottom:1px solid var(--border);padding:10px 16px;padding-top:max(10px,env(safe-area-inset-top));display:flex;align-items:center;justify-content:space-between;flex-shrink:0;}
          .anm-sub{background:var(--bg-surface);border-bottom:1px solid var(--border);padding:8px 16px;display:flex;align-items:center;justify-content:space-between;gap:8px;flex-shrink:0;}
          .anm-tabs{background:var(--bg-elevated);border-bottom:1px solid var(--border);display:flex;overflow-x:auto;flex-shrink:0;-webkit-overflow-scrolling:touch;}
          .anm-tabs::-webkit-scrollbar{display:none;}
          .anm-tab{flex-shrink:0;padding:10px 14px;font-size:12px;font-weight:500;color:var(--text-muted);border:none;background:none;cursor:pointer;font-family:'Inter',sans-serif;border-bottom:2px solid transparent;white-space:nowrap;-webkit-tap-highlight-color:transparent;}
          .anm-tab.active{color:var(--accent);border-bottom-color:var(--accent);}
          .anm-scroll{flex:1;overflow-y:auto;padding:14px 16px;display:flex;flex-direction:column;gap:12px;-webkit-overflow-scrolling:touch;}
          .anm-scroll::-webkit-scrollbar{display:none;}
          .anm-card{background:var(--bg-surface);border:1px solid var(--border);border-radius:10px;padding:14px;flex-shrink:0;display:flex;flex-direction:column;}
          .anm-nav{background:var(--bg-elevated);border-top:1px solid var(--border);padding:8px 0 0;padding-bottom:env(safe-area-inset-bottom,8px);display:flex;flex-shrink:0;position:sticky;bottom:0;z-index:40;}
          .anm-nav-item{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;cursor:pointer;padding:4px 0;-webkit-tap-highlight-color:transparent;}
          .anm-nav-item svg{width:20px;height:20px;stroke:var(--text-muted);fill:none;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;}
          .anm-nav-item.active svg{stroke:var(--accent);}
          .anm-nav-label{font-size:10px;color:var(--text-muted);}
          .anm-nav-item.active .anm-nav-label{color:var(--accent);}
        `}</style>
        <div className="anm-root">
          <div className="anm-header">
            <div className="an4-logo">Opti<span>Menu</span></div>
            <div style={{ display:'flex', alignItems:'center', gap:10 }}>
              {rangeToggle}
              <ProfileDropdown userName={userName} userEmail={userEmail} isMobile={true} />
            </div>
          </div>
          <div className="anm-sub">
            <div>
              <div style={{ fontSize:13, fontWeight:600 }}>Sales Analytics</div>
              <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:1 }}>
                {hasSalesData && A ? `${A.stats.totalDays} days · ${fmt(A.stats.totalRevenue)} total` : 'Upload POS data to begin'}
              </div>
            </div>
            {hasSalesData && salesMeta.lastSync && (
              <div className="an4-sync"><span className="an4-sync-dot" />{typeof salesMeta.lastSync === 'string' ? salesMeta.lastSync.slice(0, 10) : salesMeta.lastSync}</div>
            )}
          </div>
          <div className="anm-tabs">
            {MOB_TABS.map(t => (
              <button key={t.id} className={`anm-tab${mobTab === t.id ? ' active' : ''}`} onClick={() => setMobTab(t.id)}>{t.label}</button>
            ))}
          </div>

          {loading ? (
            <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:10 }}>
              <div className="an4-spinner" style={{ width:22, height:22 }} />
              <div style={{ fontSize:12, color:'var(--text-muted)' }}>Loading analytics...</div>
            </div>
          ) : (
            <div className="anm-scroll">
              {!hasSalesData && mobTab !== 'upload' ? (
                <div style={{ textAlign:'center', padding:'40px 16px' }}>
                  <div style={{ fontSize:13, color:'var(--text-muted)', marginBottom:16, lineHeight:1.5 }}>Upload POS data to see sales analytics</div>
                  <button className="an4-btn-p" style={{ padding:'10px 20px', fontSize:13 }} onClick={() => setMobTab('upload')}>Upload CSV →</button>
                </div>
              ) : (
                <>
                  {mobTab === 'overview' && A && (
                    <>
                      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                        {[
                          { l:'Days of data', v:A.stats.totalDays, c:'var(--accent)' },
                          { l:'Total revenue', v:fmt(A.stats.totalRevenue), c:'var(--color-green)' },
                          { l:'Avg daily', v:fmt(A.stats.avgDailyRevenue), c:'var(--color-amber)' },
                          { l:'Items tracked', v:A.topSellers.length, c:'var(--text-primary)' },
                        ].map(({ l, v, c }) => (
                          <div key={l} className="anm-card" style={{ padding:'12px 14px' }}>
                            <div style={{ fontSize:10, color:'var(--text-faint)', textTransform:'uppercase', letterSpacing:.5, marginBottom:6 }}>{l}</div>
                            <div style={{ fontSize:19, fontWeight:700, color:c, lineHeight:1, fontVariantNumeric:'tabular-nums', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{v}</div>
                          </div>
                        ))}
                      </div>
                      <div className="anm-card">
                        <div className="an4-card-hd">
                          <div className="an4-card-title">Revenue trend</div>
                          <div className="an4-toggle">
                            <button className={`an4-toggle-btn${trendView === 'rev' ? ' active' : ''}`} onClick={() => setTrendView('rev')}>Rev</button>
                            <button className={`an4-toggle-btn${trendView === 'qty' ? ' active' : ''}`} onClick={() => setTrendView('qty')}>Qty</button>
                          </div>
                        </div>
                        <div style={{ height:150, display:'flex', flexDirection:'column' }}>
                          <TrendLine data={A.trendData} valueKey={trendView} />
                        </div>
                      </div>
                      {A.categoryData.length > 0 && (
                        <div className="anm-card">
                          <div className="an4-card-title" style={{ marginBottom:10 }}>Category mix</div>
                          {A.categoryData.slice(0, 6).map((d, i) => {
                            const max = Math.max(...A.categoryData.map(x => x.value), 1);
                            const total = A.categoryData.reduce((s, x) => s + x.value, 0);
                            return (
                              <div key={d.name} className="an4-row">
                                <div className="an4-row-label">{d.name}</div>
                                <div className="an4-track"><div className="an4-fill" style={{ width:`${(d.value / max) * 100}%`, background:CAT_COLORS[i % CAT_COLORS.length] }} /></div>
                                <div className="an4-row-val" style={{ color:CAT_COLORS[i % CAT_COLORS.length] }}>{fmt(d.value)}</div>
                                <div className="an4-row-pct">{((d.value / total) * 100).toFixed(0)}%</div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </>
                  )}
                  {mobTab === 'movers' && A && (
                    <div className="anm-card">
                      <div className="an4-card-hd">
                        <div className="an4-toggle">
                          {[['top','Top'],['rising','Rising'],['falling','Falling']].map(([id, l]) => (
                            <button key={id} className={`an4-toggle-btn${moversTab === id ? ' active' : ''}`} onClick={() => setMoversTab(id)}>{l}</button>
                          ))}
                        </div>
                        {moversTab === 'top' ? (
                          <div className="an4-toggle">
                            <button className={`an4-toggle-btn${moversMetric === 'qty' ? ' active' : ''}`} onClick={() => setMoversMetric('qty')}>Qty</button>
                            <button className={`an4-toggle-btn${moversMetric === 'rev' ? ' active' : ''}`} onClick={() => setMoversMetric('rev')}>Rev</button>
                          </div>
                        ) : <span className="an4-card-sub">last 7d vs prior 7d</span>}
                      </div>
                      <div style={{ display:'flex', flexDirection:'column', minHeight:120 }}>
                        <MoversList tab={moversTab} metric={moversMetric} topSellers={A.topSellers} risers={A.risers} fallers={A.fallers} />
                      </div>
                    </div>
                  )}
                  {mobTab === 'rhythm' && A && (
                    <div className="anm-card">
                      <div className="an4-card-hd">
                        <div className="an4-toggle">
                          <button className={`an4-toggle-btn${rhythmView === 'day' ? ' active' : ''}`} onClick={() => setRhythmView('day')}>By day</button>
                          <button className={`an4-toggle-btn${rhythmView === 'hour' ? ' active' : ''}`} onClick={() => setRhythmView('hour')}>By hour</button>
                        </div>
                        {rhythmView === 'day' && (
                          <div className="an4-toggle">
                            <button className={`an4-toggle-btn${rhythmMetric === 'qty' ? ' active' : ''}`} onClick={() => setRhythmMetric('qty')}>Qty</button>
                            <button className={`an4-toggle-btn${rhythmMetric === 'rev' ? ' active' : ''}`} onClick={() => setRhythmMetric('rev')}>Rev</button>
                          </div>
                        )}
                      </div>
                      <div style={{ display:'flex', flexDirection:'column', minHeight:160 }}>
                        <RhythmBody view={rhythmView} metric={rhythmMetric} dayOfWeekData={A.dayOfWeekData} hourlyData={A.hourlyData} />
                      </div>
                    </div>
                  )}
                  {mobTab === 'upload' && (
                    <>
                      <div className="anm-card">
                        <div className="an4-card-title" style={{ marginBottom:12 }}>Upload POS data</div>
                        <div style={{ border:'2px dashed var(--border)', borderRadius:10, padding:'28px 16px', textAlign:'center', marginBottom:12, cursor:'pointer' }}
                          onClick={() => fileInputRef.current?.click()}>
                          <div style={{ fontSize:14, fontWeight:600, marginBottom:6 }}>Upload Sales CSV</div>
                          <div style={{ fontSize:12, color:'var(--text-muted)', marginBottom:14, lineHeight:1.5 }}>Export from your POS system and upload here</div>
                          <button className="an4-btn-p" style={{ padding:'10px 20px', fontSize:13 }}>Choose File</button>
                        </div>
                        {hasSalesData && (
                          <button className="an4-btn-g" style={{ width:'100%', padding:'10px 0', fontSize:13 }} onClick={() => setShowUploadManager(true)}>Manage Uploads</button>
                        )}
                      </div>
                      {uploadSuccessMsg && (
                        <div style={{ background:'color-mix(in srgb, var(--color-green) 8%, transparent)', border:'1px solid color-mix(in srgb, var(--color-green) 18%, transparent)', borderRadius:8, padding:'12px 14px', fontSize:12, color:'var(--color-green)' }}>
                          ✓ {uploadSuccessMsg}
                        </div>
                      )}
                    </>
                  )}
                </>
              )}
              <div style={{ height:8 }} />
            </div>
          )}

          <div className="anm-nav">
            {NAV_TABS.map(({ label, path }) => {
              const active = path === '/client/analytics';
              return (
                <div key={label} className={`anm-nav-item${active ? ' active' : ''}`} onClick={() => router.push(path)}>
                  {path === '/client/dashboard' && <svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>}
                  {path === '/client/invoices' && <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>}
                  {path === '/client/ingredients' && <svg viewBox="0 0 24 24"><path d="M17 8h1a4 4 0 010 8h-1"/><path d="M3 8h14v9a4 4 0 01-4 4H7a4 4 0 01-4-4V8z"/></svg>}
                  {path === '/client/menu-items' && <svg viewBox="0 0 24 24"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>}
                  {path === '/client/analytics' && <svg viewBox="0 0 24 24"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>}
                  <div className="anm-nav-label">{label === 'Menu Items' ? 'Menu' : label}</div>
                </div>
              );
            })}
          </div>
        </div>
        {hiddenFileInput}
        {mappingModal}
        {uploadingOverlay}
        {duplicateModal}
        {uploadManagerModal}
        {tourProps && <TourOverlay {...tourProps} />}
        <TourDataBanner />
      </>
    );
  }

  // ── DESKTOP ────────────────────────────────────────────────────────────────
  return (
    <>
      <Head><title>Analytics — OptiMenu</title></Head>
      <style>{GLOBAL_CSS}</style>
      <div className="an4-root">

        {/* ── TOP BAR ── */}
        <div className="an4-topbar">
          <div style={{ display:'flex', alignItems:'center', gap:'clamp(12px,1.6vw,28px)' }}>
            <div className="an4-logo">Opti<span>Menu</span></div>
            <div className="an4-tabs">
              {NAV_TABS.map(t => (
                <button key={t.label} className={`an4-tab${t.label === 'Analytics' ? ' active' : ''}`}
                  onClick={() => { if (t.label !== 'Analytics') router.push(t.path); }}>{t.label}</button>
              ))}
            </div>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:'clamp(8px,.9vw,14px)' }}>
            <div style={{ display:'flex', alignItems:'center', gap:4, fontSize:'clamp(9px,.62vw,11px)', color:'var(--accent)' }}>
              <div style={{ width:5, height:5, background:'var(--accent)', borderRadius:'50%', animation:'blink 2s infinite' }} />Active
            </div>
            <ProfileDropdown userName={userName} userEmail={userEmail} isMobile={false} />
          </div>
        </div>

        {loading ? (
          <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:10 }}>
            <div className="an4-spinner" style={{ width:22, height:22 }} />
            <div style={{ fontSize:'clamp(10px,.78vw,13px)', color:'var(--text-muted)' }}>Reading the numbers...</div>
          </div>
        ) : !hasSalesData ? (
          /* ── EMPTY STATE: one clear call to action, no dead cards ── */
          <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:14, padding:24 }}>
            <div style={{ fontFamily:"'Inter',sans-serif", fontWeight:600, fontSize:'clamp(16px,1.5vw,24px)', letterSpacing:'-.3px', textAlign:'center' }}>
              No sales data yet.
            </div>
            <div style={{ fontSize:'clamp(11px,.85vw,14px)', color:'var(--text-muted)', textAlign:'center', maxWidth:420, lineHeight:1.6 }}>
              Export a sales CSV from your POS system and upload it here — revenue trends, menu movers, and service rhythm will light up automatically.
            </div>
            <button className="an4-btn-p" style={{ padding:'10px 22px', fontSize:'clamp(11px,.85vw,14px)' }} onClick={() => fileInputRef.current?.click()}>↑ Upload POS CSV</button>
            {uploadSuccessMsg && <div style={{ fontSize:12, color:'var(--color-green)' }}>✓ {uploadSuccessMsg}</div>}
          </div>
        ) : (
          <>
            {/* ── PAGE HEADER ── */}
            <div className="an4-ph">
              <div style={{ display:'flex', alignItems:'baseline', gap:12, flexWrap:'wrap' }}>
                <div className="an4-ph-title">Sales Analytics{A && A.trendPct !== 0 && (
                  <em style={{ marginLeft:8, fontSize:'.7em', color: A.trendPct >= 0 ? 'var(--color-green)' : 'var(--color-red)' }}>
                    {A.trendPct >= 0 ? '↑' : '↓'}{Math.abs(A.trendPct).toFixed(1)}% over {dateRange === 'All' ? 'the period' : `the last ${dateRange}`}
                  </em>
                )}</div>
              </div>
              <div style={{ display:'flex', alignItems:'center', gap:'clamp(10px,1.2vw,18px)', flexWrap:'wrap' }}>
                {A && (
                  <div className="an4-ph-stats">
                    <div className="an4-ph-stat"><span className="an4-ph-stat-v" style={{ color:'var(--accent)' }}>{A.stats.totalDays}</span><span className="an4-ph-stat-l">days</span></div>
                    <div className="an4-ph-stat"><span className="an4-ph-stat-v" style={{ color:'var(--color-green)' }}>{fmt(A.stats.totalRevenue)}</span><span className="an4-ph-stat-l">total</span></div>
                    <div className="an4-ph-stat"><span className="an4-ph-stat-v" style={{ color:'var(--color-amber)' }}>{fmt(A.stats.avgDailyRevenue)}</span><span className="an4-ph-stat-l">avg / day</span></div>
                  </div>
                )}
                {salesMeta.lastSync && (
                  <div className="an4-sync"><span className="an4-sync-dot" />{typeof salesMeta.lastSync === 'string' ? salesMeta.lastSync.slice(0, 10) : salesMeta.lastSync}</div>
                )}
                {uploadStep === 'done' && uploadSuccessMsg && (
                  <div className="an4-sync" style={{ cursor:'pointer' }} onClick={() => { setUploadStep('idle'); setUploadSuccessMsg(''); }} title="Dismiss">✓ {uploadSuccessMsg} ×</div>
                )}
                {rangeToggle}
                <button className="an4-btn-g" onClick={() => setShowUploadManager(true)}>Uploads</button>
                <button className="an4-btn-p" onClick={() => fileInputRef.current?.click()}>↑ Upload CSV</button>
              </div>
            </div>

            {/* ── BODY: four cards, four questions ── */}
            <div className="an4-body">

              {/* 1 · Revenue — the hero */}
              <div className="an4-card hero" style={{ gridColumn:1, gridRow:1 }}>
                <div className="an4-card-hd">
                  <div className="an4-card-title">Daily Revenue<span className="an4-card-sub">{dateRange === 'All' ? 'all data' : `last ${dateRange}`}</span></div>
                  <div className="an4-toggle">
                    <button className={`an4-toggle-btn${trendView === 'rev' ? ' active' : ''}`} onClick={() => setTrendView('rev')}>Revenue</button>
                    <button className={`an4-toggle-btn${trendView === 'qty' ? ' active' : ''}`} onClick={() => setTrendView('qty')}>Covers</button>
                  </div>
                </div>
                {A ? <TrendLine data={A.trendData} valueKey={trendView} /> : <div className="an4-empty">No data in this range</div>}
              </div>

              {/* 4 · Category Mix */}
              <div className="an4-card" style={{ gridColumn:2, gridRow:1 }}>
                <div className="an4-card-hd">
                  <div className="an4-card-title">Category Mix<span className="an4-card-sub">revenue share</span></div>
                </div>
                {A && A.categoryData.length > 0 ? (
                  <div style={{ flex:1, minHeight:0, display:'flex', flexDirection:'column', justifyContent:'space-evenly', overflow:'hidden' }}>
                    {A.categoryData.slice(0, 7).map((d, i) => {
                      const max = Math.max(...A.categoryData.map(x => x.value), 1);
                      const total = A.categoryData.reduce((s, x) => s + x.value, 0);
                      return (
                        <div key={d.name} className="an4-row">
                          <div className="an4-row-label">{d.name}</div>
                          <div className="an4-track"><div className="an4-fill" style={{ width:`${(d.value / max) * 100}%`, background:CAT_COLORS[i % CAT_COLORS.length] }} /></div>
                          <div className="an4-row-val" style={{ color:CAT_COLORS[i % CAT_COLORS.length] }}>{fmt(d.value)}</div>
                          <div className="an4-row-pct">{((d.value / total) * 100).toFixed(0)}%</div>
                        </div>
                      );
                    })}
                  </div>
                ) : <div className="an4-empty">No category data — map a category column when uploading</div>}
              </div>

              {/* 2 · Menu Movers */}
              <div className="an4-card" style={{ gridColumn:1, gridRow:2 }}>
                <div className="an4-card-hd">
                  <div className="an4-card-title">Menu Movers
                    <span className="an4-card-sub">{moversTab === 'top' ? `best sellers, ${dateRange === 'All' ? 'all data' : `last ${dateRange}`}` : 'last 7 days vs the 7 before'}</span>
                  </div>
                  <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                    {moversTab === 'top' && (
                      <div className="an4-toggle">
                        <button className={`an4-toggle-btn${moversMetric === 'qty' ? ' active' : ''}`} onClick={() => setMoversMetric('qty')}>Qty</button>
                        <button className={`an4-toggle-btn${moversMetric === 'rev' ? ' active' : ''}`} onClick={() => setMoversMetric('rev')}>Rev</button>
                      </div>
                    )}
                    <div className="an4-toggle" role="tablist" aria-label="Movers view">
                      {[['top','Top'],['rising','Rising'],['falling','Falling']].map(([id, l]) => (
                        <button key={id} className={`an4-toggle-btn${moversTab === id ? ' active' : ''}`} onClick={() => setMoversTab(id)}>{l}</button>
                      ))}
                    </div>
                  </div>
                </div>
                {A ? <MoversList tab={moversTab} metric={moversMetric} topSellers={A.topSellers} risers={A.risers} fallers={A.fallers} />
                   : <div className="an4-empty">No data in this range</div>}
              </div>

              {/* 3 · Service Rhythm */}
              <div className="an4-card" style={{ gridColumn:2, gridRow:2 }}>
                <div className="an4-card-hd">
                  <div className="an4-card-title">Service Rhythm<span className="an4-card-sub">when you're busy</span></div>
                  <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                    {rhythmView === 'day' && (
                      <div className="an4-toggle">
                        <button className={`an4-toggle-btn${rhythmMetric === 'qty' ? ' active' : ''}`} onClick={() => setRhythmMetric('qty')}>Qty</button>
                        <button className={`an4-toggle-btn${rhythmMetric === 'rev' ? ' active' : ''}`} onClick={() => setRhythmMetric('rev')}>Rev</button>
                      </div>
                    )}
                    <div className="an4-toggle" role="tablist" aria-label="Rhythm view">
                      <button className={`an4-toggle-btn${rhythmView === 'day' ? ' active' : ''}`} onClick={() => setRhythmView('day')}>By day</button>
                      <button className={`an4-toggle-btn${rhythmView === 'hour' ? ' active' : ''}`} onClick={() => setRhythmView('hour')}>By hour</button>
                    </div>
                  </div>
                </div>
                {A ? <RhythmBody view={rhythmView} metric={rhythmMetric} dayOfWeekData={A.dayOfWeekData} hourlyData={A.hourlyData} />
                   : <div className="an4-empty">No data in this range</div>}
              </div>

            </div>
          </>
        )}
      </div>

      {hiddenFileInput}
      {mappingModal}
      {uploadingOverlay}
      {duplicateModal}
      {uploadManagerModal}
      {tourProps && <TourOverlay {...tourProps} />}
      <TourDataBanner />
    </>
  );
}