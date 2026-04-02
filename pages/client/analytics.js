// pages/client/analytics.js
import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import supabase from '../../lib/supabaseClient';
import { useWindowSize } from '../../lib/useWindowSize';
import { parseCSV, detectPOSSystem, buildColumnMapping, normalizeRows } from '../../lib/parsePOScsv';
import ProfileDropdown from '../../components/ProfileDropdown';
import { useTour } from '../../lib/useTour';

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
function getUrgencyColor(u) { return u === 'high' ? '#c04040' : u === 'medium' ? '#d4a020' : '#02a4ba'; }
function getTypeLabel(t) { return t === 'inventory' ? 'Move Stock' : t === 'margin' ? 'High Margin' : 'Trending'; }
function getMarginColor(m) {
  if (!m) return '#4a453e';
  if (m >= 60) return '#2a8a5a'; if (m >= 40) return '#02a4ba'; if (m >= 25) return '#d4a020'; return '#c04040';
}
const DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const DATE_RANGES = ['7d','14d','30d','All'];
const CAT_COLORS = ['#02a4ba','#d4a020','#2a8a5a','#c04040','#9b7ee8','#e85e8a','#4a9ede'];
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
  if (path==='/client/dashboard') return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>;
  if (path==='/client/invoices') return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>;
  if (path==='/client/ingredients') return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 8h1a4 4 0 010 8h-1"/><path d="M3 8h14v9a4 4 0 01-4 4H7a4 4 0 01-4-4V8z"/></svg>;
  if (path==='/client/menu-items') return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>;
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>;
}

