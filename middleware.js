// middleware.js  — place this in your PROJECT ROOT (same level as package.json)
// Protects all /admin/* routes. Runs on the edge before any page loads.
// Checks Supabase session + role === 'admin'. Redirects everyone else.

import { createMiddlewareSupabaseClient } from '@supabase/auth-helpers-nextjs';
import { NextResponse } from 'next/server';

export async function middleware(req) {
  const res = NextResponse.next();
  const { pathname } = req.nextUrl;

  // ── Only run on /admin routes ────────────────────────────────────────────
  if (!pathname.startsWith('/admin')) return res;

  // ── Allow the login page through (avoids redirect loop) ──────────────────
  if (pathname === '/admin/login') return res;

  try {
    const supabase = createMiddlewareSupabaseClient({ req, res });

    // Refresh session if expired
    const { data: { session } } = await supabase.auth.getSession();

    // No session → redirect to admin login
    if (!session) {
      const loginUrl = new URL('/admin/login', req.url);
      loginUrl.searchParams.set('redirected', '1');
      return NextResponse.redirect(loginUrl);
    }

    // Check role in profiles table
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', session.user.id)
      .single();

    // Not admin → redirect to client dashboard with error
    if (!profile || profile.role !== 'admin') {
      const url = new URL('/client/dashboard', req.url);
      url.searchParams.set('error', 'unauthorized');
      return NextResponse.redirect(url);
    }

    // Admin confirmed — attach role to request headers for API routes
    res.headers.set('x-user-role', 'admin');
    res.headers.set('x-user-id', session.user.id);
    return res;

  } catch (err) {
    console.error('[middleware] Admin auth error:', err);
    return NextResponse.redirect(new URL('/admin/login', req.url));
  }
}

export const config = {
  matcher: ['/admin/:path*'],
};