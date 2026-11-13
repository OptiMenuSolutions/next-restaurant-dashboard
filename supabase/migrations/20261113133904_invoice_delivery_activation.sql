BEGIN;

-- The composite key enforces activation ownership in the database.
CREATE UNIQUE INDEX IF NOT EXISTS invoices_delivery_activation_owner_idx
ON public.invoices (id, restaurant_id);

CREATE INDEX IF NOT EXISTS invoices_delivery_activation_due_idx
ON public.invoices (restaurant_id, (COALESCE(delivery_date, date)));

CREATE TABLE IF NOT EXISTS public.invoice_delivery_activations (
    invoice_id uuid PRIMARY KEY,
    restaurant_id uuid NOT NULL
        REFERENCES public.restaurants(id) ON DELETE CASCADE,
    effective_date date NOT NULL CHECK (isfinite(effective_date)),
    operational_timezone text NOT NULL,
    queued_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (invoice_id, restaurant_id)
        REFERENCES public.invoices(id, restaurant_id) ON DELETE CASCADE
);

COMMENT ON TABLE public.invoice_delivery_activations IS
    'Records queued calculations for delivery-date eligibility. '
    'Does not confirm physical receipt of goods.';

CREATE INDEX IF NOT EXISTS invoice_delivery_activations_restaurant_idx
ON public.invoice_delivery_activations (restaurant_id);

ALTER TABLE public.invoice_delivery_activations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.invoice_delivery_activations
FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE ON public.invoice_delivery_activations
TO service_role;

CREATE OR REPLACE FUNCTION public.queue_due_invoice_deliveries(
    p_restaurant_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
    v_timezone text;
    v_today date;
    v_count integer;
    v_effective_date date;
BEGIN
    IF p_restaurant_id IS NULL THEN
        RAISE EXCEPTION 'Restaurant ID is required'
            USING ERRCODE = '22023';
    END IF;

    -- Use the same lock order as owner/admin date and timezone corrections.
    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
            'admin-invoice:' || p_restaurant_id::text, 0
        )
    );

    SELECT operational_timezone INTO v_timezone
    FROM public.restaurants
    WHERE id = p_restaurant_id AND deactivated_at IS NULL
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Active restaurant not found'
            USING ERRCODE = 'P0002';
    END IF;
    IF v_timezone IS NULL THEN
        RAISE EXCEPTION 'Restaurant time zone is not configured'
            USING ERRCODE = '22023';
    END IF;

    v_today := (pg_catalog.now() AT TIME ZONE v_timezone)::date;

    WITH newly_due AS (
        INSERT INTO public.invoice_delivery_activations AS a (
            invoice_id, restaurant_id, effective_date,
            operational_timezone, queued_at
        )
        SELECT
            i.id, i.restaurant_id, COALESCE(i.delivery_date, i.date),
            v_timezone, pg_catalog.now()
        FROM public.invoices AS i
        WHERE i.restaurant_id = p_restaurant_id
          AND isfinite(COALESCE(i.delivery_date, i.date))
          AND COALESCE(i.delivery_date, i.date) >= DATE '0001-01-01'
          AND COALESCE(i.delivery_date, i.date) <= v_today
        ON CONFLICT (invoice_id)
        DO UPDATE SET
            effective_date = EXCLUDED.effective_date,
            operational_timezone = EXCLUDED.operational_timezone,
            queued_at = EXCLUDED.queued_at
        WHERE a.effective_date IS DISTINCT FROM EXCLUDED.effective_date
           OR a.operational_timezone IS DISTINCT FROM EXCLUDED.operational_timezone
        RETURNING effective_date
    )
    SELECT count(*)::integer, min(effective_date)
    INTO v_count, v_effective_date
    FROM newly_due;

    IF v_count > 0 THEN
        -- Reject an inventory commit built before these purchases activated.
        PERFORM pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended(
                'current_inventory:' || p_restaurant_id::text, 0
            )
        );
        DELETE FROM public.inventory_build_state
        WHERE restaurant_id = p_restaurant_id;

        INSERT INTO public.invoice_calculation_jobs (
            restaurant_id, effective_date
        ) VALUES (
            p_restaurant_id, v_effective_date
        )
        ON CONFLICT (restaurant_id)
        DO UPDATE SET
            generation = public.invoice_calculation_jobs.generation + 1,
            effective_date = LEAST(
                public.invoice_calculation_jobs.effective_date,
                EXCLUDED.effective_date
            ),
            updated_at = pg_catalog.now();
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'restaurant_id', p_restaurant_id,
        'local_today', v_today,
        'eligible_invoices', v_count,
        'calculations_queued', v_count > 0
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.queue_due_invoice_deliveries(uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.queue_due_invoice_deliveries(uuid)
TO service_role;

COMMIT;