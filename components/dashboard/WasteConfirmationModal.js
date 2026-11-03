import { useState } from "react";

/**
 * WasteConfirmationModal
 *
 * Asks whether ingredients reaching estimated shelf life
 * were actually discarded.
 *
 * Yes -> confirmed_wasted
 * No -> follow-up:
 *   Used it all -> confirmed_used
 *   Still using -> kept
 * Not sure -> not_sure
 *
 * The intermediate No selection is not saved.
 * Only final responses are submitted to Supabase.
 *
 * Estimated quantities are not measured waste.
 */
export default function WasteConfirmationModal({ items, onRespond, onClose, onAskLater = onClose }) {
  const [resolved, setResolved] = useState({});
  const [noFollowUp, setNoFollowUp] = useState({});
  const [submitting, setSubmitting] = useState(null);
  const [failedId, setFailedId] = useState(null);
  const [snoozeStatus, setSnoozeStatus] = useState("");
  const [noWasteSelection, setNoWasteSelection] = useState({});

  if (!items || items.length === 0) return null;

  const money = (n) => "$" + Number(n || 0).toFixed(2);
  // Same readable units as the Waste Risk panel: 400 lb, not 6,400 oz.
  const qtyWithUnit = (q, u) => {
    let n = Number(q) || 0, unit = u || "";
    if (unit === "oz" && n >= 32) { n = n / 16; unit = "lb"; }
    else if (unit === "fl oz" && n >= 128) { n = n / 128; unit = "gal"; }
    return (Math.round(n * 10) / 10).toLocaleString("en-US") + (unit ? " " + unit : "");
  };

  async function handleRespond(id, status) {
    setSubmitting(id);
    setFailedId(null);
    try {
      await onRespond(id, status);
      setResolved((prev) => {
        const next = { ...prev, [id]: status };
        if (Object.keys(next).length === items.length) {
          // brief delay so the last button's confirmation state is visible
          setTimeout(() => onClose?.(), 500);
        }
        return next;
      });
    } catch (err) {
      console.error("Failed to record waste confirmation:", err);
      setFailedId(id);
    } finally {
      setSubmitting(null);
    }
  }

  const allResolved = Object.keys(resolved).length === items.length;

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed", inset: 0, zIndex: 500, background: "rgba(17,24,25,0.45)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
      }}
    >
      <div
        style={{
          width: "100%", maxWidth: 480, maxHeight: "min(600px, 90vh)", overflowY: "auto",
          background: "var(--shell,#fff)", borderRadius: 14, boxShadow: "0 24px 60px rgba(17,24,25,0.25)",
          border: "1px solid var(--line,#d8dfe0)",
        }}
      >
        <div style={{ padding: "20px 22px 14px", borderBottom: "1px solid var(--line-soft,#eef1f2)" }}>
          <div style={{
            fontFamily: "'IBM Plex Mono',monospace", fontSize: 10.5, letterSpacing: "0.12em",
            textTransform: "uppercase", color: "var(--accent-deep,#03808f)", marginBottom: 6,
          }}>
            Quick check
          </div>
          <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.02em", color: "var(--text,#111819)" }}>
            Quick inventory check
          </div>
          <div style={{ fontSize: 12.5, color: "var(--faint,#78868a)", marginTop: 4, lineHeight: 1.5 }}>
            These ingredients have reached their estimated shelf life, but we
            don't know what happened to the remaining stock. A quick answer
            helps keep your inventory estimates accurate.
          </div>
        </div>

        <div>
          {items.map((item) => {
            const done = resolved[item.id];
            const isSubmitting = submitting === item.id;
            const failed = failedId === item.id;
            return (
              <div
                key={item.id}
                style={{
                  padding: "16px 22px", borderBottom: "1px solid var(--line-soft,#eef1f2)",
                  opacity: done ? 0.5 : 1, transition: "opacity 0.3s",
                }}
              >
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10, gap: 12 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 700, color: "var(--text,#111819)" }}>
                    {item.ingredientName}
                  </div>
                  <div style={{ fontSize: 12.5, color: "var(--faint,#78868a)", whiteSpace: "nowrap" }}>
                    Est. {qtyWithUnit(item.presumedQty, item.unit)} · {money(item.presumedValue)}
                  </div>
                </div>

                {failed && (
                  <div style={{ fontSize: 12, color: "var(--red,#c4473e)", marginBottom: 8 }}>
                    Couldn't save that — try again.
                  </div>
                )}

                {done ? (
                  <div
                    style={{
                      fontSize: 12.5,
                      fontWeight: 600,
                      color: "var(--accent-deep,#03808f)",
                    }}
                  >
                    {done === "confirmed_wasted"
                      ? "Recorded as discarded"
                      : done === "confirmed_used"
                        ? "Recorded as fully used"
                        : done === "kept"
                          ? "Still in use. We'll check again tomorrow."
                          : "Recorded as not sure"}
                  </div>
                ) : noFollowUp[item.id] ? (
                  <div>
                    <div
                      style={{
                        fontSize: 12.5,
                        fontWeight: 600,
                        marginBottom: 10,
                        color: "var(--text,#111819)",
                      }}
                    >
                      What happened to the ingredient?
                    </div>

                    <div
                      style={{
                        display: "flex",
                        gap: 8,
                        flexWrap: "wrap",
                      }}
                    >
                      <button
                        type="button"
                        disabled={!!submitting}
                        onClick={() =>
                          handleRespond(item.id, "confirmed_used")
                        }
                        style={{
                          flex: "1 1 140px",
                          padding: "10px 12px",
                          borderRadius: 8,
                          border: "1px solid var(--line,#d8dfe0)",
                          background: "var(--shell,#fff)",
                          color: "var(--text,#111819)",
                          fontSize: 12.5,
                          fontWeight: 700,
                          cursor: submitting ? "wait" : "pointer",
                        }}
                      >
                        We used it all
                      </button>

                      <button
                        type="button"
                        disabled={!!submitting}
                        onClick={() =>
                          handleRespond(item.id, "kept")
                        }
                        style={{
                          flex: "1 1 140px",
                          padding: "10px 12px",
                          borderRadius: 8,
                          border: "1px solid var(--green,#3f9c56)",
                          background: "rgba(63,156,86,0.08)",
                          color: "var(--green,#3f9c56)",
                          fontSize: 12.5,
                          fontWeight: 700,
                          cursor: submitting ? "wait" : "pointer",
                        }}
                      >
                        We're still using it
                      </button>

                      <button
                        type="button"
                        disabled={!!submitting}
                        onClick={() =>
                          setNoFollowUp((prev) => ({
                            ...prev,
                            [item.id]: false,
                          }))
                        }
                        style={{
                          width: "100%",
                          padding: "8px 0",
                          border: "none",
                          background: "none",
                          color: "var(--faint,#78868a)",
                          fontSize: 12,
                          cursor: submitting ? "wait" : "pointer",
                        }}
                      >
                        Back
                      </button>
                    </div>
                  </div>
                ) : (
                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      flexWrap: "wrap",
                    }}
                  >
                    <button
                      type="button"
                      disabled={!!submitting}
                      onClick={() =>
                        handleRespond(item.id, "confirmed_wasted")
                      }
                      style={{
                        flex: "1 1 90px",
                        padding: "10px 12px",
                        borderRadius: 8,
                        border: "1px solid var(--red,#c4473e)",
                        background: "var(--red-tint,#faeae8)",
                        color: "var(--red,#c4473e)",
                        fontSize: 12.5,
                        fontWeight: 700,
                        cursor: submitting ? "wait" : "pointer",
                      }}
                    >
                      Yes
                    </button>

                    <button
                      type="button"
                      disabled={!!submitting}
                      onClick={() =>
                        setNoFollowUp((prev) => ({
                          ...prev,
                          [item.id]: true,
                        }))
                      }
                      style={{
                        flex: "1 1 90px",
                        padding: "10px 12px",
                        borderRadius: 8,
                        border: "1px solid var(--green,#3f9c56)",
                        background: "rgba(63,156,86,0.08)",
                        color: "var(--green,#3f9c56)",
                        fontSize: 12.5,
                        fontWeight: 700,
                        cursor: submitting ? "wait" : "pointer",
                      }}
                    >
                      No
                    </button>

                    <button
                      type="button"
                      disabled={!!submitting}
                      onClick={() =>
                        handleRespond(item.id, "not_sure")
                      }
                      style={{
                        flex: "1 1 90px",
                        padding: "10px 12px",
                        borderRadius: 8,
                        border: "1px solid var(--line,#d8dfe0)",
                        background: "var(--shell,#fff)",
                        color: "var(--faint,#78868a)",
                        fontSize: 12.5,
                        fontWeight: 700,
                        cursor: submitting ? "wait" : "pointer",
                      }}
                    >
                      Not sure
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {!allResolved && (
          <div style={{ padding: "14px 22px" }}>
            {snoozeStatus === "error" && (
              <div
                role="alert"
                style={{
                  marginBottom: 8,
                  fontSize: 12.5,
                  lineHeight: 1.5,
                  color: "var(--red)",
                  textAlign: "center",
                }}
              >
                Could not save the delay. Check your connection and try again.
              </div>
            )}

            <button
              type="button"
              disabled={snoozeStatus === "saving" || !!submitting}
              onClick={async () => {
                if (snoozeStatus === "saving" || submitting) return;
                setSnoozeStatus("saving");

                try {
                  await onAskLater();
                  setSnoozeStatus("");
                } catch (err) {
                  console.error("Could not snooze waste prompts:", err);
                  setSnoozeStatus("error");
                }
              }}
              style={{
                width: "100%",
                minHeight: 44,
                padding: 10,
                borderRadius: 8,
                border: "none",
                background: "none",
                color: "var(--faint)",
                fontSize: 12.5,
                fontWeight: 600,
                cursor: snoozeStatus === "saving" ? "wait" : "pointer",
                opacity: snoozeStatus === "saving" ? 0.6 : 1,
              }}
            >
              {snoozeStatus === "saving"
                ? "Saving delay…"
                : "Ask me in 2 hours"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
