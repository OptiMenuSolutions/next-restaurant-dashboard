BEGIN;

CREATE TABLE IF NOT EXISTS public.invoice_delivery_date_audit (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id uuid NOT NULL REFERENCES public.restaurants(id),
    invoice_id uuid NOT NULL,
    actor_id uuid NOT NULL,
    original_invoice_date date,
    old_delivery_date date,
    new_delivery_date date NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.invoice_delivery_date_audit ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.invoice_delivery_date_audit
FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT, INSERT ON public.invoice_delivery_date_audit TO service_role;

CREATE INDEX IF NOT EXISTS invoice_delivery_date_audit_invoice_idx
ON public.invoice_delivery_date_audit (
    restaurant_id, invoice_id, created_at
);

CREATE OR REPLACE FUNCTION public.correct_invoice_delivery_date(
    p_restaurant_id uuid,
    p_invoice_id uuid,
    p_actor_id uuid,
    p_expected_delivery_date date,
    p_delivery_date date,
    p_queue_calculations boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $function$
DECLARE
    v_invoice public.invoices%ROWTYPE;
    v_audit_id uuid;
    v_effective_date date;
BEGIN
    IF p_restaurant_id IS NULL OR p_invoice_id IS NULL
       OR p_actor_id IS NULL OR p_delivery_date IS NULL
       OR NOT pg_catalog.isfinite(p_delivery_date)
       OR p_delivery_date < DATE '0001-01-01'
       OR p_delivery_date > DATE '9999-12-31'
    THEN
        RAISE EXCEPTION 'Invalid delivery-date correction'
            USING ERRCODE = '22023';
    END IF;

    PERFORM 1
    FROM public.profiles
    WHERE id = p_actor_id
      AND restaurant_id = p_restaurant_id
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Restaurant access denied'
            USING ERRCODE = '42501';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
            'admin-invoice:' || p_restaurant_id::text,
            0
        )
    );

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
            'invoice-append:' || p_restaurant_id::text || ':' ||
            p_invoice_id::text,
            0
        )
    );

    SELECT *
    INTO v_invoice
    FROM public.invoices
    WHERE id = p_invoice_id
      AND restaurant_id = p_restaurant_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invoice not found'
            USING ERRCODE = 'P0002';
    END IF;

    -- A retry that already has the requested date creates no new work.
    IF v_invoice.delivery_date IS NOT DISTINCT FROM p_delivery_date THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', true,
            'changed', false,
            'calculations_queued', false,
            'invoice', pg_catalog.jsonb_build_object(
                'id', v_invoice.id,
                'restaurant_id', v_invoice.restaurant_id,
                'date', v_invoice.date,
                'delivery_date', v_invoice.delivery_date
            )
        );
    END IF;

    IF v_invoice.delivery_date IS DISTINCT FROM p_expected_delivery_date THEN
        RAISE EXCEPTION 'Invoice date changed; reload before saving'
            USING ERRCODE = '40001';
    END IF;

    v_effective_date := LEAST(
        COALESCE(
            v_invoice.delivery_date,
            v_invoice.date,
            p_delivery_date
        ),
        p_delivery_date
    );

    UPDATE public.invoices
    SET delivery_date = p_delivery_date
    WHERE id = p_invoice_id
      AND restaurant_id = p_restaurant_id;

    INSERT INTO public.invoice_delivery_date_audit (
        restaurant_id,
        invoice_id,
        actor_id,
        original_invoice_date,
        old_delivery_date,
        new_delivery_date
    )
    VALUES (
        p_restaurant_id,
        p_invoice_id,
        p_actor_id,
        v_invoice.date,
        v_invoice.delivery_date,
        p_delivery_date
    )
    RETURNING id INTO v_audit_id;

    IF p_queue_calculations IS TRUE THEN
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
            effective_date = LEAST(
                public.invoice_calculation_jobs.effective_date,
                EXCLUDED.effective_date
            ),
            updated_at = now();
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'changed', true,
        'audit_id', v_audit_id,
        'calculations_queued', p_queue_calculations IS TRUE,
        'invoice', pg_catalog.jsonb_build_object(
            'id', v_invoice.id,
            'restaurant_id', v_invoice.restaurant_id,
            'date', v_invoice.date,
            'delivery_date', p_delivery_date
        )
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.correct_invoice_delivery_date(
    uuid, uuid, uuid, date, date, boolean
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.correct_invoice_delivery_date(
    uuid, uuid, uuid, date, date, boolean
) TO service_role;

COMMIT;