// pages/_app.js
import '../styles/globals.css';
import { useEffect } from 'react';
import { registerServiceWorker } from '../lib/registerSW';
import '../styles/tour.css';

export default function App({ Component, pageProps }) {
  useEffect(() => {
    registerServiceWorker();
  }, []);

  return <Component {...pageProps} />;
}