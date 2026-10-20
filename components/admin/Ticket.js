// components/admin/Ticket.js
// One ticket on the rail: a paper slip with its kind, age, title, a line of
// detail and the button that takes you to the work. On All tickets it also
// gets Snooze and Done.

import Link from 'next/link';
import { MONO } from '../client/ClientChrome';

export const KIND = {
  JOB: { label: 'JOB', color: 'var(--red)' },
  BILLING: { label: 'BILLING', color: 'var(--red)' },
  DEADLINE: { label: 'DEADLINE', color: 'var(--ink)' },
  SUPPORT: { label: 'SUPPORT', color: 'var(--ink-soft)' },
  REVIEW: { label: 'REVIEW', color: 'var(--accent-deep)' },
  COSTS: { label: 'COSTS', color: 'var(--amber)' },
  SALES: { label: 'SALES', color: 'var(--green)' },
  BOOKS: { label: 'BOOKS', color: 'var(--ink-soft)' },
  NOTE: { label: 'NOTE', color: 'var(--ink-soft)' },
};

export default function Ticket({ t, onSnooze, onDone, busy }) {
  const k = KIND[t.kind] || KIND.NOTE;
  return (
    <article style={{ background: 'var(--paper)', color: 'var(--ink)', borderRadius: 4, boxShadow: '0 1px 1px rgba(17,24,25,0.05), 0 3px 6px rgba(17,24,25,0.07)', display: 'flex', flexDirection: 'column', fontFamily: MONO, minHeight: 180, opacity: busy ? 0.5 : 1 }}>
      <div style={{ padding: '12px 14px 10px', display: 'flex', justifyContent: 'space-between', fontSize: 10.5, letterSpacing: '0.12em', borderBottom: '1px dashed var(--paper-line)' }}>
        <span style={{ fontWeight: 600, color: k.color }}>{k.label}</span>
        <span style={{ color: 'var(--ink-soft)' }}>{t.age}</span>
      </div>
      <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
        <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 14.5, fontWeight: 800, letterSpacing: '-0.01em', lineHeight: 1.3 }}>{t.title}</div>
        {t.meta && <div style={{ fontSize: 11.5, lineHeight: 1.5, color: 'var(--ink-soft)' }}>{t.meta}</div>}
      </div>
      <div style={{ display: 'flex', gap: 6, margin: '0 14px 14px' }}>
        {t.href ? (
          <Link href={t.href} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 36, padding: '0 12px', border: '1px solid var(--paper-line)', borderRadius: 18, fontFamily: "'Manrope', sans-serif", fontSize: 12.5, fontWeight: 700, color: 'var(--ink)' }}>
            {t.action || 'Open'}<span aria-hidden="true">→</span>
          </Link>
        ) : (
          <span style={{ flex: 1 }} />
        )}
        {onSnooze && (
          <button type="button" onClick={onSnooze} disabled={busy} aria-label="Snooze until tomorrow" title="Snooze until tomorrow" style={slipBtn}>z</button>
        )}
        {onDone && (
          <button type="button" onClick={onDone} disabled={busy} aria-label="Mark done" title="Mark done" style={slipBtn}>✓</button>
        )}
      </div>
    </article>
  );
}

const slipBtn = {
  width: 36, height: 36, borderRadius: '50%', border: '1px solid var(--paper-line)', background: 'transparent',
  color: 'var(--ink)', fontFamily: "'IBM Plex Mono', monospace", fontSize: 14, fontWeight: 600, cursor: 'pointer', flexShrink: 0,
};