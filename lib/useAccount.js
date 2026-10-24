// lib/useAccount.js
// The signed-in account (user, profile, restaurant), loaded once per session
// and kept in the shared SWR cache so pages do not refetch it on every open.
// A page gets the kept copy instantly; SWR refreshes it in the background at
// most once a minute, so the account checks still see status changes.
import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import useSWR, { mutate } from "swr";
import supabase from "./supabaseClient";
import { accountGuardDecision } from "./enforceAccountGuard";
import { getScannerKey } from "./scannerKey";

// Browser copy of the account, so a refreshed page can start loading its
// data without waiting on the account lookup. Only the fields the main
// pages need to start are kept, never the full rows. Wiped on sign-out,
// when a different user signs in, and after 24 hours. The live lookup
// still runs every time and replaces it, and every data query is checked
// by row-level security on the server either way.
const CACHE_KEY = "om_account_v1";
const CACHE_MAX_AGE = 24 * 60 * 60 * 1000;

function writeCache(a) {
  try {
    if (!a?.user?.id || !a.profile) { localStorage.removeItem(CACHE_KEY); return; }
    const r = a.restaurant;
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      savedAt: Date.now(),
      userId: a.user.id,
      account: {
        user: { id: a.user.id },
        profile: { id: a.profile.id, restaurant_id: a.profile.restaurant_id || null, full_name: a.profile.full_name || "", role: a.profile.role || null },
        restaurant: r ? { id: r.id, name: r.name, target_food_cost: r.target_food_cost ?? null, created_at: r.created_at || null } : null,
      },
    }));
  } catch {}
}

function readCache() {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    if (!c || !c.userId || !c.savedAt || Date.now() - c.savedAt > CACHE_MAX_AGE) return null;
    return c;
  } catch {
    return null;
  }
}

function clearCache() {
  try { localStorage.removeItem(CACHE_KEY); } catch {}
}

// One listener for the whole app: any sign-out (from any page's button)
// wipes the copy, and so does a session that belongs to a different user.
if (typeof window !== "undefined") {
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT" || !session?.user) { clearCache(); return; }
    const c = readCache();
    if (c && c.userId !== session.user.id) clearCache();
  });
}

// null means nobody is signed in.
async function fetchAccount() {
  // Reads the saved login from this browser instead of asking the auth
  // server (getUser was a full round trip before anything else could start).
  // Every data query is still checked by row-level security on the server,
  // so a revoked login gets nothing back either way.
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user || null;
  if (!user) return null;

  // Profile and restaurant in one request.
  const { data: joined, error: joinError } = await supabase
    .from("profiles").select("*, restaurant:restaurant_id(*)").eq("id", user.id).single();
  if (!joinError && joined) {
    const { restaurant = null, ...profile } = joined;
    return { user, profile, restaurant: profile.restaurant_id ? restaurant : null };
  }

  // Fallback: the original two-step lookup, if the join is not available.
  const { data: profile, error: profileError } = await supabase
    .from("profiles").select("*").eq("id", user.id).single();
  if (profileError) throw profileError;
  if (!profile?.restaurant_id) return { user, profile, restaurant: null };

  const { data: restaurant, error: restaurantError } = await supabase
    .from("restaurants").select("*").eq("id", profile.restaurant_id).single();
  if (restaurantError) throw restaurantError;

  return { user, profile, restaurant };
}

export function useAccount() {
  return useSWR(
    "account",
    async () => {
      const account = await fetchAccount();
      if (account) writeCache(account); else clearCache();
      return account;
    },
    { dedupingInterval: 60000, revalidateOnFocus: false }
  );
}

// useAccount plus the same account checks as enforceAccountGuard. Returns
// account: null (and loading: true) until the account is loaded and allowed
// on this page; a blocked account is redirected.
export function useGuardedAccount(options) {
  const router = useRouter();
  const { data, error, mutate, isValidating } = useAccount();
  const { instant = false, ...guardOptions } = options || {};

  // Pages that pass { instant: true } get the browser copy while the live
  // lookup runs. Read after mount so the first render matches the
  // server-rendered page (no hydration mismatch).
  const [cached, setCached] = useState(null);
  useEffect(() => {
    if (!instant) return;
    const c = readCache();
    if (
      c?.account?.restaurant &&
      Object.prototype.hasOwnProperty.call(c.account.profile || {}, "role") &&
      c.account.profile.role !== "admin"
    ) {
      setCached(c.account);
    }
  }, [instant]);

  let decision = null;
  // Nobody signed in: a scanner's phone goes to its scan screen, anyone else to login.
  if (data === null) decision = { redirect: getScannerKey() ? "/client/scan" : "/client/login" };
  else if (data?.profile?.role === "admin") decision = { redirect: "/admin" };
  else if (data?.restaurant) decision = accountGuardDecision(data.restaurant, options ? guardOptions : options);
  // Only redirect on a fresh copy. The shared cache can hold an older account
  // (from before checkout or onboarding finished), and acting on it sent a
  // just-onboarded user to the wrong page. While the fresh copy loads, the
  // page shows its loading state instead of redirecting.
  const pendingRedirect = decision?.redirect || null;
  const redirect = pendingRedirect && !isValidating ? pendingRedirect : null;
  const signOut = !!decision?.signOut;

  useEffect(() => {
    if (!redirect) return;
    (async () => {
      if (signOut) await supabase.auth.signOut();
      router.push(redirect);
    })();
  }, [redirect, signOut]); // eslint-disable-line react-hooks/exhaustive-deps

  // Live account not back yet: start from the browser copy. The account
  // checks above run as soon as the live copy arrives.
  if (data === undefined && !error && cached) {
    return { account: cached, loading: false, error: null, refreshAccount: mutate, fromCache: true };
  }

  return {
    account: data && !pendingRedirect ? data : null,
    loading: (!data && !error) || !!pendingRedirect,
    error: error ? error.message || "Could not load your account" : null,
    refreshAccount: mutate,
  };
}

// Drops the kept copies of the named pages (their cache keys start with
// these names), so their next visit loads fresh. Used after changes that
// affect other pages: an invoice upload or link changes prices and
// inventory everywhere.
export function clearCachedPages(names) {
  return mutate((key) => Array.isArray(key) && names.includes(key[0]), undefined, { revalidate: false });
}