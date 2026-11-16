BEGIN;

CREATE OR REPLACE FUNCTION public.mark_invoice_reviewed_transactional(
  p_restaurant_id uuid,
  p_invoice_id uuid,
  p_admin_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $function$
DECLARE
  inv public.invoices%ROWTYPE;
  changed_lines integer;
  changed boolean;
BEGIN
  IF p_restaurant_id IS NULL OR p_invoice_id IS NULL OR p_admin_id IS NULL THEN
    RAISE EXCEPTION 'Invoice, restaurant, and reviewer are required'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.profiles
  WHERE id = p_admin_id AND role = 'admin' FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('admin-invoice:' || p_restaurant_id::text, 0)
  );
  SELECT * INTO inv FROM public.invoices
  WHERE id = p_invoice_id AND restaurant_id = p_restaurant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found for this restaurant' USING ERRCODE = 'P0002';
  END IF;

  PERFORM id FROM public.invoice_items
  WHERE invoice_id = p_invoice_id ORDER BY id FOR UPDATE;

  UPDATE public.invoice_items SET reviewed = true
  WHERE invoice_id = p_invoice_id AND reviewed IS DISTINCT FROM true;
  GET DIAGNOSTICS changed_lines = ROW_COUNT;

  changed := inv.reviewed IS DISTINCT FROM true
    OR inv.reviewed_at IS NULL OR inv.reviewed_by IS NULL OR changed_lines > 0;
  IF changed THEN
    UPDATE public.invoices
    SET reviewed = true, reviewed_at = now(), reviewed_by = p_admin_id
    WHERE id = p_invoice_id AND restaurant_id = p_restaurant_id
    RETURNING * INTO inv;
  END IF;

  RETURN jsonb_build_object(
    'success', true, 'invoice_id', inv.id, 'restaurant_id', inv.restaurant_id,
    'reviewed', inv.reviewed, 'reviewed_by', inv.reviewed_by,
    'reviewed_at', inv.reviewed_at, 'reviewed_lines', changed_lines, 'changed', changed
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.mark_invoice_reviewed_transactional(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_invoice_reviewed_transactional(uuid, uuid, uuid)
  TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;