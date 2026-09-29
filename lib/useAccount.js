// lib/useAccount.js
// The signed-in account (user, profile, restaurant), loaded once per session
// and kept in the shared SWR cache so pages do not refetch it on every open.
// A page gets the kept copy instantly; SWR refreshes it in the background at
// most once a minute, so the account checks still see status changes.
import { useEffect } from "react";
import { useRouter } from "next/router";
import useSWR from "swr";
import supabase from "./supabaseClient";
import { accountGuardDecision } from "./enforceAccountGuard";

// null means nobody is signed in.
async function fetchAccount() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

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
  return useSWR("account", fetchAccount, { dedupingInterval: 60000, revalidateOnFocus: false });
}

// useAccount plus the same account checks as enforceAccountGuard. Returns
// account: null (and loading: true) until the account is loaded and allowed
// on this page; a blocked account is redirected.
export function useGuardedAccount(options) {
  const router = useRouter();
  const { data, error, mutate } = useAccount();

  let decision = null;
  if (data === null) decision = { redirect: "/client/login" };
  else if (data?.restaurant) decision = accountGuardDecision(data.restaurant, options);
  const redirect = decision?.redirect || null;
  const signOut = !!decision?.signOut;

  useEffect(() => {
    if (!redirect) return;
    (async () => {
      if (signOut) await supabase.auth.signOut();
      router.push(redirect);
    })();
  }, [redirect, signOut]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    account: data && !redirect ? data : null,
    loading: (!data && !error) || !!redirect,
    error: error ? error.message || "Could not load your account" : null,
    refreshAccount: mutate,
  };
}