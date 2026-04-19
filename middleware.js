// middleware.js — place in PROJECT ROOT (same level as package.json)
// Protects all /admin/* routes at the edge.
// Checks Supabase session + role === 'admin'. Redirects everyone else.

import { createServerClient, parse, serialize } from '@supabase/auth-helpers-nextjs';
import { NextResponse } from 'next/server';

export async function middleware(req) {
  const res = NextResponse.next();
  const { pathname } = req.nextUrl;

  if (!pathname.startsWith('/admin')) return res;
  if (pathname === '/admin/login') return res;

  try {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      {
        cookies: {
          get(name) {
            const cookies = parse(req.headers.get('cookie') ?? '');
            return cookies[name];
          },
          set(name, value, options) {
            res.headers.append('Set-Cookie', serialize(name, value, options));
          },
          remove(name, options) {
            res.headers.append('Set-Cookie', serialize(name, '', { ...options, maxAge: 0 }));
          },
        },
      }
    );

    const { data: { session } } = await supabase.auth.getSession();

    if (!session) {
      const loginUrl = new URL('/admin/login', req.url);
      loginUrl.searchParams.set('redirected', '1');
      return NextResponse.redirect(loginUrl);
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', session.user.id)
      .single();

    if (!profile || profile.role !== 'admin') {
      const url = new URL('/client/dashboard', req.url);
      url.searchParams.set('error', 'unauthorized');
      return NextResponse.redirect(url);
    }

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