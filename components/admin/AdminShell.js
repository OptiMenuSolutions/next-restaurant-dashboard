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
import { Children, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import supabase from '../../lib/supabaseClient';
import { CSS, FONT_LINKS, MONO, PAGE_PAD, useTheme, LoadingState, SearchIcon } from '../client/ClientChrome';
import AdminSearch from './AdminSearch';
import { useAdminFetch } from '../../lib/admin/useAdminFetch';
import useIsPhone from '../../lib/admin/useIsPhone';

export const SECTIONS = [
  { label: 'Today', href: '/admin', subs: [['Today', '/admin'], ['All tickets', '/admin/tickets']] },
  { label: 'Restaurants', href: '/admin/restaurants', subs: [['All restaurants', '/admin/restaurants'], ['Support inbox', '/admin/support'], ['Tag kits', '/admin/tags']] },
  { label: 'Sales', href: '/admin/pipeline', subs: [['Pipeline', '/admin/pipeline'], ['Calendar', '/admin/calendar'], ['Testimonials', '/admin/testimonials']] },
  { label: 'Data quality', href: '/admin/review', subs: [['Review queue', '/admin/review'], ['Cost approvals', '/admin/costs'], ['Ingredient library', '/admin/ingredients']] },
  { label: 'Platform', href: '/admin/pos', subs: [['POS connections', '/admin/pos'], ['Ingredient usage', '/admin/pos-usage'], ['Conversions', '/admin/pos-conversions'], ['AI & parsing', '/admin/ai'], ['Recommendation Lab', '/admin/recommendation-lab'], ['Jobs & health', '/admin/health']] },
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
@media(max-width:720px){
  .om-app{overflow-x:hidden}
  .om-app input,.om-app select,.om-app textarea{font-size:16px !important}
  .om-mobile-subnav::-webkit-scrollbar{display:none}
  .om-phone-sheet .om-pri{width:100%;min-height:44px;justify-content:center}
}
`;

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] || 'A').toUpperCase() + (parts[1]?.[0] || '').toUpperCase();
}

export default function AdminShell({ section, sub, title, children, back, hideBottomNav = false, fixedBack = false }) {
  const isPhone = useIsPhone();
  const router = useRouter();
  const [theme, toggleTheme] = useTheme();
  const [me, setMe] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [badges, setBadges] = useState({});
  const { adminFetch } = useAdminFetch();
  const leaving = useRef(false);

  // Admins must have verified their second factor.
  useEffect(() => {
    let alive = true;
    setMe(null);

    (async () => {
      try {
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        if (!alive) return;
        if (sessionError || !session) {
          router.replace('/client/login');
          return;
        }

        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('role, full_name, email')
          .eq('id', session.user.id)
          .single();

        if (!alive) return;
        if (profileError || profile?.role !== 'admin') {
          router.replace('/client/login');
          return;
        }

        const { data: assurance, error: assuranceError } =
          await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

        if (!alive) return;
        if (assuranceError || assurance?.currentLevel !== 'aal2') {
          router.replace('/admin/verify');
          return;
        }

        setMe({ name: profile.full_name || profile.email || 'Admin' });
      } catch {
        if (alive) router.replace('/client/login');
      }
    })();

    return () => {
      alive = false;
    };
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
    leaving.current = true;
    await supabase.auth.signOut();
    router.replace('/client/login');
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

      {!isPhone && (
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
      )}

      {isPhone && (back ? (
        <header style={{ height: fixedBack ? 40 : 48, minHeight: fixedBack ? 40 : 48, boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', position: fixedBack ? 'fixed' : 'sticky', top: 0, left: fixedBack ? 0 : undefined, right: fixedBack ? 0 : undefined, zIndex: 110, background: 'var(--shell)', borderBottom: '1px solid var(--line)' }}>
          <Link href={back.href} style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--accent-deep)', textDecoration: 'none', fontSize: 14, fontWeight: 700 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
            {back.label}
          </Link>
          {back.actions && <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{back.actions}</div>}
        </header>
      ) : (
        <>
          <header style={{ height: 48, minHeight: 48, boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', position: 'sticky', top: 0, zIndex: 110, background: 'var(--shell)', borderBottom: '1px solid var(--line)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <Link href="/admin" style={{ display: 'flex' }} aria-label="Admin home">
                <img className="om-logo-light" src="/landing/logo.png" alt="optiMenu Solutions" style={{ height: 22, width: 'auto' }} />
                <img className="om-logo-dark" src="/landing/logo-knockout.png" alt="optiMenu Solutions" style={{ height: 22, width: 'auto' }} />
              </Link>
              <span style={{ fontFamily: MONO, fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--shell)', background: 'var(--text)', borderRadius: 3, padding: '3px 5px' }}>ADMIN</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button type="button" onClick={() => setSearchOpen(true)} aria-label="Search"
                style={{ width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--line)', borderRadius: '50%', background: 'transparent', color: 'var(--text)' }}>
                <SearchIcon size={16} />
              </button>
              <button type="button" onClick={() => setMenuOpen(true)} aria-label="Open account menu" aria-expanded={menuOpen}
                style={{ width: 30, height: 30, border: 0, borderRadius: '50%', background: 'var(--accent-deep)', color: 'var(--on-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800 }}>
                {initials(me?.name)}
              </button>
            </div>
          </header>
          {!back && cur?.subs?.length > 0 && (
            <nav aria-label="Section pages" className="om-mobile-subnav"
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 16px', position: 'sticky', top: 48, zIndex: 109, overflowX: 'auto', flexWrap: 'nowrap', whiteSpace: 'nowrap', background: 'var(--shell)', borderBottom: '1px solid var(--line)' }}>
              {cur.subs.map(([label, href]) => {
                const on = label === sub;
                return (
                  <Link key={label} href={href} aria-current={on ? 'page' : undefined}
                    style={{ minHeight: 32, display: 'inline-flex', alignItems: 'center', padding: '0 12px', borderRadius: 18, flexShrink: 0, textDecoration: 'none', fontSize: 12, fontWeight: 700, color: on ? 'var(--shell)' : 'var(--muted)', background: on ? 'var(--text)' : 'transparent' }}>
                    {label}
                  </Link>
                );
              })}
            </nav>
          )}
        </>
      ))}

      {isPhone && menuOpen && <MobileAccountSheet theme={theme} toggleTheme={toggleTheme} onSignOut={signOut} onClose={() => setMenuOpen(false)} />}

      {!isPhone && cur?.subs?.length > 0 && (
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
        <main style={{ flex: 1, padding: isPhone
          ? `${fixedBack ? 56 : 16}px 16px ${hideBottomNav ? '20px' : 'calc(64px + env(safe-area-inset-bottom) + 20px)'}`
          : `24px ${PAGE_PAD} 56px`,
          display: 'flex', flexDirection: 'column', gap: isPhone ? 16 : 24 }}>
          {children}
        </main>
      ) : (
        <LoadingState label="Checking access…" />
      )}

      {isPhone && !hideBottomNav && <MobileBottomNav section={section} badges={badges} />}
      <AdminSearch open={searchOpen} onClose={() => setSearchOpen(false)} onToggleTheme={toggleTheme} />
    </div>
  );
}

function MobileAccountSheet({ theme, toggleTheme, onSignOut, onClose }) {
  return (
    <div onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 450, display: 'flex', alignItems: 'flex-end', background: 'color-mix(in srgb, var(--text) 42%, transparent)' }}>
      <div role="dialog" aria-modal="true" aria-label="Account menu"
        style={{ width: '100%', borderRadius: '20px 20px 0 0', background: 'var(--shell)', padding: '12px 16px calc(16px + env(safe-area-inset-bottom))', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div aria-hidden="true" style={{ width: 40, height: 5, borderRadius: 3, background: 'var(--faint)', opacity: 0.55, alignSelf: 'center', marginBottom: 4 }} />
        <div style={{ fontSize: 16, fontWeight: 800, padding: '4px 2px 8px' }}>Account</div>
        <button type="button" onClick={() => { toggleTheme(); onClose(); }} style={mobileMenuItem}>
          {theme === 'dark' ? 'Light mode' : 'Dark mode'}
        </button>
        <Link href="/admin/old" onClick={onClose} style={mobileMenuItem}>Old admin</Link>
        <button type="button" onClick={onSignOut} style={{ ...mobileMenuItem, color: 'var(--red)' }}>Sign out</button>
      </div>
    </div>
  );
}

function MobileBottomNav({ section, badges }) {
  const icons = {
    Today: <><path d="M4 5h16v15H4z" /><path d="M4 9h16M9 3v4M15 3v4" /></>,
    Restaurants: <><path d="M4 20V9l8-5 8 5v11" /><path d="M9 20v-6h6v6" /></>,
    Sales: <><path d="M4 19l5-6 4 3 7-9" /><path d="M15 7h5v5" /></>,
    Quality: <><path d="M5 12l4 4 10-10" /><path d="M5 20h14" /></>,
    Platform: <><rect x="4" y="4" width="16" height="6" rx="1.5" /><rect x="4" y="14" width="16" height="6" rx="1.5" /><path d="M8 7h.01M8 17h.01" /></>,
    Business: <><path d="M12 3v18M16 7.5c0-1.9-1.8-3-4-3s-4 1.1-4 3 1.8 2.6 4 3 4 1.1 4 3-1.8 3-4 3-4-1.1-4-3" /></>,
  };
  const totalOpen = Object.values(badges || {}).reduce((sum, value) => sum + Number(value || 0), 0);

  return (
    <nav aria-label="Admin sections" className="om-mobile-bottom-nav"
      style={{ position: 'fixed', zIndex: 100, left: 0, right: 0, bottom: 0, height: 64, paddingBottom: 'env(safe-area-inset-bottom)', display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', borderTop: '1px solid var(--line)', background: 'var(--shell)' }}>
      {SECTIONS.map((item) => {
        const label = item.label === 'Data quality' ? 'Quality' : item.label;
        const count = item.label === 'Today' ? totalOpen : Number(badges?.[item.label] || 0);
        const active = item.label === section;
        return (
          <Link key={item.label} href={item.href} aria-label={item.label} aria-current={active ? 'page' : undefined}
            style={{ position: 'relative', minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, textDecoration: 'none', color: active ? 'var(--accent-deep)' : 'var(--faint)', fontSize: 9, fontWeight: active ? 700 : 500 }}>
            <span style={{ position: 'relative', height: 22 }}>
              <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                {icons[label]}
              </svg>
              {count > 0 && <span style={{ position: 'absolute', top: -4, right: -9, minWidth: 14, height: 14, padding: '0 3px', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--accent-deep)', color: 'var(--on-accent)', fontSize: 8, fontWeight: 800 }}>{count > 99 ? '99+' : count}</span>}
            </span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

const mobileMenuItem = {
  minHeight: 44, width: '100%', display: 'flex', alignItems: 'center', padding: '0 12px', border: 0,
  borderRadius: 10, background: 'var(--panel)', color: 'var(--text)', textAlign: 'left', textDecoration: 'none',
  fontFamily: "'Manrope', sans-serif", fontSize: 15, fontWeight: 600,
};

const menuItem = {
  width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 7,
  border: 0, background: 'none', cursor: 'pointer', textAlign: 'left',
  fontFamily: "'Manrope', sans-serif", fontSize: 13, fontWeight: 500, color: 'var(--text)',
};

// Small shared pieces for admin pages.
export function PageHead({ kicker, title, sub, children }) {
  const isPhone = useIsPhone();
  const [moreOpen, setMoreOpen] = useState(false);
  const childList = Children.toArray(children);
  const isAction = (node) => node && typeof node === 'object' && (
    node.type === 'button' || node.type === 'a' ||
    typeof node.props?.onClick === 'function' || node.props?.href != null
  );

  let shownActionCount = 0;
  const visibleChildren = [];
  const overflowActions = [];

  childList.forEach((node) => {
    if (isAction(node)) {
      if (node.props?.['data-mobile-overflow']) {
        overflowActions.push(node);
      } else {
        if (shownActionCount < 2) visibleChildren.push(node);
        else overflowActions.push(node);
        shownActionCount += 1;
      }
    } else {
      visibleChildren.push(node);
    }
  });

  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: isPhone ? 'flex-start' : 'flex-end', gap: isPhone ? 12 : 16 }}>
        <div style={{ flex: isPhone ? '1 1 220px' : '1 1 320px' }}>
          {kicker && <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.16em', color: 'var(--muted)' }}>{kicker}</div>}
          <h1 style={{ margin: '6px 0 0', fontSize: isPhone ? 23 : 26, fontWeight: 800, letterSpacing: '-0.03em' }}>{title}</h1>
          {sub && <p style={{ margin: '6px 0 0', color: 'var(--muted)', fontSize: 14 }}>{sub}</p>}
        </div>
        {children && (
          <div style={{ display: 'flex', flex: '0 1 auto', gap: 8, flexWrap: 'wrap', alignItems: 'center', maxWidth: '100%' }}>
            {isPhone ? visibleChildren : children}
            {isPhone && overflowActions.length > 0 && (
              <button type="button" className="om-btn" aria-label="More page actions" onClick={() => setMoreOpen(true)}
                style={{ minWidth: 40, minHeight: 40, justifyContent: 'center', padding: 0 }}>
                ⋯
              </button>
            )}
          </div>
        )}
      </div>
      {isPhone && moreOpen && (
        <Dialog title="More actions" onClose={() => setMoreOpen(false)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {overflowActions.map((action, i) => (
              <div key={i} onClick={() => setMoreOpen(false)}>{action}</div>
            ))}
          </div>
        </Dialog>
      )}
    </>
  );
}

export function Dialog({ title, sub, onClose, children, width = 460, fullScreen = false, backLabel, showCloseButton = false }) {
  const isPhone = useIsPhone();
  const swipeStartY = useRef(null);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function onTouchEnd(e) {
    const endY = e.changedTouches?.[0]?.clientY;
    if (isPhone && swipeStartY.current !== null && endY - swipeStartY.current > 90) onClose();
    swipeStartY.current = null;
  }

  return (
    <div className={isPhone ? 'om-phone-sheet-scrim' : undefined}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={isPhone
        ? { position: 'fixed', inset: 0, zIndex: 300, display: 'flex', alignItems: fullScreen ? 'stretch' : 'flex-end', justifyContent: 'center', padding: 0, overflow: 'hidden', background: fullScreen ? 'var(--shell)' : 'color-mix(in srgb, var(--text) 42%, transparent)' }
        : { position: 'fixed', inset: 0, zIndex: 300, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '70px 20px', overflowY: 'auto', background: 'rgba(17,24,25,0.42)' }}>
      <div role="dialog" aria-modal="true" aria-label={title}
        onTouchStart={(e) => { swipeStartY.current = e.target.closest?.('[data-sheet-handle]') ? (e.touches?.[0]?.clientY ?? null) : null; }}
        onTouchEnd={onTouchEnd}
        style={isPhone
          ? fullScreen
            ? { width: '100%', maxWidth: '100%', height: '100dvh', maxHeight: '100dvh', overflowY: 'auto', background: 'var(--shell)', borderRadius: 0, boxShadow: 'none', padding: '12px 16px calc(16px + env(safe-area-inset-bottom))', display: 'flex', flexDirection: 'column', gap: 16, touchAction: 'pan-y' }
            : { width: '100%', maxWidth: width, maxHeight: '90dvh', overflowY: 'auto', background: 'var(--shell)', borderRadius: '20px 20px 0 0', boxShadow: 'var(--shadow-lg)', padding: '12px 16px calc(16px + env(safe-area-inset-bottom))', display: 'flex', flexDirection: 'column', gap: 16, touchAction: 'pan-y' }
          : { width: '100%', maxWidth: width, background: 'var(--shell)', borderRadius: 16, boxShadow: 'var(--shadow-lg)', padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {isPhone && !fullScreen && <div data-sheet-handle="" aria-hidden="true" style={{ width: 40, height: 5, borderRadius: 3, background: 'var(--faint)', opacity: 0.55, alignSelf: 'center', marginBottom: 2 }} />}
        {isPhone && fullScreen && backLabel && (
          <div style={{ flexShrink: 0, minHeight: 40, display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--line)' }}>
            <button type="button" onClick={onClose} style={{ display: 'flex', alignItems: 'center', gap: 4, border: 0, background: 'none', color: 'var(--accent-deep)', font: "700 14px 'Manrope',sans-serif", padding: 0 }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
              {backLabel}
            </button>
          </div>
        )}
        <div style={showCloseButton ? { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 } : undefined}>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>{title}</h2>
            {sub && <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--muted)' }}>{sub}</p>}
          </div>
          {showCloseButton && (
            <button type="button" aria-label={`Close ${title}`} onClick={onClose}
              style={{ width: 36, height: 36, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--line)', borderRadius: '50%', background: 'transparent', color: 'var(--muted)', font: "400 24px/1 'Manrope', sans-serif", cursor: 'pointer' }}>
              ×
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

// A yes/no question in the admin's own style, used instead of the browser's confirm box.
export function Confirm({ title, sub, yes = 'Confirm', danger = false, busy = false, onYes, onClose }) {
  const isPhone = useIsPhone();

  return (
    <Dialog title={title} sub={sub} onClose={onClose} width={420}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexDirection: isPhone ? 'column-reverse' : 'row' }}>
        <button type="button" className="om-btn" onClick={onClose}
          style={isPhone ? { width: '100%', minHeight: 44, justifyContent: 'center' } : undefined}>
          Cancel
        </button>
        <button type="button" className={danger ? 'om-btn' : 'om-pri'} disabled={busy} onClick={onYes}
          style={danger
            ? { background: 'var(--red)', borderColor: 'var(--red)', color: isPhone ? 'var(--shell)' : '#fff', width: isPhone ? '100%' : undefined, minHeight: isPhone ? 44 : undefined, justifyContent: isPhone ? 'center' : undefined }
            : isPhone ? { width: '100%', minHeight: 44, justifyContent: 'center' } : undefined}>
          {busy ? 'Working…' : yes}
        </button>
      </div>
    </Dialog>
  );
}