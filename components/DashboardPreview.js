// components/DashboardPreview.js
// Animated, looping preview of "The Pass" dashboard for the landing page.
// Self-contained: own CSS variables + font import + animation loop, so it drops
// in without touching the global theme. Each cycle, tonight's tickets are torn
// off the rail and the next service day's tickets print back down onto it, while
// the OptiScore, waste list, date, and calendar all update.
import { useEffect, useRef } from 'react';

const SETS = [
  {
    day: 'Sat', date: 'Jun 13', score: 84, margin: '62%', low: 5, exp: 3, spend: '$46,920',
    railSub: '3 dishes on the rail', calMark: '+5',
    tickets: [
      { label: 'PUSH TONIGHT', color: 'var(--ac)', title: 'Grilled Branzino', pitch: 'Whole fish landed this morning — sell it before it turns.', margin: 72, chip: 'TODAY', num: '#211-01' },
      { label: 'RECOMMEND', color: 'var(--gr)', title: 'Short Rib Tagliatelle', pitch: "Saturday's high-margin anchor — lead with it.", margin: 68, chip: 'HIGH MARGIN', num: '#211-02' },
      { label: 'MENTION', color: 'var(--am)', title: 'Burrata &amp; Heirloom', pitch: 'Tomatoes are peaking — an easy table add-on.', margin: 61, chip: 'MOVING', num: '#211-03' },
    ],
    waste: [
      { name: 'whole branzino', left: '1 day', color: 'var(--rd)', pct: 90 },
      { name: 'short rib', left: '2 days', color: 'var(--am)', pct: 70 },
      { name: 'burrata', left: '2 days', color: 'var(--am)', pct: 66 },
    ],
  },
  {
    day: 'Sun', date: 'Jun 14', score: 87, margin: '64%', low: 4, exp: 3, spend: '$47,540',
    railSub: '3 dishes on the rail', calMark: '+8',
    tickets: [
      { label: 'PUSH TONIGHT', color: 'var(--ac)', title: 'Diver Scallops', pitch: 'Delivered today — only a few orders left in the count.', margin: 70, chip: 'TODAY', num: '#212-01' },
      { label: 'RECOMMEND', color: 'var(--gr)', title: 'Braised Lamb Shank', pitch: 'Holds well and best margin tonight — push it early.', margin: 69, chip: 'HIGH MARGIN', num: '#212-02' },
      { label: 'MENTION', color: 'var(--am)', title: 'Heirloom Tomato Salad', pitch: 'Bright and fast — moves itself on a warm night.', margin: 63, chip: 'MOVING', num: '#212-03' },
    ],
    waste: [
      { name: 'diver scallops', left: '1 day', color: 'var(--rd)', pct: 88 },
      { name: 'lamb shank', left: '3 days', color: 'var(--ac)', pct: 55 },
      { name: 'heirloom tomato', left: '1 day', color: 'var(--rd)', pct: 92 },
    ],
  },
  {
    day: 'Mon', date: 'Jun 15', score: 85, margin: '63%', low: 4, exp: 4, spend: '$48,210',
    railSub: '3 dishes on the rail', calMark: '+6',
    tickets: [
      { label: 'PUSH TONIGHT', color: 'var(--ac)', title: 'Day-Boat Halibut', pitch: 'Fresh catch in today — clear the case tonight.', margin: 71, chip: 'TODAY', num: '#213-01' },
      { label: 'RECOMMEND', color: 'var(--gr)', title: 'Wild Mushroom Risotto', pitch: 'Top margin on the board right now.', margin: 74, chip: 'HIGH MARGIN', num: '#213-02' },
      { label: 'MENTION', color: 'var(--am)', title: 'Stone Fruit Crostata', pitch: "Peaches won't hold past tomorrow.", margin: 66, chip: 'MOVING', num: '#213-03' },
    ],
    waste: [
      { name: 'day-boat halibut', left: '1 day', color: 'var(--rd)', pct: 90 },
      { name: 'cremini mushroom', left: '3 days', color: 'var(--ac)', pct: 52 },
      { name: 'peaches', left: '1 day', color: 'var(--rd)', pct: 94 },
    ],
  },
];

