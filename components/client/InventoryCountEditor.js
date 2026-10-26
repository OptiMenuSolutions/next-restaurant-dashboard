import { useEffect, useRef, useState } from "react";
import supabase from "../../lib/supabaseClient";
import { SANS, useIsMobile } from "./ClientChrome";
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

const MONO = "'IBM Plex Mono', ui-monospace, monospace";

const fieldStyle = {
  width: "100%",
  minWidth: 0,
  minHeight: 40,
  boxSizing: "border-box",
  border: "1px solid var(--line)",
  borderRadius: 10,
  padding: "0 12px",
  background: "var(--shell)",
  color: "var(--text)",
  fontFamily: SANS,
  fontSize: 14,
};

const buttonStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  minHeight: 40,
  border: "1px solid var(--line)",
  borderRadius: 20,
  padding: "0 16px",
  background: "var(--shell)",
  color: "var(--text)",
  fontFamily: SANS,
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const primaryStyle = {
  ...buttonStyle,
  border: 0,
  background: "var(--accent-deep)",
  color: "var(--on-accent, #ffffff)",
  fontWeight: 700,
};

const formatQty = (n) =>
  Number(n).toLocaleString("en-US", { maximumFractionDigits: 3 });

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
  const isMobile = useIsMobile();

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

  // What the typed count does to the estimate, in plain words.
  function changeFor(g, unit, estimate) {
    const raw = (values[g.id] ?? "").trim();
    if (raw === "") return { text: "Not counted", color: "var(--faint)" };
    const value = Number(raw);
    if (!Number.isFinite(value)) return { text: "Check this number", color: "var(--red)" };
    if (value === 0) return { text: "None left", color: "var(--red)" };
    if (estimate == null) return { text: "Counted", color: "var(--accent-deep)" };
    const diff = value - estimate;
    if (Math.abs(diff) < 0.0005) return { text: "Matches estimate", color: "var(--green)" };
    return {
      text: `${diff > 0 ? "+" : "−"}${formatQty(Math.abs(diff))} ${unit || ""}`.trim(),
      color: "var(--amber)",
    };
  }

  const status = dirtyCount
    ? `${dirtyCount} UNSAVED`
    : editable ? "DRAFT SAVED" : "READ-ONLY";
  const pct = ingredients.length ? (counted / ingredients.length) * 100 : 0;
  const cols = "minmax(0, 1.4fr) 120px 130px 64px 130px";

  const filters = (
    <div role="group" aria-label="Filter ingredients" style={{ display: "flex", background: "var(--panel)", borderRadius: 10, padding: 3, gap: 2 }}>
      {[
        ["all", "All", ingredients.length],
        ["counted", "Counted", counted],
        ["uncounted", isMobile ? "To count" : "Not counted", ingredients.length - counted],
      ].map(([value, label, total]) => (
        <button
          key={value}
          type="button"
          aria-pressed={filter === value}
          onClick={() => setFilter(value)}
          style={{ flex: 1, minHeight: 34, border: 0, borderRadius: 8, padding: "0 10px", cursor: "pointer", whiteSpace: "nowrap", fontFamily: SANS, fontSize: 12.5, fontWeight: 600, background: filter === value ? "var(--shell)" : "transparent", color: filter === value ? "var(--text)" : "var(--muted)", boxShadow: filter === value ? "0 1px 2px rgba(17,24,25,0.10)" : "none" }}
        >
          {label} · {total}
        </button>
      ))}
    </div>
  );

  const progress = (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <div role="progressbar" aria-label="Ingredients counted" aria-valuenow={counted} aria-valuemin={0} aria-valuemax={ingredients.length} style={{ flex: 1, height: 6, borderRadius: 3, background: "var(--line-soft)", overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: "var(--accent)" }} />
      </div>
      <span style={{ fontFamily: MONO, fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap" }}>
        {counted} OF {ingredients.length} COUNTED
      </span>
    </div>
  );

  const searchBox = (
    <div style={{ position: "relative", flex: isMobile ? "0 0 auto" : "1 1 220px", minWidth: 0 }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true" style={{ position: "absolute", left: 12, top: 12 }}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.6-3.6" /></svg>
      <input
        aria-label="Search ingredients"
        type="search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search ingredients"
        autoComplete="off"
        style={{ ...fieldStyle, paddingLeft: 36, fontSize: isMobile ? 16 : 14 }}
      />
    </div>
  );

  const rows = shown.map((g, index) => {
    const saved = lines[g.id];
    const unit = saved?.unit || g.unit;
    const unitProblem = !g.unit?.trim() || (!!saved && saved.unit !== g.unit);
    const dirty = (values[g.id] ?? "") !== quantityText(saved);
    const estimate = stockQuantity(g, unit);
    const change = changeFor(g, unit, estimate);
    const hasValue = (values[g.id] ?? "") !== "";

    const input = (
      <input
        id={`count-${g.id}`}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        placeholder="—"
        aria-label={`${g.name || "Ingredient"} counted`}
        value={values[g.id] ?? ""}
        disabled={!editable || !!savingId || unitProblem}
        onChange={(event) => {
          const value = event.target.value;
          setValues((current) => ({ ...current, [g.id]: value }));
          setNotice("");
        }}
        style={{
          ...fieldStyle,
          textAlign: "right",
          fontFamily: MONO,
          fontSize: isMobile ? 16 : 14,
          borderColor: dirty ? "var(--amber)" : hasValue ? "var(--accent)" : "var(--line)",
          background: hasValue && !dirty ? "var(--accent-tint)" : "var(--shell)",
        }}
      />
    );

    const note = (unitProblem || dirty) && (
      <div style={{ fontFamily: MONO, fontSize: 10.5, fontWeight: 600, color: "var(--amber)", marginTop: 3 }}>
        {unitProblem ? "UNIT MISSING OR CHANGED · REVIEW THIS INGREDIENT" : "NOT SAVED YET"}
      </div>
    );

    if (isMobile) {
      return (
        <div key={g.id} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 100px 44px", gap: 10, alignItems: "center", padding: "10px 14px", borderTop: index ? "1px solid var(--line-soft)" : 0 }}>
          <label htmlFor={`count-${g.id}`} style={{ minWidth: 0 }}>
            <span style={{ display: "block", fontSize: 14, fontWeight: 700, overflowWrap: "anywhere" }}>{g.name || "Unnamed ingredient"}</span>
            <span style={{ display: "block", marginTop: 2, fontFamily: MONO, fontSize: 10.5, color: hasValue ? change.color : "var(--muted)" }}>
              {hasValue ? change.text.toUpperCase() : `EST. ${estimate == null ? "—" : formatQty(estimate)} ${unit || ""}`}
            </span>
            {note}
          </label>
          {input}
          <span style={{ fontFamily: MONO, fontSize: 11.5, color: "var(--muted)" }}>{unit || "—"}</span>
        </div>
      );
    }

    return (
      <div key={g.id} style={{ display: "grid", gridTemplateColumns: cols, gap: 14, alignItems: "center", padding: "9px 18px", borderTop: "1px solid var(--line-soft)" }}>
        <label htmlFor={`count-${g.id}`} style={{ minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 14, fontWeight: 700, overflowWrap: "anywhere" }}>{g.name || "Unnamed ingredient"}</span>
          {note}
        </label>
        <span style={{ textAlign: "right", fontFamily: MONO, fontSize: 12.5, color: "var(--muted)" }}>
          {estimate == null ? "—" : formatQty(estimate)}
        </span>
        {input}
        <span style={{ fontFamily: MONO, fontSize: 12, color: "var(--muted)" }}>{unit || "—"}</span>
        <span style={{ textAlign: "right", fontFamily: MONO, fontSize: 12, fontWeight: 600, color: change.color }}>{change.text}</span>
      </div>
    );
  });

  const sheet = (
    <section style={{ minWidth: 0, background: "var(--shell)", border: "1px solid var(--line)", borderRadius: 14, overflow: "hidden" }}>
      {!isMobile && (
        <div style={{ padding: "14px 18px", display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", borderBottom: "1px solid var(--line)" }}>
          {searchBox}
          <div style={{ flex: "0 1 380px", minWidth: 0 }}>{filters}</div>
        </div>
      )}
      <div style={{ padding: isMobile ? "10px 14px" : "12px 18px", display: "flex", flexDirection: "column", gap: 6 }}>
        {progress}
        <span style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: "0.06em", color: dirtyCount ? "var(--amber)" : "var(--muted)" }}>{status}</span>
      </div>
      {!isMobile && (
        <div aria-hidden="true" style={{ display: "grid", gridTemplateColumns: cols, gap: 14, padding: "8px 18px", background: "var(--panel)", fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.12em", color: "var(--muted)" }}>
          <span>INGREDIENT</span>
          <span style={{ textAlign: "right" }}>ESTIMATED</span>
          <span style={{ textAlign: "right" }}>COUNTED</span>
          <span>UNIT</span>
          <span style={{ textAlign: "right" }}>CHANGE</span>
        </div>
      )}
      {rows}
      {!shown.length && (
        <p style={{ margin: 0, padding: "18px", color: "var(--muted)", fontSize: 13, borderTop: "1px solid var(--line-soft)" }}>
          No ingredients match these filters.
        </p>
      )}
      <div style={{ padding: isMobile ? "12px 14px" : "12px 18px", borderTop: "1px solid var(--line-soft)", background: "var(--panel)", fontSize: 12, lineHeight: 1.6, color: "var(--muted)" }}>
        Blank leaves that ingredient’s estimate alone. Enter 0 when none is left. Estimates show current saved stock, not a past count.
        {stockError && (
          <span role="status" style={{ display: "block", marginTop: 4, color: "var(--amber)" }}>
            Stock estimates could not be loaded. You can still enter and save your count.
          </span>
        )}
      </div>
    </section>
  );

  const detailsCard = (
    <section style={{ background: "var(--shell)", border: "1px solid var(--line)", borderRadius: 14, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
      <h2 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>{editable ? "Your count" : "Submitted count"}</h2>
      <div style={{ background: "var(--panel)", borderRadius: 10, padding: "10px 12px", fontSize: 13, lineHeight: 1.5 }}>
        <strong>{counted}</strong> {counted === 1 ? "ingredient" : "ingredients"} counted. <strong>{ingredients.length - counted}</strong> {editable ? "keep" : "kept"} their estimate.
      </div>
      <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.55, color: "var(--muted)" }}>
        {editable
          ? dirtyCount
            ? "Save your changed quantities. Then choose when you counted and submit."
            : counted
              ? "All quantities are saved. Choose when you counted below, then submit."
              : "Enter at least one quantity to continue."
          : "This count is read-only."}
      </p>
      {editable && !isMobile && (
        <button
          type="button"
          onClick={saveDraft}
          disabled={!dirtyCount || !!savingId || savingAll}
          style={{ ...(dirtyCount ? primaryStyle : buttonStyle), minHeight: 42, opacity: !dirtyCount || !!savingId ? 0.5 : 1 }}
        >
          {savingAll ? "Saving…" : dirtyCount ? `Save ${dirtyCount} ${dirtyCount === 1 ? "change" : "changes"}` : "All changes saved"}
        </button>
      )}
      <button
        type="button"
        onClick={reloadSaved}
        disabled={!!savingId}
        style={{ alignSelf: "flex-start", border: 0, background: "none", padding: 0, fontFamily: SANS, fontSize: 13, fontWeight: 700, color: "var(--accent-deep)", cursor: "pointer" }}
      >
        Reload saved values
      </button>
    </section>
  );

  const reviewCard = editable && dirtyCount === 0 && !savingId && counted > 0 && (
    <div id="count-review" style={{ scrollMarginTop: 90 }}>
      <InventoryCountReview
        key={`${sessionId}:${reload}`}
        sessionId={sessionId}
        request={request}
        onSubmitting={setSubmitting}
      />
    </div>
  );

  const messages = (
    <>
      {error && (
        <p role="alert" style={{ margin: 0, padding: "10px 12px", borderRadius: 10, background: "var(--red-tint, #fbeceb)", color: "var(--red)", fontSize: 13, lineHeight: 1.5, overflowWrap: "anywhere" }}>
          {error}
        </p>
      )}
      {notice && (
        <p role="status" style={{ margin: 0, padding: "10px 12px", borderRadius: 10, background: "var(--accent-tint)", fontSize: 13, lineHeight: 1.5 }}>
          {notice}
        </p>
      )}
    </>
  );

  return (
    <fieldset
      disabled={submitting || savingAll}
      style={{ margin: 0, padding: 0, border: 0, minWidth: 0, display: "flex", flexDirection: "column", gap: 14 }}
    >
      {messages}

      {loading ? (
        <p role="status" style={{ margin: 0, color: "var(--muted)" }}>Loading ingredients…</p>
      ) : isMobile ? (
        <>
          {searchBox}
          {filters}
          {sheet}
          {detailsCard}
          {reviewCard}
          {editable && (
            <div style={{ position: "sticky", bottom: 0, zIndex: 12, margin: "0 -16px -32px", padding: "10px 16px 12px", background: "var(--shell)", borderTop: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ flex: 1, minWidth: 0, fontFamily: MONO, fontSize: 10.5, color: dirtyCount ? "var(--amber)" : "var(--muted)" }}>{status}</span>
              <button
                type="button"
                onClick={saveDraft}
                disabled={!dirtyCount || !!savingId || savingAll}
                style={{ ...buttonStyle, minHeight: 42, opacity: !dirtyCount || !!savingId ? 0.5 : 1 }}
              >
                {savingAll ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                disabled={dirtyCount > 0 || !!savingId || counted === 0}
                onClick={() => document.getElementById("count-review")?.scrollIntoView({ behavior: "smooth", block: "start" })}
                style={{ ...primaryStyle, minHeight: 42, opacity: dirtyCount > 0 || !!savingId || counted === 0 ? 0.5 : 1 }}
              >
                Review
              </button>
            </div>
          )}
        </>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 340px", gap: 18, alignItems: "start" }}>
          {sheet}
          <aside style={{ minWidth: 0, position: "sticky", top: 16, display: "flex", flexDirection: "column", gap: 14 }}>
            {detailsCard}
            {reviewCard}
          </aside>
        </div>
      )}
    </fieldset>
  );
}