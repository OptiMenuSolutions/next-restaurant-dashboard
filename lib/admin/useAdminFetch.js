// lib/admin/useAdminFetch.js
// Wraps fetch() with admin auth headers for all admin API calls.
// Security: relies on Supabase Bearer token + server-side role check.
// NEVER sends ADMIN_SECRET from the browser - that stays server-side only.

import { useCallback } from 'react';
import supabase from './supabaseAdmin';

export function useAdminFetch() {
  const adminFetch = useCallback(async (url, options = {}) => {
    const { data: { session } } = await supabase.auth.getSession();

    if (!session) {
      throw new Error('No active session — please log in again');
    }

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
      ...options.headers,
    };

    const res = await fetch(url, { ...options, headers });

    if (res.status === 401 || res.status === 403) {
      throw new Error('Unauthorized — admin access required');
    }

    return res;
  }, []);

  return { adminFetch };
}