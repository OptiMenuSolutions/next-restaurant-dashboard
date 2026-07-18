// pages/client/analytics.js
// Sales analytics. CSV upload from POS exports, revenue trend, item movers,
// day/hour breakdowns, category mix. Upload + duplicate-detection logic
// lives in handleUploadConfirm / executeUpload / checkForDuplicates.

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

// helpers
const fmt  = (n) => (!n && n !== 0) || isNaN(parseFloat(n)) ? '$0'
  : parseFloat(n).toLocaleString('en-US', { style:'currency', currency:'USD', minimumFractionDigits:0, maximumFractionDigits:0 });
const fmtD = (n) => (!n && n !== 0) || isNaN(parseFloat(n)) ? '$0.00'
  : parseFloat(n).toLocaleString('en-US', { style:'currency', currency:'USD', minimumFractionDigits:2, maximumFractionDigits:2 });
const fmtK = (n) => {
  const v = parseFloat(n) || 0;
  if (Math.abs(v) >= 1000) return `$${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k`;
  return fmt(v);
};
const dateOf = (s) => typeof s.sale_date === 'string' ? s.sale_date.slice(0, 10) : s.sale_date;
function formatHour(h) {
  if (h === 0) return '12a'; if (h === 12) return '12p';
  return h < 12 ? `${h}a` : `${h - 12}p`;
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
function isWeekendStr(str) {
  const dow = new Date(`${str}T12:00:00`).getDay();
  return dow === 0 || dow === 5 || dow === 6;
}

const DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const DATE_RANGES = ['7d','14d','30d','All'];
// category colors: accent at decreasing strength by rank
const catShade = (i) => `color-mix(in srgb, var(--accent) ${Math.max(14, 88 - i * 13)}%, var(--bg-inset))`;
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

const GLOBAL_CSS = `
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
  html,body{height:100%;background:var(--bg-root);overflow:hidden;}
  #__next{height:100%;}
  @keyframes spin{to{transform:rotate(360deg);}}
  input::placeholder{color:var(--text-faint)!important;}
  ::-webkit-scrollbar{width:3px;}
  ::-webkit-scrollbar-track{background:transparent;}
  ::-webkit-scrollbar-thumb{background:var(--border);border-radius:2px;}

  .lg-root{font-family:'Inter',sans-serif;background:var(--bg-root);color:var(--text-primary);width:100%;height:100vh;display:flex;flex-direction:column;overflow:hidden;}
  .lg-room{flex:1;min-height:0;display:flex;flex-direction:column;}

  /* top bar */
  .lg-topbar{height:48px;flex-shrink:0;display:flex;align-items:center;justify-content:space-between;padding:0 24px;border-bottom:1px solid var(--border);background:var(--bg-elevated);}
  .lg-logo{font-weight:700;font-size:16px;letter-spacing:-.3px;color:var(--text-primary);}
  .lg-logo span{color:var(--accent);}
  .lg-tabs{display:flex;gap:2px;}
  .lg-tab{padding:5px 12px;border-radius:6px;font-size:13px;color:var(--text-muted);border:none;background:none;cursor:pointer;font-family:inherit;transition:color .15s,background .15s;}
  .lg-tab:hover{color:var(--text-secondary);}
  .lg-tab.active{color:var(--text-primary);background:var(--bg-inset);}
  .lg-tab:focus-visible,button:focus-visible{outline:2px solid var(--accent);outline-offset:2px;}

  /* page header */
  .lg-ph{flex-shrink:0;display:flex;align-items:flex-end;justify-content:space-between;gap:14px;flex-wrap:wrap;padding:14px 24px 6px;max-width:1600px;width:100%;margin:0 auto;}
  .lg-ph-title{font-weight:600;font-size:20px;letter-spacing:-.2px;color:var(--text-primary);line-height:1.15;}
  .lg-meta{font-size:11px;color:var(--text-muted);margin-top:4px;}
  .lg-controls{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
  .lg-range{display:flex;background:var(--bg-elevated);border:1px solid var(--border);border-radius:6px;padding:2px;gap:2px;}
  .lg-range-btn{padding:4px 10px;border-radius:4px;font-size:11px;font-weight:600;cursor:pointer;border:none;font-family:inherit;color:var(--text-muted);background:transparent;transition:color .15s,background .15s;font-variant-numeric:tabular-nums;}
  .lg-range-btn.active{background:var(--bg-inset);color:var(--text-primary);}
  .lg-btn-p{background:var(--accent);border:none;border-radius:6px;padding:6px 14px;font-size:12px;font-weight:600;color:#0a0908;cursor:pointer;font-family:inherit;white-space:nowrap;transition:filter .15s;}
  .lg-btn-p:hover{filter:brightness(1.1);}
  .lg-btn-g{background:none;border:1px solid var(--border);border-radius:6px;padding:6px 14px;font-size:12px;color:var(--text-muted);cursor:pointer;font-family:inherit;white-space:nowrap;transition:color .15s,border-color .15s;}
  .lg-btn-g:hover{color:var(--text-primary);border-color:var(--text-faint);}

  /* top region: stat column + trend chart */
  .lg-top{flex:5 1 0;min-height:0;display:grid;grid-template-columns:220px 1fr;gap:16px;padding:8px 24px 0;overflow:hidden;max-width:1600px;width:100%;margin:0 auto;}
  .lg-glance{display:flex;flex-direction:column;gap:8px;min-height:0;overflow:hidden;}
  .lg-gcard{background:var(--bg-surface);border:1px solid var(--border);border-radius:8px;padding:12px 14px;display:flex;flex-direction:column;justify-content:center;flex:1;min-height:0;overflow:hidden;}
  .lg-gcard-l{font-size:11px;font-weight:500;color:var(--text-muted);margin-bottom:5px;display:flex;align-items:center;justify-content:space-between;gap:6px;}
  .lg-gcard-v{font-weight:600;font-variant-numeric:tabular-nums;font-size:22px;letter-spacing:-.02em;line-height:1;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .lg-gcard-s{font-size:10px;color:var(--text-faint);margin-top:4px;}
  .lg-chip{font-size:10px;font-weight:600;padding:2px 7px;border-radius:4px;white-space:nowrap;font-variant-numeric:tabular-nums;}
  .lg-chip.up{background:color-mix(in srgb, var(--color-green) 12%, transparent);color:var(--color-green);}
  .lg-chip.dn{background:color-mix(in srgb, var(--color-red) 12%, transparent);color:var(--color-red);}

  /* cards */
  .lg-card{background:var(--bg-surface);border:1px solid var(--border);border-radius:8px;padding:14px 16px;display:flex;flex-direction:column;overflow:hidden;min-height:0;}
  .lg-card-hd{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;flex-shrink:0;flex-wrap:wrap;}
  .lg-card-title{font-size:13px;font-weight:600;color:var(--text-primary);display:flex;align-items:center;gap:8px;white-space:nowrap;}
  .lg-card-sub{font-size:10px;color:var(--text-faint);font-weight:400;}
  .lg-toggle{display:flex;background:var(--bg-elevated);border:1px solid var(--border-subtle);border-radius:5px;padding:2px;gap:2px;}
  .lg-toggle-btn{padding:3px 10px;border-radius:3px;font-size:10px;font-weight:600;cursor:pointer;border:none;font-family:inherit;color:var(--text-muted);background:transparent;transition:color .15s,background .15s;}
  .lg-toggle-btn.active{background:var(--bg-inset);color:var(--text-primary);}
  .lg-empty{flex:1;display:flex;align-items:center;justify-content:center;font-size:12px;color:var(--text-muted);text-align:center;padding:8px;line-height:1.6;}
  .lg-spinner{width:16px;height:16px;border:2px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:spin .7s linear infinite;}
  .lg-scroll{flex:1;min-height:0;overflow-y:auto;padding-right:2px;}

  /* lower band */
  .lg-band{flex:4 1 0;min-height:0;display:grid;grid-template-columns:1.35fr 1fr 1fr;gap:14px;padding:12px 24px;overflow:hidden;max-width:1600px;width:100%;margin:0 auto;}

  /* ranked item rows */
  .lg-rank-row{display:grid;grid-template-columns:22px minmax(0,1.1fr) 1.4fr 56px;align-items:center;gap:9px;padding:6px 0;border-bottom:1px solid var(--border-subtle);}
  .lg-rank-row:last-child{border-bottom:none;}
  .lg-rank-num{font-size:11px;color:var(--text-faint);text-align:right;line-height:1;font-variant-numeric:tabular-nums;}
  .lg-rank-name{font-size:12px;font-weight:500;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .lg-rank-cat{display:block;font-size:9px;color:var(--text-faint);margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .lg-bar{height:8px;background:var(--bg-inset);border-radius:4px;overflow:hidden;position:relative;}
  .lg-bar-fill{height:100%;border-radius:4px;}
  .lg-rank-val{font-variant-numeric:tabular-nums;font-size:12px;font-weight:600;text-align:right;white-space:nowrap;}

  /* day-of-week columns */
  .lg-cols{flex:1;min-height:0;display:flex;align-items:stretch;gap:8px;padding-top:6px;}
  .lg-col{flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;min-width:0;}
  .lg-col-val{font-variant-numeric:tabular-nums;font-size:10px;font-weight:600;line-height:1;white-space:nowrap;flex-shrink:0;}
  .lg-col-track{flex:1;min-height:0;width:100%;display:flex;align-items:flex-end;background:var(--bg-inset);border-radius:4px;overflow:hidden;}
  .lg-col-fill{width:100%;border-radius:4px 4px 0 0;background:var(--accent);}
  .lg-col-day{font-size:10px;font-weight:500;color:var(--text-muted);line-height:1;flex-shrink:0;}
  .lg-col.peak .lg-col-day{color:var(--text-primary);font-weight:600;}

  /* hourly heatmap */
  .lg-hours{display:flex;gap:3px;align-items:stretch;flex:1;min-height:0;padding-top:6px;}
  .lg-hour{flex:1;border-radius:4px;display:flex;align-items:flex-end;justify-content:center;cursor:pointer;border:none;padding:0 0 3px;transition:outline .15s,filter .15s;outline:2px solid transparent;outline-offset:2px;min-width:0;background:var(--accent);}
  .lg-hour:hover{filter:brightness(1.15);}
  .lg-hour span{font-size:8px;font-family:inherit;font-weight:600;}
  .lg-legend{display:flex;gap:10px;flex-wrap:wrap;margin-top:6px;padding-top:6px;border-top:1px solid var(--border-subtle);flex-shrink:0;font-size:9px;color:var(--text-faint);align-items:center;}
  .lg-hour-detail{margin-top:8px;background:var(--bg-elevated);border:1px solid var(--border-subtle);border-radius:6px;padding:9px 12px;display:flex;gap:20px;align-items:center;flex-shrink:0;}
  .lg-hd-l{font-size:9px;color:var(--text-faint);margin-bottom:2px;}
  .lg-hd-v{font-size:15px;font-weight:600;line-height:1;font-variant-numeric:tabular-nums;color:var(--text-primary);}

  /* category mix */
  .lg-mixbar{display:flex;height:12px;border-radius:6px;overflow:hidden;flex-shrink:0;margin-bottom:10px;border:1px solid var(--border-subtle);}
  .lg-mix-row{display:grid;grid-template-columns:10px minmax(0,1fr) 58px 32px;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--border-subtle);}
  .lg-mix-row:last-child{border-bottom:none;}
  .lg-mix-name{font-size:12px;color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .lg-mix-val{font-variant-numeric:tabular-nums;font-size:12px;font-weight:600;color:var(--text-primary);text-align:right;white-space:nowrap;}
  .lg-mix-pct{font-size:10px;color:var(--text-faint);text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;}
  .lg-dot{width:6px;height:6px;border-radius:2px;display:inline-block;margin-right:3px;}

  /* modals */
  .lg-overlay{position:fixed;inset:0;z-index:50;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:16px;}
  .lg-modal{background:var(--bg-surface);border:1px solid var(--border);border-radius:10px;width:min(680px,94%);max-height:86vh;display:flex;flex-direction:column;overflow:hidden;}
  .lg-modal-hd{padding:16px 18px;border-bottom:1px solid var(--border);display:flex;align-items:flex-start;justify-content:space-between;gap:10px;flex-shrink:0;}
  .lg-modal-title{font-size:15px;font-weight:600;color:var(--text-primary);}
  .lg-modal-sub{font-size:11px;color:var(--text-muted);margin-top:4px;}
  .lg-modal-x{background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:18px;line-height:1;padding:4px;flex-shrink:0;}
  .lg-modal-bd{flex:1;overflow-y:auto;padding:16px 18px;min-height:0;}
  .lg-modal-ft{padding:12px 18px;border-top:1px solid var(--border);display:flex;gap:10px;flex-shrink:0;}
  .lg-map-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;}
  .lg-map-lbl{font-size:10px;color:var(--text-muted);font-weight:600;margin-bottom:4px;}
  .lg-map-lbl.req::after{content:' *';color:var(--color-red);}
  .lg-map-sel{background:var(--bg-elevated);border:1px solid var(--border);border-radius:6px;padding:7px 10px;font-size:12px;color:var(--text-primary);outline:none;font-family:inherit;width:100%;cursor:pointer;}
  .lg-map-sel:focus{border-color:var(--accent);}
  .lg-err{font-size:11px;color:var(--color-red);margin-top:10px;}
  .lg-upload-row{background:var(--bg-elevated);border:1px solid var(--border-subtle);border-radius:8px;padding:12px;margin-bottom:8px;}
`;

// trend chart
const PAD = { left: 48, right: 14, top: 16, bottom: 26 };

function TrendLine({ data, valueKey = 'rev', avg }) {
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
        <div style={{ fontSize:11, color:'var(--text-muted)', textAlign:'center', lineHeight:1.6 }}>Not enough data yet. Upload at least 2 days of sales.</div>
      </div>
    );
  }

  const vals = pts.map(d => d[valueKey]);
  const rawMax = Math.max(...vals, 1);
  const rawMin = Math.min(...vals, 0);
  const mag = Math.pow(10, Math.floor(Math.log10(rawMax)));
  const yMax = Math.ceil((rawMax * 1.1) / mag) * mag;
  const yMin = Math.max(0, rawMin - (rawMax - rawMin) * 0.2);
  const xOf = i => PAD.left + (i / (pts.length - 1)) * cW;
  const yOf = v => PAD.top + cH - ((v - yMin) / (yMax - yMin || 1)) * cH;

  const linePath = pts.map((d, i) => `${i === 0 ? 'M' : 'L'}${xOf(i).toFixed(1)},${yOf(d[valueKey]).toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L${xOf(pts.length - 1).toFixed(1)},${yOf(yMin).toFixed(1)} L${xOf(0).toFixed(1)},${yOf(yMin).toFixed(1)} Z`;
  const yTicks = [yMin, (yMin + yMax) / 2, yMax];
  const xLabelIdxs = (() => {
    if (pts.length <= 7) return pts.map((_, i) => i);
    const step = Math.ceil((pts.length - 1) / 6);
    const idxs = [];
    for (let i = 0; i < pts.length; i += step) idxs.push(i);
    if (idxs[idxs.length - 1] !== pts.length - 1) idxs.push(pts.length - 1);
    return [...new Set(idxs)];
  })();
  const gradId = `lgG_${valueKey}`;
  const clipId = `lgC_${valueKey}`;

  return (
    <div ref={wrapRef} style={{ flex:1, minHeight:0, position:'relative' }}>
      <svg width={W} height={H} style={{ display:'block', overflow:'visible' }} role="img" aria-label="Daily trend">
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.15" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
          <clipPath id={clipId}><rect x={PAD.left} y={PAD.top} width={cW} height={cH} /></clipPath>
        </defs>

        {/* weekend shading */}
        {pts.map((d, i) => {
          if (!isWeekendStr(d.date)) return null;
          const half = cW / (pts.length - 1) / 2;
          const x0 = Math.max(PAD.left, xOf(i) - half);
          const x1 = Math.min(W - PAD.right, xOf(i) + half);
          return <rect key={`w${i}`} x={x0} y={PAD.top} width={x1 - x0} height={cH} fill="var(--text-faint)" opacity={0.05} />;
        })}

        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={PAD.left} y1={yOf(t)} x2={W - PAD.right} y2={yOf(t)} stroke="var(--border-subtle)" strokeWidth={0.75} />
            <text x={PAD.left - 7} y={yOf(t)} textAnchor="end" dominantBaseline="middle" fontSize={9.5} fill="var(--text-faint)" fontFamily="Inter, sans-serif" style={{ fontVariantNumeric:'tabular-nums' }}>
              {valueKey === 'rev' ? fmtK(t) : Math.round(t)}
            </text>
          </g>
        ))}

        {/* period average */}
        {avg !== undefined && avg > yMin && avg < yMax && (
          <g>
            <line x1={PAD.left} y1={yOf(avg)} x2={W - PAD.right} y2={yOf(avg)} stroke="var(--text-faint)" strokeWidth={1} strokeDasharray="4 4" opacity={0.7} />
            <text x={W - PAD.right} y={yOf(avg) - 5} textAnchor="end" fontSize={9} fill="var(--text-faint)" fontFamily="Inter, sans-serif">
              avg {valueKey === 'rev' ? fmtK(avg) : Math.round(avg)}
            </text>
          </g>
        )}

        <path d={areaPath} fill={`url(#${gradId})`} clipPath={`url(#${clipId})`} />
        <path d={linePath} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" clipPath={`url(#${clipId})`} />

        {pts.map((d, i) => (
          <circle key={`d${i}`} cx={xOf(i)} cy={yOf(d[valueKey])} r={activeIdx === i ? 4 : 2.5}
            fill="var(--accent)" stroke="var(--bg-surface)" strokeWidth={activeIdx === i ? 2 : 1}
            style={{ pointerEvents:'none' }} />
        ))}

        {pts.map((d, i) => (
          <circle key={`h${i}`} cx={xOf(i)} cy={yOf(d[valueKey])} r={22} fill="transparent" style={{ cursor:'crosshair' }}
            onMouseEnter={e => { const r = wrapRef.current.getBoundingClientRect(); setActiveIdx(i); setTip({ x:e.clientX - r.left, y:e.clientY - r.top, d }); }}
            onMouseMove={e => { const r = wrapRef.current.getBoundingClientRect(); setTip(prev => prev ? { ...prev, x:e.clientX - r.left, y:e.clientY - r.top } : null); }}
            onMouseLeave={() => { setActiveIdx(null); setTip(null); }} />
        ))}
        {activeIdx !== null && (
          <line x1={xOf(activeIdx)} y1={PAD.top} x2={xOf(activeIdx)} y2={PAD.top + cH}
            stroke="var(--text-faint)" strokeWidth={1} strokeDasharray="3 3" opacity={0.5} />
        )}
        {xLabelIdxs.map(i => (
          <text key={i} x={xOf(i)} y={H - 6}
            textAnchor={i === 0 ? 'start' : i === pts.length - 1 ? 'end' : 'middle'}
            fontSize={9.5} fontFamily="Inter, sans-serif"
            fill={activeIdx === i ? 'var(--text-primary)' : 'var(--text-faint)'}>
            {formatDateLabel(pts[i].date)}
          </text>
        ))}
      </svg>
      {tip && (
        <div style={{ position:'absolute',
          left: tip.x > W - 130 ? undefined : tip.x + 14,
          right: tip.x > W - 130 ? W - tip.x + 14 : undefined,
          top: Math.max(0, tip.y - 52),
          background:'var(--bg-elevated)', border:'1px solid var(--border)', borderRadius:6, padding:'6px 10px', fontSize:11, pointerEvents:'none', whiteSpace:'nowrap', zIndex:999, boxShadow:'0 4px 12px rgba(0,0,0,.4)' }}>
          <div style={{ fontWeight:600, fontSize:13, color:'var(--text-primary)', marginBottom:2, fontVariantNumeric:'tabular-nums' }}>
            {valueKey === 'rev' ? fmtD(tip.d[valueKey]) : `${Math.round(tip.d[valueKey])} items`}
          </div>
          <div style={{ color:'var(--text-muted)', fontSize:10 }}>
            {formatDateLabel(tip.d.date)}{isWeekendStr(tip.d.date) ? ' (weekend)' : ''}
          </div>
        </div>
      )}
    </div>
  );
}

