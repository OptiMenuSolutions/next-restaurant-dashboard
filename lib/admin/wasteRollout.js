const number = value => Number.isFinite(value) ? value : null;

function totaled(rows, quantity, value, summarized) {
  let knownValue = summarized?.risk_value ?? 0;
  let unvalued = summarized?.unvalued_count ?? 0;
  const amounts = new Map();
  for (const row of rows) {
    if (Number.isFinite(row[value])) knownValue += row[value];
    else unvalued++;
    if (row.unit && Number.isFinite(row[quantity])) {
      amounts.set(row.unit, (amounts.get(row.unit) ?? 0) + row[quantity]);
    }
  }
  const count = rows.length + (summarized?.count ?? 0);
  return { count, knownValue: count > unvalued ? knownValue : null, unvalued, amounts: [...amounts] };
}

export function compareWasteCards(snapshotRows, assessment, ingredientNames, elapsed) {
  const snapshots = new Map(snapshotRows.map(row => [row.invoice_item_id, row]));
  const legacyRisk = snapshotRows.filter(row =>
    Number.isFinite(row.days_left) && row.days_left - elapsed <= 7 && row.remaining_qty > 0);
  const legacyIds = new Set(legacyRisk.map(row => row.invoice_item_id));
  const recorded = new Map((assessment ? [...assessment.items, ...assessment.needs_review] : [])
    .map(row => [row.batch_id, row]));
  const pending = new Set(assessment?.pending_batch_ids);
  const projectedRisk = (assessment?.items ?? []).filter(row => !pending.has(row.batch_id) &&
    (row.status === 'overdue' || (row.status === 'ok' && row.visible && row.risk_qty > 0)));

  const projectedIds = new Set(projectedRisk.map(row => row.batch_id));
  const ids = new Set([...legacyIds, ...projectedIds]);
  const rows = [...ids].map(id => {
    const old = snapshots.get(id);
    const next = recorded.get(id);
    const legacy = legacyIds.has(id) ? {
      quantity: number(old.remaining_qty), value: number(old.total_value), daysLeft: old.days_left - elapsed,
    } : null;
    const projected = projectedIds.has(id) ? {
      quantity: number(next.risk_qty), unit: next.unit, value: number(next.risk_value),
      useBy: next.use_by_date, status: next.status,
    } : null;
    let reason = null;
    if (!projected) {
      if (!assessment) reason = 'No completed compact assessment for this date.';
      else if (pending.has(id)) reason = 'Disposal pending at assessment time.';
      else if (next?.status === 'unavailable') reason = next.reason || 'Estimate unavailable.';
      else if (next?.status === 'ok' && next.risk_qty === 0) reason = 'No estimated excess.';
      else if (next) reason = next.reason || next.status;
      else reason = 'No individual compact row. Check summarized batches.';
    } else if (!legacy) {
      reason = old ? 'Snapshot batch did not meet the legacy card filter.' : 'No batch in the dated invoice snapshot.';
    }
    return { id, name: old?.ingredient_name || ingredientNames.get(next?.ingredient_id) || id, legacy, projected, reason };
  });
  const review = new Map(Object.entries(assessment?.omitted?.needs_review?.by_reason ?? {}));
  for (const row of assessment?.needs_review ?? []) {
    const reason = row.reason || 'unknown';
    review.set(reason, (review.get(reason) ?? 0) + 1);
  }

  return {
    rows,
    legacy: snapshotRows.length ? totaled(legacyRisk, 'remaining_qty', 'total_value') : null,
    projected: assessment ? totaled(projectedRisk, 'risk_qty', 'risk_value', assessment.omitted?.overdue) : null,
    review: [...review],
  };
}