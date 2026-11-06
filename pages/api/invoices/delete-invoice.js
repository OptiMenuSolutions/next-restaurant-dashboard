// pages/api/invoices/delete-invoice.js
// Invoice rows and the calculation job are committed atomically by the DB RPC.
// External file cleanup and calculation processing happen only after commit.

import { createClient } from '@supabase/supabase-js';
import { getRestaurantInvoiceMatchingControl } from '../../../lib/invoiceMatchingControls';
import { fetchAll } from '../../../lib/admin/fetchAll';
import { processInvoiceCalculations } from '../../../lib/admin/processInvoiceCalculations';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const STORAGE_BUCKET = 'invoices';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createDeleteInvoiceHandler({
  db = supabase,
  verifyAccess,
  getMatchingControl = getRestaurantInvoiceMatchingControl,
  processCalculations = processInvoiceCalculations,
} = {}) {
  return async function handler(req, res) {
    if (req.method !== 'POST') {
      return res.status(405).end();
    }

    let body;

    try {
      body = typeof req.body === 'string'
        ? JSON.parse(req.body)
        : req.body;
    } catch {
      return res.status(400).json({
        error: 'Invalid JSON body',
      });
    }

    const { restaurant_id, invoice_ids } = body || {};

    if (
      typeof restaurant_id !== 'string' ||
      !UUID_PATTERN.test(restaurant_id)
    ) {
      return res.status(400).json({
        error: 'A valid restaurant_id is required',
      });
    }

    if (
      !Array.isArray(invoice_ids) ||
      !invoice_ids.length ||
      invoice_ids.some(
        id =>
          typeof id !== 'string' ||
          !UUID_PATTERN.test(id)
      )
    ) {
      return res.status(400).json({
        error: 'Valid invoice_ids are required',
      });
    }

    const ids = [...new Set(invoice_ids)];

    // Verify restaurant authorization before any database changes.
    const { error: authError, status: authStatus } = await (
      verifyAccess
        ? verifyAccess(req, restaurant_id)
        : import('../../../lib/withRestaurantAuth')
            .then(m =>
              m.verifyRestaurantAccess(req, restaurant_id)
            )
    );

    if (authError) {
      return res.status(authStatus || 403).json({
        error: authError,
      });
    }

    // Locked restaurants may delete invoices, but cannot
    // trigger ingredient repricing or inventory recalculation.
    let matchingControl;

    try {
      matchingControl = await getMatchingControl(
        db,
        restaurant_id
      );
    } catch (error) {
      console.error(
        '[delete-invoice] Matching control:',
        error
      );

      return res.status(503).json({
        error:
          'Invoice matching controls are unavailable. Please retry.',
      });
    }

    const matchingEnabled =
      matchingControl.matching_enabled === true;

    try {
      // These reads are for storage cleanup only.
      // The RPC independently validates invoice ownership
      // and existence under database row locks.
      const invoices = await fetchAll(
        () =>
          db
            .from('invoices')
            .select('id, file_url')
            .eq('restaurant_id', restaurant_id)
            .in('id', ids)
            .order('id'),
        {
          page: 500,
          strictLimit: true,
        }
      );

      if (invoices.length !== ids.length) {
        return res.status(404).json({
          error: 'One or more invoices were not found',
        });
      }

      // Collect storage paths before the transactional deletion.
      const fileRows = await fetchAll(
        () =>
          db
            .from('invoice_files')
            .select('id, file_url')
            .in('invoice_id', ids)
            .order('id'),
        {
          page: 500,
          strictLimit: true,
        }
      );

      const paths = [
        ...new Set(
          [
            ...fileRows.map(file => file.file_url),
            ...invoices.map(invoice => invoice.file_url),
          ].filter(
            path =>
              typeof path === 'string' &&
              path &&
              !/^https?:\/\//i.test(path)
          )
        ),
      ];

      // The RPC deletes invoice lines and invoices
      // and enqueues recovery in ONE PostgreSQL transaction.
      //
      // Do not issue separate database deletes here.
      const {
        data: result,
        error: deleteError,
      } = await db.rpc(
        'delete_invoices_transactional',
        {
          p_restaurant_id: restaurant_id,
          p_invoice_ids: ids,
          p_queue_calculations: matchingEnabled,
        }
      );

      if (deleteError) {
        console.error(
          '[delete-invoice] Transaction rejected:',
          deleteError
        );

        return res.status(409).json({
          success: false,
          error:
            'Invoice deletion was rejected. No invoices were deleted.',
        });
      }

      if (
        !result?.success ||
        result.deleted !== ids.length
      ) {
        // An unexpected RPC result requires investigation.
        // Never automatically retry a destructive operation.
        console.error(
          '[delete-invoice] Unexpected transactional result:',
          result
        );

        return res.status(500).json({
          success: false,
          error:
            'Unexpected invoice deletion result; check server logs before retrying.',
        });
      }

      // Supabase Storage is external to PostgreSQL.
      // Cleanup failures must not misrepresent a successful
      // database transaction.
      let storageCleanupFailed = false;

      if (paths.length) {
        try {
          const { error } = await db.storage
            .from(STORAGE_BUCKET)
            .remove(paths);

          if (error) {
            throw error;
          }
        } catch (error) {
          storageCleanupFailed = true;

          console.error(
            '[delete-invoice] Storage cleanup failed:',
            error
          );
        }
      }

      // Process the queued calculation job.
      //
      // If this work fails, the database deletion remains
      // successful and the calculation job remains available
      // through the existing recovery mechanism.
      let calculationsPending = matchingEnabled;
      let calculationErrors = [];

      if (
        matchingEnabled &&
        result.calculations_queued
      ) {
        try {
          const outcome = await processCalculations(
            db,
            restaurant_id
          );

          calculationErrors = outcome?.errors || [];

          // A skipped worker does not prove the job is complete.
          calculationsPending =
            outcome?.skipped === true ||
            calculationErrors.length > 0;

          if (!calculationsPending) {
            const {
              data: job,
              error: jobError,
            } = await db
              .from('invoice_calculation_jobs')
              .select(
                'generation, completed_generation, last_error'
              )
              .eq('restaurant_id', restaurant_id)
              .single();

            if (jobError) {
              throw jobError;
            }

            calculationsPending =
              !job ||
              job.generation > job.completed_generation ||
              !!job.last_error;
          }
        } catch (error) {
          calculationsPending = true;

          calculationErrors = [
            error.message || String(error),
          ];

          console.error(
            '[delete-invoice] Calculations remain queued:',
            error
          );
        }
      }

      return res.status(200).json({
        success: true,
        deleted: result.deleted,
        lines_deleted: result.lines_deleted,

        // These are now handled by the calculation worker.
        ingredients_repriced: null,
        ingredients_cleared: null,

        calculations_queued:
          result.calculations_queued === true,

        calculations_pending: calculationsPending,
        calculation_errors: calculationErrors,

        storage_cleanup_failed: storageCleanupFailed,
      });
    } catch (error) {
      console.error(
        '[delete-invoice] Error:',
        error
      );

      return res.status(500).json({
        success: false,
        error:
          error.message ||
          'Failed to delete invoice',
      });
    }
  };
}

export default createDeleteInvoiceHandler();