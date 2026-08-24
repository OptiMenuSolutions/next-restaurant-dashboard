// components/landing/PassMock.js
// Annotated "THE PASS" dashboard mock for the landing page.
// Renders the real 1280x800 dashboard layout and scales it into a 16:10 frame,
// with four numbered hover callouts that dim the screen and outline one region.
import { useEffect, useRef, useState } from 'react';

const STATS = [
  { l: 'Menu items scored', v: '42' },
  { l: 'Low-margin items', v: '7' },
  { l: 'Expiring soon', v: '4' },
  { l: 'YTD spend', v: '$186,420' },
];

const WASTE = [
  { name: 'Branzino, whole', left: 'Use today', color: '#d9534f', width: '88%', meta: '~6.0 lb remaining · Delivered Aug 21' },
  { name: 'Heirloom tomato', left: '1 day left', color: '#d99a2b', width: '72%', meta: '~4.5 lb remaining · Delivered Aug 19' },
  { name: 'Burrata, 8 oz', left: '3 days left', color: '#02a4ba', width: '44%', meta: '~9.0 units remaining · Delivered Aug 20' },
  { name: 'Duck legs', left: '5 days left', color: '#02a4ba', width: '26%', meta: '~12.0 units remaining · Delivered Aug 20' },
];

const WEEK = [
  { l: 'Extra sold', v: '+18', sub: 'covers vs. avg', color: '#4caf50' },
  { l: 'Waste saved', v: '$212', sub: 'estimated', color: '#4caf50' },
  { l: 'Hit rate', v: '71%', sub: 'nights above average', color: '#02a4ba' },
];

const DOW = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

const TICKETS = [
  {
    label: 'PUSH TONIGHT', color: '#02a4ba', num: '#014-01', dish: 'Grilled Branzino', tilt: '-.5deg',
    pitch: '"Just came in fresh — one of the best things on the menu tonight."',
    chips: ['MARGIN 72%', '$21.40/COVER', 'URGENT'],
  },
  {
    label: 'RECOMMEND', color: '#4caf50', num: '#014-02', dish: 'Burrata & Heirloom', tilt: '.35deg',
    pitch: '"Guests have been loving this lately — a great choice tonight."',
    chips: ['MARGIN 68%', '$14.80/COVER'],
  },
  {
    label: 'MENTION', color: '#d99a2b', num: '#014-03', dish: 'Duck Confit', tilt: '-.25deg',
    pitch: '"The kitchen is really proud of this one tonight — worth every bite."',
    chips: ['MARGIN 41%', '$12.10/COVER'],
  },
];

const CALLOUTS = {
  1: {
    title: "Tonight's pass",
    body: "Three tickets on the rail: the push, the recommendation, the mention. Each carries its margin, profit per cover and the line for servers.",
    pin: { top: '7.5%', left: '43.7%' },
    tip: { left: '24%', top: '60%' },
    box: { left: '21.9%', top: '8.25%', width: '76%', height: '48%' },
  },
  2: {
    title: 'OptiScore',
    body: 'One number for menu health, recalculated nightly from margin spread, waste exposure and how your last picks performed.',
    pin: { top: '22.9%', left: -13 },
    tip: { left: '23%', top: '25%' },
    box: { left: '2.2%', top: '24.5%', width: '18%', height: '16.9%' },
  },
  3: {
    title: 'Waste risk',
    body: 'Everything nearing the end of its shelf life, ranked by days left and linked back to the invoice it arrived on.',
    pin: { top: '56.6%', left: -13 },
    tip: { left: '34%', top: '59%' },
    box: { left: '2.2%', top: '58.25%', width: '29.4%', height: '39.75%' },
  },
  4: {
    title: 'Week in review',
    body: 'Covers sold against the running average for every night you pushed a dish, so you can see whether it worked.',
    pin: { bottom: -13, left: '32%' },
    tip: { left: '33%', bottom: '44%' },
    box: { left: '33%', top: '58.25%', width: '64.8%', height: '39.75%' },
  },
};

