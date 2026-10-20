// pages/staff/[token].js
import { createClient } from '@supabase/supabase-js';
import StaffBriefing from '../../components/staff/StaffBriefing';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// The page only gets the restaurant name and the three tickets. No restaurant
// id goes to the browser. These links keep working until every tag has been
// moved to a /t/<code> link.
export default function StaffPage({ restaurant, cachedRecommendations, token, error }) {
  return (
    <StaffBriefing
      restaurantName={error || !restaurant ? null : restaurant.name}
      cachedRecommendations={cachedRecommendations}
      requestBody={{ nfcToken: token }}
    />
  );
}

export async function getServerSideProps({ params }) {
  const { token } = params;

  // Single RPC covers both the restaurant lookup and today's cached
  // recommendations — see restaurants-schema-fixes.sql. Still zero-
  // authentication, still just needs the token from the URL; closes two
  // previously-exposed anon-read paths (restaurants and ai_recommendations)
  // in one motion instead of leaving either open.
  const { data: rows, error: briefingError } = await supabase
    .rpc('get_staff_briefing', { token });

  const briefing = rows?.[0];

  if (briefingError || !briefing) {
    return { props: { error: true, restaurant: null, cachedRecommendations: [], token: null } };
  }

  return {
    props: {
      restaurant: { name: briefing.restaurant_name },
      // Only what the ticket shows. No restaurant id, no operator notes.
      cachedRecommendations: (briefing.recommendations ?? []).slice(0, 3).map((r) => ({
        title: r?.title ?? null,
        description: r?.description ?? null,
        talking_point: r?.talking_point ?? null,
      })),
      token,
      error: false,
    },
  };
}
