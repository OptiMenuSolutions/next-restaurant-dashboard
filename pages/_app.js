// pages/_app.js
import '../styles/globals.css';
import { useEffect } from 'react';
import { registerServiceWorker } from '../lib/registerSW';
import '../styles/tour.css';
import { ThemeProvider } from '../lib/ThemeContext';
import { THEMES } from '../lib/theme';
import Head from 'next/head';
import { Analytics } from '@vercel/analytics/react';
import { mutate } from 'swr';
import supabase from '../lib/supabaseClient';
import { useRouter } from 'next/router';
import { getScannerKey } from '../lib/scannerKey';

// Pages a scanner may open. Login stays open so an owner can still sign in
// on a phone that was used for scanning.
const SCANNER_PAGES = ['/client/scan', '/client/join', '/client/login', '/client/reset-password'];

const ANTI_FLASH_SCRIPT = `
(function() {
  try {
    var saved = localStorage.getItem('optimenu-theme');
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var theme = (saved === 'dark' || saved === 'light') ? saved : (prefersDark ? 'dark' : 'light');
    var tokens = ${JSON.stringify(THEMES)};
    var root = document.documentElement;
    Object.entries(tokens[theme]).forEach(function(entry) {
      root.style.setProperty(entry[0], entry[1]);
    });
    root.setAttribute('data-theme', theme);
  } catch(e) {}
})();
`;

export default function App({ Component, pageProps }) {
  useEffect(() => {
    registerServiceWorker();
  }, []);

  // Kept page data belongs to whoever is signed in. Signing out (from any
  // page, or a session ending) wipes all of it, so the next person on a
  // shared device never sees the previous account. Signing in reloads the
  // account.
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') mutate(() => true, undefined, { revalidate: false });
      if (event === 'SIGNED_IN' || event === 'USER_UPDATED') mutate('account');
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // A scanner's phone (a scanner key, nobody signed in) only ever sees the
  // scan screens. Any other page under /client sends it to /client/scan. An
  // owner signed in on the same phone keeps the owner pages.
  const router = useRouter();
  useEffect(() => {
    const path = router.pathname || '';
    if (!path.startsWith('/client') || SCANNER_PAGES.some((p) => path.startsWith(p))) return;
    if (!getScannerKey()) return;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) router.replace('/client/scan');
    });
  }, [router.pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <Head>
        {/* One viewport for every page. viewport-fit=cover lets the phone app
            run edge to edge; headers pad themselves with env(safe-area-inset-*). */}
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" key="viewport" />
        <script dangerouslySetInnerHTML={{ __html: ANTI_FLASH_SCRIPT }} />
      </Head>
      <ThemeProvider>
        <Component {...pageProps} />
      </ThemeProvider>
      <Analytics />
    </>
  );
}