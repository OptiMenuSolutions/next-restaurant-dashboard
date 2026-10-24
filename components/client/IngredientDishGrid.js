import { useEffect, useRef, useState } from "react";
import { money } from "./ClientChrome";

function getPreview(dishes, columns, expanded) {
  const limit = columns * 3;
  const hasMore = dishes.length > limit;
  const visible = expanded || !hasMore
    ? dishes
    : dishes.slice(0, limit - 1);

  return {
    visible,
    hasMore,
    hidden: dishes.length - visible.length,
  };
}

export default function IngredientDishGrid({
  dishes = [],
  onOpenMenuItem,
}) {
  const containerRef = useRef(null);
  const [columns, setColumns] = useState(2);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const measure = () => {
      setColumns(element.getBoundingClientRect().width >= 540 ? 3 : 2);
    };

    measure();

    const observer = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(measure)
      : null;

    observer?.observe(element);
    window.addEventListener("resize", measure);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  const { visible, hasMore, hidden } = getPreview(
    dishes,
    columns,
    expanded
  );

  const tile = {
    minWidth: 0,
    minHeight: 112,
    padding: 10,
    border: "1px solid var(--line)",
    borderRadius: 10,
    background: "var(--shell)",
    color: "var(--text)",
    fontFamily: "inherit",
    textAlign: "left",
    cursor: "pointer",
  };

  return (
    <section
      ref={containerRef}
      style={{ minWidth: 0, flexShrink: 0 }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          marginBottom: 10,
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 700 }}>
          {dishes.length
            ? `Used in ${dishes.length} dish${dishes.length === 1 ? "" : "es"}`
            : "Not used in any dish yet"}
        </div>

        {expanded && hasMore && (
          <button
            type="button"
            onClick={() => setExpanded(false)}
            style={{
              border: "none",
              background: "none",
              color: "var(--accent-deep)",
              fontFamily: "inherit",
              fontSize: 12,
              fontWeight: 700,
              minHeight: 44,
              padding: "0 4px",
              cursor: "pointer",
            }}
          >
            Show fewer
          </button>
        )}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          gap: 8,
        }}
      >
        {visible.map((dish, index) => {
          const share = dish.share == null
            ? "—"
            : (dish.share < 1 && dish.cost > 0 ? "<1" : dish.share) + "%";

          return (
            <button
              key={dish.id || index}
              type="button"
              onClick={() => onOpenMenuItem?.(dish)}
              style={{
                ...tile,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <span
                style={{
                  display: "block",
                  fontSize: 13,
                  fontWeight: 700,
                  lineHeight: 1.3,
                  overflowWrap: "anywhere",
                }}
              >
                {dish.name}
              </span>

              <span
                style={{
                  display: "block",
                  marginTop: "auto",
                  fontSize: 11,
                  lineHeight: 1.4,
                  color: "var(--muted)",
                  overflowWrap: "anywhere",
                }}
              >
                {dish.qty || "—"} per plate
              </span>

              <span
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                  gap: 6,
                  width: "100%",
                  borderTop: "1px solid var(--line-soft)",
                  paddingTop: 7,
                }}
              >
                <span>
                  <span
                    style={{
                      display: "block",
                      fontSize: 12,
                      fontWeight: 700,
                    }}
                  >
                    {dish.cost == null ? "—" : money(dish.cost, 2)}
                  </span>
                  <span
                    style={{
                      display: "block",
                      fontSize: 9.5,
                      color: "var(--muted)",
                      marginTop: 2,
                    }}
                  >
                    Ingredient cost
                  </span>
                </span>

                <span style={{ textAlign: "right" }}>
                  <span
                    style={{
                      display: "block",
                      fontSize: 12,
                      fontWeight: 700,
                    }}
                  >
                    {share}
                  </span>
                  <span
                    style={{
                      display: "block",
                      fontSize: 9.5,
                      color: "var(--muted)",
                      marginTop: 2,
                    }}
                  >
                    Of menu price
                  </span>
                </span>
              </span>
            </button>
          );
        })}

        {!expanded && hasMore && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            aria-expanded={false}
            style={{
              ...tile,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              textAlign: "center",
              borderStyle: "dashed",
              color: "var(--accent-deep)",
            }}
          >
            <span style={{ fontSize: 14, fontWeight: 700 }}>
              View all →
            </span>
            <span style={{ fontSize: 11, color: "var(--muted)" }}>
              {hidden} more dish{hidden === 1 ? "" : "es"}
            </span>
          </button>
        )}
      </div>
    </section>
  );
}