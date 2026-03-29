// components/ProfileDropdown.js
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import supabase from '../lib/supabaseClient';

const DROPDOWN_CSS = `
  .pd-wrap { position: relative; display: inline-block; }
  .pd-avatar { width: clamp(22px,1.8vw,30px); height: clamp(22px,1.8vw,30px); border-radius: 50%; background: #02a4ba; display: flex; align-items: center; justify-content: center; font-size: clamp(8px,.65vw,11px); font-weight: 700; color: #0a0908; cursor: pointer; flex-shrink: 0; border: 2px solid transparent; transition: border-color .15s; user-select: none; }
  .pd-avatar:hover { border-color: rgba(2,164,186,.4); }
  .pd-avatar.open { border-color: #02a4ba; }
  .pd-menu { position: absolute; top: calc(100% + 8px); right: 0; background: #13120f; border: 1px solid #2a2620; border-radius: 10px; width: 220px; overflow: hidden; box-shadow: 0 8px 24px rgba(0,0,0,.5); z-index: 200; animation: pd-fade-in .12s ease; }
  @keyframes pd-fade-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
  .pd-user { padding: 12px 14px; border-bottom: 1px solid #2a2620; }
  .pd-name { font-size: 13px; font-weight: 600; color: #e8e2d8; font-family: 'Inter', sans-serif; }
  .pd-email { font-size: 11px; color: #4a453e; margin-top: 2px; font-family: 'Inter', sans-serif; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pd-plan { display: inline-block; font-size: 9px; font-weight: 600; padding: 2px 7px; border-radius: 8px; background: rgba(2,164,186,.1); color: #02a4ba; margin-top: 5px; text-transform: uppercase; letter-spacing: .5px; font-family: 'Inter', sans-serif; }
  .pd-items { padding: 6px; }
  .pd-item { display: flex; align-items: center; gap: 10px; padding: 9px 10px; border-radius: 7px; cursor: pointer; transition: background .15s; text-decoration: none; border: none; background: none; width: 100%; text-align: left; }
  .pd-item:hover { background: #1a1915; }
  .pd-item svg { width: 15px; height: 15px; stroke: #6b6358; fill: none; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; flex-shrink: 0; transition: stroke .15s; }
  .pd-item:hover svg { stroke: #02a4ba; }
  .pd-item-label { font-size: 13px; color: #9a9086; font-family: 'Inter', sans-serif; transition: color .15s; }
  .pd-item:hover .pd-item-label { color: #e8e2d8; }
  .pd-divider { height: 1px; background: #2a2620; margin: 4px 0; }
  .pd-item.danger:hover svg { stroke: #c04040; }
  .pd-item.danger:hover .pd-item-label { color: #c04040; }

  /* Mobile avatar size override */
  .mob-pd-avatar { width: 30px; height: 30px; font-size: 11px; }
`;

function getUserInitials(name) {
  if (!name) return 'U';
  return name.split(' ').map(p => p.charAt(0)).join('').substring(0, 2).toUpperCase();
}

export default function ProfileDropdown({ userName, userEmail, isMobile = false }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Close on outside click
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

  const avatarSize = isMobile
    ? { width: 30, height: 30, fontSize: 11 }
    : {};

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