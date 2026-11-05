
import { withAdminAuth } from '../../../../lib/admin/withAdminAuth';
import { createClient } from '@supabase/supabase-js';
import {
  getRestaurantInvoiceMatchingControl,
} from '../../../../lib/invoiceMatchingControls';
import {
  repriceFromInvoices,
} from '../../../../lib/admin/invoiceLines';
import { recomputeMenuCosts } from '../../../../lib/recomputeMenuCosts';
import { rebuildCurrentInventory } from '../../../../lib/currentInventory';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const numericValue = (value) => {
  if (value === '' || value === null || value === undefined) {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

export function createSaveInvoiceItemsHandler({
  db = supabase,
  getMatchingControl = getRestaurantInvoiceMatchingControl,
  reprice = repriceFromInvoices,
  recompute = recomputeMenuCosts,
  rebuild = rebuildCurrentInventory,
} = {}) {
  return async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).end();
  }

  const { invoice_id, restaurant_id, items } = req.body || {};

  if (!invoice_id || !restaurant_id || !Array.isArray(items)) {
    return res.status(400).json({
      error: 'invoice_id, restaurant_id, and items[] required',
    });
  }

  try {
    // Matching must be enabled before any invoice-line
    // or ingredient-related changes are permitted.
    const control = await getMatchingControl(
      db,
      restaurant_id
    );

    if (!control.matching_enabled) {
      return res.status(403).json({
        error:
          'Invoice ingredient matching is not enabled for this restaurant.',
      });
    }

    // Verify invoice ownership and obtain its actual date.
    const { data: invoice, error: invoiceError } = await db
      .from('invoices')
      .select('id, date')
      .eq('id', invoice_id)
      .eq('restaurant_id', restaurant_id)
      .maybeSingle();

    if (invoiceError) throw invoiceError;

    if (!invoice) {
      return res.status(404).json({
        error: 'Invoice not found for this restaurant.',
      });
    }

    const submittedIds = items.map(item => item?.id);

    if (
      submittedIds.some(id => !id) ||
      new Set(submittedIds).size !== submittedIds.length
    ) {
      return res.status(400).json({
        error: 'Invoice item IDs must be present and unique.',
      });
    }

    if (submittedIds.length === 0) {
      return res.status(200).json({
        success: true,
        changed: 0,
        errors: [],
      });
    }

    // Load existing values so we can identify actual changes
    // and reprice both sides of any ingredient relink.
    const { data: existingLines, error: linesError } = await db
      .from('invoice_items')
      .select(
        'id, quantity, unit, unit_cost, amount, ingredient_id'
      )
      .eq('invoice_id', invoice_id)
      .in('id', submittedIds);

    if (linesError) throw linesError;

    if ((existingLines || []).length !== submittedIds.length) {
      return res.status(400).json({
        error:
          'One or more invoice lines do not belong to this invoice.',
      });
    }

    const existingMap = new Map(
      existingLines.map(line => [line.id, line])
    );

    // Validate all requested ingredient IDs before writing.
    const ingredientIds = [
      ...new Set(
        items
          .map(item => item.ingredient_id)
          .filter(Boolean)
      ),
    ];

    if (ingredientIds.length) {
      const { data: ingredients, error: ingredientError } =
        await db
          .from('ingredients')
          .select('id')
          .eq('restaurant_id', restaurant_id)
          .in('id', ingredientIds);

      if (ingredientError) throw ingredientError;

      const ownedIds = new Set(
        (ingredients || []).map(ingredient => ingredient.id)
      );

      if (
        ingredientIds.some(id => !ownedIds.has(id))
      ) {
        return res.status(400).json({
          error:
            'One or more ingredients do not belong to this restaurant.',
        });
      }
    }

    // Prepare all edits before changing the database.
    const changes = [];

    for (const item of items) {
      const old = existingMap.get(item.id);

      const next = {
        quantity: numericValue(item.quantity),
        unit: String(item.unit || '').trim() || null,
        unit_cost: numericValue(item.unit_cost),
        amount: numericValue(item.amount),
        ingredient_id: item.ingredient_id || null,
      };

      const changed =
        next.quantity !== numericValue(old.quantity) ||
        next.unit !== (old.unit || null) ||
        next.unit_cost !== numericValue(old.unit_cost) ||
        next.amount !== numericValue(old.amount) ||
        next.ingredient_id !== (old.ingredient_id || null);

      if (changed) {
        changes.push({
          id: item.id,
          oldIngredientId: old.ingredient_id || null,
          newIngredientId: next.ingredient_id,
          next,
        });
      }
    }

    // No database writes or recalculations are necessary
    // when the submitted values are unchanged.
    if (changes.length === 0) {
      return res.status(200).json({
        success: true,
        changed: 0,
        errors: [],
      });
    }

    const touchedIngredients = new Set();
    const errors = [];
    let changedCount = 0;

    // Change only explicitly submitted invoice lines.
    // Never propagate these changes to historical lines.
    for (const change of changes) {
      let updateQuery = db
        .from('invoice_items')
        .update(change.next)
        .eq('id', change.id)
        .eq('invoice_id', invoice_id);

      if (change.oldIngredientId === null) {
        updateQuery = updateQuery.is('ingredient_id', null);
      } else {
        updateQuery = updateQuery.eq(
          'ingredient_id',
          change.oldIngredientId
        );
      }

      const { data: updatedRows, error } =
        await updateQuery.select('id');

      if (error) {
        errors.push(`Item ${change.id}: ${error.message}`);
        continue;
      }

      if (!updatedRows?.length) {
        errors.push(
          `Item ${change.id}: Invoice line changed during review. Refresh and retry.`
        );
        continue;
      }

      changedCount++;

      if (change.oldIngredientId) {
        touchedIngredients.add(change.oldIngredientId);
      }

      if (change.newIngredientId) {
        touchedIngredients.add(change.newIngredientId);
      }
    }

    // Never start ingredient repricing after a failed
    // invoice-line update.
    if (errors.length) {
      return res.status(500).json({
        success: false,
        changed: changedCount,
        errors,
      });
    }

    const touchedIds = [...touchedIngredients];

    // Reprice from the newest remaining linked invoice,
    // rather than directly using the invoice being edited.
    //
    // This also handles:
    // - correcting historical prices
    // - moving a line between ingredients
    // - unlinking a line
    // - correcting quantity or unit cost
    for (const ingredientId of touchedIds) {
      try {
        await repriceFromInvoices(
          supabase,
          restaurant_id,
          ingredientId
        );
      } catch (error) {
        errors.push(
          `Ingredient ${ingredientId}: ${error.message}`
        );
      }
    }

    if (errors.length) {
      return res.status(500).json({
        success: false,
        changed: changedCount,
        errors,
      });
    }

    // Recalculate affected recipe costs only after
    // all ingredient pricing operations succeed.
    if (touchedIds.length) {
      try {
        await recomputeMenuCosts(
          supabase,
          restaurant_id,
          touchedIds,
          {
            effectiveDate:
              invoice.date ||
              new Date().toISOString().slice(0, 10),
            reason: 'admin_invoice_review',
          }
        );
      } catch (error) {
        errors.push(
          `Dish cost recalculation: ${error.message}`
        );
      }
    }

    if (errors.length) {
      return res.status(500).json({
        success: false,
        changed: changedCount,
        errors,
      });
    }

    // Invoice-line changes can affect inventory quantities
    // and ingredient allocations.
    try {
      await rebuildCurrentInventory(
        supabase,
        restaurant_id
      );
    } catch (error) {
      errors.push(
        `Inventory rebuild: ${error.message}`
      );
    }

    return res.status(errors.length ? 500 : 200).json({
      success: errors.length === 0,
      changed: changedCount,
      ingredients_repriced: touchedIds.length,
      errors,
    });
  } catch (error) {
    console.error('[invoice-review save-items]', error);

    return res.status(500).json({
      error: 'Could not save invoice review changes.',
    });
  }
  };
}

export default withAdminAuth(createSaveInvoiceItemsHandler());
