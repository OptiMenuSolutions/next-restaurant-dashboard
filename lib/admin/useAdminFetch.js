// lib/admin/useAdminFetch.js
// Hook that wraps fetch() with the admin auth headers automatically.
// Use this in every admin page instead of raw fetch().

import { useCallback } from 'react';
import supabase from '../supabaseClient';

export function useAdminFetch() {
  const adminFetch = useCallback(async (url, options = {}) => {
    // Get current session token
    const { data: { session } } = await supabase.auth.getSession();

    if (!session) {
      throw new Error('No active session');
    }

    const res = await fetch(url, { ...options, headers });

    if (res.status === 401 || res.status === 403) {
      throw new Error('Unauthorized — admin access required');
    }

    return res;
  }, []);

  return { adminFetch };
}