import Head from 'next/head';
import Link from 'next/link';
import { useGuardedAccount } from '../../lib/useAccount';
import {
  Shell,
  FONT_LINKS,
  useTheme,
} from '../../components/client/ClientChrome';
import RecipeWorkspace from '../../components/client/RecipeWorkspace';

export default function RecipesPage() {
  const { account, loading, error } = useGuardedAccount({
    instant: true,
  });
  const [theme] = useTheme();

  return (
    <Shell theme={theme}>
      <Head>
        <title>Recipes &amp; prep · OptiMenu</title>
        {FONT_LINKS}
      </Head>

      <header style={{
        position: 'sticky',
        top: 0,
        zIndex: 10,
        padding: '16px',
        background: 'var(--shell)',
        borderBottom: '1px solid var(--line)',
      }}>
        <Link
          href="/client/profile?tab=restaurant"
          style={{
            color: 'var(--accent-deep)',
            fontWeight: 700,
          }}
        >
          ‹ Profile
        </Link>
      </header>

      <main style={{
        maxWidth: 1200,
        margin: '0 auto',
        padding: '24px 16px 60px',
      }}>
        {error ? (
          <p role="alert">{error.message || String(error)}</p>
        ) : loading || !account?.profile?.restaurant_id ? (
          <p>Loading…</p>
        ) : (
          <RecipeWorkspace
            restaurantId={account.profile.restaurant_id}
          />
        )}
      </main>
    </Shell>
  );
}