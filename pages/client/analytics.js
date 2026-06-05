// pages/client/analytics.js
import { useState, useEffect, useRef, useCallback } from 'react';
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

function formatCurrency(n) {
  if (!n && n !== 0) return '$0';
  return parseFloat(n).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
function formatCurrencyDetailed(n) {
  if (!n && n !== 0) return '$0.00';
  return parseFloat(n).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function formatHour(h) {
  if (h === 0) return '12am'; if (h === 12) return '12pm';
  return h < 12 ? `${h}am` : `${h - 12}pm`;
}
function getMarginColor(m) {
  if (!m) return 'var(--text-muted)';
  if (m >= 70) return 'var(--color-green)';
  if (m >= 60) return 'var(--accent)';
  return 'var(--color-red)';
}
function formatDateLabel(dateStr) {
  if (!dateStr) return '';
  const [, m, d] = dateStr.split('-');
  return `${parseInt(m)}/${parseInt(d)}`;
}

const DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const DATE_RANGES = ['7d','14d','30d','All'];
const CAT_COLORS = ['var(--accent)','var(--color-amber)','var(--color-green)','var(--color-red)','#9b7ee8','#e85e8a','#4a9ede'];
const TABS = ['Dashboard','Invoices','Ingredients','Menu Items','Analytics'];
const TAB_PATHS = { Dashboard:'/client/dashboard', Invoices:'/client/invoices', Ingredients:'/client/ingredients', 'Menu Items':'/client/menu-items', Analytics:'/client/analytics' };
const NAV = [
  { label:'Dashboard', path:'/client/dashboard' },
  { label:'Invoices', path:'/client/invoices' },
  { label:'Ingredients', path:'/client/ingredients' },
  { label:'Menu', path:'/client/menu-items' },
  { label:'Analytics', path:'/client/analytics' },
];

function NavIcon({ path }) {
  if (path==='/client/dashboard') return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>;
  if (path==='/client/invoices') return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>;
  if (path==='/client/ingredients') return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 8h1a4 4 0 010 8h-1"/><path d="M3 8h14v9a4 4 0 01-4 4H7a4 4 0 01-4-4V8z"/></svg>;
  if (path==='/client/menu-items') return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>;
  return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>;
}

// ── TrendLine ─────────────────────────────────────────────────────────────────
const PAD = { left: 52, right: 12, top: 10, bottom: 26 };
const FONT_SIZE = 10;

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

  const dateMap = {};
  for (const d of data) {
    const dateKey = typeof d.date === 'string' ? d.date.slice(0, 10) : d.date;
    if (!dateMap[dateKey]) dateMap[dateKey] = { date: dateKey, rev: 0, qty: 0 };
    dateMap[dateKey].rev += d.rev || 0;
    dateMap[dateKey].qty += d.qty || 0;
  }
  const pts = Object.values(dateMap).sort((a, b) => a.date.localeCompare(b.date));

  const { width: W, height: H } = dims;
  const cW = W - PAD.left - PAD.right;
  const cH = H - PAD.top - PAD.bottom;

  const vals = pts.map(d => d[valueKey]);
  const rawMax = pts.length > 0 ? Math.max(...vals, 1) : 1;
  const rawMin = pts.length > 0 ? Math.min(...vals, 0) : 0;
  const mag = Math.pow(10, Math.floor(Math.log10(rawMax)));
  const yMax = Math.ceil((rawMax * 1.08) / mag) * mag;
  const rangePad = (rawMax - rawMin) * 0.15;
  const yMin = Math.max(0, rawMin - rangePad);

  const xOf = useCallback(i =>
    PAD.left + (pts.length <= 1 ? cW / 2 : (i / (pts.length - 1)) * cW),
    [pts.length, cW]
  );
  const yOf = useCallback(v =>
    PAD.top + cH - ((v - yMin) / (yMax - yMin)) * cH,
    [cH, yMin, yMax]
  );

  const linePath = pts.length < 2 ? '' : pts
    .map((d, i) => `${i === 0 ? 'M' : 'L'}${xOf(i).toFixed(1)},${yOf(d[valueKey]).toFixed(1)}`)
    .join(' ');

  const areaPath = pts.length < 2 ? '' :
    `${linePath} L${xOf(pts.length - 1).toFixed(1)},${yOf(yMin).toFixed(1)} L${xOf(0).toFixed(1)},${yOf(yMin).toFixed(1)} Z`;

  const yTicks = [yMin, (yMin + yMax) / 2, yMax];

  const xLabelIdxs = (() => {
    if (pts.length <= 6) return pts.map((_, i) => i);
    const step = Math.ceil((pts.length - 1) / 5);
    const idxs = [];
    for (let i = 0; i < pts.length; i += step) idxs.push(i);
    if (idxs[idxs.length - 1] !== pts.length - 1) idxs.push(pts.length - 1);
    return [...new Set(idxs)];
  })();

  const gradId = `tg_${valueKey}`;
  const clipId = `tc_${valueKey}`;
  const HIT_RADIUS = 24;

  if (!W || !H) {
    return (
      <div ref={wrapRef} style={{ flex: 1, minHeight: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontSize: 11, color: 'var(--text-muted)' }}>Loading chart...</div>
      </div>
    );
  }

  if (pts.length < 2) {
    return (
      <div ref={wrapRef} style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>Not enough data — upload at least 2 days of sales</div>
      </div>
    );
  }

  return (
    <div ref={wrapRef} style={{ flex: 1, minHeight: 0, position: 'relative' }}>
      <svg width={W} height={H} style={{ display: 'block', overflow: 'visible' }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.12" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
          <clipPath id={clipId}>
            <rect x={PAD.left} y={PAD.top} width={cW} height={cH} />
          </clipPath>
        </defs>
        {yTicks.map((t, i) => {
          const y = yOf(t);
          return (
            <g key={i}>
              <line x1={PAD.left} y1={y} x2={W - PAD.right} y2={y} stroke="var(--text-inset)" strokeWidth={0.75} />
              <text x={PAD.left - 6} y={y} textAnchor="end" dominantBaseline="middle" fontSize={FONT_SIZE} fill="var(--text-faint)" fontFamily="Inter, sans-serif">
                {valueKey === 'rev' ? formatCurrency(t) : Math.round(t)}
              </text>
            </g>
          );
        })}
        <line x1={PAD.left} y1={yOf(yMin)} x2={W - PAD.right} y2={yOf(yMin)} stroke="var(--border)" strokeWidth={0.75} />
        {areaPath && <path d={areaPath} fill={`url(#${gradId})`} clipPath={`url(#${clipId})`} />}
        {linePath && <path d={linePath} fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" clipPath={`url(#${clipId})`} />}
        {pts.map((d, i) => (
          <circle key={`dot-${i}`} cx={xOf(i)} cy={yOf(d[valueKey])} r={activeIdx === i ? 5 : 3} fill={color}
            stroke={activeIdx === i ? 'var(--bg-root)' : 'none'} strokeWidth={activeIdx === i ? 2 : 0}
            style={{ transition: 'r .1s', pointerEvents: 'none' }} />
        ))}
        {pts.map((d, i) => (
          <circle key={`hit-${i}`} cx={xOf(i)} cy={yOf(d[valueKey])} r={HIT_RADIUS} fill="transparent" style={{ cursor: 'crosshair' }}
            onMouseEnter={e => { setActiveIdx(i); setTip({ x: e.clientX, y: e.clientY, d }); }}
            onMouseMove={e => setTip(prev => prev ? { ...prev, x: e.clientX, y: e.clientY } : null)}
            onMouseLeave={() => { setActiveIdx(null); setTip(null); }} />
        ))}
        {activeIdx !== null && (
          <line x1={xOf(activeIdx)} y1={PAD.top} x2={xOf(activeIdx)} y2={PAD.top + cH}
            stroke={color} strokeWidth={1} strokeDasharray="3 3" opacity={0.4} />
        )}
        {xLabelIdxs.map(i => (
          <text key={i} x={xOf(i)} y={H - 6}
            textAnchor={i === 0 ? 'start' : i === pts.length - 1 ? 'end' : 'middle'}
            fontSize={FONT_SIZE} fill={activeIdx === i ? color : 'var(--text-faint)'} fontFamily="Inter, sans-serif">
            {formatDateLabel(pts[i].date)}
          </text>
        ))}
      </svg>
      {tip && (
        <div style={{ position: 'fixed', left: tip.x + 14, top: tip.y - 52, background: 'var(--text-inset)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px', fontSize: 11, color: 'var(--text-primary)', pointerEvents: 'none', whiteSpace: 'nowrap', zIndex: 999, boxShadow: '0 2px 8px rgba(0,0,0,.45)' }}>
          <div style={{ fontWeight: 600, color, marginBottom: 2 }}>{valueKey === 'rev' ? formatCurrencyDetailed(tip.d[valueKey]) : Math.round(tip.d[valueKey])}</div>
          <div style={{ color: 'var(--text-muted)', fontSize: 10 }}>{formatDateLabel(tip.d.date)}</div>
        </div>
      )}
    </div>
  );
}

// ── CategoryBars ─────────────────────────────────────────────────────────────
function CategoryBars({ data }) {
  if (!data || !data.length) return <div style={{ display:'flex', alignItems:'center', justifyContent:'center', flex:1, fontSize:11, color:'var(--text-muted)' }}>No category data</div>;
  const max = Math.max(...data.map(d => d.value), 1);
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'clamp(5px,.5vh,9px)', flex:1, minHeight:0, justifyContent:'space-evenly' }}>
      {data.map((d, i) => (
        <div key={d.name} style={{ display:'flex', alignItems:'center', gap:8 }}>
          <div style={{ width:'clamp(70px,7vw,110px)', fontSize:'clamp(9px,.68vw,11px)', color:'var(--text-muted)', flexShrink:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{d.name}</div>
          <div style={{ flex:1, background:'var(--text-inset)', borderRadius:3, height:'clamp(4px,.35vh,6px)', overflow:'hidden' }}>
            <div style={{ height:'100%', borderRadius:3, background: CAT_COLORS[i % CAT_COLORS.length], width:`${(d.value/max)*100}%`, transition:'width .4s ease' }}/>
          </div>
          <div style={{ fontSize:'clamp(9px,.68vw,11px)', fontWeight:600, color: CAT_COLORS[i % CAT_COLORS.length], minWidth:'clamp(40px,4vw,65px)', textAlign:'right', flexShrink:0 }}>{formatCurrency(d.value)}</div>
          <div style={{ fontSize:'clamp(8px,.6vw,10px)', color:'var(--text-muted)', minWidth:28, textAlign:'right', flexShrink:0 }}>{((d.value/data.reduce((s,x)=>s+x.value,0))*100).toFixed(0)}%</div>
        </div>
      ))}
    </div>
  );
}

// ── ByDayCards ────────────────────────────────────────────────────────────────
function ByDayCards({ dayOfWeekData, allSales, dateRange, dayView }) {
  const [selectedDay, setSelectedDay] = useState(null);
  const maxQty = Math.max(...dayOfWeekData.map(d => d.qty), 1);
  const maxRev = Math.max(...dayOfWeekData.map(d => d.rev), 1);

  const dayCatData = selectedDay ? (() => {
    const daySales = allSales.filter(s => s.day_of_week === selectedDay);
    const catMap = {};
    for (const s of daySales) { const cat = s.category || 'Uncategorized'; catMap[cat] = (catMap[cat] || 0) + parseFloat(s.revenue || 0); }
    return Object.entries(catMap).sort((a,b) => b[1]-a[1]).map(([name,value]) => ({name,value}));
  })() : [];

  if (selectedDay) {
    const dayData = dayOfWeekData.find(d => d.day === selectedDay);
    return (
      <div style={{ display:'flex', flexDirection:'column', flex:1, minHeight:0, gap:'clamp(5px,.5vh,8px)' }}>
        <div style={{ display:'flex', alignItems:'center', gap:8, flexShrink:0 }}>
          <button onClick={() => setSelectedDay(null)} style={{ background:'none', border:'1px solid var(--border)', borderRadius:5, padding:'3px 8px', fontSize:'clamp(9px,.68vw,11px)', color:'var(--text-muted)', cursor:'pointer', fontFamily:"'Inter',sans-serif" }}>← Back</button>
          <div style={{ fontFamily:"'Playfair Display',serif", fontSize:'clamp(12px,.95vw,16px)', color:'var(--text-primary)' }}>{selectedDay}</div>
          <div style={{ fontSize:'clamp(9px,.68vw,11px)', color:'var(--text-muted)', marginLeft:'auto' }}>{formatCurrency(dayData?.rev||0)} · {Math.round(dayData?.qty||0)} items</div>
        </div>
        <div style={{ flex:1, minHeight:0, display:'flex', flexDirection:'column', gap:'clamp(4px,.4vh,7px)', justifyContent:'space-evenly' }}>
          {dayCatData.map((d,i) => (
            <div key={d.name} style={{ display:'flex', alignItems:'center', gap:8 }}>
              <div style={{ width:'clamp(70px,7vw,110px)', fontSize:'clamp(9px,.68vw,11px)', color:'var(--text-muted)', flexShrink:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{d.name}</div>
              <div style={{ flex:1, background:'var(--text-inset)', borderRadius:3, height:'clamp(4px,.35vh,6px)' }}>
                <div style={{ height:'100%', borderRadius:3, background:CAT_COLORS[i%CAT_COLORS.length], width:`${(d.value/Math.max(...dayOfWeekData.map(x=>x.rev),1))*100}%`, transition:'width .4s' }}/>
              </div>
              <div style={{ fontSize:'clamp(9px,.68vw,11px)', fontWeight:600, color:CAT_COLORS[i%CAT_COLORS.length], minWidth:'clamp(40px,4vw,60px)', textAlign:'right' }}>{formatCurrency(d.value)}</div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', flex:1, minHeight:0, gap:'clamp(4px,.4vh,6px)' }}>
      {dayOfWeekData.map(d => {
        const barPct = dayView === 'qty' ? (d.qty / maxQty) * 100 : (d.rev / maxRev) * 100;
        const val = dayView === 'qty' ? Math.round(d.qty) : formatCurrency(d.rev);
        const hasData = d.qty > 0;
        return (
          <div key={d.day} onClick={() => hasData && setSelectedDay(d.day)}
            style={{ background:'var(--bg-elevated)', border:'1px solid var(--border)', borderRadius:7, padding:'clamp(6px,.6vw,10px)', display:'flex', alignItems:'center', gap:8, cursor:hasData?'pointer':'default', flex:1, transition:'border-color .15s, background .15s' }}
            onMouseEnter={e => { if (hasData) { e.currentTarget.style.borderColor='var(--accent)'; e.currentTarget.style.background='#131210'; }}}
            onMouseLeave={e => { e.currentTarget.style.borderColor='var(--border)'; e.currentTarget.style.background='var(--bg-elevated)'; }}>
            <div style={{ width:'clamp(26px,2.5vw,36px)', fontSize:'clamp(9px,.68vw,11px)', color:hasData?'var(--text-primary)':'var(--text-muted)', fontWeight:600, flexShrink:0 }}>{d.day.slice(0,3)}</div>
            <div style={{ flex:1, background:'var(--text-inset)', borderRadius:3, height:'clamp(3px,.3vh,5px)' }}>
              <div style={{ height:'100%', borderRadius:3, background:'var(--color-amber)', width:`${barPct}%`, transition:'width .4s ease' }}/>
            </div>
            <div style={{ fontSize:'clamp(9px,.68vw,11px)', fontWeight:600, color:'var(--color-amber)', minWidth:'clamp(36px,3.5vw,56px)', textAlign:'right', flexShrink:0 }}>{hasData?val:'—'}</div>
            {hasData && <div style={{ fontSize:'clamp(8px,.6vw,10px)', color:'var(--accent)', flexShrink:0 }}>›</div>}
          </div>
        );
      })}
    </div>
  );
}

// ── ByTimeCard ────────────────────────────────────────────────────────────────
function ByTimeCard({ hourlyData, maxHourQty }) {
  const [expandedHour, setExpandedHour] = useState(null);
  const expanded = expandedHour !== null ? hourlyData.find(h => h.hour === expandedHour) : null;

  return (
    <div style={{ display:'flex', flexDirection:'column', flex:1, minHeight:0 }}>
      <div style={{ display:'flex', gap:3, flex: expandedHour !== null ? '0 0 auto' : 1, minHeight:0, alignItems:'stretch', transition:'flex .2s' }}>
        {hourlyData.map(h => {
          const intensity = maxHourQty > 0 ? h.qty / maxHourQty : 0;
          const bg = intensity > 0.7 ? 'var(--color-red)' : intensity > 0.4 ? 'var(--color-amber)' : intensity > 0.1 ? 'var(--accent)' : 'var(--text-inset)';
          const isActive = expandedHour === h.hour;
          return (
            <div key={h.hour} onClick={() => setExpandedHour(isActive ? null : h.hour)}
              style={{ flex:1, borderRadius:5, display:'flex', alignItems:'flex-end', justifyContent:'center', background:bg, opacity:intensity>0?0.3+intensity*0.7:0.25, cursor:'pointer', minHeight:expandedHour!==null?'clamp(28px,3vh,40px)':'clamp(32px,4vh,56px)', transition:'min-height .2s, opacity .15s, outline .15s', outline:isActive?`2px solid ${bg}`:'2px solid transparent', outlineOffset:2, position:'relative' }}>
              <span style={{ fontSize:'clamp(7px,.52vw,9px)', color:intensity>0.5?'var(--bg-root)':'var(--text-muted)', paddingBottom:3, fontFamily:"'Inter',sans-serif" }}>{formatHour(h.hour)}</span>
            </div>
          );
        })}
      </div>
      {expanded && (
        <div style={{ marginTop:8, background:'var(--bg-elevated)', border:'1px solid var(--border)', borderRadius:7, padding:'clamp(8px,.75vw,12px)', flexShrink:0 }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:6 }}>
            <div style={{ fontSize:'clamp(11px,.85vw,14px)', fontWeight:600, color:'var(--text-primary)', fontFamily:"'Playfair Display',serif" }}>{formatHour(expanded.hour)}</div>
            <button onClick={() => setExpandedHour(null)} style={{ background:'none', border:'none', color:'var(--text-muted)', cursor:'pointer', fontSize:14, lineHeight:1 }}>×</button>
          </div>
          <div style={{ display:'flex', gap:'clamp(12px,1.5vw,24px)' }}>
            <div><div style={{ fontSize:'clamp(7px,.55vw,9px)', color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'.5px', marginBottom:2 }}>Items Sold</div><div style={{ fontSize:'clamp(13px,1.1vw,18px)', fontWeight:600, color:'var(--accent)', fontFamily:"'Playfair Display',serif" }}>{Math.round(expanded.qty)}</div></div>
            <div><div style={{ fontSize:'clamp(7px,.55vw,9px)', color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'.5px', marginBottom:2 }}>% of Day</div><div style={{ fontSize:'clamp(13px,1.1vw,18px)', fontWeight:600, color:'var(--color-amber)', fontFamily:"'Playfair Display',serif" }}>{maxHourQty > 0 ? ((expanded.qty / hourlyData.reduce((s,h)=>s+h.qty,0))*100).toFixed(1) : 0}%</div></div>
            <div><div style={{ fontSize:'clamp(7px,.55vw,9px)', color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'.5px', marginBottom:2 }}>vs Peak</div><div style={{ fontSize:'clamp(13px,1.1vw,18px)', fontWeight:600, color:'var(--color-green)', fontFamily:"'Playfair Display',serif" }}>{maxHourQty > 0 ? ((expanded.qty / maxHourQty)*100).toFixed(0) : 0}%</div></div>
          </div>
        </div>
      )}
      <div style={{ display:'flex', gap:8, marginTop:6, flexWrap:'wrap', flexShrink:0 }}>
        {[{c:'var(--color-red)',l:'Peak'},{c:'var(--color-amber)',l:'Busy'},{c:'var(--accent)',l:'Steady'},{c:'var(--text-inset)',l:'Quiet'}].map(({c,l}) => (
          <div key={l} style={{ display:'flex', alignItems:'center', gap:3, fontSize:'clamp(7px,.55vw,9px)', color:'var(--text-muted)' }}>
            <div style={{ width:7, height:7, borderRadius:2, background:c }}/>{l}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Upload Manager Modal ───────────────────────────────────────────────────────
function UploadManagerModal({ restaurantId, onClose, onDeleted }) {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(null);
  const [deleteStep, setDeleteStep] = useState(0);
  const [deleteInput, setDeleteInput] = useState('');

  useEffect(() => { loadSessions(); }, []);

  async function loadSessions() {
    setLoading(true);
    const { data } = await supabase.from('upload_sessions').select('*').eq('restaurant_id', restaurantId).order('uploaded_at', { ascending: false });
    setSessions(data || []);
    setLoading(false);
  }

  function startDelete(session) { setDeleting(session); setDeleteStep(1); setDeleteInput(''); }
  function cancelDelete() { setDeleting(null); setDeleteStep(0); setDeleteInput(''); }

  async function confirmDelete() {
    if (!deleting) return;
    const { error } = await supabase.from('upload_sessions').delete().eq('id', deleting.id);
    if (!error) {
      try { await supabase.from('activity_logs').insert({ restaurant_id: restaurantId, activity_type: 'pos_upload_deleted', title: 'POS Upload Deleted', subtitle: deleting.filename || 'Unknown file', details: `Deleted ${deleting.row_count} records from ${deleting.date_from} to ${deleting.date_to}`, metadata: { session_id: deleting.id, row_count: deleting.row_count } }); } catch {}
      cancelDelete();
      await loadSessions();
      onDeleted();
    }
  }

  return (
    <div style={{ position:'fixed', inset:0, zIndex:50, background:'rgba(10,9,8,.88)', display:'flex', alignItems:'center', justifyContent:'center', padding:20 }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background:'var(--bg-surface)', border:'1px solid var(--border)', borderRadius:12, width:'min(640px,92%)', maxHeight:'80vh', display:'flex', flexDirection:'column', overflow:'hidden' }}>
        <div style={{ padding:'clamp(14px,1.4vw,22px)', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
          <div><div style={{ fontFamily:"'Playfair Display',serif", fontSize:'clamp(14px,1.1vw,18px)', color:'var(--text-primary)' }}>Upload History</div><div style={{ fontSize:'clamp(9px,.68vw,11px)', color:'var(--text-muted)', marginTop:2 }}>Manage your uploaded POS files</div></div>
          <button onClick={onClose} style={{ background:'none', border:'none', color:'var(--text-muted)', cursor:'pointer', fontSize:20, lineHeight:1, padding:4 }}>×</button>
        </div>
        <div style={{ flex:1, overflowY:'auto', padding:'clamp(10px,1vw,18px)' }}>
          {loading ? (
            <div style={{ display:'flex', alignItems:'center', justifyContent:'center', padding:40, gap:10, color:'var(--text-muted)', fontSize:13 }}>
              <div style={{ width:16, height:16, border:'2px solid var(--border)', borderTopColor:'var(--accent)', borderRadius:'50%', animation:'spin .7s linear infinite' }}/>Loading...
            </div>
          ) : sessions.length === 0 ? <div style={{ textAlign:'center', padding:40, fontSize:13, color:'var(--text-muted)' }}>No uploads yet</div> : (
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              {sessions.map(s => (
                <div key={s.id} style={{ background:'var(--bg-elevated)', border:'1px solid var(--border)', borderRadius:8, padding:'clamp(10px,1vw,16px)' }}>
                  {deleting?.id === s.id ? (
                    <div>
                      {deleteStep === 1 && (<>
                        <div style={{ fontSize:'clamp(11px,.85vw,14px)', fontWeight:600, color:'var(--color-red)', marginBottom:6 }}>Delete this upload?</div>
                        <div style={{ fontSize:'clamp(9px,.68vw,11px)', color:'var(--text-muted)', marginBottom:12, lineHeight:1.5 }}>This will permanently remove <strong style={{ color:'var(--text-primary)' }}>{s.row_count.toLocaleString()} records</strong> from {s.date_from} to {s.date_to}.</div>
                        <div style={{ display:'flex', gap:8 }}>
                          <button onClick={() => setDeleteStep(2)} style={{ background:'rgba(192,64,64,.1)', border:'1px solid rgba(192,64,64,.3)', borderRadius:6, padding:'5px 12px', fontSize:'clamp(9px,.68vw,11px)', color:'var(--color-red)', cursor:'pointer', fontFamily:"'Inter',sans-serif" }}>Yes, continue</button>
                          <button onClick={cancelDelete} style={{ background:'none', border:'1px solid var(--border)', borderRadius:6, padding:'5px 12px', fontSize:'clamp(9px,.68vw,11px)', color:'var(--text-muted)', cursor:'pointer', fontFamily:"'Inter',sans-serif" }}>Cancel</button>
                        </div>
                      </>)}
                      {deleteStep === 2 && (<>
                        <div style={{ fontSize:'clamp(11px,.85vw,14px)', fontWeight:600, color:'var(--color-red)', marginBottom:6 }}>Final confirmation</div>
                        <div style={{ fontSize:'clamp(9px,.68vw,11px)', color:'var(--text-muted)', marginBottom:10 }}>Type <strong style={{ color:'var(--text-primary)', fontFamily:'monospace' }}>DELETE</strong> to permanently remove this data.</div>
                        <input autoFocus value={deleteInput} onChange={e => setDeleteInput(e.target.value)} placeholder="Type DELETE" style={{ background:'var(--bg-surface)', border:`1px solid ${deleteInput==='DELETE'?'var(--color-red)':'var(--border)'}`, borderRadius:6, padding:'6px 10px', fontSize:'clamp(10px,.78vw,12px)', color:'var(--text-primary)', outline:'none', fontFamily:'monospace', width:'100%', marginBottom:10 }} />
                        <div style={{ display:'flex', gap:8 }}>
                          <button disabled={deleteInput !== 'DELETE'} onClick={confirmDelete} style={{ background:deleteInput==='DELETE'?'rgba(192,64,64,.15)':'var(--text-inset)', border:`1px solid ${deleteInput==='DELETE'?'rgba(192,64,64,.4)':'var(--border)'}`, borderRadius:6, padding:'5px 12px', fontSize:'clamp(9px,.68vw,11px)', color:deleteInput==='DELETE'?'var(--color-red)':'var(--text-muted)', cursor:deleteInput==='DELETE'?'pointer':'not-allowed', fontFamily:"'Inter',sans-serif" }}>Permanently Delete</button>
                          <button onClick={cancelDelete} style={{ background:'none', border:'1px solid var(--border)', borderRadius:6, padding:'5px 12px', fontSize:'clamp(9px,.68vw,11px)', color:'var(--text-muted)', cursor:'pointer', fontFamily:"'Inter',sans-serif" }}>Cancel</button>
                        </div>
                      </>)}
                    </div>
                  ) : (
                    <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:'clamp(10px,.78vw,13px)', fontWeight:600, color:'var(--text-primary)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{s.filename || 'Uploaded file'}</div>
                        <div style={{ fontSize:'clamp(8px,.62vw,10px)', color:'var(--text-muted)', marginTop:2 }}>{s.date_from} → {s.date_to} · {s.row_count.toLocaleString()} records · {s.pos_system || 'unknown POS'}</div>
                        <div style={{ fontSize:'clamp(8px,.62vw,10px)', color:'var(--text-faint)', marginTop:1 }}>{new Date(s.uploaded_at).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric', hour:'2-digit', minute:'2-digit' })}</div>
                      </div>
                      <button onClick={() => startDelete(s)} style={{ background:'none', border:'1px solid rgba(192,64,64,.2)', borderRadius:6, padding:'4px 10px', fontSize:'clamp(8px,.62vw,10px)', color:'var(--color-red)', cursor:'pointer', fontFamily:"'Inter',sans-serif", flexShrink:0 }} onMouseEnter={e => e.currentTarget.style.background='rgba(192,64,64,.08)'} onMouseLeave={e => e.currentTarget.style.background='none'}>Delete</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Duplicate Detection Modal ──────────────────────────────────────────────────
function DuplicateModal({ incoming, existing, onProceed, onCancel }) {
  return (
    <div style={{ position:'fixed', inset:0, zIndex:60, background:'rgba(10,9,8,.92)', display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
      <div style={{ background:'var(--bg-surface)', border:'1px solid rgba(212,160,32,.3)', borderRadius:12, width:'min(700px,95%)', maxHeight:'85vh', display:'flex', flexDirection:'column', overflow:'hidden' }}>
        <div style={{ padding:'clamp(14px,1.4vw,22px)', borderBottom:'1px solid var(--border)', flexShrink:0 }}>
          <div style={{ fontFamily:"'Playfair Display',serif", fontSize:'clamp(14px,1.1vw,18px)', color:'var(--color-amber)', marginBottom:4 }}>⚠ Duplicate Upload Detected</div>
          <div style={{ fontSize:'clamp(9px,.68vw,12px)', color:'var(--text-muted)' }}>This file covers dates that overlap with an existing upload.</div>
        </div>
        <div style={{ flex:1, overflowY:'auto', padding:'clamp(10px,1vw,18px)', display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
          <div style={{ background:'var(--bg-elevated)', border:'1px solid var(--border)', borderRadius:8, padding:'clamp(10px,1vw,16px)' }}>
            <div style={{ fontSize:'clamp(8px,.62vw,10px)', color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'.7px', marginBottom:8 }}>Existing Upload</div>
            <div style={{ fontSize:'clamp(10px,.78vw,13px)', color:'var(--text-primary)', fontWeight:600, marginBottom:4 }}>{existing.filename || 'Previous upload'}</div>
            <div style={{ fontSize:'clamp(9px,.68vw,11px)', color:'var(--text-muted)' }}>{existing.date_from} → {existing.date_to}</div>
            <div style={{ fontSize:'clamp(9px,.68vw,11px)', color:'var(--text-muted)' }}>{existing.row_count?.toLocaleString()} records</div>
          </div>
          <div style={{ background:'var(--bg-elevated)', border:'1px solid rgba(212,160,32,.2)', borderRadius:8, padding:'clamp(10px,1vw,16px)' }}>
            <div style={{ fontSize:'clamp(8px,.62vw,10px)', color:'var(--color-amber)', textTransform:'uppercase', letterSpacing:'.7px', marginBottom:8 }}>New Upload</div>
            <div style={{ fontSize:'clamp(10px,.78vw,13px)', color:'var(--text-primary)', fontWeight:600, marginBottom:4 }}>{incoming.filename}</div>
            <div style={{ fontSize:'clamp(9px,.68vw,11px)', color:'var(--text-muted)' }}>{incoming.dateFrom} → {incoming.dateTo}</div>
            <div style={{ fontSize:'clamp(9px,.68vw,11px)', color:'var(--text-muted)' }}>{incoming.rowCount?.toLocaleString()} records</div>
          </div>
        </div>
        <div style={{ padding:'clamp(10px,1vw,16px)', borderTop:'1px solid var(--border)', display:'flex', gap:10, flexShrink:0 }}>
          <button onClick={onProceed} style={{ background:'var(--accent)', border:'none', borderRadius:6, padding:'7px 16px', fontSize:'clamp(10px,.78vw,12px)', fontWeight:600, color:'var(--bg-root)', cursor:'pointer', fontFamily:"'Inter',sans-serif" }}>Import Anyway</button>
          <button onClick={onCancel} style={{ background:'none', border:'1px solid var(--border)', borderRadius:6, padding:'7px 16px', fontSize:'clamp(10px,.78vw,12px)', color:'var(--text-muted)', cursor:'pointer', fontFamily:"'Inter',sans-serif" }}>Cancel Upload</button>
        </div>
      </div>
    </div>
  );
}

// ── CSS ──────────────────────────────────────────────────────────────────────
const CSS = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
html,body{height:100%;background:var(--bg-root);overflow:hidden;}
#__next{height:100%;}
@keyframes spin{to{transform:rotate(360deg);}}
@keyframes blink{0%,100%{opacity:1}50%{opacity:.3}}
input::placeholder,textarea::placeholder{color:var(--text-faint)!important;}
::-webkit-scrollbar{width:3px;}::-webkit-scrollbar-track{background:var(--bg-elevated);}::-webkit-scrollbar-thumb{background:var(--border);border-radius:2px;}

.an-root{font-family:'Inter',sans-serif;background:var(--bg-root);color:var(--text-primary);width:100%;height:100vh;display:flex;flex-direction:column;overflow:hidden;}
.an-nav{background:var(--bg-elevated);border-bottom:1px solid var(--border);height:clamp(36px,4vh,52px);padding:0 clamp(10px,1vw,20px);display:flex;align-items:center;justify-content:space-between;flex-shrink:0;}
.an-logo{font-family:'Playfair Display',serif;font-size:clamp(13px,1.1vw,18px);color:var(--text-primary);letter-spacing:-.3px;}
.an-logo span{color:var(--accent);}
.an-tab{padding:clamp(2px,.3vh,4px) clamp(6px,.6vw,11px);border-radius:4px;font-size:clamp(10px,.75vw,13px);color:var(--text-muted);border:none;background:none;cursor:pointer;font-family:'Inter',sans-serif;transition:all .15s;}
.an-tab.active{color:var(--text-primary);background:var(--text-inset);}
.an-ph{background:var(--bg-surface);border-bottom:1px solid var(--border);padding:0 clamp(10px,1vw,20px);min-height:clamp(36px,4vh,48px);display:flex;align-items:center;justify-content:space-between;flex-shrink:0;gap:10px;flex-wrap:wrap;}
.an-ph-title{font-size:clamp(11px,.82vw,15px);font-weight:600;color:var(--text-primary);font-family:'Inter',sans-serif;}
.an-ph-sub{font-size:clamp(9px,.62vw,11px);color:var(--text-muted);margin-left:6px;font-family:'Inter',sans-serif;}
.mi-ph-action-item{display:flex;align-items:center;gap:4px;font-size:clamp(9px,.62vw,11px);color:var(--text-muted);}
.mi-ph-action-dot{width:5px;height:5px;border-radius:50%;flex-shrink:0;}
.mi-ph-action-val{font-weight:600;font-family:'Inter',sans-serif;}
.an-range-toggle{display:flex;background:var(--bg-elevated);border:1px solid var(--border);border-radius:5px;padding:2px;gap:2px;}
.an-range-btn{padding:2px clamp(6px,.5vw,10px);border-radius:3px;font-size:clamp(9px,.65vw,11px);font-weight:500;cursor:pointer;border:none;font-family:'Inter',sans-serif;color:var(--text-muted);background:transparent;transition:all .15s;}
.an-range-btn.active{background:var(--text-inset);color:var(--text-primary);}
.an-sync-dot{width:4px;height:4px;border-radius:50%;background:var(--color-green);animation:blink 2s infinite;flex-shrink:0;}
.an-body{flex:1;min-height:0;padding:clamp(6px,.6vw,10px) clamp(24px,3vw,60px);gap:clamp(6px,.6vw,10px);display:grid;grid-template-columns:1fr 1fr 1fr 1fr;grid-template-rows:1fr 1fr;overflow:hidden;}
.an-trend-card{grid-column:1/4;grid-row:1;display:flex;flex-direction:column;min-height:0;overflow:hidden;}
.an-r1-col4{grid-column:4;grid-row:1;display:flex;flex-direction:column;gap:clamp(6px,.6vw,10px);min-height:0;overflow:hidden;}
.an-day-col{grid-column:1;grid-row:2;display:flex;flex-direction:column;min-height:0;overflow:hidden;}
.an-cat-col{grid-column:2;grid-row:2;display:flex;flex-direction:column;min-height:0;overflow:hidden;}
.an-time-col{grid-column:3;grid-row:2;display:flex;flex-direction:column;gap:clamp(6px,.6vw,10px);min-height:0;overflow:hidden;}
.an-wow-col{grid-column:4;grid-row:2;display:flex;flex-direction:column;gap:clamp(6px,.6vw,10px);min-height:0;overflow:hidden;}
.an-card{background:var(--bg-surface);border:1px solid var(--border);border-radius:8px;padding:clamp(8px,.8vw,14px);display:flex;flex-direction:column;min-height:0;overflow:hidden;}
.an-card-hd{display:flex;align-items:center;justify-content:space-between;margin-bottom:clamp(6px,.6vh,10px);flex-shrink:0;gap:6px;flex-wrap:wrap;}
.an-card-title{font-size:clamp(9px,.72vw,13px);font-weight:600;color:var(--text-primary);display:flex;align-items:center;gap:5px;}
.an-card-title svg{width:clamp(10px,.8vw,13px);height:clamp(10px,.8vw,13px);stroke:var(--accent);fill:none;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;}
.an-badge{font-size:clamp(7px,.58vw,9px);font-weight:600;padding:2px 7px;border-radius:10px;white-space:nowrap;}
.an-toggle{display:flex;background:var(--bg-elevated);border-radius:5px;padding:2px;gap:2px;}
.an-toggle-btn{padding:clamp(1px,.15vh,3px) clamp(6px,.5vw,10px);border-radius:3px;font-size:clamp(8px,.6vw,10px);cursor:pointer;border:none;font-family:'Inter',sans-serif;color:var(--text-muted);background:transparent;transition:all .15s;}
.an-toggle-btn.active{background:var(--text-inset);color:var(--text-primary);}
.an-bar-row{display:flex;align-items:center;gap:clamp(5px,.45vw,8px);margin-bottom:clamp(4px,.4vh,7px);}
.an-bar-row:last-child{margin-bottom:0;}
.an-bar-label{font-size:clamp(8px,.62vw,11px);color:var(--text-muted);width:clamp(65px,6.5vw,110px);flex-shrink:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.an-bar-track{flex:1;background:var(--text-inset);border-radius:3px;height:clamp(3px,.3vh,5px);}
.an-bar-fill{height:100%;border-radius:3px;transition:width .4s ease;}
.an-bar-val{font-size:clamp(8px,.62vw,11px);font-weight:600;width:clamp(38px,3.5vw,60px);text-align:right;flex-shrink:0;}
.an-table{width:100%;border-collapse:collapse;}
.an-th{font-size:clamp(7px,.58vw,9px);font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.7px;padding:clamp(4px,.4vh,6px) clamp(6px,.55vw,10px);border-bottom:1px solid var(--border);text-align:left;white-space:nowrap;}
.an-th.r{text-align:right;}
.an-td{font-size:clamp(9px,.68vw,11px);color:var(--text-muted);padding:clamp(5px,.5vh,8px) clamp(6px,.55vw,10px);border-bottom:1px solid var(--text-inset);}
.an-td.p{color:var(--text-primary);font-weight:500;}
.an-td.a{color:var(--accent);font-weight:600;}
.an-td.r{text-align:right;}
.an-td.d{color:var(--color-red);}
.an-td.s{color:var(--color-green);}
.an-tr:hover td{background:rgba(26,25,21,.5);}
.an-risk-h{background:rgba(192,64,64,.1);color:var(--color-red);border:1px solid rgba(192,64,64,.2);font-size:clamp(7px,.58vw,9px);padding:1px 6px;border-radius:8px;white-space:nowrap;}
.an-risk-m{background:rgba(212,160,32,.1);color:var(--color-amber);border:1px solid rgba(212,160,32,.2);font-size:clamp(7px,.58vw,9px);padding:1px 6px;border-radius:8px;white-space:nowrap;}
.an-trend-up{color:var(--color-green);font-size:clamp(8px,.62vw,10px);font-weight:600;}
.an-trend-dn{color:var(--color-red);font-size:clamp(8px,.62vw,10px);font-weight:600;}
.an-btn-p{background:var(--accent);border:none;border-radius:6px;padding:clamp(5px,.5vw,8px) clamp(10px,.9vw,16px);font-size:clamp(10px,.78vw,12px);font-weight:600;color:var(--bg-root);cursor:pointer;font-family:'Inter',sans-serif;transition:background .2s;white-space:nowrap;}
.an-btn-p:hover{background:#01bcd4;}
.an-btn-g{background:none;border:1px solid var(--border);border-radius:6px;padding:clamp(5px,.5vw,8px) clamp(10px,.9vw,16px);font-size:clamp(10px,.78vw,12px);color:var(--text-muted);cursor:pointer;font-family:'Inter',sans-serif;transition:all .15s;white-space:nowrap;}
.an-btn-g:hover{color:var(--text-primary);border-color:var(--text-faint);}
.an-mapper{background:var(--bg-surface);border:1px solid var(--border);border-radius:10px;padding:clamp(12px,1.2vw,20px);flex:1;overflow-y:auto;}
.an-mapper-title{font-size:clamp(12px,.95vw,16px);font-weight:600;color:var(--text-primary);margin-bottom:4px;}
.an-mapper-sub{font-size:clamp(10px,.75vw,13px);color:var(--text-muted);margin-bottom:12px;}
.an-mapper-grid{display:grid;grid-template-columns:1fr 1fr;gap:clamp(6px,.6vw,10px);margin-bottom:12px;}
.an-mapper-lbl{font-size:clamp(9px,.65vw,10px);color:#6b6358;text-transform:uppercase;letter-spacing:.5px;font-weight:600;margin-bottom:4px;}
.an-mapper-lbl.req::after{content:' *';color:var(--color-red);}
.an-mapper-select{background:var(--bg-elevated);border:1px solid var(--border);border-radius:6px;padding:clamp(5px,.5vw,8px) clamp(7px,.65vw,10px);font-size:clamp(10px,.78vw,12px);color:var(--text-primary);outline:none;font-family:'Inter',sans-serif;width:100%;cursor:pointer;}
.an-mapper-select:focus{border-color:var(--accent);}
.an-empty{display:flex;align-items:center;justify-content:center;flex:1;font-size:clamp(9px,.72vw,12px);color:var(--text-muted);padding:clamp(10px,1.5vh,20px) 0;text-align:center;}
.an-scrollable{overflow-y:auto;flex:1;min-height:0;}
.an-scrollable::-webkit-scrollbar{width:3px;}
`;

export default function AnalyticsPage() {
  const router = useRouter();
  const { isMobile: _isMobile, width } = useWindowSize();
  const isMobile = width < 480;
  const fileInputRef = useRef(null);
  const mobFileInputRef = useRef(null);
  const pendingUploadRef = useRef(null);

  const [restaurantId, setRestaurantId] = useState(null);
  const [userName, setUserName] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedPOS, setSelectedPOS] = useState('other');
  const [detectedPOS, setDetectedPOS] = useState(null);
  const [uploadStep, setUploadStep] = useState('idle');
  const [csvRows, setCsvRows] = useState([]);
  const [csvHeaders, setCsvHeaders] = useState([]);
  const [columnMapping, setColumnMapping] = useState({});
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadMsg, setUploadMsg] = useState('');
  const [pendingFilename, setPendingFilename] = useState('');
  const [dateRange, setDateRange] = useState('14d');
  const [dayView, setDayView] = useState('qty');
  const [trendView, setTrendView] = useState('rev');
  const [allSales, setAllSales] = useState([]);
  const [hasSalesData, setHasSalesData] = useState(false);
  const [salesMeta, setSalesMeta] = useState({ lastSync: null, posSystem: null });
  const [topSellers, setTopSellers] = useState([]);
  const [slowMovers, setSlowMovers] = useState([]);
  const [dayOfWeekData, setDayOfWeekData] = useState([]);
  const [hourlyData, setHourlyData] = useState([]);
  const [inventoryRisk, setInventoryRisk] = useState([]);
  const [categoryData, setCategoryData] = useState([]);
  const [trendData, setTrendData] = useState([]);
  const [weekOverWeek, setWeekOverWeek] = useState({ improvers: [], decliners: [] });
  const [stats, setStats] = useState({ totalDays: 0, totalRevenue: 0, avgDailyRevenue: 0 });
  const [mobTab, setMobTab] = useState('sales');
  const [showUploadManager, setShowUploadManager] = useState(false);
  const [duplicateInfo, setDuplicateInfo] = useState(null);
  const [uploadSuccessMsg, setUploadSuccessMsg] = useState('');

  const { tourProps } = useTour('analytics', restaurantId);
  const isTour = router.isReady && router.query.tour === 'true';

  useEffect(() => { if (router.isReady) init(); }, [router.isReady]);
  useEffect(() => { if (allSales.length) computeAnalytics(allSales); }, [allSales, dateRange]);

  useEffect(() => {
    if (!router.isReady || !isTour) return;
    fetchSampleData().then(sample => {
      if (!sample?.posSales) return;
      setAllSales(sample.posSales);
      setHasSalesData(true);
      setSalesMeta({ lastSync: sample.posSales[0]?.sale_date || null, posSystem: 'tour' });
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
    let allRows = [];
    let from = 0;
    let pages = 0;

    while (pages < MAX_PAGES) {
      const { data, error } = await supabase
        .from('pos_sales')
        .select('*')
        .eq('restaurant_id', restId)
        .order('sale_date', { ascending: false })
        .range(from, from + PAGE_SIZE - 1);

      if (error || !data?.length) break;

      allRows = allRows.concat(data);
      pages++;
      if (data.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }

    if (!allRows.length) { setHasSalesData(false); return; }
    setHasSalesData(true);
    setAllSales(allRows);
    setSalesMeta({ lastSync: allRows[0]?.sale_date || null, posSystem: allRows[0]?.pos_system || null });
  }

  function getFilteredSales(sales) {
    if (dateRange === 'All') return sales;
    const days = dateRange === '7d' ? 7 : dateRange === '14d' ? 14 : 30;
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().split('T')[0];
    return sales.filter(s => { const dateStr = typeof s.sale_date === 'string' ? s.sale_date.slice(0, 10) : s.sale_date; return dateStr >= cutoffStr; });
  }

  async function computeAnalytics(sales) {
    const filtered = getFilteredSales(sales);
    if (!filtered.length) return;
    const dates = [...new Set(filtered.map(s => typeof s.sale_date === 'string' ? s.sale_date.slice(0,10) : s.sale_date))];
    const totalRevenue = filtered.reduce((t, s) => t + parseFloat(s.revenue||0), 0);
    setStats({ totalDays: dates.length, totalRevenue, avgDailyRevenue: dates.length > 0 ? totalRevenue/dates.length : 0 });

    const itemMap = {};
    for (const s of filtered) {
      if (!itemMap[s.item_name]) itemMap[s.item_name] = { name: s.item_name, qty: 0, rev: 0, category: s.category };
      itemMap[s.item_name].qty += parseFloat(s.quantity_sold||0);
      itemMap[s.item_name].rev += parseFloat(s.revenue||0);
    }
    const items = Object.values(itemMap).sort((a,b) => b.qty-a.qty);
    setTopSellers(items.slice(0,8));

    // ── Slow Movers: compare last 7 days vs prior 7 days, flag ≥20% drop ──
    const sevenAgo = new Date(); sevenAgo.setDate(sevenAgo.getDate()-7);
    const fourteenAgo = new Date(); fourteenAgo.setDate(fourteenAgo.getDate()-14);
    const sevenAgoStr = sevenAgo.toISOString().split('T')[0];
    const fourteenAgoStr = fourteenAgo.toISOString().split('T')[0];
    const recentMap = {};   // last 7 days
    const prevMap = {};     // prior 7 days (days 8–14 back)
    for (const s of filtered) {
      const d = s.sale_date.slice(0,10);
      const qty = parseFloat(s.quantity_sold||0);
      if (d >= sevenAgoStr) recentMap[s.item_name] = (recentMap[s.item_name]||0) + qty;
      else if (d >= fourteenAgoStr) prevMap[s.item_name] = (prevMap[s.item_name]||0) + qty;
    }
    const slowMoverItems = items
      .filter(i => {
        const prev = prevMap[i.name] || 0;
        const curr = recentMap[i.name] || 0;
        if (prev === 0) return false; // no baseline to compare against
        return curr <= prev * 0.80;  // current week is ≤80% of prior (20%+ drop)
      })
      .sort((a, b) => {
        const dropA = ((prevMap[a.name]||0) - (recentMap[a.name]||0)) / (prevMap[a.name]||1);
        const dropB = ((prevMap[b.name]||0) - (recentMap[b.name]||0)) / (prevMap[b.name]||1);
        return dropB - dropA;
      })
      .slice(0, 6)
      .map(i => ({
        ...i,
        recentQty: recentMap[i.name] || 0,
        prevQty: prevMap[i.name] || 0,
        dropPct: prevMap[i.name] > 0
          ? Math.round(((prevMap[i.name] - (recentMap[i.name]||0)) / prevMap[i.name]) * 100)
          : 0,
      }));
    setSlowMovers(slowMoverItems);

    const dayMap = {};
    for (const d of DAYS) dayMap[d] = { day: d, qty: 0, rev: 0 };
    for (const s of filtered) { if (s.day_of_week && dayMap[s.day_of_week]) { dayMap[s.day_of_week].qty += parseFloat(s.quantity_sold||0); dayMap[s.day_of_week].rev += parseFloat(s.revenue||0); } }
    setDayOfWeekData(DAYS.map(d => dayMap[d]));

    const hourMap = {};
    for (const s of filtered) { if (s.hour_of_day !== null && s.hour_of_day !== undefined) { const h = parseInt(s.hour_of_day); hourMap[h] = (hourMap[h]||0) + parseFloat(s.quantity_sold||0); } }
    const hoursWithData = Object.keys(hourMap).map(Number).filter(h => hourMap[h]>0).sort((a,b) => a-b);
    const minH = hoursWithData[0]??0, maxH = hoursWithData[hoursWithData.length-1]??23;
    const openHrs = Array.from({ length: maxH-minH+1 }, (_,i) => minH+i);
    setHourlyData(openHrs.map(h => ({ hour: h, qty: hourMap[h]||0 })));

    const catMap = {};
    for (const s of filtered) { const cat = s.category||'Uncategorized'; catMap[cat] = (catMap[cat]||0) + parseFloat(s.revenue||0); }
    setCategoryData(Object.entries(catMap).sort((a,b) => b[1]-a[1]).map(([name,value]) => ({name,value})));

    const dailyMap = {};
    for (const s of filtered) {
      const dateKey = typeof s.sale_date === 'string' ? s.sale_date.slice(0,10) : s.sale_date;
      if (!dailyMap[dateKey]) dailyMap[dateKey] = { date: dateKey, rev: 0, qty: 0 };
      dailyMap[dateKey].rev += parseFloat(s.revenue||0);
      dailyMap[dateKey].qty += parseFloat(s.quantity_sold||0);
    }
    setTrendData(Object.values(dailyMap).sort((a,b) => a.date.localeCompare(b.date)));

    const thisWkStr = new Date(Date.now()-7*864e5).toISOString().split('T')[0];
    const lastWkStr = new Date(Date.now()-14*864e5).toISOString().split('T')[0];
    const twMap = {}, lwMap = {};
    for (const s of sales) {
      const d = s.sale_date.slice(0,10);
      if (d >= thisWkStr) twMap[s.item_name] = (twMap[s.item_name]||0) + parseFloat(s.quantity_sold||0);
      else if (d >= lastWkStr) lwMap[s.item_name] = (lwMap[s.item_name]||0) + parseFloat(s.quantity_sold||0);
    }
    const wowItems = Object.keys({...twMap,...lwMap}).map(name => { const tw=twMap[name]||0, lw=lwMap[name]||0, change=lw>0?((tw-lw)/lw)*100:tw>0?100:0; return {name,tw,lw,change}; });
    setWeekOverWeek({ improvers: wowItems.filter(i => i.change>0&&i.tw>0).sort((a,b) => b.change-a.change).slice(0,4), decliners: wowItems.filter(i => i.change<0&&i.lw>0).sort((a,b) => a.change-b.change).slice(0,4) });

    if (restaurantId) {
      const { data: ings } = await supabase.from('ingredients').select('name,last_ordered_at,unit').eq('restaurant_id', restaurantId).not('last_ordered_at','is',null);
      const risk = (ings||[]).filter(ing => ing.last_ordered_at >= sevenAgoStr).map(ing => {
        const ingL = ing.name.toLowerCase();
        const slow = items.find(i => (recentMap[i.name]||0)<3 && (i.name.toLowerCase().includes(ingL.split(' ')[0])||ingL.includes(i.name.toLowerCase().split(' ')[0])));
        if (!slow) return null;
        return { ingredient: ing.name, unit: ing.unit, lastOrdered: ing.last_ordered_at, riskLevel: (recentMap[slow.name]||0)===0?'high':'medium', linkedDish: slow.name };
      }).filter(Boolean).sort((a,b) => a.riskLevel==='high'?-1:1);
      setInventoryRisk(risk.slice(0,6));
    }
  }

  function handleFileSelect(files) {
    const file = files[0]; if (!file) return;
    setPendingFilename(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const rows = parseCSV(e.target.result);
        const headers = Object.keys(rows[0]||{});
        const det = detectPOSSystem(headers);
        const mapping = buildColumnMapping(headers, selectedPOS!=='other'?selectedPOS:det);
        setCsvRows(rows); setCsvHeaders(headers); setColumnMapping(mapping);
        if (det!=='other') { setSelectedPOS(det); setDetectedPOS(det); }
        setUploadStep('mapping'); setUploadMsg('');
      } catch(err) { setUploadMsg('Failed to parse CSV: '+err.message); }
    };
    reader.readAsText(file);
  }

  async function checkForDuplicates(normalized) {
    if (!restaurantId) return null;
    const dates = normalized.map(r => r.sale_date).sort();
    const dateFrom = dates[0]; const dateTo = dates[dates.length - 1];
    const { data: overlapping } = await supabase.from('upload_sessions').select('*').eq('restaurant_id', restaurantId).lte('date_from', dateTo).gte('date_to', dateFrom).limit(1);
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
        setDuplicateInfo({ incoming: { filename: pendingFilename, dateFrom: dates[0], dateTo: dates[dates.length-1], rowCount: normalized.length }, existing: duplicate });
        pendingUploadRef.current = normalized;
        setUploadStep('mapping');
        return;
      }
      await executeUpload(normalized);
    } catch(err) { setUploadMsg('Upload failed: '+err.message); setUploadStep('mapping'); }
  }

  async function executeUpload(normalized) {
    try {
      const dates = normalized.map(r => r.sale_date).sort();
      const dateFrom = dates[0]; const dateTo = dates[dates.length - 1];
      const { data: session, error: sessionErr } = await supabase.from('upload_sessions').insert({ restaurant_id: restaurantId, filename: pendingFilename, row_count: normalized.length, date_from: dateFrom, date_to: dateTo, pos_system: selectedPOS }).select().single();
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
      await supabase.from('pos_sales').delete().eq('restaurant_id', restaurantId).gte('sale_date', dateFrom).lte('sale_date', dateTo).not('upload_session_id', 'eq', session.id);
      try { await supabase.from('activity_logs').insert({ restaurant_id: restaurantId, activity_type: 'pos_upload', title: 'POS Data Uploaded', subtitle: pendingFilename, details: `Imported ${normalized.length} records from ${dateFrom} to ${dateTo}`, metadata: { session_id: session.id, row_count: normalized.length, date_from: dateFrom, date_to: dateTo } }); } catch {}
      setUploadProgress(100);
      setUploadSuccessMsg(`Successfully imported ${normalized.length} records across ${[...new Set(normalized.map(r=>r.sale_date))].length} days.`);
      setUploadStep('done');
      setHasSalesData(true);
      setDuplicateInfo(null);
      pendingUploadRef.current = null;
      await loadSalesData(restaurantId);
    } catch(err) { setUploadMsg('Upload failed: '+err.message); setUploadStep('mapping'); }
  }

  const maxTopQty = topSellers[0]?.qty||1;
  const maxTopRev = Math.max(...topSellers.map(i => i.rev), 1);
  const maxHourQty = Math.max(...hourlyData.map(h => h.qty), 1);

  const MAPPER_FIELDS = [
    {f:'item_name',req:true},{f:'sale_date',req:true},{f:'quantity_sold',req:true},{f:'revenue',req:true},
    {f:'category',req:false},{f:'unit_price',req:false},{f:'hour_of_day',req:false},{f:'voids',req:false},{f:'comps',req:false}
  ];

  // ── MOBILE ──────────────────────────────────────────────────────────────────
  if (isMobile) {
    const MOB_TABS = [
      { id: 'sales',     label: 'Sales' },
      { id: 'sellers',   label: 'Items' },
      { id: 'patterns',  label: 'Patterns' },
      { id: 'risk',      label: 'Risk' },
      { id: 'upload',    label: 'Upload' },
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
          .mob2-tabs { background:var(--bg-surface); border-bottom:1px solid var(--border); display:flex; overflow-x:auto; flex-shrink:0; -webkit-overflow-scrolling:touch; }
          .mob2-tabs::-webkit-scrollbar { display:none; }
          .mob2-tab { flex-shrink:0; padding:10px 14px; font-size:12px; font-weight:500; color:var(--text-muted); border:none; background:none; cursor:pointer; font-family:'Inter',sans-serif; border-bottom:2px solid transparent; white-space:nowrap; -webkit-tap-highlight-color:transparent; }
          .mob2-tab.active { color:var(--accent); border-bottom-color:var(--accent); }
          .mob2-content { flex:1; overflow-y:auto; padding:12px 16px; display:flex; flex-direction:column; gap:12px; -webkit-overflow-scrolling:touch; }
          .mob2-content::-webkit-scrollbar { display:none; }
          .mob2-card { background:var(--bg-surface); border:1px solid var(--border); border-radius:10px; padding:14px; flex-shrink:0; }
          .mob2-card-title { font-size:11px; font-weight:600; color:var(--text-primary); text-transform:uppercase; letter-spacing:.7px; margin-bottom:12px; display:flex; align-items:center; gap:6px; }
          .mob2-card-title svg { width:12px; height:12px; stroke:var(--accent); fill:none; stroke-width:1.5; stroke-linecap:round; stroke-linejoin:round; }
          .mob2-bottom-nav { background:var(--bg-elevated); border-top:1px solid var(--border); padding:8px 0 0; padding-bottom:env(safe-area-inset-bottom,8px); display:flex; flex-shrink:0; position:sticky; bottom:0; z-index:50; }
          .mob2-nav-item { flex:1; display:flex; flex-direction:column; align-items:center; gap:3px; cursor:pointer; padding:4px 0; -webkit-tap-highlight-color:transparent; }
          .mob2-nav-icon svg { width:20px; height:20px; stroke:var(--text-muted); fill:none; stroke-width:1.5; stroke-linecap:round; stroke-linejoin:round; }
          .mob2-nav-icon.active svg { stroke:var(--accent); }
          .mob2-nav-label { font-size:10px; color:var(--text-muted); }
          .mob2-nav-label.active { color:var(--accent); }
        `}</style>

        <div className="mob2-root">
          <div className="mob2-header">
            <div className="mob2-logo">Opti<span>Menu</span></div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div className="an-range-toggle">
                {DATE_RANGES.map(r => <button key={r} className={`an-range-btn${dateRange===r?' active':''}`} onClick={() => setDateRange(r)}>{r}</button>)}
              </div>
              <ProfileDropdown userName={userName} userEmail={userEmail} isMobile={true} />
            </div>
          </div>

          <div className="mob2-subbar">
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Sales Analytics</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
                {hasSalesData ? `${stats.totalDays} days · ${formatCurrency(stats.totalRevenue)} total` : 'Upload POS data to begin'}
              </div>
            </div>
            {hasSalesData && salesMeta.lastSync && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--color-green)' }}>
                <div style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--color-green)', animation: 'blink 2s infinite' }} />
                {typeof salesMeta.lastSync === 'string' ? salesMeta.lastSync.slice(0, 10) : salesMeta.lastSync}
              </div>
            )}
          </div>

          <div className="mob2-tabs">
            {MOB_TABS.map(t => (
              <button key={t.id} className={`mob2-tab${mobTab === t.id ? ' active' : ''}`} onClick={() => setMobTab(t.id)}>{t.label}</button>
            ))}
          </div>

          {loading ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 10 }}>
              <div style={{ width: 22, height: 22, border: '2px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loading analytics...</div>
            </div>
          ) : (
            <div className="mob2-content">

              {mobTab === 'sales' && (
                <>
                  {!hasSalesData ? (
                    <div style={{ textAlign: 'center', padding: '40px 16px' }}>
                      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>Upload POS data to see sales analytics</div>
                      <button onClick={() => setMobTab('upload')} style={{ background: 'var(--accent)', border: 'none', borderRadius: 8, padding: '10px 20px', fontSize: 13, fontWeight: 600, color: '#0a0908', cursor: 'pointer', fontFamily: 'Inter,sans-serif' }}>Upload CSV →</button>
                    </div>
                  ) : (
                    <>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        {[
                          { l: 'Days of Data', v: stats.totalDays, c: 'var(--accent)' },
                          { l: 'Total Revenue', v: formatCurrency(stats.totalRevenue), c: 'var(--color-green)' },
                          { l: 'Avg Daily', v: formatCurrency(stats.avgDailyRevenue), c: 'var(--color-amber)' },
                          { l: 'Items Tracked', v: topSellers.length, c: 'var(--text-primary)' },
                        ].map(({ l, v, c }) => (
                          <div key={l} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px' }}>
                            <div style={{ fontSize: 10, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 6 }}>{l}</div>
                            <div style={{ fontSize: 20, fontWeight: 700, color: c, lineHeight: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v}</div>
                          </div>
                        ))}
                      </div>

                      <div className="mob2-card">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                          <div className="mob2-card-title" style={{ marginBottom: 0 }}>
                            <svg viewBox="0 0 24 24"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
                            Revenue Trend
                          </div>
                          <div className="an-toggle">
                            <button className={`an-toggle-btn${trendView==='rev'?' active':''}`} onClick={() => setTrendView('rev')}>Rev</button>
                            <button className={`an-toggle-btn${trendView==='qty'?' active':''}`} onClick={() => setTrendView('qty')}>Qty</button>
                          </div>
                        </div>
                        <div style={{ height: 120 }}>
                          <TrendLine data={trendData} color="var(--accent)" valueKey={trendView} />
                        </div>
                      </div>

                      {categoryData.length > 0 && (
                        <div className="mob2-card">
                          <div className="mob2-card-title">
                            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 2v10l4 2"/></svg>
                            By Category
                          </div>
                          {categoryData.slice(0, 5).map((d, i) => {
                            const max = Math.max(...categoryData.map(x => x.value), 1);
                            const total = categoryData.reduce((s, x) => s + x.value, 0);
                            return (
                              <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                                <div style={{ fontSize: 12, color: 'var(--text-muted)', width: 110, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</div>
                                <div style={{ flex: 1, background: 'var(--text-inset)', borderRadius: 3, height: 5, overflow: 'hidden' }}>
                                  <div style={{ height: '100%', borderRadius: 3, background: CAT_COLORS[i % CAT_COLORS.length], width: `${(d.value / max) * 100}%` }} />
                                </div>
                                <div style={{ fontSize: 12, fontWeight: 600, color: CAT_COLORS[i % CAT_COLORS.length], width: 55, textAlign: 'right', flexShrink: 0 }}>{formatCurrency(d.value)}</div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </>
                  )}
                </>
              )}

              {mobTab === 'sellers' && (
                <>
                  {!hasSalesData ? (
                    <div style={{ textAlign: 'center', padding: '40px 16px', fontSize: 13, color: 'var(--text-muted)' }}>Upload POS data to see item performance</div>
                  ) : (
                    <>
                      <div className="mob2-card">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                          <div className="mob2-card-title" style={{ marginBottom: 0 }}>
                            <svg viewBox="0 0 24 24"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
                            Top Sellers
                          </div>
                          <div className="an-toggle">
                            <button className={`an-toggle-btn${dayView==='qty'?' active':''}`} onClick={() => setDayView('qty')}>Qty</button>
                            <button className={`an-toggle-btn${dayView==='rev'?' active':''}`} onClick={() => setDayView('rev')}>Rev</button>
                          </div>
                        </div>
                        {topSellers.map((item, i) => (
                          <div key={item.name} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', width: 20, textAlign: 'right', flexShrink: 0 }}>{i + 1}</div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</div>
                              <div style={{ marginTop: 4, height: 4, background: 'var(--text-inset)', borderRadius: 2, overflow: 'hidden' }}>
                                <div style={{ height: '100%', borderRadius: 2, background: 'var(--accent)', width: `${dayView === 'qty' ? (item.qty / maxTopQty) * 100 : (item.rev / maxTopRev) * 100}%` }} />
                              </div>
                            </div>
                            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)', flexShrink: 0, width: 55, textAlign: 'right' }}>
                              {dayView === 'qty' ? Math.round(item.qty) : formatCurrency(item.rev)}
                            </div>
                          </div>
                        ))}
                      </div>

                      {slowMovers.length > 0 && (
                        <div className="mob2-card">
                          <div className="mob2-card-title" style={{ color: 'var(--color-red)' }}>
                            <svg viewBox="0 0 24 24"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/></svg>
                            Slow Movers (vs prior 7d)
                          </div>
                          {slowMovers.map(item => (
                            <div key={item.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--text-inset)' }}>
                              <div style={{ fontSize: 13, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{item.name}</div>
                              <div style={{ display: 'flex', gap: 12, flexShrink: 0 }}>
                                <div style={{ textAlign: 'right' }}>
                                  <div style={{ fontSize: 9, color: 'var(--text-faint)', textTransform: 'uppercase' }}>Prev</div>
                                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>{Math.round(item.prevQty)}</div>
                                </div>
                                <div style={{ textAlign: 'right' }}>
                                  <div style={{ fontSize: 9, color: 'var(--text-faint)', textTransform: 'uppercase' }}>Now</div>
                                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-red)' }}>{Math.round(item.recentQty)}</div>
                                </div>
                                <div style={{ textAlign: 'right' }}>
                                  <div style={{ fontSize: 9, color: 'var(--text-faint)', textTransform: 'uppercase' }}>Drop</div>
                                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-red)' }}>-{item.dropPct}%</div>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {(weekOverWeek.improvers.length > 0 || weekOverWeek.decliners.length > 0) && (
                        <div className="mob2-card">
                          <div className="mob2-card-title">
                            <svg viewBox="0 0 24 24"><polyline points="17 11 12 6 7 11"/><polyline points="17 18 12 13 7 18"/></svg>
                            Week vs Week
                          </div>
                          {weekOverWeek.improvers.slice(0, 3).map(item => (
                            <div key={item.name} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                              <div style={{ flex: 1, fontSize: 12, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</div>
                              <div style={{ width: 60, height: 4, background: 'var(--text-inset)', borderRadius: 2, overflow: 'hidden' }}>
                                <div style={{ width: `${Math.min(100, item.change)}%`, height: '100%', background: 'var(--color-green)', borderRadius: 2 }} />
                              </div>
                              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-green)', width: 40, textAlign: 'right' }}>+{item.change.toFixed(0)}%</div>
                            </div>
                          ))}
                          {weekOverWeek.decliners.slice(0, 3).map(item => (
                            <div key={item.name} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                              <div style={{ flex: 1, fontSize: 12, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</div>
                              <div style={{ width: 60, height: 4, background: 'var(--text-inset)', borderRadius: 2, overflow: 'hidden' }}>
                                <div style={{ width: `${Math.min(100, Math.abs(item.change))}%`, height: '100%', background: 'var(--color-red)', borderRadius: 2 }} />
                              </div>
                              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-red)', width: 40, textAlign: 'right' }}>{item.change.toFixed(0)}%</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </>
              )}

              {mobTab === 'patterns' && (
                <>
                  {!hasSalesData ? (
                    <div style={{ textAlign: 'center', padding: '40px 16px', fontSize: 13, color: 'var(--text-muted)' }}>Upload POS data to see patterns</div>
                  ) : (
                    <>
                      <div className="mob2-card">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                          <div className="mob2-card-title" style={{ marginBottom: 0 }}>
                            <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                            By Day
                          </div>
                          <div className="an-toggle">
                            <button className={`an-toggle-btn${dayView==='qty'?' active':''}`} onClick={() => setDayView('qty')}>Qty</button>
                            <button className={`an-toggle-btn${dayView==='rev'?' active':''}`} onClick={() => setDayView('rev')}>Rev</button>
                          </div>
                        </div>
                        {dayOfWeekData.map(d => {
                          const maxVal = dayView === 'qty' ? Math.max(...dayOfWeekData.map(x => x.qty), 1) : Math.max(...dayOfWeekData.map(x => x.rev), 1);
                          const val = dayView === 'qty' ? d.qty : d.rev;
                          const hasData = d.qty > 0;
                          return (
                            <div key={d.day} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                              <div style={{ width: 32, fontSize: 12, fontWeight: 600, color: hasData ? 'var(--text-primary)' : 'var(--text-muted)', flexShrink: 0 }}>{d.day.slice(0, 3)}</div>
                              <div style={{ flex: 1, background: 'var(--text-inset)', borderRadius: 3, height: 5, overflow: 'hidden' }}>
                                <div style={{ height: '100%', borderRadius: 3, background: 'var(--color-amber)', width: hasData ? `${(val / maxVal) * 100}%` : '0%' }} />
                              </div>
                              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-amber)', width: 55, textAlign: 'right', flexShrink: 0 }}>
                                {hasData ? (dayView === 'qty' ? Math.round(val) : formatCurrency(val)) : '—'}
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {hourlyData.length > 0 && (
                        <div className="mob2-card">
                          <div className="mob2-card-title">
                            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                            By Time of Day
                          </div>
                          <div style={{ display: 'flex', gap: 3, marginBottom: 8 }}>
                            {hourlyData.map(h => {
                              const intensity = maxHourQty > 0 ? h.qty / maxHourQty : 0;
                              const bg = intensity > 0.7 ? 'var(--color-red)' : intensity > 0.4 ? 'var(--color-amber)' : intensity > 0.1 ? 'var(--accent)' : 'var(--text-inset)';
                              return (
                                <div key={h.hour} style={{ flex: 1, height: 32, borderRadius: 4, background: bg, opacity: intensity > 0 ? 0.3 + intensity * 0.7 : 0.25, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 2 }}>
                                  <span style={{ fontSize: 7, color: intensity > 0.5 ? '#0a0908' : 'var(--text-muted)' }}>{formatHour(h.hour).replace('am','').replace('pm','')}</span>
                                </div>
                              );
                            })}
                          </div>
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            {[{ c: 'var(--color-red)', l: 'Peak' }, { c: 'var(--color-amber)', l: 'Busy' }, { c: 'var(--accent)', l: 'Steady' }, { c: 'var(--text-inset)', l: 'Quiet' }].map(({ c, l }) => (
                              <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: 'var(--text-muted)' }}>
                                <div style={{ width: 8, height: 8, borderRadius: 2, background: c }} />{l}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </>
              )}

              {mobTab === 'risk' && (
                <div className="mob2-card">
                  <div className="mob2-card-title">
                    <svg viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                    Inventory Risk
                  </div>
                  {!hasSalesData ? (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: '16px 0' }}>Upload POS data to identify risk</div>
                  ) : inventoryRisk.length === 0 ? (
                    <div style={{ fontSize: 12, color: 'var(--color-green)', textAlign: 'center', padding: '16px 0' }}>No at-risk ingredients identified ✓</div>
                  ) : inventoryRisk.map((r, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--text-inset)' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.ingredient}</div>
                        {r.linkedDish && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>Used in: {r.linkedDish}</div>}
                      </div>
                      <span className={r.riskLevel === 'high' ? 'an-risk-h' : 'an-risk-m'}>{r.riskLevel === 'high' ? 'High' : 'Med'} Risk</span>
                    </div>
                  ))}
                </div>
              )}

              {mobTab === 'upload' && (
                <>
                  <div className="mob2-card">
                    <div className="mob2-card-title">
                      <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                      Upload POS Data
                    </div>
                    <div style={{ border: '2px dashed var(--border)', borderRadius: 10, padding: '28px 16px', textAlign: 'center', marginBottom: 12 }}
                      onClick={() => mobFileInputRef.current?.click()}>
                      <input ref={mobFileInputRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={e => handleFileSelect(e.target.files)} />
                      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>Upload Sales CSV</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14 }}>Export from your POS system and upload here</div>
                      <button style={{ background: 'var(--accent)', border: 'none', borderRadius: 7, padding: '10px 20px', fontSize: 13, fontWeight: 600, color: '#0a0908', cursor: 'pointer', fontFamily: 'Inter,sans-serif' }}>Choose File</button>
                    </div>
                    {hasSalesData && (
                      <button onClick={() => setShowUploadManager(true)} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 7, padding: '10px 0', width: '100%', fontSize: 13, color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'Inter,sans-serif' }}>
                        Manage Uploads
                      </button>
                    )}
                  </div>

                  {uploadSuccessMsg && (
                    <div style={{ background: 'rgba(42,138,90,.1)', border: '1px solid rgba(42,138,90,.2)', borderRadius: 8, padding: '12px 14px', fontSize: 12, color: 'var(--color-green)' }}>
                      ✓ {uploadSuccessMsg}
                    </div>
                  )}
                </>
              )}

              <div style={{ height: 8 }} />
            </div>
          )}

          <div className="mob2-bottom-nav">
            {NAV.map(({ label, path }) => {
              const active = path === '/client/analytics';
              return (
                <div key={label} className="mob2-nav-item" onClick={() => router.push(path)}>
                  <div className={`mob2-nav-icon${active ? ' active' : ''}`}><NavIcon path={path} /></div>
                  <div className={`mob2-nav-label${active ? ' active' : ''}`}>{label}</div>
                </div>
              );
            })}
          </div>
        </div>

        {uploadStep === 'mapping' && !duplicateInfo && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 40, background: 'rgba(10,9,8,.95)', display: 'flex', flexDirection: 'column', padding: 16, paddingTop: 'max(16px,env(safe-area-inset-top))' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>Map Columns</div>
              <button onClick={() => { setUploadStep('idle'); setUploadMsg(''); }} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 20 }}>×</button>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>{csvRows.length} rows · {detectedPOS ? `Detected: ${detectedPOS}` : 'Map required fields'}</div>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {MAPPER_FIELDS.map(({ f, req }) => (
                <div key={f} style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 10, color: '#6b6358', textTransform: 'uppercase', letterSpacing: .5, fontWeight: 600, marginBottom: 4 }}>{f.replace(/_/g, ' ')}{req && <span style={{ color: 'var(--color-red)' }}> *</span>}</div>
                  <select value={columnMapping[f] || ''} onChange={e => setColumnMapping(prev => ({ ...prev, [f]: e.target.value || null }))}
                    style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 10px', fontSize: 13, color: 'var(--text-primary)', outline: 'none', fontFamily: 'Inter,sans-serif', width: '100%' }}>
                    <option value="">— not in CSV —</option>
                    {csvHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              ))}
            </div>
            {uploadMsg && <div style={{ fontSize: 12, color: 'var(--color-red)', marginBottom: 10 }}>{uploadMsg}</div>}
            <div style={{ display: 'flex', gap: 8, paddingBottom: 'max(16px,env(safe-area-inset-bottom))' }}>
              <button onClick={handleUploadConfirm} style={{ flex: 1, background: 'var(--accent)', border: 'none', borderRadius: 8, padding: 12, fontSize: 13, fontWeight: 600, color: '#0a0908', cursor: 'pointer', fontFamily: 'Inter,sans-serif' }}>Import {csvRows.length} rows</button>
              <button onClick={() => { setUploadStep('idle'); setUploadMsg(''); }} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 16px', fontSize: 13, color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'Inter,sans-serif' }}>Cancel</button>
            </div>
          </div>
        )}

        {uploadStep === 'uploading' && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 40, background: 'rgba(10,9,8,.95)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12 }}>
            <div style={{ width: 28, height: 28, border: '2px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>Importing...</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{uploadProgress}%</div>
            <div style={{ width: 220, background: 'var(--text-inset)', borderRadius: 4, height: 4 }}><div style={{ height: 4, borderRadius: 4, background: 'var(--accent)', width: `${uploadProgress}%`, transition: 'width .3s' }} /></div>
          </div>
        )}

        {duplicateInfo && (
          <DuplicateModal
            incoming={duplicateInfo.incoming}
            existing={duplicateInfo.existing}
            onProceed={async () => { setDuplicateInfo(null); setUploadStep('uploading'); await executeUpload(pendingUploadRef.current); }}
            onCancel={() => { setDuplicateInfo(null); setUploadStep('idle'); pendingUploadRef.current = null; }}
          />
        )}

        {showUploadManager && restaurantId && (
          <UploadManagerModal restaurantId={restaurantId} onClose={() => setShowUploadManager(false)} onDeleted={async () => { await loadSalesData(restaurantId); if (allSales.length === 0) setHasSalesData(false); }} />
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
      <div className="an-root">
        <div className="an-nav">
          <div style={{ display:'flex', alignItems:'center', gap:'clamp(8px,1vw,16px)' }}>
            <div className="an-logo">Opti<span>Menu</span></div>
            <div style={{ display:'flex', gap:2 }}>{TABS.map(t => <button key={t} className={`an-tab${t==='Analytics'?' active':''}`} onClick={() => router.push(TAB_PATHS[t])}>{t}</button>)}</div>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:'clamp(6px,.7vw,12px)' }}>
            <div style={{ display:'flex', alignItems:'center', gap:4, fontSize:'clamp(9px,.65vw,12px)', color:'var(--accent)' }}><div style={{ width:'clamp(4px,.35vw,6px)', height:'clamp(4px,.35vw,6px)', background:'var(--accent)', borderRadius:'50%', animation:'blink 2s infinite' }}/>Active</div>
            <ProfileDropdown userName={userName} userEmail={userEmail} isMobile={false}/>
          </div>
        </div>

        {/* ── Header bar — Inter font, stats + last sync + controls all on one row ── */}
        <div className="an-ph">
          <div style={{ display:'flex', alignItems:'baseline', gap:6 }}>
            <span className="an-ph-title">Sales Analytics</span>
            <span className="an-ph-sub">· POS intelligence · inventory risk</span>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:'clamp(8px,1vw,16px)', flexWrap:'wrap' }}>
            {hasSalesData && (
              <>
                <div className="mi-ph-action-item"><div className="mi-ph-action-dot" style={{ background:'var(--accent)' }}/><span className="mi-ph-action-val" style={{ color:'var(--accent)' }}>{stats.totalDays}</span><span>days</span></div>
                <div className="mi-ph-action-item"><div className="mi-ph-action-dot" style={{ background:'var(--color-green)' }}/><span className="mi-ph-action-val" style={{ color:'var(--color-green)' }}>{formatCurrency(stats.totalRevenue)}</span><span>total rev</span></div>
                <div className="mi-ph-action-item"><div className="mi-ph-action-dot" style={{ background:'var(--color-amber)' }}/><span className="mi-ph-action-val" style={{ color:'var(--color-amber)' }}>{formatCurrency(stats.avgDailyRevenue)}</span><span>avg daily</span></div>
                <div className="mi-ph-action-item"><div className="mi-ph-action-dot" style={{ background:'var(--color-red)' }}/><span className="mi-ph-action-val" style={{ color:'var(--color-red)' }}>{slowMovers.length}</span><span>slow movers</span></div>
                {salesMeta.lastSync && (
                  <div style={{ display:'flex', alignItems:'center', gap:4, fontSize:'clamp(8px,.62vw,10px)', color:'var(--color-green)', background:'rgba(42,138,90,.08)', border:'1px solid rgba(42,138,90,.15)', borderRadius:12, padding:'2px 7px', flexShrink:0 }}>
                    <div style={{ width:4, height:4, borderRadius:'50%', background:'var(--color-green)', animation:'blink 2s infinite', flexShrink:0 }}/>
                    {typeof salesMeta.lastSync === 'string' ? salesMeta.lastSync.slice(0,10) : salesMeta.lastSync}
                  </div>
                )}
              </>
            )}
            {uploadStep==='done' && uploadSuccessMsg && (
              <div style={{ fontSize:'clamp(9px,.68vw,11px)', color:'var(--color-green)', background:'rgba(42,138,90,.1)', border:'1px solid rgba(42,138,90,.2)', borderRadius:6, padding:'2px 8px', display:'flex', alignItems:'center', gap:6 }}>
                ✓ {uploadSuccessMsg}
                <button className="an-btn-g" style={{ fontSize:'clamp(8px,.62vw,10px)', padding:'1px 6px', marginLeft:2 }} onClick={() => { setUploadStep('idle'); setUploadSuccessMsg(''); }}>×</button>
              </div>
            )}
            <div style={{ width:1, height:14, background:'var(--border)', flexShrink:0 }}/>
            <div className="an-range-toggle">{DATE_RANGES.map(r => <button key={r} className={`an-range-btn${dateRange===r?' active':''}`} onClick={() => setDateRange(r)}>{r}</button>)}</div>
            {hasSalesData && (
              <button style={{ background:'none', border:'1px solid var(--border)', borderRadius:5, padding:'3px 8px', fontSize:'clamp(9px,.65vw,11px)', color:'var(--text-muted)', cursor:'pointer', fontFamily:"'Inter',sans-serif", whiteSpace:'nowrap', transition:'all .15s' }} onClick={() => setShowUploadManager(true)} onMouseEnter={e => { e.currentTarget.style.color='var(--text-primary)'; e.currentTarget.style.borderColor='var(--text-faint)'; }} onMouseLeave={e => { e.currentTarget.style.color='var(--text-muted)'; e.currentTarget.style.borderColor='var(--border)'; }}>↑ Uploads</button>
            )}
            <button style={{ background:'var(--accent)', border:'none', borderRadius:5, padding:'3px 10px', fontSize:'clamp(9px,.65vw,11px)', fontWeight:600, color:'var(--bg-root)', cursor:'pointer', fontFamily:"'Inter',sans-serif", whiteSpace:'nowrap', transition:'background .2s' }} onClick={() => fileInputRef.current?.click()} onMouseEnter={e => e.currentTarget.style.background='#01bcd4'} onMouseLeave={e => e.currentTarget.style.background='var(--accent)'}>
              <input ref={fileInputRef} type="file" accept=".csv" style={{ display:'none' }} onChange={e => handleFileSelect(e.target.files)}/>
              ↑ Upload CSV
            </button>
          </div>
        </div>

        {loading ? (
          <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:10 }}>
            <div style={{ width:24, height:24, border:'2px solid var(--border)', borderTopColor:'var(--accent)', borderRadius:'50%', animation:'spin .7s linear infinite' }}/>
            <div style={{ fontSize:'clamp(11px,.85vw,14px)', color:'var(--text-muted)' }}>Loading analytics...</div>
          </div>
        ) : (
          <div style={{ flex:1, minHeight:0, position:'relative', display:'flex', flexDirection:'column' }}>
            {uploadStep === 'mapping' && !duplicateInfo && (
              <div style={{ position:'absolute', inset:0, zIndex:10, background:'rgba(10,9,8,.92)', display:'flex', alignItems:'center', justifyContent:'center', padding:'clamp(12px,1.2vw,20px)' }}>
                <div className="an-mapper" style={{ flex:'none', width:'min(720px,90%)', maxHeight:'90%', overflowY:'auto' }}>
                  <div className="an-mapper-title">Map your columns</div>
                  <div className="an-mapper-sub">{csvRows.length} rows detected{detectedPOS?` · Looks like a ${detectedPOS.charAt(0).toUpperCase()+detectedPOS.slice(1)} export`:''}</div>
                  <div className="an-mapper-grid">
                    {MAPPER_FIELDS.map(({f,req}) => (
                      <div key={f}>
                        <div className={`an-mapper-lbl${req?' req':''}`}>{f.replace(/_/g,' ')}</div>
                        <select className="an-mapper-select" value={columnMapping[f]||''} onChange={e => setColumnMapping(prev => ({...prev,[f]:e.target.value||null}))}>
                          <option value="">— not in CSV —</option>
                          {csvHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                  {uploadMsg && <div style={{ fontSize:'clamp(10px,.75vw,13px)', color:'var(--color-red)', marginBottom:10 }}>{uploadMsg}</div>}
                  <div style={{ display:'flex', gap:10 }}>
                    <button className="an-btn-p" onClick={handleUploadConfirm}>Import {csvRows.length} rows</button>
                    <button className="an-btn-g" onClick={() => { setUploadStep('idle'); setUploadMsg(''); }}>Cancel</button>
                  </div>
                </div>
              </div>
            )}

            {uploadStep === 'uploading' && (
              <div style={{ position:'absolute', inset:0, zIndex:10, background:'rgba(10,9,8,.92)', display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:12 }}>
                <div style={{ width:28, height:28, border:'2px solid var(--border)', borderTopColor:'var(--accent)', borderRadius:'50%', animation:'spin .7s linear infinite' }}/>
                <div style={{ fontSize:'clamp(12px,.95vw,16px)', color:'var(--text-primary)', fontWeight:600 }}>Importing sales data...</div>
                <div style={{ fontSize:'clamp(10px,.75vw,13px)', color:'var(--text-muted)' }}>{uploadProgress}%</div>
                <div style={{ width:280, background:'var(--text-inset)', borderRadius:4, height:4 }}><div style={{ height:4, borderRadius:4, background:'var(--accent)', width:`${uploadProgress}%`, transition:'width .3s' }}/></div>
              </div>
            )}

            {duplicateInfo && (
              <DuplicateModal
                incoming={duplicateInfo.incoming}
                existing={duplicateInfo.existing}
                onProceed={async () => { setDuplicateInfo(null); setUploadStep('uploading'); await executeUpload(pendingUploadRef.current); }}
                onCancel={() => { setDuplicateInfo(null); setUploadStep('idle'); pendingUploadRef.current = null; }}
              />
            )}

            {/* ── FIX 2: Side padding applied via .an-body CSS class ── */}
            <div className="an-body">
              <div className="an-trend-card">
                <div className="an-card" style={{ flex:1 }}>
                  <div className="an-card-hd">
                    <div className="an-card-title">
                      <svg viewBox="0 0 24 24"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
                      Daily Revenue <span style={{ fontSize:'clamp(8px,.6vw,10px)', color:'var(--text-muted)', fontWeight:400, marginLeft:4 }}>last {dateRange === 'All' ? 'all' : dateRange}</span>
                    </div>
                    <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                      {trendData.length>1 && (()=>{ const first=trendData[0]?.rev||0, last=trendData[trendData.length-1]?.rev||0, pct=first>0?((last-first)/first*100).toFixed(1):0; return <span className={parseFloat(pct)>=0?'an-trend-up':'an-trend-dn'}>{parseFloat(pct)>=0?'↑':'↓'}{Math.abs(pct)}%</span>; })()}
                      <div className="an-toggle">
                        <button className={`an-toggle-btn${trendView==='rev'?' active':''}`} onClick={() => setTrendView('rev')}>Rev</button>
                        <button className={`an-toggle-btn${trendView==='qty'?' active':''}`} onClick={() => setTrendView('qty')}>Qty</button>
                      </div>
                    </div>
                  </div>
                  {hasSalesData ? <TrendLine data={trendData} color="var(--accent)" valueKey={trendView}/> : <div className="an-empty">Upload POS data to see revenue trends</div>}
                </div>
              </div>

              <div className="an-r1-col4">
                <div className="an-card" style={{ flex:1 }}>
                  <div className="an-card-hd">
                    <div className="an-card-title"><svg viewBox="0 0 24 24"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>Top Sellers</div>
                    <div className="an-toggle">
                      <button className={`an-toggle-btn${dayView==='qty'?' active':''}`} onClick={() => setDayView('qty')}>Qty</button>
                      <button className={`an-toggle-btn${dayView==='rev'?' active':''}`} onClick={() => setDayView('rev')}>Rev</button>
                    </div>
                  </div>
                  <div className="an-scrollable">
                    {hasSalesData && topSellers.length > 0 ? topSellers.map(item => (
                      <div key={item.name} className="an-bar-row">
                        <div className="an-bar-label">{item.name}</div>
                        <div className="an-bar-track"><div className="an-bar-fill" style={{ width:`${dayView==='qty'?(item.qty/maxTopQty)*100:(item.rev/maxTopRev)*100}%`, background:'var(--accent)' }}/></div>
                        <div className="an-bar-val" style={{ color:'var(--accent)' }}>{dayView==='qty'?Math.round(item.qty):formatCurrency(item.rev)}</div>
                      </div>
                    )) : <div className="an-empty">No data yet</div>}
                  </div>
                </div>
                <div className="an-card" style={{ flex:1 }}>
                  <div className="an-card-hd">
                    <div className="an-card-title"><svg viewBox="0 0 24 24"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/></svg>Slow Movers</div>
                    {/* ── FIX 4: Updated badge label ── */}
                    <div className="an-badge" style={{ background:'rgba(192,64,64,.1)', color:'var(--color-red)' }}>vs prior 7d</div>
                  </div>
                  {!hasSalesData ? <div className="an-empty">No data yet</div> : slowMovers.length===0 ? <div className="an-empty">All items on pace</div> : (
                    <div className="an-scrollable">
                      {/* ── FIX 4: New columns — Prev 7d / This 7d / Drop ── */}
                      <table className="an-table">
                        <thead>
                          <tr>
                            <th className="an-th">Item</th>
                            <th className="an-th r">Prev 7d</th>
                            <th className="an-th r">This 7d</th>
                            <th className="an-th r">Drop</th>
                          </tr>
                        </thead>
                        <tbody>
                          {slowMovers.map(item => (
                            <tr key={item.name} className="an-tr">
                              <td className="an-td p">{item.name}</td>
                              <td className="an-td r">{Math.round(item.prevQty)}</td>
                              <td className="an-td r d">{Math.round(item.recentQty)}</td>
                              <td className="an-td r d">-{item.dropPct}%</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>

              <div className="an-day-col">
                <div className="an-card" style={{ flex:1 }}>
                  <div className="an-card-hd">
                    <div className="an-card-title"><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>By Day</div>
                    <div className="an-toggle">
                      <button className={`an-toggle-btn${dayView==='qty'?' active':''}`} onClick={() => setDayView('qty')}>Qty</button>
                      <button className={`an-toggle-btn${dayView==='rev'?' active':''}`} onClick={() => setDayView('rev')}>Rev</button>
                    </div>
                  </div>
                  {hasSalesData && dayOfWeekData.some(d => d.qty>0)
                    ? <ByDayCards dayOfWeekData={dayOfWeekData} allSales={allSales} dateRange={dateRange} dayView={dayView} />
                    : <div className="an-empty">No data yet</div>}
                </div>
              </div>

              <div className="an-cat-col">
                <div className="an-card" style={{ flex:1 }}>
                  <div className="an-card-hd">
                    <div className="an-card-title"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 2v10l4 2"/></svg>By Category</div>
                  </div>
                  {hasSalesData ? <CategoryBars data={categoryData}/> : <div className="an-empty">No category data</div>}
                </div>
              </div>

              <div className="an-time-col">
                <div className="an-card" style={{ flex:1 }}>
                  <div className="an-card-hd">
                    <div className="an-card-title"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>By Time</div>
                    <div style={{ fontSize:'clamp(8px,.6vw,10px)', color:'var(--text-muted)' }}>click to expand</div>
                  </div>
                  {hasSalesData && hourlyData.length > 0 ? <ByTimeCard hourlyData={hourlyData} maxHourQty={maxHourQty}/> : <div className="an-empty">No data yet</div>}
                </div>
                <div className="an-card" style={{ flex:1 }}>
                  <div className="an-card-hd">
                    <div className="an-card-title"><svg viewBox="0 0 24 24"><polyline points="17 11 12 6 7 11"/><polyline points="17 18 12 13 7 18"/></svg>Week vs Week</div>
                  </div>
                  <div className="an-scrollable">
                    {!hasSalesData ? <div className="an-empty">No data yet</div> : <>
                      {weekOverWeek.improvers.slice(0,3).map(item => (
                        <div key={item.name} className="an-bar-row">
                          <div className="an-bar-label">{item.name}</div>
                          <div className="an-bar-track"><div className="an-bar-fill" style={{ width:`${Math.min(100,item.change)}%`, background:'var(--color-green)' }}/></div>
                          <div className="an-bar-val an-trend-up">+{item.change.toFixed(0)}%</div>
                        </div>
                      ))}
                      {weekOverWeek.decliners.slice(0,3).map(item => (
                        <div key={item.name} className="an-bar-row">
                          <div className="an-bar-label">{item.name}</div>
                          <div className="an-bar-track"><div className="an-bar-fill" style={{ width:`${Math.min(100,Math.abs(item.change))}%`, background:'var(--color-red)' }}/></div>
                          <div className="an-bar-val an-trend-dn">{item.change.toFixed(0)}%</div>
                        </div>
                      ))}
                      {weekOverWeek.improvers.length===0 && weekOverWeek.decliners.length===0 && <div className="an-empty">Not enough weekly data</div>}
                    </>}
                  </div>
                </div>
              </div>

              <div className="an-wow-col">
                <div className="an-card" style={{ flex:1 }}>
                  <div className="an-card-hd">
                    <div className="an-card-title"><svg viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>Inv. Risk</div>
                    <div className="an-badge" style={{ background:'rgba(192,64,64,.1)', color:'var(--color-red)' }}>slow + recent</div>
                  </div>
                  {!hasSalesData ? <div className="an-empty">No data yet</div> : inventoryRisk.length===0 ? <div className="an-empty">No at-risk items</div> : (
                    <div className="an-scrollable">
                      <table className="an-table"><thead><tr><th className="an-th">Ingredient</th><th className="an-th r">Risk</th></tr></thead>
                      <tbody>{inventoryRisk.map((r,i) => <tr key={i} className="an-tr"><td className="an-td p" style={{ fontSize:'clamp(8px,.62vw,10px)' }}>{r.ingredient}<div style={{ fontSize:'clamp(7px,.55vw,8px)', color:'var(--text-muted)' }}>{r.linkedDish}</div></td><td className="an-td r"><span className={r.riskLevel==='high'?'an-risk-h':'an-risk-m'}>{r.riskLevel==='high'?'High':'Med'}</span></td></tr>)}</tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {showUploadManager && restaurantId && (
          <UploadManagerModal restaurantId={restaurantId} onClose={() => setShowUploadManager(false)} onDeleted={async () => { await loadSalesData(restaurantId); if (allSales.length === 0) setHasSalesData(false); }} />
        )}
      </div>
      {tourProps && <TourOverlay {...tourProps} />}
      <TourDataBanner />
    </>
  );
}