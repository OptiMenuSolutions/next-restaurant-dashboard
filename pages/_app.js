import '../styles/globals.css'

export default function App({ Component, pageProps }) {
  return <Component {...pageProps} />
}

import { registerServiceWorker } from '../lib/registerSW';
import { useEffect } from 'react';

// Inside your App component:
useEffect(() => { registerServiceWorker(); }, []);