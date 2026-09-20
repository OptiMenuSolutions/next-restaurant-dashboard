// lib/enforceAccountGuard.js
// Every real data page was only checking restaurants.deactivated_at before
// rendering — nothing checked whether the account had actually paid or
// finished onboarding. login.js enforced that funnel order (checkout ->
// onboarding -> dashboard), but that's only ever checked at the moment of
// logging in. A still-valid session could reach /client/dashboard directly
// — by URL, a bookmark, or (as found) clicking "Back" on checkout before
// paying and landing somewhere that let onboarding finish anyway — and
// once there, nothing ever re-checked it. This is the shared fix: every
// guarded page calls this once, and it enforces deactivation + payment +
// onboarding status uniformly, so there's exactly one place this logic
// lives instead of seven copies that could quietly drift out of sync with
// each other over time.
//
// Usage: const restaurant = await enforceAccountGuard(supabase, router, restaurantId);
// if (!restaurant) return; // already redirected, stop the rest of this effect
//
// Pass { requireSubscription: false } from onboarding.js (still requires
// payment + not-deactivated, but obviously can't require onboarding
// already being done). Pass { requireOnboarding: false } is not needed
// anywhere else right now, but is offered for the same reason.
// A subscription in any of these statuses has no active billing relationship
// at all — treated identically to never having subscribed in the first
// place, so the person is sent to start a BRAND NEW subscription, not to
// the payment-failed retry page (there's nothing to retry).
const NEEDS_NEW_SUBSCRIPTION_STATUSES = ["canceled", "unpaid", "incomplete_expired"];

export async function enforceAccountGuard(supabase, router, restaurantId, options = {}) {
  const {
    requireSubscription = true,
    requireOnboarding = true,
    requireNotDeactivated = true,
    requirePaymentCurrent = true,
  } = options;

  const { data: restaurant } = await supabase
    .from("restaurants")
    .select("*")
    .eq("id", restaurantId)
    .single();

  if (requireNotDeactivated && restaurant?.deactivated_at) {
    await supabase.auth.signOut();
    router.push("/client/login");
    return null;
  }
  if (
    requireSubscription &&
    (!restaurant?.stripe_subscription_id || NEEDS_NEW_SUBSCRIPTION_STATUSES.includes(restaurant?.subscription_status))
  ) {
    router.push("/client/checkout");
    return null;
  }
  // Checked before onboarding — a failed payment blocks everything
  // immediately, regardless of how far setup got.
  if (requirePaymentCurrent && restaurant?.subscription_status === "past_due") {
    router.push("/client/payment-failed");
    return null;
  }
  if (requireOnboarding && !restaurant?.onboarding_completed_at) {
    router.push("/client/onboarding");
    return null;
  }
  return restaurant;
}