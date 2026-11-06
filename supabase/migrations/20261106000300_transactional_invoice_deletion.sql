-- Step 11: Transactional invoice deletion
--
-- Atomically:
-- 1. Validates invoice ownership
-- 2. Protects historical audit references
-- 3. Collects affected ingredients
-- 4. Deletes eligible invoices and their line items
-- 5. Queues financial recalculation
--
-- No existing invoice data is modified when this
-- migration is installed. The function executes
-- only when explicitly called.

BEGIN;

CREATE OR REPLACE FUNCTION public.delete_invoices_transactional(
  p_restaurant_id uuid,
  p_invoice_ids uuid[],
  p_queue_calculations boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $function$
DECLARE
  v_invoice_ids uuid[];
  v_ingredient_ids uuid[];
  v_invoice_count integer;
  v_line_count integer;
  v_effective_date date;
  v_protected_count integer;
  v_queued boolean := false;
BEGIN

  IF p_restaurant_id IS NULL
     OR p_invoice_ids IS NULL
     OR cardinality(p_invoice_ids) = 0
     OR array_position(p_invoice_ids, NULL) IS NOT NULL
  THEN
    RAISE EXCEPTION
      'Restaurant and invoice IDs are required';
  END IF;

  -- Serialize invoice deletion operations for
  -- this restaurant.

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'admin-invoice:' || p_restaurant_id::text,
      0
    )
  );

  -- Lock the requested invoices and verify ownership.

  SELECT array_agg(id ORDER BY id)
  INTO v_invoice_ids
  FROM (
    SELECT id
    FROM public.invoices
    WHERE restaurant_id = p_restaurant_id
      AND id = ANY(p_invoice_ids)
    FOR UPDATE
  ) locked_invoices;

  IF cardinality(
    COALESCE(v_invoice_ids, ARRAY[]::uuid[])
  ) <> (
    SELECT COUNT(DISTINCT requested_id)
    FROM unnest(p_invoice_ids) AS requested(requested_id)
  )
  THEN
    RAISE EXCEPTION
      'One or more invoices do not belong to this restaurant';
  END IF;

  -- Do not silently delete protected audit history.

  SELECT COUNT(*)
  INTO v_protected_count
  FROM public.invoice_items ii
  WHERE ii.invoice_id = ANY(v_invoice_ids)
    AND (
      EXISTS (
        SELECT 1
        FROM public.invoice_match_decision_audit a
        WHERE a.invoice_item_id = ii.id
      )
      OR EXISTS (
        SELECT 1
        FROM public.invoice_match_rejections r
        WHERE r.source_invoice_item_id = ii.id
      )
    );

  IF v_protected_count > 0 THEN
    RAISE EXCEPTION
      'Invoice deletion blocked: % lines have protected matching history',
      v_protected_count;
  END IF;

  -- Capture ingredients before deleting their links.

  SELECT COALESCE(
    array_agg(DISTINCT ingredient_id),
    ARRAY[]::uuid[]
  )
  INTO v_ingredient_ids
  FROM public.invoice_items
  WHERE invoice_id = ANY(v_invoice_ids)
    AND ingredient_id IS NOT NULL;

  SELECT COUNT(*)
  INTO v_line_count
  FROM public.invoice_items
  WHERE invoice_id = ANY(v_invoice_ids);

  SELECT MIN(date)
  INTO v_effective_date
  FROM public.invoices
  WHERE id = ANY(v_invoice_ids);

  v_effective_date :=
    COALESCE(v_effective_date, CURRENT_DATE);

  -- Delete invoice lines before their parent invoices.
  -- All operations participate in this RPC transaction.

  DELETE FROM public.invoice_items
  WHERE invoice_id = ANY(v_invoice_ids);

  -- Invoice files and related cascading references
  -- are handled by their existing foreign keys.

  DELETE FROM public.invoices
  WHERE restaurant_id = p_restaurant_id
    AND id = ANY(v_invoice_ids);

  GET DIAGNOSTICS v_invoice_count = ROW_COUNT;

  -- Queue recalculation inside the same transaction.
  --
  -- A failure here rolls back the invoice deletion.

  IF p_queue_calculations THEN

    INSERT INTO public.invoice_calculation_jobs (
      restaurant_id,
      effective_date
    )
    VALUES (
      p_restaurant_id,
      v_effective_date
    )
    ON CONFLICT (restaurant_id)
    DO UPDATE SET
      generation =
        public.invoice_calculation_jobs.generation + 1,
      effective_date = EXCLUDED.effective_date,
      updated_at = NOW();

    v_queued := true;

  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'deleted', v_invoice_count,
    'lines_deleted', v_line_count,
    'ingredient_ids', to_jsonb(v_ingredient_ids),
    'calculations_queued', v_queued
  );

END;
$function$;

-- Only server-side privileged operations can invoke
-- this destructive database function.

REVOKE ALL ON FUNCTION
public.delete_invoices_transactional(
  uuid,
  uuid[],
  boolean
)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
public.delete_invoices_transactional(
  uuid,
  uuid[],
  boolean
)
TO service_role;

COMMIT;