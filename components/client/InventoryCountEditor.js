import { useEffect, useRef, useState } from "react";
import supabase from "../../lib/supabaseClient";
import { SANS } from "./ClientChrome";
import InventoryCountReview from "./InventoryCountReview";

async function request(url, options = {}) {
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
    throw new Error(result.error || "Could not save the count.");
  }

  return result;
}

const fieldStyle = {
  width: "100%",
  minWidth: 0,
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

const quantityText = (line) =>
  line?.quantity == null ? "" : String(line.quantity);

export default function InventoryCountEditor({ sessionId }) {
  const [ingredients, setIngredients] = useState([]);
  const [lines, setLines] = useState({});
  const [values, setValues] = useState({});
  const [search, setSearch] = useState("");
  const [editable, setEditable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reload, setReload] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const savingRef = useRef(false);

  const dirtyCount = ingredients.filter(
    (g) => (values[g.id] ?? "") !== quantityText(lines[g.id])
  ).length;

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");
      setNotice("");

      try {
        const result = await request(
          `/api/inventory/count-lines?session_id=${encodeURIComponent(sessionId)}`
        );

        if (cancelled) return;

        const saved = Object.fromEntries(
          result.lines.map((line) => [line.ingredient_id, line])
        );

        setIngredients(result.ingredients);
        setLines(saved);
        setValues(Object.fromEntries(
          result.ingredients.map((g) => [
            g.id,
            quantityText(saved[g.id]),
          ])
        ));
        setEditable(
          result.session.status === "draft" &&
          result.session.source === "manual"
        );
      } catch (err) {
        if (!cancelled) {
          setError(err.message || "Could not load the ingredients.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [sessionId, reload]);

  useEffect(() => {
    if (!dirtyCount) return;

    function beforeUnload(event) {
      event.preventDefault();
      event.returnValue = "";
    }

    function beforeLink(event) {
      const link = event.target.closest?.("a[href]");

      if (
        !link ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey ||
        link.target === "_blank"
      ) {
        return;
      }

      if (!window.confirm("Leave without saving your changed quantities?")) {
        event.preventDefault();
        event.stopPropagation();
      }
    }

    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", beforeLink, true);

    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", beforeLink, true);
    };
  }, [dirtyCount]);

  function reloadSaved() {
    if (
      dirtyCount &&
      !window.confirm("Discard unsaved quantities and reload the saved values?")
    ) {
      return;
    }

    setReload((value) => value + 1);
  }

  async function saveIngredient(g) {
    if (savingRef.current || !editable) return;

    const raw = (values[g.id] ?? "").trim();

    if (
      raw !== "" &&
      (!/^(?:\d+|\d*\.\d{1,6})$/.test(raw) ||
        !Number.isFinite(Number(raw)) ||
        Number(raw) > 1000000000)
    ) {
      setError(
        `${g.name}: enter zero or a positive quantity with no more than six decimal places.`
      );
      return;
    }

    savingRef.current = true;
    setSavingId(g.id);
    setError("");
    setNotice("");

    try {
      const result = await request(
        `/api/inventory/count-lines?session_id=${encodeURIComponent(sessionId)}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            ingredient_id: g.id,
            quantity: raw === "" ? null : Number(raw),
            unit: lines[g.id]?.unit || g.unit,
            expected_recorded_at: lines[g.id]?.recorded_at || null,
          }),
        }
      );

      setLines((current) => ({
        ...current,
        [g.id]: result.line,
      }));

      setValues((current) => ({
        ...current,
        [g.id]: quantityText(result.line),
      }));

      setNotice(
        raw === ""
          ? `${g.name} is saved as not counted.`
          : `${g.name} saved to this draft.`
      );
    } catch (err) {
      setError(err.message || "Could not save this quantity.");
    } finally {
      savingRef.current = false;
      setSavingId(null);
    }
  }

  const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = ingredients.filter((g) =>
    terms.every((term) => String(g.name || "").toLowerCase().includes(term))
  );

  const counted = Object.values(lines).filter(
    (line) => line.quantity !== null
  ).length;

  return (
    <fieldset
      disabled={submitting}
      style={{
        margin: "22px 0 0",
        padding: 0,
        border: 0,
        minWidth: 0,
      }}
    >
      <p style={{ color: "var(--muted)", lineHeight: 1.6 }}>
        Enter what is physically on hand, using the unit shown.
        Blank means not counted. Zero means none on hand.
        Save each changed row before leaving.
      </p>

      <p style={{ color: "var(--muted)", lineHeight: 1.6 }}>
        {editable
          ? "Saved draft quantities do not change live inventory until you submit the count."
          : "This count is read-only. Submitted counts are included in live inventory."}
      </p>

      {error && (
        <div
          role="alert"
          style={{
            border: "1px solid var(--red)",
            borderRadius: 12,
            padding: 12,
            marginBottom: 14,
            overflowWrap: "anywhere",
          }}
        >
          {error}
        </div>
      )}

      <div role="status" style={{ marginBottom: 14, lineHeight: 1.5 }}>
        {notice}
        {!!dirtyCount && (
          <div style={{ color: "var(--amber)" }}>
            {dirtyCount} unsaved {dirtyCount === 1 ? "row" : "rows"}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={reloadSaved}
        disabled={loading || !!savingId}
        style={{ ...buttonStyle, marginBottom: 16 }}
      >
        Reload saved values
      </button>

      {loading ? (
        <p role="status">Loading ingredients…</p>
      ) : (
        <>
          {!editable && (
            <p>This count is read-only.</p>
          )}

          {editable && dirtyCount === 0 && !savingId && counted > 0 && (
            <InventoryCountReview
              key={`${sessionId}:${reload}`}
              sessionId={sessionId}
              request={request}
              onSubmitting={setSubmitting}
            />
          )}

          {editable && dirtyCount > 0 && (
            <p style={{ color: "var(--amber)", lineHeight: 1.5 }}>
              Save your changed quantities before reviewing this count.
            </p>
          )}

          <label style={{ display: "block", fontWeight: 700 }}>
            Search ingredients
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Type an ingredient name"
              autoComplete="off"
              style={{ ...fieldStyle, marginTop: 8 }}
            />
          </label>

          <p style={{ color: "var(--muted)", fontSize: 14 }}>
            {counted} counted · Showing {shown.length} of {ingredients.length}
          </p>

          {shown.map((g) => {
            const saved = lines[g.id];
            const unit = saved?.unit || g.unit;
            const unitProblem =
              !g.unit?.trim() || (!!saved && saved.unit !== g.unit);
            const dirty =
              (values[g.id] ?? "") !== quantityText(saved);
            const disabled =
              !editable || !!savingId || unitProblem;

            return (
              <div
                key={g.id}
                style={{
                  borderTop: "1px solid var(--line)",
                  padding: "14px 0",
                  minWidth: 0,
                }}
              >
                <label
                  htmlFor={`count-${g.id}`}
                  style={{
                    display: "block",
                    fontWeight: 700,
                    overflowWrap: "anywhere",
                  }}
                >
                  {g.name || "Unnamed ingredient"}
                  <span
                    style={{
                      fontWeight: 400,
                      color: "var(--muted)",
                      marginLeft: 8,
                    }}
                  >
                    {unit || "Unit missing"}
                  </span>
                </label>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0, 1fr) auto",
                    gap: 10,
                    marginTop: 8,
                    alignItems: "center",
                  }}
                >
                  <input
                    id={`count-${g.id}`}
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="Not counted"
                    value={values[g.id] ?? ""}
                    disabled={disabled}
                    onChange={(event) => {
                      const value = event.target.value;
                      setValues((current) => ({
                        ...current,
                        [g.id]: value,
                      }));
                      setNotice("");
                    }}
                    style={fieldStyle}
                  />

                  <button
                    type="button"
                    aria-label={`Save ${g.name} quantity`}
                    disabled={disabled || !dirty}
                    onClick={() => saveIngredient(g)}
                    style={{
                      ...buttonStyle,
                      opacity: disabled || !dirty ? 0.5 : 1,
                      cursor: disabled || !dirty ? "default" : "pointer",
                    }}
                  >
                    {savingId === g.id ? "Saving…" : "Save"}
                  </button>
                </div>

                <div
                  style={{
                    marginTop: 6,
                    fontSize: 12,
                    color: dirty ? "var(--amber)" : "var(--muted)",
                    lineHeight: 1.5,
                  }}
                >
                  {unitProblem
                    ? "The ingredient unit is missing or changed. This count needs review before editing."
                    : dirty
                      ? "Not saved yet"
                      : saved?.quantity != null
                        ? `Saved: ${saved.quantity} ${saved.unit}`
                        : "Not counted"}
                </div>
              </div>
            );
          })}

          {!shown.length && (
            <p style={{ color: "var(--muted)" }}>
              {ingredients.length
                ? "No ingredients match your search."
                : "No ingredients are available to count yet."}
            </p>
          )}
        </>
      )}
    </fieldset>
  );
}