// lib/useWindowSize.js
import { useState, useEffect } from 'react';

export function useWindowSize() {
  // Default to desktop dimensions during SSR — isMobile will be false
  // until the component mounts on the client and measures the real window.
  const [windowSize, setWindowSize] = useState({
    width: 1200,
    height: 800,
  });

  // isClient prevents any window access during server-side rendering
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);

    function handleResize() {
      setWindowSize({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    }

    window.addEventListener('resize', handleResize);
    handleResize(); // set real dimensions on first mount
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return {
    ...windowSize,
    isMobile: isClient && windowSize.width < 768,
    isTablet: isClient && windowSize.width >= 768 && windowSize.width < 1024,
    isDesktop: !isClient || windowSize.width >= 1024,
  };
}