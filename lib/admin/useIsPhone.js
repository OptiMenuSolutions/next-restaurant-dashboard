import { useEffect, useState } from 'react';

export default function useIsPhone() {
  const [isPhone, setIsPhone] = useState(false);

  useEffect(() => {
    if (!window.matchMedia) return undefined;

    const query = window.matchMedia('(max-width: 720px)');
    const update = () => setIsPhone(query.matches);
    update();

    if (query.addEventListener) {
      query.addEventListener('change', update);
      return () => query.removeEventListener('change', update);
    }

    query.addListener(update);
    return () => query.removeListener(update);
  }, []);

  return isPhone;
}