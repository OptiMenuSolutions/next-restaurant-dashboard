
// pages/api/invoices/link-item.js
// Links one invoice line to an existing, restaurant-owned ingredient.
// Ingredients are created through recipes, never through invoices.
// Historical invoice lines are not automatically relinked.

import { createClient } from '@supabase/supabase-js';
import {
  safeInvoiceStandardPrice,
} from '../../../lib/safeInvoicePricing';
import { rebuildCurrentInventory } from '../../../lib/currentInventory';
import { recomputeMenuCosts } from '../../../lib/recomputeMenuCosts';
import {
  getRestaurantInvoiceMatchingControl,
} from '../../../lib/invoiceMatchingControls';
import {
  selectInvoiceRepricingSource,
  getInvoiceEffectiveDate,
  isDeliveredInvoice,
  isManuallyApprovedPrice,
} from '../../../lib/invoiceRepricing';

import {
  hasVerifiedInvoicePrice,
} from '../../../lib/invoicePriceProvenance';

import {
  fetchAll,
} from '../../../lib/admin/fetchAll';

import {
  repriceFromInvoices as repriceFromAuthenticatedInvoices,
} from '../../../lib/admin/invoiceLines';

import {
  isInvoiceSupportedRepricingEnabled,
} from '../../../lib/invoiceSupportedRepricingFlag.js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export function createLinkInvoiceItemHandler({
  db = supabase,
  verifyAccess,
  getMatchingControl = getRestaurantInvoiceMatchingControl,
  recompute = recomputeMenuCosts,
  rebuild = rebuildCurrentInventory,
  repriceAuthenticated = repriceFromAuthenticatedInvoices,
} = {}) {
  return async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).end();
  }

  const {
    restaurant_id,
    invoice_item_id,
    ingredient_id,
    new_ingredient_name,
  } = req.body || {};

  if (!restaurant_id || !invoice_item_id) {
    return res.status(400).json({
      error: 'restaurant_id and invoice_item_id are required',
    });
  }

  // Authenticate before reading or modifying restaurant data.
  const { error: authError, status: authStatus } = await (
    verifyAccess
      ? verifyAccess(req, restaurant_id)
      : import('../../../lib/withRestaurantAuth')
          .then(m => m.verifyRestaurantAccess(req, restaurant_id))
  );

  if (authError) {
    return res.status(authStatus).json({ error: authError });
  }

  // Fail closed if matching controls cannot be loaded.
  let matchingControl;

  try {
    matchingControl = await getMatchingControl(
      db,
      restaurant_id
    );
  } catch (error) {
    console.error('[link-item] Matching control:', error);

    return res.status(503).json({
      error: 'Invoice matching controls are unavailable. Please retry.',
    });
  }

  if (!matchingControl.matching_enabled) {
    return res.status(403).json({
      error: 'Invoice ingredient matching is not enabled for this restaurant.',
    });
  }

  // Invoice matching cannot create new ingredients.
  if (new_ingredient_name || !ingredient_id) {
    return res.status(400).json({
      error: 'Select an existing recipe ingredient. Invoices cannot create ingredients.',
    });
  }

  // Verify the invoice line belongs to this restaurant.
  const { data: line, error: lineErr } = await db
    .from('invoice_items')
    .select(
      'id, unit, unit_cost, ingredient_id, ' +
      'price_verification_status, ' +
      'price_verification_source, ' +
      'price_verified_at, ' +
      'price_verification_evidence, ' +
      'invoices!inner(restaurant_id, date, delivery_date)'
    )
    .eq('id', invoice_item_id)
    .single();

  if (lineErr || !line || line.invoices?.restaurant_id !== restaurant_id) {
    return res.status(404).json({
      error: 'Invoice line not found',
    });
  }

  // Verify the selected ingredient belongs to this restaurant.
  const { data: ingredient, error: ingredientErr } = await db
    .from('ingredients')
    .select('id, name, unit, last_ordered_at, price_status, price_approved_at')
    .eq('id', ingredient_id)
    .eq('restaurant_id', restaurant_id)
    .single();

  if (ingredientErr || !ingredient) {
    return res.status(404).json({
      error: 'Ingredient not found for this restaurant',
    });
  }

  const oldIngredientId = line.ingredient_id || null;

  if (oldIngredientId === ingredient.id) {
    return res.status(200).json({
      success: true,
      moved: 0,
      ingredient: {
        id: ingredient.id,
        name: ingredient.name,
        unit: ingredient.unit,
      },
    });
  }

  const purchaseDate = getInvoiceEffectiveDate(line.invoices);
  const pricingAsOfDate = new Date().toISOString().slice(0, 10);

  const invoiceDate =
    line.invoices.date || new Date().toISOString().split('T')[0];

  // Change only the explicitly selected invoice line.
  // Never propagate a correction to historical lines automatically.
  let linkQuery = db
    .from('invoice_items')
    .update({ ingredient_id: ingredient.id })
    .eq('id', invoice_item_id);

  if (oldIngredientId === null) {
    linkQuery = linkQuery.is('ingredient_id', null);
  } else {
    linkQuery = linkQuery.eq('ingredient_id', oldIngredientId);
  }

  const { data: movedRows, error: linkErr } =
    await linkQuery.select('id');

  if (linkErr) {
    return res.status(500).json({
      error: 'Could not link invoice line: ' + linkErr.message,
    });
  }

  if (!movedRows?.length) {
    return res.status(409).json({
      error: 'Invoice line changed during linking. Refresh and retry.',
    });
  }

  // Authenticated invoice repricing uses the shared
  // server-side evidence validation pathway.
  //
  // Preserve existing legacy behavior until the
  // invoice-supported repricing feature is enabled.
