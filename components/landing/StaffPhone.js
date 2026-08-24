// components/landing/StaffPhone.js
// The staff briefing exactly as it renders at /staff/[token], shown inside a
// 390x844 iPhone frame scaled to 62%.
const TICKETS = [
  { label: 'PUSH TONIGHT', num: '#001', color: '#02a4ba', dish: 'Grilled Branzino', say: '"Just came in fresh — one of the best things on the menu tonight."' },
  { label: 'RECOMMEND', num: '#002', color: '#4caf50', dish: 'Burrata & Heirloom', say: '"Guests have been loving this lately — a great choice tonight."' },
  { label: 'MENTION', num: '#003', color: '#f5a623', dish: 'Duck Confit', say: '"The kitchen is really proud of this one tonight — worth every bite."' },
];

const dashed = { borderTop: '1px dashed #d0c8c0', margin: '10px 0' };

export default function StaffPhone() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center' }}>
      <div style={{
        width: 390, flex: 'none', transform: 'scale(.62)', transformOrigin: 'top center',
        marginBottom: -330, background: '#14110f', borderRadius: 46, padding: 12,
        boxShadow: '0 26px 60px rgba(17,24,25,.28)',
      }}>
        <div style={{
          position: 'relative', height: 844, background: '#f0ece4', borderRadius: 36,
          overflow: 'hidden', fontFamily: "'Manrope', sans-serif", color: '#1a1612',
        }}>
          <div style={{
            position: 'absolute', left: 0, right: 0, bottom: 0, height: 70,
            background: 'linear-gradient(to bottom,rgba(240,236,228,0),#f0ece4)',
            pointerEvents: 'none', zIndex: 2,
          }} />
          <div style={{
            position: 'absolute', left: '50%', bottom: 9, transform: 'translateX(-50%)',
            width: 126, height: 5, borderRadius: 3, background: '#1a1612', opacity: .28, zIndex: 3,
          }} />
          <div style={{
            position: 'absolute', left: '50%', top: 11, transform: 'translateX(-50%)',
            width: 112, height: 33, borderRadius: 20, background: '#14110f', zIndex: 4,
          }} />

          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '16px 24px 0', fontSize: 12, fontWeight: 600,
          }}>
            <span>9:41</span>
            <span style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
              <svg width="15" height="11" viewBox="0 0 15 11" fill="#1a1612">
                <rect x="0" y="7" width="3" height="4" rx="1" />
                <rect x="4" y="5" width="3" height="6" rx="1" />
                <rect x="8" y="2.5" width="3" height="8.5" rx="1" />
                <rect x="12" y="0" width="3" height="11" rx="1" />
              </svg>
              <svg width="17" height="11" viewBox="0 0 17 11" fill="none" stroke="#1a1612" strokeWidth="1.1">
                <rect x="0.5" y="1" width="13" height="9" rx="2.5" />
                <rect x="2" y="2.5" width="9" height="6" rx="1.2" fill="#1a1612" stroke="none" />
                <path d="M15.4 4v3" />
              </svg>
            </span>
          </div>

          <div style={{ textAlign: 'center', padding: '26px 24px 18px' }}>
            <div style={{
              fontFamily: "'Courier New', monospace", fontSize: 13, letterSpacing: '.18em',
              color: '#02a4ba', textTransform: 'uppercase', marginBottom: 16,
            }}>OptiMenu</div>
            <div style={{ fontFamily: "'Courier New', monospace", fontSize: 26, fontWeight: 600, lineHeight: 1.2, marginBottom: 6 }}>
              Harbour & Vine
            </div>
            <div style={{ fontSize: 13, color: '#7a6e60', fontWeight: 300, letterSpacing: '.04em', marginBottom: 4 }}>Friday, August 21</div>
            <div style={{ fontSize: 12, color: '#02a4ba', letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 500 }}>
              Tonight&rsquo;s Dish — Staff Briefing
            </div>
          </div>

          <div style={{ height: 1, background: 'linear-gradient(90deg,transparent,#d0c8c0,transparent)', margin: '0 24px 18px' }} />

          <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 14, fontFamily: "'Courier New', monospace" }}>
            {TICKETS.map((t) => (
              <div key={t.num} style={{ background: '#fff', borderRadius: 4, padding: '15px 16px 11px', boxShadow: '0 2px 8px rgba(0,0,0,.12)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1.5px', color: t.color }}>{t.label}</span>
                  <span style={{ fontSize: 10, color: '#9a9080' }}>{t.num}</span>
                </div>
                <div style={dashed} />
                <div style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.2, color: t.color }}>{t.dish}</div>
                <div style={dashed} />
                <div style={{ fontSize: 9, letterSpacing: '1.2px', color: '#9a9080', marginBottom: 4 }}>SAY THIS:</div>
                <div style={{ fontSize: 13, lineHeight: 1.55, fontStyle: 'italic' }}>{t.say}</div>
                <div style={{ fontSize: 9, color: '#c0b8b0', textAlign: 'center', marginTop: 9, letterSpacing: '.8px' }}>opti-menu.com</div>
              </div>
            ))}
          </div>

          <div style={{ textAlign: 'center', padding: '20px 24px 26px', fontSize: 11, color: '#9a9080', letterSpacing: '.06em' }}>
            Powered by OptiMenu · Staff use only
          </div>
        </div>
      </div>
    </div>
  );
}
