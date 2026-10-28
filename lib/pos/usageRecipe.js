import { requireIngredientConversion } from '../ingredientUnitConversions';

const text = (value) => String(value || '').trim().toLowerCase();
const noun = (value) => text(value).replace(/s$/, '');

export function rawRecipe(menu, catalog) {
  const known = new Map(catalog.map((row) => [row.id, row]));

  return (menu.menu_item_components || []).flatMap((component) =>
    (component.component_ingredients || []).map((part) => {
      const ingredient = known.get(part.ingredients?.id);

      return {
        id: ingredient?.id || null,
        native: true,
        name: ingredient?.name || 'Unlinked recipe ingredient',
        quantity: part.quantity == null ? null : Number(part.quantity),
        unit: part.unit || ingredient?.unit || null,
        components: [{
          name: component.name,
          quantity: Number(part.quantity),
        }],
      };
    })
  );
}

// Only complete, unambiguous removal instructions are handled here.
// Everything else retains its full context for the interpreter.
export function simplePlan(base, instructions, catalog = base) {
  const operations = [];
  const unresolved = [];
  const texts = [...(instructions.requests || [])];

  for (const modifier of instructions.modifiers) {
    texts.push(modifier.name || '', ...(modifier.requests || []));
  }

  for (const value of texts.filter((value) => text(value))) {
    const match = text(value).match(
      /^(?:(?:.+ )?no\s*:\s*|no |without |hold )([a-z -]+)$/
    );

    if (!match) return null;

    const food = noun(match[1]);

    if (/\b(and|or|with|extra)\b/.test(food)) return null;

    const matches = base.filter((part) => noun(part.name) === food);
    const ids = [...new Set(matches.map((part) => part.id))];

    if (
      (
        !ids.length &&
        (
          !catalog.some((part) => noun(part.name) === food) ||
          base.some((part) => noun(part.name).includes(food))
        )
      ) ||
      ids.length > 1 ||
      base.some((part) =>
        (part.components || []).some((component) =>
          noun(component.name).includes(food)
        )
      )
    ) {
      return null;
    }

    if (ids.length) {
      operations.push({
        action: 'remove',
        ingredient_id: ids[0],
      });
    }
  }

  return {
    operations: operations.filter((op, index) =>
      operations.findIndex((other) =>
        other.ingredient_id === op.ingredient_id
      ) === index
    ),
    unresolved,
    explanation: texts.length
      ? 'Explicit removals applied; absent ingredients unchanged.'
      : 'Standard recipe',
  };
}

// Stage one: change the recipe without converting to inventory units.
// Equal-weight/volume substitutions remain expressions until stage two.
export function adjustRecipe(base, plan, catalog) {
  if (
    !Array.isArray(plan?.operations) ||
    !Array.isArray(plan?.unresolved)
  ) {
    throw new Error(
      'Review the modifier interpretation and save final portions.'
    );
  }

  if (plan.unresolved.length) {
    throw new Error(plan.unresolved.join('; '));
  }

  const known = new Map(catalog.map((row) => [row.id, row]));
  const original = plan.replace_all === true ? [] : base;
  let parts = original.map((part) => ({ ...part }));
  const touched = new Map();

  // Additions go last, so a changed amount never wipes one out.
  const ordered = [
    ...plan.operations.filter((op) => op.action !== 'add'),
    ...plan.operations.filter((op) => op.action === 'add'),
  ];

  for (const op of ordered) {
    const id = op.ingredient_id;
    const old = original.filter((part) => part.id === id);

    // An addition on top of what is already there. A negative amount takes
    // part of an ingredient off, such as one component's share of butter.
    if (op.action === 'add') {
      if (
        !known.has(id) ||
        !Number.isFinite(op.quantity) ||
        !text(op.unit)
      ) {
        throw new Error(
          'Enter a quantity and unit for this portion.'
        );
      }

      parts.push({
        id,
        name: known.get(id).name,
        quantity: op.quantity,
        unit: op.unit,
        conversion_estimated: op.basis === 'estimated',
        delta: op.quantity < 0,
      });
      continue;
    }

    if (op.action === 'remove' && !old.length) continue;
    if (op.action === 'remove' && touched.get(id) === 'remove') continue;

    if (!known.has(id) || touched.has(id)) {
      throw new Error(
        'Confirm the final portions for conflicting ingredient instructions.'
      );
    }

    touched.set(id, op.action);

    if (op.action === 'remove') {
      parts = parts.filter((part) => part.id !== id);
      continue;
    }

    if (!['set', 'replace'].includes(op.action)) {
      throw new Error('Review the requested ingredient change.');
    }

    const targetId = op.action === 'replace' ? op.target_id : id;
    const target = known.get(targetId);

    if (
      !target ||
      (
        op.action === 'replace' &&
        (!old.length || touched.has(targetId))
      )
    ) {
      throw new Error('Confirm the replacement ingredient and portion.');
    }

    parts = parts.filter((part) => part.id !== id);

    if (op.action === 'replace') {
      touched.set(targetId, 'replace');
    }

    if (
      op.action === 'replace' &&
      ['equal_weight', 'equal_volume'].includes(op.basis)
    ) {
      parts.push(...old.map((part) => ({
        ...part,
        id: targetId,
        name: target.name,
        source_id: id,
        physical_unit: op.basis === 'equal_weight' ? 'oz' : 'fl oz',
        conversion_estimated: true,
      })));
    } else {
      if (
        !Number.isFinite(op.quantity) ||
        op.quantity < 0 ||
        !text(op.unit)
      ) {
        throw new Error(
          'Enter a nonnegative quantity and unit for this portion.'
        );
      }

      parts.push({
        id: targetId,
        name: target.name,
        quantity: op.quantity,
        unit: op.unit,
        conversion_estimated: op.basis === 'estimated',
      });
    }
  }

  return parts.filter((part) => part.quantity !== 0);
}

