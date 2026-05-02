// pages/client/dashboard.js
import React, { useState, useEffect } from "react";
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

const SHELF_LIFE = {
  fish:2,salmon:2,tuna:2,halibut:2,cod:2,tilapia:2,mahi:2,shrimp:2,scallop:2,
  lobster:1,crab:2,oyster:3,clam:3,swordfish:2,bass:2,snapper:2,flounder:2,trout:2,
  "bluefin tuna":2,"seared toro":2,chicken:3,beef:4,pork:4,lamb:4,veal:3,duck:3,turkey:3,
  steak:4,"ground beef":3,"ground pork":3,bacon:7,sausage:4,"filet mignon":4,
  "new york strip":4,ribeye:4,"short rib":4,milk:7,cream:7,butter:14,cheese:14,
  "heavy cream":7,"sour cream":14,yogurt:14,mozzarella:7,parmesan:30,lettuce:7,
  spinach:5,arugula:5,kale:7,herbs:5,basil:5,parsley:7,cilantro:5,mint:7,chives:7,
  tomato:7,strawberry:5,raspberry:3,blueberry:7,mushroom:7,avocado:4,asparagus:5,
  corn:4,pea:5,carrot:21,onion:30,garlic:30,potato:21,apple:21,lemon:21,lime:14,
  orange:14,beet:21,celery:14,broccoli:7,cauliflower:7,zucchini:7,pepper:10,
  olive:60,oil:180,flour:180,sugar:365,salt:365,pasta:365,rice:365,vinegar:365,sauce:30,
};
function getShelfLife(name) {
  if (!name) return 14;
  const lower = name.toLowerCase();
  if (SHELF_LIFE[lower]) return SHELF_LIFE[lower];
  for (const [key, days] of Object.entries(SHELF_LIFE)) {
    if (lower.includes(key) || key.includes(lower.split(' ')[0])) return days;
  }
  return 14;
}

