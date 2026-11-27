import { shiftProjectionDate } from './projections/businessTime.js';

const DAY = 86_400_000;

function daysUntil(useBy, day) {
  if (!useBy) return null;
  const days = (Date.parse(`${useBy}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / DAY;
  return Number.isFinite(days) ? days : null;
}

function inventoryBatchId(row) {
  return row.stockSource === 'count' ? row.countLineId : row.invoiceItemId;
}

export function selectWasteCardConfirmations(card, confirmations, automatic, selectedId) {
  if (!card) return { selected: null, shown: automatic };
  const actionable = new Set(card.overdue.map(row => row.confirmationId).filter(Boolean));
  const selected = actionable.has(selectedId) ? confirmations.find(row => row.id === selectedId) : null;
  return { selected, shown: selected ? [selected] : automatic };
}

export function addPendingWasteDisposal(view, confirmation) {
  const batchId = confirmation.invoiceItemId;
  if (view?.mode !== 'assessment' || !batchId ||
      view.pending_disposals.some(row => row.batch_id === batchId)) return view;
  const row = view.items.find(item => item.batch_id === batchId);
  return {
    ...view,
    pending_disposals: [...view.pending_disposals, {
      batch_id: batchId,
      confirmation_id: confirmation.id,
      ingredient_name: confirmation.ingredientName,
      last_known_use_by_date: row?.use_by_date ?? null,
    }],
  };
}

export function buildWasteAssessmentCard(view, inventory, confirmations) {
  if (view?.mode !== 'assessment') return null;
  const inventoryByBatch = new Map(inventory.map(row => [inventoryBatchId(row), row]));
  const ingredientNames = new Map(inventory.filter(row => row.ingredientId && row.name)
    .map(row => [row.ingredientId, row.name]));
  const confirmationByBatch = new Map(confirmations.map(row => [row.invoiceItemId, row]));
  const pending = new Map(view.pending_disposals.map(row => [row.batch_id, row]));
  const storedBatches = new Set([...view.items, ...view.needs_review].map(row => row.batch_id));
  const summarized = view.omitted_by_status.overdue;
  const olderOverdue = {
    count: summarized?.count ?? 0,
    riskValue: summarized?.risk_value ?? null,
    unvaluedCount: summarized?.unvalued_count ?? 0,
    confirmedWasted: 0,
  };
  const upcoming = [], overdue = [], review = [], onHand = [];
  const summarizedReview = view.omitted_by_status.needs_review;
  const olderReview = new Map(Object.entries(summarizedReview?.by_reason ?? {}));

  const displayRow = row => {
    const inventoryRow = inventoryByBatch.get(row.batch_id);
    const confirmation = confirmationByBatch.get(row.batch_id);
    return {
      id: row.batch_id,
      name: inventoryRow?.name || confirmation?.ingredientName || ingredientNames.get(row.ingredient_id) || 'Inventory batch',
      useBy: row.use_by_date,
      daysLeft: daysUntil(row.use_by_date, view.business_date),
      quantity: row.stock_remaining_qty,
      unit: row.stock_unit,
      riskQty: row.risk_qty,
      riskUnit: row.unit,
      riskValue: row.risk_value,
      mayBeOverstated: row.may_be_overstated,
      reason: row.reason,
      confirmationId: confirmation?.id,
    };
  };

  for (const row of view.items) {
    const display = displayRow(row);
    const disposed = pending.has(row.batch_id) || row.pending_disposal;
    if (row.status === 'overdue' || (display.daysLeft !== null && display.daysLeft < 0)) {
      if (display.daysLeft !== null && display.daysLeft < -7) {
        olderOverdue.count++;
        if (disposed) olderOverdue.confirmedWasted++;
        else if (Number.isFinite(display.riskValue)) {
          olderOverdue.riskValue = (olderOverdue.riskValue ?? 0) + display.riskValue;
        } else olderOverdue.unvaluedCount++;
      } else if (!disposed) overdue.push(display);
    } else if (!disposed && row.status === 'ok') {
      if (row.visible && row.risk_qty > 0) upcoming.push(display);
      else {
        const live = inventoryByBatch.get(row.batch_id);
        onHand.push({ ...display, quantity: live?.remainingQty ?? display.quantity, unit: live?.unit ?? display.unit });
      }
    }
  }

  let summarizedDisposals = 0;
  for (const row of pending.values()) {
    const ageAtAssessment = daysUntil(row.last_known_use_by_date, view.assessment_date);
    if (!storedBatches.has(row.batch_id) && ageAtAssessment !== null && ageAtAssessment < -7) {
      summarizedDisposals++;
    }
  }
  // Once both kinds of older rows are summarized, an absent batch could
  // belong to either bucket. It still appears in the handled list below.
  if (!summarizedReview?.count) {
    olderOverdue.confirmedWasted += Math.min(summarizedDisposals, summarized?.count ?? 0);
  }

  for (const row of view.needs_review) {
    if (pending.has(row.batch_id) || row.pending_disposal) continue;
    const display = displayRow(row);
    const live = inventoryByBatch.get(row.batch_id);
    display.quantity = live?.remainingQty ?? display.quantity;
    display.unit = live?.unit ?? display.unit;
    if (display.daysLeft !== null && display.daysLeft < -7) {
      const reason = row.reason || 'unknown';
      olderReview.set(reason, (olderReview.get(reason) ?? 0) + 1);
    } else review.push(display);
  }

  for (const row of inventory) {
    const id = inventoryBatchId(row);
    if (!id || storedBatches.has(id) || pending.has(id) || !(row.remainingQty > 0) ||
        !row.deliveryDate || row.deliveryDate <= view.inventory_cutoff || !Number.isSafeInteger(row.shelfLife)) continue;
    const useBy = shiftProjectionDate(row.deliveryDate, row.shelfLife);
    const daysLeft = daysUntil(useBy, view.business_date);
    if (daysLeft < 0 || daysLeft > 7) continue;
    onHand.push({ id, name: row.name, useBy, daysLeft, quantity: row.remainingQty, unit: row.unit });
  }

  const byUseBy = (a, b) => (a.daysLeft ?? Infinity) - (b.daysLeft ?? Infinity) || a.name.localeCompare(b.name);
  return {
    inventoryCutoff: view.inventory_cutoff,
    stale: view.stale,
    forecastFallback: view.forecast_fallback,
    upcoming: upcoming.sort(byUseBy),
    overdue: overdue.sort(byUseBy),
    review: review.sort(byUseBy),
    onHand: onHand.sort(byUseBy),
    olderOverdue,
    olderReview: [...olderReview].map(([reason, count]) => ({ reason, count })),
    outsideWindow: view.omitted_by_status.outside_risk_window ?? null,
    handled: [...pending.values()].map(row => ({
      id: row.batch_id,
      name: row.ingredient_name || inventoryByBatch.get(row.batch_id)?.name || 'Inventory batch',
    })),
  };
}