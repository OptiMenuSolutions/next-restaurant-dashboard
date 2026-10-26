import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import supabase from "../../lib/supabaseClient";
import { useGuardedAccount } from "../../lib/useAccount";
import { SANS, useIsMobile } from "../../components/client/ClientChrome";
import ClientPage, { PageTitle } from "../../components/client/ClientPage";
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
  minHeight: 42,
  padding: "0 18px",
  border: "1px solid var(--line)",
  borderRadius: 21,
  background: "var(--shell)",
  color: "var(--text)",
  fontFamily: SANS,
  fontSize: 13.5,
  fontWeight: 700,
  textDecoration: "none",
  cursor: "pointer",
};

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

function stamp(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).toUpperCase();
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${time}`;
}

export default function InventoryCountPage() {
  const router = useRouter();
  const isMobile = useIsMobile();
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

  const kicker = session
    ? session.status === "draft"
      ? `INVENTORY · DRAFT STARTED ${stamp(session.created_at)}`
      : `INVENTORY · SUBMITTED ${stamp(session.submitted_at || session.updated_at)}`
    : "INVENTORY";

  return (
    <ClientPage
      title="Inventory count"
      account={account}
      active="ingredients"
      maxWidth={1280}
      back={{ label: "Ingredients", href: "/client/ingredients" }}
      phoneBack={{ label: "Ingredients", href: "/client/ingredients", title: "Count" }}
    >
      <PageTitle
        kicker={isMobile ? (session?.status === "draft" ? "INVENTORY · DRAFT" : "INVENTORY") : kicker}
        title="Inventory count"
        isPhone={isMobile}
        sub={session
          ? session.status === "draft"
            ? isMobile
              ? "Blank skips a line. 0 means none left."
              : "Optional. Count what’s on hand and we’ll correct the estimates. Leave a line blank to skip it. Enter 0 when there’s none left."
            : "This count is submitted and read-only."
          : "Optional counts keep your stock estimates accurate."}
      />

      {visibleError && (
        <div
          role="alert"
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 12,
            padding: "12px 14px",
            borderRadius: 12,
            background: "var(--red-tint, #fbeceb)",
            color: "var(--red)",
            fontSize: 13.5,
            overflowWrap: "anywhere",
          }}
        >
          <span style={{ flex: "1 1 220px" }}>{visibleError}</span>
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
        <p role="status" style={{ margin: 0, color: "var(--muted)" }}>Loading your inventory count…</p>
      ) : !accountError && restaurantId ? (
        session ? (
          <InventoryCountEditor
            key={`${restaurantId}:${session.id}`}
            sessionId={session.id}
            restaurantId={restaurantId}
          />
        ) : !error ? (
          <section
            style={{
              minWidth: 0,
              maxWidth: 560,
              background: "var(--shell)",
              border: "1px solid var(--line)",
              borderRadius: 14,
              padding: "20px 22px",
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 800 }}>
              No count in progress
            </h2>
            <p style={{ margin: 0, color: "var(--muted)", fontSize: 13.5, lineHeight: 1.6 }}>
              Start a draft when you’re ready to count. It stays separate from live inventory until you submit it.
            </p>
            <button
              type="button"
              onClick={startCount}
              disabled={busy}
              style={{
                ...buttonStyle,
                alignSelf: "flex-start",
                border: 0,
                background: "var(--accent-deep)",
                color: "var(--on-accent, #ffffff)",
                opacity: busy ? 0.6 : 1,
                cursor: busy ? "wait" : "pointer",
              }}
            >
              {busy ? "Starting…" : "Start inventory count"}
            </button>
          </section>
        ) : null
      ) : null}
    </ClientPage>
  );
}