// item movers list
function MoversList({ tab, metric, topSellers, risers, fallers }) {
  if (tab === 'top') {
    if (!topSellers.length) return <div className="lg-empty">No items yet</div>;
    const max = Math.max(...topSellers.map(i => metric === 'qty' ? i.qty : i.rev), 1);
    return (
      <div className="lg-scroll">
        {topSellers.map((item, i) => (
          <div key={item.name} className="lg-rank-row">
            <span className="lg-rank-num">{i + 1}</span>
            <div style={{ minWidth:0 }}>
              <div className="lg-rank-name">{item.name}</div>
              {item.category && <span className="lg-rank-cat">{item.category}</span>}
            </div>
            <div className="lg-bar">
              <div className="lg-bar-fill" style={{ width:`${((metric === 'qty' ? item.qty : item.rev) / max) * 100}%`, background:'var(--accent)' }} />
            </div>
            <div className="lg-rank-val" style={{ color:'var(--text-primary)' }}>{metric === 'qty' ? Math.round(item.qty) : fmt(item.rev)}</div>
          </div>
        ))}
      </div>
    );
  }
  const list = tab === 'rising' ? risers : fallers;
  const color = tab === 'rising' ? 'var(--color-green)' : 'var(--color-red)';
  if (!list.length) return <div className="lg-empty">{tab === 'rising' ? 'No items trending up this week' : 'No items trending down this week'}</div>;
  return (
    <div className="lg-scroll">
      {list.map((item, i) => (
        <div key={item.name} className="lg-rank-row">
          <span className="lg-rank-num">{i + 1}</span>
          <div style={{ minWidth:0 }}>
            <div className="lg-rank-name">{item.name}</div>
            <span className="lg-rank-cat">{Math.round(item.prev)} to {Math.round(item.curr)} sold</span>
          </div>
          <div className="lg-bar">
            <div className="lg-bar-fill" style={{ width:`${Math.min(100, Math.abs(item.change))}%`, background:color }} />
          </div>
          <div className="lg-rank-val" style={{ color }}>{item.change > 0 ? '+' : '-'}{Math.abs(item.change).toFixed(0)}%</div>
        </div>
      ))}
    </div>
  );
}

