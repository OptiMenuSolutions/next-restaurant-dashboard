// components/admin/AdminShell.js
// The frame around every new admin page: top bar with the section pills,
// the section's sub-tabs, search (⌘K) and the account menu. Same tokens and
// fonts as the client side (ClientChrome), so both halves match.
//
// It also guards the page: children only render once the signed-in user is
// confirmed as an admin. Anyone else goes to /admin/login.
//
// Sections still pointing at old pages (/admin/feedback, /admin/prices and
// so on) get switched to their new page as each one is built.

import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import supabase from '../../lib/supabaseClient';
import { CSS, FONT_LINKS, MONO, PAGE_PAD, useTheme, LoadingState, SearchIcon } from '../client/ClientChrome';
import AdminSearch from './AdminSearch';
import { useAdminFetch } from '../../lib/admin/useAdminFetch';

export const SECTIONS = [
  { label: 'Today', href: '/admin', subs: [['Today', '/admin'], ['All tickets', '/admin/tickets']] },
  { label: 'Restaurants', href: '/admin/restaurants', subs: [['All restaurants', '/admin/restaurants'], ['Support inbox', '/admin/support'], ['Tag kits', '/admin/tags']] },
  { label: 'Sales', href: '/admin/pipeline', subs: [['Pipeline', '/admin/pipeline'], ['Calendar', '/admin/calendar'], ['Testimonials', '/admin/testimonials']] },  { label: 'Restaurants', href: '/admin/restaurants', subs: [['All restaurants', '/admin/restaurants'], ['Support inbox', '/admin/support'], ['Tag kits', '/admin/tags']] },
  { label: 'Data quality', href: '/admin/review', subs: [['Review queue', '/admin/review'], ['Cost approvals', '/admin/costs'], ['Ingredient library', '/admin/ingredients']] },
  { label: 'Platform', href: '/admin/pos', subs: [['POS connections', '/admin/pos'], ['AI & parsing', '/admin/ai'], ['Jobs & health', '/admin/health']] },
  { label: 'Business', href: '/admin/revenue', subs: [['Revenue & billing', '/admin/revenue'], ['Expenses & deadlines', '/admin/finances'], ['Settings', '/admin/settings']] },
];

// Extra tokens the admin uses on top of ClientChrome's.
const ADMIN_CSS = `
.om-app{--green-tint:#e9f5ec;--amber-tint:#fbf3e2;--red-tint:#fbeceb;--on-accent:#ffffff}
.om-app[data-theme="dark"],html[data-om-theme="dark"] .om-app{--green-tint:#1a2a1f;--amber-tint:#2a2214;--red-tint:#2b1a18;--on-accent:#0e1516}
.om-pill:hover{color:var(--text) !important}
.om-btn{min-height:36px;padding:0 15px;border-radius:18px;border:1px solid var(--line);background:var(--shell);font:600 12.5px 'Manrope',sans-serif;color:var(--text);cursor:pointer;white-space:nowrap;display:inline-flex;align-items:center;gap:6px}
.om-btn:hover{border-color:var(--accent)}
.om-btn:disabled{opacity:.5;cursor:default}
.om-pri{min-height:36px;padding:0 16px;border-radius:18px;border:0;background:var(--accent-deep);font:700 12.5px 'Manrope',sans-serif;color:var(--on-accent);cursor:pointer;white-space:nowrap;display:inline-flex;align-items:center;gap:6px}
.om-pri:disabled{opacity:.5;cursor:default}
.om-field{min-height:38px;border:1px solid var(--line);border-radius:8px;padding:0 10px;background:var(--shell);color:var(--text);font:500 13.5px 'Manrope',sans-serif;width:100%}
.om-field:focus{outline:2px solid var(--accent);outline-offset:-1px}
.om-app a.om-btn,.om-app a.om-btn:hover{color:var(--text)}
.om-app a.om-pri,.om-app a.om-pri:hover{color:var(--on-accent)}
`;

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] || 'A').toUpperCase() + (parts[1]?.[0] || '').toUpperCase();
}