function calendarCells() {
  const extra = { 4: 2, 5: -1, 8: 5, 11: 3, 12: -2, 15: 7, 16: 9, 18: 1, 19: 4, 20: 6, 21: 3 };
  const cells = [];
  for (let i = 0; i < 5; i++) {
    cells.push({ key: 'pad' + i, n: '', sub: '', bg: 'transparent', border: 'transparent', color: 'transparent', subColor: 'transparent' });
  }
  for (let d = 1; d <= 31; d++) {
    const e = extra[d];
    const today = d === 21;
    cells.push({
      key: 'd' + d,
      n: String(d),
      sub: e === undefined ? '' : e > 0 ? '+' + e : String(e),
      bg: today ? '#02a4ba' : e !== undefined ? '#211d19' : 'transparent',
      border: e !== undefined ? '#2a2622' : 'transparent',
      color: today ? '#14110f' : e !== undefined ? '#ece6dd' : '#4a443c',
      subColor: today ? '#14110f' : e === undefined ? 'transparent' : e > 0 ? '#4caf50' : '#d9534f',
    });
  }
  return cells;
}

const CAL = calendarCells();

const card = { background: '#1d1a17', border: '1px solid #34302b', borderRadius: 10 };
const rule = { borderTop: '1px dashed #ddd5c4', margin: '6px 0' };
const chip = {
  fontSize: 9, fontWeight: 700, letterSpacing: '.08em', padding: '2px 6px',
  border: '1px solid #9b9080', borderRadius: 2, color: '#5d5547',
};
const tabInactive = { padding: '5px 12px', borderRadius: 6, fontSize: 13, color: '#8b8177' };

