import { useEffect, useMemo, useRef, useState } from 'react';

const MONO = "'IBM Plex Mono', ui-monospace, monospace";

// OptiMenu dropdown. Options look like { value, label, meta, group }.
// `text` overrides what the closed button shows (for typed-in names).
export default function Picker({
  value,
  text,
  options = [],
  onChange,
  onCreate,
  createLabel = name => `Add “${name}” as a new ingredient`,
  placeholder = 'Choose…',
  search = true,
  ariaLabel,
  disabled = false,
  style,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const box = useRef(null);
  const input = useRef(null);

  const current = options.find(o => o.value === value);
  const shown = text || current?.label || '';

  const q = query.trim().toLowerCase();
  const matches = useMemo(
    () => (q ? options.filter(o => o.label.toLowerCase().includes(q)) : options).slice(0, 200),
    [options, q]
  );
  const exact = options.some(o => o.label.toLowerCase() === q);
  const canCreate = !!onCreate && !!q && !exact;
  const total = matches.length + (canCreate ? 1 : 0);

  useEffect(() => {
    if (!open) return undefined;

    const close = event => {
      if (box.current && !box.current.contains(event.target)) setOpen(false);
    };

    document.addEventListener('mousedown', close);
    document.addEventListener('touchstart', close);

    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('touchstart', close);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    if (search) setTimeout(() => input.current?.focus(), 0);
  }, [open, search]);

  function pick(index) {
    if (index < matches.length) onChange?.(matches[index].value, matches[index]);
    else if (canCreate) onCreate(query.trim());
    setOpen(false);
  }

  function onKey(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!open) setOpen(true);
      else setActive(a => Math.min(a + 1, Math.max(total - 1, 0)));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive(a => Math.max(a - 1, 0));
    } else if (event.key === 'Enter' && open) {
      event.preventDefault();
      if (total) pick(active);
    }
  }

  let lastGroup = null;

  return (
    <div ref={box} onKeyDown={onKey} style={{ position: 'relative', minWidth: 0, ...style }}>
      <button
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%',
          minHeight: 40,
          boxSizing: 'border-box',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '0 12px',
          border: `1px solid ${open ? 'var(--accent)' : 'var(--line)'}`,
          borderRadius: 10,
          background: 'var(--shell)',
          color: shown ? 'var(--text)' : 'var(--faint)',
          font: "500 14px 'Manrope', sans-serif",
          textAlign: 'left',
          cursor: disabled ? 'default' : 'pointer',
          boxShadow: open ? '0 0 0 3px var(--accent-tint)' : 'none',
        }}
      >
        <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {shown || placeholder}
        </span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, color: 'var(--muted)' }}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div style={{ position: 'absolute', left: 0, top: 'calc(100% + 4px)', zIndex: 40, minWidth: '100%', width: 'max-content', maxWidth: 'min(360px, 90vw)', background: 'var(--shell)', border: '1px solid var(--line)', borderRadius: 12, boxShadow: '0 18px 40px rgba(17,24,25,0.14)', overflow: 'hidden' }}>
          {search && (
            <div style={{ padding: 8, borderBottom: '1px solid var(--line-soft)' }}>
              <input
                ref={input}
                value={query}
                onChange={e => { setQuery(e.target.value); setActive(0); }}
                placeholder={onCreate ? 'Search or type a new name' : 'Search'}
                aria-label="Search"
                style={{ width: '100%', boxSizing: 'border-box', minHeight: 36, padding: '0 10px', border: '1px solid var(--line)', borderRadius: 8, background: 'var(--shell)', color: 'var(--text)', font: "500 14px 'Manrope', sans-serif" }}
              />
            </div>
          )}

          <div role="listbox" style={{ maxHeight: 260, overflowY: 'auto', padding: '4px 0' }}>
            {matches.map((option, index) => {
              const header = option.group && option.group !== lastGroup;
              lastGroup = option.group;

              return (
                <div key={option.value}>
                  {header && (
                    <div style={{ padding: '8px 12px 4px', fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--muted)' }}>
                      {option.group}
                    </div>
                  )}
                  <button
                    type="button"
                    role="option"
                    aria-selected={option.value === value}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => pick(index)}
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, width: '100%', padding: '9px 12px', border: 0, background: index === active ? 'var(--accent-tint)' : 'transparent', color: 'var(--text)', font: `${option.value === value ? 700 : 500} 13.5px 'Manrope', sans-serif`, textAlign: 'left', cursor: 'pointer' }}
                  >
                    <span style={{ minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{option.label}</span>
                    {option.meta && (
                      <span style={{ flexShrink: 0, fontFamily: MONO, fontSize: 11, color: 'var(--muted)' }}>{option.meta}</span>
                    )}
                  </button>
                </div>
              );
            })}

            {!matches.length && !canCreate && (
              <div style={{ padding: '10px 12px', fontSize: 13, color: 'var(--muted)' }}>No matches</div>
            )}
          </div>

          {canCreate && (
            <button
              type="button"
              onMouseEnter={() => setActive(matches.length)}
              onClick={() => pick(matches.length)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '10px 12px', border: 0, borderTop: '1px solid var(--line-soft)', background: active === matches.length ? 'var(--accent-tint)' : 'transparent', color: 'var(--accent-deep)', font: "700 13px 'Manrope', sans-serif", textAlign: 'left', cursor: 'pointer' }}
            >
              + {createLabel(query.trim())}
            </button>
          )}
        </div>
      )}
    </div>
  );
}