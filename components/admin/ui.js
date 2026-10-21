// components/admin/ui.js
// Small pieces the restaurant pages share: the health dot, status chips,
// filter pills and number formats.

import { MONO } from '../client/ClientChrome';

export const DOT = { red: 'var(--red)', amber: 'var(--amber)', green: 'var(--green)', gray: 'var(--faint)' };
export const HEALTH_WORD = { red: 'Needs you now', amber: 'Worth a look', green: 'Healthy', gray: 'Not tracked' };

export const STATUS = {
  LIVE: ['var(--green-tint)', 'var(--green)'],
  'SETTING UP': ['var(--accent-tint)', 'var(--accent-deep)'],
  'NEEDS HELP': ['var(--amber-tint)', 'var(--amber)'],
  DEMO: ['var(--panel)', 'var(--muted)'],
  CLOSED: ['var(--panel)', 'var(--muted)'],
};

export function Chip({ bg = 'var(--panel)', fg = 'var(--muted)', children, title }) {
  return (
    <span title={title} style={{ fontFamily: MONO, fontSize: 10.5, fontWeight: 600, letterSpacing: '0.06em', borderRadius: 5, padding: '3px 7px', background: bg, color: fg, whiteSpace: 'nowrap' }}>
      {children}
    </span>
  );
}

export function StatusChip({ status }) {
  const [bg, fg] = STATUS[status] || STATUS.DEMO;
  return <Chip bg={bg} fg={fg}>{status}</Chip>;
}

export function Dot({ level, size = 9 }) {
  return <span aria-hidden="true" style={{ width: size, height: size, borderRadius: '50%', background: DOT[level] || DOT.gray, flexShrink: 0, display: 'inline-block' }} />;
}

export function Pills({ options, value, onChange, label }) {
  return (
    <div role="group" aria-label={label} style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {options.map(({ key, label: l, n }) => {
        const on = value === key;
        return (
          <button key={key} type="button" aria-pressed={on} onClick={() => onChange(key)}
            style={{ minHeight: 34, padding: '0 13px', borderRadius: 17, cursor: 'pointer', font: "600 12.5px 'Manrope', sans-serif", border: `1px solid ${on ? 'var(--text)' : 'var(--line)'}`, background: on ? 'var(--text)' : 'var(--shell)', color: on ? 'var(--shell)' : 'var(--text)' }}>
            {l}{n != null && <span style={{ fontFamily: MONO, fontSize: 11, opacity: 0.7, marginLeft: 6 }}>{n}</span>}
          </button>
        );
      })}
    </div>
  );
}

export const th = { padding: '9px 10px', fontWeight: 500, fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.1em', color: 'var(--muted)', textAlign: 'left', background: 'var(--panel)', whiteSpace: 'nowrap' };
export const td = { padding: '11px 10px', borderTop: '1px solid var(--line-soft)', verticalAlign: 'top' };

export const money = (n, dp = 2) => (n == null ? '—' : (n < 0 ? '−$' : '$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp }));

export function shortDate(ts) {
  if (!ts) return '—';
  const d = typeof ts === 'string' && ts.length === 10 ? new Date(ts + 'T12:00:00Z') : new Date(ts);
  return new Intl.DateTimeFormat('en-US', { timeZone: typeof ts === 'string' && ts.length === 10 ? 'UTC' : 'America/New_York', month: 'short', day: 'numeric' }).format(d);
}

export function Card({ title, right, children, style }) {
  return (
    <section style={{ border: '1px solid var(--line)', borderRadius: 12, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0, ...style }}>
      {(title || right) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
          {title && <h2 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>{title}</h2>}
          {right}
        </div>
      )}
      {children}
    </section>
  );
}