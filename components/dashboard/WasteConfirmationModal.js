import { useState } from "react";

/**
 * WasteConfirmationModal — batched daily pop-up asking the restaurant to
 * confirm what actually happened to ingredients the system presumed were
 * thrown away (aged out of the waste-risk list unsold, above the dollar
 * threshold set in the snapshot cron job's CONFIRMATION_THRESHOLD).
 *
 * Answers feed waste_confirmations.status, which lib/computeWasteResolution.js
 * uses to score OptiScore's waste-mitigation bucket — see chat for why an
 * unconfirmed system guess shouldn't be scored the same as a confirmed fact.
 *
 * Props:
 *   items      [{ id, ingredientName, presumedQty, presumedValue, lastSeenDate }]
 *   onRespond  (id, status) => Promise|void
 *              status: 'confirmed_wasted' | 'confirmed_used' | 'dismissed'
 *   onClose    () => void — called once every item has been responded to, or
 *              the restaurant closes early ("ask me later" — items stay
 *              'pending' server-side and will show again next visit, or
 *              auto-expire after the cron job's EXPIRY_WINDOW_DAYS)
 */
export default function WasteConfirmationModal({ items, onRespond, onClose }) {
  const [resolved, setResolved] = useState({}); // id -> status, optimistic local state
  const [submitting, setSubmitting] = useState(null); // id currently in flight
  const [failedId, setFailedId] = useState(null);

  if (!items || items.length === 0) return null;

  const money = (n) => "$" + Number(n || 0).toFixed(2);

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
            Did these actually get thrown away?
          </div>
          <div style={{ fontSize: 12.5, color: "var(--faint,#78868a)", marginTop: 4, lineHeight: 1.5 }}>
            These items aged past our estimate without a matching sale. Confirming helps us get
            better at flagging what's really at risk.
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
                    {Math.round(item.presumedQty * 100) / 100} left · {money(item.presumedValue)}
                  </div>
                </div>

                {failed && (
                  <div style={{ fontSize: 12, color: "var(--red,#c4473e)", marginBottom: 8 }}>
                    Couldn't save that — try again.
                  </div>
                )}

                {done ? (
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--accent-deep,#03808f)" }}>
                    {done === "confirmed_wasted" ? "Marked as thrown away" : "Marked as used"}
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={() => handleRespond(item.id, "confirmed_wasted")}
                      style={{
                        flex: "1 1 auto", padding: "8px 12px", borderRadius: 8, border: "1px solid var(--red,#c4473e)",
                        background: "var(--red-tint,#faeae8)", color: "var(--red,#c4473e)", fontSize: 12.5, fontWeight: 700,
                        cursor: isSubmitting ? "default" : "pointer", opacity: isSubmitting ? 0.6 : 1,
                      }}
                    >
                      Yes, thrown away
                    </button>
                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={() => handleRespond(item.id, "confirmed_used")}
                      style={{
                        flex: "1 1 auto", padding: "8px 12px", borderRadius: 8, border: "1px solid var(--green,#3f9c56)",
                        background: "rgba(63,156,86,0.08)", color: "var(--green,#3f9c56)", fontSize: 12.5, fontWeight: 700,
                        cursor: isSubmitting ? "default" : "pointer", opacity: isSubmitting ? 0.6 : 1,
                      }}
                    >
                      No, it got used
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {!allResolved && (
          <div style={{ padding: "14px 22px" }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                width: "100%", padding: 10, borderRadius: 8, border: "none", background: "none",
                color: "var(--faint,#78868a)", fontSize: 12.5, fontWeight: 600, cursor: "pointer",
              }}
            >
              Ask me later
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