// day / hour breakdown
function RhythmBody({ view, metric, dayOfWeekData, hourlyData }) {
  const [openHour, setOpenHour] = useState(null);

  if (view === 'day') {
    if (!dayOfWeekData.some(d => d.qty > 0)) return <div className="lg-empty">No data yet</div>;
    const max = Math.max(...dayOfWeekData.map(d => metric === 'qty' ? d.qty : d.rev), 1);
    const peakDay = dayOfWeekData.reduce((a, b) => ((metric === 'qty' ? b.qty : b.rev) > (metric === 'qty' ? a.qty : a.rev) ? b : a));
    return (
      <div className="lg-cols">
        {dayOfWeekData.map((d) => {
          const v = metric === 'qty' ? d.qty : d.rev;
          const has = d.qty > 0;
          const isPeak = has && d.day === peakDay.day;
          return (
            <div key={d.day} className={`lg-col${isPeak ? ' peak' : ''}`}>
              <span className="lg-col-val" style={{ color: has ? 'var(--text-secondary)' : 'var(--text-faint)' }}>
                {has ? (metric === 'qty' ? Math.round(v) : fmtK(v)) : '-'}
              </span>
              <div className="lg-col-track">
                <div className="lg-col-fill" style={{
                  height: has ? `${Math.max(4, (v / max) * 100)}%` : '0%',
                  opacity: isPeak ? 1 : 0.45,
                }} />
              </div>
              <span className="lg-col-day">{d.day.slice(0, 3)}</span>
            </div>
          );
        })}
      </div>
    );
  }

  if (!hourlyData.length) return <div className="lg-empty">No hourly data. Map an hour column when uploading.</div>;
  const maxHourQty = Math.max(...hourlyData.map(h => h.qty), 1);
  const totalQty = hourlyData.reduce((s, h) => s + h.qty, 0);
  const open = openHour !== null ? hourlyData.find(h => h.hour === openHour) : null;
  return (
    <div style={{ flex:1, minHeight:0, display:'flex', flexDirection:'column' }}>
      <div className="lg-hours">
        {hourlyData.map(h => {
          const t = h.qty / maxHourQty;
          const active = openHour === h.hour;
          return (
            <button key={h.hour} type="button" className="lg-hour" aria-pressed={active}
              onClick={() => setOpenHour(active ? null : h.hour)}
              style={{ opacity: t > 0 ? 0.2 + t * 0.8 : 0.12, outlineColor: active ? 'var(--accent)' : 'transparent' }}>
              <span style={{ color: t > 0.55 ? '#0a0908' : 'var(--text-muted)' }}>{formatHour(h.hour)}</span>
            </button>
          );
        })}
      </div>
      {open && (
        <div className="lg-hour-detail">
          <div style={{ fontSize:14, fontWeight:600, color:'var(--text-primary)' }}>{formatHour(open.hour)}</div>
          <div><div className="lg-hd-l">Items sold</div><div className="lg-hd-v">{Math.round(open.qty)}</div></div>
          <div><div className="lg-hd-l">% of day</div><div className="lg-hd-v">{totalQty > 0 ? ((open.qty / totalQty) * 100).toFixed(1) : 0}%</div></div>
          <div><div className="lg-hd-l">vs peak</div><div className="lg-hd-v">{((open.qty / maxHourQty) * 100).toFixed(0)}%</div></div>
          <button type="button" className="lg-modal-x" style={{ marginLeft:'auto' }} onClick={() => setOpenHour(null)} aria-label="Close">×</button>
        </div>
      )}
      <div className="lg-legend">
        <span>Darker = busier</span>
        <span style={{ marginLeft:'auto' }}>Click an hour for details</span>
      </div>
    </div>
  );
}

