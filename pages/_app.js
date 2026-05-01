// pages/_app.js
import '../styles/globals.css';
import { useEffect } from 'react';
import { registerServiceWorker } from '../lib/registerSW';
import '../styles/tour.css';
import { ThemeProvider } from '../lib/ThemeContext';
import { THEMES } from '../lib/theme';
import Head from 'next/head';

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

  return <Component {...pageProps} />;
}

export default function App({ Component, pageProps }) {
  return (
    <>
      <Head>
        {/* Blocking script runs before paint — eliminates theme flash */}
        <script dangerouslySetInnerHTML={{ __html: ANTI_FLASH_SCRIPT }} />
      </Head>
      <ThemeProvider>
        <Component {...pageProps} />
      </ThemeProvider>
    </>
  );
}