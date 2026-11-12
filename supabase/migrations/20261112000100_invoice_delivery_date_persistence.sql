
-- Step 6G.22: Persist invoice delivery dates.
-- Preserve original invoice dates and confirmation safeguards.
-- Does not activate delivery-date-based repricing or inventory.

BEGIN;

ALTER TABLE public.invoices
ADD COLUMN IF NOT EXISTS delivery_date date;

UPDATE public.invoices
SET delivery_date = date
WHERE delivery_date IS NULL
  AND date IS NOT NULL;

COMMENT ON COLUMN public.invoices.delivery_date IS
'Actual delivery date, falling back to invoice date when no explicit delivery date is provided.';

DO $migration$
DECLARE
    v_definition text;

    v_column_pattern text :=
        '(number,[[:space:]]*date,)([[:space:]]*)(amount,)';

    v_value_pattern text :=
        '(p_invoice->>''number'',[[:space:]]*\(p_invoice->>''date''\)::date,)([[:space:]]*)(\(p_invoice->>''amount''\)::numeric,)';

    v_column_matches integer;
    v_value_matches integer;
BEGIN
    SELECT pg_get_functiondef(p.oid)
    INTO v_definition
    FROM pg_proc p
    WHERE p.oid =
        'public.save_invoice_confirmation_transactional(uuid,text,text,uuid,jsonb,jsonb,jsonb,jsonb,boolean)'::regprocedure;

    IF v_definition IS NULL THEN
        RAISE EXCEPTION
            'Transactional confirmation function not found';
    END IF;

    -- The production function may already have been
    -- updated manually. Do not modify it twice.
    IF v_definition ~
        'number,[[:space:]]*date,[[:space:]]*delivery_date,[[:space:]]*amount,'
    THEN
        IF COALESCE(
            substring(
                regexp_replace(
                    v_definition,
                    '[[:space:]]+',
                    ' ',
                    'g'
                )
                FROM
                $pattern$INSERT INTO public\.invoices \(.*?;$pattern$
            ) LIKE
            $expected$%VALUES ( v_invoice_id, p_restaurant_id, p_invoice->>'supplier', p_invoice->>'number', (p_invoice->>'date')::date, COALESCE(NULLIF(p_invoice->>'delivery_date', '')::date, (p_invoice->>'date')::date), (p_invoice->>'amount')::numeric,%$expected$,
            false
        ) IS NOT TRUE
        THEN
            RAISE EXCEPTION
                'Delivery date insert mapping or invoice-date fallback is unexpected';
        END IF;

        RETURN;
    END IF;

    SELECT COUNT(*)
    INTO v_column_matches
    FROM regexp_matches(
        v_definition,
        v_column_pattern,
        'g'
    );

    SELECT COUNT(*)
    INTO v_value_matches
    FROM regexp_matches(
        v_definition,
        v_value_pattern,
        'g'
    );

    IF v_column_matches <> 1
       OR v_value_matches <> 1
    THEN
        RAISE EXCEPTION
            'Unexpected confirmation function structure';
    END IF;

    v_definition := regexp_replace(
        v_definition,
        v_column_pattern,
        '\1\2delivery_date,\2\3'
    );

    v_definition := regexp_replace(
        v_definition,
        v_value_pattern,
        '\1\2COALESCE(NULLIF(p_invoice->>''delivery_date'', '''')::date, (p_invoice->>''date'')::date),\2\3'
    );

    EXECUTE v_definition;
END;
$migration$;

-- Reject conflicting continuation-page dates after the parent
-- invoice has been locked and its restaurant ownership checked.
DO $append_migration$
DECLARE
    v_definition text;
    v_anchor_matches integer;

    v_anchor_pattern text :=
        '(IF NOT FOUND THEN[[:space:]]+RAISE EXCEPTION[[:space:]]+''Append target does not belong to restaurant'';[[:space:]]+END IF;)';

    v_guard text := $guard$
        IF COALESCE(
            p_invoice->>'delivery_date_status',
            'explicit'
        ) <> 'not_printed'
           AND NULLIF(p_invoice->>'delivery_date', '') IS NOT NULL
           AND NULLIF(p_invoice->>'delivery_date', '')::date
               IS DISTINCT FROM (
                   SELECT COALESCE(i.delivery_date, i.date)
                   FROM public.invoices AS i
                   WHERE i.id = v_invoice_id
                     AND i.restaurant_id = p_restaurant_id
               )
        THEN
            RAISE EXCEPTION
                'Append delivery date conflicts with parent invoice';
        END IF;
$guard$;
BEGIN
    SELECT pg_get_functiondef(
        to_regprocedure(
            'public.save_invoice_confirmation_transactional(uuid,text,text,uuid,jsonb,jsonb,jsonb,jsonb,boolean)'
        )
    )
    INTO v_definition;

    IF v_definition IS NULL THEN
        RAISE EXCEPTION
            'Transactional confirmation function not found';
    END IF;

    SELECT COUNT(*)
    INTO v_anchor_matches
    FROM regexp_matches(
        v_definition,
        v_anchor_pattern,
        'g'
    );

    IF v_anchor_matches <> 1 THEN
        RAISE EXCEPTION
            'Unexpected append ownership-check structure';
    END IF;

    IF position(v_guard IN v_definition) > 0 THEN
        RETURN;
    END IF;

    IF position(
        'Append delivery date conflicts with parent invoice'
        IN v_definition
    ) > 0 THEN
        RAISE EXCEPTION
            'Unexpected existing append delivery-date guard';
    END IF;

    v_definition := regexp_replace(
        v_definition,
        v_anchor_pattern,
        '\1' || chr(10) || v_guard
    );

    EXECUTE v_definition;
END;
$append_migration$;

COMMIT;