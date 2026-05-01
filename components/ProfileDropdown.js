// components/ProfileDropdown.js
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import supabase from '../lib/supabaseClient';
import { useTheme } from '../lib/ThemeContext';

const DROPDOWN_CSS = `
  .pd-wrap { position: relative; display: inline-block; }
  .pd-avatar { width: clamp(22px,1.8vw,30px); height: clamp(22px,1.8vw,30px); border-radius: 50%; background: #02a4ba; display: flex; align-items: center; justify-content: center; font-size: clamp(8px,.65vw,11px); font-weight: 700; color: #0a0908; cursor: pointer; flex-shrink: 0; border: 2px solid transparent; transition: border-color .15s; user-select: none; }
  .pd-avatar:hover { border-color: rgba(2,164,186,.4); }
  .pd-avatar.open { border-color: #02a4ba; }
  .pd-menu { position: absolute; top: calc(100% + 8px); right: 0; background: var(--bg-surface); border: 1px solid var(--border); border-radius: 10px; width: 220px; overflow: hidden; box-shadow: 0 8px 24px rgba(0,0,0,.5); z-index: 200; animation: pd-fade-in .12s ease; }
  @keyframes pd-fade-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
  .pd-user { padding: 12px 14px; border-bottom: 1px solid var(--border); }
  .pd-name { font-size: 13px; font-weight: 600; color: var(--text-primary); font-family: 'Inter', sans-serif; }
  .pd-email { font-size: 11px; color: var(--text-muted); margin-top: 2px; font-family: 'Inter', sans-serif; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pd-plan { display: inline-block; font-size: 9px; font-weight: 600; padding: 2px 7px; border-radius: 8px; background: var(--accent-bg); color: var(--accent); margin-top: 5px; text-transform: uppercase; letter-spacing: .5px; font-family: 'Inter', sans-serif; }
  .pd-items { padding: 6px; }
  .pd-item { display: flex; align-items: center; gap: 10px; padding: 9px 10px; border-radius: 7px; cursor: pointer; transition: background .15s; text-decoration: none; border: none; background: none; width: 100%; text-align: left; }
  .pd-item:hover { background: var(--bg-inset); }
  .pd-item svg { width: 15px; height: 15px; stroke: var(--text-muted); fill: none; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; flex-shrink: 0; transition: stroke .15s; }
  .pd-item:hover svg { stroke: var(--accent); }
  .pd-item-label { font-size: 13px; color: var(--text-secondary); font-family: 'Inter', sans-serif; transition: color .15s; }
  .pd-item:hover .pd-item-label { color: var(--text-primary); }
  .pd-divider { height: 1px; background: var(--border); margin: 4px 0; }
  .pd-item.danger:hover svg { stroke: var(--color-red); }
  .pd-item.danger:hover .pd-item-label { color: var(--color-red); }

  /* Theme toggle row */
  .pd-theme-row { display: flex; align-items: center; gap: 10px; padding: 9px 10px; border-radius: 7px; }
  .pd-theme-label { font-size: 13px; color: var(--text-secondary); font-family: 'Inter', sans-serif; flex: 1; }
  .pd-theme-row svg { width: 15px; height: 15px; stroke: var(--text-muted); fill: none; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; flex-shrink: 0; }
  .pd-toggle-track { width: 34px; height: 19px; border-radius: 10px; background: var(--bg-inset); border: 1px solid var(--border); position: relative; cursor: pointer; transition: background .2s, border-color .2s; flex-shrink: 0; }
  .pd-toggle-track.on { background: var(--accent); border-color: var(--accent); }
  .pd-toggle-thumb { position: absolute; top: 2px; left: 2px; width: 13px; height: 13px; border-radius: 50%; background: var(--text-faint); transition: transform .2s, background .2s; }
  .pd-toggle-track.on .pd-toggle-thumb { transform: translateX(15px); background: #fff; }
`;

function getUserInitials(name) {
  if (!name) return 'U';
  return name.split(' ').map(p => p.charAt(0)).join('').substring(0, 2).toUpperCase();
}

export default function ProfileDropdown({ userName, userEmail, isMobile = false }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const { isDark, toggleTheme } = useTheme();

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('touchstart', handleClick);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('touchstart', handleClick);
    };
  }, []);

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push('/client/login');
  }

  const avatarSize = isMobile ? { width: 30, height: 30, fontSize: 11 } : {};

  return (
    <>
      <style>{DROPDOWN_CSS}</style>
      <div className="pd-wrap" ref={ref}>
        <div
          className={`pd-avatar${open ? ' open' : ''}`}
          style={avatarSize}
          onClick={() => setOpen(prev => !prev)}
        >
          {getUserInitials(userName)}
        </div>

        {open && (
          <div className="pd-menu">
            {/* User info */}
            <div className="pd-user">
              <div className="pd-name">{userName || 'User'}</div>
              <div className="pd-email">{userEmail || ''}</div>
              <div className="pd-plan">Founding Member · $59/mo</div>
            </div>

            {/* Menu items */}
            <div className="pd-items">
              <button className="pd-item" onClick={() => { setOpen(false); router.push('/client/profile'); }}>
                <svg viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                <span className="pd-item-label">Profile & Settings</span>
              </button>

              <button className="pd-item" onClick={() => { setOpen(false); router.push('/client/profile?tab=notifications'); }}>
                <svg viewBox="0 0 24 24"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>
                <span className="pd-item-label">Notifications</span>
              </button>

              {/* ── Theme toggle ── */}
              <div className="pd-theme-row">
                {isDark ? (
                  <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="4.22" y1="4.22" x2="6.34" y2="6.34"/><line x1="17.66" y1="17.66" x2="19.78" y2="19.78"/><line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/><line x1="4.22" y1="19.78" x2="6.34" y2="17.66"/><line x1="17.66" y1="6.34" x2="19.78" y2="4.22"/></svg>
                ) : (
                  <svg viewBox="0 0 24 24"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
                )}
                <span className="pd-theme-label">{isDark ? 'Light Mode' : 'Dark Mode'}</span>
                <div
                  className={`pd-toggle-track${!isDark ? ' on' : ''}`}
                  onClick={toggleTheme}
                >
                  <div className="pd-toggle-thumb" />
                </div>
              </div>

              <button className="pd-item" onClick={() => { setOpen(false); router.push('/client/profile?tab=support'); }}>
                <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                <span className="pd-item-label">Support & Feedback</span>
              </button>

              <div className="pd-divider" />

              <button className="pd-item danger" onClick={handleSignOut}>
                <svg viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                <span className="pd-item-label">Sign Out</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}