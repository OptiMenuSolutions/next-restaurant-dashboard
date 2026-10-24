import { useEffect, useRef, useState } from "react";
import { SANS } from "./ClientChrome";

const fieldStyle = {
  width: "100%",
  minWidth: 0,
  maxWidth: "100%",
  minHeight: 44,
  boxSizing: "border-box",
  border: "1px solid var(--line)",
  borderRadius: 10,
  padding: "10px 12px",
  background: "var(--shell)",
  color: "var(--text)",
  fontFamily: SANS,
  fontSize: 16,
};

const buttonStyle = {
  minHeight: 44,
  border: "1px solid var(--line)",
  borderRadius: 22,
  padding: "10px 16px",
  background: "var(--accent-tint)",
  color: "var(--accent-deep)",
  fontFamily: SANS,
  fontSize: 14,
  fontWeight: 700,
  cursor: "pointer",
};

export default function InventoryCountReview({
  sessionId,
  request,
}) {
  const [date, setDate] = useState("");
  const [timing, setTiming] = useState("");
  const [review, setReview] = useState(null);
  const [busy, setBusy] = useState(false);
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

  return (
    <section
      aria-label="Review saved inventory count"
      style={{
        border: "1px solid var(--line)",
        borderRadius: 14,
        padding: 16,
        marginBottom: 22,
        minWidth: 0,
      }}
    >
      <h3 style={{ margin: "0 0 10px", fontSize: 18 }}>
        Review saved count
      </h3>

      <p style={{ color: "var(--muted)", lineHeight: 1.6 }}>
        Choose when these quantities were physically counted,
        rather than when you entered them here.
      </p>

      <label style={{ display: "block", minWidth: 0 }}>
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
            marginTop: 6,
            appearance: "none",
            WebkitAppearance: "none",
          }}
        />
      </label>

      <fieldset
        disabled={busy}
        style={{
          margin: "16px 0",
          padding: 0,
          border: "none",
          minWidth: 0,
        }}
      >
        <legend style={{ marginBottom: 8 }}>
          When was it counted?
        </legend>

        {[
          {
            value: "before_opening",
            label: "Before opening",
            detail: "Before that day’s deliveries and sales.",
          },
          {
            value: "after_closing",
            label: "After closing",
            detail: "After that day’s deliveries and sales.",
          },
        ].map((option) => (
          <label
            key={option.value}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              padding: "10px 0",
              cursor: busy ? "default" : "pointer",
            }}
          >
            <input
              type="radio"
              name={`count-timing-${sessionId}`}
              value={option.value}
              checked={timing === option.value}
              onChange={() => {
                setTiming(option.value);
                setReview(null);
                setError("");
              }}
              style={{ marginTop: 4 }}
            />

            <span>
              <strong>{option.label}</strong>
              <span
                style={{
                  display: "block",
                  color: "var(--muted)",
                  fontSize: 13,
                  marginTop: 3,
                }}
              >
                {option.detail}
              </span>
            </span>
          </label>
        ))}
      </fieldset>

      {error && (
        <p role="alert" style={{ color: "var(--red)", lineHeight: 1.5 }}>
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={loadReview}
        disabled={busy || !date || !timing}
        style={{
          ...buttonStyle,
          opacity: busy || !date || !timing ? 0.5 : 1,
        }}
      >
        {busy ? "Loading review…" : "Review saved quantities"}
      </button>

      {review && (
        <div style={{ marginTop: 18 }}>
          <p role="status" style={{ lineHeight: 1.6 }}>
            <strong>{review.counted} counted</strong>
            {" · "}
            {review.uncounted} not counted
            <br />
            {review.effective_date}
            {" · "}
            {review.count_timing === "before_opening"
              ? "Before opening"
              : "After closing"}
          </p>

          <p style={{ color: "var(--muted)", lineHeight: 1.6 }}>
            Only the ingredients below are included. Uncounted
            ingredients will stay untouched. This review has not
            changed inventory.
          </p>

          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {review.lines.map((line) => (
              <li
                key={line.id}
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  justifyContent: "space-between",
                  gap: "6px 16px",
                  borderTop: "1px solid var(--line)",
                  padding: "12px 0",
                  overflowWrap: "anywhere",
                }}
              >
                <span style={{ flex: "1 1 180px", minWidth: 0 }}>
                  {line.ingredient_name}
                </span>
                <strong>
                  {line.quantity} {line.unit}
                </strong>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}