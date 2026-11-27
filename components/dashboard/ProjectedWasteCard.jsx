import React from "react";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const quantity = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const dates = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const reasons = {
  link_ingredient: "Link ingredient",
  unknown_fifo_date: "Delivery date unavailable",
  unknown_use_by_date: "Use-by date unavailable",
  missing_ingredient_unit: "Ingredient unit unavailable",
  missing_inventory_unit: "Stock unit unavailable",
  inventory_conversion_required: "Stock unit conversion needed",
  baseline_reassessment_required: "Batch changes need reassessment",
  frozen_unit_requires_reassessment: "Unit change needs reassessment",
  frozen_coverage_missing: "Saved demand coverage is incomplete",
  forecast_unavailable: "Forecast unavailable",
  inventory_behind_forecast: "Inventory and forecast cutoffs differ",
  forecast_horizon_missing: "Forecast coverage unavailable",
  night_forecast_unavailable: "Night forecast unavailable",
  recipe_coverage_incomplete: "Recipe coverage is incomplete",
  ingredient_dish_forecast_unavailable: "Dish forecast unavailable",
  ingredient_recipe_incomplete: "Ingredient recipe is incomplete",
  ingredient_conversion_required: "Recipe unit conversion needed",
  inventory_context_incomplete: "Stock information is incomplete",
};

const meta = { fontSize: "12px", color: "var(--muted)", lineHeight: 1.45 };
const rowStyle = { padding: "8px 0", borderBottom: "1px solid var(--line-soft)", listStyle: "none" };
const heading = { fontSize: "13px", fontWeight: 700, color: "var(--text)", marginBottom: "2px" };
const action = {
  color: "var(--accent-deep)", background: "var(--shell)", border: "1px solid var(--line)",
  borderRadius: "8px", padding: "5px 9px", minHeight: "36px", font: "inherit", fontSize: "12px",
  fontWeight: 700, cursor: "pointer",
};

function quantityLabel(value, unit) {
  return Number.isFinite(value) ? [quantity.format(value), unit].filter(Boolean).join(" ") : null;
}

function daysLabel(days) {
  if (days === null || days === undefined) return "Use-by date unavailable";
  if (days === 0) return "Use by today";
  const count = Math.abs(days);
  const label = `${count} ${count === 1 ? "day" : "days"}`;
  return days < 0 ? `${label} overdue` : `${label} left`;
}

function batchLabel(count) {
  return `${count} ${count === 1 ? "batch" : "batches"}`;
}

function BatchRow({ row, kind, onConfirm }) {
  const stock = quantityLabel(row.quantity, row.unit);
  const excess = quantityLabel(row.riskQty, row.riskUnit);
  const value = Number.isFinite(row.riskValue) ? money.format(row.riskValue) : null;
  return (
    <li style={rowStyle}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", flexWrap: "wrap" }}>
        <strong style={{ fontSize: "13px", overflowWrap: "anywhere" }}>{row.name}</strong>
        {kind === "overdue" && row.confirmationId && (
          <button type="button" style={action} onClick={() => onConfirm(row.confirmationId)}
            aria-label={`Review disposal for ${row.name}`}>
            Confirm or discard
          </button>
        )}
      </div>
      <div style={meta}>
        {daysLabel(row.daysLeft)}
        {row.useBy && row.daysLeft !== 0 && <> · {dates.format(new Date(`${row.useBy}T00:00:00Z`))}</>}
        {stock && <> · {stock} on hand</>}
      </div>
      {kind === "upcoming" && <div style={meta}>{[excess && `${excess} excess`, value].filter(Boolean).join(" · ")}</div>}
      {kind === "overdue" && value && <div style={meta}>{value} assessed value</div>}
      {kind === "review" && <div style={meta}>Estimate unavailable · {reasons[row.reason] || "More information needed"}</div>}
      {kind === "upcoming" && row.mayBeOverstated && <div style={meta}>May be overstated</div>}
    </li>
  );
}

export default function ProjectedWasteCard({ model, onConfirm, onRetry, refreshingFailed = false }) {
  const { upcoming, overdue, review, onHand, olderOverdue, olderReview, outsideWindow, handled } = model;
  return (
    <section aria-label="Waste risk" style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
      <header style={{ paddingBottom: "7px" }}>
        <h2 style={{ ...heading, fontSize: "15px" }}>Waste risk</h2>
        <div style={meta}>
          {model.stale && <strong>Stale assessment · </strong>}
          Inventory through {dates.format(new Date(`${model.inventoryCutoff}T00:00:00Z`))}
        </div>
        {model.forecastFallback && <div style={meta}>Uses the previous forecast</div>}
        {refreshingFailed && (
          <div role="status" style={meta}>
            Could not refresh the assessment.{" "}
            <button type="button" style={action} onClick={onRetry}>Retry</button>
          </div>
        )}
      </header>
      <div style={{ display: "grid", gap: "12px", overflowY: "auto", minHeight: 0, alignContent: "start" }}>
        <section>
          <h3 style={heading}>Estimated excess at expiry</h3>
          {upcoming.length ? (
            <ul>{upcoming.map(row => <BatchRow key={row.id} row={row} kind="upcoming" />)}</ul>
          ) : <p style={meta}>No upcoming excess estimates to show.</p>}
        </section>

        {(overdue.length > 0 || olderOverdue.count > 0) && (
          <section>
            <h3 style={heading}>Overdue stock</h3>
            <ul>{overdue.map(row => <BatchRow key={row.id} row={row} kind="overdue" onConfirm={onConfirm} />)}</ul>
            {olderOverdue.count > 0 && (
              <div style={meta}>
                {batchLabel(olderOverdue.count)} more than seven business dates overdue
                {Number.isFinite(olderOverdue.riskValue) && <> · {money.format(olderOverdue.riskValue)} known assessed value</>}
                {olderOverdue.unvaluedCount > 0 && <div>Value unavailable for {batchLabel(olderOverdue.unvaluedCount)}</div>}
                {olderOverdue.confirmedWasted > 0 && (
                  <div>Includes {olderOverdue.confirmedWasted} confirmed wasted, updates after the next assessment.</div>
                )}
              </div>
            )}
          </section>
        )}

        {handled.length > 0 && (
          <section>
            <h3 style={heading}>Handled</h3>
            <ul>{handled.map(row => (
              <li key={row.id} style={rowStyle}>
                <strong style={{ fontSize: "13px" }}>{row.name}</strong>
                <div style={meta}>Confirmed wasted · pending next assessment</div>
              </li>
            ))}</ul>
          </section>
        )}

        {(review.length > 0 || olderReview.length > 0) && (
          <details>
            <summary style={heading}>Needs review ({review.length + olderReview.reduce((sum, row) => sum + row.count, 0)})</summary>
            <ul>{review.map(row => <BatchRow key={row.id} row={row} kind="review" />)}</ul>
            {olderReview.map(row => (
              <p key={row.reason} style={meta}>{batchLabel(row.count)} more than seven business dates overdue · {reasons[row.reason] || "More information needed"}</p>
            ))}
          </details>
        )}

        {onHand.length > 0 && (
          <details>
            <summary style={heading}>On hand ({onHand.length})</summary>
            <ul>{onHand.map(row => <BatchRow key={row.id} row={row} kind="stock" />)}</ul>
          </details>
        )}

        {outsideWindow?.count > 0 && (
          <p style={meta}>{batchLabel(outsideWindow.count)} outside the risk window
            {Number.isFinite(outsideWindow.risk_value) && <> · {money.format(outsideWindow.risk_value)} known assessed value</>}
          </p>
        )}
      </div>
    </section>
  );
}