// components/UniversalSearch.js
// Shared search modal. Every screen already renders a search button wired
// to an onSearch prop the pages leave unset — this component, plus wiring
// each page's onSearch to open it, is what fills that in. Debounces input,
// hits /api/search, groups results by type, click navigates.

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import supabase from '../lib/supabaseClient';

export default function UniversalSearch({ open, onClose }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState({ invoices: [], ingredients: [], menuItems: [] });
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);
  const debounceRef = useRef(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setResults({ invoices: [], ingredients: [], menuItems: [] });
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    clearTimeout(debounceRef.current);
    if (query.trim().length < 2) {
      setResults({ invoices: [], ingredients: [], menuItems: [] });
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch(`/api/search?q=${encodeURIComponent(query.trim())}`, {
          headers: { Authorization: `Bearer ${session?.access_token}` },
        });
        if (res.ok) setResults(await res.json());
      } catch (err) {
        console.error('[UniversalSearch] Search failed:', err);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(debounceRef.current);
  }, [query, open]);

  const go = (href) => {
    onClose?.();
    router.push(href);
  };

  if (!open) return null;

  const hasResults = results.invoices.length || results.ingredients.length || results.menuItems.length;
  const money = (n) => '$' + Number(n || 0).toFixed(2);

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 600, background: 'rgba(17,24,25,0.45)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '80px 20px' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 560, maxHeight: '70vh', display: 'flex', flexDirection: 'column', background: 'var(--shell,#fff)', border: '1px solid var(--line,#d8dfe0)', borderRadius: 14, boxShadow: '0 24px 60px rgba(17,24,25,0.25)', overflow: 'hidden' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px', borderBottom: '1px solid var(--line-soft,#eef1f2)' }}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="var(--faint,#78868a)" strokeWidth="1.5" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.6-3.6" /></svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && onClose?.()}
            placeholder="Search invoices, ingredients, menu items..."
            style={{ flex: 1, border: 'none', outline: 'none', background: 'none', fontFamily: "'Manrope',sans-serif", fontSize: 14.5, color: 'var(--text,#111819)' }}
          />
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--faint,#78868a)' }}>Esc</button>
        </div>

        <div style={{ overflowY: 'auto', flex: 1 }}>
          {query.trim().length < 2 && (
            <div style={{ padding: '28px 18px', textAlign: 'center', fontSize: 13, color: 'var(--faint,#78868a)' }}>
              Type at least 2 characters to search.
            </div>
          )}
          {query.trim().length >= 2 && !loading && !hasResults && (
            <div style={{ padding: '28px 18px', textAlign: 'center', fontSize: 13, color: 'var(--faint,#78868a)' }}>
              No matches for "{query}".
            </div>
          )}

          {results.invoices.length > 0 && (
            <div>
              <div style={{ padding: '10px 18px 4px', fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--faint,#78868a)' }}>Invoices</div>
              {results.invoices.map((v) => (
                <div key={v.id} onClick={() => go(`/client/invoices/${v.id}`)} style={{ padding: '9px 18px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600 }}>{v.supplier || 'Unknown supplier'} {v.number ? `· #${v.number}` : ''}</span>
                  <span style={{ fontSize: 12, color: 'var(--faint,#78868a)' }}>{v.amount != null ? money(v.amount) : ''}</span>
                </div>
              ))}
            </div>
          )}

          {results.ingredients.length > 0 && (
            <div>
              <div style={{ padding: '10px 18px 4px', fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--faint,#78868a)' }}>Ingredients</div>
              {results.ingredients.map((g) => (
                <div key={g.id} onClick={() => go(`/client/ingredients?open=${g.id}`)} style={{ padding: '9px 18px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600 }}>{g.name}</span>
                  <span style={{ fontSize: 12, color: 'var(--faint,#78868a)' }}>{g.last_price ? `${money(g.last_price)}/${g.unit || 'unit'}` : ''}</span>
                </div>
              ))}
            </div>
          )}

          {results.menuItems.length > 0 && (
            <div>
              <div style={{ padding: '10px 18px 4px', fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--faint,#78868a)' }}>Menu items</div>
              {results.menuItems.map((m) => (
                <div key={m.id} onClick={() => go(`/client/menu-items/${m.id}`)} style={{ padding: '9px 18px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600 }}>{m.name}</span>
                  <span style={{ fontSize: 12, color: 'var(--faint,#78868a)' }}>{m.price != null ? money(m.price) : ''}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
