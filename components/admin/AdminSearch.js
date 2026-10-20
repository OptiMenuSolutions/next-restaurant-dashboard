// components/admin/AdminSearch.js
// Jump-to search, opened with ⌘K or the search button. Matches pages and
// actions here in the browser, and asks /api/admin/search for restaurants,
// tags (OM-0004) and invoice numbers. Recent picks are kept in this browser.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { useAdminFetch } from '../../lib/admin/useAdminFetch';
import { MONO, SearchIcon } from '../client/ClientChrome';

const RECENT_KEY = 'om_admin_recent';

const PAGES = [
  ['Today', '/admin'],
  ['All tickets', '/admin/tickets'],
  ['All restaurants', '/admin/restaurants'],
  ['Support inbox', '/admin/feedback'],
  ['Review queue', '/admin/invoice-review'],
  ['Cost approvals', '/admin/prices'],
  ['Ingredient library', '/admin/ingredients'],
  ['AI & parsing', '/admin/ai'],
  ['Jobs & health', '/admin/errors'],
  ['Revenue & billing', '/admin/revenue'],
  ['Settings', '/admin/flags'],
  ['Old admin', '/admin/old'],
].map(([title, href]) => ({ id: 'p:' + href, title, sub: 'Page', href }));

const ACTIONS = [
  { id: 'a:note', title: 'Add a note to the rail', sub: 'Action', href: '/admin?note=1' },
  { id: 'a:theme', title: 'Switch light or dark mode', sub: 'Action', run: 'theme' },
];

function readRecent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]').slice(0, 5); } catch { return []; }
}
function saveRecent(item) {
  try {
    const keep = { id: item.id, title: item.title, sub: item.sub, href: item.href };
    const list = [keep, ...readRecent().filter((r) => r.id !== item.id)].slice(0, 5);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {}
}

export default function AdminSearch({ open, onClose, onToggleTheme }) {
  const router = useRouter();
  const { adminFetch } = useAdminFetch();
  const inputRef = useRef(null);
  const [q, setQ] = useState('');
  const [remote, setRemote] = useState({ restaurants: [], tags: [], invoices: [] });
  const [recent, setRecent] = useState([]);
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (!open) return;
    setQ('');
    setActive(0);
    setRecent(readRecent());
    setRemote({ restaurants: [], tags: [], invoices: [] });
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  // Server lookups, after a short pause in typing.
  useEffect(() => {
    if (!open) return;
    const term = q.trim();
    if (term.length < 2) { setRemote({ restaurants: [], tags: [], invoices: [] }); return; }
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const res = await adminFetch(`/api/admin/search?q=${encodeURIComponent(term)}`);
        const json = await res.json();
        if (alive) setRemote({ restaurants: json.restaurants || [], tags: json.tags || [], invoices: json.invoices || [] });
      } catch {}
    }, 180);
    return () => { alive = false; clearTimeout(t); };
  }, [q, open, adminFetch]);

  const groups = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) {
      return [
        { label: 'RECENT', items: recent },
        { label: 'JUMP TO', items: PAGES.slice(0, 6) },
        { label: 'ACTIONS', items: ACTIONS },
      ].filter((g) => g.items.length);
    }
    const hit = (x) => x.title.toLowerCase().includes(term);
    return [
      { label: 'RESTAURANTS', items: remote.restaurants },
      { label: 'TAGS', items: remote.tags },
      { label: 'INVOICES', items: remote.invoices },
      { label: 'PAGES', items: PAGES.filter(hit) },
      { label: 'ACTIONS', items: ACTIONS.filter(hit) },
    ].filter((g) => g.items.length);
  }, [q, recent, remote]);

  const flat = groups.flatMap((g) => g.items);
  useEffect(() => { if (active >= flat.length) setActive(0); }, [flat.length, active]);

  function pick(item) {
    if (!item) return;
    onClose();
    if (item.run === 'theme') { onToggleTheme?.(); return; }
    saveRecent(item);
    router.push(item.href);
  }

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, flat.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(flat[active]); }
  }

  if (!open) return null;
  let n = -1;

  return (
    <div onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(17,24,25,0.42)', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: '90px 16px' }}>
      <div role="dialog" aria-modal="true" aria-label="Search"
        style={{ width: '100%', maxWidth: 620, background: 'var(--shell)', borderRadius: 14, boxShadow: 'var(--shadow-lg)', overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: '70vh' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: '1px solid var(--line)' }}>
          <SearchIcon size={16} />
          <input ref={inputRef} value={q} onChange={(e) => { setQ(e.target.value); setActive(0); }} onKeyDown={onKey}
            placeholder="Restaurant, OM-0004, invoice number, page…" aria-label="Search"
            style={{ flex: 1, border: 0, outline: 'none', background: 'transparent', color: 'var(--text)', font: "500 15px 'Manrope', sans-serif" }} />
          <span style={{ fontFamily: MONO, fontSize: 10.5, color: 'var(--faint)', border: '1px solid var(--line)', borderRadius: 4, padding: '2px 5px' }}>ESC</span>
        </div>
        <div style={{ overflowY: 'auto', padding: '6px 0 10px' }}>
          {groups.length === 0 && (
            <div style={{ padding: '22px 18px', fontSize: 13.5, color: 'var(--muted)' }}>No matches.</div>
          )}
          {groups.map((g) => (
            <div key={g.label}>
              <div style={{ padding: '10px 18px 4px', fontFamily: MONO, fontSize: 10, letterSpacing: '0.14em', color: 'var(--faint)' }}>{g.label}</div>
              {g.items.map((item) => {
                n += 1;
                const i = n;
                const on = i === active;
                return (
                  <button key={item.id} type="button" onMouseEnter={() => setActive(i)} onClick={() => pick(item)}
                    style={{ width: '100%', display: 'flex', alignItems: 'baseline', gap: 10, padding: '9px 18px', border: 0, cursor: 'pointer', textAlign: 'left', background: on ? 'var(--accent-tint)' : 'transparent', boxShadow: on ? 'inset 3px 0 0 var(--accent)' : 'none', color: 'var(--text)', fontFamily: "'Manrope', sans-serif" }}>
                    <span style={{ fontSize: 14, fontWeight: 700, flexShrink: 0 }}>{item.title}</span>
                    <span style={{ fontSize: 12.5, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.sub}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}