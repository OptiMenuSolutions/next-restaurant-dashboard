import { useGuardedAccount } from '../../lib/useAccount';
import ClientPage from '../../components/client/ClientPage';
import RecipeWorkspace from '../../components/client/RecipeWorkspace';

export default function RecipesPage() {
  const { account, loading, error } = useGuardedAccount({
    instant: true,
  });

  return (
    <ClientPage
      title="Recipes & prep"
      account={account}
      back={{ label: 'Profile · Restaurant', href: '/client/profile?tab=restaurant' }}
      phoneBack={{ label: 'Profile', href: '/client/profile?tab=restaurant', title: 'Recipes' }}
    >
      {error ? (
        <p role="alert" style={{ margin: 0, color: 'var(--red)' }}>
          {error.message || String(error)}
        </p>
      ) : loading || !account?.profile?.restaurant_id ? (
        <p role="status" style={{ margin: 0, color: 'var(--muted)' }}>Loading…</p>
      ) : (
        <RecipeWorkspace
          restaurantId={account.profile.restaurant_id}
        />
      )}
    </ClientPage>
  );
}