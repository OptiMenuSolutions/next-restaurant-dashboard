// components/TourDataBanner.js
// Drop this into any page that loads sample data (dashboard, invoices, ingredients, menu-items, analytics).
// After the tour ends, useTour sets 'optimenu_tour_done' = '1' in localStorage.
// This component reads that flag and shows a sticky bottom-left button to clear sample data.
// Clicking it removes the flag so sample data stops loading on refresh.

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';

export default function TourDataBanner() {
  const router = useRouter();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    function check() {
      try {
        const done = localStorage.getItem('optimenu_tour_done') === '1';
        // Show if tour is done but we're still on a tour-data page
        // (or they just finished the tour and are browsing with sample data)
        setVisible(done);
      } catch { setVisible(false); }
    }
    check();
    // Re-check if storage changes in another tab
    window.addEventListener('storage', check);
    return () => window.removeEventListener('storage', check);
  }, []);

  if (!visible) return null;

  function handleClear() {
    try {
      localStorage.removeItem('optimenu_tour_done');
      sessionStorage.removeItem('optimenu_tour_step');
      sessionStorage.removeItem('optimenu_tour_spot');
    } catch {}
    // Hard reload to dashboard — clears React state so sample data is gone
    window.location.href = '/client/dashboard';
  }

  return (
    <>
      <style>{`
        @keyframes tdb-slide-in {
          from { transform: translateY(12px); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
        .tdb-wrap {
          position: fixed;
          bottom: 20px;
          left: 20px;
          z-index: 9000;
          display: flex;
          align-items: center;
          gap: 10px;
          background: #13120f;
          border: 1px solid #2a2620;
          border-radius: 10px;
          padding: 9px 14px;
          box-shadow: 0 8px 32px rgba(0,0,0,.6);
          animation: tdb-slide-in .3s ease both;
          font-family: 'Inter', sans-serif;
        }
        .tdb-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #d4a020;
          flex-shrink: 0;
          animation: blink 2s ease infinite;
        }
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:.3} }
        .tdb-label {
          font-size: 11px;
          color: #6b6358;
          white-space: nowrap;
        }
        .tdb-label span {
          color: #d4a020;
          font-weight: 600;
        }
        .tdb-btn {
          background: none;
          border: 1px solid rgba(192,64,64,.35);
          border-radius: 6px;
          padding: 4px 10px;
          font-size: 11px;
          font-weight: 600;
          color: #c04040;
          cursor: pointer;
          font-family: 'Inter', sans-serif;
          transition: all .15s;
          white-space: nowrap;
        }
        .tdb-btn:hover {
          background: rgba(192,64,64,.08);
          border-color: rgba(192,64,64,.6);
        }
        .tdb-dismiss {
          background: none;
          border: none;
          color: #3a3630;
          font-size: 14px;
          cursor: pointer;
          padding: 0 2px;
          line-height: 1;
          transition: color .15s;
        }
        .tdb-dismiss:hover { color: #6b6358; }
      `}</style>

      <div className="tdb-wrap">
        <div className="tdb-dot" />
        <div className="tdb-label">Viewing <span>sample data</span></div>
        <button className="tdb-btn" onClick={handleClear}>
          ✕ Clear sample data
        </button>
        <button className="tdb-dismiss" onClick={() => setVisible(false)} title="Dismiss">×</button>
      </div>
    </>
  );
}