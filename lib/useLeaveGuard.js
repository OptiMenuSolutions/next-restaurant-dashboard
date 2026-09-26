// Blocks in-app navigation while work is in progress and lets the page show
// an OptiMenu-styled "leave anyway?" modal instead of the browser's dialog.
// Tab close / refresh still uses the browser's own prompt — browsers don't
// allow a custom dialog there.
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";

export function useLeaveGuard(active) {
  const router = useRouter();
  const [pendingUrl, setPendingUrl] = useState(null);
  const allowRef = useRef(false);

  useEffect(() => {
    if (!active) return;

    const onBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);

    const onRouteChangeStart = (url) => {
      if (allowRef.current) return;
      setPendingUrl(url);
      router.events.emit("routeChangeError");
      // eslint-disable-next-line no-throw-literal
      throw "routeChange aborted."; // Next.js's own idiom for cancelling a route change
    };
    router.events.on("routeChangeStart", onRouteChangeStart);

    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      router.events.off("routeChangeStart", onRouteChangeStart);
    };
  }, [active, router.events]);

  const stay = useCallback(() => setPendingUrl(null), []);
  const leave = useCallback(() => {
    const url = pendingUrl;
    setPendingUrl(null);
    allowRef.current = true;
    if (url) router.push(url);
  }, [pendingUrl, router]);

  return { pendingUrl, stay, leave };
}