export default function DashboardPreview() {
  const wrapRef = useRef(null);

  useEffect(() => {
    const root = wrapRef.current;
    if (!root) return;

    const tilts = ['-.5deg', '.35deg', '-.25deg'];
    const CIRC = 2 * Math.PI * 24;
    const q = (sel) => root.querySelector(sel);

    const ticketsEl = q('.js-tickets');
    const ringEl = q('.js-ring');
    const numEl = q('.js-score');
    const labelEl = q('.js-scorelabel');
    const dateEl = q('.js-date');
    const marginEl = q('.js-margin');
    const lowEl = q('.js-low');
    const expEl = q('.js-exp');
    const spendEl = q('.js-spend');
    const railSubEl = q('.js-railsub');
    const updatedEl = q('.js-updated');
    const wasteEl = q('.js-waste');
    const wasteHdEl = q('.js-wastehd');
    const calEl = q('.js-cal');

    let curScore = 0;
    let idx = 0;
    let interval = null;
    let swapTimer = null;
    let rafId = null;

    function makeTicket(d, i) {
      const el = document.createElement('div');
      el.className = 'dp-slot';
      el.style.setProperty('--tilt', tilts[i]);
      el.innerHTML =
        '<div class="dp-clip"></div><div class="dp-ticket">' +
        '<div class="dp-rcpt-hd"><div class="dp-rname">ECHO TAP &amp; GRILLE</div><div class="dp-rsub">*** Food ***</div><div class="dp-rlabel" style="color:' + d.color + '">' + d.label + '</div></div>' +
        '<div class="dp-rmeta"><b>' + d.num + '</b><span>6:00 PM</span></div>' +
        '<hr class="dp-rrule"/>' +
        '<div class="dp-rtitle">' + d.title + '</div>' +
        '<hr class="dp-rrule"/>' +
        '<div class="dp-rpitchhd">--- Tonight\u2019s Pitch ---</div>' +
        '<div class="dp-rpitch" style="color:' + d.color + '">' + d.pitch + '</div>' +
        '<hr class="dp-rrule"/>' +
        '<div class="dp-rchips"><span class="dp-chip">MARGIN ' + d.margin + '%</span><span class="dp-chip" style="color:' + d.color + ';border-color:' + d.color + '">' + d.chip + '</span></div>' +
        '<div class="dp-rfoot">\u00b7 \u00b7 \u00b7  FLIP FOR RECIPE  \u00b7 \u00b7 \u00b7</div>' +
        '</div>';
      return el;
    }
    function buildTickets(set) {
      ticketsEl.innerHTML = '';
      set.tickets.forEach((d, i) => {
        const el = makeTicket(d, i);
        el.style.animation = 'dpPrint .55s cubic-bezier(.25,.8,.35,1) both';
        el.style.animationDelay = (i * 0.14) + 's';
        ticketsEl.appendChild(el);
      });
    }
    function tear(cb) {
      const nodes = Array.prototype.slice.call(ticketsEl.children);
      if (!nodes.length) { cb(); return; }
      nodes.forEach((n, i) => { n.style.animation = 'dpTear .7s ease forwards'; n.style.animationDelay = (i * 0.12) + 's'; });
      swapTimer = setTimeout(cb, 700 + (nodes.length - 1) * 120 + 90);
    }
    function tweenScore(to) {
      const from = curScore, dur = 900, t0 = performance.now();
      const col = to >= 85 ? 'var(--gr)' : 'var(--ac)';
      ringEl.style.stroke = col; numEl.style.color = col;
      labelEl.textContent = to >= 85 ? 'Excellent' : 'Good'; labelEl.style.color = col;
      function step(now) {
        const p = Math.min(1, (now - t0) / dur);
        const v = Math.round(from + (to - from) * p);
        numEl.textContent = v;
        ringEl.style.strokeDashoffset = (CIRC * (1 - v / 100)).toFixed(1);
        if (p < 1) rafId = requestAnimationFrame(step); else curScore = to;
      }
      rafId = requestAnimationFrame(step);
    }
    function wasteRow(w) {
      return '<div style="display:flex;flex-direction:column;gap:3px;padding:6px 0;border-bottom:1px solid var(--bds);">' +
        '<div style="display:flex;align-items:center;gap:7px;"><span style="width:6px;height:6px;border-radius:50%;background:' + w.color + ';flex-shrink:0;"></span>' +
        '<span style="flex:1;font-size:11px;color:var(--ts);text-transform:capitalize;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + w.name + '</span>' +
        '<span style="font-family:\'Courier Prime\',monospace;font-size:11px;font-weight:700;color:' + w.color + ';white-space:nowrap;">' + w.left + '</span></div>' +
        '<div style="height:3px;background:var(--bds);border-radius:2px;overflow:hidden;"><div style="height:100%;width:' + w.pct + '%;background:' + w.color + ';opacity:.7;border-radius:2px;"></div></div></div>';
    }
    function update(set) {
      dateEl.textContent = set.day + ' \u00b7 ' + set.date;
      marginEl.textContent = set.margin; lowEl.textContent = set.low; expEl.textContent = set.exp; spendEl.textContent = set.spend;
      railSubEl.textContent = set.railSub; wasteHdEl.textContent = set.exp + ' at risk';
      wasteEl.innerHTML = set.waste.map(wasteRow).join('');
      tweenScore(set.score);
      updatedEl.textContent = '\u21bb ' + set.date + ' 6:00 AM';
      updatedEl.classList.remove('dp-flash'); void updatedEl.offsetWidth; updatedEl.classList.add('dp-flash');
      advanceCal(set);
    }

    const calCells = {};
    let todayDay = 13;
    const preLit = { 1: '+4', 2: '+6', 3: '-1', 4: '+8', 5: '+3', 6: '+5', 7: '+2', 8: '+7', 9: '+4', 10: '+6', 11: '+9', 12: '+3' };
    for (let d = 1; d <= 30; d++) {
      const c = document.createElement('div');
      c.className = 'dp-cal-day';
      const lit = preLit[d];
      const subColor = lit && lit.charAt(0) === '-' ? 'var(--rd)' : 'var(--gr)';
      c.innerHTML = '<span class="dp-cal-num">' + d + '</span><span class="dp-cal-sub" style="color:' + subColor + '">' + (lit || '') + '</span>';
      if (lit) c.classList.add('lit');
      if (d === todayDay) c.classList.add('today');
      calCells[d] = c; calEl.appendChild(c);
    }
    function advanceCal(set) {
      const c = calCells[todayDay];
      if (c) {
        c.classList.add('lit'); c.classList.remove('today');
        const sub = c.querySelector('.dp-cal-sub');
        sub.textContent = set.calMark; sub.style.color = set.calMark.charAt(0) === '-' ? 'var(--rd)' : 'var(--gr)';
      }
      todayDay++;
      if (todayDay > 21) {
        for (let d = 13; d <= 21; d++) { const cc = calCells[d]; if (cc) { cc.classList.remove('lit'); cc.querySelector('.dp-cal-sub').textContent = ''; } }
        todayDay = 13;
      }
      const nt = calCells[todayDay]; if (nt) nt.classList.add('today');
    }

    buildTickets(SETS[0]);
    update(SETS[0]);
    interval = setInterval(() => {
      const next = (idx + 1) % SETS.length;
      tear(() => { idx = next; const s = SETS[idx]; buildTickets(s); update(s); });
    }, 8500);

    return () => {
      if (interval) clearInterval(interval);
      if (swapTimer) clearTimeout(swapTimer);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, []);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
        .dp-frame{--bg:#0a0908;--elev:#15120f;--surf:#100e0c;--inset:#1c1815;--bd:rgba(255,255,255,.07);--bds:rgba(255,255,255,.045);--tp:#e8e2d8;--ts:#b3a99c;--tm:#8a8175;--tf:#5c554b;--ac:#02a4ba;--gr:#4caf80;--am:#c4a35a;--rd:#d9544e;--paper:#f6f2e9;--psh:#ece6d8;--ink:#1c1712;--inks:#5d5547;--inkf:#9b9080;--rt:rgba(255,255,255,.09);
          background:#0d0b0a;border:1px solid rgba(255,255,255,.08);border-radius:16px;overflow:hidden;box-shadow:0 40px 90px -34px rgba(0,0,0,.85);font-family:'Inter',system-ui,sans-serif;color:var(--tp);}
        .dp-chrome{height:34px;display:flex;align-items:center;gap:8px;padding:0 14px;border-bottom:1px solid rgba(255,255,255,.06);}
        .dp-dot{width:10px;height:10px;border-radius:50%;}
        .dp-url{margin:0 auto;font-size:11px;color:var(--tf);letter-spacing:.02em;}
        .dp-root{background:var(--bg);}
        @keyframes dpPrint{from{opacity:0;transform:translateY(-32px) rotate(var(--tilt,0deg)) scale(.98);}to{opacity:1;transform:translateY(0) rotate(var(--tilt,0deg)) scale(1);}}
        @keyframes dpTear{0%{opacity:1;transform:translateY(0) rotate(var(--tilt,0deg));}35%{transform:translateY(5px) rotate(var(--tilt,0deg));}100%{opacity:0;transform:translateY(-52px) rotate(calc(var(--tilt,0deg) + 6deg));}}
        @keyframes dpPulse{0%,100%{opacity:1;}50%{opacity:.25;}}
        .dp-pulse{animation:dpPulse 2s infinite;}
        .dp-flash{animation:dpFlashK .9s ease;}
        @keyframes dpFlashK{0%{color:var(--ac);}100%{color:var(--tf);}}
        .dp-rail{position:relative;height:9px;border-radius:5px;background:linear-gradient(to bottom,#8a8378,#b5ada0 18%,#6e675d 55%,#4a443c);box-shadow:0 2px 5px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.35),inset 0 -1px 1px rgba(0,0,0,.4);}
        .dp-rail::before,.dp-rail::after{content:'';position:absolute;top:50%;transform:translateY(-50%);width:6px;height:6px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#d8d2c6,#5a544a 70%);box-shadow:inset 0 -1px 1px rgba(0,0,0,.6);}
        .dp-rail::before{left:7px;}.dp-rail::after{right:7px;}
        .dp-tickets{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;}
        .dp-slot{position:relative;padding-top:7px;}
        .dp-clip{position:absolute;top:-7px;left:50%;transform:translateX(-50%);width:46px;height:15px;border-radius:3px 3px 2px 2px;background:linear-gradient(to bottom,#c9c2b4,#9a9285 35%,#6e675d 75%,#565047);box-shadow:0 2px 4px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.4);z-index:2;}
        .dp-clip::after{content:'';position:absolute;left:5px;right:5px;bottom:4px;height:2px;border-radius:1px;background:rgba(0,0,0,.35);}
        .dp-ticket{position:relative;background:var(--paper);color:var(--ink);font-family:'Courier Prime','Courier New',monospace;border-radius:2px 2px 0 0;padding:11px 12px 16px;box-shadow:0 10px 24px -10px rgba(0,0,0,.65),0 2px 4px rgba(0,0,0,.35);overflow:hidden;}
        .dp-ticket::after{content:'';position:absolute;left:0;right:0;bottom:0;height:7px;background-image:linear-gradient(45deg,var(--bg) 25%,transparent 25%),linear-gradient(-45deg,var(--bg) 25%,transparent 25%);background-size:11px 14px;background-position:bottom;background-repeat:repeat-x;}
        .dp-rcpt-hd{text-align:center;margin-bottom:6px;}
        .dp-rname{font-size:12px;font-weight:700;letter-spacing:.03em;color:var(--ink);}
        .dp-rsub{font-size:11px;color:var(--inks);letter-spacing:.06em;}
        .dp-rlabel{font-size:11px;font-weight:700;letter-spacing:.1em;}
        .dp-rmeta{display:flex;justify-content:space-between;font-size:11px;color:var(--inks);}
        .dp-rmeta b{color:var(--ink);}
        .dp-rrule{border:none;border-top:1px dashed var(--psh);filter:brightness(.85);margin:6px 0;}
        .dp-rtitle{font-size:16px;font-weight:700;color:var(--ink);line-height:1.18;}
        .dp-rpitchhd{text-align:center;font-size:11px;color:var(--inks);margin-bottom:3px;}
        .dp-rpitch{font-size:12px;font-style:italic;line-height:1.45;}
        .dp-rchips{display:flex;gap:6px;flex-wrap:wrap;}
        .dp-chip{font-size:11px;font-weight:700;letter-spacing:.04em;padding:1px 6px;border:1px solid var(--inkf);border-radius:2px;color:var(--inks);}
        .dp-rfoot{text-align:center;font-size:11px;color:var(--inkf);letter-spacing:.06em;margin-top:8px;}
        .dp-stat{display:flex;align-items:baseline;justify-content:space-between;gap:8px;}
        .dp-stat-l{font-size:12px;color:var(--ts);}
        .dp-stat-v{font-size:14px;font-weight:600;font-variant-numeric:tabular-nums;}
        .dp-cal-day{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;border:1px solid transparent;border-radius:5px;padding:4px 0;}
        .dp-cal-num{font-size:11px;color:var(--tf);line-height:1;}
        .dp-cal-sub{font-family:'Courier Prime',monospace;font-size:11px;font-weight:700;line-height:1;min-height:11px;}
        .dp-cal-day.lit{background:var(--elev);border-color:var(--bds);}
        .dp-cal-day.lit .dp-cal-num{color:var(--tp);font-weight:600;}
        .dp-cal-day.today{border-color:var(--ac);}
        .dp-cal-day.today .dp-cal-num{color:var(--ac);font-weight:700;}
        @media (prefers-reduced-motion: reduce){
          .dp-slot{animation:none !important;}
          .dp-pulse,.dp-flash{animation:none !important;}
        }
        @media (max-width: 820px){
          .dp-tabs{display:none !important;}
          .dp-top{grid-template-columns:1fr !important;}
          .dp-tickets{grid-template-columns:1fr !important;}
          .dp-band{display:none !important;}
        }
      `}</style>

      <div className="dp-frame">
        <div className="dp-chrome">
          <span className="dp-dot" style={{ background: '#d9544e' }} />
          <span className="dp-dot" style={{ background: '#c4a35a' }} />
          <span className="dp-dot" style={{ background: '#4caf80' }} />
          <span className="dp-url">app.opti-menu.com/client/dashboard</span>
        </div>

        <div className="dp-root" ref={wrapRef}>
          <div style={{ height: 38, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 14px', borderBottom: '1px solid var(--bd)', background: 'var(--elev)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 15, color: 'var(--tp)' }}>Opti<span style={{ color: 'var(--ac)' }}>Menu</span></div>
              <div className="dp-tabs" style={{ display: 'flex', gap: 1 }}>
                <span style={{ padding: '4px 9px', borderRadius: 6, fontSize: 11, color: 'var(--tp)', background: 'var(--inset)' }}>Dashboard</span>
                <span style={{ padding: '4px 9px', fontSize: 11, color: 'var(--tm)' }}>Invoices</span>
                <span style={{ padding: '4px 9px', fontSize: 11, color: 'var(--tm)' }}>Ingredients</span>
                <span style={{ padding: '4px 9px', fontSize: 11, color: 'var(--tm)' }}>Menu Items</span>
                <span style={{ padding: '4px 9px', fontSize: 11, color: 'var(--tm)' }}>Analytics</span>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--ac)' }}><span className="dp-pulse" style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--ac)' }} />Active</span>
              <span style={{ fontSize: 11, color: 'var(--tf)', border: '1px solid var(--bd)', borderRadius: 6, padding: '4px 12px' }}>Search…</span>
              <span style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--inset)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: 'var(--ts)' }}>N</span>
            </div>
          </div>

          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="dp-top" style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: 16 }}>
              <div style={{ background: 'var(--surf)', border: '1px solid var(--bd)', borderRadius: 10, padding: 13, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ position: 'relative', width: 54, height: 54, flexShrink: 0 }}>
                    <svg viewBox="0 0 60 60" width="54" height="54" style={{ transform: 'rotate(-90deg)' }}>
                      <circle cx="30" cy="30" r="24" stroke="var(--rt)" strokeWidth="6" fill="none" />
                      <circle className="js-ring" cx="30" cy="30" r="24" stroke="var(--ac)" strokeWidth="6" fill="none" strokeLinecap="round" strokeDasharray="150.8" strokeDashoffset="150.8" style={{ transition: 'stroke-dashoffset .9s ease' }} />
                    </svg>
                    <div className="js-score" style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Playfair Display', serif", fontWeight: 600, fontSize: 18, color: 'var(--tp)' }}>0</div>
                  </div>
                  <div>
                    <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 15, color: 'var(--tp)', lineHeight: 1.1 }}>OptiScore</div>
                    <div className="js-scorelabel" style={{ fontSize: 11, fontWeight: 600, color: 'var(--ac)', marginTop: 2 }}>Good</div>
                  </div>
                </div>
                <hr style={{ border: 'none', borderTop: '1px solid var(--bds)', margin: 0 }} />
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--tp)' }}>Echo Tap &amp; Grille</span>
                  <span className="js-date" style={{ fontSize: 11, color: 'var(--ts)', whiteSpace: 'nowrap' }}>Sat · Jun 13</span>
                </div>
                <hr style={{ border: 'none', borderTop: '1px solid var(--bds)', margin: 0 }} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                  <div className="dp-stat"><span className="dp-stat-l">Avg margin</span><span className="dp-stat-v js-margin" style={{ color: 'var(--gr)' }}>62%</span></div>
                  <div className="dp-stat"><span className="dp-stat-l">Low margin</span><span className="dp-stat-v js-low" style={{ color: 'var(--rd)' }}>5</span></div>
                  <div className="dp-stat"><span className="dp-stat-l">Expiring</span><span className="dp-stat-v js-exp" style={{ color: 'var(--am)' }}>3</span></div>
                  <div className="dp-stat"><span className="dp-stat-l">YTD spend</span><span className="dp-stat-v js-spend" style={{ color: 'var(--tp)' }}>$46,920</span></div>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <div style={{ fontFamily: "'Playfair Display', serif", fontWeight: 500, fontSize: 16, letterSpacing: '-0.3px', color: 'var(--tp)', marginBottom: 10 }}>Good evening, Nick. <em style={{ fontStyle: 'italic', color: 'var(--ac)' }}>Tonight's pass is set.</em></div>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--ts)' }}>Tonight's Service</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}><span className="js-railsub" style={{ fontSize: 11, color: 'var(--tf)' }}>3 dishes on the rail</span><span className="js-updated" style={{ fontSize: 11, color: 'var(--tf)' }}>↻ 6:00 AM</span></span>
                </div>
                <div className="dp-rail" />
                <div className="js-tickets dp-tickets" style={{ marginTop: 0 }} />
              </div>
            </div>

            <div className="dp-band" style={{ display: 'grid', gridTemplateColumns: '210px 1fr', gap: 16 }}>
              <div style={{ background: 'var(--surf)', border: '1px solid var(--bd)', borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--tp)' }}>Waste Risk</span>
                  <span className="js-wastehd" style={{ fontSize: 11, color: 'var(--tf)' }}>3 at risk</span>
                </div>
                <div className="js-waste" style={{ display: 'flex', flexDirection: 'column' }} />
                <div style={{ fontSize: 11, color: 'var(--tf)', display: 'flex', gap: 10, paddingTop: 7, borderTop: '1px solid var(--bds)', marginTop: 6 }}>
                  <span><span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: 'var(--rd)', marginRight: 3 }} />today</span>
                  <span><span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: 'var(--am)', marginRight: 3 }} />2 days</span>
                  <span><span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: 'var(--ac)', marginRight: 3 }} />3–7</span>
                </div>
              </div>

              <div style={{ background: 'var(--surf)', border: '1px solid var(--bd)', borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--tp)' }}>Week in Review</span>
                  <span style={{ fontSize: 11, color: 'var(--tf)' }}>June 2026</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 3, marginBottom: 3 }}>
                  {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((d) => <span key={d} style={{ fontSize: 11, color: 'var(--tf)', textAlign: 'center' }}>{d}</span>)}
                </div>
                <div className="js-cal" style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 3 }} />
                <div style={{ fontSize: 11, color: 'var(--tf)', textAlign: 'center', marginTop: 7 }}>Highlighted nights have Tonight's Dish data</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}