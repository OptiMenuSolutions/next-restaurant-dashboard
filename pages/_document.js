// pages/_document.js
import { Html, Head, Main, NextScript } from 'next/document';

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        {/* ── PWA Core ── */}
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#0a0908" />

        {/* ── iOS PWA Support ── */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="OptiMenu" />

        {/* Apple touch icons — iOS uses these instead of manifest icons */}
        <link rel="apple-touch-icon" href="/icons/icon-192x192.png" />
        <link rel="apple-touch-icon" sizes="152x152" href="/icons/icon-152x152.png" />
        <link rel="apple-touch-icon" sizes="144x144" href="/icons/icon-144x144.png" />

        {/* ── Standard favicon ── */}
        <link rel="icon" type="image/png" sizes="32x32" href="/icons/icon-96x96.png" />
        <link rel="icon" type="image/png" sizes="16x16" href="/icons/icon-72x72.png" />
        <link rel="shortcut icon" href="/icons/icon-192x192.png" />

        {/* ── Mobile meta ── */}
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="format-detection" content="telephone=no" />
        <meta name="msapplication-TileColor" content="#0a0908" />
        <meta name="msapplication-TileImage" content="/icons/icon-144x144.png" />

        {/* ── SEO / Open Graph ── */}
        <meta name="description" content="Restaurant cost management and menu optimization for independent operators." />
        <meta property="og:title" content="OptiMenu" />
        <meta property="og:description" content="Restaurant cost management and menu optimization." />
        <meta property="og:type" content="website" />
        <meta property="og:url" content="https://www.opti-menu.com" />
        <meta property="og:image" content="https://www.opti-menu.com/icons/icon-512x512.png" />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}