const fmt  = (n) => !n ? "$0"    : isNaN(parseFloat(n)) ? "$0"    : parseFloat(n).toLocaleString('en-US',{style:'currency',currency:'USD',minimumFractionDigits:0,maximumFractionDigits:0});
const fmtD = (n) => !n ? "$0.00" : isNaN(parseFloat(n)) ? "$0.00" : parseFloat(n).toLocaleString('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2});
function formatDate(d) { if (!d) return "N/A"; try { return new Date(d).toLocaleDateString('en-US',{month:'short',day:'numeric'}); } catch { return "N/A"; } }

function getMarginColor(m) {
  if (m >= 60) return "var(--color-green)";
  if (m >= 40) return "var(--accent)";
  if (m >= 25) return "var(--color-amber)";
  return "var(--color-red)";
}
function getScoreInfo(score) {
  if (score >= 85) return { color:"var(--color-green)", label:"Excellent", pct:"Top 10%" };
  if (score >= 70) return { color:"var(--accent)",      label:"Good",      pct:"Top 30%" };
  if (score >= 55) return { color:"var(--color-amber)", label:"Fair",      pct:"Top 50%" };
  return { color:"var(--color-red)", label:"Needs Work", pct:"Bottom 50%" };
}
function getWasteUrgencyColor(daysLeft) {
  if (daysLeft <= 1) return "var(--color-red)";
  if (daysLeft <= 2) return "var(--color-amber)";
  return "var(--accent)";
}

// Ticket label/color by position only. RED is never used on tickets — only on waste/expiry.
function getTicketMeta(index) {
  if (index === 0) return { label:'PUSH TONIGHT', color:'var(--accent)' };
  if (index === 1) return { label:'RECOMMEND',    color:'var(--color-green)' };
  return              { label:'MENTION',         color:'var(--color-amber)' };
}

const TICKET_COLORS = ['var(--accent)','var(--color-green)','var(--color-amber)'];

function Sparkline({ points, color, globalMin, globalMax, width=70, height=24 }) {
  if (!points || points.length < 2) return null;
  const minV = globalMin !== undefined ? globalMin : Math.min(...points);
  const maxV = globalMax !== undefined ? globalMax : Math.max(...points);
  const range = maxV - minV || 1;
  const pad = 2;
  const coords = points.map((p,i) => {
    const x = pad + (i/(points.length-1))*(width-pad*2);
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
  ::-webkit-scrollbar-track{background:var(--scrollbar-track);}
  ::-webkit-scrollbar-thumb{background:var(--scrollbar-thumb);border-radius:2px;}
  .db-root{font-family:'Inter',sans-serif;background:var(--bg-root);color:var(--text-primary);width:100%;height:100vh;display:flex;flex-direction:column;overflow:hidden;}
  .db-topbar{background:var(--bg-elevated);border-bottom:1px solid var(--border);height:clamp(36px,4vh,48px);padding:0 clamp(10px,1vw,20px);display:flex;align-items:center;justify-content:space-between;flex-shrink:0;}
  .db-logo{font-family:'Playfair Display',serif;font-size:clamp(14px,1.1vw,20px);color:var(--text-primary);letter-spacing:-.3px;}
  .db-logo span{color:var(--accent);}
  .db-tab{padding:clamp(2px,.3vh,4px) clamp(6px,.6vw,11px);border-radius:clamp(3px,.3vw,6px);font-size:clamp(10px,.75vw,13px);color:var(--text-muted);border:none;background:none;cursor:pointer;font-family:'Inter',sans-serif;line-height:1.5;transition:all .15s;}
  .db-tab.active{color:var(--text-primary);background:var(--bg-inset);}
  .db-main{flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden;}
  .db-wbar{background:var(--bg-surface);border-bottom:1px solid var(--border);height:clamp(28px,3.2vh,40px);padding:0 clamp(10px,1vw,16px);display:flex;align-items:center;justify-content:space-between;flex-shrink:0;}
  .db-wname{font-size:clamp(11px,.82vw,15px);font-weight:600;color:var(--text-primary);}
  .db-wsub{font-size:clamp(9px,.62vw,11px);color:var(--text-muted);margin-left:6px;}
  .db-wactions{display:flex;align-items:center;gap:clamp(10px,1.2vw,20px);}
  .db-waction-item{display:flex;align-items:center;gap:4px;font-size:clamp(9px,.62vw,11px);color:var(--text-muted);}
  .db-waction-dot{width:5px;height:5px;border-radius:50%;flex-shrink:0;}
  .db-waction-val{font-weight:600;}
  .db-section-hd{font-size:clamp(8px,.58vw,10px);font-weight:700;text-transform:uppercase;letter-spacing:1.2px;color:var(--text-faint);padding:clamp(4px,.4vh,6px) 0 clamp(3px,.3vh,5px);flex-shrink:0;}
  .db-grid-wrap{flex:1;min-height:0;padding:clamp(6px,.6vw,10px) clamp(24px,3vw,60px);gap:0;display:flex;flex-direction:column;overflow:hidden;}
  .db-row-top{display:grid;grid-template-columns:clamp(148px,12vw,200px) 1fr 1fr 1fr;gap:clamp(5px,.5vw,9px);flex:0 0 auto;min-height:clamp(220px,28vh,360px);margin-bottom:0;}
  .db-row-bottom{display:grid;grid-template-columns:clamp(148px,12vw,200px) 1fr 1fr 1fr;gap:clamp(5px,.5vw,9px);flex:0 0 auto;min-height:0;}
  .db-score-card{background:var(--bg-surface);border:1px solid var(--border);border-radius:clamp(5px,.4vw,8px);padding:clamp(8px,.7vw,14px);display:flex;flex-direction:column;align-items:center;gap:clamp(4px,.4vh,7px);flex-shrink:0;}
  .db-stats-card{background:var(--bg-surface);border:1px solid var(--border);border-radius:clamp(5px,.4vw,8px);padding:clamp(8px,.7vw,14px);display:flex;flex-direction:column;gap:clamp(5px,.5vh,8px);flex:1;min-height:0;overflow:hidden;}
  .db-rest-icon{width:clamp(22px,1.8vw,32px);height:clamp(22px,1.8vw,32px);border-radius:50%;background:var(--accent-bg);border:1px solid var(--accent-border);display:flex;align-items:center;justify-content:center;flex-shrink:0;}
  .db-rest-icon svg{width:55%;height:55%;stroke:var(--accent);fill:none;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;}
  .db-rest-name{font-family:'Inter',sans-serif;font-size:clamp(10px,.8vw,14px);font-weight:600;color:var(--text-primary);text-align:center;}
  .db-rest-sub{font-family:'Inter',sans-serif;font-size:clamp(8px,.58vw,10px);color:var(--text-muted);text-align:center;}
  .db-score-wrap{display:flex;flex-direction:column;align-items:center;gap:clamp(2px,.25vh,4px);flex-shrink:0;}
  .db-score-lbl{font-size:clamp(8px,.58vw,10px);color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;font-weight:500;}
  .db-ring{position:relative;width:clamp(52px,4.8vw,76px);height:clamp(52px,4.8vw,76px);}
  .db-ring svg{width:100%;height:100%;transform:rotate(-90deg);}
  .db-ring-inner{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;}
  .db-ring-num{font-family:'Playfair Display',serif;font-size:clamp(15px,1.4vw,22px);color:var(--text-primary);line-height:1;}
  .db-ring-sub{font-size:clamp(7px,.52vw,9px);color:var(--text-muted);}
  .db-score-tag{font-size:clamp(8px,.6vw,11px);font-weight:600;padding:2px clamp(6px,.5vw,10px);border-radius:10px;}
  .db-score-pct{font-size:clamp(7px,.55vw,9px);color:var(--text-muted);margin-top:1px;}
  .db-pill{background:var(--bg-elevated);border-radius:clamp(4px,.3vw,6px);padding:clamp(4px,.42vh,7px) clamp(7px,.6vw,12px);display:flex;align-items:center;justify-content:space-between;border:1px solid var(--border-subtle);flex-shrink:0;gap:6px;}
  .db-pill-left{flex:1;min-width:0;}
  .db-pill-l{font-size:clamp(9px,.62vw,11px);color:var(--text-muted);}
  .db-pill-sub{font-size:clamp(7px,.52vw,9px);color:var(--text-faint);margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .db-pill-v{font-family:'Inter',sans-serif;font-size:clamp(12px,1vw,16px);font-weight:700;flex-shrink:0;}
  .db-card{background:var(--bg-surface);border:1px solid var(--border);border-radius:clamp(5px,.4vw,8px);padding:clamp(8px,.8vw,14px) clamp(9px,.9vw,16px);display:flex;flex-direction:column;overflow:hidden;min-height:0;}
  .db-card-hd{display:flex;align-items:center;justify-content:space-between;margin-bottom:clamp(5px,.6vh,10px);flex-shrink:0;}
  .db-card-title{font-size:clamp(10px,.75vw,13px);font-weight:600;color:var(--text-primary);display:flex;align-items:center;gap:clamp(4px,.32vw,6px);}
  .db-card-title svg{width:clamp(10px,.82vw,14px);height:clamp(10px,.82vw,14px);stroke:var(--accent);fill:none;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;}
  .db-card-sub{font-size:clamp(8px,.58vw,10px);color:var(--text-muted);}
  .db-empty{flex:1;display:flex;align-items:center;justify-content:center;font-size:clamp(10px,.75vw,13px);color:var(--text-muted);text-align:center;padding:8px;}
  .db-spinner{width:clamp(7px,.62vw,10px);height:clamp(7px,.62vw,10px);border:1.5px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:spin .7s linear infinite;display:inline-block;}
  .db-ticket{background:var(--ticket-bg);border:1px solid var(--ticket-border);border-radius:clamp(4px,.35vw,7px);display:flex;flex-direction:column;overflow:hidden;font-family:'Courier New',monospace;animation:fadeIn .3s ease both;position:relative;}
  .db-ticket:nth-child(2){animation-delay:.08s;}
  .db-ticket:nth-child(3){animation-delay:.16s;}
  .db-ticket-inner{flex:1;display:flex;min-height:0;overflow:hidden;}
  .db-ticket-left{flex:1;padding:clamp(5px,.55vh,8px) clamp(7px,.7vw,11px);display:flex;flex-direction:column;gap:0;border-right:1px dashed var(--border);overflow:hidden;}
  .db-ticket-right{width:45%;padding:clamp(5px,.55vh,8px) clamp(6px,.6vw,10px);display:flex;flex-direction:column;overflow:hidden;}
  .db-receipt-divider{border:none;border-top:1px dashed var(--border);margin:clamp(2px,.2vh,3px) 0;flex-shrink:0;}
  .db-receipt-component{font-size:clamp(9px,.72vw,12px);color:var(--text-secondary);margin-top:4px;font-weight:600;flex-shrink:0;}
  .db-receipt-ingredient{font-size:clamp(8px,.65vw,11px);color:var(--text-muted);padding-left:10px;line-height:1.7;flex-shrink:0;}
  .db-receipt-ingredient.at-risk{color:var(--color-red);font-weight:600;}
  .db-receipt-footer{font-size:clamp(7px,.52vw,9px);color:var(--text-disabled);text-align:center;margin-top:auto;padding-top:clamp(4px,.4vh,6px);flex-shrink:0;}
  .db-waste-list{flex:1;overflow-y:auto;min-height:0;}
  .db-waste-list::-webkit-scrollbar{width:2px;}
  .db-waste-row{display:flex;flex-direction:column;gap:3px;padding:clamp(5px,.55vh,8px) clamp(7px,.65vw,11px);background:var(--bg-elevated);border-radius:clamp(4px,.32vw,6px);border:1px solid var(--border-subtle);margin-bottom:clamp(4px,.4vh,6px);flex-shrink:0;}
  .db-waste-row:last-child{margin-bottom:0;}
  .db-waste-top{display:flex;align-items:center;gap:6px;}
  .db-waste-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0;}
  .db-waste-name{flex:1;font-size:clamp(10px,.72vw,12px);color:var(--text-secondary);text-transform:capitalize;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .db-waste-days{font-size:clamp(9px,.62vw,11px);font-weight:600;white-space:nowrap;flex-shrink:0;}
  .db-waste-bar-track{width:100%;height:3px;background:var(--border-subtle);border-radius:2px;overflow:hidden;}
  .db-waste-bar-fill{height:100%;border-radius:2px;}
  .db-waste-meta{display:flex;justify-content:space-between;}
  .db-waste-meta-txt{font-size:clamp(7px,.52vw,9px);color:var(--text-faint);}
  .db-waste-invoice-link{font-size:clamp(7px,.52vw,9px);color:var(--accent);cursor:pointer;background:none;border:none;font-family:'Inter',sans-serif;padding:0;text-decoration:underline;opacity:.8;}
  .db-waste-invoice-link:hover{opacity:1;}
  .db-waste-view-all{font-size:clamp(8px,.58vw,10px);color:var(--accent);background:none;border:none;cursor:pointer;font-family:'Inter',sans-serif;padding:clamp(4px,.4vh,6px) 0 0;text-align:center;width:100%;flex-shrink:0;opacity:.8;}
  .db-waste-view-all:hover{opacity:1;}
  .db-pm-back{font-size:clamp(8px,.6vw,11px);color:var(--accent);background:none;border:none;cursor:pointer;font-family:'Inter',sans-serif;padding:0;display:flex;align-items:center;gap:3px;}
  .db-pm-scroll{flex:1;overflow-y:auto;min-height:0;display:flex;flex-direction:column;}
  .db-pm-scroll::-webkit-scrollbar{width:2px;}
  .db-pm-cat-row{display:flex;align-items:center;gap:clamp(5px,.45vw,8px);padding:0 clamp(7px,.65vw,11px);background:var(--bg-elevated);border-radius:clamp(4px,.32vw,6px);border:1px solid var(--border-subtle);margin-bottom:clamp(4px,.4vh,6px);cursor:pointer;transition:border-color .15s;flex:1;min-height:0;}
  .db-pm-cat-row:last-child{margin-bottom:0;}
  .db-pm-cat-row:hover{border-color:var(--text-faint);}
  .db-pm-cat-name{flex:1;font-size:clamp(10px,.72vw,12px);color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .db-pm-cat-delta{font-size:clamp(10px,.72vw,12px);font-weight:600;white-space:nowrap;flex-shrink:0;}
  .db-pm-cat-count{font-size:clamp(8px,.58vw,10px);color:var(--text-muted);white-space:nowrap;flex-shrink:0;}
  .db-pm-cat-chevron{font-size:10px;color:var(--text-faint);flex-shrink:0;}
  .db-pm-ing-row{display:flex;flex-direction:column;gap:4px;padding:clamp(5px,.55vh,9px) clamp(7px,.65vw,11px);background:var(--bg-elevated);border-radius:clamp(4px,.32vw,6px);border:1px solid var(--border-subtle);margin-bottom:clamp(4px,.4vh,6px);flex-shrink:0;}
  .db-pm-ing-row:last-child{margin-bottom:0;}
  .db-pm-ing-top{display:flex;align-items:center;gap:6px;}
  .db-pm-ing-name{flex:1;font-size:clamp(10px,.72vw,12px);color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-transform:capitalize;}
  .db-pm-ing-delta{font-size:clamp(10px,.72vw,12px);font-weight:600;white-space:nowrap;flex-shrink:0;}
  .db-pm-ing-prices{font-size:clamp(7px,.55vw,9px);color:var(--text-muted);padding-left:2px;}
  .db-legend-strip{font-size:clamp(7px,.55vw,9px);color:var(--text-faint);display:flex;align-items:center;gap:10px;padding-top:clamp(4px,.4vh,6px);flex-shrink:0;border-top:1px solid var(--border-subtle);margin-top:clamp(4px,.4vh,6px);}
  .db-legend-dot{width:6px;height:6px;border-radius:50%;display:inline-block;margin-right:3px;flex-shrink:0;}
  .wir-stats{display:grid;grid-template-columns:1fr 1fr 1fr;gap:clamp(4px,.4vw,7px);margin-bottom:clamp(8px,.8vh,12px);flex-shrink:0;}
  .wir-stat{background:var(--bg-elevated);border:1px solid var(--border-subtle);border-radius:clamp(4px,.3vw,6px);padding:clamp(6px,.6vh,9px) clamp(8px,.7vw,12px);}
  .wir-stat-lbl{font-size:clamp(7px,.55vw,9px);color:var(--text-faint);text-transform:uppercase;letter-spacing:.6px;margin-bottom:3px;}
  .wir-stat-val{font-family:'Playfair Display',serif;font-size:clamp(14px,1.3vw,20px);line-height:1;}
  .wir-stat-sub{font-size:clamp(7px,.52vw,9px);color:var(--text-faint);margin-top:2px;}
  .wir-days{flex:1;overflow-y:auto;min-height:0;display:flex;flex-direction:column;gap:clamp(3px,.3vh,5px);}
  .wir-days::-webkit-scrollbar{width:2px;}
  .wir-day-row{background:var(--bg-elevated);border:1px solid var(--border-subtle);border-radius:clamp(4px,.32vw,6px);cursor:pointer;transition:border-color .15s;flex-shrink:0;overflow:hidden;}
  .wir-day-row.open{border-color:var(--accent);}
  .wir-day-row:hover:not(.open){border-color:var(--text-faint);}
  .wir-day-header{display:flex;align-items:center;gap:clamp(5px,.5vw,8px);padding:clamp(5px,.5vh,8px) clamp(8px,.7vw,12px);}
  .wir-day-label{font-size:clamp(9px,.68vw,11px);font-weight:600;color:var(--text-primary);width:clamp(24px,2vw,32px);flex-shrink:0;}
  .wir-day-date{font-size:clamp(8px,.58vw,9px);color:var(--text-faint);width:clamp(28px,2.4vw,36px);flex-shrink:0;}
  .wir-day-pills{flex:1;display:flex;gap:3px;overflow:hidden;}
  .wir-day-pill{font-size:clamp(7px,.55vw,9px);font-weight:600;padding:1px 5px;border-radius:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:clamp(60px,7vw,100px);}
  .wir-day-bar-wrap{width:clamp(30px,3vw,50px);flex-shrink:0;}
  .wir-day-bar-track{height:3px;background:var(--border-subtle);border-radius:2px;overflow:hidden;}
  .wir-day-bar-fill{height:100%;border-radius:2px;}
  .wir-day-extra{font-size:clamp(9px,.68vw,11px);font-weight:700;text-align:right;flex-shrink:0;width:clamp(24px,2vw,32px);}
  .wir-day-chevron{font-size:9px;color:var(--text-faint);flex-shrink:0;}
  .wir-detail{padding:clamp(6px,.6vh,10px) clamp(8px,.7vw,12px);border-top:1px solid var(--border-subtle);}
  .wir-detail-hd{font-size:clamp(8px,.58vw,10px);font-weight:600;color:var(--text-faint);text-transform:uppercase;letter-spacing:.7px;margin-bottom:clamp(6px,.6vh,9px);}
  .wir-dish-row{margin-bottom:clamp(7px,.7vh,11px);}
  .wir-dish-row:last-child{margin-bottom:0;}
  .wir-dish-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:3px;}
  .wir-dish-name-wrap{display:flex;align-items:center;gap:5px;}
  .wir-dish-type{font-size:clamp(7px,.55vw,9px);font-weight:600;text-transform:uppercase;letter-spacing:.5px;}
  .wir-dish-name{font-size:clamp(9px,.72vw,12px);font-weight:600;color:var(--text-primary);}
  .wir-dish-delta{font-size:clamp(9px,.68vw,11px);font-weight:700;}
  .wir-dish-bars{display:flex;flex-direction:column;gap:2px;}
  .wir-dish-bar-row{display:flex;align-items:center;gap:5px;}
  .wir-dish-bar-lbl{font-size:clamp(7px,.52vw,9px);color:var(--text-faint);width:clamp(22px,2vw,28px);flex-shrink:0;}
  .wir-dish-bar-track{flex:1;height:4px;background:var(--border-subtle);border-radius:2px;overflow:hidden;}
  .wir-dish-bar-fill{height:100%;border-radius:2px;}
  .wir-dish-bar-val{font-size:clamp(7px,.55vw,9px);font-weight:600;width:clamp(18px,1.8vw,24px);text-align:right;flex-shrink:0;}
  .wir-detail-footer{display:flex;justify-content:space-between;padding-top:clamp(5px,.5vh,8px);border-top:1px solid var(--border-subtle);margin-top:clamp(5px,.5vh,8px);}
  .wir-detail-footer-lbl{font-size:clamp(8px,.58vw,10px);color:var(--text-faint);}
  .wir-detail-footer-val{font-size:clamp(8px,.58vw,10px);font-weight:600;color:var(--color-green);}
  .mob-root{font-family:'Inter',sans-serif;background:var(--bg-root);color:var(--text-primary);width:100%;height:100dvh;display:flex;flex-direction:column;overflow:hidden;}
  .mob-header{background:var(--bg-elevated);border-bottom:1px solid var(--border);padding:10px 16px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;padding-top:env(safe-area-inset-top,10px);}
  .mob-logo{font-family:'Playfair Display',serif;font-size:20px;color:var(--text-primary);letter-spacing:-.3px;}
  .mob-logo span{color:var(--accent);}
  .mob-titlebar{background:var(--bg-surface);border-bottom:1px solid var(--border);padding:10px 16px;flex-shrink:0;}
  .mob-page-title{font-family:'Playfair Display',serif;font-size:20px;color:var(--text-primary);line-height:1;}
  .mob-page-sub{font-size:11px;color:var(--text-muted);margin-top:3px;}
  .mob-stats{background:var(--bg-surface);border-bottom:1px solid var(--border);padding:8px 16px;display:flex;flex-shrink:0;overflow-x:auto;}
  .mob-stats::-webkit-scrollbar{display:none;}
  .mob-stat{flex:1;min-width:0;text-align:center;padding:0 6px;border-right:1px solid var(--border);}
  .mob-stat:last-child{border-right:none;}
  .mob-stat-v{font-family:'Playfair Display',serif;font-size:16px;line-height:1;}
  .mob-stat-l{font-size:9px;color:var(--text-muted);margin-top:2px;text-transform:uppercase;letter-spacing:.4px;}
  .mob-content{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:10px;-webkit-overflow-scrolling:touch;}
  .mob-content::-webkit-scrollbar{display:none;}
  .mob-card{background:var(--bg-surface);border:1px solid var(--border);border-radius:10px;padding:14px;flex-shrink:0;}
  .mob-card-title{font-size:11px;font-weight:600;color:var(--text-primary);text-transform:uppercase;letter-spacing:.7px;margin-bottom:10px;display:flex;align-items:center;gap:6px;}
  .mob-card-title svg{width:12px;height:12px;stroke:var(--accent);fill:none;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;}
  .mob-pill-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;}
  .mob-pill{background:var(--bg-elevated);border:1px solid var(--border-subtle);border-radius:8px;padding:10px 12px;}
  .mob-pill-l{font-size:10px;color:var(--text-muted);margin-bottom:4px;}
  .mob-pill-v{font-family:'Playfair Display',serif;font-size:18px;line-height:1;}
  .mob-score-row{display:flex;align-items:center;gap:16px;}
  .mob-score-ring{position:relative;width:64px;height:64px;flex-shrink:0;}
  .mob-score-ring svg{width:100%;height:100%;transform:rotate(-90deg);}
  .mob-score-inner{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;}
  .mob-score-num{font-family:'Playfair Display',serif;font-size:18px;color:var(--text-primary);line-height:1;}
  .mob-score-sub{font-size:9px;color:var(--text-muted);}
  .mob-score-badge{display:inline-block;font-size:11px;font-weight:600;padding:3px 10px;border-radius:10px;margin-top:5px;}
  .mob-ai-item{background:var(--bg-elevated);border-radius:7px;border-left:2px solid var(--accent);padding:10px 12px;margin-bottom:8px;font-family:'Courier New',monospace;}
  .mob-ai-item:last-child{margin-bottom:0;}
  .mob-ai-title{font-size:13px;font-weight:700;color:var(--text-primary);margin-bottom:3px;}
  .mob-ai-desc{font-size:11px;color:var(--text-muted);line-height:1.45;}
  .mob-ai-sell{font-size:11px;color:var(--text-secondary);font-style:italic;margin-top:5px;line-height:1.45;}
  .mob-bottom-nav{background:var(--bg-elevated);border-top:1px solid var(--border);padding:8px 0;padding-bottom:max(8px,env(safe-area-inset-bottom));display:flex;flex-shrink:0;}
  .mob-nav-item{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;cursor:pointer;padding:4px 0;-webkit-tap-highlight-color:transparent;}
  .mob-nav-icon{width:24px;height:24px;display:flex;align-items:center;justify-content:center;}
  .mob-nav-icon svg{width:20px;height:20px;stroke:var(--text-muted);fill:none;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;}
  .mob-nav-icon.active svg{stroke:var(--accent);}
  .mob-nav-label{font-size:10px;color:var(--text-muted);}
  .mob-nav-label.active{color:var(--accent);}
  .mob-nav-dot{width:4px;height:4px;border-radius:50%;background:var(--accent);}
`;

function ScoreRing({ score }) {
  const { color, label, pct } = getScoreInfo(score);
  const circumference = 2*Math.PI*40;
  const dash = (score/100)*circumference;
  return (
    <div className="db-score-wrap">
      <div className="db-score-lbl">OptiScore</div>
      <div className="db-ring">
        <svg viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="40" stroke="var(--ring-track)" strokeWidth="9" fill="none"/>
          <circle cx="50" cy="50" r="40" stroke={color} strokeWidth="9" fill="none" strokeDasharray={`${dash} ${circumference}`} strokeLinecap="round"/>
        </svg>
        <div className="db-ring-inner">
          <div className="db-ring-num">{score}</div>
          <div className="db-ring-sub">/ 100</div>
        </div>
      </div>
      <div className="db-score-tag" style={{background:`color-mix(in srgb, ${color} 15%, transparent)`,color}}>{label}</div>
      <div className="db-score-pct">{pct} of similar restaurants</div>
    </div>
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

function ThermalTicket({ rec, index, menuItems, wasteRisk }) {
  if (!rec) return null;
  const dishName    = rec.title || rec.dish || '';
  const description = rec.description || rec.reason || '';
  const sellCopy    = rec.sellCopy || rec.talking_point || SELL_COPY[index % SELL_COPY.length];
  const { label: ticketLabel, color: ticketColor } = getTicketMeta(index);
  const dishLower = dishName.toLowerCase().trim();
  const menuItem = (menuItems||[]).find(m => m.name?.toLowerCase().trim()===dishLower)
    || (menuItems||[]).find(m => dishLower.includes(m.name?.toLowerCase().trim()) || m.name?.toLowerCase().trim().includes(dishLower));
  const atRiskNames = new Set((wasteRisk||[]).map(w => w.name?.toLowerCase().trim()));
  return (
    <div className="db-ticket">
      <div className="db-ticket-inner">
        <div className="db-ticket-left">
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexShrink:0,marginBottom:'clamp(3px,.3vh,5px)'}}>
            <div style={{fontSize:'clamp(8px,.65vw,11px)',fontWeight:700,color:ticketColor,textTransform:'uppercase',letterSpacing:'1px'}}>{ticketLabel}</div>
            <div style={{fontSize:'clamp(7px,.55vw,9px)',color:'var(--text-faint)'}}>#{index+1}</div>
          </div>
          <div className="db-receipt-divider"/>
          <div style={{fontFamily:'Courier New,monospace',fontSize:'clamp(11px,.95vw,15px)',fontWeight:700,color:'var(--text-primary)',lineHeight:1.2,marginBottom:'clamp(2px,.2vh,3px)',flexShrink:0}}>{dishName||'—'}</div>
          <div className="db-receipt-divider"/>
          {description && <div style={{fontFamily:'Courier New,monospace',fontSize:'clamp(9px,.72vw,12px)',color:'var(--text-primary)',lineHeight:1.4,marginBottom:'clamp(2px,.2vh,4px)',flexShrink:0}}>{description}</div>}
          <div className="db-receipt-divider"/>
          <div style={{fontFamily:'Courier New,monospace',fontSize:'clamp(9px,.72vw,12px)',color:'var(--text-secondary)',fontStyle:'italic',lineHeight:1.45,flex:1,overflow:'hidden'}}>
            <span style={{color:'var(--accent)'}}>"</span>{sellCopy}<span style={{color:'var(--accent)'}}>"</span>
          </div>
          <div className="db-receipt-footer" style={{marginTop:'clamp(3px,.3vh,5px)'}}>#{String(index+1).padStart(3,'0')} · opti-menu.com</div>
        </div>
        <div className="db-ticket-right">
          <div style={{fontSize:'clamp(7px,.55vw,9px)',color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.8px',marginBottom:4,flexShrink:0}}>Recipe</div>
          <div style={{flex:1,overflowY:'auto'}}>
            {menuItem?.menu_item_components?.length > 0 ? menuItem.menu_item_components.map((comp,ci) => (
              <div key={ci}>
                <div className="db-receipt-component">— {comp.name||`Component ${ci+1}`}</div>
                {(comp.component_ingredients||[]).map((ci2,ii) => {
                  const ingName = ci2.ingredients?.name||ci2.name||'';
                  const isAtRisk = atRiskNames.has(ingName.toLowerCase().trim());
                  return <div key={ii} className={`db-receipt-ingredient${isAtRisk?' at-risk':''}`}>&nbsp;&nbsp;· {ingName}{ci2.quantity?` (${ci2.quantity})`:''}{isAtRisk?' ⚠':''}</div>;
                })}
              </div>
            )) : <div style={{fontSize:'clamp(7px,.55vw,9px)',color:'var(--text-faint)',fontFamily:'Courier New,monospace'}}>{dishName?'Recipe not linked':'No dish selected'}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

function WasteRow({ item, router }) {
  const daysLeft = item.daysLeft;
  const isExpired = daysLeft < 0;
  const urgencyColor = isExpired ? 'var(--color-red)' : getWasteUrgencyColor(daysLeft);
  const consumed = isExpired ? 100 : Math.min(100,Math.max(0,((item.shelfLife-daysLeft)/item.shelfLife)*100));
  const label = isExpired ? `Expired ${Math.abs(daysLeft)}d ago` : daysLeft===0 ? 'Use today' : daysLeft===1 ? '1 day left' : `${daysLeft} days left`;
  const qtyText = item.remainingQty>0 ? `~${item.remainingQty.toFixed(1)} ${item.unit||'units'} remaining` : item.invoicedQty>0 ? `${item.invoicedQty.toFixed(1)} ${item.unit||'units'} invoiced` : 'Qty unknown';
  return (
    <div className="db-waste-row">
      <div className="db-waste-top">
        <div className="db-waste-dot" style={{background:urgencyColor}}/>
        <div className="db-waste-name">{item.name}</div>
        <div className="db-waste-days" style={{color:urgencyColor}}>{label}</div>
      </div>
      <div className="db-waste-bar-track"><div className="db-waste-bar-fill" style={{width:`${consumed}%`,background:urgencyColor,opacity:0.7}}/></div>
      <div className="db-waste-meta">
        <span className="db-waste-meta-txt">{qtyText} · Delivered {formatDate(item.deliveryDate)}</span>
        {item.invoiceId && <button className="db-waste-invoice-link" onClick={() => router.push(`/client/invoices?selected=${item.invoiceId}`)}>View invoice →</button>}
      </div>
    </div>
  );
}

function PriceMovementCard({ priceByCategory }) {
  const [selectedCat, setSelectedCat] = useState(null);
  const categories = Object.keys(priceByCategory).sort();
  let globalMin=Infinity, globalMax=-Infinity;
  Object.values(priceByCategory).forEach(cat => cat.ingredients.forEach(ing => ing.history.forEach(p => { if(p<globalMin)globalMin=p; if(p>globalMax)globalMax=p; })));
  if (globalMin===Infinity){globalMin=0;globalMax=1;}
  const catData = selectedCat ? priceByCategory[selectedCat] : null;
  return (
    <div className="db-card">
      <div className="db-card-hd">
        <div className="db-card-title">
          <svg viewBox="0 0 24 24"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
          Price Movement
        </div>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          {selectedCat && <button className="db-pm-back" onClick={() => setSelectedCat(null)}>← Back</button>}
          <span className="db-card-sub">{selectedCat||'6-month trend'}</span>
        </div>
      </div>
      <div className="db-pm-scroll">
        {categories.length===0 && <div className="db-empty">No price history yet</div>}
        {!selectedCat && categories.map(cat => {
          const d=priceByCategory[cat], isUp=d.avgDelta>0, deltaColor=isUp?'var(--color-red)':'var(--color-green)';
          const maxLen=Math.max(...d.ingredients.map(i=>i.history.length));
          const avgHistory=Array.from({length:maxLen},(_,idx) => { const vals=d.ingredients.map(i=>i.history[idx]??i.history[i.history.length-1]).filter(Boolean); return vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:0; });
          return (
            <div key={cat} className="db-pm-cat-row" onClick={() => setSelectedCat(cat)}>
              <div className="db-pm-cat-name">{cat||'Uncategorized'}</div>
              {avgHistory.length>=2 && <Sparkline points={avgHistory} color={deltaColor} globalMin={globalMin} globalMax={globalMax} width={60} height={20}/>}
              <div className="db-pm-cat-delta" style={{color:deltaColor}}>{isUp?'↑':'↓'} {Math.abs(d.avgDelta).toFixed(1)}%</div>
              <div className="db-pm-cat-count">{d.ingredients.length} items</div>
              <div className="db-pm-cat-chevron">›</div>
            </div>
          );
        })}
        {selectedCat && catData && catData.ingredients.map((ing,i) => {
          const isUp=ing.deltaPct>0, deltaColor=isUp?'var(--color-red)':'var(--color-green)';
          return (
            <div key={i} className="db-pm-ing-row" style={{animation:'slideIn .2s ease both',animationDelay:`${i*.04}s`}}>
              <div className="db-pm-ing-top">
                <div className="db-pm-ing-name">{ing.name}</div>
                {ing.history.length>=2 && <Sparkline points={ing.history} color={deltaColor} globalMin={globalMin} globalMax={globalMax} width={60} height={20}/>}
                <div className="db-pm-ing-delta" style={{color:deltaColor}}>{isUp?'↑':'↓'} {Math.abs(ing.deltaPct).toFixed(1)}%</div>
              </div>
              <div className="db-pm-ing-prices">{fmtD(ing.firstPrice)} → {fmtD(ing.lastPrice)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WeekInReviewCard({ restaurantId }) {
  const [weekData, setWeekData] = useState([]);
  const [openDay, setOpenDay]   = useState(null);
  const [loading, setLoading]   = useState(true);

  useEffect(() => { if (restaurantId) loadWeekData(); }, [restaurantId]);

  async function loadWeekData() {
    setLoading(true);
    try {
      const days = Array.from({length:7},(_,i) => { const d=new Date(); d.setDate(d.getDate()-i); return d.toISOString().split('T')[0]; }).reverse();
      const fromDate = days[0];
      const [{ data: recs },{ data: sales }] = await Promise.all([
        supabase.from('ai_recommendations').select('generated_date,recommendations').eq('restaurant_id',restaurantId).gte('generated_date',fromDate).order('generated_date',{ascending:false}),
        supabase.from('pos_sales').select('item_name,quantity_sold,sale_date').eq('restaurant_id',restaurantId).gte('sale_date',fromDate),
      ]);
      const sixtyAgo=new Date(); sixtyAgo.setDate(sixtyAgo.getDate()-67);
      const { data: historicSales } = await supabase.from('pos_sales').select('item_name,quantity_sold,sale_date').eq('restaurant_id',restaurantId).gte('sale_date',sixtyAgo.toISOString().split('T')[0]).lt('sale_date',fromDate);
      const avgByItemDay={};
      (historicSales||[]).forEach(s => {
        const dow=new Date(s.sale_date+'T12:00:00').getDay();
        if(!avgByItemDay[s.item_name])avgByItemDay[s.item_name]={};
        if(!avgByItemDay[s.item_name][dow])avgByItemDay[s.item_name][dow]=[];
        avgByItemDay[s.item_name][dow].push(parseFloat(s.quantity_sold||0));
      });
      const salesByDateItem={};
      (sales||[]).forEach(s => {
        if(!salesByDateItem[s.sale_date])salesByDateItem[s.sale_date]={};
        salesByDateItem[s.sale_date][s.item_name]=(salesByDateItem[s.sale_date][s.item_name]||0)+parseFloat(s.quantity_sold||0);
      });
      const recsMap={};
      (recs||[]).forEach(r => { recsMap[r.generated_date]=r.recommendations||[]; });
      const DAY_NAMES=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
      const built=days.map(date => {
        const dow=new Date(date+'T12:00:00').getDay();
        const daySales=salesByDateItem[date]||{};
        const dayRecs=recsMap[date]||[];
        const dishes=dayRecs.slice(0,3).map((rec,i) => {
          const name=rec.title||rec.dish||'';
          const sold=daySales[name]||0;
          const hist=avgByItemDay[name]?.[dow]||[];
          const avg=hist.length>0?hist.reduce((a,b)=>a+b,0)/hist.length:null;
          const diff=avg!==null?sold-avg:null;
          const pct=avg!==null&&avg>0?Math.round((diff/avg)*100):null;
          return {name,sold,avg,diff,pct,type:rec.type,ticketColor:TICKET_COLORS[i]};
        });
        const extraSold=Math.round(dishes.reduce((s,d)=>s+(d.diff||0),0)*10)/10;
        const wasteSaved=Math.round(dayRecs.reduce((s,r,i)=>{
          if(r.type==='inventory'){const dish=dishes[i];return s+Math.max(0,(dish?.diff||0))*8;}
          return s;
        },0));
        return {date,dayLabel:DAY_NAMES[dow],dishes,extraSold,wasteSaved};
      });
      setWeekData(built);
    } catch(e){ console.error('[WeekInReview]',e); }
    finally { setLoading(false); }
  }

  const weekExtraSold  = Math.round(weekData.reduce((s,d)=>s+Math.max(0,d.extraSold),0)*10)/10;
  const weekWasteSaved = weekData.reduce((s,d)=>s+d.wasteSaved,0);
  const daysWithData   = weekData.filter(d=>d.dishes.length>0).length;
  const hitRate        = daysWithData>0?Math.round((weekData.filter(d=>d.extraSold>0).length/daysWithData)*100):0;
  const maxWaste       = Math.max(...weekData.map(d=>d.wasteSaved),1);
  const openDayData    = weekData.find(d=>d.date===openDay);
  const handleDayClick = (date) => setOpenDay(prev=>prev===date?null:date);

  return (
    <div className="db-card">
      <div className="db-card-hd">
        <div className="db-card-title">
          <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          Week in Review
        </div>
        <span className="db-card-sub">{weekData.length>0?`${weekData[0].date.slice(5).replace('-','/')} – ${weekData[weekData.length-1].date.slice(5).replace('-','/')}`:'7-day summary'}</span>
      </div>

      {loading ? <div className="db-empty">Loading...</div> : (
        <>
          {!openDay && (
            <div className="wir-stats">
              <div className="wir-stat">
                <div className="wir-stat-lbl">Extra sold</div>
                <div className="wir-stat-val" style={{color:weekExtraSold>=0?'var(--color-green)':'var(--color-red)'}}>{weekExtraSold>=0?'+':''}{weekExtraSold}</div>
                <div className="wir-stat-sub">vs. avg</div>
              </div>
              <div className="wir-stat">
                <div className="wir-stat-lbl">Waste saved</div>
                <div className="wir-stat-val" style={{color:'var(--color-green)'}}>${weekWasteSaved}</div>
                <div className="wir-stat-sub">est.</div>
              </div>
              <div className="wir-stat">
                <div className="wir-stat-lbl">Hit rate</div>
                <div className="wir-stat-val" style={{color:'var(--accent)'}}>{hitRate}%</div>
                <div className="wir-stat-sub">days above avg</div>
              </div>
            </div>
          )}

          <div className="wir-days">
            {openDay ? (
              <>
                <div style={{display:'flex',gap:'clamp(8px,1vw,16px)',marginBottom:'clamp(5px,.5vh,8px)',flexShrink:0}}>
                  <span style={{fontSize:'clamp(8px,.6vw,10px)',color:'var(--text-faint)'}}>Week: <span style={{color:'var(--color-green)',fontWeight:600}}>+{weekExtraSold} sold</span></span>
                  <span style={{fontSize:'clamp(8px,.6vw,10px)',color:'var(--text-faint)'}}><span style={{color:'var(--color-green)',fontWeight:600}}>${weekWasteSaved}</span> saved</span>
                  <button onClick={() => setOpenDay(null)} style={{marginLeft:'auto',background:'none',border:'none',cursor:'pointer',fontSize:'clamp(8px,.6vw,10px)',color:'var(--accent)',fontFamily:'Inter,sans-serif'}}>← All days</button>
                </div>
                {openDayData && (
                  <div className="wir-day-row open">
                    <div className="wir-day-header" onClick={() => handleDayClick(openDayData.date)}>
                      <span className="wir-day-label">{openDayData.dayLabel}</span>
                      <span className="wir-day-date">{openDayData.date.slice(5).replace('-','/')}</span>
                      <div className="wir-day-pills">
                        {openDayData.dishes.map((d,i) => (
                          <span key={i} className="wir-day-pill" style={{background:`color-mix(in srgb, ${d.ticketColor} 12%, transparent)`,color:d.ticketColor}}>{d.name.split(' ').slice(0,2).join(' ')}</span>
                        ))}
                      </div>
                      <div className="wir-day-extra" style={{color:openDayData.extraSold>0?'var(--color-green)':openDayData.extraSold<0?'var(--color-red)':'var(--text-faint)'}}>
                        {openDayData.extraSold>0?'+':''}{openDayData.extraSold}
                      </div>
                      <span className="wir-day-chevron">▴</span>
                    </div>
                    <div className="wir-detail">
                      <div className="wir-detail-hd">{openDayData.date} · Dish Performance</div>
                      {openDayData.dishes.length===0 && <div style={{fontSize:'clamp(9px,.68vw,11px)',color:'var(--text-muted)'}}>No recommendations found for this day.</div>}
                      {openDayData.dishes.map((dish,i) => {
                        const diff=dish.diff;
                        const diffColor=diff!==null?(diff>0?'var(--color-green)':diff<0?'var(--color-red)':'var(--text-muted)'):'var(--text-muted)';
                        const maxBar=Math.max(dish.sold,dish.avg||0,1);
                        return (
                          <div key={i} className="wir-dish-row">
                            <div className="wir-dish-top">
                              <div className="wir-dish-name-wrap">
                                <span className="wir-dish-type" style={{color:dish.ticketColor}}>{i===0?'Push':i===1?'Rec':'Mention'}</span>
                                <span className="wir-dish-name">{dish.name}</span>
                              </div>
                              <span className="wir-dish-delta" style={{color:diffColor}}>{diff!==null?`${diff>0?'+':''}${diff.toFixed(1)} (${dish.pct>0?'+':''}${dish.pct??'—'}%)`:'—'}</span>
                            </div>
                            <div className="wir-dish-bars">
                              <div className="wir-dish-bar-row">
                                <span className="wir-dish-bar-lbl">Sold</span>
                                <div className="wir-dish-bar-track"><div className="wir-dish-bar-fill" style={{width:`${(dish.sold/maxBar)*100}%`,background:'var(--accent)'}}/></div>
                                <span className="wir-dish-bar-val" style={{color:'var(--accent)'}}>{dish.sold}</span>
                              </div>
                              {dish.avg!==null && (
                                <div className="wir-dish-bar-row">
                                  <span className="wir-dish-bar-lbl">Avg</span>
                                  <div className="wir-dish-bar-track"><div className="wir-dish-bar-fill" style={{width:`${(dish.avg/maxBar)*100}%`,background:'var(--border)'}}/></div>
                                  <span className="wir-dish-bar-val" style={{color:'var(--text-faint)'}}>{dish.avg.toFixed(1)}</span>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                      <div className="wir-detail-footer">
                        <span className="wir-detail-footer-lbl">Estimated waste prevented</span>
                        <span className="wir-detail-footer-val">${openDayData.wasteSaved}</span>
                      </div>
                    </div>
                  </div>
                )}
              </>
            ) : (
              weekData.map(day => {
                const barW=Math.round((day.wasteSaved/maxWaste)*100);
                const extraColor=day.extraSold>0?'var(--color-green)':day.extraSold<0?'var(--color-red)':'var(--text-faint)';
                return (
                  <div key={day.date} className="wir-day-row" onClick={() => handleDayClick(day.date)}>
                    <div className="wir-day-header">
                      <span className="wir-day-label">{day.dayLabel}</span>
                      <span className="wir-day-date">{day.date.slice(5).replace('-','/')}</span>
                      <div className="wir-day-pills">
                        {day.dishes.length>0?day.dishes.map((d,i)=>(
                          <span key={i} className="wir-day-pill" style={{background:`color-mix(in srgb, ${d.ticketColor} 12%, transparent)`,color:d.ticketColor}}>{d.name.split(' ').slice(0,2).join(' ')}</span>
                        )):<span style={{fontSize:'clamp(8px,.58vw,10px)',color:'var(--text-faint)'}}>No recs</span>}
                      </div>
                      <div className="wir-day-bar-wrap">
                        <div className="wir-day-bar-track"><div className="wir-day-bar-fill" style={{width:`${barW}%`,background:day.wasteSaved>0?'var(--color-green)':'var(--border)'}}/></div>
                      </div>
                      <div className="wir-day-extra" style={{color:extraColor}}>{day.extraSold>0?'+':''}{day.extraSold}</div>
                      <span className="wir-day-chevron">▾</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default function ClientDashboard() {
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
  const [wasteShowAll, setWasteShowAll] = useState(false);
  const [data, setData] = useState({
    totalInvoices:0,totalIngredients:0,totalMenuItems:0,
    ingredientTrends:[],menuItemAnalysis:[],
    unpricedIngredients:0,averageMargin:0,
    totalSpending:0,aiProfitScore:{score:0},aiRecommendations:[],
    lowMarginCount:0,wasteRisk:[],priceByCategory:{},
  });
  const LOW_MARGIN_THRESHOLD = 40;
  const WASTE_PREVIEW = 5;

  useEffect(() => { ['dashboard','invoices','ingredients','menu-items','analytics'].forEach(p => router.prefetch(`/client/${p}`)); },[]);
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
  useEffect(()=>{
    if(isTour&&restaurantId){fetchSampleData().then(sample=>{if(sample){const processed=processDashboardData(sample.invoices,sample.ingredients,sample.menuItems,[],{});setData(processed);setMenuItemsFull(sample.menuItems||[]);setLoading(false);}});}
  },[isTour,restaurantId]);

  async function getRestaurantId(){
    try{
      const {data:{user},error:userError}=await supabase.auth.getUser();
      if(userError||!user){setError("Authentication required");setLoading(false);return;}
      setUserEmail(user.email||'');
      const {data:profile,error:profileError}=await supabase.from("profiles").select("restaurant_id,full_name").eq("id",user.id).single();
      if(profileError||!profile?.restaurant_id){setError("Could not determine restaurant access");setLoading(false);return;}
      setRestaurantId(profile.restaurant_id);
      setUserName(profile.full_name?profile.full_name.split(' ')[0]:"User");
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
        supabase.from("ingredients").select("*").eq("restaurant_id",restId),
        supabase.from("menu_items").select(`id,name,price,cost,category,menu_item_components(id,name,cost,component_ingredients(quantity,ingredients(id,name,last_price,is_estimated)))`).eq("restaurant_id",restId),
        supabase.from("invoice_items").select("*,invoices!inner(id,date,restaurant_id)").eq("invoices.restaurant_id",restId).gte("invoices.date",fromDate).order("invoices(date)",{ascending:true}),
        supabase.from("pos_sales").select("item_name,quantity_sold,sale_date").eq("restaurant_id",restId),
      ]);
      setMenuItemsFull(menuItems||[]);
      const wasteRisk=computeWasteRisk(invoiceItems||[],invoices||[],posSales||[]);
      const priceByCategory=computePriceByCategory(invoiceItems||[]);
      const processed=processDashboardData(invoices||[],ingredients||[],menuItems||[],wasteRisk,priceByCategory);
      setData(processed);setLoading(false);
      fetchAIRecommendations(processed,restId);
    }catch(err){setError("Failed to fetch dashboard data: "+err.message);setLoading(false);}
  }

  const PROTEIN_KEYS=new Set(['fish','salmon','tuna','halibut','cod','tilapia','mahi','shrimp','scallop','lobster','crab','oyster','clam','swordfish','bass','snapper','flounder','trout','bluefin tuna','seared toro','chicken','beef','pork','lamb','veal','duck','turkey','steak','ground beef','ground pork','bacon','sausage','filet mignon','new york strip','ribeye','short rib']);
  function isProtein(name){const lower=(name||'').toLowerCase();if(PROTEIN_KEYS.has(lower))return true;for(const key of PROTEIN_KEYS){if(lower.includes(key))return true;}return false;}

  function computeWasteRisk(invoiceItems,invoices,posSales){
    const invoiceDateMap={};
    (invoices||[]).forEach(inv=>{if(inv.id&&inv.date)invoiceDateMap[inv.id]=inv.date;});
    const posByItem={};
    (posSales||[]).forEach(s=>{const key=(s.item_name||'').toLowerCase().trim();if(!posByItem[key])posByItem[key]={};posByItem[key][s.sale_date]=(posByItem[key][s.sale_date]||0)+parseFloat(s.quantity_sold||0);});
    const latestByIngredient={};
    (invoiceItems||[]).forEach(item=>{
      const name=(item.ingredient_name_normalized||item.item_name||'').trim();if(!name)return;
      const dateStr=item.invoices?.date||invoiceDateMap[item.invoice_id];if(!dateStr)return;
      const date=new Date(dateStr);if(isNaN(date.getTime()))return;
      if(!latestByIngredient[name]||date>latestByIngredient[name].date){latestByIngredient[name]={date,unit:item.unit,quantity:parseFloat(item.quantity||0),unitCost:parseFloat(item.unit_cost||0),invoiceId:item.invoice_id||item.invoices?.id,invoiceDate:dateStr};}
    });
    const today=new Date();today.setHours(0,0,0,0);
    const risks=Object.entries(latestByIngredient).map(([name,info])=>{
      const shelfLife=getShelfLife(name);
      const deliveryDate=new Date(info.date);deliveryDate.setHours(0,0,0,0);
      const daysSinceDelivery=Math.floor((today-deliveryDate)/(1000*60*60*24));
      const daysLeft=shelfLife-daysSinceDelivery;
      let soldSinceDelivery=0;
      const nameLower=name.toLowerCase().trim();
      if(posByItem[nameLower])Object.entries(posByItem[nameLower]).forEach(([saleDate,qty])=>{if(saleDate>=info.invoiceDate)soldSinceDelivery+=qty;});
      return {name,daysLeft,shelfLife,daysSinceDelivery,deliveryDate:info.invoiceDate,invoiceId:info.invoiceId,unit:info.unit,invoicedQty:info.quantity,remainingQty:Math.max(0,info.quantity-soldSinceDelivery),totalValue:(Math.max(0,info.quantity-soldSinceDelivery))*info.unitCost,protein:isProtein(name)};
    });
    const proteins=risks.filter(r=>r.protein).sort((a,b)=>a.daysSinceDelivery-b.daysSinceDelivery).slice(0,4);
    const others=risks.filter(r=>!r.protein&&r.daysLeft>=0&&r.daysLeft<=5).sort((a,b)=>a.daysLeft-b.daysLeft);
    return [...proteins,...others];
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
        const deltaPct=((lastPrice-firstPrice)/firstPrice)*100;if(Math.abs(deltaPct)<2)return;
        ingList.push({name:ingName,history:filled2,deltaPct,firstPrice,lastPrice});
      });
      if(!ingList.length)return;
      ingList.sort((a,b)=>Math.abs(b.deltaPct)-Math.abs(a.deltaPct));
      result[cat]={ingredients:ingList,avgDelta:ingList.reduce((s,i)=>s+i.deltaPct,0)/ingList.length};
    });
    return result;
  }

  async function fetchAIRecommendations(dashData,restId){
    try{
      setAiLoading(true);
      const res=await fetch('/api/ai-recommendations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({restaurantId:restId})});
      if(!res.ok)throw new Error(`API ${res.status}`);
      const json=await res.json();
      const recs=(json.recommendations||[]).map(r=>({title:r.title,description:r.description,sellCopy:r.talking_point||null,type:r.type,margin:r.margin||null,confidence:r.confidence||null,urgency:r.urgency||null}));
      setData(prev=>({...prev,aiRecommendations:recs}));
    }catch{
      setData(prev=>({...prev,aiRecommendations:[
        {title:"Top Margin Item",description:"Highest margin dish on the menu tonight.",sellCopy:SELL_COPY[0],type:"margin",confidence:80,urgency:"medium"},
        {title:"Fresh Catch Tonight",description:"Recently delivered — push before weekend.",sellCopy:SELL_COPY[1],type:"inventory",confidence:75,urgency:"high"},
        {title:"Guest Favorite",description:"Consistently strong seller this week.",sellCopy:SELL_COPY[2],type:"trending",confidence:70,urgency:"low"},
      ]}));
    }finally{setAiLoading(false);}
  }

  function processDashboardData(invoices,ingredients,menuItems,wasteRisk,priceByCategory){
    const processedInvoices=invoices.filter(i=>i.number&&i.supplier&&i.amount);
    const totalSpending=processedInvoices.reduce((s,i)=>s+parseFloat(i.amount||0),0);
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
    if(itemsWithMargins.length>0){const high=itemsWithMargins.filter(i=>i.margin>=50).length,low=itemsWithMargins.filter(i=>i.margin<25).length;score+=Math.max(0,Math.min(15,((high/itemsWithMargins.length)*15)-((low/itemsWithMargins.length)*8)+5));}
    const thirtyAgo=new Date();thirtyAgo.setDate(thirtyAgo.getDate()-30);
    score+=Math.min((processedInvoices.filter(i=>new Date(i.date||i.created_at)>=thirtyAgo).length/5)*10,10);
    return {score:Math.max(0,Math.min(100,Math.round(score)))};
  }

  // ── MOBILE ──────────────────────────────────────────────────────────────────
  if (isMobile) {
    const circumference=2*Math.PI*40;
    const scoreDash=(data.aiProfitScore.score/100)*circumference;
    const {color:scoreColor,label:scoreLabel}=getScoreInfo(data.aiProfitScore.score);
    return (
      <>
        <style>{GLOBAL_CSS}</style>
        <div className="mob-root">
          <div className="mob-header">
            <div className="mob-logo">Opti<span>Menu</span></div>
            <div style={{display:'flex',alignItems:'center',gap:10}}>
              <div style={{display:'flex',alignItems:'center',gap:4,fontSize:11,color:'var(--accent)'}}>
                <div style={{width:5,height:5,background:'var(--accent)',borderRadius:'50%',animation:'blink 2s infinite'}}/>Active
              </div>
              <ProfileDropdown userName={userName} userEmail={userEmail} isMobile={true}/>
            </div>
          </div>
          <div className="mob-titlebar">
            <div className="mob-page-title">Dashboard</div>
            <div className="mob-page-sub">{new Date().toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})} · {restaurantName}</div>
          </div>
          <div className="mob-stats">
            {[{v:data.totalInvoices,l:'Invoices',c:'var(--accent)'},{v:data.totalIngredients,l:'Ingredients',c:'var(--text-primary)'},{v:data.totalMenuItems,l:'Menu',c:'var(--text-primary)'},{v:`${data.averageMargin.toFixed(1)}%`,l:'Margin',c:getMarginColor(data.averageMargin)},{v:fmt(data.totalSpending),l:'YTD',c:'var(--color-amber)'}].map(({v,l,c})=>(
              <div key={l} className="mob-stat"><div className="mob-stat-v" style={{color:c}}>{v}</div><div className="mob-stat-l">{l}</div></div>
            ))}
          </div>
          {loading?(
            <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:10}}>
              <div style={{width:24,height:24,border:'2px solid var(--border)',borderTopColor:'var(--accent)',borderRadius:'50%',animation:'spin .7s linear infinite'}}/>
              <div style={{fontSize:12,color:'var(--text-muted)'}}>Loading...</div>
            </div>
          ):(
            <div className="mob-content">
              <div className="mob-card">
                <div className="mob-card-title">OptiScore</div>
                <div className="mob-score-row">
                  <div className="mob-score-ring">
                    <svg viewBox="0 0 100 100">
                      <circle cx="50" cy="50" r="40" stroke="var(--ring-track)" strokeWidth="9" fill="none"/>
                      <circle cx="50" cy="50" r="40" stroke={scoreColor} strokeWidth="9" fill="none" strokeDasharray={`${scoreDash} ${circumference}`} strokeLinecap="round"/>
                    </svg>
                    <div className="mob-score-inner"><div className="mob-score-num">{data.aiProfitScore.score}</div><div className="mob-score-sub">/100</div></div>
                  </div>
                  <div>
                    <div style={{fontSize:12,color:'var(--text-muted)',marginBottom:4}}>{restaurantName}</div>
                    <div className="mob-score-badge" style={{background:`color-mix(in srgb, ${scoreColor} 15%, transparent)`,color:scoreColor}}>{scoreLabel}</div>
                  </div>
                </div>
              </div>
              <div className="mob-pill-grid">
                {[{l:'Invoices',v:data.totalInvoices,c:'var(--accent)'},{l:'Low Margin',v:data.lowMarginCount,c:'var(--color-red)'},{l:'Avg Food Cost',v:`${data.averageMargin>0?(100-data.averageMargin).toFixed(1):0}%`,c:'var(--color-green)'},{l:'YTD Spend',v:fmt(data.totalSpending),c:'var(--color-amber)'}].map(({l,v,c})=>(
                  <div key={l} className="mob-pill"><div className="mob-pill-l">{l}</div><div className="mob-pill-v" style={{color:c}}>{v}</div></div>
                ))}
              </div>
              <div className="mob-card">
                <div className="mob-card-title">Tonight's Picks</div>
                {(data.aiRecommendations||[]).slice(0,3).map((rec,i)=>{
                  const {color:tc}=getTicketMeta(i);
                  return (
                    <div key={i} className="mob-ai-item" style={{borderLeftColor:tc}}>
                      <div className="mob-ai-title">{rec.title}</div>
                      <div className="mob-ai-desc">{rec.description}</div>
                      <div className="mob-ai-sell">"{rec.sellCopy||SELL_COPY[i%SELL_COPY.length]}"</div>
                    </div>
                  );
                })}
              </div>
              <div style={{height:8}}/>
            </div>
          )}
          <div className="mob-bottom-nav">
            {[
              {label:'Dashboard',path:'/client/dashboard',icon:<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>},
              {label:'Invoices',path:'/client/invoices',icon:<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>},
              {label:'Ingredients',path:'/client/ingredients',icon:<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 8h1a4 4 0 010 8h-1"/><path d="M3 8h14v9a4 4 0 01-4 4H7a4 4 0 01-4-4V8z"/></svg>},
              {label:'Menu',path:'/client/menu-items',icon:<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>},
              {label:'Analytics',path:'/client/analytics',icon:<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>},
            ].map(({label,path,icon})=>{
              const active=path==='/client/dashboard';
              return (
                <div key={label} className="mob-nav-item" onClick={()=>router.push(path)}>
                  <div className={`mob-nav-icon${active?' active':''}`}>{icon}</div>
                  <div className={`mob-nav-label${active?' active':''}`}>{label}</div>
                  {active&&<div className="mob-nav-dot"/>}
                </div>
              );
            })}
          </div>
        </div>
        <Analytics/><SpeedInsights/>
        {tourProps&&<TourOverlay {...tourProps}/>}
        <TourDataBanner/>
      </>
    );
  }

  // ── DESKTOP ERROR ──────────────────────────────────────────────────────────
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

  // ── DESKTOP ────────────────────────────────────────────────────────────────
  const wasteProteins=data.wasteRisk.filter(w=>w.protein);
  const wasteOther=data.wasteRisk.filter(w=>!w.protein);
  const allWaste=[...wasteProteins,...wasteOther];
  const wasteVisible=wasteShowAll?allWaste:allWaste.slice(0,WASTE_PREVIEW);
  const tabs=['Dashboard','Invoices','Ingredients','Menu Items','Analytics'];
  const wasteAlertCount=data.wasteRisk.length;
  const recCount=(data.aiRecommendations||[]).length;

  return (
    <>
      <style>{GLOBAL_CSS}</style>
      <div className="db-root">

        <div className="db-topbar">
          <div style={{display:'flex',alignItems:'center',gap:'clamp(8px,1vw,16px)'}}>
            <div className="db-logo">Opti<span>Menu</span></div>
            <div style={{display:'flex',gap:2}}>
              {tabs.map(t=>(
                <button key={t} className={`db-tab${t==='Dashboard'?' active':''}`} onClick={()=>{if(t!=='Dashboard')router.push(`/client/${t.toLowerCase().replace(' ','-')}`);}}>{t}</button>
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

        <div className="db-wbar">
          <div style={{display:'flex',alignItems:'baseline'}}>
            <span className="db-wname">Welcome back, {userName}</span>
            <span className="db-wsub">· {new Date().toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})} · {restaurantName}</span>
          </div>
          <div className="db-wactions">
            {recCount>0&&(
              <div className="db-waction-item">
                <div className="db-waction-dot" style={{background:'var(--accent)'}}/>
                <span className="db-waction-val" style={{color:'var(--accent)'}}>{recCount}</span>
                <span>dish{recCount!==1?'es':''} to push</span>
              </div>
            )}
            {wasteAlertCount>0&&(
              <div className="db-waction-item">
                <div className="db-waction-dot" style={{background:'var(--color-red)'}}/>
                <span className="db-waction-val" style={{color:'var(--color-red)'}}>{wasteAlertCount}</span>
                <span>expiring</span>
              </div>
            )}
            <div className="db-waction-item">
              <div className="db-waction-dot" style={{background:getMarginColor(data.averageMargin)}}/>
              <span className="db-waction-val" style={{color:getMarginColor(data.averageMargin)}}>{data.averageMargin.toFixed(1)}%</span>
              <span>avg margin</span>
            </div>
          </div>
        </div>

        <div className="db-main">
          {loading?(
            <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:10}}>
              <div style={{width:22,height:22,border:'2px solid var(--border)',borderTopColor:'var(--accent)',borderRadius:'50%',animation:'spin .7s linear infinite'}}/>
              <div style={{fontSize:'clamp(10px,.78vw,13px)',color:'var(--text-muted)'}}>Loading dashboard...</div>
            </div>
          ):(
            <div className="db-grid-wrap">

              <div style={{
                background:'var(--bg-surface)',
                border:'1px solid var(--border)',
                borderRadius:'clamp(5px,.4vw,8px)',
                padding:'clamp(8px,.7vw,14px)',
                flexShrink:0,
                marginBottom:'clamp(5px,.5vw,9px)',
              }}>
                <div style={{
                  fontSize:'clamp(13px,1.1vw,18px)',
                  fontWeight:700,
                  color:'var(--text-primary)',
                  fontFamily:"'Playfair Display', serif",
                  letterSpacing:'-.2px',
                  marginBottom:'clamp(8px,.7vh,12px)',
                  paddingBottom:'clamp(5px,.5vh,8px)',
                  borderBottom:'1px solid var(--border-subtle)',
                }}>Tonight's Recommendations</div>
                <div className="db-row-top" style={{margin:0}}>
                <div className="db-score-card">
                  <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:'clamp(2px,.22vh,3px)',width:'100%'}}>
                    <div className="db-rest-icon">
                      <svg viewBox="0 0 24 24"><path d="M17 8h1a4 4 0 010 8h-1"/><path d="M3 8h14v9a4 4 0 01-4 4H7a4 4 0 01-4-4V8z"/><line x1="6" y1="2" x2="6" y2="4"/><line x1="10" y1="2" x2="10" y2="4"/><line x1="14" y1="2" x2="14" y2="4"/></svg>
                    </div>
                    <div className="db-rest-name">{restaurantName}</div>
                    <div className="db-rest-sub">Management Dashboard</div>
                  </div>
                  <ScoreRing score={data.aiProfitScore.score}/>
                </div>

                {aiLoading?[0,1,2].map(i=>(
                  <div key={i} className="db-ticket" style={{alignItems:'center',justifyContent:'center',gap:8}}>
                    <div className="db-spinner"/>
                    <div style={{fontSize:'clamp(9px,.62vw,11px)',color:'var(--text-muted)',fontFamily:'Courier New,monospace'}}>Analyzing menu...</div>
                  </div>
                )):(data.aiRecommendations||[]).length>0
                  ?(data.aiRecommendations||[]).slice(0,3).map((rec,i)=>(
                    <ThermalTicket key={i} rec={rec} index={i} menuItems={menuItemsFull} wasteRisk={data.wasteRisk}/>
                  ))
                  :[0,1,2].map(i=>(
                    <div key={i} className="db-ticket" style={{alignItems:'center',justifyContent:'center'}}>
                      <div className="db-empty">No recommendations yet</div>
                    </div>
                  ))
                }
              </div>

              <div style={{display:'grid',gridTemplateColumns:'clamp(148px,12vw,200px) 1fr 1fr 1fr',gap:'clamp(5px,.5vw,9px)',flexShrink:0,margin:'clamp(3px,.3vh,5px) 0'}}>
                <div/>
                <div className="db-section-hd" style={{gridColumn:'2 / 5'}}>Operations</div>
              </div>

              <div className="db-row-bottom">

                <div className="db-stats-card">
                  <div style={{fontSize:'clamp(8px,.58vw,10px)',color:'var(--text-faint)',textTransform:'uppercase',letterSpacing:'0.8px',fontWeight:600,flexShrink:0}}>Key Metrics</div>
                  {[
                    {l:'YTD Spend',       v:fmt(data.totalSpending),                                            c:'var(--color-amber)', sub:`${data.totalInvoices} invoice${data.totalInvoices!==1?'s':''}`},
                    {l:'Avg Margin',      v:`${data.averageMargin.toFixed(1)}%`,                               c:getMarginColor(data.averageMargin), sub:`${(100-data.averageMargin).toFixed(1)}% avg food cost`},
                    {l:'High Margin Items',v:data.highMarginCount||0,                                          c:'var(--color-green)', sub:'Above 60% margin'},
                    {l:'Low Margin Items', v:data.lowMarginCount,                                              c:'var(--color-red)',   sub:data.lowMarginCount>0?`Below ${LOW_MARGIN_THRESHOLD}% threshold`:'All items healthy'},
                    {l:'Menu Items',      v:data.totalMenuItems,                                               c:'var(--accent)',      sub:`${data.menuItemAnalysis?.filter(m=>m.hasCompleteData).length||0} fully costed`},
                    {l:'Ingredients',     v:data.totalIngredients,                                             c:'var(--text-primary)',sub:data.unpricedIngredients>0?`${data.unpricedIngredients} unpriced`:'All priced'},
                    {l:'Waste Alerts',    v:data.wasteRisk.length,                                            c:data.wasteRisk.length>0?'var(--color-red)':'var(--color-green)',sub:data.wasteRisk.length>0?`${wasteProteins.length} protein, ${wasteOther.length} other`:'Nothing expiring soon'},
                  ].map(({l,v,c,sub})=>(
                    <div key={l} className="db-pill" style={{flex:1}}>
                      <div className="db-pill-left"><div className="db-pill-l">{l}</div><div className="db-pill-sub">{sub}</div></div>
                      <div className="db-pill-v" style={{color:c}}>{v}</div>
                    </div>
                  ))}
                </div>

                <WeekInReviewCard restaurantId={restaurantId}/>

                <div className="db-card">
                  <div className="db-card-hd">
                    <div className="db-card-title">
                      <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                      Waste Risk
                    </div>
                    <span className="db-card-sub">{data.wasteRisk.length>0?`${data.wasteRisk.length} at risk`:'All clear'}</span>
                  </div>
                  <div className="db-waste-list">
                    {data.wasteRisk.length===0&&<div className="db-empty">No expiring items detected</div>}
                    {wasteVisible.map((item,i)=><WasteRow key={i} item={item} router={router}/>)}
                  </div>
                  {data.wasteRisk.length>WASTE_PREVIEW&&(
                    <button className="db-waste-view-all" onClick={()=>setWasteShowAll(prev=>!prev)}>
                      {wasteShowAll?'↑ Show fewer':`↓ View all ${data.wasteRisk.length} at risk`}
                    </button>
                  )}
                  {data.wasteRisk.length>0&&(
                    <div className="db-legend-strip">
                      <span><span className="db-legend-dot" style={{background:'var(--color-red)'}}/>Expired / today</span>
                      <span><span className="db-legend-dot" style={{background:'var(--color-amber)'}}/>2 days</span>
                      <span><span className="db-legend-dot" style={{background:'var(--accent)'}}/>3–7 days</span>
                    </div>
                  )}
                </div>

                <PriceMovementCard priceByCategory={data.priceByCategory}/>

              </div>
            </div>
          )
        </div>
        )}
      </div>
      </div>
            <Analytics/><SpeedInsights/>
      {tourProps&&<TourOverlay {...tourProps}/>}
      <TourDataBanner/>
    </>
  );
}