-- Serialize a completed pull with disconnects, and save sales/tickets/lines
-- together. Any validation or write failure rolls back the entire replacement.
CREATE OR REPLACE FUNCTION public.save_shift4_sync(
  p_connection_id uuid, p_restaurant_id uuid, p_location_id integer,
  p_access_token text, p_from date, p_to date, p_started_at timestamptz,
  p_sales jsonb, p_tickets jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  connection public.pos_connections%ROWTYPE;
  ticket jsonb;
  saved_ticket_id uuid;
  ticket_count integer := 0;
  line_count integer := 0;
  inserted_lines integer;
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to OR p_started_at IS NULL
    OR jsonb_typeof(p_sales) IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_tickets) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Invalid Shift4 sync range or payload';
  END IF;

  SELECT * INTO connection FROM public.pos_connections
    WHERE id = p_connection_id AND restaurant_id = p_restaurant_id
      AND provider = 'shift4' FOR UPDATE;
  IF NOT FOUND OR connection.status <> 'connected'
    OR connection.shift4_location_id IS DISTINCT FROM p_location_id
    OR p_location_id IS NULL
    OR connection.access_token IS DISTINCT FROM p_access_token
    OR connection.last_synced_at > p_started_at THEN
    RETURN jsonb_build_object('saved', false, 'tickets', 0, 'lines', 0);
  END IF;

  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_sales) s
    WHERE (s->>'sale_date') IS NULL OR (s->>'sale_date')::date NOT BETWEEN p_from AND p_to)
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_tickets) t
    WHERE (t->>'business_date') IS NULL OR (t->>'business_date')::date NOT BETWEEN p_from AND p_to
      OR jsonb_typeof(t->'lines') IS DISTINCT FROM 'array') THEN
    RAISE EXCEPTION 'Shift4 sync contains data outside its requested range or invalid lines';
  END IF;

  DELETE FROM public.pos_sales
    WHERE restaurant_id = p_restaurant_id AND pos_system = 'shift4'
      AND upload_session_id IS NULL AND sale_date BETWEEN p_from AND p_to;
  INSERT INTO public.pos_sales (restaurant_id, pos_system, upload_session_id, sale_date, item_name, category, quantity_sold, revenue, unit_price, hour_of_day, day_of_week, voids, comps, refunds)
    SELECT p_restaurant_id, 'shift4', NULL, r.sale_date, r.item_name, r.category, r.quantity_sold, r.revenue, r.unit_price, r.hour_of_day, r.day_of_week, r.voids, r.comps, r.refunds
    FROM jsonb_populate_recordset(NULL::public.pos_sales, p_sales) r;

  FOR ticket IN SELECT value FROM jsonb_array_elements(p_tickets) LOOP
    INSERT INTO public.pos_tickets (restaurant_id, pos_system, synced_at, external_ticket_id, ticket_type, opened_at, closed_at, business_date, raw, order_number, order_type, revenue_center, table_name, guest_count, opened_by_ref, closed_by_ref, void_reason, total_items, total_discounts, total_tax, total_tips, total_grand)
      SELECT p_restaurant_id, 'shift4', now(), r.external_ticket_id, r.ticket_type, r.opened_at, r.closed_at, r.business_date, r.raw, r.order_number, r.order_type, r.revenue_center, r.table_name, r.guest_count, r.opened_by_ref, r.closed_by_ref, r.void_reason, r.total_items, r.total_discounts, r.total_tax, r.total_tips, r.total_grand
      FROM jsonb_populate_record(NULL::public.pos_tickets, ticket) r
      ON CONFLICT (restaurant_id, pos_system, external_ticket_id) DO UPDATE SET
        ticket_type = EXCLUDED.ticket_type, opened_at = EXCLUDED.opened_at, closed_at = EXCLUDED.closed_at, business_date = EXCLUDED.business_date, raw = EXCLUDED.raw, order_number = EXCLUDED.order_number, order_type = EXCLUDED.order_type, revenue_center = EXCLUDED.revenue_center, table_name = EXCLUDED.table_name, guest_count = EXCLUDED.guest_count, opened_by_ref = EXCLUDED.opened_by_ref, closed_by_ref = EXCLUDED.closed_by_ref, void_reason = EXCLUDED.void_reason, total_items = EXCLUDED.total_items, total_discounts = EXCLUDED.total_discounts, total_tax = EXCLUDED.total_tax, total_tips = EXCLUDED.total_tips, total_grand = EXCLUDED.total_grand, synced_at = now()
      RETURNING id INTO saved_ticket_id;
    ticket_count := ticket_count + 1;
    DELETE FROM public.pos_ticket_lines WHERE public.pos_ticket_lines.ticket_id = saved_ticket_id;
    INSERT INTO public.pos_ticket_lines (ticket_id, restaurant_id, external_line_id, item_name, category, line_type, quantity, unit_price, item_amount, discount_amount, is_non_sales_revenue, added_at, item_ref, void_reason, modifier_amount, modifiers, discounts, special_requests)
      SELECT saved_ticket_id, p_restaurant_id, r.external_line_id, r.item_name, r.category, r.line_type, r.quantity, r.unit_price, r.item_amount, r.discount_amount, r.is_non_sales_revenue, r.added_at, r.item_ref, r.void_reason, r.modifier_amount, r.modifiers, r.discounts, r.special_requests
      FROM jsonb_populate_recordset(NULL::public.pos_ticket_lines, ticket->'lines') r;
    GET DIAGNOSTICS inserted_lines = ROW_COUNT;
    line_count := line_count + inserted_lines;
  END LOOP;

  UPDATE public.pos_connections SET last_synced_at = now(), last_error = NULL,
    updated_at = now() WHERE id = p_connection_id;
  RETURN jsonb_build_object('saved', true, 'tickets', ticket_count, 'lines', line_count);