// Stage two: each remaining ingredient is converted with its own factors.
export function inventoryPortions(parts, catalog) {
  const known = new Map(catalog.map((row) => [row.id, row]));
  const totals = new Map();

  for (const part of parts) {
    const ingredient = known.get(part.id);

    if (
      !ingredient ||
      !Number.isFinite(part.quantity) ||
      (part.quantity < 0 && !part.delta) ||
      !part.unit
    ) {
      throw new Error(
        'Link the ingredient and confirm its recipe quantity and unit.'
      );
    }

    const sign = part.quantity < 0 ? -1 : 1;
    let quantity = Math.abs(part.quantity);
    let unit = part.unit;
    let estimated = part.conversion_estimated === true;
    const ids = new Set(part.conversion_ids || []);

    const convert = (value, from, to, product) => {
      const result = requireIngredientConversion(
        value,
        from,
        to,
        product
      );

      estimated ||= result.estimated === true;

      if (result.conversionId) {
        ids.add(result.conversionId);
      }

      return result.quantity;
    };

    if (part.source_id) {
      quantity = convert(
        quantity,
        unit,
        part.physical_unit,
        known.get(part.source_id)
      );
      unit = part.physical_unit;
    }

    quantity = sign * convert(quantity, unit, ingredient.unit, ingredient);

    const previous = totals.get(part.id);
    quantity += previous?.quantity || 0;

    // A take-off amount can come before the line it comes from; the total
    // is checked once every line is in.
    if (!Number.isFinite(quantity)) {
      throw new Error('Confirm the calculated portion.');
    }

    totals.set(part.id, {
      id: part.id,
      name: ingredient.name,
      unit: ingredient.unit,
      quantity,
      conversion_estimated:
        estimated || previous?.conversion_estimated === true,
      conversion_ids: [
        ...new Set([
          ...(previous?.conversion_ids || []),
          ...ids,
        ]),
      ],
    });
  }

  // Taking off more than the recipe has leaves none, never a negative amount.
  return [...totals.values()].map((part) =>
    part.quantity < 0 ? { ...part, quantity: 0 } : part
  );
}


// Requests learned one at a time, stacked into one change list for a dish.
// Each piece lists changes against the recipe: remove, replace, or add (an
// amount on top; negative takes some off).
export function combinePieces(pieces) {
  const operations = [];
  const unresolved = [];
  const untracked = [];
  const offBy = new Map();
  const onBy = new Map();
  const replaced = new Set();

  for (const piece of pieces) {
    unresolved.push(...(piece.unresolved || []));
    untracked.push(...(piece.untracked || []));

    for (const op of piece.operations || []) {
      if (op.action === 'replace') {
        if (replaced.has(op.ingredient_id)) {
          throw new Error(
            'Two requests swap out the same ingredient. Check this dish.'
          );
        }

        replaced.add(op.ingredient_id);
        offBy.set(op.ingredient_id, piece.id);
        onBy.set(op.target_id, piece.id);
      } else if (op.action === 'remove') {
        offBy.set(op.ingredient_id, piece.id);
      } else if (op.action === 'add') {
        if (op.quantity > 0) onBy.set(op.ingredient_id, piece.id);
      } else {
        throw new Error('Review the requested ingredient change.');
      }

      operations.push({ ...op, piece: piece.id });
    }
  }

  // One request takes an ingredient off while another puts it on.
  for (const [id, pieceId] of offBy) {
    if (onBy.has(id) && onBy.get(id) !== pieceId) {
      throw new Error(
        'One request takes an ingredient off and another adds it. Check this dish.'
      );
    }
  }

  return {
    // A swap already takes its ingredient off.
    operations: operations.filter((op) =>
      !(op.action === 'remove' && replaced.has(op.ingredient_id))
    ),
    unresolved,
    untracked: [...new Set(untracked)],
    explanation: pieces.map((piece) => piece.label).filter(Boolean).join('; ') ||
      'Standard recipe',
  };
}

// The recipe lines a learned change depends on. When any of them is edited,
// the change is read again.
export function touchedLines(base, operations) {
  const ids = new Set(
    (operations || [])
      .filter((op) =>
        op.action === 'remove' ||
        op.action === 'replace' ||
        (op.action === 'add' && op.quantity < 0)
      )
      .map((op) => op.ingredient_id)
  );

  return base
    .filter((part) => ids.has(part.id))
    .map(({ id, quantity, unit, components }) => ({
      id,
      quantity,
      unit,
      components: (components || []).map((component) => component.name),
    }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}