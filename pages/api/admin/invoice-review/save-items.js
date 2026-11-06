import { createClient } from '@supabase/supabase-js';
import { waitUntil } from '@vercel/functions';

import {
  withAdminAuth,
} from '../../../../lib/admin/withAdminAuth';

import {
  getProgressiveInvoiceMatchingPolicy,
} from '../../../../lib/progressiveInvoiceMatching';

import {
  processInvoiceCalculations,
} from '../../../../lib/admin/processInvoiceCalculations';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export const config = {
  maxDuration: 300,
};

export function createSaveInvoiceItemsHandler({
  db = supabase,
  getMatchingControl = getProgressiveInvoiceMatchingPolicy,
  processCalculations = processInvoiceCalculations,
} = {}) {
  return async function handler(req, res, session) {
    if (req.method !== 'POST') {
      return res.status(405).json({
        error: 'Method not allowed.',
      });
    }

    const {
      invoice_id,
      restaurant_id,
      items,
    } = req.body || {};

    if (
      !invoice_id ||
      !restaurant_id ||
      !Array.isArray(items)
    ) {
      return res.status(400).json({
        error:
          'invoice_id, restaurant_id, and items[] required.',
      });
    }

    if (!session?.user?.id) {
      return res.status(403).json({
        error: 'Administrator authorization required.',
      });
    }

    try {
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

      const {
        data: invoice,
        error: invoiceError,
      } = await db
        .from('invoices')
        .select('id')
        .eq('id', invoice_id)
        .eq('restaurant_id', restaurant_id)
        .maybeSingle();

      if (invoiceError) throw invoiceError;

      if (!invoice) {
        return res.status(404).json({
          error: 'Invoice not found for this restaurant.',
        });
      }

      if (items.length === 0) {
        return res.status(200).json({
          success: true,
          changed: 0,
          errors: [],
        });
      }

      const submittedIds = items.map(item => item?.id);

      if (
        submittedIds.some(id => !id) ||
        new Set(submittedIds).size !== submittedIds.length
      ) {
        return res.status(400).json({
          error:
            'Invoice item IDs must be present and unique.',
        });
      }

      const lines = items.map(item => ({
        id: item.id,
        quantity: item.quantity ?? null,
        unit: item.unit ?? null,
        unit_cost: item.unit_cost ?? null,
        amount: item.amount ?? null,
        ingredient_id: item.ingredient_id ?? null,
      }));

      // The database RPC saves every correction,
      // records relationship decisions, and queues
      // recalculation in one transaction.
      //
      // If the RPC fails, its database changes roll back.
      const {
        data: result,
        error: saveError,
      } = await db.rpc(
        'save_admin_invoice_review',
        {
          p_invoice_id: invoice_id,
          p_lines: lines,
          p_reviewed: false,
          p_admin_id: session.user.id,
        }
      );

      if (saveError) {
        throw new Error(saveError.message);
      }

      // The durable calculation job is already committed.
      // This schedules an immediate attempt, while the
      // database queue remains available for retries.
      try {
        waitUntil(
          Promise.resolve()
            .then(() =>
              processCalculations(db, restaurant_id)
            )
            .catch(error => {
              console.error(
                '[invoice-review calculations]',
                restaurant_id,
                error
              );
            })
        );
      } catch (error) {
        console.error(
          '[invoice-review scheduling]',
          error
        );
      }

      return res.status(200).json({
        success: true,
        changed: result.changed,
        relinked: result.relinked,
        calculationsPending: true,
        restaurantId: result.restaurantId,
        errors: [],
      });
    } catch (error) {
      console.error(
        '[invoice-review save-items]',
        error
      );

      return res.status(500).json({
        success: false,
        error: 'Could not save invoice corrections.',
      });
    }
  };
}

export default withAdminAuth(
  createSaveInvoiceItemsHandler()
);