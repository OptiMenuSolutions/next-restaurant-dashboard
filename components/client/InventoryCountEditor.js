import { useEffect, useRef, useState } from "react";
import supabase from "../../lib/supabaseClient";
import { SANS } from "./ClientChrome";
import InventoryCountReview from "./InventoryCountReview";
import { loadCurrentInventory } from "../../lib/currentInventory";
import { convertQuantity } from "../../lib/computeWasteRisk";

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

export default function InventoryCountEditor({ sessionId, restaurantId }) {
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
  const savingAllRef = useRef(false);
  const [savingAll, setSavingAll] = useState(false);
  const [filter, setFilter] = useState("all");
  const [stock, setStock] = useState(null);
  const [stockError, setStockError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    setStock(null);
    setStockError(false);

    if (restaurantId) {
      loadCurrentInventory(supabase, restaurantId)
        .then((rows) => {
          if (!cancelled) setStock(rows);
        })
        .catch(() => {
          if (!cancelled) setStockError(true);
        });
    }

    return () => { cancelled = true; };
  }, [restaurantId, reload]);

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
      return true;
    } catch (err) {
      setError(err.message || "Could not save this quantity.");
      return false;
    } finally {
      savingRef.current = false;
      setSavingId(null);
    }
  }

  async function saveDraft() {
    if (savingAllRef.current || savingRef.current || !editable) return;

    const changed = ingredients.filter((g) =>
      (values[g.id] ?? "") !== quantityText(lines[g.id])
    );

    savingAllRef.current = true;
    setSavingAll(true);

    try {
      for (const ingredient of changed) {
        const saved = await saveIngredient(ingredient);
        if (!saved) return;
      }
      setNotice("All changed quantities saved to your draft.");
    } finally {
      savingAllRef.current = false;
      setSavingAll(false);
    }
  }

  function stockQuantity(ingredient, targetUnit) {
    if (!stock || !targetUnit) return null;

    const rows = stock.filter((row) =>
      row.ingredientId === ingredient.id
    );

    let total = 0;

    for (const row of rows) {
      const quantity = convertQuantity(
        row.remainingQty,
        row.unit,
        targetUnit,
        ingredient.name
      );
      if (!Number.isFinite(quantity)) return null;
      total += quantity;
    }

    return total;
  }

  const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = ingredients.filter((g) => {
    const matches = terms.every((term) =>
      String(g.name || "").toLowerCase().includes(term)
    );
    const saved = lines[g.id]?.quantity != null;
    return matches && (
      filter === "all" ||
      (filter === "counted" ? saved : !saved)
    );
  });

  const counted = Object.values(lines).filter(
    (line) => line.quantity !== null
  ).length;

  return (
    <fieldset
      disabled={submitting || savingAll}
      style={{ margin: 0, padding: 0, border: 0, minWidth: 0 }}
    >
      <style jsx>{`
        .count-layout {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 320px;
          gap: 20px;
          align-items: start;
        }
        .count-sheet {
          min-width: 0;
          background: var(--shell);
          border: 1px solid var(--line);
          border-radius: 16px;
          padding: 20px;
        }
        .count-heading {
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-wrap: wrap;
          gap: 12px;
        }
        .count-search { width: 280px; max-width: 100%; }
        .count-filters {
          display: flex;
          gap: 8px;
          overflow-x: auto;
          padding: 18px 0;
        }
        .count-filters button { flex-shrink: 0; }
        .count-row {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 120px 130px 55px;
          gap: 12px;
          align-items: center;
          padding: 14px 12px;
          border-top: 1px solid var(--line);
          min-width: 0;
        }
        .count-columns {
          color: var(--muted);
          font-size: 10px;
          letter-spacing: 0.08em;
          background: var(--accent-tint);
          border-radius: 10px 10px 0 0;
        }
        .count-name {
          font-size: 14px;
          font-weight: 700;
          overflow-wrap: anywhere;
        }
        .count-estimate {
          font-size: 13px;
          color: var(--muted);
          font-variant-numeric: tabular-nums;
        }
        .count-input { min-width: 0; }
        .count-unit { font-size: 12px; color: var(--muted); }
        .count-row-note {
          grid-column: 1 / -1;
          font-size: 11px;
          color: var(--amber);
        }
        .count-aside { min-width: 0; position: sticky; top: 90px; }
        .count-actions {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          margin: 14px 0;
        }
        .count-mobile-label { display: none; }
        @media (max-width: 1000px) {
          .count-layout { grid-template-columns: minmax(0, 1fr) 280px; }
          .count-row {
            grid-template-columns: minmax(0, 1fr) 90px 100px 45px;
            gap: 8px;
          }
        }
        @media (max-width: 720px) {
          .count-layout { grid-template-columns: minmax(0, 1fr); }
          .count-sheet { padding: 14px; }
          .count-search { width: 100%; }
          .count-columns { display: none; }
          .count-row {
            grid-template-columns: minmax(0, 1fr) 90px 35px;
            gap: 6px 10px;
            padding: 14px 0;
          }
          .count-name { grid-column: 1; grid-row: 1; }
          .count-estimate { grid-column: 1; grid-row: 2; font-size: 12px; }
          .count-input { grid-column: 2; grid-row: 1 / span 2; }
          .count-unit { grid-column: 3; grid-row: 1 / span 2; }
          .count-mobile-label { display: inline; }
          .count-aside { position: static; }
          .count-actions {
            position: sticky;
            bottom: 12px;
            z-index: 12;
            padding: 12px;
            border: 1px solid var(--line);
            border-radius: 12px;
            background: var(--shell);
          }
          .count-actions > button { flex: 1; }
        }
      `}</style>

      {error && (
        <p role="alert" style={{
          padding: 12,
          border: "1px solid var(--red)",
          borderRadius: 10,
          overflowWrap: "anywhere",
        }}>
          {error}
        </p>
      )}

      {notice && <p role="status">{notice}</p>}

      {loading ? <p role="status">Loading ingredients…</p> : (
        <div className="count-layout">
          <section className="count-sheet">
            <div className="count-heading">
              <h2 style={{ margin: 0, fontSize: 22 }}>Count sheet</h2>
              <input
                className="count-search"
                aria-label="Search ingredients"
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search ingredients…"
                autoComplete="off"
                style={fieldStyle}
              />
            </div>

            <div className="count-filters" aria-label="Filter ingredients">
              {[
                ["all", "All ingredients", ingredients.length],
                ["counted", "Counted", counted],
                ["uncounted", "Not counted", ingredients.length - counted],
              ].map(([value, label, total]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={filter === value}
                  onClick={() => setFilter(value)}
                  style={{
                    ...buttonStyle,
                    minHeight: 36,
                    padding: "7px 12px",
                    fontSize: 12,
                    background: filter === value
                      ? "var(--accent-deep)"
                      : "var(--shell)",
                    color: filter === value
                      ? "var(--shell)"
                      : "var(--muted)",
                  }}
                >
                  {label} ({total})
                </button>
              ))}
            </div>

            <div style={{
              display: "flex",
              justifyContent: "space-between",
              color: "var(--muted)",
              fontSize: 12,
              marginBottom: 8,
            }}>
              <span>{counted} of {ingredients.length} saved</span>
              <span>{dirtyCount ? `${dirtyCount} unsaved` : editable ? "Draft saved" : "Read-only"}</span>
            </div>

            <progress
              aria-label="Ingredients counted"
              value={counted}
              max={Math.max(ingredients.length, 1)}
              style={{
                width: "100%",
                height: 6,
                accentColor: "var(--accent-deep)",
                marginBottom: 20,
              }}
            />

            <div className="count-row count-columns" aria-hidden="true">
              <span>INGREDIENT</span>
              <span>EST. ON HAND</span>
              <span>YOUR COUNT</span>
              <span>UNIT</span>
            </div>

            {shown.map((g) => {
              const saved = lines[g.id];
              const unit = saved?.unit || g.unit;
              const unitProblem =
                !g.unit?.trim() || (!!saved && saved.unit !== g.unit);
              const dirty = (values[g.id] ?? "") !== quantityText(saved);
              const estimate = stockQuantity(g, unit);

              return (
                <div className="count-row" key={g.id}>
                  <label className="count-name" htmlFor={`count-${g.id}`}>
                    {g.name || "Unnamed ingredient"}
                  </label>
                  <div className="count-estimate">
                    <span className="count-mobile-label">Est. on hand: </span>
                    {estimate == null ? "—" : estimate.toLocaleString("en-US", {
                      maximumFractionDigits: 3,
                    })}
                    <span className="count-mobile-label"> {unit}</span>
                  </div>
                  <div className="count-input">
                    <input
                      id={`count-${g.id}`}
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      placeholder="—"
                      value={values[g.id] ?? ""}
                      disabled={!editable || !!savingId || unitProblem}
                      onChange={(event) => {
                        const value = event.target.value;
                        setValues((current) => ({ ...current, [g.id]: value }));
                        setNotice("");
                      }}
                      style={{
                        ...fieldStyle,
                        borderColor: dirty ? "var(--amber)" : "var(--line)",
                      }}
                    />
                  </div>
                  <span className="count-unit">{unit || "—"}</span>
                  {(unitProblem || dirty) && (
                    <div className="count-row-note">
                      {unitProblem
                        ? "Unit missing or changed. Review this ingredient before editing."
                        : "Not saved yet"}
                    </div>
                  )}
                </div>
              );
            })}

            {!shown.length && (
              <p style={{ color: "var(--muted)" }}>
                No ingredients match these filters.
              </p>
            )}

            <p style={{ margin: "16px 0 0", color: "var(--muted)", fontSize: 12, lineHeight: 1.6 }}>
              Blank quantities leave inventory unchanged. Enter 0 when none is on hand.
              Estimates show current saved stock, not a historical count.
            </p>
            {stockError && (
              <p role="status" style={{ color: "var(--amber)", fontSize: 12 }}>
                Stock estimates could not be loaded. You can still enter and save your count.
              </p>
            )}
          </section>

          <aside className="count-aside">
            <div style={{
              padding: 18,
              background: "var(--shell)",
              border: "1px solid var(--line)",
              borderRadius: 14,
            }}>
              <h2 style={{ margin: "0 0 10px", fontSize: 20 }}>Count details</h2>
              <p style={{ color: "var(--muted)", fontSize: 13, lineHeight: 1.6 }}>
                {editable
                  ? "Save your quantities, then review the count date and timing before submitting."
                  : "This count is read-only."}
              </p>

              <button
                type="button"
                onClick={reloadSaved}
                disabled={!!savingId}
                style={{ ...buttonStyle, background: "var(--shell)", fontSize: 12 }}
              >
                Reload saved values
              </button>
            </div>

            {editable && dirtyCount === 0 && !savingId && counted > 0 && (
              <div id="count-review" style={{ marginTop: 16, scrollMarginTop: 90 }}>
                <InventoryCountReview
                  key={`${sessionId}:${reload}`}
                  sessionId={sessionId}
                  request={request}
                  onSubmitting={setSubmitting}
                />
              </div>
            )}

            {editable && (
              <div className="count-actions">
                <button
                  type="button"
                  onClick={saveDraft}
                  disabled={!dirtyCount || !!savingId || savingAll}
                  style={{
                    ...buttonStyle,
                    background: "var(--shell)",
                    opacity: !dirtyCount || !!savingId ? 0.5 : 1,
                  }}
                >
                  {savingAll ? "Saving…" : "Save draft"}
                </button>

                <button
                  type="button"
                  disabled={dirtyCount > 0 || !!savingId || counted === 0}
                  onClick={() => document.getElementById("count-review")?.scrollIntoView({
                    behavior: "smooth",
                    block: "start",
                  })}
                  style={{
                    ...buttonStyle,
                    opacity: dirtyCount > 0 || !!savingId || counted === 0 ? 0.5 : 1,
                  }}
                >
                  Review count
                </button>
              </div>
            )}
          </aside>
        </div>
      )}
    </fieldset>
  );
}