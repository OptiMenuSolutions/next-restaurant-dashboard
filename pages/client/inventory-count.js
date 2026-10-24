import { useEffect, useRef, useState } from "react";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import supabase from "../../lib/supabaseClient";
import { useGuardedAccount } from "../../lib/useAccount";
import {
  Shell,
  FONT_LINKS,
  SANS,
  useTheme,
} from "../../components/client/ClientChrome";
import InventoryCountEditor from "../../components/client/InventoryCountEditor";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function countRequest(url, options = {}) {
  const { data, error } = await supabase.auth.getSession();

  if (error || !data?.session?.access_token) {
    throw new Error("Please sign in again.");
  }

  const response = await fetch(url, {
    ...options,
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${data.session.access_token}`,
    },
  });

  let result;

  try {
    result = await response.json();
  } catch {
    throw new Error("Could not read the response. Please try again.");
  }

  if (!response.ok) {
    throw new Error(result.error || "Could not load your inventory count.");
  }

  return result;
}

const buttonStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: 44,
  padding: "10px 18px",
  border: "1px solid var(--line)",
  borderRadius: 24,
  background: "var(--shell)",
  color: "var(--text)",
  fontFamily: SANS,
  fontSize: 15,
  fontWeight: 700,
  textDecoration: "none",
  cursor: "pointer",
};

export default function InventoryCountPage() {
  const router = useRouter();
  const [theme] = useTheme();
  const { account, loading: accountLoading, error: accountError } =
    useGuardedAccount({ instant: true });

  const restaurantId = account?.profile?.restaurant_id;
  const requestedId = router.query.count;

  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  const creatingRef = useRef(false);
  const pendingIdRef = useRef(null);

  useEffect(() => {
    pendingIdRef.current = null;
  }, [restaurantId]);

  useEffect(() => {
    if (!router.isReady || !restaurantId) return;

    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");
      setSession(null);

      try {
        if (
          requestedId !== undefined &&
          (typeof requestedId !== "string" || !UUID.test(requestedId))
        ) {
          throw new Error("This inventory count link is invalid.");
        }

        const url = requestedId
          ? `/api/inventory/counts?session_id=${encodeURIComponent(requestedId)}`
          : "/api/inventory/counts";

        const result = await countRequest(url);

        if (!cancelled) {
          setSession(result.session);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message || "Could not load your inventory count.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [router.isReady, restaurantId, requestedId, retry]);

  async function startCount() {
    if (
      creatingRef.current ||
      loading ||
      session ||
      !restaurantId
    ) {
      return;
    }

    creatingRef.current = true;
    setBusy(true);
    setError("");

    try {
      // Reuse the ID if a request succeeds but its response is interrupted.
      if (!pendingIdRef.current) {
        pendingIdRef.current = window.crypto.randomUUID();
      }

      const result = await countRequest("/api/inventory/counts", {
        method: "POST",
        body: JSON.stringify({
          session_id: pendingIdRef.current,
        }),
      });

      setSession(result.session);
      pendingIdRef.current = null;
    } catch (err) {
      setError(err.message || "Could not start your inventory count.");
    } finally {
      creatingRef.current = false;
      setBusy(false);
    }
  }

  const waiting =
    accountLoading ||
    !router.isReady ||
    (!!restaurantId && loading);

  const visibleError =
    accountError
      ? accountError.message || String(accountError)
      : error;

  return (
    <Shell theme={theme}>
      <Head>
        <title>Inventory count · OptiMenu</title>
        {FONT_LINKS}
      </Head>

      <header
        style={{
          position: "sticky",
          top: 0,
          zIndex: 10,
          background: "var(--shell)",
          borderBottom: "1px solid var(--line)",
          padding: "12px 16px",
        }}
      >
        <Link
          href="/client/ingredients"
          style={{
            ...buttonStyle,
            border: "none",
            padding: "8px 0",
            color: "var(--accent-deep)",
          }}
        >
          ‹ Ingredients
        </Link>
      </header>

      <main
        style={{
          width: "100%",
          maxWidth: 760,
          boxSizing: "border-box",
          margin: "0 auto",
          padding: "24px 16px 40px",
        }}
      >
        <h1 style={{ margin: 0, fontSize: 28 }}>
          Inventory count
        </h1>

        <p
          style={{
            margin: "10px 0 24px",
            color: "var(--muted)",
            lineHeight: 1.6,
          }}
        >
          Optional counts help keep your stock estimates accurate.
          Starting a draft does not change your inventory.
        </p>

        {visibleError && (
          <div
            role="alert"
            style={{
              border: "1px solid var(--red)",
              borderRadius: 14,
              padding: 16,
              marginBottom: 16,
              overflowWrap: "anywhere",
            }}
          >
            <p style={{ margin: "0 0 12px" }}>
              {visibleError}
            </p>

            <button
              type="button"
              style={buttonStyle}
              disabled={busy}
              onClick={() => setRetry((value) => value + 1)}
            >
              Try again
            </button>
          </div>
        )}

        {waiting ? (
          <p role="status">Loading your inventory count…</p>
        ) : !accountError && restaurantId ? (
          <section
            style={{
              background: "var(--shell)",
              border: "1px solid var(--line)",
              borderRadius: 18,
              padding: 20,
            }}
          >
            {session ? (
              <>
                <h2 style={{ margin: 0, fontSize: 20 }}>
                  {session.status === "draft"
                    ? "Inventory count draft"
                    : "Inventory count"}
                </h2>

                <p style={{ color: "var(--muted)", lineHeight: 1.6 }}>
                  Started{" "}
                  {new Date(session.created_at).toLocaleString()}.
                  {session.status === "draft"
                    ? " You can leave this page and return to this draft."
                    : ` Status: ${session.status}.`}
                </p>

                <Link
                  href={`/client/inventory-count?count=${session.id}`}
                  style={buttonStyle}
                >
                  Open saved draft link
                </Link>

                <InventoryCountEditor
                  key={`${restaurantId}:${session.id}`}
                  sessionId={session.id}
                />
              </>
            ) : !error ? (
              <>
                <h2 style={{ margin: 0, fontSize: 20 }}>
                  No count in progress
                </h2>

                <p style={{ color: "var(--muted)", lineHeight: 1.6 }}>
                  Create a draft when you are ready to count.
                </p>

                <button
                  type="button"
                  onClick={startCount}
                  disabled={busy}
                  style={{
                    ...buttonStyle,
                    background: "var(--accent-tint)",
                    color: "var(--accent-deep)",
                    opacity: busy ? 0.6 : 1,
                    cursor: busy ? "wait" : "pointer",
                  }}
                >
                  {busy ? "Starting…" : "Start inventory count"}
                </button>
              </>
            ) : null}
          </section>
        ) : null}
      </main>
    </Shell>
  );
}