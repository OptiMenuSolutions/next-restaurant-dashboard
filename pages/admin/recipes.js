import { useRouter } from 'next/router';
import AdminShell from '../../components/admin/AdminShell';
import RecipeWorkspace from '../../components/client/RecipeWorkspace';

export default function RecipesPage() {
  const router = useRouter();

  const restaurantId = typeof router.query.restaurant === 'string'
    ? router.query.restaurant
    : null;

  return (
    <AdminShell
      section="Restaurants"
      sub="All restaurants"
      title="Recipes & prep"
    >
      {restaurantId ? (
        <RecipeWorkspace restaurantId={restaurantId} admin />
      ) : (
        <p>
          Open recipe setup from the restaurant follow-up ticket.
        </p>
      )}
    </AdminShell>
  );
}