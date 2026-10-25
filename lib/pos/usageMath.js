export const normalize = (value) =>
  String(value || '').trim().toLowerCase();

export function applyPlan(base, plan, catalog, convert) {
  if (
    !plan ||
    !Array.isArray(plan.operations) ||
    !Array.isArray(plan.unresolved)
  ) {
    throw new Error('Invalid modifier interpretation');
  }

  if (plan.unresolved.length) {
    throw new Error(plan.unresolved.join('; '));
  }

  const known = new Map(catalog.map((ingredient) => [
    ingredient.id,
    ingredient,
  ]));

  const amounts = new Map(base.map((part) => [
    part.id,
    { ...part },
  ]));

  const touched = new Set();

  for (const operation of plan.operations) {
    if (!['remove', 'set', 'replace'].includes(operation.action)) {
      throw new Error('Invalid action');
    }

    const id = operation.ingredient_id;

    if (!known.has(id) || touched.has(id)) {
      throw new Error('Unknown or repeated ingredient operation');
    }

    touched.add(id);

    const old = amounts.get(id);

    if (
      operation.action === 'remove' ||
      operation.action === 'replace'
    ) {
      if (!old) {
        throw new Error(
          'Cannot remove an ingredient absent from this recipe'
        );
      }

      amounts.delete(id);
    }

    if (operation.action === 'remove') continue;

    const targetId = operation.action === 'replace'
      ? operation.target_id
      : id;

    const target = known.get(targetId);

    if (!target || !target.unit) {
      throw new Error('Unknown substitution ingredient or unit');
    }

    let quantity;

    if (
      operation.action === 'replace' &&
      operation.basis === 'equal_weight'
    ) {
      const weightUnits = ['oz', 'lb', 'g', 'kg'];

      if (
        !weightUnits.includes(normalize(old.unit)) ||
        !weightUnits.includes(normalize(target.unit))
      ) {
        throw new Error(
          'Equal-weight substitution requires weight units'
        );
      }

      quantity = convert(
        old.quantity,
        old.unit,
        target.unit,
        target.name
      );
    } else {
      if (
        !['recipe', 'estimated', 'configured'].includes(
          operation.basis
        )
      ) {
        throw new Error('Invalid portion basis');
      }

      if (
        typeof operation.quantity !== 'number' ||
        typeof operation.unit !== 'string' ||
        !operation.unit
      ) {
        throw new Error('Missing portion quantity or unit');
      }

      quantity = convert(
        operation.quantity,
        operation.unit,
        target.unit,
        target.name
      );
    }

    if (
      !Number.isFinite(quantity) ||
      quantity < 0 ||
      quantity > 1000
    ) {
      throw new Error(
        'Invalid or implausibly large single-dish portion'
      );
    }

    if (operation.action === 'replace') {
      if (targetId === id || touched.has(targetId)) {
        throw new Error('Conflicting substitution');
      }

      touched.add(targetId);

      const previous = amounts.get(targetId);

      const extra = previous
        ? convert(
            previous.quantity,
            previous.unit,
            target.unit,
            target.name
          )
        : 0;

      if (!Number.isFinite(extra)) {
        throw new Error(
          'Cannot convert existing replacement portion'
        );
      }

      quantity += extra;
    }

    amounts.set(targetId, {
      id: targetId,
      name: target.name,
      unit: target.unit,
      quantity,
    });
  }

  const result = [...amounts.values()];

  if (result.some((part) =>
    !Number.isFinite(part.quantity) ||
    part.quantity < 0 ||
    part.quantity > 1000
  )) {
    throw new Error('Invalid final portion');
  }

  return result.filter((part) => part.quantity > 0);
}

export function dishInstructions(item) {
  const strings = (value) => {
    if (value == null) return null;

    if (typeof value === 'string') return [value];

    if (
      !Array.isArray(value) ||
      value.some((entry) => typeof entry !== 'string')
    ) {
      throw new Error('Invalid typed requests');
    }

    return value;
  };

  return {
    requests: strings(item.specialRequests),
    modifiers: (item.ticketItemModifiers || [])
      .filter((modifier) => modifier.type !== 'void')
      .map((modifier) => ({
        ref: modifier.modifierRef || modifier.itemRef || null,
        name: modifier.name,
        quantity: modifier.quantity,
        requests: strings(modifier.specialRequests),
      })),
  };
}

export function foodUnits(ticket, item) {
  if (ticket.ticket_type === 'open' || item.isNonSalesRevenue) {
    return 0;
  }

  // A refund does not represent another newly prepared dish.
  if (item.type === 'refund') return 0;

  if (item.type === 'void') {
    const reason = normalize(
      item.voidReason || ticket.raw?.voidReason
    );

    // Employee-error waste still consumes ingredients.
    if (reason === 'employee error') {
      return Math.abs(Number(item.quantity));
    }

    if (
      ['customer changed mind', '86 out of item'].includes(reason)
    ) {
      return 0;
    }

    throw new Error(
      `Unmapped void reason: ${reason || '(missing)'}`
    );
  }

  if (item.type !== 'sale') {
    throw new Error(`Unsupported item type: ${item.type}`);
  }

  const quantity = Number(item.quantity);

  if (
    !Number.isInteger(quantity) ||
    quantity < 0 ||
    quantity > 100
  ) {
    throw new Error('Unsupported dish quantity');
  }

  return quantity;
}

export function verifyCoverage(source) {
  const expected = new Map();
  const actual = new Map();

  const add = (map, day, name, sold, refunds, voids) => {
    const key = `${day}|${normalize(name)}`;
    const old = map.get(key) || [0, 0, 0];

    map.set(key, [
      old[0] + sold,
      old[1] + refunds,
      old[2] + voids,
    ]);
  };

  for (const ticket of source.tickets) {
    if (ticket.ticket_type === 'open') continue;

    if (!Array.isArray(ticket.raw?.ticketItems)) {
      throw new Error('Ticket has no raw items');
    }

    for (const item of ticket.raw.ticketItems) {
      if (item.isNonSalesRevenue || !normalize(item.name)) {
        continue;
      }

      const quantity = Number(item.quantity);

      if (!Number.isFinite(quantity)) {
        throw new Error('Invalid ticket quantity');
      }

      add(
        expected,
        ticket.business_date,
        item.name,
        item.type === 'void' ? 0 : quantity,
        item.type === 'refund'
          ? Math.round(Math.abs(quantity))
          : 0,
        item.type === 'void' ? Math.round(quantity) : 0
      );
    }
  }

  for (const sale of source.sales) {
    add(
      actual,
      sale.sale_date,
      sale.item_name,
      Number(sale.quantity_sold || 0),
      Number(sale.refunds || 0),
      Number(sale.voids || 0)
    );
  }

  for (const key of new Set([
    ...expected.keys(),
    ...actual.keys(),
  ])) {
    const left = expected.get(key) || [0, 0, 0];
    const right = actual.get(key) || [0, 0, 0];

    if (left.some((value, index) =>
      !Number.isFinite(right[index]) ||
      Math.abs(value - right[index]) > 0.011
    )) {
      throw new Error(
        `Tickets and aggregated sales disagree for ${key}. ` +
        'Re-run POS sync first.'
      );
    }
  }
}