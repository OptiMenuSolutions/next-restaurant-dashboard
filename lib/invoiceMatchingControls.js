
export const INVOICE_MATCHING_STATUS = Object.freeze({
  LOCKED: 'locked',
  LEGACY_ENABLED: 'legacy_enabled',
  AUTO_ENABLED: 'auto_enabled',
  ADMIN_ENABLED: 'admin_enabled',
});

const VALID_STATUSES = new Set(
  Object.values(INVOICE_MATCHING_STATUS)
);

export function isInvoiceMatchingEnabled(status) {
  return (
    status === INVOICE_MATCHING_STATUS.LEGACY_ENABLED ||
    status === INVOICE_MATCHING_STATUS.AUTO_ENABLED ||
    status === INVOICE_MATCHING_STATUS.ADMIN_ENABLED
  );
}

export function isValidInvoiceMatchingStatus(status) {
  return VALID_STATUSES.has(status);
}

export async function getRestaurantInvoiceMatchingControl(
  db,
  restaurantId
) {
  if (!restaurantId) {
    throw new Error('Restaurant ID is required');
  }

  const { data, error } = await db
    .from('restaurant_invoice_matching_controls')
    .select(
      'restaurant_id, status, activated_at, ' +
      'activated_by, activation_reason, ' +
      'created_at, updated_at'
    )
    .eq('restaurant_id', restaurantId)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Could not load invoice matching control: ${error.message}`
    );
  }

  if (!data) {
    throw new Error(
      `Missing invoice matching control for restaurant ${restaurantId}`
    );
  }

  if (!isValidInvoiceMatchingStatus(data.status)) {
    throw new Error(
      `Invalid invoice matching status: ${data.status}`
    );
  }

  return {
    ...data,
    matching_enabled: isInvoiceMatchingEnabled(data.status),
    is_locked: data.status === INVOICE_MATCHING_STATUS.LOCKED,
  };
}


/**
 * Check whether all current, recipe-required menu dishes
 * have published recipes with valid batch dependencies.
 *
 * This never counts drafts, estimates, or uploaded files
 * that have not been published.
 */
export async function getInvoiceMatchingRecipeCompletion(
  db,
  restaurantId
) {
  const [workspaceResult, catalogResult] = await Promise.all([
    db.from('recipe_workspaces')
      .select('state')
      .eq('restaurant_id', restaurantId)
      .maybeSingle(),

    db.rpc('recipe_setup_catalog', {
      p_restaurant: restaurantId,
    }),
  ]);

  if (workspaceResult.error) {
    throw workspaceResult.error;
  }

  if (catalogResult.error) {
    throw catalogResult.error;
  }

  const nodes = workspaceResult.data?.state?.nodes || [];
  const catalog = catalogResult.data || [];

  const byId = new Map(nodes.map(node => [node.id, node]));
  const activeDishIds = new Set(catalog.map(dish => dish.id));

  function validPublishedRecipe(node, visiting = new Set()) {
    if (
      !node?.published ||
      !Array.isArray(node.published.lines) ||
      node.published.lines.length === 0
    ) {
      return false;
    }

    if (visiting.has(node.id)) return false;

    const nextVisiting = new Set(visiting);
    nextVisiting.add(node.id);

    for (const line of node.published.lines) {
      if (!Number.isFinite(Number(line.quantity)) ||
          Number(line.quantity) <= 0) {
        return false;
      }

      if (line.prep_id) {
        const prep = byId.get(line.prep_id);

        if (
          prep?.kind !== 'prep' ||
          !validPublishedRecipe(prep, nextVisiting)
        ) {
          return false;
        }
      } else if (
        !line.ingredient_id &&
        !String(line.name || '').trim()
      ) {
        return false;
      }
    }

    return true;
  }

  const dishes = catalog.filter(dish => activeDishIds.has(dish.id));

  let required = 0;
  let completed = 0;

  for (const dish of dishes) {
    const node = byId.get(dish.id);

    if (node?.no_recipe_required === true) continue;

    required++;

    if (validPublishedRecipe(node)) {
      completed++;
    }
  }

  return {
    required,
    completed,
    remaining: required - completed,
    complete: required > 0 && completed === required,
  };
}

/**
 * Activate only from the locked state.
 *
 * The conditional database update prevents a repeated
 * request from overwriting an existing activation.
 */
export async function activateRestaurantInvoiceMatching(
  db,
  restaurantId,
  {
    status,
    actorId = null,
    reason,
  }
) {
  if (![
    INVOICE_MATCHING_STATUS.AUTO_ENABLED,
    INVOICE_MATCHING_STATUS.ADMIN_ENABLED,
  ].includes(status)) {
    throw new Error('Invalid activation status.');
  }

  const current = await getRestaurantInvoiceMatchingControl(
    db,
    restaurantId
  );

  if (current.matching_enabled) {
    return {
      ...current,
      activated_now: false,
    };
  }

  const { data, error } = await db
    .from('restaurant_invoice_matching_controls')
    .update({
      status,
      activated_at: new Date().toISOString(),
      activated_by: actorId,
      activation_reason: reason,
      updated_at: new Date().toISOString(),
    })
    .eq('restaurant_id', restaurantId)
    .eq('status', INVOICE_MATCHING_STATUS.LOCKED)
    .select()
    .maybeSingle();

  if (error) throw error;

  if (!data) {
    return {
      ...(await getRestaurantInvoiceMatchingControl(
        db,
        restaurantId
      )),
      activated_now: false,
    };
  }

  return {
    ...data,
    matching_enabled: true,
    is_locked: false,
    activated_now: true,
  };
}

export async function autoActivateInvoiceMatching(
  db,
  restaurantId
) {
  const current = await getRestaurantInvoiceMatchingControl(
    db,
    restaurantId
  );

  if (current.matching_enabled) {
    return {
      ...current,
      activated_now: false,
    };
  }

  const completion = await getInvoiceMatchingRecipeCompletion(
    db,
    restaurantId
  );

  if (!completion.complete) {
    return {
      ...current,
      completion,
      activated_now: false,
    };
  }

  return activateRestaurantInvoiceMatching(db, restaurantId, {
    status: INVOICE_MATCHING_STATUS.AUTO_ENABLED,
    reason: 'All required menu recipes published',
  });
}
