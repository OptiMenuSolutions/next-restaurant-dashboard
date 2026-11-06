// pages/api/admin/invoice-review/reverse-rejection.js

import {
  adminDb as db,
  requireAdmin,
} from '../../../../lib/admin/requireAdmin';

import {
  getProgressiveInvoiceMatchingPolicy,
} from '../../../../lib/progressiveInvoiceMatching';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  if (req.method !== 'POST') {
    return res.status(405).json({
      error: 'Method not allowed',
    });
  }

  const {
    restaurant_id,
    supplier,
    product_description,
    ingredient_id,
    reason,
  } = req.body || {};

  if (
    !UUID_PATTERN.test(String(restaurant_id || '')) ||
    !UUID_PATTERN.test(String(ingredient_id || ''))
  ) {
    return res.status(400).json({
      error: 'Valid restaurant and ingredient IDs are required.',
    });
  }

  if (
    typeof supplier !== 'string' ||
    !supplier.trim() ||
    typeof product_description !== 'string' ||
    !product_description.trim()
  ) {
    return res.status(400).json({
      error: 'Supplier and product description are required.',
    });
  }

  if (
    typeof reason !== 'string' ||
    reason.trim().length < 5 ||
    reason.length > 2000
  ) {
    return res.status(400).json({
      error: 'Provide a reversal reason between 5 and 2000 characters.',
    });
  }

  try {
    const policy = await getProgressiveInvoiceMatchingPolicy(
      db,
      restaurant_id
    );

    if (!policy.matching_enabled) {
      return res.status(403).json({
        error:
          'Invoice ingredient matching is not enabled for this restaurant.',
      });
    }

    const { data, error } = await db.rpc(
      'reverse_invoice_match_rejection',
      {
        p_restaurant_id: restaurant_id,
        p_supplier: supplier,
        p_product_description: product_description,
        p_ingredient_id: ingredient_id,
        p_admin_id: admin.user.id,
        p_reason: reason.trim(),
      }
    );

    if (error) {
      const message = error.message || 'Reversal failed.';

      const status =
        /not found|refresh before retrying/i.test(message)
          ? 409
          : 400;

      return res.status(status).json({
        error: message,
      });
    }

    return res.status(200).json({
      ok: true,
      ...data,
    });
  } catch (error) {
    console.error(
      '[admin invoice rejection reversal]',
      error
    );

    return res.status(500).json({
      error: 'Could not reverse the rejected relationship.',
    });
  }
}