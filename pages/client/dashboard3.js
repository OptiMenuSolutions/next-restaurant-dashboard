// pages/client/dashboard3.js
// "THE PASS" — redesigned dashboard.
// Concept: a kitchen expo pass. Tonight's recommendations are paper tickets
// clipped to a rail across the top of a dark room — the only light objects
// on screen. Everything else is quiet supporting evidence below.
// All data fetching, processing, and state logic preserved verbatim from dashboard.js.
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
function getScoreInfo(score) {
  if (score >= 85) return { color:"var(--color-green)", label:"Excellent" };
  if (score >= 70) return { color:"var(--accent)",      label:"Good" };
  if (score >= 55) return { color:"var(--color-amber)", label:"Fair" };
  return { color:"var(--color-red)", label:"Needs Work" };
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

const SELL_COPY = [
  "Just came in fresh — one of the best things on the menu tonight.",
  "The kitchen is really proud of this one tonight — worth every bite.",
  "Guests have been loving this lately — a great choice tonight.",
  "This one is exceptional right now — highly recommend it.",
  "A personal favorite of the chef tonight — you won't be disappointed.",
  "Incredibly fresh tonight — this is the one to get.",
];

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

// ── NAV ──────────────────────────────────────────────────────────────────────
const NAV_TABS = [
  { label:'Dashboard',   path:'/client/dashboard' },
  { label:'Invoices',    path:'/client/invoices' },
  { label:'Ingredients', path:'/client/ingredients' },
  { label:'Menu Items',  path:'/client/menu-items' },
  { label:'Analytics',   path:'/client/analytics' },
];

// ── CSS ──────────────────────────────────────────────────────────────────────
const GLOBAL_CSS = `
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
  html,body{height:100%;background:var(--bg-root);overflow:hidden;}
  #__next{height:100%;}

  /* receipt paper tokens — the one deliberately hardcoded surface */
  :root{
    --paper:#f6f2e9;
    --paper-shade:#ece6d8;
    --ink:#1c1712;
    --ink-soft:#5d5547;
    --ink-faint:#9b9080;
  }

  @keyframes spin{to{transform:rotate(360deg);}}
  @keyframes blink{0%,100%{opacity:1}50%{opacity:.3}}
  @keyframes fadeIn{from{opacity:0;transform:translateY(4px);}to{opacity:1;transform:translateY(0);}}
  @keyframes printIn{
    from{opacity:0;transform:translateY(-18px) rotate(var(--tilt,0deg));}
    to{opacity:1;transform:translateY(0) rotate(var(--tilt,0deg));}
  }
  @media (prefers-reduced-motion: reduce){
    *,*::before,*::after{animation-duration:.01ms!important;transition-duration:.01ms!important;}
  }
  input::placeholder{color:var(--text-faint)!important;}
  ::-webkit-scrollbar{width:3px;}
  ::-webkit-scrollbar-track{background:transparent;}
  ::-webkit-scrollbar-thumb{background:var(--border);border-radius:2px;}

  .p3-root{font-family:'Inter',sans-serif;background:var(--bg-root);color:var(--text-primary);width:100%;height:100vh;display:flex;flex-direction:column;overflow:hidden;}

  /* ── TOP BAR ── */
  .p3-topbar{height:clamp(40px,4.4vh,50px);flex-shrink:0;display:flex;align-items:center;justify-content:space-between;padding:0 clamp(16px,2vw,32px);border-bottom:1px solid var(--border);background:var(--bg-elevated);}
  .p3-logo{font-family:'Playfair Display',serif;font-size:clamp(15px,1.15vw,20px);letter-spacing:-.3px;color:var(--text-primary);}
  .p3-logo span{color:var(--accent);}
  .p3-tabs{display:flex;gap:2px;}
  .p3-tab{padding:5px 12px;border-radius:6px;font-size:clamp(10px,.78vw,13px);color:var(--text-muted);border:none;background:none;cursor:pointer;font-family:'Inter',sans-serif;transition:color .15s,background .15s;}
  .p3-tab:hover{color:var(--text-secondary);}
  .p3-tab.active{color:var(--text-primary);background:var(--bg-inset);}
  .p3-tab:focus-visible,.p3-ticket:focus-visible,button:focus-visible{outline:2px solid var(--accent);outline-offset:2px;}

  /* ── TOP REGION: glance card + the pass ── */
  .p3-top{flex:5 1 0;min-height:0;display:grid;grid-template-columns:clamp(190px,16vw,250px) 1fr;gap:clamp(12px,1.4vw,22px);padding:clamp(10px,1.2vh,16px) clamp(16px,2vw,32px) 0;overflow:hidden;max-width:1600px;width:100%;margin-left:auto;margin-right:auto;}
  .p3-glance{background:var(--bg-surface);border:1px solid var(--border);border-radius:10px;padding:clamp(10px,1vw,16px);display:flex;flex-direction:column;gap:clamp(6px,.6vh,9px);overflow:hidden;min-height:0;}
  .p3-eyebrow{font-size:clamp(8px,.6vw,10px);font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--text-faint);margin-bottom:3px;}
  .p3-greeting{font-family:'Playfair Display',serif;font-weight:500;font-size:clamp(14px,1.15vw,19px);letter-spacing:-.3px;color:var(--text-primary);line-height:1.2;}
  .p3-greeting em{font-style:italic;color:var(--accent);}
  .p3-glance-rule{border:none;border-top:1px solid var(--border-subtle);margin:clamp(2px,.2vh,4px) 0;flex-shrink:0;}
  .p3-glance-stats{flex:1;min-height:0;display:flex;flex-direction:column;justify-content:space-evenly;gap:2px;overflow:hidden;}
  .p3-stat{display:flex;align-items:baseline;justify-content:space-between;gap:8px;}
  .p3-stat-v{font-family:'Courier New',monospace;font-size:clamp(12px,1vw,16px);font-weight:700;line-height:1;flex-shrink:0;}
  .p3-stat-l{font-size:clamp(8px,.6vw,10px);color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .p3-score{display:flex;align-items:center;gap:9px;flex-shrink:0;padding-top:clamp(4px,.4vh,7px);border-top:1px solid var(--border-subtle);}
  .p3-score-ring{position:relative;width:clamp(34px,3vw,44px);height:clamp(34px,3vw,44px);}
  .p3-score-ring svg{width:100%;height:100%;transform:rotate(-90deg);}
  .p3-score-num{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-family:'Courier New',monospace;font-weight:700;font-size:clamp(10px,.85vw,13px);color:var(--text-primary);}

  /* ── THE PASS (hero) ── */
  .p3-pass{display:flex;flex-direction:column;min-height:0;overflow:hidden;}
  .p3-rail-hd{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:clamp(6px,.7vh,10px);}
  .p3-rail-title{font-size:clamp(9px,.66vw,11px);font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:var(--text-secondary);display:flex;align-items:center;gap:8px;}
  .p3-rail-title::after{content:'';display:block;width:clamp(30px,4vw,60px);height:1px;background:var(--border);}
  .p3-rail-sub{font-size:clamp(8px,.6vw,10px);color:var(--text-faint);}
  /* the rail: a brushed-metal bar with end screws */
  .p3-rail{
    position:relative;height:10px;border-radius:5px;flex-shrink:0;z-index:1;
    background:linear-gradient(to bottom,#8a8378 0%,#b5ada0 18%,#6e675d 55%,#4a443c 100%);
    box-shadow:0 2px 5px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.35),inset 0 -1px 1px rgba(0,0,0,.4);
  }
  .p3-rail::before,.p3-rail::after{ /* mounting screws */
    content:'';position:absolute;top:50%;transform:translateY(-50%);width:6px;height:6px;border-radius:50%;
    background:radial-gradient(circle at 35% 30%,#d8d2c6,#5a544a 70%);
    box-shadow:inset 0 -1px 1px rgba(0,0,0,.6);
  }
  .p3-rail::before{left:7px;}
  .p3-rail::after{right:7px;}
  .p3-tickets{display:grid;grid-template-columns:repeat(3,minmax(180px,430px));gap:clamp(12px,1.6vw,28px);align-items:stretch;min-height:0;flex:1;justify-content:center;}
  .p3-ticket-slot{position:relative;display:flex;flex-direction:column;min-height:0;padding-top:7px;}
  .p3-clip{ /* bulldog clip gripping the rail and the ticket */
    position:absolute;top:-8px;left:50%;transform:translateX(-50%);
    width:clamp(40px,3.4vw,52px);height:17px;border-radius:3px 3px 2px 2px;
    background:linear-gradient(to bottom,#c9c2b4 0%,#9a9285 35%,#6e675d 75%,#565047 100%);
    box-shadow:0 2px 4px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.4);
    z-index:2;
  }
  .p3-clip::after{ /* clip seam */
    content:'';position:absolute;left:5px;right:5px;bottom:4px;height:2px;border-radius:1px;
    background:rgba(0,0,0,.35);box-shadow:0 1px 0 rgba(255,255,255,.18);
  }
  /* flip container: holds the perspective, the tilt, and the print-in animation */
  .p3-flip{
    --tilt:0deg;
    position:relative;flex:1;min-height:0;
    perspective:1200px;
    transform:rotate(var(--tilt));transform-origin:top center;
    animation:printIn .45s cubic-bezier(.25,.8,.35,1) both;
    transition:transform .2s;
  }
  .p3-ticket-slot:nth-child(1) .p3-flip{--tilt:-.5deg;animation-delay:.05s;}
  .p3-ticket-slot:nth-child(2) .p3-flip{--tilt:.35deg;animation-delay:.17s;}
  .p3-ticket-slot:nth-child(3) .p3-flip{--tilt:-.25deg;animation-delay:.29s;}
  .p3-flip:hover{transform:rotate(0deg) translateY(2px);}
  .p3-flip-inner{
    position:absolute;inset:0;
    transform-style:preserve-3d;
    transition:transform .55s cubic-bezier(.35,.1,.25,1);
  }
  .p3-flip.flipped .p3-flip-inner{transform:rotateY(180deg);}
  /* front face: the paper receipt */
  .p3-ticket{
    position:absolute;inset:0;display:flex;flex-direction:column;overflow:hidden;
    backface-visibility:hidden;-webkit-backface-visibility:hidden;
    background:var(--paper);color:var(--ink);
    font-family:'Courier New',monospace;
    border-radius:2px 2px 0 0;
    padding:clamp(9px,1vh,14px) clamp(10px,1.1vw,16px) clamp(12px,1.3vh,18px);
    box-shadow:0 10px 24px -10px rgba(0,0,0,.65),0 2px 4px rgba(0,0,0,.35);
    cursor:pointer;border:none;text-align:left;
  }
  /* back face: the same receipt, flipped over — recipe printed as line items */
  .p3-ticket-back{
    position:absolute;inset:0;display:flex;flex-direction:column;overflow:hidden;
    backface-visibility:hidden;-webkit-backface-visibility:hidden;
    transform:rotateY(180deg);
    background:var(--paper);color:var(--ink);
    font-family:'Courier New',monospace;
    border-radius:2px 2px 0 0;
    padding:clamp(9px,1vh,14px) clamp(10px,1.1vw,16px) clamp(12px,1.3vh,18px);
    box-shadow:0 10px 24px -10px rgba(0,0,0,.65),0 2px 4px rgba(0,0,0,.35);
  }
  .p3-ticket-back::after{ /* perforated bottom edge, same as the front */
    content:'';position:absolute;left:0;right:0;bottom:0;height:7px;
    background-image:linear-gradient(45deg,var(--bg-root) 25%,transparent 25%),linear-gradient(-45deg,var(--bg-root) 25%,transparent 25%);
    background-size:11px 14px;background-position:bottom;background-repeat:repeat-x;
  }
  .p3-rb-flip{background:none;border:none;cursor:pointer;font-family:'Courier New',monospace;font-size:clamp(8px,.58vw,10px);font-weight:700;letter-spacing:.08em;color:var(--ink-soft);padding:0;}
  .p3-rb-flip:hover{color:var(--ink);}
  .p3-rb-title{font-size:clamp(12px,1.05vw,16px);font-weight:700;line-height:1.2;color:var(--ink);flex-shrink:0;}
  .p3-rb-body{flex:1;min-height:0;overflow-y:auto;padding-right:4px;}
  .p3-rb-body::-webkit-scrollbar{width:3px;}
  .p3-rb-body::-webkit-scrollbar-thumb{background:var(--ink-faint);border-radius:2px;}
  .p3-rb-section{font-size:clamp(8px,.6vw,10px);font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-soft);margin:clamp(5px,.5vh,8px) 0 clamp(2px,.25vh,4px);}
  .p3-rb-section:first-child{margin-top:0;}
  .p3-rb-line{display:flex;align-items:baseline;gap:6px;font-size:clamp(9px,.72vw,12px);line-height:1.7;}
  .p3-rb-name{color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .p3-rb-leader{flex:1;min-width:10px;border-bottom:1px dotted var(--ink-faint);transform:translateY(-3px);}
  .p3-rb-qty{color:var(--ink-soft);white-space:nowrap;}
  .p3-rb-line.risk .p3-rb-name,.p3-rb-line.risk .p3-rb-qty{color:var(--color-red);font-weight:700;}
  .p3-rb-risknote{font-size:clamp(7px,.55vw,9px);font-weight:700;letter-spacing:.06em;color:var(--color-red);flex-shrink:0;}
  .p3-rb-empty{font-size:clamp(9px,.7vw,11px);color:var(--ink-soft);line-height:1.5;padding:clamp(8px,.8vh,12px) 0;}
  .p3-rb-footbtn{margin-top:auto;padding:clamp(5px,.5vh,8px) 0 0;font-size:clamp(7px,.52vw,9px);color:var(--ink-faint);text-align:center;letter-spacing:.06em;flex-shrink:0;background:none;border:none;cursor:pointer;font-family:'Courier New',monospace;width:100%;}
  .p3-rb-footbtn:hover{color:var(--ink-soft);}
  .p3-ticket::after{ /* perforated bottom edge */
    content:'';position:absolute;left:0;right:0;bottom:0;height:7px;
    background-image:linear-gradient(45deg,var(--bg-root) 25%,transparent 25%),linear-gradient(-45deg,var(--bg-root) 25%,transparent 25%);
    background-size:11px 14px;background-position:bottom;background-repeat:repeat-x;
  }
  .p3-t-hd{display:flex;justify-content:space-between;align-items:center;margin-bottom:clamp(4px,.4vh,6px);flex-shrink:0;}
  .p3-t-label{font-size:clamp(8px,.62vw,10px);font-weight:700;letter-spacing:.14em;}
  .p3-t-num{font-size:clamp(8px,.58vw,10px);color:var(--ink-faint);}
  .p3-t-rule{border:none;border-top:1px dashed var(--paper-shade);margin:clamp(3px,.35vh,6px) 0;flex-shrink:0;filter:brightness(.85);}
  .p3-t-title{font-size:clamp(13px,1.2vw,19px);font-weight:700;line-height:1.18;color:var(--ink);flex-shrink:0;}
  .p3-t-desc{font-size:clamp(9px,.72vw,12px);line-height:1.45;color:var(--ink-soft);overflow:hidden;}
  .p3-t-quote{font-size:clamp(9px,.74vw,12px);font-style:italic;line-height:1.45;color:var(--ink);padding-left:9px;border-left:2px solid currentColor;overflow:hidden;}
  .p3-t-chips{display:flex;gap:6px;flex-wrap:wrap;flex-shrink:0;}
  .p3-t-chip{font-size:clamp(7px,.55vw,9px);font-weight:700;letter-spacing:.08em;padding:2px 6px;border:1px solid var(--ink-faint);border-radius:2px;color:var(--ink-soft);}
  .p3-t-foot{margin-top:auto;padding-top:clamp(5px,.5vh,8px);font-size:clamp(7px,.52vw,9px);color:var(--ink-faint);text-align:center;letter-spacing:.06em;flex-shrink:0;}

  /* ── SUPPORTING BAND ── */
  .p3-band{flex:4 1 0;min-height:0;display:grid;grid-template-columns:1fr 2.2fr;gap:clamp(10px,1.2vw,18px);padding:clamp(10px,1.2vh,16px) clamp(16px,2vw,32px) clamp(10px,1.2vh,16px);overflow:hidden;max-width:1600px;width:100%;margin-left:auto;margin-right:auto;}
  .p3-card{background:var(--bg-surface);border:1px solid var(--border);border-radius:10px;padding:clamp(10px,1vw,16px);display:flex;flex-direction:column;overflow:hidden;min-height:0;}
  .p3-card-hd{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:clamp(6px,.7vh,10px);flex-shrink:0;}
  .p3-card-title{font-size:clamp(10px,.78vw,13px);font-weight:600;color:var(--text-primary);}
  .p3-card-sub{font-size:clamp(8px,.58vw,10px);color:var(--text-faint);}
  .p3-empty{flex:1;display:flex;align-items:center;justify-content:center;font-size:clamp(10px,.72vw,12px);color:var(--text-muted);text-align:center;padding:8px;}
  .p3-spinner{width:16px;height:16px;border:2px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:spin .7s linear infinite;}
  .p3-link-btn{font-size:clamp(8px,.6vw,10px);color:var(--accent);background:none;border:none;cursor:pointer;font-family:'Inter',sans-serif;padding:0;opacity:.85;}
  .p3-link-btn:hover{opacity:1;}

  /* waste rows */
  .p3-waste-list{flex:1;overflow-y:auto;min-height:0;}
  .p3-waste-row{display:flex;flex-direction:column;gap:4px;padding:clamp(6px,.6vh,9px) 0;border-bottom:1px solid var(--border-subtle);}
  .p3-waste-row:last-child{border-bottom:none;}
  .p3-waste-top{display:flex;align-items:center;gap:7px;}
  .p3-waste-name{flex:1;font-size:clamp(10px,.74vw,12px);color:var(--text-secondary);text-transform:capitalize;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .p3-waste-days{font-family:'Courier New',monospace;font-size:clamp(9px,.64vw,11px);font-weight:700;white-space:nowrap;}
  .p3-bar-track{width:100%;height:3px;background:var(--border-subtle);border-radius:2px;overflow:hidden;}
  .p3-bar-fill{height:100%;border-radius:2px;}
  .p3-waste-meta{display:flex;justify-content:space-between;gap:8px;}
  .p3-waste-meta-txt{font-size:clamp(7px,.54vw,9px);color:var(--text-faint);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .p3-legend{font-size:clamp(7px,.55vw,9px);color:var(--text-faint);display:flex;align-items:center;gap:10px;padding-top:clamp(5px,.5vh,7px);border-top:1px solid var(--border-subtle);margin-top:clamp(4px,.4vh,6px);flex-shrink:0;}
  .p3-dot{width:6px;height:6px;border-radius:50%;display:inline-block;margin-right:3px;}

  /* week in review — totals + month calendar */
  .p3-wk-grid{flex:1;min-height:0;display:grid;grid-template-columns:1fr 1.2fr;gap:clamp(10px,1.1vw,18px);}
  .p3-wk-left{display:flex;flex-direction:column;gap:clamp(5px,.5vh,8px);min-height:0;overflow-y:auto;}
  .p3-wir-stat{background:var(--bg-elevated);border:1px solid var(--border-subtle);border-radius:7px;padding:clamp(6px,.6vh,9px) clamp(8px,.8vw,12px);flex-shrink:0;}
  .p3-wir-stat-l{font-size:clamp(7px,.52vw,9px);color:var(--text-faint);text-transform:uppercase;letter-spacing:.08em;margin-bottom:3px;}
  .p3-wir-stat-v{font-family:'Courier New',monospace;font-size:clamp(14px,1.25vw,19px);font-weight:700;line-height:1;}
  .p3-wir-stat-s{font-size:clamp(7px,.5vw,9px);color:var(--text-faint);margin-top:2px;}
  .p3-cal{display:flex;flex-direction:column;min-height:0;border-left:1px solid var(--border-subtle);padding-left:clamp(10px,1.1vw,18px);}
  .p3-cal-hd{display:flex;align-items:center;justify-content:space-between;gap:6px;font-family:'Courier New',monospace;font-size:clamp(10px,.78vw,13px);font-weight:700;color:var(--text-secondary);letter-spacing:.08em;margin-bottom:clamp(4px,.4vh,7px);flex-shrink:0;}
  .p3-cal-nav{width:20px;height:20px;display:flex;align-items:center;justify-content:center;background:var(--bg-elevated);border:1px solid var(--border-subtle);border-radius:5px;color:var(--text-muted);font-size:13px;line-height:1;cursor:pointer;transition:color .15s,border-color .15s;flex-shrink:0;padding:0;}
  .p3-cal-nav:hover:not(:disabled){color:var(--accent);border-color:var(--text-faint);}
  .p3-cal-nav:disabled{opacity:.3;cursor:default;}
  .p3-cal-dow{display:grid;grid-template-columns:repeat(7,1fr);gap:2px;flex-shrink:0;margin-bottom:2px;}
  .p3-cal-dow span{font-size:clamp(7px,.55vw,9px);font-weight:600;color:var(--text-faint);text-align:center;text-transform:uppercase;letter-spacing:.06em;}
  .p3-cal-days{flex:1;min-height:0;display:grid;grid-template-columns:repeat(7,1fr);grid-auto-rows:1fr;gap:2px;}
  .p3-cal-day{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;border:1px solid transparent;border-radius:6px;background:none;cursor:default;font-family:'Inter',sans-serif;min-width:0;min-height:0;padding:1px;}
  .p3-cal-num{font-size:clamp(9px,.7vw,12px);color:var(--text-faint);line-height:1;}
  .p3-cal-sub{font-family:'Courier New',monospace;font-size:clamp(7px,.55vw,9px);font-weight:700;line-height:1;}
  .p3-cal-day.has-data{cursor:pointer;background:var(--bg-elevated);border-color:var(--border-subtle);transition:border-color .15s,background .15s;}
  .p3-cal-day.has-data .p3-cal-num{color:var(--text-primary);font-weight:600;}
  .p3-cal-day.has-data:hover{border-color:var(--text-faint);}
  .p3-cal-day.past{cursor:pointer;}
  .p3-cal-day.past .p3-cal-num{color:var(--text-muted);}
  .p3-cal-day.past:hover{background:var(--bg-elevated);border-color:var(--border-subtle);}
  .p3-cal-day.active{background:var(--accent);border-color:var(--accent);}
  .p3-cal-day.active .p3-cal-num,.p3-cal-day.active .p3-cal-sub{color:#0a0908;}
  .p3-cal-day.today::after{content:'';position:absolute;bottom:2px;width:3px;height:3px;border-radius:50%;background:var(--accent);}
  .p3-cal-day.today.active::after{background:#0a0908;}
  .p3-cal-legend{font-size:clamp(7px,.52vw,9px);color:var(--text-faint);text-align:center;padding-top:clamp(4px,.4vh,6px);flex-shrink:0;}
`;

// ── TICKET ───────────────────────────────────────────────────────────────────
function PassTicket({ rec, index, isSelected, onClick, menuItems, wasteRisk, daysOnOptiMenu, restaurantName }) {
  const { label, color } = getTicketMeta(index);
  const sellCopy = rec.sellCopy || rec.talking_point || SELL_COPY[index % SELL_COPY.length];
  const marginVal = rec.margin !== null && rec.margin !== undefined && !isNaN(parseFloat(rec.margin)) ? parseFloat(rec.margin) : null;
  const ticketNum = `#${String(daysOnOptiMenu||1).padStart(3,'0')}-0${index+1}`;
  const timeStr = new Date().toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true});

  // recipe = the matching menu item's components + ingredients, receipt-ready
  const recipe = useMemo(() => {
    const key = (rec.title || '').toLowerCase().trim();
    if (!key) return null;
    const item = (menuItems || []).find(m => (m.name || '').toLowerCase().trim() === key)
              || (menuItems || []).find(m => (m.name || '').toLowerCase().includes(key));
    if (!item || !(item.menu_item_components || []).length) return null;
    return item.menu_item_components.map(c => ({
      name: c.name,
      ings: (c.component_ingredients || []).map(ci => ({
        name: (ci.ingredients?.name || '').trim(),
        qty: [ci.quantity, ci.unit].filter(Boolean).join(' '),
      })).filter(i => i.name),
    }));
  }, [rec.title, menuItems]);

  const riskSet = useMemo(() => new Set((wasteRisk || []).map(w => (w.name || '').toLowerCase().trim())), [wasteRisk]);
  const hasRisk = !!recipe && recipe.some(c => c.ings.some(i => riskSet.has(i.name.toLowerCase())));

  return (
    <div className="p3-ticket-slot">
      <div className="p3-clip"/>
      <div className={`p3-flip${isSelected ? ' flipped' : ''}`}>
        <div className="p3-flip-inner">

          {/* FRONT: the receipt */}
          <button
            type="button"
            className="p3-ticket"
            onClick={onClick}
            aria-expanded={isSelected}
            tabIndex={isSelected ? -1 : 0}
          >
            <div style={{textAlign:'center',flexShrink:0,marginBottom:'clamp(4px,.4vh,7px)'}}>
              <div style={{fontSize:'clamp(9px,.72vw,12px)',fontWeight:700,letterSpacing:'.04em',color:'var(--ink)',lineHeight:1.3}}>{restaurantName}</div>
              <div style={{fontSize:'clamp(8px,.6vw,10px)',color:'var(--ink-soft)',letterSpacing:'.06em',lineHeight:1.4}}>*** Food ***</div>
              <div style={{fontSize:'clamp(8px,.62vw,10px)',fontWeight:700,letterSpacing:'.12em',color,lineHeight:1.4}}>{label}</div>
            </div>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',flexShrink:0}}>
              <span style={{fontSize:'clamp(9px,.7vw,11px)',fontWeight:700,color:'var(--ink)'}}>{ticketNum}</span>
              <span style={{fontSize:'clamp(8px,.62vw,10px)',color:'var(--ink-soft)'}}>{timeStr}</span>
            </div>
            <hr className="p3-t-rule"/>
            <div style={{fontSize:'clamp(9px,.7vw,11px)',fontWeight:700,letterSpacing:'.1em',color,flexShrink:0}}>{label}</div>
            <hr className="p3-t-rule"/>
            <div style={{fontSize:'clamp(12px,.95vw,16px)',fontWeight:700,color:'var(--ink)',flexShrink:0,lineHeight:1.2}}>{rec.title||'—'}</div>
            <hr className="p3-t-rule"/>
            <div style={{textAlign:'center',fontSize:'clamp(8px,.6vw,10px)',color:'var(--ink-soft)',flexShrink:0,marginBottom:'clamp(3px,.3vh,4px)'}}>--- Tonight's Pitch ---</div>
            <div style={{flex:1,overflow:'hidden'}}>
              <div style={{fontSize:'clamp(9px,.72vw,12px)',lineHeight:1.5,color,fontStyle:'italic'}}>{sellCopy}</div>
              {rec.description&&<div style={{fontSize:'clamp(8px,.64vw,11px)',lineHeight:1.4,color:'var(--ink-soft)',marginTop:'clamp(3px,.3vh,5px)'}}>{rec.description}</div>}
            </div>
            {(marginVal!==null||rec.urgency)&&(
              <>
                <hr className="p3-t-rule"/>
                <div className="p3-t-chips">
                  {marginVal!==null&&<span className="p3-t-chip">MARGIN {marginVal.toFixed(0)}%</span>}
                  {rec.urgency&&<span className="p3-t-chip" style={{color,borderColor:color}}>{String(rec.urgency).toUpperCase()}</span>}
                </div>
              </>
            )}
            <div className="p3-t-foot">· · ·  FLIP FOR RECIPE  · · ·</div>
          </button>

          {/* BACK: the same receipt flipped over — recipe as printed line items */}
          <div className="p3-ticket-back" aria-hidden={!isSelected}>
            <div className="p3-t-hd">
              <span className="p3-t-label" style={{color}}>RECIPE · {ticketNum}</span>
              <button type="button" className="p3-rb-flip" tabIndex={isSelected ? 0 : -1} onClick={onClick}>↻ FLIP BACK</button>
            </div>
            <hr className="p3-t-rule"/>
            <div className="p3-rb-title">{rec.title || '—'}</div>
            <hr className="p3-t-rule"/>
            <div className="p3-rb-body">
              {!recipe ? (
                <div className="p3-rb-empty">No recipe on file for this dish yet — add its components in Menu Items and it will print here.</div>
              ) : recipe.map((comp, ci) => (
                <div key={ci} style={{marginBottom:'clamp(6px,.6vh,10px)'}}>
                  {comp.name && (
                    <div style={{fontSize:'clamp(10px,.8vw,13px)',fontWeight:700,color:'var(--ink)',letterSpacing:'.01em',lineHeight:1.2,marginBottom:'clamp(2px,.25vh,4px)'}}>{comp.name}</div>
                  )}
                  {comp.ings.map((ing, ii) => {
                    const risk = riskSet.has(ing.name.toLowerCase());
                    const ingColor = risk ? 'var(--color-red)' : color;
                    return (
                      <div key={ii} style={{paddingLeft:'clamp(10px,1vw,14px)',marginBottom:'clamp(2px,.2vh,3px)'}}>
                        <div style={{fontSize:'clamp(9px,.72vw,11px)',color:ingColor,fontWeight:risk?700:400,lineHeight:1.3}}>
                          {risk?'▲ ':''}{ing.name}
                        </div>
                        {ing.qty&&(
                          <div style={{paddingLeft:'clamp(8px,.8vw,10px)',fontSize:'clamp(8px,.62vw,10px)',color:ingColor,lineHeight:1.2,fontStyle:'italic'}}>
                            {ing.qty}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
            {hasRisk && (
              <>
                <hr className="p3-t-rule"/>
                <div className="p3-rb-risknote">▲ AT RISK TONIGHT — SELLING THIS CLEARS THEM</div>
              </>
            )}
            <button type="button" className="p3-rb-footbtn" tabIndex={isSelected ? 0 : -1} onClick={onClick}>· · ·  TAP TO FLIP BACK  · · ·</button>
          </div>

        </div>
      </div>
    </div>
  );
}

// ── WASTE ROW ────────────────────────────────────────────────────────────────
function WasteRow({ item, router }) {
  const daysLeft = item.daysLeft;
  const isExpired = daysLeft < 0;
  const urgencyColor = isExpired ? 'var(--color-red)' : getWasteUrgencyColor(daysLeft);
  const consumed = isExpired ? 100 : Math.min(100,Math.max(0,((item.shelfLife-daysLeft)/item.shelfLife)*100));
  const label = isExpired ? `Expired ${Math.abs(daysLeft)}d ago` : daysLeft===0 ? 'Use today' : daysLeft===1 ? '1 day left' : `${daysLeft} days left`;
  const qtyText = item.remainingQty>0 ? `~${item.remainingQty.toFixed(1)} ${item.unit||'units'} remaining` : item.invoicedQty>0 ? `${item.invoicedQty.toFixed(1)} ${item.unit||'units'} invoiced` : 'Qty unknown';
  return (
    <div className="p3-waste-row">
      <div className="p3-waste-top">
        <span className="p3-dot" style={{background:urgencyColor,flexShrink:0}}/>
        <div className="p3-waste-name">{item.name}</div>
        <div className="p3-waste-days" style={{color:urgencyColor}}>{label}</div>
      </div>
      <div className="p3-bar-track"><div className="p3-bar-fill" style={{width:`${consumed}%`,background:urgencyColor,opacity:.7}}/></div>
      <div className="p3-waste-meta">
        <span className="p3-waste-meta-txt">{qtyText} · Delivered {formatDate(item.deliveryDate)}</span>
        {item.invoiceId && <button className="p3-link-btn" onClick={() => router.push(`/client/invoices?selected=${encodeURIComponent(item.invoiceId)}`)}>Invoice →</button>}
      </div>
    </div>
  );
}

// ── WEEK IN REVIEW ───────────────────────────────────────────────────────────
function WeekInReviewCard({ restaurantId, wasteRisk, menuItems }) {
  const [openDay, setOpenDay] = useState(null);
  const [monthOffset, setMonthOffset] = useState(0);

  // visible month, anchored to the real current month; forward navigation stops there
  const now = new Date();
  const shown = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
  const year = shown.getFullYear(), month = shown.getMonth();
  const mm = String(month+1).padStart(2,'0');
  const monthLabel = shown.toLocaleDateString('en-US',{month:'long',year:'numeric'});
  const atCurrentMonth = monthOffset >= 0;
  const daysInMonth = new Date(year, month+1, 0).getDate();
  const monthStart = `${year}-${mm}-01`;
  const monthEnd   = `${year}-${mm}-${String(daysInMonth).padStart(2,'0')}`;

  // the hook fetches the visible month + the trailing 7 days (for the summary tiles),
  // and refetches whenever the month changes
  const { weekData, weekExtraSold, weekWasteSaved, hitRate, loading } = useWeekInReview(restaurantId, wasteRisk, menuItems, monthStart, monthEnd);
  const openDayData = weekData.find(d => d.date === openDay);
  const dataByDate = useMemo(() => Object.fromEntries(weekData.map(d => [d.date, d])), [weekData]);

  const firstDow = (new Date(year, month, 1).getDay() + 6) % 7; // Monday-first, like a service week
  const todayKey = new Date().toISOString().split('T')[0];
  const cells = [];
  for (let i=0;i<firstDow;i++) cells.push(null);
  for (let d=1;d<=daysInMonth;d++) {
    const key = `${year}-${mm}-${String(d).padStart(2,'0')}`;
    cells.push({ d, key, data: dataByDate[key], clickable: key <= todayKey });
  }

  if (loading && weekData.length === 0) return <div className="p3-empty"><div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:8}}><div className="p3-spinner"/><span>Loading...</span></div></div>;
  if (!loading && weekData.length === 0) return <div className="p3-empty">No weekly data yet — results appear here once Tonight's Dish runs</div>;

  return (
    <div className="p3-wk-grid">

      {/* LEFT: week totals by default, the selected night's dishes when a date is picked */}
      <div className="p3-wk-left">
        {!openDay ? (
          <>
            <div className="p3-wir-stat">
              <div className="p3-wir-stat-l">Extra sold</div>
              <div className="p3-wir-stat-v" style={{color:weekExtraSold>=0?'var(--color-green)':'var(--color-red)'}}>{weekExtraSold>=0?'+':''}{weekExtraSold}</div>
              <div className="p3-wir-stat-s">vs. avg, last 7 nights</div>
            </div>
            <div className="p3-wir-stat">
              <div className="p3-wir-stat-l">Waste saved</div>
              <div className="p3-wir-stat-v" style={{color:'var(--color-green)'}}>${weekWasteSaved}</div>
              <div className="p3-wir-stat-s">estimated</div>
            </div>
            <div className="p3-wir-stat">
              <div className="p3-wir-stat-l">Hit rate</div>
              <div className="p3-wir-stat-v" style={{color:'var(--accent)'}}>{hitRate}%</div>
              <div className="p3-wir-stat-s">days above avg</div>
            </div>
          </>
        ) : !openDayData ? (
          <>
            <div style={{fontSize:'clamp(10px,.74vw,12px)',fontWeight:600,color:'var(--text-secondary)',flexShrink:0}}>
              {new Date(`${openDay}T12:00:00`).toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})}
            </div>
            <div style={{fontSize:'clamp(9px,.68vw,11px)',color:'var(--text-muted)',lineHeight:1.5,padding:'8px 0'}}>
              No Tonight's Dish data recorded for this night.
            </div>
            <button className="p3-link-btn" style={{flexShrink:0,textAlign:'left'}} onClick={() => setOpenDay(null)}>← Back to week totals</button>
          </>
        ) : (
          <>
            <div style={{display:'flex',alignItems:'center',gap:8,flexShrink:0}}>
              <div style={{fontSize:'clamp(10px,.74vw,12px)',fontWeight:600,color:'var(--text-secondary)'}}>{openDayData.dayLabel} · {openDayData.date.slice(5).replace('-','/')}</div>
              <div style={{marginLeft:'auto',fontSize:'clamp(8px,.6vw,10px)',color:'var(--text-faint)'}}>Saved <span style={{color:'var(--color-green)',fontWeight:600}}>${openDayData.wasteSaved}</span></div>
            </div>
            {openDayData.dishes.length===0 && (
              <div style={{fontSize:'clamp(9px,.68vw,11px)',color:'var(--text-muted)',textAlign:'center',padding:'14px 0'}}>No recommendations recorded for this night.</div>
            )}
            {openDayData.dishes.map((dish,i) => {
              const diff = dish.diff;
              const diffColor = diff!==null?(diff>0?'var(--color-green)':diff<0?'var(--color-red)':'var(--text-muted)'):'var(--text-muted)';
              const maxBar = Math.max(dish.sold, dish.avg||0, 1);
              return (
                <div key={i} style={{background:'var(--bg-elevated)',border:'1px solid var(--border-subtle)',borderRadius:8,padding:'clamp(6px,.6vh,9px) clamp(8px,.8vw,12px)',minWidth:0,flexShrink:0}}>
                  <div style={{display:'flex',alignItems:'baseline',justifyContent:'space-between',gap:8,marginBottom:'clamp(4px,.4vh,6px)'}}>
                    <div style={{minWidth:0,display:'flex',alignItems:'baseline',gap:6}}>
                      <span style={{fontSize:'clamp(7px,.55vw,9px)',fontWeight:700,color:dish.ticketColor,textTransform:'uppercase',letterSpacing:'.08em',flexShrink:0}}>{i===0?'Push':i===1?'Rec':'Mention'}</span>
                      <span style={{fontSize:'clamp(10px,.76vw,12px)',fontWeight:600,color:'var(--text-secondary)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{dish.name}</span>
                    </div>
                    <span style={{fontFamily:'Courier New,monospace',fontSize:'clamp(9px,.7vw,11px)',fontWeight:700,color:diffColor,whiteSpace:'nowrap'}}>{diff!==null?`${diff>0?'+':''}${diff.toFixed(1)}`:'—'}</span>
                  </div>
                  <div style={{display:'flex',flexDirection:'column',gap:3}}>
                    <div style={{display:'flex',alignItems:'center',gap:7}}>
                      <span style={{fontSize:'clamp(7px,.52vw,9px)',color:'var(--text-faint)',width:24,flexShrink:0}}>Sold</span>
                      <div className="p3-bar-track" style={{height:4}}><div className="p3-bar-fill" style={{width:`${(dish.sold/maxBar)*100}%`,background:'var(--accent)'}}/></div>
                      <span style={{fontFamily:'Courier New,monospace',fontSize:'clamp(8px,.6vw,10px)',fontWeight:700,color:'var(--accent)',width:22,textAlign:'right',flexShrink:0}}>{dish.sold}</span>
                    </div>
                    {dish.avg!==null && (
                      <div style={{display:'flex',alignItems:'center',gap:7}}>
                        <span style={{fontSize:'clamp(7px,.52vw,9px)',color:'var(--text-faint)',width:24,flexShrink:0}}>Avg</span>
                        <div className="p3-bar-track" style={{height:4}}><div className="p3-bar-fill" style={{width:`${(dish.avg/maxBar)*100}%`,background:'var(--border)'}}/></div>
                        <span style={{fontFamily:'Courier New,monospace',fontSize:'clamp(8px,.6vw,10px)',fontWeight:700,color:'var(--text-faint)',width:22,textAlign:'right',flexShrink:0}}>{dish.avg.toFixed(1)}</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            <button className="p3-link-btn" style={{flexShrink:0,textAlign:'left'}} onClick={() => setOpenDay(null)}>← Back to week totals</button>
          </>
        )}
      </div>

      {/* RIGHT: month calendar — nights with data light up */}
      <div className="p3-cal">
        <div className="p3-cal-hd">
          <button type="button" className="p3-cal-nav" onClick={() => setMonthOffset(o => o - 1)} aria-label="Previous month">‹</button>
          <span style={{display:'flex',alignItems:'center',gap:6}}>{monthLabel}{loading && <span className="p3-spinner" style={{display:'inline-block',width:9,height:9,borderWidth:1.5}}/>}</span>
          <button type="button" className="p3-cal-nav" disabled={atCurrentMonth} onClick={() => setMonthOffset(o => o + 1)} aria-label="Next month">›</button>
        </div>
        <div className="p3-cal-dow">{['Mo','Tu','We','Th','Fr','Sa','Su'].map(d=><span key={d}>{d}</span>)}</div>
        <div className="p3-cal-days">
          {cells.map((c,i) => c===null ? <span key={`b${i}`}/> : (
            <button
              key={c.key}
              type="button"
              disabled={!c.clickable}
              className={`p3-cal-day${c.data?' has-data':c.clickable?' past':''}${openDay===c.key?' active':''}${c.key===todayKey?' today':''}`}
              onClick={() => c.clickable && setOpenDay(prev => prev === c.key ? null : c.key)}
              aria-pressed={openDay===c.key}
            >
              <span className="p3-cal-num">{c.d}</span>
              {c.data && (
                <span className="p3-cal-sub" style={openDay===c.key?undefined:{color:c.data.extraSold>0?'var(--color-green)':c.data.extraSold<0?'var(--color-red)':'var(--text-faint)'}}>
                  {c.data.extraSold>0?'+':''}{c.data.extraSold}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="p3-cal-legend">Highlighted nights have Tonight's Dish data — tap one to drill in</div>
      </div>

    </div>
  );
}

// ── MOBILE: WEEK IN REVIEW ───────────────────────────────────────────────────
function MobileWeekInReview({ restaurantId, wasteRisk, menuItems }) {
  const { weekData, weekExtraSold, weekWasteSaved, hitRate, loading } = useWeekInReview(restaurantId, wasteRisk, menuItems);
  const [openDay, setOpenDay] = useState(null);
  const openDayData = weekData.find(d => d.date === openDay);

  if (loading) return (
    <div style={{padding:'20px',textAlign:'center'}}><div className="p3-spinner" style={{margin:'0 auto'}}/></div>
  );

  return (
    <div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,marginBottom:12}}>
        {[
          {l:'Extra Sold',v:`${weekExtraSold>=0?'+':''}${weekExtraSold}`,c:weekExtraSold>=0?'var(--color-green)':'var(--color-red)',sub:'vs avg'},
          {l:'Waste Saved',v:`$${weekWasteSaved}`,c:'var(--color-green)',sub:'est.'},
          {l:'Hit Rate',v:`${hitRate}%`,c:'var(--accent)',sub:'days above avg'},
        ].map(({l,v,c,sub})=>(
          <div key={l} style={{background:'var(--bg-elevated)',border:'1px solid var(--border-subtle)',borderRadius:8,padding:'10px 8px'}}>
            <div style={{fontSize:9,color:'var(--text-faint)',textTransform:'uppercase',letterSpacing:.6,marginBottom:4}}>{l}</div>
            <div style={{fontFamily:'Courier New,monospace',fontSize:17,fontWeight:700,color:c,lineHeight:1}}>{v}</div>
            <div style={{fontSize:9,color:'var(--text-faint)',marginTop:3}}>{sub}</div>
          </div>
        ))}
      </div>
      {weekData.map(day => {
        const isOpen = openDay === day.date;
        const extraColor = day.extraSold>0?'var(--color-green)':day.extraSold<0?'var(--color-red)':'var(--text-faint)';
        return (
          <div key={day.date} style={{background:'var(--bg-elevated)',border:`1px solid ${isOpen?'var(--accent)':'var(--border-subtle)'}`,borderRadius:8,marginBottom:8,overflow:'hidden',transition:'border-color .15s'}}>
            <div style={{display:'flex',alignItems:'center',gap:8,padding:'10px 12px',cursor:'pointer'}} onClick={()=>setOpenDay(prev=>prev===day.date?null:day.date)}>
              <span style={{fontSize:11,fontWeight:600,color:'var(--text-primary)',width:28,flexShrink:0}}>{day.dayLabel}</span>
              <span style={{fontSize:10,color:'var(--text-faint)',width:32,flexShrink:0}}>{day.date.slice(5).replace('-','/')}</span>
              <div style={{flex:1,display:'flex',gap:4,overflow:'hidden'}}>
                {day.dishes.length>0?day.dishes.map((d,i)=>(
                  <span key={i} style={{fontSize:9,fontWeight:600,padding:'2px 6px',borderRadius:3,background:`color-mix(in srgb, ${d.ticketColor} 12%, transparent)`,color:d.ticketColor,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',maxWidth:80}}>{d.name.split(' ').slice(0,2).join(' ')}</span>
                )):<span style={{fontSize:9,color:'var(--text-faint)'}}>No recs</span>}
              </div>
              <span style={{fontFamily:'Courier New,monospace',fontSize:12,fontWeight:700,color:extraColor,flexShrink:0}}>{day.extraSold>0?'+':''}{day.extraSold}</span>
              <span style={{fontSize:9,color:'var(--text-faint)',flexShrink:0}}>{isOpen?'▴':'▾'}</span>
            </div>
            {isOpen && openDayData && (
              <div style={{padding:'0 12px 12px',borderTop:'1px solid var(--border-subtle)'}}>
                <div style={{fontSize:9,fontWeight:600,color:'var(--text-faint)',textTransform:'uppercase',letterSpacing:.7,margin:'10px 0 8px'}}>Dish Performance</div>
                {openDayData.dishes.length===0 && <div style={{fontSize:11,color:'var(--text-muted)'}}>No recommendations for this day.</div>}
                {openDayData.dishes.map((dish,i) => {
                  const diff=dish.diff;
                  const diffColor=diff!==null?(diff>0?'var(--color-green)':diff<0?'var(--color-red)':'var(--text-muted)'):'var(--text-muted)';
                  const maxBar=Math.max(dish.sold,dish.avg||0,1);
                  return (
                    <div key={i} style={{marginBottom:12}}>
                      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:4}}>
                        <div style={{display:'flex',alignItems:'center',gap:6}}>
                          <span style={{fontSize:9,fontWeight:600,color:dish.ticketColor,textTransform:'uppercase'}}>{i===0?'Push':i===1?'Rec':'Mention'}</span>
                          <span style={{fontSize:12,fontWeight:600,color:'var(--text-primary)'}}>{dish.name}</span>
                        </div>
                        <span style={{fontSize:11,fontWeight:700,color:diffColor}}>{diff!==null?`${diff>0?'+':''}${diff.toFixed(1)}`:'—'}</span>
                      </div>
                      <div style={{display:'flex',flexDirection:'column',gap:3}}>
                        <div style={{display:'flex',alignItems:'center',gap:6}}>
                          <span style={{fontSize:9,color:'var(--text-faint)',width:24,flexShrink:0}}>Sold</span>
                          <div style={{flex:1,height:4,background:'var(--border-subtle)',borderRadius:2,overflow:'hidden'}}><div style={{width:`${(dish.sold/maxBar)*100}%`,height:'100%',background:'var(--accent)',borderRadius:2}}/></div>
                          <span style={{fontSize:9,fontWeight:600,color:'var(--accent)',width:20,textAlign:'right'}}>{dish.sold}</span>
                        </div>
                        {dish.avg!==null&&(
                          <div style={{display:'flex',alignItems:'center',gap:6}}>
                            <span style={{fontSize:9,color:'var(--text-faint)',width:24,flexShrink:0}}>Avg</span>
                            <div style={{flex:1,height:4,background:'var(--border-subtle)',borderRadius:2,overflow:'hidden'}}><div style={{width:`${(dish.avg/maxBar)*100}%`,height:'100%',background:'var(--border)',borderRadius:2}}/></div>
                            <span style={{fontSize:9,fontWeight:600,color:'var(--text-faint)',width:20,textAlign:'right'}}>{dish.avg.toFixed(1)}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
                <div style={{display:'flex',justifyContent:'space-between',paddingTop:8,borderTop:'1px solid var(--border-subtle)'}}>
                  <span style={{fontSize:10,color:'var(--text-faint)'}}>Est. waste prevented</span>
                  <span style={{fontSize:10,fontWeight:600,color:'var(--color-green)'}}>${openDayData.wasteSaved}</span>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── MOBILE: PRICE MOVEMENT ───────────────────────────────────────────────────
function MobilePriceMovement({ priceByCategory }) {
  const [selectedCat, setSelectedCat] = useState(null);
  const categories = useMemo(() => Object.keys(priceByCategory).sort(), [priceByCategory]);
  const categoryAvgHistories = useMemo(() => {
    const result = {};
    categories.forEach(cat => {
      const d = priceByCategory[cat];
      const maxLen = Math.max(...d.ingredients.map(i => i.history.length));
      result[cat] = Array.from({ length: maxLen }, (_, idx) => {
        const vals = d.ingredients.map(i => i.history[idx] ?? i.history[i.history.length - 1]).filter(Boolean);
        return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
      });
    });
    return result;
  }, [priceByCategory, categories]);
  const [globalMin, globalMax] = useMemo(() => {
    let min=Infinity, max=-Infinity;
    Object.values(priceByCategory).forEach(cat => cat.ingredients.forEach(ing => ing.history.forEach(p => { if(p<min)min=p; if(p>max)max=p; })));
    return min===Infinity ? [0,1] : [min,max];
  }, [priceByCategory]);
  const catData = selectedCat ? priceByCategory[selectedCat] : null;
  return (
    <div>
      {selectedCat && (
        <button className="p3-link-btn" onClick={()=>setSelectedCat(null)} style={{fontSize:12,padding:'0 0 10px',display:'flex',alignItems:'center',gap:4}}>← Back</button>
      )}
      {categories.length===0 && <div style={{fontSize:12,color:'var(--text-muted)',textAlign:'center',padding:16}}>No price history yet</div>}
      {!selectedCat && categories.map(cat => {
        const d=priceByCategory[cat], isUp=d.avgDelta>0, deltaColor=isUp?'var(--color-red)':'var(--color-green)';
        const avgHistory = categoryAvgHistories[cat];
        return (
          <div key={cat} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 12px',background:'var(--bg-elevated)',border:'1px solid var(--border-subtle)',borderRadius:8,marginBottom:8,cursor:'pointer'}} onClick={()=>setSelectedCat(cat)}>
            <div style={{flex:1,fontSize:12,color:'var(--text-secondary)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{cat||'Uncategorized'}</div>
            {avgHistory.length>=2&&<Sparkline points={avgHistory} color={deltaColor} globalMin={globalMin} globalMax={globalMax} width={50} height={18}/>}
            <div style={{fontSize:12,fontWeight:600,color:deltaColor,whiteSpace:'nowrap'}}>{isUp?'↑':'↓'} {Math.abs(d.avgDelta).toFixed(1)}%</div>
            <div style={{fontSize:10,color:'var(--text-muted)',whiteSpace:'nowrap'}}>{d.ingredients.length} items</div>
            <span style={{fontSize:10,color:'var(--text-faint)'}}>›</span>
          </div>
        );
      })}
      {selectedCat && catData && catData.ingredients.map((ing,i) => {
        const isUp=ing.deltaPct>0, deltaColor=isUp?'var(--color-red)':'var(--color-green)';
        return (
          <div key={i} style={{padding:'10px 12px',background:'var(--bg-elevated)',border:'1px solid var(--border-subtle)',borderRadius:8,marginBottom:8}}>
            <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}>
              <div style={{flex:1,fontSize:12,color:'var(--text-secondary)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',textTransform:'capitalize'}}>{ing.name}</div>
              {ing.history.length>=2&&<Sparkline points={ing.history} color={deltaColor} globalMin={globalMin} globalMax={globalMax} width={50} height={18}/>}
              <div style={{fontSize:12,fontWeight:600,color:deltaColor}}>{isUp?'↑':'↓'} {Math.abs(ing.deltaPct).toFixed(1)}%</div>
            </div>
            <div style={{fontSize:10,color:'var(--text-muted)'}}>{fmtD(ing.firstPrice)} → {fmtD(ing.lastPrice)}</div>
          </div>
        );
      })}
    </div>
  );
}

// ── MAIN EXPORT ───────────────────────────────────────────────────────────────
export default function ClientDashboard3() {
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
  const [mobTab, setMobTab]             = useState('tonight');
  const [selectedRec, setSelectedRec]   = useState(null);
  const [daysOnOptiMenu, setDaysOnOptiMenu] = useState(1);
  const [data, setData] = useState({
    totalInvoices:0,totalIngredients:0,totalMenuItems:0,
    ingredientTrends:[],menuItemAnalysis:[],
    unpricedIngredients:0,averageMargin:0,
    totalSpending:0,aiProfitScore:{score:0},aiRecommendations:[],
    lowMarginCount:0,highMarginCount:0,wasteRisk:[],priceByCategory:{},
  });
  const LOW_MARGIN_THRESHOLD = 60;
  const WASTE_PREVIEW = 4;

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
      const {data:rd}=await supabase.from("restaurants").select("name,created_at").eq("id",profile.restaurant_id).single();
      setRestaurantName(rd?.name||"Your Restaurant");
      if(rd?.created_at){const d=Math.max(1,Math.floor((Date.now()-new Date(rd.created_at).getTime())/(1000*60*60*24)));setDaysOnOptiMenu(d);}
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
      const price=parseFloat(item.price||0);
      const cost=parseFloat(item.cost||0);
      const margin=price>0&&cost>0?((price-cost)/price)*100:0;
      return {id:item.id,name:item.name,price,cost,margin,hasCompleteData:price>0&&cost>0};
    });
    const itemsWithMargins=menuItemAnalysis.filter(i=>i.price>0&&i.cost>0);
    const averageMargin=itemsWithMargins.length>0?itemsWithMargins.reduce((s,i)=>s+i.margin,0)/itemsWithMargins.length:0;
    const lowMarginCount=itemsWithMargins.filter(i=>i.margin<LOW_MARGIN_THRESHOLD).length;
    const highMarginCount=itemsWithMargins.filter(i=>i.margin>=60).length;
    const ingredientTrends=ingredients.filter(i=>i.last_price>0).sort((a,b)=>parseFloat(b.last_price)-parseFloat(a.last_price)).slice(0,8).map(i=>({name:i.name,price:parseFloat(i.last_price),unit:i.unit}));
    const aiProfitScore=calculateAIProfitScore({itemsWithMargins,averageMargin,unpricedIngredients,totalIngredients:ingredients.length,totalMenuItems:menuItems.length,processedInvoices,totalInvoices:invoices.length});
    return {totalInvoices:invoices.length,totalIngredients:ingredients.length,totalMenuItems:menuItems.length,ingredientTrends,menuItemAnalysis,unpricedIngredients,averageMargin,totalSpending,aiProfitScore,lowMarginCount,highMarginCount,wasteRisk:wasteRisk||[],priceByCategory:priceByCategory||{}};
  }

  function calculateAIProfitScore({itemsWithMargins,averageMargin,unpricedIngredients,totalIngredients,totalMenuItems,processedInvoices,totalInvoices}){
    let score=0;

    // Margin quality (35pts): full points at 60%+ average margin
    score+=Math.min((averageMargin/60)*35,35);

    // Ingredient coverage (15pts): % of ingredients with a known price
    score+=totalIngredients>0?((totalIngredients-unpricedIngredients)/totalIngredients)*15:0;

    // Menu costing coverage (15pts): % of menu items fully costed
    score+=totalMenuItems>0?(itemsWithMargins.length/totalMenuItems)*15:0;

    // Invoice completeness (10pts): % of invoices fully parsed
    score+=totalInvoices>0?(processedInvoices.length/totalInvoices)*10:0;

    // Margin distribution (15pts): rewards high-margin items, penalizes low-margin items
    if(itemsWithMargins.length>0){
      const high=itemsWithMargins.filter(i=>i.margin>=50).length;
      const low=itemsWithMargins.filter(i=>i.margin<25).length;
      score+=Math.max(0,Math.min(15,((high/itemsWithMargins.length)*15)-((low/itemsWithMargins.length)*8)+5));
    }

    // Invoice recency (10pts): scaled to 2 invoices/month
    const thirtyAgo=new Date();thirtyAgo.setDate(thirtyAgo.getDate()-30);
    score+=Math.min((processedInvoices.filter(i=>new Date(i.date||i.created_at)>=thirtyAgo).length/2)*10,10);

    return {score:Math.max(0,Math.min(100,Math.round(score)))};
  }

  const { color: scoreColor, label: scoreLabel } = getScoreInfo(data.aiProfitScore.score);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const dateLabel = new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'});
  const recs = (data.aiRecommendations||[]).slice(0,3);
  const wasteProteins = data.wasteRisk.filter(w=>w.protein);
  const wasteOther = data.wasteRisk.filter(w=>!w.protein);
  const allWaste = [...wasteProteins, ...wasteOther];
  const wasteVisible = wasteShowAll ? allWaste : allWaste.slice(0, WASTE_PREVIEW);

  const statItems = [
    { l:'Avg margin', v:`${data.averageMargin.toFixed(1)}%`,  c:getMarginColor(data.averageMargin) },
    { l:'Low margin', v:data.lowMarginCount,                  c:data.lowMarginCount>0?'var(--color-red)':'var(--color-green)' },
    { l:'Expiring',   v:data.wasteRisk.length,                c:data.wasteRisk.length>0?'var(--color-amber)':'var(--color-green)' },
    { l:'YTD spend',  v:fmt(data.totalSpending),              c:'var(--text-primary)' },
  ];

  function handleRecClick(i) { setSelectedRec(prev => prev === i ? null : i); }

  // ── MOBILE ──────────────────────────────────────────────────────────────────
  if (isMobile) {
    const circumference = 2 * Math.PI * 40;
    const scoreDash = (data.aiProfitScore.score / 100) * circumference;
    const MOB_TABS = [
      { id:'tonight', label:"Tonight's Picks" },
      { id:'metrics', label:'Metrics' },
      { id:'waste',   label:'Waste Risk' },
      { id:'week',    label:'Week Review' },
      { id:'prices',  label:'Prices' },
    ];
    return (
      <>
        <Head>
          <title>Dashboard — OptiMenu</title>
          <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover"/>
        </Head>
        <style>{GLOBAL_CSS}</style>
        <style>{`
          .m3-root{font-family:'Inter',sans-serif;background:var(--bg-root);color:var(--text-primary);width:100%;height:100dvh;display:flex;flex-direction:column;overflow:hidden;}
          .m3-header{background:var(--bg-elevated);border-bottom:1px solid var(--border);padding:10px 16px;padding-top:max(10px,env(safe-area-inset-top));display:flex;align-items:center;justify-content:space-between;flex-shrink:0;}
          .m3-tabs{background:var(--bg-elevated);border-bottom:1px solid var(--border);display:flex;overflow-x:auto;flex-shrink:0;-webkit-overflow-scrolling:touch;}
          .m3-tabs::-webkit-scrollbar{display:none;}
          .m3-tab{flex-shrink:0;padding:10px 14px;font-size:12px;font-weight:500;color:var(--text-muted);border:none;background:none;cursor:pointer;font-family:'Inter',sans-serif;border-bottom:2px solid transparent;white-space:nowrap;-webkit-tap-highlight-color:transparent;}
          .m3-tab.active{color:var(--accent);border-bottom-color:var(--accent);}
          .m3-scroll{flex:1;overflow-y:auto;padding:14px 16px;display:flex;flex-direction:column;gap:12px;-webkit-overflow-scrolling:touch;}
          .m3-scroll::-webkit-scrollbar{display:none;}
          .m3-card{background:var(--bg-surface);border:1px solid var(--border);border-radius:10px;padding:14px;flex-shrink:0;}
          .m3-card-title{font-size:11px;font-weight:600;color:var(--text-primary);text-transform:uppercase;letter-spacing:.7px;margin-bottom:12px;display:flex;align-items:center;gap:6px;}
          .m3-ticket{position:relative;background:var(--paper);color:var(--ink);font-family:'Courier New',monospace;border-radius:2px;padding:14px 14px 18px;box-shadow:0 8px 20px -8px rgba(0,0,0,.6);animation:printIn .4s ease both;}
          .m3-ticket::after{content:'';position:absolute;left:0;right:0;bottom:0;height:7px;background-image:linear-gradient(45deg,var(--bg-root) 25%,transparent 25%),linear-gradient(-45deg,var(--bg-root) 25%,transparent 25%);background-size:11px 14px;background-position:bottom;background-repeat:repeat-x;}
          .m3-nav{background:var(--bg-elevated);border-top:1px solid var(--border);padding:8px 0 0;padding-bottom:env(safe-area-inset-bottom, 8px);display:flex;flex-shrink:0;position:sticky;bottom:0;z-index:50;}
          .m3-nav-item{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;cursor:pointer;padding:4px 0;-webkit-tap-highlight-color:transparent;}
          .m3-nav-item svg{width:20px;height:20px;stroke:var(--text-muted);fill:none;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;}
          .m3-nav-item.active svg{stroke:var(--accent);}
          .m3-nav-label{font-size:10px;color:var(--text-muted);}
          .m3-nav-item.active .m3-nav-label{color:var(--accent);}
        `}</style>
        <div className="m3-root">
          <div className="m3-header">
            <div className="p3-logo">Opti<span>Menu</span></div>
            <div style={{display:'flex',alignItems:'center',gap:10}}>
              <div style={{display:'flex',alignItems:'center',gap:4,fontSize:11,color:'var(--accent)'}}>
                <div style={{width:5,height:5,background:'var(--accent)',borderRadius:'50%',animation:'blink 2s infinite'}}/>Active
              </div>
              <ProfileDropdown userName={userName} userEmail={userEmail} isMobile={true}/>
            </div>
          </div>
          <div style={{background:'var(--bg-surface)',borderBottom:'1px solid var(--border)',padding:'8px 16px',display:'flex',alignItems:'center',justifyContent:'space-between',flexShrink:0}}>
            <div>
              <div style={{fontFamily:'Playfair Display,serif',fontSize:15,color:'var(--text-primary)'}}>{restaurantName}</div>
              <div style={{fontSize:11,color:'var(--text-muted)',marginTop:1}}>{new Date().toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})}</div>
            </div>
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              <div style={{position:'relative',width:36,height:36,flexShrink:0}}>
                <svg viewBox="0 0 100 100" width={36} height={36} style={{transform:'rotate(-90deg)'}}>
                  <circle cx="50" cy="50" r="40" stroke="var(--ring-track)" strokeWidth="12" fill="none"/>
                  <circle cx="50" cy="50" r="40" stroke={scoreColor} strokeWidth="12" fill="none" strokeDasharray={`${scoreDash} ${circumference}`} strokeLinecap="round"/>
                </svg>
                <div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center'}}>
                  <span style={{fontSize:10,fontWeight:700,color:'var(--text-primary)'}}>{data.aiProfitScore.score}</span>
                </div>
              </div>
              <div>
                <div style={{fontSize:9,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:.5}}>OptiScore</div>
                <div style={{fontSize:11,fontWeight:600,color:scoreColor}}>{scoreLabel}</div>
              </div>
            </div>
          </div>
          <div className="m3-tabs">
            {MOB_TABS.map(t=>(
              <button key={t.id} className={`m3-tab${mobTab===t.id?' active':''}`} onClick={()=>setMobTab(t.id)}>
                {t.label}
                {t.id==='waste'&&data.wasteRisk.length>0&&<span style={{marginLeft:4,background:'var(--color-red)',color:'#fff',fontSize:9,fontWeight:700,borderRadius:8,padding:'1px 5px'}}>{data.wasteRisk.length}</span>}
              </button>
            ))}
          </div>
          {loading ? (
            <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:10}}>
              <div className="p3-spinner" style={{width:22,height:22}}/>
              <div style={{fontSize:12,color:'var(--text-muted)'}}>Loading...</div>
            </div>
          ) : (
            <div className="m3-scroll">
              {mobTab==='tonight' && (
                aiLoading ? (
                  <div style={{textAlign:'center',padding:24}}>
                    <div className="p3-spinner" style={{margin:'0 auto 8px'}}/>
                    <div style={{fontSize:12,color:'var(--text-muted)',fontFamily:'Courier New,monospace'}}>Analyzing menu...</div>
                  </div>
                ) : recs.length > 0 ? (
                  recs.map((rec,i) => {
                    const {label:ticketLabel,color:ticketColor}=getTicketMeta(i);
                    const sellCopy=rec.sellCopy||rec.talking_point||SELL_COPY[i%SELL_COPY.length];
                    const isOpen = selectedRec === i;
                    return (
                      <div key={i} className="m3-ticket" style={{animationDelay:`${i*.08}s`}}>
                        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                          <span style={{fontSize:10,fontWeight:700,color:ticketColor,textTransform:'uppercase',letterSpacing:'1.2px'}}>{ticketLabel}</span>
                          <span style={{fontSize:9,color:'var(--ink-faint)'}}>#{String(i+1).padStart(3,'0')}</span>
                        </div>
                        <div style={{borderTop:'1px dashed var(--paper-shade)',filter:'brightness(.85)',margin:'0 0 8px'}}/>
                        <div style={{fontSize:18,fontWeight:700,color:'var(--ink)',lineHeight:1.2,marginBottom:8}}>{rec.title}</div>
                        <div style={{borderTop:'1px dashed var(--paper-shade)',filter:'brightness(.85)',margin:'0 0 8px'}}/>
                        {rec.description&&<div style={{fontSize:12,color:'var(--ink-soft)',lineHeight:1.5,marginBottom:8}}>{rec.description}</div>}
                        <div style={{fontSize:12,color:'var(--ink)',fontStyle:'italic',lineHeight:1.5,paddingLeft:9,borderLeft:`2px solid ${ticketColor}`,marginBottom:10}}>{sellCopy}</div>
                        <button onClick={()=>handleRecClick(i)} style={{width:'100%',background:'none',border:'1px dashed var(--ink-faint)',borderRadius:3,padding:'6px 0',fontSize:10,fontWeight:700,letterSpacing:'.1em',color:'var(--ink-soft)',fontFamily:'Courier New,monospace',cursor:'pointer'}}>
                          {isOpen?'· · · CLOSE RECIPE · · ·':'· · · VIEW RECIPE · · ·'}
                        </button>
                        {isOpen && (
                          <div style={{marginTop:10,background:'var(--bg-surface)',border:'1px solid var(--accent)',borderRadius:8,overflow:'hidden',maxHeight:340,overflowY:'auto'}}>
                            <RecipePanel rec={rec} menuItems={menuItemsFull} wasteRisk={data.wasteRisk}/>
                          </div>
                        )}
                        <div style={{fontSize:9,color:'var(--ink-faint)',textAlign:'center',marginTop:10,letterSpacing:'.06em'}}>opti-menu.com</div>
                      </div>
                    );
                  })
                ) : (
                  <div style={{textAlign:'center',padding:24,color:'var(--text-muted)',fontSize:13}}>No recommendations yet for today.</div>
                )
              )}
              {mobTab==='metrics' && (
                <div className="m3-card">
                  <div className="m3-card-title">Key Metrics</div>
                  <div style={{display:'flex',flexDirection:'column',gap:8}}>
                    {[
                      {l:'YTD Spend',        v:fmt(data.totalSpending),             c:'var(--text-primary)', sub:`${data.totalInvoices} invoice${data.totalInvoices!==1?'s':''}`},
                      {l:'Avg Margin',        v:`${data.averageMargin.toFixed(1)}%`, c:getMarginColor(data.averageMargin), sub:`${(100-data.averageMargin).toFixed(1)}% avg food cost`},
                      {l:'High Margin Items', v:data.highMarginCount||0,             c:'var(--color-green)', sub:'Above 60% margin'},
                      {l:'Low Margin Items',  v:data.lowMarginCount,                 c:data.lowMarginCount>0?'var(--color-red)':'var(--color-green)', sub:`Below ${LOW_MARGIN_THRESHOLD}% threshold`},
                      {l:'Menu Items',        v:data.totalMenuItems,                 c:'var(--text-primary)', sub:`${data.menuItemAnalysis?.filter(m=>m.hasCompleteData).length||0} fully costed`},
                      {l:'Ingredients',       v:data.totalIngredients,               c:'var(--text-primary)', sub:data.unpricedIngredients>0?`${data.unpricedIngredients} unpriced`:'All priced'},
                    ].map(({l,v,c,sub})=>(
                      <div key={l} style={{display:'flex',alignItems:'center',justifyContent:'space-between',background:'var(--bg-elevated)',border:'1px solid var(--border-subtle)',borderRadius:8,padding:'10px 12px',gap:8}}>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontSize:11,color:'var(--text-muted)'}}>{l}</div>
                          <div style={{fontSize:10,color:'var(--text-faint)',marginTop:2,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{sub}</div>
                        </div>
                        <div style={{fontFamily:'Courier New,monospace',fontSize:16,fontWeight:700,color:c,flexShrink:0}}>{v}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {mobTab==='waste' && (
                <div className="m3-card">
                  <div className="m3-card-title">
                    Waste Risk
                    <span style={{marginLeft:'auto',fontSize:10,color:'var(--text-muted)',fontWeight:400,textTransform:'none',letterSpacing:0}}>{data.wasteRisk.length>0?`${data.wasteRisk.length} at risk`:'All clear'}</span>
                  </div>
                  {allWaste.length===0 ? (
                    <div style={{textAlign:'center',padding:16,fontSize:13,color:'var(--text-muted)'}}>No expiring items detected</div>
                  ) : (
                    allWaste.map((item,i) => <WasteRow key={i} item={item} router={router}/>)
                  )}
                  {data.wasteRisk.length>0&&(
                    <div className="p3-legend">
                      <span><span className="p3-dot" style={{background:'var(--color-red)'}}/>Expired / today</span>
                      <span><span className="p3-dot" style={{background:'var(--color-amber)'}}/>2 days</span>
                      <span><span className="p3-dot" style={{background:'var(--accent)'}}/>3–7 days</span>
                    </div>
                  )}
                </div>
              )}
              {mobTab==='week' && (
                <div className="m3-card">
                  <div className="m3-card-title">Week in Review</div>
                  <MobileWeekInReview restaurantId={restaurantId} wasteRisk={data.wasteRisk} menuItems={menuItemsFull}/>
                </div>
              )}
              {mobTab==='prices' && (
                <div className="m3-card">
                  <div className="m3-card-title">
                    Price Movement
                    <span style={{marginLeft:'auto',fontSize:10,color:'var(--text-muted)',fontWeight:400,textTransform:'none',letterSpacing:0}}>6-month trend</span>
                  </div>
                  <MobilePriceMovement priceByCategory={data.priceByCategory}/>
                </div>
              )}
              <div style={{height:8}}/>
            </div>
          )}
          <div className="m3-nav">
            {[
              {label:'Dashboard', path:'/client/dashboard',     icon:<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>},
              {label:'Invoices',  path:'/client/invoices',      icon:<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>},
              {label:'Ingredients',path:'/client/ingredients',  icon:<svg viewBox="0 0 24 24"><path d="M17 8h1a4 4 0 010 8h-1"/><path d="M3 8h14v9a4 4 0 01-4 4H7a4 4 0 01-4-4V8z"/></svg>},
              {label:'Menu',      path:'/client/menu-items',    icon:<svg viewBox="0 0 24 24"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>},
              {label:'Analytics', path:'/client/analytics',     icon:<svg viewBox="0 0 24 24"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>},
            ].map(({label,path,icon})=>{
              const active = path==='/client/dashboard';
              return (
                <div key={label} className={`m3-nav-item${active?' active':''}`} onClick={()=>router.push(path)}>
                  {icon}
                  <div className="m3-nav-label">{label}</div>
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

  // ── DESKTOP ERROR ────────────────────────────────────────────────────────
  if (error) return (
    <>
      <style>{GLOBAL_CSS}</style>
      <div style={{background:'var(--bg-root)',height:'100vh',display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:12}}>
        <div style={{fontFamily:'Playfair Display,serif',fontSize:18,color:'var(--text-primary)'}}>Unable to load the dashboard</div>
        <div style={{fontSize:13,color:'var(--text-muted)',marginBottom:8}}>{error}</div>
        <button onClick={()=>window.location.reload()} style={{background:'var(--accent)',border:'none',borderRadius:6,padding:'8px 18px',color:'#0a0908',fontSize:13,fontWeight:600,cursor:'pointer',fontFamily:"'Inter',sans-serif"}}>Try again</button>
      </div>
    </>
  );

  // ── DESKTOP ──────────────────────────────────────────────────────────────
  const ringCirc = 2*Math.PI*40;
  const ringDash = (Math.max(0,Math.min(100,data.aiProfitScore.score))/100)*ringCirc;

  return (
    <>
      <Head><title>Dashboard — OptiMenu</title></Head>
      <style>{GLOBAL_CSS}</style>
      <div className="p3-root">

        {/* ── TOP BAR ── */}
        <div className="p3-topbar">
          <div style={{display:'flex',alignItems:'center',gap:'clamp(12px,1.6vw,28px)'}}>
            <div className="p3-logo">Opti<span>Menu</span></div>
            <div className="p3-tabs">
              {NAV_TABS.map(t=>(
                <button key={t.label} className={`p3-tab${t.label==='Dashboard'?' active':''}`} onClick={()=>{if(t.label!=='Dashboard')router.push(t.path);}}>{t.label}</button>
              ))}
            </div>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:'clamp(8px,.9vw,14px)'}}>
            <div style={{display:'flex',alignItems:'center',gap:4,fontSize:'clamp(9px,.62vw,11px)',color:'var(--accent)'}}>
              <div style={{width:5,height:5,background:'var(--accent)',borderRadius:'50%',animation:'blink 2s infinite'}}/>Active
            </div>
            <div style={{width:'clamp(140px,13vw,240px)',height:'clamp(26px,2.6vh,34px)',overflow:'visible',position:'relative'}}>
              <UniversalSearch restaurantId={restaurantId} placeholder="Search..."/>
            </div>
            <ProfileDropdown userName={userName} userEmail={userEmail} isMobile={false}/>
          </div>
        </div>

        {loading ? (
          <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:10}}>
            <div className="p3-spinner" style={{width:22,height:22}}/>
            <div style={{fontSize:'clamp(10px,.78vw,13px)',color:'var(--text-muted)'}}>Setting the pass...</div>
          </div>
        ) : (
          <>
            {/* ── TOP: glance card + the pass ── */}
            <div className="p3-top">
              <div className="p3-glance">
                <div className="p3-score" title={`OptiScore: ${data.aiProfitScore.score}/100 — ${scoreLabel}`} style={{paddingTop:0,borderTop:'none',flexShrink:0}}>
                  <div className="p3-score-ring">
                    <svg viewBox="0 0 100 100">
                      <circle cx="50" cy="50" r="40" stroke="var(--ring-track)" strokeWidth="11" fill="none"/>
                      <circle cx="50" cy="50" r="40" stroke={scoreColor} strokeWidth="11" fill="none" strokeDasharray={`${ringDash} ${ringCirc}`} strokeLinecap="round"/>
                    </svg>
                    <div className="p3-score-num">{data.aiProfitScore.score}</div>
                  </div>
                  <div>
                    <div style={{fontSize:'clamp(8px,.56vw,10px)',color:'var(--text-secondary)',textTransform:'uppercase',letterSpacing:'.1em'}}>OptiScore</div>
                    <div style={{fontSize:'clamp(10px,.72vw,12px)',fontWeight:600,color:scoreColor}}>{scoreLabel}</div>
                  </div>
                </div>
                <hr className="p3-glance-rule"/>
                <div style={{flexShrink:0}}>
                  <div style={{fontSize:'clamp(8px,.6vw,10px)',fontWeight:600,letterSpacing:'.14em',textTransform:'uppercase',color:'var(--text-secondary)',marginBottom:3}}>{restaurantName}</div>
                  <div style={{fontFamily:"'Courier New',monospace",fontSize:'clamp(11px,.88vw,14px)',fontWeight:700,color:'var(--text-primary)',letterSpacing:'.03em',lineHeight:1.2}}>{dateLabel}</div>
                </div>
                <hr className="p3-glance-rule"/>
                <div className="p3-glance-stats">
                  {statItems.map(({l,v,c})=>(
                    <div key={l} className="p3-stat">
                      <span className="p3-stat-l" style={{color:'var(--text-secondary)'}}>{l}</span>
                      <span className="p3-stat-v" style={{color:c}}>{v}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* ── THE PASS ── */}
              <div className="p3-pass">
              <div style={{fontFamily:"'Playfair Display',serif",fontWeight:500,fontSize:'clamp(13px,1.05vw,17px)',letterSpacing:'-.3px',color:'var(--text-primary)',lineHeight:1.25,marginBottom:'clamp(6px,.7vh,10px)',flexShrink:0}}>{greeting}, {userName}. <em style={{fontStyle:'italic',color:'var(--accent)'}}>Tonight's pass is set.</em></div>
              <div className="p3-rail-hd">
                <div className="p3-rail-title">Tonight's Service</div>
                <div style={{display:'flex',alignItems:'center',gap:12}}>
                  <span className="p3-rail-sub">{aiLoading?'Analyzing menu, sales & inventory...':recs.length>0?`${recs.length} dish${recs.length!==1?'es':''} on the rail`:'Waiting on data'}</span>
                </div>
              </div>
              <div className="p3-rail"/>
              <div className="p3-tickets">
                {aiLoading ? (
                  [0,1,2].map(i=>(
                    <div key={i} className="p3-ticket-slot">
                      <div className="p3-clip"/>
                      <div className="p3-flip" style={{minHeight:'clamp(90px,14vh,160px)'}}>
                        <div className="p3-flip-inner">
                          <div className="p3-ticket" style={{alignItems:'center',justifyContent:'center',cursor:'default',gap:8}}>
                            <div className="p3-spinner" style={{borderColor:'var(--paper-shade)',borderTopColor:'var(--ink-soft)'}}/>
                            <div style={{fontSize:'clamp(8px,.62vw,11px)',color:'var(--ink-faint)',letterSpacing:'.1em'}}>PRINTING...</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
                ) : recs.length > 0 ? (
                  recs.map((rec,i) => (
                    <PassTicket key={i} rec={rec} index={i} isSelected={selectedRec===i} onClick={()=>handleRecClick(i)} menuItems={menuItemsFull} wasteRisk={data.wasteRisk} daysOnOptiMenu={daysOnOptiMenu} restaurantName={restaurantName}/>
                  ))
                ) : (
                  <div style={{gridColumn:'1 / -1',display:'flex',alignItems:'center',justifyContent:'center',padding:'clamp(20px,4vh,40px)',color:'var(--text-muted)',fontSize:'clamp(10px,.78vw,13px)',textAlign:'center'}}>
                    No recommendations yet — upload an invoice or sync POS sales and tonight's tickets will print here.
                  </div>
                )}
              </div>
              </div>
            </div>

            {/* ── SUPPORTING BAND ── */}
            <div className="p3-band">
              <div className="p3-card">
                <div className="p3-card-hd">
                  <div className="p3-card-title">Waste Risk</div>
                  <span className="p3-card-sub">{data.wasteRisk.length>0?`${data.wasteRisk.length} at risk · ${wasteProteins.length} protein`:'All clear'}</span>
                </div>
                <div className="p3-waste-list">
                  {data.wasteRisk.length===0&&<div className="p3-empty">Nothing expiring soon — the walk-in is in good shape</div>}
                  {wasteVisible.map((item,i)=><WasteRow key={i} item={item} router={router}/>)}
                </div>
                {data.wasteRisk.length>WASTE_PREVIEW&&(
                  <button className="p3-link-btn" style={{padding:'clamp(5px,.5vh,7px) 0 0',width:'100%',textAlign:'center',flexShrink:0}} onClick={()=>setWasteShowAll(prev=>!prev)}>
                    {wasteShowAll?'↑ Show fewer':`↓ View all ${data.wasteRisk.length} at risk`}
                  </button>
                )}
                {data.wasteRisk.length>0&&(
                  <div className="p3-legend">
                    <span><span className="p3-dot" style={{background:'var(--color-red)'}}/>Expired / today</span>
                    <span><span className="p3-dot" style={{background:'var(--color-amber)'}}/>2 days</span>
                    <span><span className="p3-dot" style={{background:'var(--accent)'}}/>3–7 days</span>
                  </div>
                )}
              </div>

              <div className="p3-card">
                <div className="p3-card-hd">
                  <div className="p3-card-title">Week in Review</div>
                  <span className="p3-card-sub">Tap a highlighted date to drill in</span>
                </div>
                <WeekInReviewCard restaurantId={restaurantId} wasteRisk={data.wasteRisk} menuItems={menuItemsFull}/>
              </div>
            </div>
          </>
        )}
      </div>
      <Analytics/><SpeedInsights/>
      {tourProps&&<TourOverlay {...tourProps}/>}
      <TourDataBanner/>
    </>
  );
}