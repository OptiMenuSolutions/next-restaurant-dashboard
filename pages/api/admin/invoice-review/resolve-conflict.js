
import { adminDb as db, requireAdmin } from '../../../../lib/admin/requireAdmin';
import { normalizeSupplierProduct } from '../../../../lib/invoiceMatchConflicts';
import { waitUntil } from '@vercel/functions';
import { writeAuditLog } from '../../../../lib/admin/withAdminAuth';
import { processInvoiceCalculations } from '../../../../lib/admin/processInvoiceCalculations';
import {
  getProgressiveInvoiceMatchingPolicy,
} from '../../../../lib/progressiveInvoiceMatching';
import {
  createConflictConfirmation,
  verifyConflictConfirmation,
} from '../../../../lib/admin/invoiceConflictConfirmation';


const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isUuid = value =>
  typeof value === 'string' && UUID_PATTERN.test(value);

const normalizeId = value => value == null || value === '' ? null : value;

export default async function handler(req, res) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const {
    action,
    restaurant_id,
    supplier,
    product_description,
    changes,
    approve_future = false,
    future_ingredient_id = null,
    expected_mapping_updated_at = null,
  } = req.body || {};

  if (!['preview', 'save'].includes(action)) {
    return res.status(400).json({
      error: 'Invalid conflict resolution action.',
    });
  }

  const confirmationRequest = {
    restaurant_id,
    supplier,
    product_description,
    changes,
    approve_future,
    future_ingredient_id,
    expected_mapping_updated_at,
  };

  if (action === 'save') {
    if (process.env.INVOICE_CONFLICT_SAVE_ENABLED !== 'true') {
      return res.status(403).json({
        error: 'Conflict saving is not enabled yet.',
      });
    }

    if (!verifyConflictConfirmation(
      req.body?.confirmation_token,
      admin.user.id,
      confirmationRequest
    )) {
      return res.status(409).json({
        error: 'Preview confirmation expired or changed. Preview again.',
      });
    }
  }

  if (!isUuid(restaurant_id)) {
    return res.status(400).json({
      error: 'A valid restaurant ID is required.',
    });
  }

  const productKey = normalizeSupplierProduct(product_description);
  const supplierKey = normalizeSupplierProduct(supplier);

  if (!productKey || !supplierKey) {
    return res.status(400).json({
      error: 'Supplier and product description are required.',
    });
  }

  if (!Array.isArray(changes) || changes.length > 500) {
    return res.status(400).json({
      error: 'Changes must be an array of at most 500 entries.',
    });
  }

  if (typeof approve_future !== 'boolean') {
    return res.status(400).json({
      error: 'approve_future must be a boolean.',
    });
  }

  if (
    approve_future &&
    !isUuid(future_ingredient_id)
  ) {
    return res.status(400).json({
      error: 'Select a valid ingredient for future matching.',
    });
  }

  const seen = new Set();

  for (const change of changes) {
    if (
      !change ||
      typeof change !== 'object' ||
      Array.isArray(change) ||
      !Object.prototype.hasOwnProperty.call(change, 'ingredient_id') ||
      !Object.prototype.hasOwnProperty.call(change, 'expected_ingredient_id') ||
      !isUuid(change.invoice_item_id) ||
      (
        normalizeId(change.ingredient_id) !== null &&
        !isUuid(change.ingredient_id)
      ) ||
      (
        normalizeId(change.expected_ingredient_id) !== null &&
        !isUuid(change.expected_ingredient_id)
      )
    ) {
      return res.status(400).json({
        error: 'A correction contains invalid or missing fields.',
      });
    }

    if (seen.has(change.invoice_item_id)) {
      return res.status(400).json({
        error: 'An invoice line was included more than once.',
      });
    }

    seen.add(change.invoice_item_id);
  }

  try {
    const { data: restaurant, error: restaurantError } = await db
      .from('restaurants')
      .select('id, name')
      .eq('id', restaurant_id)
      .maybeSingle();

    if (restaurantError) throw restaurantError;

    if (!restaurant) {
      return res.status(404).json({
        error: 'Restaurant not found.',
      });
    }

    // Allow administrators to preview existing conflicts, but prevent
    // saving corrections or future mappings while matching is locked.
    if (action === 'save') {
      const control = await getProgressiveInvoiceMatchingPolicy(
        db,
        restaurant_id
      );

      if (!control.matching_enabled) {
        return res.status(403).json({
          error: 'Invoice ingredient matching is not enabled for this restaurant.',
        });
      }
    }

    const requestedIngredientIds = [
      ...new Set([
        ...changes.map(change => normalizeId(change.ingredient_id)),
        ...(approve_future ? [future_ingredient_id] : []),
      ].filter(Boolean)),
    ];

    const ingredientNames = new Map();

    if (requestedIngredientIds.length) {
      const { data: ingredients, error: ingredientError } = await db
        .from('ingredients')
        .select('id, name')
        .eq('restaurant_id', restaurant_id)
        .in('id', requestedIngredientIds);

      if (ingredientError) throw ingredientError;

      for (const ingredient of ingredients || []) {
        ingredientNames.set(ingredient.id, ingredient.name);
      }

      if (ingredientNames.size !== requestedIngredientIds.length) {
        return res.status(400).json({
          error: 'A selected ingredient does not belong to this restaurant.',
        });
      }
    }

    const itemIds = changes.map(change => change.invoice_item_id);
    const itemsById = new Map();

    if (itemIds.length) {
      const { data: items, error: itemsError } = await db
        .from('invoice_items')
        .select(`
          id,
          invoice_id,
          item_name,
          ingredient_name_normalized,
          ingredient_id,
          invoices!inner (
            id,
            restaurant_id,
            supplier,
            number,
            date,
            is_sample
          )
        `)
        .in('id', itemIds);

      if (itemsError) throw itemsError;

      for (const item of items || []) {
        itemsById.set(item.id, item);
      }
    }

    const previewChanges = [];

    for (const change of changes) {
      const item = itemsById.get(change.invoice_item_id);

      if (!item) {
        return res.status(409).json({
          error: 'An invoice line no longer exists. Reload the conflicts.',
        });
      }

      const invoice = item.invoices;

      if (
        !invoice ||
        invoice.restaurant_id !== restaurant_id ||
        invoice.is_sample !== false
      ) {
        return res.status(400).json({
          error: 'An invoice line does not belong to this restaurant.',
        });
      }

      const actualProductKey = normalizeSupplierProduct(item.item_name);

      if (actualProductKey !== productKey) {
        return res.status(400).json({
          error: 'An invoice line does not belong to this conflict group.',
        });
      }

      const currentId = normalizeId(item.ingredient_id);
      const expectedId = normalizeId(change.expected_ingredient_id);
      const nextId = normalizeId(change.ingredient_id);

      if (currentId !== expectedId) {
        return res.status(409).json({
          error: 'An invoice link changed since review. Reload the conflicts.',
        });
      }

      previewChanges.push({
        invoice_item_id: item.id,
        invoice_id: item.invoice_id,
        invoice_number: invoice.number,
        invoice_date: invoice.date,
        product_description: item.item_name,
        previous_ingredient_id: currentId,
        new_ingredient_id: nextId,
        new_ingredient_name: nextId
          ? ingredientNames.get(nextId)
          : null,
        changed: currentId !== nextId,
        previously_unlinked: currentId === null,
      });
    }

    const { data: existingMapping, error: mappingError } = await db
      .from('invoice_ingredient_mappings')
      .select('ingredient_id, approved_at, updated_at')
      .eq('restaurant_id', restaurant_id)
      .eq('supplier_key', supplierKey)
      .eq('product_key', productKey)
      .maybeSingle();

    if (mappingError) throw mappingError;
    
    if (action === 'save') {
      if (!changes.length && !approve_future) {
        return res.status(400).json({
          error: 'There are no changes to save.',
        });
      }

      const { data: result, error: saveError } = await db.rpc(
        'resolve_invoice_ingredient_conflict',
        {
          p_restaurant_id: restaurant_id,
          p_supplier: supplier,
          p_product_description: product_description,
          p_changes: changes,
          p_future_ingredient_id: approve_future
            ? future_ingredient_id
            : null,
          p_approve_future: approve_future,
          p_admin_id: admin.user.id,
          p_expected_mapping_updated_at: expected_mapping_updated_at,
        }
      );

      if (saveError) {
        const message = saveError.message || 'Save failed.';
        const stale = /changed since preview|reload before saving/i.test(message);

        return res.status(stale ? 409 : 400).json({
          error: message,
        });
      }

      await writeAuditLog({
        admin_id: admin.user.id,
        admin_name: admin.name,
        action: 'Resolved invoice ingredient conflict',
        target_restaurant_id: restaurant_id,
        metadata: {
          product_description,
          changes,
          approve_future,
          future_ingredient_id: approve_future
            ? future_ingredient_id
            : null,
          result,
        },
      });

      if (result?.calculationsPending) {
        try {
          waitUntil(
            Promise.resolve()
              .then(() => processInvoiceCalculations(db, restaurant_id))
              .catch(error => {
                console.error('[conflict calculations]', error);
              })
          );
        } catch (error) {
          console.error('[conflict calculations schedule]', error);
        }
      }

      return res.status(200).json({
        ok: true,
        saved: true,
        ...result,
      });
    }

    const changed = previewChanges.filter(change => change.changed);
    const unchanged = previewChanges.length - changed.length;
    const newlyLinked = changed.filter(
      change => change.previously_unlinked && change.new_ingredient_id
    ).length;
    const unlinked = changed.filter(
      change => change.new_ingredient_id === null
    ).length;

    return res.status(200).json({
      ok: true,
      preview: true,
      restaurant_id,
      restaurant_name: restaurant.name,
      supplier,
      supplier_key: supplierKey,
      product_description,
      product_key: productKey,
      summary: {
        selected: previewChanges.length,
        changed: changed.length,
        unchanged,
        newly_linked: newlyLinked,
        unlinked,
        future_mapping_requested: approve_future,
        existing_future_mapping: Boolean(existingMapping),
        future_mapping_would_change: approve_future &&
          existingMapping?.ingredient_id !== future_ingredient_id,
      },
      future_mapping: {
        approve: approve_future,
        ingredient_id: approve_future ? future_ingredient_id : null,
        ingredient_name: approve_future
          ? ingredientNames.get(future_ingredient_id)
          : null,
        existing_ingredient_id: existingMapping?.ingredient_id || null,
      },
      changes: previewChanges,
      saved: false,
      expected_mapping_updated_at: existingMapping?.updated_at ?? null,
      confirmation_token: createConflictConfirmation(
        admin.user.id,
        {
          ...confirmationRequest,
          expected_mapping_updated_at: existingMapping?.updated_at ?? null,
        }
      ),
    });
  } catch (error) {
    console.error('[admin conflict preview]', error);

    return res.status(500).json({
      error: 'Failed to preview ingredient corrections.',
    });
  }
}