function TrendLine({ data, valueKey = 'rev', color = '#02a4ba' }) {
  const [tip, setTip] = useState(null);
  const pts = data.filter(d => d[valueKey] > 0);
  if (pts.length < 2) return <div style={{textAlign:'center',padding:'20px 0',fontSize:12,color:'#4a453e'}}>Not enough data points</div>;
  const W=800,H=120,PL=10,PR=10,PT=10,PB=24;
  const xs = pts.map((_,i)=>PL+(i/(pts.length-1))*(W-PL-PR));
  const vals = pts.map(d=>d[valueKey]);
  const mn=Math.min(...vals),mx=Math.max(...vals),rng=mx-mn||1;
  const ys = vals.map(v=>PT+((mx-v)/rng)*(H-PT-PB));
  const pth = xs.map((x,i)=>`${i===0?'M':'L'}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' ');
  const area = `${pth} L${xs[xs.length-1].toFixed(1)},${(H-PB).toFixed(1)} L${xs[0].toFixed(1)},${(H-PB).toFixed(1)} Z`;
  return (
    <div style={{position:'relative',flex:1,minHeight:100}}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{width:'100%',height:'100%',overflow:'visible'}} preserveAspectRatio="none">
        <defs><linearGradient id="tgrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity="0.18"/><stop offset="100%" stopColor={color} stopOpacity="0"/></linearGradient></defs>
        <path d={area} fill="url(#tgrad)"/>
        <path d={pth} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        {xs.map((x,i)=>(
          <circle key={i} cx={x} cy={ys[i]} r="3" fill={color} style={{cursor:'pointer'}}
            onMouseEnter={e=>setTip({x:e.clientX,y:e.clientY,d:pts[i]})} onMouseLeave={()=>setTip(null)}/>
        ))}
        {xs.map((x,i)=>{
          if(i%Math.max(1,Math.floor(pts.length/6))!==0&&i!==pts.length-1)return null;
          return <text key={i} x={x} y={H-4} textAnchor="middle" fontSize="10" fill="#4a453e">{pts[i].date?.slice(5)}</text>;
        })}
      </svg>
      {tip&&<div style={{position:'fixed',left:tip.x+10,top:tip.y-40,background:'#1a1915',border:'1px solid #2a2620',borderRadius:6,padding:'6px 10px',fontSize:11,color:'#e8e2d8',pointerEvents:'none',whiteSpace:'nowrap',zIndex:999}}>
        <div style={{fontWeight:600,color}}>{valueKey==='rev'?formatCurrency(tip.d[valueKey]):Math.round(tip.d[valueKey])}</div>
        <div style={{color:'#4a453e',fontSize:10}}>{tip.d.date}</div>
      </div>}
    </div>
  );
}

function DonutChart({ data }) {
  const total = data.reduce((s,d)=>s+d.value,0);
  if(!total) return <div style={{textAlign:'center',padding:'16px 0',fontSize:12,color:'#4a453e'}}>No category data</div>;
  const circ=2*Math.PI*40; let off=circ*0.25;
  const slices=data.map((d,i)=>{ const pct=d.value/total,dash=pct*circ; const s={...d,pct,dash,off,color:CAT_COLORS[i%CAT_COLORS.length]}; off+=dash; return s; });
  return (
    <div style={{display:'flex',alignItems:'center',gap:'clamp(14px,1.4vw,24px)'}}>
      <div style={{position:'relative',width:'clamp(80px,8vw,120px)',height:'clamp(80px,8vw,120px)',flexShrink:0}}>
        <svg viewBox="0 0 100 100" style={{width:'100%',height:'100%'}}>
          <circle cx="50" cy="50" r="40" fill="none" stroke="#1a1915" strokeWidth="12"/>
          {slices.map((s,i)=><circle key={i} cx="50" cy="50" r="40" fill="none" stroke={s.color} strokeWidth="12" strokeDasharray={`${s.dash} ${circ}`} strokeDashoffset={-s.off+circ*0.25}/>)}
        </svg>
        <div style={{position:'absolute',inset:0,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center'}}>
          <div style={{fontFamily:"'Playfair Display',serif",fontSize:'clamp(12px,1.1vw,17px)',color:'#e8e2d8',lineHeight:1}}>{formatCurrency(total)}</div>
          <div style={{fontSize:'clamp(7px,.58vw,9px)',color:'#4a453e',marginTop:2}}>total</div>
        </div>
      </div>
      <div style={{display:'flex',flexDirection:'column',gap:'clamp(5px,.5vh,9px)',flex:1}}>
        {slices.slice(0,6).map((s,i)=>(
          <div key={i} style={{display:'flex',alignItems:'center',gap:8}}>
            <div style={{width:'clamp(7px,.6vw,10px)',height:'clamp(7px,.6vw,10px)',borderRadius:'50%',background:s.color,flexShrink:0}}/>
            <div style={{fontSize:'clamp(10px,.75vw,13px)',color:'#9a9086',flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{s.name}</div>
            <div style={{fontSize:'clamp(10px,.75vw,13px)',fontWeight:600,color:'#e8e2d8'}}>{formatCurrency(s.value)}</div>
            <div style={{fontSize:'clamp(9px,.68vw,11px)',color:'#4a453e',minWidth:36,textAlign:'right'}}>{(s.pct*100).toFixed(0)}%</div>
          </div>
        ))}
      </div>
    </div>
  );
}


const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400&family=Inter:wght@400;500;600&display=swap');
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
  html,body{height:100%;background:#0a0908;overflow:hidden;}
  #__next{height:100%;}
  @keyframes spin{to{transform:rotate(360deg);}}
  @keyframes blink{0%,100%{opacity:1}50%{opacity:.3}}
  input::placeholder,textarea::placeholder{color:#3a3630!important;}
  ::-webkit-scrollbar{width:3px;}::-webkit-scrollbar-track{background:#0f0e0c;}::-webkit-scrollbar-thumb{background:#2a2620;border-radius:2px;}
  .an-root{font-family:'Inter',sans-serif;background:#0a0908;color:#e8e2d8;width:100%;height:100vh;display:flex;flex-direction:column;overflow:hidden;}
  .an-nav{background:#0f0e0c;border-bottom:1px solid #2a2620;height:clamp(36px,4vh,52px);padding:0 clamp(10px,1vw,20px);display:flex;align-items:center;justify-content:space-between;flex-shrink:0;}
  .an-logo{font-family:'Playfair Display',serif;font-size:clamp(13px,1.1vw,18px);color:#e8e2d8;letter-spacing:-.3px;}
  .an-logo span{color:#02a4ba;}
  .an-tab{padding:clamp(2px,.3vh,4px) clamp(6px,.6vw,11px);border-radius:4px;font-size:clamp(10px,.75vw,13px);color:#4a453e;border:none;background:none;cursor:pointer;font-family:'Inter',sans-serif;transition:all .15s;}
  .an-tab.active{color:#e8e2d8;background:#1a1915;}
  .an-ph{background:#13120f;border-bottom:1px solid #2a2620;padding:clamp(6px,.6vh,10px) clamp(10px,1vw,20px);display:flex;align-items:center;justify-content:space-between;flex-shrink:0;gap:10px;flex-wrap:wrap;}
  .an-ph-title{font-family:'Playfair Display',serif;font-size:clamp(14px,1.2vw,20px);color:#e8e2d8;}
  .an-ph-sub{font-size:clamp(9px,.65vw,11px);color:#4a453e;}
  .an-range-toggle{display:flex;background:#0f0e0c;border:1px solid #2a2620;border-radius:6px;padding:2px;gap:2px;}
  .an-range-btn{padding:clamp(3px,.3vh,5px) clamp(8px,.7vw,14px);border-radius:4px;font-size:clamp(10px,.75vw,12px);font-weight:500;cursor:pointer;border:none;font-family:'Inter',sans-serif;color:#4a453e;background:transparent;transition:all .15s;}
  .an-range-btn.active{background:#1a1915;color:#e8e2d8;}
  .an-sbar{background:#13120f;border-bottom:1px solid #2a2620;padding:clamp(5px,.5vh,8px) clamp(10px,1vw,20px);display:flex;gap:clamp(14px,1.8vw,32px);align-items:center;flex-shrink:0;overflow-x:auto;}
  .an-sbar::-webkit-scrollbar{display:none;}
  .an-sv{font-family:'Playfair Display',serif;font-size:clamp(13px,1.1vw,18px);line-height:1;}
  .an-sl{font-size:clamp(8px,.6vw,10px);color:#4a453e;margin-top:2px;text-transform:uppercase;letter-spacing:.5px;white-space:nowrap;}
  .an-sync-badge{display:flex;align-items:center;gap:5px;font-size:clamp(9px,.68vw,11px);color:#2a8a5a;background:rgba(42,138,90,.1);border:1px solid rgba(42,138,90,.2);border-radius:20px;padding:3px 10px;margin-left:auto;white-space:nowrap;flex-shrink:0;}
  .an-sync-dot{width:6px;height:6px;border-radius:50%;background:#2a8a5a;animation:blink 2s infinite;}
  .an-pos-badge{font-size:clamp(8px,.62vw,10px);color:#4a453e;background:#0f0e0c;border:1px solid #2a2620;border-radius:20px;padding:3px 10px;white-space:nowrap;flex-shrink:0;}
  .an-body{flex:1;overflow-y:auto;padding:clamp(8px,.8vw,14px);display:flex;flex-direction:column;gap:clamp(8px,.8vw,14px);}
  .an-body::-webkit-scrollbar{width:3px;}
  .an-upload-zone{background:#13120f;border:2px dashed #2a2620;border-radius:10px;padding:clamp(24px,3vh,48px);text-align:center;cursor:pointer;transition:border-color .2s;}
  .an-upload-zone:hover,.an-upload-zone.drag{border-color:#02a4ba;}
  .an-upload-btn{background:#02a4ba;border:none;border-radius:7px;padding:clamp(8px,.8vw,12px) clamp(16px,1.4vw,24px);font-size:clamp(11px,.85vw,14px);font-weight:600;color:#0a0908;cursor:pointer;font-family:'Inter',sans-serif;}
  .an-pos-pills{display:flex;gap:8px;justify-content:center;margin-top:14px;flex-wrap:wrap;}
  .an-pos-pill{font-size:clamp(9px,.68vw,11px);padding:3px 10px;border-radius:10px;border:1px solid #2a2620;color:#4a453e;cursor:pointer;transition:all .15s;background:none;font-family:'Inter',sans-serif;}
  .an-pos-pill.active{border-color:#02a4ba;color:#02a4ba;background:rgba(2,164,186,.08);}
  .an-mapper{background:#13120f;border:1px solid #2a2620;border-radius:10px;padding:clamp(14px,1.4vw,22px);}
  .an-mapper-title{font-size:clamp(12px,.95vw,16px);font-weight:600;color:#e8e2d8;margin-bottom:4px;}
  .an-mapper-sub{font-size:clamp(10px,.75vw,13px);color:#4a453e;margin-bottom:14px;}
  .an-mapper-grid{display:grid;grid-template-columns:1fr 1fr;gap:clamp(8px,.8vw,12px);margin-bottom:14px;}
  .an-mapper-lbl{font-size:clamp(9px,.68vw,11px);color:#6b6358;text-transform:uppercase;letter-spacing:.5px;font-weight:600;margin-bottom:5px;}
  .an-mapper-lbl.req::after{content:' *';color:#c04040;}
  .an-mapper-select{background:#0f0e0c;border:1px solid #2a2620;border-radius:6px;padding:clamp(6px,.6vw,10px) clamp(8px,.75vw,12px);font-size:clamp(11px,.85vw,14px);color:#e8e2d8;outline:none;font-family:'Inter',sans-serif;width:100%;cursor:pointer;}
  .an-mapper-select:focus{border-color:#02a4ba;}
  .an-g2{display:grid;grid-template-columns:1fr 1fr;gap:clamp(8px,.8vw,14px);}
  .an-card{background:#13120f;border:1px solid #2a2620;border-radius:10px;padding:clamp(12px,1.1vw,18px);display:flex;flex-direction:column;}
  .an-card-hd{display:flex;align-items:center;justify-content:space-between;margin-bottom:clamp(10px,1vh,16px);flex-shrink:0;gap:8px;flex-wrap:wrap;}
  .an-card-title{font-size:clamp(10px,.78vw,14px);font-weight:600;color:#e8e2d8;display:flex;align-items:center;gap:6px;}
  .an-card-title svg{width:clamp(11px,.88vw,15px);height:clamp(11px,.88vw,15px);stroke:#02a4ba;fill:none;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;}
  .an-badge{font-size:clamp(8px,.62vw,10px);font-weight:600;padding:2px 8px;border-radius:10px;white-space:nowrap;}
  .an-toggle{display:flex;background:#0f0e0c;border-radius:5px;padding:2px;gap:2px;}
  .an-toggle-btn{padding:clamp(2px,.22vh,4px) clamp(7px,.6vw,12px);border-radius:4px;font-size:clamp(9px,.65vw,11px);cursor:pointer;border:none;font-family:'Inter',sans-serif;color:#4a453e;background:transparent;transition:all .15s;}
  .an-toggle-btn.active{background:#1a1915;color:#e8e2d8;}
  .an-dish-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:clamp(8px,.8vw,14px);}
  .an-dish-card{background:#13120f;border:1px solid #2a2620;border-radius:10px;padding:clamp(14px,1.2vw,20px);display:flex;flex-direction:column;gap:clamp(8px,.8vh,12px);position:relative;overflow:hidden;}
  .an-dish-num{font-family:'Playfair Display',serif;font-size:clamp(28px,2.8vw,44px);color:#1a1915;line-height:1;position:absolute;top:10px;right:14px;}
  .an-dish-name{font-family:'Playfair Display',serif;font-size:clamp(15px,1.3vw,21px);color:#e8e2d8;line-height:1.2;padding-right:32px;}
  .an-dish-reason{font-size:clamp(10px,.75vw,13px);color:#6b6358;line-height:1.5;}
  .an-dish-talking{background:#0f0e0c;border-left:2px solid #2a2620;border-radius:0 6px 6px 0;padding:clamp(7px,.7vw,11px) clamp(10px,.9vw,14px);font-size:clamp(9px,.68vw,12px);color:#9a9086;line-height:1.5;font-style:italic;}
  .an-dish-talking-lbl{font-size:clamp(7px,.58vw,9px);font-weight:600;color:#4a453e;text-transform:uppercase;letter-spacing:.6px;margin-bottom:4px;font-style:normal;}
  .an-dish-meta{display:flex;gap:clamp(10px,1vw,18px);padding-top:clamp(8px,.8vh,12px);border-top:1px solid #2a2620;align-items:flex-end;flex-wrap:wrap;}
  .an-dish-meta-lbl{font-size:clamp(8px,.6vw,10px);color:#4a453e;text-transform:uppercase;letter-spacing:.5px;}
  .an-dish-meta-val{font-size:clamp(11px,.88vw,15px);font-weight:600;margin-top:2px;}
  .an-conf-bar{height:3px;border-radius:2px;background:#1a1915;flex:1;overflow:hidden;margin:4px 0;}
  .an-conf-fill{height:100%;border-radius:2px;}
  .an-bar-row{display:flex;align-items:center;gap:clamp(6px,.55vw,10px);margin-bottom:clamp(6px,.6vh,10px);}
  .an-bar-row:last-child{margin-bottom:0;}
  .an-bar-label{font-size:clamp(9px,.68vw,12px);color:#9a9086;width:clamp(80px,8vw,130px);flex-shrink:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .an-bar-track{flex:1;background:#1a1915;border-radius:3px;height:clamp(4px,.4vh,7px);}
  .an-bar-fill{height:100%;border-radius:3px;transition:width .4s ease;}
  .an-bar-val{font-size:clamp(9px,.68vw,12px);font-weight:600;width:clamp(44px,4vw,72px);text-align:right;flex-shrink:0;}
  .an-heatmap-cell{border-radius:4px;display:flex;align-items:center;justify-content:center;position:relative;}
  .an-heatmap-cell:hover .an-heatmap-tip{display:block;}
  .an-heatmap-tip{display:none;position:absolute;bottom:calc(100% + 6px);left:50%;transform:translateX(-50%);background:#1a1915;border:1px solid #2a2620;border-radius:5px;padding:4px 8px;font-size:clamp(8px,.62vw,10px);color:#e8e2d8;white-space:nowrap;z-index:20;pointer-events:none;}
  .an-table{width:100%;border-collapse:collapse;}
  .an-th{font-size:clamp(8px,.62vw,10px);font-weight:600;color:#4a453e;text-transform:uppercase;letter-spacing:.7px;padding:clamp(5px,.5vh,8px) clamp(8px,.7vw,12px);border-bottom:1px solid #2a2620;text-align:left;white-space:nowrap;}
  .an-th.r{text-align:right;}
  .an-td{font-size:clamp(10px,.75vw,13px);color:#9a9086;padding:clamp(7px,.7vh,11px) clamp(8px,.7vw,12px);border-bottom:1px solid #1a1915;}
  .an-td.p{color:#e8e2d8;font-weight:500;}
  .an-td.a{color:#02a4ba;font-weight:600;}
  .an-td.r{text-align:right;}
  .an-td.w{color:#d4a020;}
  .an-td.d{color:#c04040;}
  .an-td.s{color:#2a8a5a;}
  .an-tr:hover td{background:rgba(26,25,21,.5);}
  .an-risk-h{background:rgba(192,64,64,.1);color:#c04040;border:1px solid rgba(192,64,64,.2);font-size:clamp(8px,.62vw,10px);padding:2px 7px;border-radius:8px;white-space:nowrap;}
  .an-risk-m{background:rgba(212,160,32,.1);color:#d4a020;border:1px solid rgba(212,160,32,.2);font-size:clamp(8px,.62vw,10px);padding:2px 7px;border-radius:8px;white-space:nowrap;}
  .an-trend-up{color:#2a8a5a;font-size:clamp(9px,.68vw,11px);font-weight:600;}
  .an-trend-dn{color:#c04040;font-size:clamp(9px,.68vw,11px);font-weight:600;}
  .an-btn-p{background:#02a4ba;border:none;border-radius:7px;padding:clamp(6px,.6vw,10px) clamp(12px,1.1vw,18px);font-size:clamp(11px,.85vw,13px);font-weight:600;color:#0a0908;cursor:pointer;font-family:'Inter',sans-serif;transition:background .2s;white-space:nowrap;}
  .an-btn-p:hover{background:#01bcd4;}
  .an-btn-g{background:none;border:1px solid #2a2620;border-radius:7px;padding:clamp(6px,.6vw,10px) clamp(12px,1.1vw,18px);font-size:clamp(11px,.85vw,13px);color:#4a453e;cursor:pointer;font-family:'Inter',sans-serif;transition:all .15s;white-space:nowrap;}
  .an-btn-g:hover{color:#e8e2d8;border-color:#3a3630;}
  .an-btn-d{background:none;border:1px solid rgba(192,64,64,.25);border-radius:7px;padding:clamp(6px,.6vw,10px) clamp(12px,1.1vw,18px);font-size:clamp(11px,.85vw,13px);color:#c04040;cursor:pointer;font-family:'Inter',sans-serif;transition:all .15s;white-space:nowrap;}
  .an-btn-d:hover{background:rgba(192,64,64,.08);}
  .an-empty{display:flex;align-items:center;justify-content:center;flex:1;font-size:clamp(10px,.78vw,14px);color:#4a453e;padding:clamp(16px,2vh,32px) 0;text-align:center;}
  .an-note-input{width:100%;background:#0f0e0c;border:1px solid #2a2620;border-radius:6px;padding:7px 10px;font-size:clamp(11px,.85vw,13px);color:#e8e2d8;outline:none;font-family:'Inter',sans-serif;resize:none;transition:border-color .15s;}
  .an-note-input:focus{border-color:#02a4ba;}
  .mob-root{font-family:'Inter',sans-serif;background:#0a0908;color:#e8e2d8;width:100%;height:100dvh;display:flex;flex-direction:column;overflow:hidden;}
  .mob-header{background:#0f0e0c;border-bottom:1px solid #2a2620;padding:10px 16px;padding-top:env(safe-area-inset-top,10px);display:flex;align-items:center;justify-content:space-between;flex-shrink:0;}
  .mob-logo{font-family:'Playfair Display',serif;font-size:20px;color:#e8e2d8;letter-spacing:-.3px;}
  .mob-logo span{color:#02a4ba;}
  .mob-titlebar{background:#13120f;border-bottom:1px solid #2a2620;padding:10px 16px;flex-shrink:0;display:flex;align-items:center;justify-content:space-between;}
  .mob-content{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:12px;-webkit-overflow-scrolling:touch;}
  .mob-content::-webkit-scrollbar{display:none;}
  .mob-card{background:#13120f;border:1px solid #2a2620;border-radius:10px;padding:14px;flex-shrink:0;}
  .mob-card-title{font-size:11px;font-weight:600;color:#e8e2d8;text-transform:uppercase;letter-spacing:.7px;margin-bottom:12px;display:flex;align-items:center;gap:6px;}
  .mob-stab{flex:1;padding:8px 0;font-size:10px;font-weight:500;color:#4a453e;background:none;border:none;border-bottom:2px solid transparent;cursor:pointer;font-family:'Inter',sans-serif;transition:all .15s;}
  .mob-stab.active{color:#02a4ba;border-bottom-color:#02a4ba;}
  .mob-bar-row{display:flex;align-items:center;gap:8px;margin-bottom:8px;}
  .mob-bar-row:last-child{margin-bottom:0;}
  .mob-bar-label{font-size:12px;color:#9a9086;width:110px;flex-shrink:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .mob-bar-track{flex:1;background:#1a1915;border-radius:3px;height:5px;}
  .mob-bar-fill{height:5px;border-radius:3px;}
  .mob-bar-val{font-size:12px;font-weight:600;width:56px;text-align:right;flex-shrink:0;}
  .mob-bottom-nav{background:#0f0e0c;border-top:1px solid #2a2620;padding:8px 0;padding-bottom:max(8px,env(safe-area-inset-bottom));display:flex;flex-shrink:0;}
  .mob-nav-item{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;cursor:pointer;padding:4px 0;-webkit-tap-highlight-color:transparent;}
  .mob-nav-icon svg{width:18px;height:18px;stroke:#4a453e;fill:none;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;}
  .mob-nav-icon.active svg{stroke:#02a4ba;}
  .mob-nav-label{font-size:9px;color:#4a453e;}
  .mob-nav-label.active{color:#02a4ba;}
  .mob-nav-dot{width:4px;height:4px;border-radius:50%;background:#02a4ba;}
`;


export default function AnalyticsPage() {
  const router = useRouter();
  const { isMobile } = useWindowSize();
  const fileInputRef = useRef(null);

  const [restaurantId, setRestaurantId] = useState(null);
  const [userName, setUserName] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const [dragOver, setDragOver] = useState(false);
  const [selectedPOS, setSelectedPOS] = useState('other');
  const [detectedPOS, setDetectedPOS] = useState(null);
  const [uploadStep, setUploadStep] = useState('idle');
  const [csvRows, setCsvRows] = useState([]);
  const [csvHeaders, setCsvHeaders] = useState([]);
  const [columnMapping, setColumnMapping] = useState({});
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadMsg, setUploadMsg] = useState('');
  const [dateRange, setDateRange] = useState('14d');
  const [dayView, setDayView] = useState('qty');
  const [allSales, setAllSales] = useState([]);
  const [hasSalesData, setHasSalesData] = useState(false);
  const [salesMeta, setSalesMeta] = useState({ lastSync: null, posSystem: null });
  const [topSellers, setTopSellers] = useState([]);
  const [slowMovers, setSlowMovers] = useState([]);
  const [dayOfWeekData, setDayOfWeekData] = useState([]);
  const [hourlyData, setHourlyData] = useState([]);
  const [openHours, setOpenHours] = useState([]);
  const [inventoryRisk, setInventoryRisk] = useState([]);
  const [categoryData, setCategoryData] = useState([]);
  const [trendData, setTrendData] = useState([]);
  const [weekOverWeek, setWeekOverWeek] = useState({ improvers: [], decliners: [] });
  const [voidsComps, setVoidsComps] = useState([]);
  const [stats, setStats] = useState({ totalDays: 0, totalRevenue: 0, avgDailyRevenue: 0 });
  const [dishRecs, setDishRecs] = useState([]);
  const [dishLoading, setDishLoading] = useState(false);
  const [notes, setNotes] = useState({});
  const [noteDate, setNoteDate] = useState('');
  const [noteText, setNoteText] = useState('');
  const [mobileSection, setMobileSection] = useState('recs');

  useEffect(() => { init(); }, []);
  useEffect(() => { if (allSales.length) computeAnalytics(allSales); }, [allSales, dateRange]);

  const { TourComponent } = useTour('analytics', restaurantId);

  async function init() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push('/client/login'); return; }
    setUserEmail(user.email || '');
    const { data: profile } = await supabase.from('profiles').select('restaurant_id, full_name').eq('id', user.id).single();
    if (!profile?.restaurant_id) { setLoading(false); return; }
    setRestaurantId(profile.restaurant_id);
    setUserName(profile.full_name ? profile.full_name.split(' ')[0] : 'User');
    await loadSalesData(profile.restaurant_id);
    setLoading(false);
  }

  async function loadSalesData(restId) {
    const { data: sales } = await supabase.from('pos_sales').select('*').eq('restaurant_id', restId).order('sale_date', { ascending: false });
    if (!sales?.length) { setHasSalesData(false); return; }
    setHasSalesData(true);
    setAllSales(sales);
    setSalesMeta({ lastSync: sales[0]?.sale_date || null, posSystem: sales[0]?.pos_system || null });
  }

  function getFilteredSales(sales) {
    if (dateRange === 'All') return sales;
    const days = dateRange === '7d' ? 7 : dateRange === '14d' ? 14 : 30;
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().split('T')[0];
    return sales.filter(s => s.sale_date >= cutoffStr);
  }

  async function computeAnalytics(sales) {
    const filtered = getFilteredSales(sales);
    if (!filtered.length) return;
    const dates = [...new Set(filtered.map(s => s.sale_date))];
    const totalRevenue = filtered.reduce((t,s) => t + parseFloat(s.revenue||0), 0);
    setStats({ totalDays: dates.length, totalRevenue, avgDailyRevenue: dates.length > 0 ? totalRevenue/dates.length : 0 });
    const itemMap = {};
    for (const s of filtered) {
      if (!itemMap[s.item_name]) itemMap[s.item_name] = { name:s.item_name, qty:0, rev:0, category:s.category };
      itemMap[s.item_name].qty += parseFloat(s.quantity_sold||0);
      itemMap[s.item_name].rev += parseFloat(s.revenue||0);
    }
    const items = Object.values(itemMap).sort((a,b) => b.qty-a.qty);
    setTopSellers(items.slice(0,10));
    const sevenAgo = new Date(); sevenAgo.setDate(sevenAgo.getDate()-7);
    const sevenAgoStr = sevenAgo.toISOString().split('T')[0];
    const recentMap = {};
    for (const s of filtered.filter(s => s.sale_date >= sevenAgoStr))
      recentMap[s.item_name] = (recentMap[s.item_name]||0) + parseFloat(s.quantity_sold||0);
    setSlowMovers(items.filter(i => (recentMap[i.name]||0)<3).slice(0,8).map(i=>({...i, recentQty:recentMap[i.name]||0})));
    const vcMap = {};
    for (const s of filtered) {
      if (!vcMap[s.item_name]) vcMap[s.item_name]={name:s.item_name,voids:0,comps:0};
      vcMap[s.item_name].voids += parseInt(s.voids||0);
      vcMap[s.item_name].comps += parseFloat(s.comps||0);
    }
    setVoidsComps(Object.values(vcMap).filter(i=>i.voids>0||i.comps>0).sort((a,b)=>b.voids-a.voids).slice(0,8));
    const dayMap = {};
    for (const d of DAYS) dayMap[d]={day:d,qty:0,rev:0};
    for (const s of filtered) { if (s.day_of_week&&dayMap[s.day_of_week]) { dayMap[s.day_of_week].qty+=parseFloat(s.quantity_sold||0); dayMap[s.day_of_week].rev+=parseFloat(s.revenue||0); } }
    setDayOfWeekData(DAYS.map(d=>dayMap[d]));
    const hourMap = {};
    for (const s of filtered) { if (s.hour_of_day!==null&&s.hour_of_day!==undefined) { const h=parseInt(s.hour_of_day); hourMap[h]=(hourMap[h]||0)+parseFloat(s.quantity_sold||0); } }
    const hoursWithData = Object.keys(hourMap).map(Number).filter(h=>hourMap[h]>0).sort((a,b)=>a-b);
    const minH=hoursWithData[0]??0, maxH=hoursWithData[hoursWithData.length-1]??23;
    const openHrs=Array.from({length:maxH-minH+1},(_,i)=>minH+i);
    setOpenHours(openHrs);
    setHourlyData(openHrs.map(h=>({hour:h,qty:hourMap[h]||0})));
    const catMap = {};
    for (const s of filtered) { const cat=s.category||'Uncategorized'; catMap[cat]=(catMap[cat]||0)+parseFloat(s.revenue||0); }
    setCategoryData(Object.entries(catMap).sort((a,b)=>b[1]-a[1]).map(([name,value])=>({name,value})));
    const dailyMap = {};
    for (const s of filtered) { if (!dailyMap[s.sale_date]) dailyMap[s.sale_date]={date:s.sale_date,rev:0,qty:0}; dailyMap[s.sale_date].rev+=parseFloat(s.revenue||0); dailyMap[s.sale_date].qty+=parseFloat(s.quantity_sold||0); }
    setTrendData(Object.values(dailyMap).sort((a,b)=>a.date.localeCompare(b.date)));
    const thisWk = new Date(); thisWk.setDate(thisWk.getDate()-7);
    const lastWk = new Date(); lastWk.setDate(lastWk.getDate()-14);
    const thisWkStr=thisWk.toISOString().split('T')[0], lastWkStr=lastWk.toISOString().split('T')[0];
    const twMap={},lwMap={};
    for (const s of sales) {
      if (s.sale_date>=thisWkStr) twMap[s.item_name]=(twMap[s.item_name]||0)+parseFloat(s.quantity_sold||0);
      else if (s.sale_date>=lastWkStr) lwMap[s.item_name]=(lwMap[s.item_name]||0)+parseFloat(s.quantity_sold||0);
    }
    const wowItems=Object.keys({...twMap,...lwMap}).map(name=>{ const tw=twMap[name]||0,lw=lwMap[name]||0,change=lw>0?((tw-lw)/lw)*100:tw>0?100:0; return {name,tw,lw,change}; });
    setWeekOverWeek({ improvers:wowItems.filter(i=>i.change>0&&i.tw>0).sort((a,b)=>b.change-a.change).slice(0,5), decliners:wowItems.filter(i=>i.change<0&&i.lw>0).sort((a,b)=>a.change-b.change).slice(0,5) });
    if (restaurantId) {
      const { data: ings } = await supabase.from('ingredients').select('name,last_ordered_at,unit').eq('restaurant_id', restaurantId).not('last_ordered_at','is',null);
      const risk=(ings||[]).filter(ing=>ing.last_ordered_at>=sevenAgoStr).map(ing=>{
        const ingL=ing.name.toLowerCase();
        const slow=items.find(i=>(recentMap[i.name]||0)<3&&(i.name.toLowerCase().includes(ingL.split(' ')[0])||ingL.includes(i.name.toLowerCase().split(' ')[0])));
        if (!slow) return null;
        return {ingredient:ing.name,unit:ing.unit,lastOrdered:ing.last_ordered_at,riskLevel:(recentMap[slow.name]||0)===0?'high':'medium',linkedDish:slow.name};
      }).filter(Boolean).sort((a,b)=>a.riskLevel==='high'?-1:1);
      setInventoryRisk(risk.slice(0,10));
    }
  }

  async function fetchDishRecs(restId) {
    setDishLoading(true);
    try {
      const res = await fetch('/api/dish-recommendations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({restaurantId:restId})});
      const json = await res.json();
      setDishRecs(json.recommendations||[]);
    } catch(e){console.error(e);}
    setDishLoading(false);
  }

  function handlePrint() {
    const today=new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'});
    const w=window.open('','_blank');
    w.document.write(`<html><head><title>Dish Picks ${today}</title><style>body{font-family:Georgia,serif;padding:32px;}.cards{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-top:20px;}.card{border:1px solid #ddd;border-radius:8px;padding:16px;}.num{font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;}.dish{font-size:18px;font-weight:bold;margin-bottom:8px;}.reason{font-size:13px;color:#555;margin-bottom:10px;line-height:1.5;}.talking{font-size:12px;color:#777;font-style:italic;border-top:1px solid #eee;padding-top:8px;line-height:1.5;}</style></head><body><h2>Today's Dish Picks — ${today}</h2><p style="color:#888;font-size:13px;">Generated by OptiMenu</p><div class="cards">${dishRecs.map((r,i)=>`<div class="card"><div class="num">#${i+1} Push Today</div><div class="dish">${r.dish}</div><div class="reason">${r.reason}</div>${r.talking_point?`<div class="talking">"${r.talking_point}"</div>`:''}</div>`).join('')}</div></body></html>`);
    w.document.close(); w.print();
  }

  function handleShare() {
    const today=new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'});
    const text=`OptiMenu Dish Picks — ${today}\n\n${dishRecs.map((r,i)=>`#${i+1} ${r.dish}\n${r.reason}${r.talking_point?`\n"${r.talking_point}"`:''}`).join('\n\n')}`;
    navigator.clipboard.writeText(text).catch(()=>{});
  }

  function handleFileSelect(files) {
    const file=files[0]; if (!file) return;
    const reader=new FileReader();
    reader.onload=(e)=>{
      try {
        const rows=parseCSV(e.target.result);
        const headers=Object.keys(rows[0]||{});
        const det=detectPOSSystem(headers);
        const mapping=buildColumnMapping(headers,selectedPOS!=='other'?selectedPOS:det);
        setCsvRows(rows); setCsvHeaders(headers); setColumnMapping(mapping);
        if (det!=='other'){setSelectedPOS(det);setDetectedPOS(det);}
        setUploadStep('mapping'); setUploadMsg('');
      } catch(err){setUploadMsg('Failed to parse CSV: '+err.message);}
    };
    reader.readAsText(file);
  }

  async function handleUploadConfirm() {
    if (!restaurantId) return;
    setUploadStep('uploading'); setUploadProgress(0);
    try {
      const normalized=normalizeRows(csvRows,columnMapping,restaurantId,selectedPOS);
      if (!normalized.length) throw new Error('No valid rows found. Check your column selections.');
      const dates=[...new Set(normalized.map(r=>r.sale_date))];
      await supabase.from('pos_sales').delete().eq('restaurant_id',restaurantId).gte('sale_date',dates.sort()[0]).lte('sale_date',[...dates].sort().pop());
      const CHUNK=500;
      for (let i=0;i<normalized.length;i+=CHUNK) {
        const {error}=await supabase.from('pos_sales').insert(normalized.slice(i,i+CHUNK));
        if (error) throw error;
        setUploadProgress(Math.min(99,Math.round(((i+CHUNK)/normalized.length)*100)));
      }
      setUploadProgress(100);
      setUploadMsg(`Successfully imported ${normalized.length} records across ${dates.length} days.`);
      setUploadStep('done'); setHasSalesData(true);
      await loadSalesData(restaurantId);
    } catch(err){setUploadMsg('Upload failed: '+err.message);setUploadStep('mapping');}
  }

  async function handleClearData() {
    if (!restaurantId||!confirm('Delete all uploaded sales data? This cannot be undone.')) return;
    await supabase.from('pos_sales').delete().eq('restaurant_id',restaurantId);
    setAllSales([]); setHasSalesData(false); setUploadStep('idle'); setUploadMsg('');
    setTopSellers([]); setSlowMovers([]); setDayOfWeekData([]); setHourlyData([]);
    setCategoryData([]); setTrendData([]); setInventoryRisk([]); setVoidsComps([]);
    setDishRecs([]); setStats({totalDays:0,totalRevenue:0,avgDailyRevenue:0});
  }

  const maxTopQty=topSellers[0]?.qty||1;
  const maxTopRev=Math.max(...topSellers.map(i=>i.rev),1);
  const maxDayQty=Math.max(...dayOfWeekData.map(d=>d.qty),1);
  const maxDayRev=Math.max(...dayOfWeekData.map(d=>d.rev),1);
  const maxHourQty=Math.max(...hourlyData.map(h=>h.qty),1);

  const MAPPER_FIELDS=[{f:'item_name',req:true},{f:'sale_date',req:true},{f:'quantity_sold',req:true},{f:'revenue',req:true},{f:'category',req:false},{f:'unit_price',req:false},{f:'hour_of_day',req:false},{f:'voids',req:false},{f:'comps',req:false}];

  function renderDishCards() {
    if (!hasSalesData) return <div className="an-empty">Upload POS data to generate dish recommendations</div>;
    if (dishLoading) return <div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:10,padding:'clamp(20px,3vh,40px)',color:'#4a453e',fontSize:'clamp(11px,.85vw,14px)'}}><div style={{width:18,height:18,border:'2px solid #2a2620',borderTopColor:'#02a4ba',borderRadius:'50%',animation:'spin .7s linear infinite'}}/>Analyzing sales data and inventory...</div>;
    if (!dishRecs.length) return <div className="an-empty">No recommendations yet — <button className="an-btn-g" style={{padding:'4px 10px',fontSize:12,marginLeft:6}} onClick={()=>fetchDishRecs(restaurantId)}>Generate now</button></div>;
    return (
      <div className="an-dish-cards">
        {dishRecs.map((rec,i)=>{
          const color=getUrgencyColor(rec.urgency);
          return (
            <div key={i} className="an-dish-card">
              <div style={{position:'absolute',top:0,left:0,right:0,height:3,background:color,borderRadius:'10px 10px 0 0'}}/>
              <div className="an-dish-num">#{i+1}</div>
              <div style={{display:'inline-flex',alignItems:'center',gap:5,fontSize:'clamp(9px,.68vw,11px)',fontWeight:600,padding:'3px 10px',borderRadius:10,alignSelf:'flex-start',textTransform:'uppercase',letterSpacing:'.5px',background:`${color}18`,color}}>{getTypeLabel(rec.type)}</div>
              <div className="an-dish-name">{rec.dish}</div>
              <div className="an-dish-reason">{rec.reason}</div>
              {rec.talking_point&&<div className="an-dish-talking"><div className="an-dish-talking-lbl">Suggest to guests</div>"{rec.talking_point}"</div>}
              <div className="an-dish-meta">
                {rec.margin&&<div><div className="an-dish-meta-lbl">Margin</div><div className="an-dish-meta-val" style={{color:getMarginColor(rec.margin)}}>{rec.margin.toFixed(1)}%</div></div>}
                {rec.confidence&&<div style={{flex:1}}><div className="an-dish-meta-lbl">Confidence</div><div className="an-conf-bar"><div className="an-conf-fill" style={{width:`${rec.confidence}%`,background:color}}/></div><div style={{fontSize:'clamp(9px,.68vw,11px)',color,fontWeight:600}}>{rec.confidence}%</div></div>}
                <div><div className="an-dish-meta-lbl">Urgency</div><div className="an-dish-meta-val" style={{color,fontSize:'clamp(11px,.85vw,13px)'}}>{rec.urgency.charAt(0).toUpperCase()+rec.urgency.slice(1)}</div></div>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  if (isMobile) {
    return (
      <>
        <style>{CSS}</style>
        <div className="mob-root">
          <div className="mob-header">
            <div className="mob-logo">Opti<span>Menu</span></div>
            <ProfileDropdown userName={userName} userEmail={userEmail} isMobile={true}/>
          </div>
          <div className="mob-titlebar">
            <div><div style={{fontFamily:"'Playfair Display',serif",fontSize:20,color:'#e8e2d8'}}>Analytics</div><div style={{fontSize:11,color:'#4a453e',marginTop:3}}>POS Sales Intelligence</div></div>
            <div className="an-range-toggle">{DATE_RANGES.map(r=><button key={r} className={`an-range-btn${dateRange===r?' active':''}`} onClick={()=>setDateRange(r)}>{r}</button>)}</div>
          </div>
          <div style={{background:'#13120f',borderBottom:'1px solid #2a2620',display:'flex',flexShrink:0}}>
            {[{id:'recs',label:'Dish Picks'},{id:'sales',label:'Sales'},{id:'risk',label:'Risk'},{id:'upload',label:'Upload'}].map(t=>(
              <button key={t.id} className={`mob-stab${mobileSection===t.id?' active':''}`} onClick={()=>setMobileSection(t.id)}>{t.label}</button>
            ))}
          </div>
          <div className="mob-content">
            {loading?<div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:10}}><div style={{width:22,height:22,border:'2px solid #2a2620',borderTopColor:'#02a4ba',borderRadius:'50%',animation:'spin .7s linear infinite'}}/><div style={{fontSize:12,color:'#4a453e'}}>Loading...</div></div>:(
              <>
                {mobileSection==='recs'&&(
                  <div className="mob-card">
                    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12}}>
                      <div className="mob-card-title" style={{marginBottom:0}}>Today's Dish Picks</div>
                      {dishRecs.length>0&&<button style={{fontSize:11,color:'#02a4ba',background:'none',border:'1px solid #2a2620',borderRadius:5,padding:'4px 8px',cursor:'pointer',fontFamily:"'Inter',sans-serif"}} onClick={handleShare}>⎘ Copy</button>}
                    </div>
                    {dishLoading?<div style={{display:'flex',alignItems:'center',gap:8,color:'#4a453e',fontSize:12}}><div style={{width:16,height:16,border:'2px solid #2a2620',borderTopColor:'#02a4ba',borderRadius:'50%',animation:'spin .7s linear infinite'}}/>Analyzing...</div>
                    :!hasSalesData?<div style={{fontSize:12,color:'#4a453e',textAlign:'center',padding:'16px 0'}}>Upload POS data to get dish picks</div>
                    :dishRecs.length>0?dishRecs.map((rec,i)=>{
                      const color=getUrgencyColor(rec.urgency);
                      return (
                        <div key={i} style={{background:'#0f0e0c',borderRadius:8,borderLeft:`3px solid ${color}`,padding:12,marginBottom:10}}>
                          <div style={{fontSize:10,fontWeight:600,color:'#4a453e',marginBottom:4,textTransform:'uppercase',letterSpacing:'.5px'}}>#{i+1} Push Today · {getTypeLabel(rec.type)}</div>
                          <div style={{fontFamily:"'Playfair Display',serif",fontSize:16,color:'#e8e2d8',marginBottom:5}}>{rec.dish}</div>
                          <div style={{fontSize:12,color:'#6b6358',lineHeight:1.45,marginBottom:8}}>{rec.reason}</div>
                          {rec.talking_point&&<div style={{fontSize:11,color:'#4a453e',fontStyle:'italic',borderTop:'1px solid #1a1915',paddingTop:8,marginBottom:8,lineHeight:1.4}}>"{rec.talking_point}"</div>}
                          <div style={{display:'flex',gap:12}}>
                            {rec.margin&&<div><div style={{fontSize:9,color:'#4a453e',textTransform:'uppercase',letterSpacing:'.5px'}}>Margin</div><div style={{fontSize:13,fontWeight:600,color:getMarginColor(rec.margin)}}>{rec.margin.toFixed(1)}%</div></div>}
                            {rec.confidence&&<div><div style={{fontSize:9,color:'#4a453e',textTransform:'uppercase',letterSpacing:'.5px'}}>Confidence</div><div style={{fontSize:13,fontWeight:600,color}}>{rec.confidence}%</div></div>}
                          </div>
                        </div>
                      );
                    }):<div style={{fontSize:12,color:'#4a453e',textAlign:'center',padding:'16px 0'}}>No recommendations yet</div>}
                  </div>
                )}
                {mobileSection==='sales'&&(
                  <>
                    {!hasSalesData?<div style={{fontSize:13,color:'#4a453e',textAlign:'center',padding:32}}>Upload POS data to see analytics</div>:(
                      <>
                        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
                          {[{l:'Days',v:stats.totalDays,c:'#02a4ba'},{l:'Revenue',v:formatCurrency(stats.totalRevenue),c:'#2a8a5a'},{l:'Avg/Day',v:formatCurrency(stats.avgDailyRevenue),c:'#d4a020'},{l:'Top Seller',v:topSellers[0]?.name?.split(' ').slice(0,2).join(' ')||'—',c:'#e8e2d8'}].map(({l,v,c})=>(
                            <div key={l} style={{background:'#13120f',border:'1px solid #2a2620',borderRadius:8,padding:12}}>
                              <div style={{fontSize:9,color:'#4a453e',textTransform:'uppercase',letterSpacing:'.5px',marginBottom:4}}>{l}</div>
                              <div style={{fontFamily:"'Playfair Display',serif",fontSize:18,color:c,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{v}</div>
                            </div>
                          ))}
                        </div>
                        <div className="mob-card">
                          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12}}>
                            <div className="mob-card-title" style={{marginBottom:0}}>Top Sellers</div>
                            <div className="an-toggle"><button className={`an-toggle-btn${dayView==='qty'?' active':''}`} onClick={()=>setDayView('qty')}>Qty</button><button className={`an-toggle-btn${dayView==='rev'?' active':''}`} onClick={()=>setDayView('rev')}>$</button></div>
                          </div>
                          {topSellers.slice(0,8).map(item=>(
                            <div key={item.name} className="mob-bar-row">
                              <div className="mob-bar-label">{item.name}</div>
                              <div className="mob-bar-track"><div className="mob-bar-fill" style={{width:`${dayView==='qty'?(item.qty/maxTopQty)*100:(item.rev/maxTopRev)*100}%`,background:'#02a4ba'}}/></div>
                              <div className="mob-bar-val" style={{color:'#02a4ba'}}>{dayView==='qty'?Math.round(item.qty):formatCurrency(item.rev)}</div>
                            </div>
                          ))}
                        </div>
                        <div className="mob-card">
                          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12}}>
                            <div className="mob-card-title" style={{marginBottom:0}}>Sales by Day</div>
                            <div className="an-toggle"><button className={`an-toggle-btn${dayView==='qty'?' active':''}`} onClick={()=>setDayView('qty')}>Qty</button><button className={`an-toggle-btn${dayView==='rev'?' active':''}`} onClick={()=>setDayView('rev')}>$</button></div>
                          </div>
                          {dayOfWeekData.map(d=>(
                            <div key={d.day} className="mob-bar-row">
                              <div className="mob-bar-label">{d.day.slice(0,3)}</div>
                              <div className="mob-bar-track"><div className="mob-bar-fill" style={{width:`${dayView==='qty'?(d.qty/maxDayQty)*100:(d.rev/maxDayRev)*100}%`,background:'#d4a020'}}/></div>
                              <div className="mob-bar-val" style={{color:'#d4a020'}}>{dayView==='qty'?Math.round(d.qty):formatCurrency(d.rev)}</div>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </>
                )}
                {mobileSection==='risk'&&(
                  <div className="mob-card">
                    <div className="mob-card-title">Inventory Risk</div>
                    {!hasSalesData?<div style={{fontSize:12,color:'#4a453e',textAlign:'center',padding:'16px 0'}}>Upload POS data first</div>
                    :inventoryRisk.length===0?<div style={{fontSize:12,color:'#4a453e',textAlign:'center',padding:'16px 0'}}>No at-risk ingredients identified</div>
                    :inventoryRisk.map((r,i)=>(
                      <div key={i} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 0',borderBottom:'1px solid #1a1915'}}>
                        <div><div style={{fontSize:13,fontWeight:500,color:'#e8e2d8'}}>{r.ingredient}</div>{r.linkedDish&&<div style={{fontSize:10,color:'#4a453e',marginTop:2}}>Used in: {r.linkedDish}</div>}</div>
                        <span className={r.riskLevel==='high'?'an-risk-h':'an-risk-m'}>{r.riskLevel==='high'?'High':'Med'} Risk</span>
                      </div>
                    ))}
                  </div>
                )}
                {mobileSection==='upload'&&(
                  <div className="mob-card">
                    <div className="mob-card-title">Upload POS Data</div>
                    {uploadStep==='idle'&&(
                      <>
                        <div style={{border:'2px dashed #2a2620',borderRadius:10,padding:'28px 16px',textAlign:'center',marginBottom:12}} onClick={()=>fileInputRef.current?.click()}>
                          <input ref={fileInputRef} type="file" accept=".csv" style={{display:'none'}} onChange={e=>handleFileSelect(e.target.files)}/>
                          <div style={{fontSize:14,fontWeight:600,color:'#e8e2d8',marginBottom:6}}>Upload Sales CSV</div>
                          <div style={{fontSize:12,color:'#4a453e',marginBottom:14}}>Export from your POS and upload here</div>
                          <button style={{background:'#02a4ba',border:'none',borderRadius:7,padding:'10px 20px',fontSize:13,fontWeight:600,color:'#0a0908',cursor:'pointer',fontFamily:"'Inter',sans-serif"}}>Choose File</button>
                        </div>
                        {hasSalesData&&<button className="an-btn-d" style={{width:'100%'}} onClick={handleClearData}>Clear All Sales Data</button>}
                      </>
                    )}
                    {uploadStep==='uploading'&&<div style={{textAlign:'center',padding:'24px 0',color:'#4a453e',fontSize:13}}>Uploading... {uploadProgress}%</div>}
                    {uploadStep==='done'&&<div style={{textAlign:'center',padding:'16px 0'}}><div style={{fontSize:13,color:'#2a8a5a',marginBottom:12}}>{uploadMsg}</div><button style={{background:'#02a4ba',border:'none',borderRadius:7,padding:'10px 20px',fontSize:13,fontWeight:600,color:'#0a0908',cursor:'pointer',fontFamily:"'Inter',sans-serif"}} onClick={()=>setUploadStep('idle')}>Upload More</button></div>}
                    {uploadMsg&&uploadStep==='mapping'&&<div style={{fontSize:12,color:'#c04040',marginTop:8}}>{uploadMsg}</div>}
                  </div>
                )}
              </>
            )}
          </div>
          <div className="mob-bottom-nav">
            {NAV.map(({label,path})=>{ const active=path==='/client/analytics'; return (
              <div key={label} className="mob-nav-item" onClick={()=>router.push(path)}>
                <div className={`mob-nav-icon${active?' active':''}`}><NavIcon path={path}/></div>
                <div className={`mob-nav-label${active?' active':''}`}>{label}</div>
                {active&&<div className="mob-nav-dot"/>}
              </div>
            );})}
          </div>
        </div>
        <TourComponent />
      </>
    );
  }

  return (
    <>
      <style>{CSS}</style>
      <div className="an-root">
        <div className="an-nav">
          <div style={{display:'flex',alignItems:'center',gap:'clamp(8px,1vw,16px)'}}>
            <div className="an-logo">Opti<span>Menu</span></div>
            <div style={{display:'flex',gap:2}}>{TABS.map(t=><button key={t} className={`an-tab${t==='Analytics'?' active':''}`} onClick={()=>router.push(TAB_PATHS[t])}>{t}</button>)}</div>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:'clamp(6px,.7vw,12px)'}}>
            <div style={{display:'flex',alignItems:'center',gap:4,fontSize:'clamp(9px,.65vw,12px)',color:'#02a4ba'}}><div style={{width:'clamp(4px,.35vw,6px)',height:'clamp(4px,.35vw,6px)',background:'#02a4ba',borderRadius:'50%',animation:'blink 2s infinite'}}/>Active</div>
            <ProfileDropdown userName={userName} userEmail={userEmail} isMobile={false}/>
          </div>
        </div>

        <div className="an-ph">
          <div><div className="an-ph-title">Sales Analytics</div><div className="an-ph-sub">POS intelligence · inventory risk · daily dish recommendations</div></div>
          <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
            <div className="an-range-toggle">{DATE_RANGES.map(r=><button key={r} className={`an-range-btn${dateRange===r?' active':''}`} onClick={()=>setDateRange(r)}>{r}</button>)}</div>
            {hasSalesData&&<button className="an-btn-d" style={{padding:'clamp(5px,.5vw,8px) clamp(10px,.9vw,14px)',fontSize:'clamp(10px,.75vw,12px)'}} onClick={handleClearData}>✕ Clear Data</button>}
            <button className="an-btn-p" onClick={()=>fileInputRef.current?.click()}>
              <input ref={fileInputRef} type="file" accept=".csv" style={{display:'none'}} onChange={e=>handleFileSelect(e.target.files)}/>
              ↑ Upload CSV
            </button>
          </div>
        </div>

        {hasSalesData&&(
          <div className="an-sbar">
            {[{v:stats.totalDays,l:'Days of Data',c:'#02a4ba'},{v:topSellers.length,l:'Items Tracked',c:'#e8e2d8'},{v:formatCurrency(stats.totalRevenue),l:'Total Revenue',c:'#2a8a5a'},{v:formatCurrency(stats.avgDailyRevenue),l:'Avg Daily Revenue',c:'#d4a020'},{v:topSellers[0]?.name||'—',l:'Top Seller',c:'#e8e2d8'},{v:slowMovers.length,l:'Slow Movers',c:'#c04040'}].map(({v,l,c})=>(
              <div key={l} style={{flexShrink:0}}><div className="an-sv" style={{color:c,fontSize:l==='Top Seller'?'clamp(11px,.9vw,15px)':undefined}}>{v}</div><div className="an-sl">{l}</div></div>
            ))}
            {salesMeta.lastSync&&<div className="an-sync-badge"><div className="an-sync-dot"/>Last sync: {salesMeta.lastSync}</div>}
            {salesMeta.posSystem&&salesMeta.posSystem!=='other'&&<div className="an-pos-badge">POS: {salesMeta.posSystem.charAt(0).toUpperCase()+salesMeta.posSystem.slice(1)}</div>}
          </div>
        )}

        {loading?(
          <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:10}}>
            <div style={{width:24,height:24,border:'2px solid #2a2620',borderTopColor:'#02a4ba',borderRadius:'50%',animation:'spin .7s linear infinite'}}/>
            <div style={{fontSize:'clamp(11px,.85vw,14px)',color:'#4a453e'}}>Loading analytics...</div>
          </div>
        ):(
          <div className="an-body">
            {uploadStep==='idle'&&!hasSalesData&&(
              <div className="an-upload-zone" onDragOver={e=>{e.preventDefault();setDragOver(true);}} onDragLeave={()=>setDragOver(false)} onDrop={e=>{e.preventDefault();setDragOver(false);handleFileSelect(e.dataTransfer.files);}} onClick={()=>fileInputRef.current?.click()} style={{borderColor:dragOver?'#02a4ba':undefined}}>
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#2a2620" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" style={{marginBottom:12}}><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                <div style={{fontSize:'clamp(13px,1vw,16px)',fontWeight:600,color:'#e8e2d8',marginBottom:6}}>Upload your POS sales export</div>
                <div style={{fontSize:'clamp(10px,.75vw,13px)',color:'#4a453e',marginBottom:14}}>Drag & drop a CSV, or click to browse. Supports Toast, Square, Clover, Lightspeed, and any standard CSV.</div>
                <button className="an-upload-btn" onClick={e=>e.stopPropagation()}>Browse Files</button>
                <div className="an-pos-pills">{['toast','square','clover','lightspeed','other'].map(p=><button key={p} className={`an-pos-pill${selectedPOS===p?' active':''}`} onClick={e=>{e.stopPropagation();setSelectedPOS(p);}}>{p.charAt(0).toUpperCase()+p.slice(1)}</button>)}</div>
              </div>
            )}

            {uploadStep==='mapping'&&(
              <div className="an-mapper">
                <div className="an-mapper-title">Map your columns</div>
                <div className="an-mapper-sub">{csvRows.length} rows detected{detectedPOS?` · Looks like a ${detectedPOS.charAt(0).toUpperCase()+detectedPOS.slice(1)} export`:''}</div>
                <div className="an-mapper-grid">
                  {MAPPER_FIELDS.map(({f,req})=>(
                    <div key={f}>
                      <div className={`an-mapper-lbl${req?' req':''}`}>{f.replace(/_/g,' ')}</div>
                      <select className="an-mapper-select" value={columnMapping[f]||''} onChange={e=>setColumnMapping(prev=>({...prev,[f]:e.target.value||null}))}>
                        <option value="">— not in CSV —</option>
                        {csvHeaders.map(h=><option key={h} value={h}>{h}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
                {uploadMsg&&<div style={{fontSize:'clamp(10px,.75vw,13px)',color:'#c04040',marginBottom:10}}>{uploadMsg}</div>}
                <div style={{display:'flex',gap:10}}><button className="an-btn-p" onClick={handleUploadConfirm}>Import {csvRows.length} rows</button><button className="an-btn-g" onClick={()=>{setUploadStep('idle');setUploadMsg('');}}>Cancel</button></div>
              </div>
            )}

            {uploadStep==='uploading'&&(
              <div className="an-card" style={{alignItems:'center',padding:'32px 20px'}}>
                <div style={{width:28,height:28,border:'2px solid #2a2620',borderTopColor:'#02a4ba',borderRadius:'50%',animation:'spin .7s linear infinite',marginBottom:12}}/>
                <div style={{fontSize:'clamp(12px,.95vw,16px)',color:'#e8e2d8',fontWeight:600}}>Importing sales data...</div>
                <div style={{fontSize:'clamp(10px,.75vw,13px)',color:'#4a453e',marginTop:6}}>{uploadProgress}%</div>
                <div style={{width:'100%',maxWidth:320,background:'#1a1915',borderRadius:4,height:4,marginTop:14}}><div style={{height:4,borderRadius:4,background:'#02a4ba',width:`${uploadProgress}%`,transition:'width .3s'}}/></div>
              </div>
            )}

            {uploadStep==='done'&&(
              <div style={{background:'rgba(42,138,90,.08)',border:'1px solid rgba(42,138,90,.2)',borderRadius:10,padding:'clamp(12px,1.2vw,18px)',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                <div style={{fontSize:'clamp(12px,.95vw,15px)',color:'#2a8a5a',fontWeight:500}}>✓ {uploadMsg}</div>
                <button className="an-btn-g" onClick={()=>{setUploadStep('idle');setUploadMsg('');}}>Upload More</button>
              </div>
            )}

            <div className="an-card">
              <div className="an-card-hd">
                <div className="an-card-title"><svg viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>Today's Dish Recommendations</div>
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  {dishLoading&&<div style={{display:'flex',alignItems:'center',gap:6,fontSize:'clamp(9px,.68vw,11px)',color:'#4a453e'}}><div style={{width:10,height:10,border:'1.5px solid #2a2620',borderTopColor:'#02a4ba',borderRadius:'50%',animation:'spin .7s linear infinite'}}/>Analyzing...</div>}
                  {dishRecs.length>0&&<><button className="an-btn-g" style={{fontSize:'clamp(9px,.68vw,11px)',padding:'4px 10px'}} onClick={handleShare}>⎘ Copy for Team</button><button className="an-btn-g" style={{fontSize:'clamp(9px,.68vw,11px)',padding:'4px 10px'}} onClick={handlePrint}>⎙ Print</button></>}
                  <button className="an-btn-g" style={{fontSize:'clamp(9px,.68vw,11px)',padding:'4px 10px'}} onClick={()=>fetchDishRecs(restaurantId)}>↻ Refresh</button>
                </div>
              </div>
              {renderDishCards()}
            </div>

            {hasSalesData&&(
              <>
                <div className="an-card">
                  <div className="an-card-hd">
                    <div className="an-card-title"><svg viewBox="0 0 24 24"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>Daily Revenue Trend</div>
                    {trendData.length>1&&(()=>{ const first=trendData[0]?.rev||0,last=trendData[trendData.length-1]?.rev||0,pct=first>0?((last-first)/first*100).toFixed(1):0; return <span className={parseFloat(pct)>=0?'an-trend-up':'an-trend-dn'}>{parseFloat(pct)>=0?'↑':'↓'} {Math.abs(pct)}% vs start of period</span>; })()}
                  </div>
                  <TrendLine data={trendData} color="#02a4ba" valueKey="rev"/>
                </div>

                <div className="an-g2">
                  <div className="an-card">
                    <div className="an-card-hd">
                      <div className="an-card-title"><svg viewBox="0 0 24 24"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>Top Sellers</div>
                      <div className="an-toggle"><button className={`an-toggle-btn${dayView==='qty'?' active':''}`} onClick={()=>setDayView('qty')}>Qty</button><button className={`an-toggle-btn${dayView==='rev'?' active':''}`} onClick={()=>setDayView('rev')}>Revenue</button></div>
                    </div>
                    {topSellers.map(item=>(
                      <div key={item.name} className="an-bar-row">
                        <div className="an-bar-label">{item.name}</div>
                        <div className="an-bar-track"><div className="an-bar-fill" style={{width:`${dayView==='qty'?(item.qty/maxTopQty)*100:(item.rev/maxTopRev)*100}%`,background:'#02a4ba'}}/></div>
                        <div className="an-bar-val" style={{color:'#02a4ba'}}>{dayView==='qty'?Math.round(item.qty):formatCurrency(item.rev)}</div>
                      </div>
                    ))}
                  </div>
                  <div className="an-card">
                    <div className="an-card-hd">
                      <div className="an-card-title"><svg viewBox="0 0 24 24"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/></svg>Slow Movers</div>
                      <div className="an-badge" style={{background:'rgba(192,64,64,.1)',color:'#c04040'}}>&lt;3 sold this week</div>
                    </div>
                    {slowMovers.length===0?<div className="an-empty">All items selling well</div>:(
                      <table className="an-table"><thead><tr><th className="an-th">Item</th><th className="an-th r">14d Total</th><th className="an-th r">Last 7d</th></tr></thead>
                      <tbody>{slowMovers.map(item=><tr key={item.name} className="an-tr"><td className="an-td p">{item.name}</td><td className="an-td r">{Math.round(item.qty)}</td><td className="an-td r d">{Math.round(item.recentQty)}</td></tr>)}</tbody></table>
                    )}
                  </div>
                </div>

                <div className="an-g2">
                  <div className="an-card">
                    <div className="an-card-hd">
                      <div className="an-card-title"><svg viewBox="0 0 24 24"><polyline points="17 11 12 6 7 11"/><polyline points="17 18 12 13 7 18"/></svg>Most Improved This Week</div>
                      <div className="an-badge" style={{background:'rgba(42,138,90,.1)',color:'#2a8a5a'}}>vs last week</div>
                    </div>
                    {weekOverWeek.improvers.length===0?<div className="an-empty">Not enough weekly data</div>:weekOverWeek.improvers.map(item=>(
                      <div key={item.name} className="an-bar-row">
                        <div className="an-bar-label">{item.name}</div>
                        <div className="an-bar-track"><div className="an-bar-fill" style={{width:`${Math.min(100,item.change)}%`,background:'#2a8a5a'}}/></div>
                        <div className="an-bar-val an-trend-up">+{item.change.toFixed(0)}%</div>
                      </div>
                    ))}
                  </div>
                  <div className="an-card">
                    <div className="an-card-hd">
                      <div className="an-card-title"><svg viewBox="0 0 24 24"><polyline points="17 6 12 11 7 6"/><polyline points="17 13 12 18 7 13"/></svg>Biggest Decliners</div>
                      <div className="an-badge" style={{background:'rgba(192,64,64,.1)',color:'#c04040'}}>vs last week</div>
                    </div>
                    {weekOverWeek.decliners.length===0?<div className="an-empty">Not enough weekly data</div>:weekOverWeek.decliners.map(item=>(
                      <div key={item.name} className="an-bar-row">
                        <div className="an-bar-label">{item.name}</div>
                        <div className="an-bar-track"><div className="an-bar-fill" style={{width:`${Math.min(100,Math.abs(item.change))}%`,background:'#c04040'}}/></div>
                        <div className="an-bar-val an-trend-dn">{item.change.toFixed(0)}%</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="an-g2">
                  <div className="an-card">
                    <div className="an-card-hd">
                      <div className="an-card-title"><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>Sales by Day of Week</div>
                      <div className="an-toggle"><button className={`an-toggle-btn${dayView==='qty'?' active':''}`} onClick={()=>setDayView('qty')}>Qty</button><button className={`an-toggle-btn${dayView==='rev'?' active':''}`} onClick={()=>setDayView('rev')}>Revenue</button></div>
                    </div>
                    {dayOfWeekData.map(d=>(
                      <div key={d.day} className="an-bar-row">
                        <div className="an-bar-label">{d.day}</div>
                        <div className="an-bar-track"><div className="an-bar-fill" style={{width:`${dayView==='qty'?(d.qty/maxDayQty)*100:(d.rev/maxDayRev)*100}%`,background:'#d4a020'}}/></div>
                        <div className="an-bar-val" style={{color:'#d4a020'}}>{dayView==='qty'?Math.round(d.qty):formatCurrency(d.rev)}</div>
                      </div>
                    ))}
                  </div>
                  <div className="an-card">
                    <div className="an-card-hd">
                      <div className="an-card-title"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>Hourly Sales {openHours.length>0&&<span style={{fontSize:'clamp(9px,.65vw,10px)',color:'#4a453e',fontWeight:400}}>({formatHour(openHours[0])}–{formatHour(openHours[openHours.length-1])})</span>}</div>
                    </div>
                    <div style={{display:'flex',gap:5,flexWrap:'wrap'}}>
                      {hourlyData.map(h=>{ const intensity=maxHourQty>0?h.qty/maxHourQty:0; const bg=intensity>0.7?'#c04040':intensity>0.4?'#d4a020':intensity>0.1?'#02a4ba':'#1a1915'; return (
                        <div key={h.hour} className="an-heatmap-cell" style={{width:'clamp(28px,3vw,42px)',height:'clamp(28px,3vw,42px)',background:bg,opacity:intensity>0?0.3+intensity*0.7:0.25}}>
                          <span style={{fontSize:'clamp(7px,.58vw,9px)',color:intensity>0.5?'#0a0908':'#4a453e'}}>{formatHour(h.hour)}</span>
                          <div className="an-heatmap-tip">{formatHour(h.hour)} — {Math.round(h.qty)} items</div>
                        </div>
                      );})}
                    </div>
                    <div style={{display:'flex',gap:12,marginTop:10,flexWrap:'wrap'}}>
                      {[{c:'#c04040',l:'Peak'},{c:'#d4a020',l:'Busy'},{c:'#02a4ba',l:'Steady'},{c:'#1a1915',l:'Quiet'}].map(({c,l})=>(
                        <div key={l} style={{display:'flex',alignItems:'center',gap:4,fontSize:'clamp(8px,.62vw,10px)',color:'#4a453e'}}><div style={{width:8,height:8,borderRadius:2,background:c}}/>{l}</div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="an-g2">
                  <div className="an-card">
                    <div className="an-card-hd"><div className="an-card-title"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 12 l4 2"/></svg>Revenue by Category</div></div>
                    <DonutChart data={categoryData}/>
                  </div>
                  <div className="an-card">
                    <div className="an-card-hd">
                      <div className="an-card-title"><svg viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>Inventory Risk</div>
                      <div className="an-badge" style={{background:'rgba(192,64,64,.1)',color:'#c04040'}}>ordered recently · slow selling</div>
                    </div>
                    {inventoryRisk.length===0?<div className="an-empty">No at-risk ingredients</div>:(
                      <table className="an-table"><thead><tr><th className="an-th">Ingredient</th><th className="an-th">Used In</th><th className="an-th">Last Ordered</th><th className="an-th r">Risk</th></tr></thead>
                      <tbody>{inventoryRisk.map((r,i)=><tr key={i} className="an-tr"><td className="an-td p">{r.ingredient}</td><td className="an-td">{r.linkedDish||<span style={{color:'#4a453e'}}>—</span>}</td><td className="an-td">{r.lastOrdered}</td><td className="an-td r"><span className={r.riskLevel==='high'?'an-risk-h':'an-risk-m'}>{r.riskLevel==='high'?'High':'Med'}</span></td></tr>)}</tbody>
                      </table>
                    )}
                  </div>
                </div>

                <div className="an-g2">
                  <div className="an-card">
                    <div className="an-card-hd"><div className="an-card-title"><svg viewBox="0 0 24 24"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>Revenue by Item</div></div>
                    <table className="an-table"><thead><tr><th className="an-th">#</th><th className="an-th">Item</th><th className="an-th">Category</th><th className="an-th r">Qty</th><th className="an-th r">Revenue</th><th className="an-th r">Avg Price</th></tr></thead>
                    <tbody>{[...topSellers].sort((a,b)=>b.rev-a.rev).slice(0,12).map((item,i)=>(
                      <tr key={item.name} className="an-tr">
                        <td className="an-td" style={{color:'#4a453e'}}>{i+1}</td>
                        <td className="an-td p">{item.name}</td>
                        <td className="an-td">{item.category||<span style={{color:'#4a453e'}}>—</span>}</td>
                        <td className="an-td r">{Math.round(item.qty)}</td>
                        <td className="an-td r a">{formatCurrency(item.rev)}</td>
                        <td className="an-td r">{item.qty>0?formatCurrencyDetailed(item.rev/item.qty):'—'}</td>
                      </tr>
                    ))}</tbody></table>
                  </div>
                  <div className="an-card">
                    <div className="an-card-hd"><div className="an-card-title"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>Voids & Comps</div></div>
                    {voidsComps.length===0?<div className="an-empty">No void or comp data</div>:(
                      <table className="an-table"><thead><tr><th className="an-th">Item</th><th className="an-th r">Voids</th><th className="an-th r">Comps</th></tr></thead>
                      <tbody>{voidsComps.map(item=><tr key={item.name} className="an-tr"><td className="an-td p">{item.name}</td><td className="an-td r w">{item.voids}</td><td className="an-td r w">{formatCurrency(item.comps)}</td></tr>)}</tbody></table>
                    )}
                    <div style={{marginTop:16,borderTop:'1px solid #2a2620',paddingTop:14}}>
                      <div style={{fontSize:'clamp(9px,.68vw,11px)',fontWeight:600,color:'#4a453e',textTransform:'uppercase',letterSpacing:'.7px',marginBottom:8}}>Manager Notes</div>
                      <div style={{display:'flex',gap:6,marginBottom:8}}>
                        <input type="date" value={noteDate} onChange={e=>setNoteDate(e.target.value)} style={{background:'#0f0e0c',border:'1px solid #2a2620',borderRadius:6,padding:'5px 8px',fontSize:11,color:'#e8e2d8',outline:'none',fontFamily:"'Inter',sans-serif",flexShrink:0}}/>
                        <textarea rows={2} className="an-note-input" placeholder="Note for this date..." value={noteText} onChange={e=>setNoteText(e.target.value)}/>
                        <button className="an-btn-p" style={{fontSize:11,padding:'6px 12px',alignSelf:'flex-end'}} onClick={()=>{ if(noteDate&&noteText){setNotes(prev=>({...prev,[noteDate]:noteText}));setNoteText('');} }}>Save</button>
                      </div>
                      {Object.entries(notes).sort((a,b)=>b[0].localeCompare(a[0])).slice(0,4).map(([date,note])=>(
                        <div key={date} style={{padding:'7px 0',borderBottom:'1px solid #1a1915',display:'flex',gap:10}}>
                          <div style={{fontSize:11,color:'#4a453e',flexShrink:0}}>{date}</div>
                          <div style={{fontSize:12,color:'#9a9086'}}>{note}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
      <TourComponent />
    </>
  );
}