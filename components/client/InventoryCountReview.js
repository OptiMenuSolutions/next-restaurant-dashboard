import { useEffect, useRef, useState } from "react";
import { SANS } from "./ClientChrome";

const MONO = "'IBM Plex Mono', ui-monospace, monospace";

const fieldStyle = {
  width: "100%",
  minWidth: 0,
  maxWidth: "100%",
  minHeight: 42,
  boxSizing: "border-box",
  border: "1px solid var(--line)",
  borderRadius: 10,
  padding: "0 12px",
  background: "var(--shell)",
  color: "var(--text)",
  fontFamily: SANS,
  fontSize: 16,
};

const buttonStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: 44,
  border: 0,
  borderRadius: 22,
  padding: "0 16px",
  background: "var(--accent-deep)",
  color: "var(--on-accent, #ffffff)",
  fontFamily: SANS,
  fontSize: 13.5,
  fontWeight: 700,
  cursor: "pointer",
  width: "100%",
};

const labelStyle = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  minWidth: 0,
  fontSize: 12.5,
  fontWeight: 600,
  color: "var(--muted)",
};

export default function InventoryCountReview({
  sessionId,
  request,
  onSubmitting,
}) {
  const [date, setDate] = useState("");
  const [timing, setTiming] = useState("");
  const [review, setReview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const busyRef = useRef(false);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;

    setDate(
      new Date().toLocaleDateString("en-CA", {
        timeZone: "America/New_York",
      })
    );

    return () => {
      mountedRef.current = false;
    };
  }, []);

  async function submitCount() {
    if (busyRef.current || !review) return;

    if (
      !window.confirm(
        'Submit these saved quantities? This will update live inventory and make this count read-only.'
      )
    ) {
      return;
    }

    busyRef.current = true;
    setBusy(true);
    setSubmitting(true);
    onSubmitting(true);
    setError('');

    try {
      await request('/api/inventory/count-submit', {
        method: 'POST',
        body: JSON.stringify({
          session_id: sessionId,
          expected_revision: String(review.revision),
          effective_date: review.effective_date,
          count_timing: review.count_timing,
        }),
      });

      window.location.assign(
        `/client/inventory-count?count=${encodeURIComponent(sessionId)}`
      );
    } catch (err) {
      setError(
        err.message ||
        'Could not submit. Retry if the connection was interrupted.'
      );
    } finally {
      busyRef.current = false;

      if (mountedRef.current) {
        setBusy(false);
        setSubmitting(false);
        onSubmitting(false);
      }
    }
  }

  async function loadReview() {
    if (busyRef.current || !date || !timing) return;

    busyRef.current = true;
    setBusy(true);
    setError("");
    setReview(null);

    try {
      const result = await request("/api/inventory/count-review", {
        method: "POST",
        body: JSON.stringify({
          session_id: sessionId,
          effective_date: date,
          count_timing: timing,
        }),
      });

      if (mountedRef.current) {
        setReview(result.review);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err.message || "Could not review the count.");
      }
    } finally {
      busyRef.current = false;

      if (mountedRef.current) {
        setBusy(false);
      }
    }
  }

  const timingLabel = (value) =>
    value === "before_opening" ? "Before opening" : "After closing";

  return (
    <section
      aria-label="Review saved inventory count"
      style={{
        border: "1px solid var(--line)",
        borderRadius: 14,
        background: "var(--shell)",
        padding: "16px 18px",
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>
          When did you count?
        </h2>
        <p style={{ margin: "4px 0 0", fontSize: 12.5, lineHeight: 1.5, color: "var(--muted)" }}>
          Pick when the shelves were counted, not when you typed it in.
        </p>
      </div>

      <label style={labelStyle}>
        Count date
        <input
          type="date"
          value={date}
          disabled={busy}
          onChange={(event) => {
            setDate(event.target.value);
            setReview(null);
            setError("");
          }}
          style={{
            ...fieldStyle,
            display: "block",
            appearance: "none",
            WebkitAppearance: "none",
          }}
        />
      </label>

      <fieldset
        disabled={busy}
        style={{ margin: 0, padding: 0, border: "none", minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}
      >
        <legend style={{ ...labelStyle, padding: 0, marginBottom: 6 }}>Timing</legend>

        {[
          {
            value: "before_opening",
            label: "Before opening",
            detail: "That day’s deliveries and sales happen after this count.",
          },
          {
            value: "after_closing",
            label: "After closing",
            detail: "Includes everything delivered and sold that day.",
          },
        ].map((option) => {
          const on = timing === option.value;
          return (
            <label
              key={option.value}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                padding: 12,
                border: `${on ? 1.5 : 1}px solid ${on ? "var(--accent)" : "var(--line)"}`,
                borderRadius: 10,
                background: on ? "var(--accent-tint)" : "var(--shell)",
                cursor: busy ? "default" : "pointer",
              }}
            >
              <input
                type="radio"
                name={`count-timing-${sessionId}`}
                value={option.value}
                checked={on}
                onChange={() => {
                  setTiming(option.value);
                  setReview(null);
                  setError("");
                }}
                style={{ margin: "3px 0 0", accentColor: "var(--accent-deep)" }}
              />
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 14, fontWeight: 700 }}>{option.label}</span>
                <span style={{ display: "block", marginTop: 2, fontSize: 12.5, lineHeight: 1.45, color: "var(--muted)" }}>
                  {option.detail}
                </span>
              </span>
            </label>
          );
        })}
      </fieldset>

      {error && (
        <p role="alert" style={{ margin: 0, padding: "10px 12px", borderRadius: 10, background: "var(--red-tint, #fbeceb)", color: "var(--red)", fontSize: 13, lineHeight: 1.5 }}>
          {error}
        </p>
      )}

      {!review && (
        <button
          type="button"
          onClick={loadReview}
          disabled={busy || !date || !timing}
          style={{ ...buttonStyle, opacity: busy || !date || !timing ? 0.5 : 1 }}
        >
          {busy ? "Loading review…" : "Review before submitting"}
        </button>
      )}

      {review && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div role="status" style={{ background: "var(--panel)", borderRadius: 10, padding: "10px 12px", fontSize: 13, lineHeight: 1.55 }}>
            <strong>{review.counted} counted</strong> · {review.uncounted} keep their estimate
            <span style={{ display: "block", fontFamily: MONO, fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
              {review.effective_date} · {timingLabel(review.count_timing).toUpperCase()}
            </span>
          </div>

          <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, color: "var(--muted)" }}>
            Only these ingredients change. Nothing has changed in inventory yet.
          </p>

          <ul style={{ listStyle: "none", padding: 0, margin: 0, border: "1px solid var(--line-soft)", borderRadius: 10, overflow: "hidden" }}>
            {review.lines.map((line, index) => (
              <li
                key={line.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "9px 12px",
                  borderTop: index ? "1px solid var(--line-soft)" : 0,
                  fontSize: 13.5,
                  overflowWrap: "anywhere",
                }}
              >
                <span style={{ minWidth: 0 }}>{line.ingredient_name}</span>
                <span style={{ fontFamily: MONO, fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap" }}>
                  {line.quantity} {line.unit}
                </span>
              </li>
            ))}
          </ul>

          <button
            type="button"
            onClick={submitCount}
            disabled={busy}
            style={{ ...buttonStyle, opacity: busy ? 0.5 : 1 }}
          >
            {submitting ? "Submitting count…" : "Submit count"}
          </button>
          <button
            type="button"
            onClick={() => setReview(null)}
            disabled={busy}
            style={{ alignSelf: "center", border: 0, background: "none", padding: 0, fontFamily: SANS, fontSize: 13, fontWeight: 700, color: "var(--accent-deep)", cursor: "pointer" }}
          >
            Change date or timing
          </button>
        </div>
      )}
    </section>
  );
}