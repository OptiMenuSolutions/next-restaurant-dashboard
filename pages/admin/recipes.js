import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import AdminShell, { PageHead } from '../../components/admin/AdminShell';
import { useAdminFetch } from '../../lib/admin/useAdminFetch';
import RecipeWorkspace from '../../components/client/RecipeWorkspace';
import useIsPhone from '../../lib/admin/useIsPhone';

const MONO = "'IBM Plex Mono', ui-monospace, monospace";

const METHOD_WORD = {
  upload: 'Uploaded',
  assisted: 'Work with OptiMenu',
  manual: 'Built by the owner',
};

function RestaurantPicker() {
  const { adminFetch } = useAdminFetch();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    let active = true;

    adminFetch('/api/admin/recipe-restaurants')
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Could not load restaurants');
        if (active) setRows(json.restaurants);
      })
      .catch((e) => { if (active) setError(e.message); });

    return () => { active = false; };
  }, [adminFetch]);

  if (error) return <p role="alert" style={{ margin: 0, color: 'var(--red)', fontSize: 13.5 }}>{error}</p>;
  if (!rows) return <p role="status" style={{ margin: 0, color: 'var(--muted)', fontSize: 13.5 }}>Loading restaurants…</p>;

  const q = query.trim().toLowerCase();
  const shown = q ? rows.filter((r) => r.name.toLowerCase().includes(q)) : rows;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <input
        className="om-field"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search restaurants"
        aria-label="Search restaurants"
        style={{ maxWidth: 420 }}
      />

      <section style={{ border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden' }}>
        {shown.length === 0 && (
          <div style={{ padding: 18, fontSize: 13.5, color: 'var(--muted)' }}>No restaurants match.</div>
        )}

        {shown.map((r, i) => (
          <Link
            key={r.id}
            href={`/admin/recipes?restaurant=${r.id}`}
            style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderTop: i ? '1px solid var(--line-soft)' : 0, color: 'var(--text)', textDecoration: 'none' }}
          >
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
              <span style={{ display: 'block', marginTop: 2, fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.08em', color: 'var(--muted)', textTransform: 'uppercase' }}>
                {[r.method ? METHOD_WORD[r.method] : 'Not started', r.closed ? 'Closed' : null].filter(Boolean).join(' · ')}
              </span>
            </span>
            {r.followUp && (
              <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', borderRadius: 5, padding: '3px 7px', whiteSpace: 'nowrap', background: 'var(--amber-tint, #fbf3e2)', color: 'var(--amber)' }}>
                FOLLOW-UP OPEN
              </span>
            )}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, color: 'var(--faint)' }}>
              <path d="M9 6l6 6-6 6" />
            </svg>
          </Link>
        ))}
      </section>
    </div>
  );
}

export default function RecipesPage() {
  const router = useRouter();
  const isPhone = useIsPhone();

  const restaurantId = typeof router.query.restaurant === 'string'
    ? router.query.restaurant
    : null;

  const restaurantHref = restaurantId
    ? `/admin/restaurants/${restaurantId}`
    : '/admin/restaurants';

  return (
    <AdminShell
      section="Restaurants"
      sub="All restaurants"
      title="Recipes & prep"
      back={isPhone ? { label: 'Restaurant', href: restaurantHref } : undefined}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        {!isPhone && (
          <a href={restaurantHref} style={{ display: 'inline-flex', alignItems: 'center', gap: 2, alignSelf: 'flex-start', fontSize: 13, fontWeight: 700, color: 'var(--accent-deep)' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
            Restaurant
          </a>
        )}
        <PageHead
          kicker="RESTAURANTS · RECIPES & PREP"
          title="Recipes & prep"
          sub="The same recipe workspace the owner sees. Changes stay drafts until confirmed, and confirmed recipes are never overwritten."
        />
        {restaurantId ? (
          <RecipeWorkspace restaurantId={restaurantId} admin showHeading={false} />
        ) : (
          <RestaurantPicker />
        )}
      </div>
    </AdminShell>
  );
}