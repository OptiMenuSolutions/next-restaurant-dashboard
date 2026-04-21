// lib/admin/usePagination.js
// Shared pagination hook + FilterButton component for all admin pages.
// Import: import { usePagination, Pagination, FilterButton } from '../../../lib/admin/usePagination';

import { useState } from 'react';

// ── usePagination ─────────────────────────────────────────────────────────────
export function usePagination(items, pageSize = 12) {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const start      = (page - 1) * pageSize;
  const pageItems  = items.slice(start, start + pageSize);

  function reset() { setPage(1); }

  return { page, setPage, pageItems, totalPages, start, reset };
}

// ── Pagination UI ─────────────────────────────────────────────────────────────
export function Pagination({ page, totalPages, setPage, total, pageSize }) {
  if (totalPages <= 1) return null;
  const start = (page - 1) * pageSize + 1;
  const end   = Math.min(page * pageSize, total);

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '10px 14px', borderTop: '1px solid #1e2028',
      background: '#0f1115',
    }}>
      <span style={{ fontSize: 10, color: '#3a3e50', fontFamily: "'DM Mono', monospace" }}>
        {start}–{end} of {total}
      </span>
      <div style={{ display: 'flex', gap: 4 }}>
        <PagBtn disabled={page === 1} onClick={() => setPage(1)}>«</PagBtn>
        <PagBtn disabled={page === 1} onClick={() => setPage(p => p - 1)}>‹</PagBtn>
        {pageRange(page, totalPages).map((p, i) =>
          p === '…'
            ? <span key={`ellipsis-${i}`} style={{ padding: '0 6px', color: '#3a3e50', fontSize: 10, lineHeight: '28px' }}>…</span>
            : <PagBtn key={p} active={p === page} onClick={() => setPage(p)}>{p}</PagBtn>
        )}
        <PagBtn disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>›</PagBtn>
        <PagBtn disabled={page === totalPages} onClick={() => setPage(totalPages)}>»</PagBtn>
      </div>
    </div>
  );
}

function PagBtn({ children, onClick, disabled, active }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        minWidth: 28, height: 28, padding: '0 6px',
        fontSize: 11, fontFamily: "'DM Mono', monospace",
        border: '1px solid',
        borderColor: active ? 'rgba(2,164,186,0.5)' : '#1e2028',
        borderRadius: 5,
        background: active ? 'rgba(2,164,186,0.12)' : 'none',
        color: active ? '#02a4ba' : disabled ? '#2a2e3a' : '#5a6080',
        cursor: disabled ? 'not-allowed' : 'pointer',
        // Critical: no outline on focus — use border only
        outline: 'none',
      }}
    >
      {children}
    </button>
  );
}

function pageRange(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  if (current <= 4)  return [1, 2, 3, 4, 5, '…', total];
  if (current >= total - 3) return [1, '…', total - 4, total - 3, total - 2, total - 1, total];
  return [1, '…', current - 1, current, current + 1, '…', total];
}

// ── FilterButton ──────────────────────────────────────────────────────────────
// Fixes the white focus-ring border bug by suppressing :focus outline on all
// admin filter buttons. Use this instead of raw <button> for filter groups.
export function FilterButton({ active, onClick, children, style }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '6px 10px',
        fontSize: 10,
        fontWeight: 500,
        borderRadius: 6,
        border: '1px solid',
        borderColor: active ? 'rgba(2,164,186,0.3)' : '#1e2028',
        background: active ? 'rgba(2,164,186,0.1)' : 'none',
        color: active ? '#02a4ba' : '#5a6080',
        cursor: 'pointer',
        fontFamily: "'Inter', sans-serif",
        // Suppress browser focus ring — the border conveys active state
        outline: 'none',
        ...style,
      }}
    >
      {children}
    </button>
  );
}