if (isInvoiceSupportedRepricingEnabled(restaurant_id)) {
    try {
      await repriceAuthenticated(
        db,
        restaurant_id,
        ingredient.id
      );

      if (oldIngredientId) {
        await repriceAuthenticated(
          db,
          restaurant_id,
          oldIngredientId
        );
      }
    } catch (error) {
      return res.status(500).json({
        error:
          'Invoice line linked, but authenticated repricing failed: ' +
          error.message,
      });
    }
  } else {
    // Legacy repricing remains unchanged while the
    // new feature is disabled.

    // If the line was previously linked, recalculate both ingredients
    // from their remaining invoice histories.
    if (oldIngredientId) {
    try {
      await repriceFromInvoices(db, restaurant_id, ingredient.id);
      await repriceFromInvoices(db, restaurant_id, oldIngredientId);
    } catch (error) {
      return res.status(500).json({
        error: 'Invoice line linked, but ingredient repricing failed: ' +
          error.message,
      });
    }
  } else {
    // First-time linking: update price only if this invoice is not older
    // than the ingredient's current recorded purchase.
    const unitCost = Number(line.unit_cost);
    const isNewest =
      isDeliveredInvoice(line.invoices, pricingAsOfDate) &&
      !isManuallyApprovedPrice(ingredient) &&
      (
        !ingredient.last_ordered_at ||
        String(purchaseDate) >= String(ingredient.last_ordered_at)
      );

    const verifiedPrice = safeInvoiceStandardPrice(
      unitCost,
      line.unit
    );

    if (
      verifiedPrice &&
      hasVerifiedInvoicePrice(line) &&
      isNewest
    ) {
      const { error: priceErr } = await db
        .from('ingredients')
        .update({
          last_price: verifiedPrice.price,
          unit: verifiedPrice.unit,
          standard_unit: verifiedPrice.unit,
          last_ordered_at: purchaseDate,
          is_estimated: false,
        })
        .eq('id', ingredient.id)
        .eq('restaurant_id', restaurant_id);

      if (priceErr) {
        return res.status(500).json({
          error: 'Invoice line linked, but ingredient pricing failed: ' +
            priceErr.message,
        });
      }
    }
    }
  }

  // Recalculate affected recipes after successful linking and pricing.
  try {
    await recompute(
      db,
      restaurant_id,
      [ingredient.id, oldIngredientId].filter(Boolean),
      {
        effectiveDate: invoiceDate,
        reason: 'invoice_link',
      }
    );
  } catch (error) {
    console.error(
      '[link-item] Dish cost recomputation failed:',
      error.message
    );
  }

  // Refresh inventory to reflect the corrected ingredient link.
  try {
    await rebuild(db, restaurant_id);
  } catch (error) {
    console.error(
      '[link-item] Inventory rebuild failed:',
      error.message
    );
  }

  return res.status(200).json({
    success: true,
    moved: movedRows.length,
    ingredient: {
      id: ingredient.id,
      name: ingredient.name,
      unit: ingredient.unit,
    },
  });
  };
}

// Reprice an ingredient using its newest linked invoice line.
async function repriceFromInvoices(db, restaurantId, ingredientId) {
  const { data: ingredient, error: ingredientErr } = await db
    .from('ingredients')
    .select('id, name, last_ordered_at, price_status, price_approved_at')
    .eq('id', ingredientId)
    .eq('restaurant_id', restaurantId)
    .single();

  if (ingredientErr || !ingredient) {
    throw new Error('Could not load ingredient for repricing.');
  }

  if (isManuallyApprovedPrice(ingredient)) return;

  const lines = await fetchAll(
    () => db
      .from('invoice_items')
      .select(
        'id, unit, unit_cost, ' +
        'price_verification_status, ' +
        'price_verification_source, ' +
        'price_verified_at, ' +
        'price_verification_evidence, ' +
        'invoices!inner(restaurant_id, date, delivery_date, created_at)'
      )
      .eq('ingredient_id', ingredientId)
      .eq('invoices.restaurant_id', restaurantId)
      .order('id'),
    { page: 500 }
  );

  const decision = selectInvoiceRepricingSource(
    lines,
    { requireVerified: true }
  );

  let updates;

  if (decision.status === 'priced') {
    updates = decision.updates;
  } else if (decision.status === 'unverified') {
    // Existing valid pricing must survive unsupported
    // invoice units or package quantities.
    return;
  } else if (
    decision.status === 'not_delivered' &&
    ingredient.price_status === 'invoice'
  ) {
    updates = {
      price_status: 'needs_review',
      is_estimated: true,
      price_approved_at: null,
    };
  } else if (
    ingredient.last_ordered_at &&
    ingredient.price_status === 'invoice'
  ) {
    updates = {
      last_price: null,
      last_ordered_at: null,
      is_estimated: true,
      price_approved_at: null,
      price_status: 'needs_review',
    };
  } else {
    return;
  }

  const { error: updateErr } = await db
    .from('ingredients')
    .update(updates)
    .eq('id', ingredientId)
    .eq('restaurant_id', restaurantId);

  if (updateErr) {
    throw new Error(updateErr.message);
  }
}

export default createLinkInvoiceItemHandler();