// category mix
function MixBody({ categoryData }) {
  if (!categoryData.length) return <div className="lg-empty">No category data. Map a category column when uploading.</div>;
  const total = categoryData.reduce((s, x) => s + x.value, 0);
  return (
    <>
      <div className="lg-mixbar" role="img" aria-label="Revenue share by category">
        {categoryData.map((d, i) => (
          <div key={d.name} title={`${d.name} - ${((d.value / total) * 100).toFixed(0)}%`}
            style={{ width:`${(d.value / total) * 100}%`, background:catShade(i) }} />
        ))}
      </div>
      <div className="lg-scroll">
        {categoryData.map((d, i) => (
          <div key={d.name} className="lg-mix-row">
            <span className="lg-dot" style={{ background:catShade(i), margin:0 }} />
            <div className="lg-mix-name">{d.name}</div>
            <div className="lg-mix-val">{fmt(d.value)}</div>
            <div className="lg-mix-pct">{((d.value / total) * 100).toFixed(0)}%</div>
          </div>
        ))}
      </div>
    </>
  );
}

// upload history modal
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
    <div className="lg-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="lg-modal">
        <div className="lg-modal-hd">
          <div>
            <div className="lg-modal-title">Upload history</div>
            <div className="lg-modal-sub">Manage your uploaded POS files</div>
          </div>
          <button className="lg-modal-x" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="lg-modal-bd">
          {loading ? (
            <div style={{ display:'flex', alignItems:'center', justifyContent:'center', padding:40, gap:10, color:'var(--text-muted)', fontSize:13 }}>
              <div className="lg-spinner" />Loading...
            </div>
          ) : sessions.length === 0 ? (
            <div style={{ textAlign:'center', padding:40, fontSize:13, color:'var(--text-muted)' }}>No uploads yet</div>
          ) : sessions.map(s => (
            <div key={s.id} className="lg-upload-row">
              {deleting?.id === s.id ? (
                <div>
                  {deleteStep === 1 && (<>
                    <div style={{ fontSize:13, fontWeight:600, color:'var(--color-red)', marginBottom:6 }}>Delete this upload?</div>
                    <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:12, lineHeight:1.5 }}>
                      This permanently removes <strong style={{ color:'var(--text-primary)' }}>{s.row_count.toLocaleString()} records</strong> from {s.date_from} to {s.date_to}.
                    </div>
                    <div style={{ display:'flex', gap:8 }}>
                      <button className="lg-btn-g" style={{ color:'var(--color-red)', borderColor:'color-mix(in srgb, var(--color-red) 30%, transparent)' }} onClick={() => setDeleteStep(2)}>Yes, continue</button>
                      <button className="lg-btn-g" onClick={cancelDelete}>Cancel</button>
                    </div>
                  </>)}
                  {deleteStep === 2 && (<>
                    <div style={{ fontSize:13, fontWeight:600, color:'var(--color-red)', marginBottom:6 }}>Final confirmation</div>
                    <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:10 }}>Type <strong style={{ color:'var(--text-primary)', fontFamily:'monospace' }}>DELETE</strong> to permanently remove this data.</div>
                    <input autoFocus value={deleteInput} onChange={e => setDeleteInput(e.target.value)} placeholder="Type DELETE"
                      style={{ background:'var(--bg-surface)', border:`1px solid ${deleteInput === 'DELETE' ? 'var(--color-red)' : 'var(--border)'}`, borderRadius:6, padding:'7px 10px', fontSize:12, color:'var(--text-primary)', outline:'none', fontFamily:'monospace', width:'100%', marginBottom:10 }} />
                    <div style={{ display:'flex', gap:8 }}>
                      <button className="lg-btn-g" disabled={deleteInput !== 'DELETE'}
                        style={{ color: deleteInput === 'DELETE' ? 'var(--color-red)' : 'var(--text-faint)', borderColor: deleteInput === 'DELETE' ? 'color-mix(in srgb, var(--color-red) 40%, transparent)' : 'var(--border)', cursor: deleteInput === 'DELETE' ? 'pointer' : 'not-allowed' }}
                        onClick={confirmDelete}>Permanently delete</button>
                      <button className="lg-btn-g" onClick={cancelDelete}>Cancel</button>
                    </div>
                  </>)}
                </div>
              ) : (
                <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:12, fontWeight:600, color:'var(--text-primary)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{s.filename || 'Uploaded file'}</div>
                    <div style={{ fontSize:10, color:'var(--text-muted)', marginTop:2 }}>{s.date_from} to {s.date_to} · {s.row_count.toLocaleString()} rows · {s.pos_system || 'unknown POS'}</div>
                    <div style={{ fontSize:10, color:'var(--text-faint)', marginTop:1 }}>{new Date(s.uploaded_at).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric', hour:'2-digit', minute:'2-digit' })}</div>
                  </div>
                  <button className="lg-btn-g" style={{ color:'var(--color-red)', borderColor:'color-mix(in srgb, var(--color-red) 20%, transparent)', flexShrink:0 }} onClick={() => startDelete(s)}>Delete</button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// duplicate-upload warning
function DuplicateModal({ incoming, existing, onProceed, onCancel }) {
  return (
    <div className="lg-overlay" style={{ zIndex:60 }}>
      <div className="lg-modal">
        <div className="lg-modal-hd">
          <div>
            <div className="lg-modal-title">Duplicate upload detected</div>
            <div className="lg-modal-sub">This file covers dates that overlap with an existing upload.</div>
          </div>
        </div>
        <div className="lg-modal-bd" style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
          {[
            { label:'Existing upload', name: existing.filename || 'Previous upload', from: existing.date_from, to: existing.date_to, count: existing.row_count, hl:false },
            { label:'New upload', name: incoming.filename, from: incoming.dateFrom, to: incoming.dateTo, count: incoming.rowCount, hl:true },
          ].map(x => (
            <div key={x.label} className="lg-upload-row" style={{ margin:0, borderColor: x.hl ? 'color-mix(in srgb, var(--color-amber) 25%, transparent)' : 'var(--border-subtle)' }}>
              <div style={{ fontSize:10, color: x.hl ? 'var(--color-amber)' : 'var(--text-faint)', marginBottom:8, fontWeight:600 }}>{x.label}</div>
              <div style={{ fontSize:12, color:'var(--text-primary)', fontWeight:600, marginBottom:4, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{x.name}</div>
              <div style={{ fontSize:11, color:'var(--text-muted)' }}>{x.from} to {x.to}</div>
              <div style={{ fontSize:11, color:'var(--text-muted)' }}>{x.count?.toLocaleString()} rows</div>
            </div>
          ))}
        </div>
        <div className="lg-modal-ft">
          <button className="lg-btn-p" onClick={onProceed}>Import anyway</button>
          <button className="lg-btn-g" onClick={onCancel}>Cancel upload</button>
        </div>
      </div>
    </div>
  );
}

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

  // All analytics derived in one pass, windows anchored to latest sale date.
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

    const dailyMap = {};
    let totalRevenue = 0, totalQty = 0;
    for (const s of filtered) {
      const d = dateOf(s);
      const rev = parseFloat(s.revenue || 0);
      const qty = parseFloat(s.quantity_sold || 0);
      totalRevenue += rev; totalQty += qty;
      if (!dailyMap[d]) dailyMap[d] = { date:d, rev:0, qty:0 };
      dailyMap[d].rev += rev;
      dailyMap[d].qty += qty;
    }
    const trendData = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));
    const totalDays = trendData.length;
    const stats = {
      totalDays, totalRevenue, totalQty,
      avgDailyRevenue: totalDays > 0 ? totalRevenue / totalDays : 0,
      avgDailyQty: totalDays > 0 ? totalQty / totalDays : 0,
    };

    const itemMap = {};
    for (const s of filtered) {
      if (!itemMap[s.item_name]) itemMap[s.item_name] = { name:s.item_name, qty:0, rev:0, category:s.category };
      itemMap[s.item_name].qty += parseFloat(s.quantity_sold || 0);
      itemMap[s.item_name].rev += parseFloat(s.revenue || 0);
    }
    const items = Object.values(itemMap);
    const topByQty = [...items].sort((a, b) => b.qty - a.qty).slice(0, 8);
    const topByRev = [...items].sort((a, b) => b.rev - a.rev).slice(0, 8);

    // rising / falling: last 7d vs prior 7d anchored to latest sale date,
    // over ALL sales so the comparison doesn't depend on the range toggle
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

    const dayMap = {};
    for (const d of DAYS) dayMap[d] = { day:d, qty:0, rev:0 };
    for (const s of filtered) {
      if (s.day_of_week && dayMap[s.day_of_week]) {
        dayMap[s.day_of_week].qty += parseFloat(s.quantity_sold || 0);
        dayMap[s.day_of_week].rev += parseFloat(s.revenue || 0);
      }
    }
    const dayOfWeekData = DAYS.map(d => dayMap[d]);

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

    const catMap = {};
    for (const s of filtered) {
      const cat = s.category || 'Uncategorized';
      catMap[cat] = (catMap[cat] || 0) + parseFloat(s.revenue || 0);
    }
    const categoryData = Object.entries(catMap).sort((a, b) => b[1] - a[1]).map(([name, value]) => ({ name, value }));

    // trend: first vs last day of the visible series
    const first = trendData[0]?.[trendView] || 0;
    const last = trendData[trendData.length - 1]?.[trendView] || 0;
    const trendPct = first > 0 ? ((last - first) / first) * 100 : 0;
    const bestDay = trendData.reduce((a, b) => (b.rev > a.rev ? b : a));

    return { anchor, stats, trendData, topByQty, topByRev, risers, fallers, dayOfWeekData, hourlyData, categoryData, trendPct, bestDay };
  }, [allSales, dateRange, trendView]);

  // upload flow
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

  // shared pieces
  const rangeToggle = (
    <div className="lg-range" role="tablist" aria-label="Date range">
      {DATE_RANGES.map(r => (
        <button key={r} className={`lg-range-btn${dateRange === r ? ' active' : ''}`} onClick={() => setDateRange(r)}>{r}</button>
      ))}
    </div>
  );

  const hiddenFileInput = (
    <input ref={fileInputRef} type="file" accept=".csv" style={{ display:'none' }}
      onChange={e => { handleFileSelect(e.target.files); e.target.value = ''; }} />
  );

  const mappingModal = uploadStep === 'mapping' && !duplicateInfo && (
    <div className="lg-overlay" onClick={e => e.target === e.currentTarget && (setUploadStep('idle'), setUploadMsg(''))}>
      <div className="lg-modal">
        <div className="lg-modal-hd">
          <div>
            <div className="lg-modal-title">Map your columns</div>
            <div className="lg-modal-sub">
              {csvRows.length.toLocaleString()} rows detected{detectedPOS ? ` · ${detectedPOS.charAt(0).toUpperCase() + detectedPOS.slice(1)} export detected` : ''}
            </div>
          </div>
          <button className="lg-modal-x" onClick={() => { setUploadStep('idle'); setUploadMsg(''); }} aria-label="Close">×</button>
        </div>
        <div className="lg-modal-bd">
          <div className="lg-map-grid">
            {MAPPER_FIELDS.map(({ f, req }) => (
              <div key={f}>
                <div className={`lg-map-lbl${req ? ' req' : ''}`}>{f.replace(/_/g, ' ')}</div>
                <select className="lg-map-sel" value={columnMapping[f] || ''}
                  onChange={e => setColumnMapping(prev => ({ ...prev, [f]: e.target.value || null }))}>
                  <option value="">Not in this CSV</option>
                  {csvHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
            ))}
          </div>
          {uploadMsg && <div className="lg-err">{uploadMsg}</div>}
        </div>
        <div className="lg-modal-ft">
          <button className="lg-btn-p" onClick={handleUploadConfirm}>Import {csvRows.length.toLocaleString()} rows</button>
          <button className="lg-btn-g" onClick={() => { setUploadStep('idle'); setUploadMsg(''); }}>Cancel</button>
        </div>
      </div>
    </div>
  );

  const uploadingOverlay = uploadStep === 'uploading' && (
    <div className="lg-overlay" style={{ flexDirection:'column', gap:12 }}>
      <div className="lg-spinner" style={{ width:28, height:28 }} />
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

  // mobile
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
          .lgm-root{font-family:'Inter',sans-serif;background:var(--bg-root);color:var(--text-primary);width:100%;height:100dvh;display:flex;flex-direction:column;overflow:hidden;}
          .lgm-header{background:var(--bg-elevated);border-bottom:1px solid var(--border);padding:10px 16px;padding-top:max(10px,env(safe-area-inset-top));display:flex;align-items:center;justify-content:space-between;flex-shrink:0;}
          .lgm-sub{background:var(--bg-surface);border-bottom:1px solid var(--border);padding:8px 16px;display:flex;align-items:center;justify-content:space-between;gap:8px;flex-shrink:0;}
          .lgm-tabs{background:var(--bg-elevated);border-bottom:1px solid var(--border);display:flex;overflow-x:auto;flex-shrink:0;-webkit-overflow-scrolling:touch;}
          .lgm-tabs::-webkit-scrollbar{display:none;}
          .lgm-tab{flex-shrink:0;padding:10px 14px;font-size:12px;font-weight:500;color:var(--text-muted);border:none;background:none;cursor:pointer;font-family:inherit;border-bottom:2px solid transparent;white-space:nowrap;-webkit-tap-highlight-color:transparent;}
          .lgm-tab.active{color:var(--accent);border-bottom-color:var(--accent);}
          .lgm-scroll{flex:1;overflow-y:auto;padding:14px 16px;display:flex;flex-direction:column;gap:12px;-webkit-overflow-scrolling:touch;}
          .lgm-scroll::-webkit-scrollbar{display:none;}
          .lgm-card{background:var(--bg-surface);border:1px solid var(--border);border-radius:8px;padding:14px;flex-shrink:0;display:flex;flex-direction:column;}
          .lgm-nav{background:var(--bg-elevated);border-top:1px solid var(--border);padding:8px 0 0;padding-bottom:env(safe-area-inset-bottom,8px);display:flex;flex-shrink:0;position:sticky;bottom:0;z-index:40;}
          .lgm-nav-item{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;cursor:pointer;padding:4px 0;-webkit-tap-highlight-color:transparent;}
          .lgm-nav-item svg{width:20px;height:20px;stroke:var(--text-muted);fill:none;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;}
          .lgm-nav-item.active svg{stroke:var(--accent);}
          .lgm-nav-label{font-size:10px;color:var(--text-muted);}
          .lgm-nav-item.active .lgm-nav-label{color:var(--accent);}
        `}</style>
        <div className="lgm-root">
          <div className="lgm-header">
            <div className="lg-logo">Opti<span>Menu</span></div>
            <div style={{ display:'flex', alignItems:'center', gap:10 }}>
              {rangeToggle}
              <ProfileDropdown userName={userName} userEmail={userEmail} isMobile={true} />
            </div>
          </div>
          <div className="lgm-sub">
            <div>
              <div style={{ fontSize:15, fontWeight:600, letterSpacing:'-.3px' }}>Sales Analytics</div>
              <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:1 }}>
                {hasSalesData && A ? `${A.stats.totalDays} days · ${fmt(A.stats.totalRevenue)} total` : 'Upload POS data to begin'}
              </div>
            </div>
            {hasSalesData && salesMeta.lastSync && (
              <div style={{ fontSize:10, color:'var(--text-faint)' }}>{typeof salesMeta.lastSync === 'string' ? salesMeta.lastSync.slice(0, 10) : salesMeta.lastSync}</div>
            )}
          </div>
          <div className="lgm-tabs">
            {MOB_TABS.map(t => (
              <button key={t.id} className={`lgm-tab${mobTab === t.id ? ' active' : ''}`} onClick={() => setMobTab(t.id)}>{t.label}</button>
            ))}
          </div>

          {loading ? (
            <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:10 }}>
              <div className="lg-spinner" style={{ width:22, height:22 }} />
              <div style={{ fontSize:12, color:'var(--text-muted)' }}>Loading...</div>
            </div>
          ) : (
            <div className="lgm-scroll">
              {!hasSalesData && mobTab !== 'upload' ? (
                <div style={{ textAlign:'center', padding:'40px 16px' }}>
                  <div style={{ fontSize:13, color:'var(--text-muted)', marginBottom:16, lineHeight:1.5 }}>Upload POS data to see sales analytics</div>
                  <button className="lg-btn-p" style={{ padding:'10px 20px', fontSize:13 }} onClick={() => setMobTab('upload')}>Upload CSV</button>
                </div>
              ) : (
                <>
                  {mobTab === 'overview' && A && (
                    <>
                      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                        {[
                          { l:'Total revenue', v:fmt(A.stats.totalRevenue), c:'var(--text-primary)', s:`${A.stats.totalDays} days` },
                          { l:'Avg / day', v:fmt(A.stats.avgDailyRevenue), c:'var(--text-primary)', s:`~${Math.round(A.stats.avgDailyQty)} items` },
                          { l:'Trend', v:`${A.trendPct >= 0 ? '+' : ''}${A.trendPct.toFixed(1)}%`, c:A.trendPct >= 0 ? 'var(--color-green)' : 'var(--color-red)', s:'first vs latest day' },
                          { l:'Best day', v:fmtK(A.bestDay.rev), c:'var(--text-primary)', s:formatDateLabel(A.bestDay.date) },
                        ].map(({ l, v, c, s }) => (
                          <div key={l} className="lgm-card" style={{ padding:'12px 14px' }}>
                            <div style={{ fontSize:10, color:'var(--text-muted)', fontWeight:500, marginBottom:6 }}>{l}</div>
                            <div style={{ fontSize:20, fontWeight:600, fontVariantNumeric:'tabular-nums', letterSpacing:'-.02em', color:c, lineHeight:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{v}</div>
                            <div style={{ fontSize:9, color:'var(--text-faint)', marginTop:5 }}>{s}</div>
                          </div>
                        ))}
                      </div>
                      <div className="lgm-card">
                        <div className="lg-card-hd">
                          <div className="lg-card-title">Daily revenue</div>
                          <div className="lg-toggle">
                            <button className={`lg-toggle-btn${trendView === 'rev' ? ' active' : ''}`} onClick={() => setTrendView('rev')}>$</button>
                            <button className={`lg-toggle-btn${trendView === 'qty' ? ' active' : ''}`} onClick={() => setTrendView('qty')}>#</button>
                          </div>
                        </div>
                        <div style={{ height:170, display:'flex', flexDirection:'column' }}>
                          <TrendLine data={A.trendData} valueKey={trendView}
                            avg={trendView === 'rev' ? A.stats.avgDailyRevenue : A.stats.avgDailyQty} />
                        </div>
                      </div>
                      <div className="lgm-card">
                        <div className="lg-card-hd"><div className="lg-card-title">Category mix</div></div>
                        <MixBody categoryData={A.categoryData} />
                      </div>
                    </>
                  )}
                  {mobTab === 'movers' && A && (
                    <div className="lgm-card">
                      <div className="lg-card-hd">
                        <div className="lg-toggle">
                          {[['top','Top'],['rising','Rising'],['falling','Falling']].map(([id, l]) => (
                            <button key={id} className={`lg-toggle-btn${moversTab === id ? ' active' : ''}`} onClick={() => setMoversTab(id)}>{l}</button>
                          ))}
                        </div>
                        {moversTab === 'top' ? (
                          <div className="lg-toggle">
                            <button className={`lg-toggle-btn${moversMetric === 'qty' ? ' active' : ''}`} onClick={() => setMoversMetric('qty')}>Qty</button>
                            <button className={`lg-toggle-btn${moversMetric === 'rev' ? ' active' : ''}`} onClick={() => setMoversMetric('rev')}>Rev</button>
                          </div>
                        ) : <span className="lg-card-sub">7d vs prior 7d</span>}
                      </div>
                      <div style={{ display:'flex', flexDirection:'column', minHeight:140 }}>
                        <MoversList tab={moversTab} metric={moversMetric} topSellers={moversMetric === 'qty' ? A.topByQty : A.topByRev} risers={A.risers} fallers={A.fallers} />
                      </div>
                    </div>
                  )}
                  {mobTab === 'rhythm' && A && (
                    <div className="lgm-card">
                      <div className="lg-card-hd">
                        <div className="lg-toggle">
                          <button className={`lg-toggle-btn${rhythmView === 'day' ? ' active' : ''}`} onClick={() => setRhythmView('day')}>By day</button>
                          <button className={`lg-toggle-btn${rhythmView === 'hour' ? ' active' : ''}`} onClick={() => setRhythmView('hour')}>By hour</button>
                        </div>
                        {rhythmView === 'day' && (
                          <div className="lg-toggle">
                            <button className={`lg-toggle-btn${rhythmMetric === 'qty' ? ' active' : ''}`} onClick={() => setRhythmMetric('qty')}>Qty</button>
                            <button className={`lg-toggle-btn${rhythmMetric === 'rev' ? ' active' : ''}`} onClick={() => setRhythmMetric('rev')}>Rev</button>
                          </div>
                        )}
                      </div>
                      <div style={{ display:'flex', flexDirection:'column', height:220 }}>
                        <RhythmBody view={rhythmView} metric={rhythmMetric} dayOfWeekData={A.dayOfWeekData} hourlyData={A.hourlyData} />
                      </div>
                    </div>
                  )}
                  {mobTab === 'upload' && (
                    <>
                      <div className="lgm-card">
                        <div className="lg-card-hd"><div className="lg-card-title">Upload POS data</div></div>
                        <div style={{ border:'1px dashed var(--border)', borderRadius:8, padding:'28px 16px', textAlign:'center', marginBottom:12, cursor:'pointer' }}
                          onClick={() => fileInputRef.current?.click()}>
                          <div style={{ fontSize:14, fontWeight:600, marginBottom:6 }}>Upload sales CSV</div>
                          <div style={{ fontSize:12, color:'var(--text-muted)', marginBottom:14, lineHeight:1.5 }}>Export from your POS system and upload here</div>
                          <button className="lg-btn-p" style={{ padding:'10px 20px', fontSize:13 }}>Choose file</button>
                        </div>
                        {hasSalesData && (
                          <button className="lg-btn-g" style={{ width:'100%', padding:'10px 0', fontSize:13 }} onClick={() => setShowUploadManager(true)}>Manage uploads</button>
                        )}
                      </div>
                      {uploadSuccessMsg && (
                        <div style={{ background:'color-mix(in srgb, var(--color-green) 8%, transparent)', border:'1px solid color-mix(in srgb, var(--color-green) 18%, transparent)', borderRadius:8, padding:'12px 14px', fontSize:12, color:'var(--color-green)' }}>
                          {uploadSuccessMsg}
                        </div>
                      )}
                    </>
                  )}
                </>
              )}
              <div style={{ height:8 }} />
            </div>
          )}

          <div className="lgm-nav">
            {NAV_TABS.map(({ label, path }) => {
              const active = path === '/client/analytics';
              return (
                <div key={label} className={`lgm-nav-item${active ? ' active' : ''}`} onClick={() => router.push(path)}>
                  {path === '/client/dashboard' && <svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>}
                  {path === '/client/invoices' && <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>}
                  {path === '/client/ingredients' && <svg viewBox="0 0 24 24"><path d="M17 8h1a4 4 0 010 8h-1"/><path d="M3 8h14v9a4 4 0 01-4 4H7a4 4 0 01-4-4V8z"/></svg>}
                  {path === '/client/menu-items' && <svg viewBox="0 0 24 24"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>}
                  {path === '/client/analytics' && <svg viewBox="0 0 24 24"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>}
                  <div className="lgm-nav-label">{label === 'Menu Items' ? 'Menu' : label}</div>
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

  // desktop
  return (
    <>
      <Head><title>Analytics — OptiMenu</title></Head>
      <style>{GLOBAL_CSS}</style>
      <div className="lg-root">

        <div className="lg-topbar">
          <div style={{ display:'flex', alignItems:'center', gap:20 }}>
            <div className="lg-logo">Opti<span>Menu</span></div>
            <div className="lg-tabs">
              {NAV_TABS.map(t => (
                <button key={t.label} className={`lg-tab${t.label === 'Analytics' ? ' active' : ''}`}
                  onClick={() => { if (t.label !== 'Analytics') router.push(t.path); }}>{t.label}</button>
              ))}
            </div>
          </div>
          <ProfileDropdown userName={userName} userEmail={userEmail} isMobile={false} />
        </div>

        {loading ? (
          <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:10 }}>
            <div className="lg-spinner" style={{ width:22, height:22 }} />
            <div style={{ fontSize:12, color:'var(--text-muted)' }}>Loading...</div>
          </div>
        ) : !hasSalesData ? (
          <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:14, padding:24 }}>
            <div style={{ fontWeight:600, fontSize:20, letterSpacing:'-.2px', textAlign:'center' }}>
              No sales data yet
            </div>
            <div style={{ fontSize:13, color:'var(--text-muted)', textAlign:'center', maxWidth:440, lineHeight:1.7 }}>
              Export a sales CSV from your POS system and upload it here. Revenue trends, item performance, and hourly breakdowns will populate automatically.
            </div>
            <button className="lg-btn-p" style={{ padding:'10px 22px', fontSize:13 }} onClick={() => fileInputRef.current?.click()}>Upload POS CSV</button>
            {uploadSuccessMsg && <div style={{ fontSize:12, color:'var(--color-green)' }}>{uploadSuccessMsg}</div>}
          </div>
        ) : (
          <div className="lg-room">
            <div className="lg-ph">
              <div>
                <div className="lg-ph-title" style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
                  Sales Analytics
                  {A && A.trendPct !== 0 && (
                    <span className={`lg-chip ${A.trendPct >= 0 ? 'up' : 'dn'}`} style={{ fontSize:11, padding:'3px 8px' }}>
                      {A.trendPct >= 0 ? '+' : '-'}{Math.abs(A.trendPct).toFixed(1)}% {dateRange === 'All' ? 'over the period' : `over the last ${dateRange}`}
                    </span>
                  )}
                </div>
                <div className="lg-meta">
                  Data through {A ? A.anchor : '-'}{salesMeta.posSystem && salesMeta.posSystem !== 'demo' ? ` · ${String(salesMeta.posSystem)}` : ''}
                </div>
              </div>
              <div className="lg-controls">
                {uploadStep === 'done' && uploadSuccessMsg && (
                  <button className="lg-btn-g" style={{ color:'var(--color-green)', borderColor:'color-mix(in srgb, var(--color-green) 25%, transparent)' }}
                    onClick={() => { setUploadStep('idle'); setUploadSuccessMsg(''); }}>{uploadSuccessMsg} ×</button>
                )}
                {rangeToggle}
                <button className="lg-btn-g" onClick={() => setShowUploadManager(true)}>Uploads</button>
                <button className="lg-btn-p" onClick={() => fileInputRef.current?.click()}>Upload CSV</button>
              </div>
            </div>

            <div className="lg-top">
              <div className="lg-glance">
                <div className="lg-gcard">
                  <div className="lg-gcard-l">Revenue</div>
                  <div className="lg-gcard-v">{A ? fmt(A.stats.totalRevenue) : '-'}</div>
                  <div className="lg-gcard-s">{A ? `${A.stats.totalDays} days of sales` : ''}</div>
                </div>
                <div className="lg-gcard">
                  <div className="lg-gcard-l">Avg / day</div>
                  <div className="lg-gcard-v">{A ? fmt(A.stats.avgDailyRevenue) : '-'}</div>
                  <div className="lg-gcard-s">{A ? `~${Math.round(A.stats.avgDailyQty)} items each day` : ''}</div>
                </div>
                <div className="lg-gcard">
                  <div className="lg-gcard-l">Best day</div>
                  <div className="lg-gcard-v">{A ? fmtK(A.bestDay.rev) : '-'}</div>
                  <div className="lg-gcard-s">{A ? `${new Date(`${A.bestDay.date}T12:00:00`).toLocaleDateString('en-US', { weekday:'long' })}, ${formatDateLabel(A.bestDay.date)}` : ''}</div>
                </div>
                <div className="lg-gcard">
                  <div className="lg-gcard-l">Items sold</div>
                  <div className="lg-gcard-v">{A ? Math.round(A.stats.totalQty).toLocaleString() : '-'}</div>
                  <div className="lg-gcard-s">{A ? `across ${A.categoryData.length} categories` : ''}</div>
                </div>
              </div>

              <div className="lg-card">
                <div className="lg-card-hd">
                  <div className="lg-card-title">Daily revenue<span className="lg-card-sub">{dateRange === 'All' ? 'all data' : `last ${dateRange}`} · weekends shaded</span></div>
                  <div className="lg-toggle">
                    <button className={`lg-toggle-btn${trendView === 'rev' ? ' active' : ''}`} onClick={() => setTrendView('rev')}>Revenue</button>
                    <button className={`lg-toggle-btn${trendView === 'qty' ? ' active' : ''}`} onClick={() => setTrendView('qty')}>Covers</button>
                  </div>
                </div>
                {A ? <TrendLine data={A.trendData} valueKey={trendView}
                        avg={trendView === 'rev' ? A.stats.avgDailyRevenue : A.stats.avgDailyQty} />
                   : <div className="lg-empty">No data in this range</div>}
              </div>
            </div>

            <div className="lg-band">

              <div className="lg-card">
                <div className="lg-card-hd">
                  <div className="lg-card-title">Item performance
                    <span className="lg-card-sub">{moversTab === 'top' ? (dateRange === 'All' ? 'all data' : `last ${dateRange}`) : 'last 7d vs prior 7d'}</span>
                  </div>
                  <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                    {moversTab === 'top' && (
                      <div className="lg-toggle">
                        <button className={`lg-toggle-btn${moversMetric === 'qty' ? ' active' : ''}`} onClick={() => setMoversMetric('qty')}>Qty</button>
                        <button className={`lg-toggle-btn${moversMetric === 'rev' ? ' active' : ''}`} onClick={() => setMoversMetric('rev')}>Rev</button>
                      </div>
                    )}
                    <div className="lg-toggle" role="tablist" aria-label="Movers view">
                      {[['top','Top'],['rising','Rising'],['falling','Falling']].map(([id, l]) => (
                        <button key={id} className={`lg-toggle-btn${moversTab === id ? ' active' : ''}`} onClick={() => setMoversTab(id)}>{l}</button>
                      ))}
                    </div>
                  </div>
                </div>
                {A ? <MoversList tab={moversTab} metric={moversMetric} topSellers={moversMetric === 'qty' ? A.topByQty : A.topByRev} risers={A.risers} fallers={A.fallers} />
                   : <div className="lg-empty">No data in this range</div>}
              </div>

              <div className="lg-card">
                <div className="lg-card-hd">
                  <div className="lg-card-title">Sales by day &amp; hour</div>
                  <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                    {rhythmView === 'day' && (
                      <div className="lg-toggle">
                        <button className={`lg-toggle-btn${rhythmMetric === 'qty' ? ' active' : ''}`} onClick={() => setRhythmMetric('qty')}>Qty</button>
                        <button className={`lg-toggle-btn${rhythmMetric === 'rev' ? ' active' : ''}`} onClick={() => setRhythmMetric('rev')}>Rev</button>
                      </div>
                    )}
                    <div className="lg-toggle" role="tablist" aria-label="Rhythm view">
                      <button className={`lg-toggle-btn${rhythmView === 'day' ? ' active' : ''}`} onClick={() => setRhythmView('day')}>Day</button>
                      <button className={`lg-toggle-btn${rhythmView === 'hour' ? ' active' : ''}`} onClick={() => setRhythmView('hour')}>Hour</button>
                    </div>
                  </div>
                </div>
                {A ? <RhythmBody view={rhythmView} metric={rhythmMetric} dayOfWeekData={A.dayOfWeekData} hourlyData={A.hourlyData} />
                   : <div className="lg-empty">No data in this range</div>}
              </div>

              <div className="lg-card">
                <div className="lg-card-hd">
                  <div className="lg-card-title">Category mix<span className="lg-card-sub">revenue share</span></div>
                </div>
                {A ? <MixBody categoryData={A.categoryData} /> : <div className="lg-empty">No data in this range</div>}
              </div>

            </div>
          </div>
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