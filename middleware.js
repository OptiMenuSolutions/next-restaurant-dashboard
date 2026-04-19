import { NextResponse } from 'next/server';

export async function middleware(req) {
  const { pathname } = req.nextUrl;

  if (!pathname.startsWith('/admin')) return NextResponse.next();
  if (pathname === '/admin/login') return NextResponse.next();

  // Let the page handle auth — each admin page checks session via Supabase client
  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*'],
};