END;
$$;

REVOKE ALL ON FUNCTION public.save_shift4_sync(uuid,uuid,integer,text,date,date,timestamptz,jsonb,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_shift4_sync(uuid,uuid,integer,text,date,date,timestamptz,jsonb,jsonb)
  TO service_role;

-- Compare credentials inside the RPC body rather than leaking them through
-- PostgREST URL filters. All lifecycle updates share the same row lock as sync.
CREATE OR REPLACE FUNCTION public.update_shift4_connection(
  p_connection_id uuid, p_status text, p_location_id integer,
  p_access_token text, p_refresh_token text, p_changes jsonb
) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  current_connection public.pos_connections%ROWTYPE;
  replacement public.pos_connections%ROWTYPE;
BEGIN
  SELECT * INTO current_connection FROM public.pos_connections
    WHERE id = p_connection_id AND provider = 'shift4' FOR UPDATE;
  IF NOT FOUND OR current_connection.status IS DISTINCT FROM p_status
    OR current_connection.shift4_location_id IS DISTINCT FROM p_location_id
    OR current_connection.access_token IS DISTINCT FROM p_access_token
    OR current_connection.refresh_token IS DISTINCT FROM p_refresh_token THEN
    RETURN false;
  END IF;
  IF jsonb_typeof(p_changes) IS DISTINCT FROM 'object' OR
    p_changes - ARRAY['status','shift4_location_id','shift4_timezone','access_token',
      'refresh_token','expires_at','token_refreshed_at','token_error','last_error',
      'merchant_id','locations','updated_at'] <> '{}'::jsonb THEN
    RAISE EXCEPTION 'Unsupported Shift4 connection update';
  END IF;
  SELECT * INTO replacement FROM jsonb_populate_record(current_connection, p_changes);
  IF replacement.status NOT IN ('pending','installing','connected','error','disconnecting','disconnected')
    OR (replacement.status = 'connected' AND replacement.shift4_location_id IS NULL) THEN
    RAISE EXCEPTION 'Invalid Shift4 connection state';
  END IF;
  UPDATE public.pos_connections SET
    status = replacement.status,
    shift4_location_id = replacement.shift4_location_id,
    shift4_timezone = replacement.shift4_timezone,
    access_token = replacement.access_token,
    refresh_token = replacement.refresh_token,
    expires_at = replacement.expires_at,
    token_refreshed_at = replacement.token_refreshed_at,
    token_error = replacement.token_error,
    last_error = replacement.last_error,
    merchant_id = replacement.merchant_id,
    locations = replacement.locations ,
    updated_at = now()
    WHERE id = p_connection_id;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.update_shift4_connection(uuid,text,integer,text,text,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_shift4_connection(uuid,text,integer,text,text,jsonb)
  TO service_role;
