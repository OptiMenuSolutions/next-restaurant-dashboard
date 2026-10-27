// Copies a reviewed answer for one dish onto another dish sold with the
// same request, using the other dish's own recipe amounts.
// Returns null when the change does not fit the other recipe.

const total = (recipe, id) => {
  const parts = (recipe || []).filter((part) => part.id === id);

  if (!parts.length) return null;

  const unit = parts[0].unit;

  if (parts.some((part) => part.unit !== unit)) {
    return { quantity: null, unit };
  }

  return {
    quantity: parts.reduce((sum, part) => sum + Number(part.quantity || 0), 0),
    unit,
  };
};

// An admin portion list (replace_all) turned into plain recipe changes.
function changes(plan, recipe) {
  if (!plan.replace_all) return plan.operations;

  const sets = new Map(
    plan.operations
      .filter((op) => op.action === 'set')
      .map((op) => [op.ingredient_id, op])
  );
  const ids = [...new Set((recipe || []).map((part) => part.id))];
  const ops = [];

  for (const id of ids) {
    const before = total(recipe, id);
    const set = sets.get(id);

    if (!set) {
      ops.push({
        action: 'remove',
        ingredient_id: id,
        target_id: null,
        quantity: null,
        unit: null,
        basis: 'configured',
        reason: 'Removed by admin',
      });
      continue;
    }

    if (
      before.quantity != null &&
      before.unit === set.unit &&
      Math.abs(before.quantity - set.quantity) > 1e-9
    ) {
      ops.push(set);
    }
  }

  for (const [id, set] of sets) {
    if (!ids.includes(id)) ops.push(set);
  }

  return ops;
}

export function transferPlan(plan, sourceRecipe, targetRecipe) {
  if (
    !plan ||
    plan.pending ||
    !Array.isArray(plan.operations) ||
    plan.unresolved?.length
  ) {
    return null;
  }

  const ops = changes(plan, sourceRecipe);
  const operations = [];

  for (const op of ops) {
    const id = op.ingredient_id;
    const source = total(sourceRecipe, id);
    const target = total(targetRecipe, id);

    if (op.action === 'remove') {
      if (target) operations.push({ ...op });
      continue;
    }

    if (op.action === 'replace') {
      if (!target) return null;
      operations.push({ ...op });
      continue;
    }

    if (op.action !== 'set') return null;

    // An added ingredient copies its amount.
    if (!source) {
      operations.push({ ...op });
      continue;
    }

    // A changed amount keeps the same proportion of this recipe.
    if (
      !target ||
      !(source.quantity > 0) ||
      target.quantity == null ||
      source.unit !== op.unit ||
      target.unit !== op.unit
    ) {
      return null;
    }

    operations.push({
      ...op,
      quantity: Number(((target.quantity * op.quantity) / source.quantity).toFixed(4)),
      reason: 'Same proportion as the reviewed dish',
    });
  }

  if (ops.length && !operations.length) return null;

  return {
    operations,
    unresolved: [],
    untracked: Array.isArray(plan.untracked) ? plan.untracked : [],
    explanation: 'Same change as a reviewed dish, using this recipe amounts.',
  };
}