export default function AdminShell({ section, sub, title, children }) {
  const router = useRouter();
  const [theme, toggleTheme] = useTheme();
  const [me, setMe] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [badges, setBadges] = useState({});
  const { adminFetch } = useAdminFetch();

  // Admins only.
  useEffect(() => {
    let alive = true;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace('/admin/login'); return; }
      const { data: profile } = await supabase.from('profiles').select('role, full_name, email').eq('id', session.user.id).single();
      if (!profile || profile.role !== 'admin') { router.replace('/admin/login'); return; }
      if (alive) setMe({ name: profile.full_name || profile.email || 'Admin' });
    })();
    return () => { alive = false; };
  }, [router]);

  // ⌘K / Ctrl+K opens search from anywhere.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Open to-dos per section, for the counts on the section pills.
  useEffect(() => {
    if (!me) return undefined;
    let alive = true;
    adminFetch('/api/admin/badges').then((r) => r.json()).then((j) => { if (alive && j.badges) setBadges(j.badges); }).catch(() => {});
    return () => { alive = false; };
  }, [me, adminFetch, router.asPath]);

  async function signOut() {
    await supabase.auth.signOut();
    router.push('/admin/login');
  }

  const cur = SECTIONS.find((s) => s.label === section);
  const first = String(me?.name || '').split(/\s+/)[0];

  return (
    <div className="om-app" data-theme={theme} style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Head>
        <title>{`${title || section || 'Admin'} · OptiMenu Admin`}</title>
        <meta name="robots" content="noindex, nofollow" />
        {FONT_LINKS}
      </Head>
      <style>{CSS + ADMIN_CSS}</style>

      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, padding: `9px ${PAGE_PAD}`, borderBottom: '1px solid var(--line)', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0, flexWrap: 'wrap' }}>
          <Link href="/admin" style={{ display: 'flex' }} aria-label="Admin home">
            <img className="om-logo-light" src="/landing/logo.png" alt="optiMenu Solutions" style={{ height: 22, width: 'auto' }} />
            <img className="om-logo-dark" src="/landing/logo-knockout.png" alt="optiMenu Solutions" style={{ height: 22, width: 'auto' }} />
          </Link>
          <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 600, letterSpacing: '0.16em', color: 'var(--shell)', background: 'var(--text)', borderRadius: 4, padding: '3px 6px' }}>ADMIN</span>
          <nav aria-label="Admin sections" style={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
            {SECTIONS.map((s) => {
              const on = s.label === section;
              return (
                <Link key={s.label} href={s.href} className="om-pill" aria-current={on ? 'page' : undefined}
                  style={{ fontSize: 12.5, whiteSpace: 'nowrap', borderRadius: 16, padding: '5px 11px', fontWeight: on ? 700 : 500, color: on ? 'var(--text)' : 'var(--muted)', background: on ? 'var(--accent-tint)' : 'transparent' }}>
                  {s.label}
                  {badges[s.label] ? <span aria-label={`${badges[s.label]} open`} style={{ marginLeft: 6, fontFamily: MONO, fontSize: 10.5, fontWeight: 700, borderRadius: 8, padding: '1px 6px', background: 'var(--text)', color: 'var(--shell)' }}>{badges[s.label]}</span> : null}
                </Link>
              );
            })}
          </nav>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: MONO, fontSize: 12, letterSpacing: '0.08em', color: 'var(--accent-deep)' }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--accent)', animation: 'om-blink 2.4s infinite' }} />
            PROD
          </span>
          <button type="button" onClick={() => setSearchOpen(true)} title="Search (⌘K)" aria-label="Search"
            style={{ display: 'flex', alignItems: 'center', gap: 8, height: 32, padding: '0 10px', border: '1px solid var(--line)', borderRadius: 16, background: 'none', cursor: 'pointer', color: 'var(--faint)' }}>
            <SearchIcon size={14} />
            <span style={{ fontFamily: MONO, fontSize: 11 }}>⌘K</span>
          </button>
          <div style={{ position: 'relative', paddingLeft: 12, borderLeft: '1px solid var(--line)' }}>
            <button type="button" onClick={() => setMenuOpen((v) => !v)} aria-expanded={menuOpen}
              style={{ display: 'flex', alignItems: 'center', gap: 9, padding: 3, border: `1.5px solid ${menuOpen ? 'var(--accent)' : 'transparent'}`, borderRadius: 20, background: 'none', cursor: 'pointer', color: 'var(--text)' }}>
              <span style={{ width: 26, height: 26, borderRadius: '50%', background: 'var(--accent-deep)', color: 'var(--on-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11.5, fontWeight: 700 }}>{initials(me?.name)}</span>
              <span style={{ fontSize: 12.5, fontWeight: 600 }}>{first}</span>
            </button>
            {menuOpen && (
              <>
                <div onClick={() => setMenuOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 199 }} />
                <div style={{ position: 'absolute', top: 'calc(100% + 8px)', right: 0, width: 220, background: 'var(--shell)', border: '1px solid var(--line)', borderRadius: 10, boxShadow: 'var(--shadow-lg)', zIndex: 200, padding: 6 }}>
                  <button type="button" onClick={toggleTheme} style={menuItem}>
                    <span style={{ flex: 1 }}>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
                    <span style={{ width: 34, height: 19, borderRadius: 10, border: '1px solid var(--line)', position: 'relative', background: theme === 'dark' ? 'var(--accent)' : 'var(--line)' }}>
                      <span style={{ position: 'absolute', top: 1, left: theme === 'dark' ? 16 : 1, width: 15, height: 15, borderRadius: '50%', background: '#fff', transition: 'left .2s' }} />
                    </span>
                  </button>
                  <Link href="/admin/old" style={menuItem}>Old admin</Link>
                  <div style={{ height: 1, background: 'var(--line-soft)', margin: '4px 0' }} />
                  <button type="button" onClick={signOut} style={{ ...menuItem, color: 'var(--red)' }}>Sign out</button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {cur?.subs?.length > 0 && (
        <nav aria-label="Section pages" style={{ display: 'flex', gap: 22, padding: `0 ${PAGE_PAD}`, borderBottom: '1px solid var(--line)', overflowX: 'auto' }}>
          {cur.subs.map(([label, href]) => {
            const on = label === sub;
            return (
              <Link key={label} href={href} aria-current={on ? 'page' : undefined}
                style={{ padding: '12px 0 10px', fontSize: 13, whiteSpace: 'nowrap', fontWeight: on ? 700 : 500, color: on ? 'var(--text)' : 'var(--muted)', borderBottom: `2px solid ${on ? 'var(--accent)' : 'transparent'}` }}>
                {label}
              </Link>
            );
          })}
        </nav>
      )}

      {me ? (
        <main style={{ flex: 1, padding: `24px ${PAGE_PAD} 56px`, display: 'flex', flexDirection: 'column', gap: 24 }}>
          {children}
        </main>
      ) : (
        <LoadingState label="Checking access…" />
      )}

      <AdminSearch open={searchOpen} onClose={() => setSearchOpen(false)} onToggleTheme={toggleTheme} />
    </div>
  );
}

const menuItem = {
  width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 7,
  border: 0, background: 'none', cursor: 'pointer', textAlign: 'left',
  fontFamily: "'Manrope', sans-serif", fontSize: 13, fontWeight: 500, color: 'var(--text)',
};

// Small shared pieces for admin pages.
export function PageHead({ kicker, title, sub, children }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 16 }}>
      <div style={{ flex: '1 1 320px' }}>
        {kicker && <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.16em', color: 'var(--muted)' }}>{kicker}</div>}
        <h1 style={{ margin: '6px 0 0', fontSize: 26, fontWeight: 800, letterSpacing: '-0.03em' }}>{title}</h1>
        {sub && <p style={{ margin: '6px 0 0', color: 'var(--muted)', fontSize: 14 }}>{sub}</p>}
      </div>
      {children && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{children}</div>}
    </div>
  );
}

export function Dialog({ title, sub, onClose, children, width = 460 }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 300, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '70px 20px', overflowY: 'auto', background: 'rgba(17,24,25,0.42)' }}>
      <div role="dialog" aria-modal="true" aria-label={title}
        style={{ width: '100%', maxWidth: width, background: 'var(--shell)', borderRadius: 16, boxShadow: 'var(--shadow-lg)', padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>{title}</h2>
          {sub && <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--muted)' }}>{sub}</p>}
        </div>
        {children}
      </div>
    </div>
  );
}