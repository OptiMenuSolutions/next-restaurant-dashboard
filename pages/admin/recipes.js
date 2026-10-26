import { useRouter } from 'next/router';
import AdminShell, { PageHead } from '../../components/admin/AdminShell';
import RecipeWorkspace from '../../components/client/RecipeWorkspace';
import useIsPhone from '../../lib/admin/useIsPhone';

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
          <p style={{ margin: 0, color: 'var(--muted)', fontSize: 13.5 }}>
            Open recipe setup from the restaurant’s follow-up ticket.
          </p>
        )}
      </div>
    </AdminShell>
  );
}