export default function PassMock() {
  const screenRef = useRef(null);
  const [active, setActive] = useState(null);

  useEffect(() => {
    const el = screenRef.current;
    if (!el || !el.parentElement) return undefined;
    const fit = () => {
      if (!el.parentElement) return;
      el.style.transform = 'scale(' + el.parentElement.clientWidth / 1280 + ')';
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el.parentElement);
    return () => ro.disconnect();
  }, []);

  const co = active ? CALLOUTS[active] : null;

  return (
    <div style={{ border: '1px solid #eaeeef', borderRadius: 16, padding: 26, background: '#f7f8f8' }}>
      <style>{`
        .om-pin{position:absolute;width:26px;height:26px;border-radius:50%;background:#02a4ba;color:#fff;
          display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;border:0;cursor:pointer;
          box-shadow:0 2px 10px rgba(0,0,0,.45),0 0 0 3px rgba(2,164,186,.22);z-index:3;
          transition:transform .15s,box-shadow .15s}
        .om-pin:hover{transform:scale(1.14);box-shadow:0 3px 14px rgba(0,0,0,.5),0 0 0 6px rgba(2,164,186,.3)}
        .om-pin:focus-visible{outline:2px solid #02a4ba;outline-offset:3px}
      `}</style>

      <div onMouseLeave={() => setActive(null)} style={{ position: 'relative', width: '100%', aspectRatio: '16 / 10' }}>
        {co && (
          <div style={{
            position: 'absolute', ...co.tip, width: 'min(268px, 42%)',
            background: '#f6f2e9', color: '#1c1712', borderRadius: 10, padding: '14px 16px',
            boxShadow: '0 14px 34px rgba(0,0,0,.5)', pointerEvents: 'none', zIndex: 4,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 7 }}>
              <span style={{
                width: 20, height: 20, borderRadius: '50%', background: '#02a4ba', color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flex: 'none',
              }}>{active}</span>
              <span style={{ fontSize: 14.5, fontWeight: 700 }}>{co.title}</span>
            </div>
            <p style={{ fontSize: 12.5, lineHeight: 1.55, color: '#3a342c' }}>{co.body}</p>
          </div>
        )}

        {[1, 2, 3, 4].map((n) => (
          <button
            key={n}
            className="om-pin"
            style={CALLOUTS[n].pin}
            onMouseEnter={() => setActive(n)}
            onFocus={() => setActive(n)}
            onClick={() => setActive(n)}
          >
            {n}
          </button>
        ))}

        <div onMouseLeave={() => setActive(null)} style={{
          position: 'absolute', inset: 0, borderRadius: 9, overflow: 'hidden',
          background: '#14110f', boxShadow: '0 18px 44px rgba(17,24,25,0.22)',
        }}>
          {co && (
            <div style={{
              position: 'absolute', ...co.box, border: '2px solid #02a4ba', borderRadius: 10,
              boxShadow: '0 0 0 9999px rgba(20,17,15,.62)', pointerEvents: 'none', zIndex: 2,
            }} />
          )}

          <div ref={screenRef} style={{
            width: 1280, height: 800, transformOrigin: 'top left',
            display: 'flex', flexDirection: 'column',
            fontFamily: "'Manrope', sans-serif", color: '#ece6dd',
          }}>
            {/* top bar */}
            <div style={{
              height: 50, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '0 32px', borderBottom: '1px solid #34302b', background: '#1d1a17',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
                <img src="/landing/logo-knockout.png" alt="optiMenu Solutions" style={{ display: 'block', height: 22, width: 'auto' }} />
                <div style={{ display: 'flex', gap: 2 }}>
                  <span style={{ padding: '5px 12px', borderRadius: 6, fontSize: 13, color: '#ece6dd', background: '#2a2622' }}>Dashboard</span>
                  <span style={tabInactive}>Invoices</span>
                  <span style={tabInactive}>Ingredients</span>
                  <span style={tabInactive}>Menu Items</span>
                  <span style={tabInactive}>Analytics</span>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#02a4ba' }}>
                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#02a4ba' }} />Active
                </div>
                <div style={{
                  width: 240, height: 34, borderRadius: 8, background: '#211d19', border: '1px solid #34302b',
                  display: 'flex', alignItems: 'center', gap: 8, padding: '0 11px',
                }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#6b625a" strokeWidth="2" strokeLinecap="round">
                    <circle cx="11" cy="11" r="7" /><path d="m20 20-4.5-4.5" />
                  </svg>
                  <span style={{ fontSize: 12, color: '#6b625a' }}>Search...</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{
                    width: 28, height: 28, borderRadius: '50%', background: '#02a4ba', color: '#14110f',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700,
                  }}>MR</span>
                  <span style={{ fontSize: 11, color: '#6b625a' }}>▾</span>
                </div>
              </div>
            </div>

            {/* upper band: sidebar + tonight's pass */}
            <div style={{
              flex: '5 1 0', minHeight: 0, display: 'grid', gridTemplateColumns: '230px 1fr',
              gap: 22, padding: '16px 28px 0', overflow: 'hidden',
            }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9, minHeight: 0, overflow: 'hidden' }}>
                <div style={{ ...card, padding: 12, flex: 'none' }}>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, fontWeight: 600,
                    letterSpacing: '.14em', color: '#02a4ba', marginBottom: 9,
                  }}>
                    <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#02a4ba', flex: 'none' }} />
                    ON THE PASS · 4:32 PM
                  </div>
                  <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.1, letterSpacing: '-.03em' }}>Marcus</div>
                  <div style={{ borderTop: '1px solid #2a2622', margin: '8px 0' }} />
                  <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Harbour & Vine</div>
                  <div style={{ fontSize: 11, color: '#b4aaa0', marginTop: 3 }}>Friday, August 21, 2026</div>
                </div>

                <div style={{ ...card, padding: 12, flex: 'none' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: '#6b625a', letterSpacing: '.12em', textTransform: 'uppercase' }}>OptiScore</span>
                    <span style={{
                      fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: '#02a4ba',
                      background: 'rgba(2,164,186,.12)', border: '1px solid rgba(2,164,186,.3)', borderRadius: 5, padding: '2px 7px',
                    }}>Good</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
                    <span style={{ fontSize: 36, fontWeight: 700, lineHeight: .9, letterSpacing: '-.03em' }}>82</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#6b625a' }}>/ 100</span>
                  </div>
                  <div style={{ width: '100%', height: 5, background: '#34302b', borderRadius: 3, overflow: 'hidden', marginTop: 10 }}>
                    <div style={{ height: '100%', width: '82%', background: '#02a4ba', borderRadius: 3 }} />
                  </div>
                  <div style={{ borderTop: '1px solid #2a2622', marginTop: 10, paddingTop: 7, fontSize: 10, color: '#6b625a', letterSpacing: '.04em' }}>
                    Updated 4:32 PM
                  </div>
                </div>

                <div style={{
                  ...card, padding: '11px 12px', flex: 1, minHeight: 0,
                  display: 'flex', flexDirection: 'column', justifyContent: 'space-evenly',
                }}>
                  {STATS.map((st) => (
                    <div key={st.l} style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ fontSize: 11, color: '#b4aaa0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{st.l}</span>
                      <span style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-.01em', color: '#ece6dd', flex: 'none' }}>{st.v}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 9 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.2em', textTransform: 'uppercase', color: '#b4aaa0' }}>Tonight&rsquo;s pass</span>
                  <span style={{ fontSize: 10, color: '#8b8177' }}>Friday, August 21 · 42 dishes scored</span>
                </div>
                <div style={{
                  height: 10, borderRadius: 5, flex: 'none', position: 'relative', zIndex: 1,
                  background: 'linear-gradient(to bottom,#8a8378 0%,#b5ada0 18%,#6e675d 55%,#4a443c 100%)',
                  boxShadow: '0 2px 5px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.35)',
                }} />
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 24, flex: 1, minHeight: 0 }}>
                  {TICKETS.map((t) => (
                    <div key={t.num} style={{ position: 'relative', paddingTop: 8 }}>
                      <div style={{
                        position: 'absolute', top: -8, left: '50%', transform: 'translateX(-50%)',
                        width: 50, height: 17, borderRadius: '3px 3px 2px 2px',
                        background: 'linear-gradient(to bottom,#c9c2b4 0%,#9a9285 35%,#6e675d 75%,#565047 100%)',
                        boxShadow: '0 2px 4px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.4)', zIndex: 2,
                      }} />
                      <div style={{
                        transform: 'rotate(' + t.tilt + ')', transformOrigin: 'top center',
                        background: '#f6f2e9', color: '#1c1712', borderRadius: '2px 2px 0 0',
                        padding: '14px 16px 18px', fontFamily: "'Courier New', monospace",
                        boxShadow: '0 10px 24px -10px rgba(0,0,0,.65),0 2px 4px rgba(0,0,0,.35)',
                        height: '100%', display: 'flex', flexDirection: 'column',
                      }}>
                        <div style={{ textAlign: 'center', marginBottom: 6 }}>
                          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.04em', lineHeight: 1.3 }}>Harbour & Vine</div>
                          <div style={{ fontSize: 10, color: '#5d5547', letterSpacing: '.06em', lineHeight: 1.4 }}>*** Food ***</div>
                          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.12em', color: t.color, lineHeight: 1.4 }}>{t.label}</div>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                          <span style={{ fontSize: 11, fontWeight: 700 }}>{t.num}</span>
                          <span style={{ fontSize: 10, color: '#5d5547' }}>4:32 PM</span>
                        </div>
                        <div style={rule} />
                        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.1em', color: t.color }}>{t.label}</div>
                        <div style={rule} />
                        <div style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.2 }}>{t.dish}</div>
                        <div style={rule} />
                        <div style={{ textAlign: 'center', fontSize: 10, color: '#5d5547', marginBottom: 4 }}>--- Tonight&rsquo;s Pitch ---</div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 12, lineHeight: 1.5, fontStyle: 'italic', color: t.color }}>{t.pitch}</div>
                        </div>
                        <div style={rule} />
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {t.chips.map((c) => <span key={c} style={chip}>{c}</span>)}
                        </div>
                        <div style={{ textAlign: 'center', fontSize: 9, color: '#9b9080', letterSpacing: '.06em', marginTop: 8 }}>
                          · · ·  FLIP FOR RECIPE  · · ·
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* lower band: waste risk + week in review */}
            <div style={{
              flex: '4 1 0', minHeight: 0, display: 'grid', gridTemplateColumns: '1fr 2.2fr',
              gap: 18, padding: '16px 28px', overflow: 'hidden',
            }}>
              <div style={{ ...card, padding: 16, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>Waste risk</span>
                  <span style={{ fontSize: 10, color: '#8b8177' }}>4 flagged</span>
                </div>
                <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-evenly' }}>
                  {WASTE.map((w) => (
                    <div key={w.name} style={{ display: 'flex', flexDirection: 'column', gap: 5, padding: '6px 0', borderBottom: '1px solid #2a2622' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: w.color, flex: 'none' }} />
                        <span style={{ flex: 1, fontSize: 12, color: '#b4aaa0', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{w.name}</span>
                        <span style={{ fontSize: 11, fontWeight: 700, color: w.color }}>{w.left}</span>
                      </div>
                      <div style={{ height: 3, borderRadius: 2, background: '#2a2622' }}>
                        <div style={{ height: 3, borderRadius: 2, background: '#4a443c', width: w.width }} />
                      </div>
                      <div style={{ fontSize: 9, color: '#6b625a' }}>{w.meta}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ ...card, padding: 16, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>Week in review</span>
                  <span style={{ fontSize: 10, color: '#8b8177' }}>Last 7 nights</span>
                </div>
                <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: 18 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0 }}>
                    {WEEK.map((k) => (
                      <div key={k.l} style={{
                        background: '#211d19', border: '1px solid #2a2622', borderRadius: 7, padding: '9px 12px',
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flex: 'none',
                      }}>
                        <div>
                          <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '.08em', color: '#6b625a' }}>{k.l}</div>
                          <div style={{ fontSize: 9, color: '#6b625a', marginTop: 2 }}>{k.sub}</div>
                        </div>
                        <span style={{ fontSize: 19, fontWeight: 700, color: k.color }}>{k.v}</span>
                      </div>
                    ))}
                    <div style={{
                      background: '#211d19', border: '1px solid #2a2622', borderRadius: 7, padding: '9px 12px',
                      flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center',
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
                        <span style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '.08em', color: '#6b625a' }}>Top performer</span>
                        <span style={{ fontSize: 9, color: '#6b625a' }}>Sat, 08/16</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, marginTop: 5 }}>
                        <span style={{ fontSize: 14, fontWeight: 600, color: '#ece6dd' }}>Grilled Branzino</span>
                        <span style={{ fontSize: 19, fontWeight: 700, color: '#4caf50' }}>+9</span>
                      </div>
                    </div>
                  </div>

                  <div style={{ borderLeft: '1px solid #2a2622', paddingLeft: 18, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                    <div style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      fontSize: 13, fontWeight: 700, color: '#b4aaa0', letterSpacing: '.08em', marginBottom: 7,
                    }}>
                      <span style={{
                        width: 20, height: 20, borderRadius: 5, background: '#211d19', border: '1px solid #2a2622',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: '#8b8177',
                      }}>‹</span>
                      <span>August 2026</span>
                      <span style={{
                        width: 20, height: 20, borderRadius: 5, background: '#211d19', border: '1px solid #2a2622',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: '#4a443c',
                      }}>›</span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2, marginBottom: 2 }}>
                      {DOW.map((d) => (
                        <span key={d} style={{
                          fontSize: 9, fontWeight: 600, color: '#6b625a', textAlign: 'center',
                          textTransform: 'uppercase', letterSpacing: '.06em',
                        }}>{d}</span>
                      ))}
                    </div>
                    <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gridAutoRows: '1fr', gap: 2 }}>
                      {CAL.map((c) => (
                        <div key={c.key} style={{
                          borderRadius: 6, background: c.bg, border: '1px solid ' + c.border,
                          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1,
                        }}>
                          <span style={{ fontSize: 11, color: c.color }}>{c.n}</span>
                          <span style={{ fontSize: 9, fontWeight: 700, color: c.subColor }}>{c.sub}</span>
                        </div>
                      ))}
                    </div>
                    <div style={{ fontSize: 9, color: '#6b625a', textAlign: 'center', paddingTop: 6 }}>
                      Highlighted nights have Tonight&rsquo;s Dish data
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
