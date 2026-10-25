export const UNITS = [
  'each', 'slice', 'bunch', 'package',
  'oz', 'lb', 'g', 'kg',
  'fl oz', 'cup', 'pt', 'qt', 'gal', 'ml', 'l', 'tsp', 'tbsp',
];

const scales = {
  oz: ['mass', 28.349523125],
  lb: ['mass', 453.59237],
  g: ['mass', 1],
  kg: ['mass', 1000],
  'fl oz': ['volume', 29.5735295625],
  cup: ['volume', 236.5882365],
  pt: ['volume', 473.176473],
  qt: ['volume', 946.352946],
  gal: ['volume', 3785.411784],
  ml: ['volume', 1],
  l: ['volume', 1000],
  tsp: ['volume', 4.92892159375],
  tbsp: ['volume', 14.78676478125],
};

export function positive(value, label) {
  const number = Number(value);

  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`${label} needs a quantity greater than zero.`);
  }

  return number;
}

export function yieldFactor(from, to) {
  if (!UNITS.includes(from) || !UNITS.includes(to)) {
    throw new Error('Choose a supported unit.');
  }

  if (from === to) return 1;

  if (
    scales[from]?.[0] !== scales[to]?.[0] ||
    !scales[from] ||
    !scales[to]
  ) {
    throw new Error(
      `Use a batch yield compatible with ${from}; ${from} and ${to} need a measured relationship.`
    );
  }

  return scales[from][1] / scales[to][1];
}

export function compile(nodes, nodeId, stack = []) {
  const node = nodes.find(n => n.id === nodeId);

  if (!node?.published) {
    throw new Error(
      `Confirm the batch recipe for ${node?.name || 'this component'} first.`
    );
  }

  if (stack.includes(nodeId)) {
    throw new Error(
      'A batch cannot contain itself, including through another batch.'
    );
  }

  if (stack.length > 12) {
    throw new Error('Too many nested batch recipes.');
  }

  const definition = node.published;

  if (!definition.lines?.length) {
    throw new Error(`${node.name} needs at least one ingredient.`);
  }

  if (node.kind === 'prep') {
    positive(definition.yield_quantity, `${node.name} finished yield`);
    yieldFactor(definition.yield_unit, definition.yield_unit);
  }

  return definition.lines.flatMap(line => {
    const quantity = positive(
      line.quantity,
      `${node.name}: ${line.name || 'batch portion'}`
    );

    if (!UNITS.includes(line.unit)) {
      throw new Error(`Choose a unit for ${line.name || 'this portion'}.`);
    }

    if (line.prep_id) {
      const prep = nodes.find(
        n => n.id === line.prep_id && n.kind === 'prep'
      );

      if (!prep?.published) {
        throw new Error(
          `Confirm ${prep?.name || 'the batch'} before using it.`
        );
      }

      const factor =
        quantity *
        yieldFactor(line.unit, prep.published.yield_unit) /
        positive(
          prep.published.yield_quantity,
          `${prep.name} finished yield`
        );

      return compile(nodes, prep.id, [...stack, nodeId]).map(item => ({
        ...item,
        component: line.component?.trim() || prep.name,
        quantity: positive(item.quantity * factor, 'Scaled ingredient'),
      }));
    }

    if (!line.name?.trim()) {
      throw new Error('Every ingredient needs a name.');
    }

    return [{
      ingredient_id: line.ingredient_id || null,
      name: line.name.trim(),
      component: line.component?.trim() || 'Recipe',
      quantity,
      unit: line.unit,
    }];
  });
}