BEGIN;

DO $migration$
DECLARE
    v_function regprocedure :=
        to_regprocedure(
            'public.save_invoice_confirmation_transactional'
            '(uuid,text,text,uuid,jsonb,jsonb,jsonb,jsonb,boolean)'
        );

    v_definition text;
    v_original text;
    v_updated text;
    v_old_count integer;
    v_new_count integer;

    v_prefix text :=
        'INSERT INTO public\.invoice_calculation_jobs[[:space:]]*'
        || '\([[:space:]]*restaurant_id,[[:space:]]*'
        || 'effective_date[[:space:]]*\)[[:space:]]*'
        || 'VALUES[[:space:]]*\([[:space:]]*'
        || 'p_restaurant_id,[[:space:]]*';

    v_old_pattern text;
    v_new_pattern text;

    v_replacement text := $replacement$
        INSERT INTO public.invoice_calculation_jobs (
            restaurant_id,
            effective_date
        )
        VALUES (
            p_restaurant_id,
            (
                SELECT COALESCE(i.delivery_date, i.date)
                FROM public.invoices AS i
                WHERE i.id = v_invoice_id
                  AND i.restaurant_id = p_restaurant_id
            )
        )
$replacement$;
BEGIN
    IF v_function IS NULL THEN
        RAISE EXCEPTION
            'Required transactional confirmation function is missing';
    END IF;

    v_definition := pg_get_functiondef(v_function);

    v_old_pattern := v_prefix
        || 'COALESCE\([[:space:]]*'
        || '\(p_invoice->>''date''\)::date,[[:space:]]*'
        || 'CURRENT_DATE[[:space:]]*\)[[:space:]]*\)';

    v_new_pattern := v_prefix
        || '\([[:space:]]*'
        || 'SELECT COALESCE\(i\.delivery_date, i\.date\)'
        || '[[:space:]]*FROM public\.invoices AS i'
        || '[[:space:]]*WHERE i\.id = v_invoice_id'
        || '[[:space:]]*AND i\.restaurant_id = p_restaurant_id'
        || '[[:space:]]*\)[[:space:]]*\)';

    SELECT count(*)
    INTO v_old_count
    FROM regexp_matches(v_definition, v_old_pattern, 'g');

    SELECT count(*)
    INTO v_new_count
    FROM regexp_matches(v_definition, v_new_pattern, 'g');

    -- Re-running this migration must not change an updated function.
    IF v_old_count = 0 AND v_new_count = 1 THEN
        RETURN;
    END IF;

    IF v_old_count <> 1 OR v_new_count <> 0 THEN
        RAISE EXCEPTION
            'Unexpected confirmation queue structure: old %, new %',
            v_old_count,
            v_new_count;
    END IF;

    v_original := substring(v_definition FROM v_old_pattern);

    -- Replace only the queue INSERT prefix and its date expression.
    -- Preserve the existing generation upsert, receipt, and safeguards.
    v_updated := replace(
        v_definition,
        v_original,
        btrim(v_replacement)
    );

    SELECT count(*)
    INTO v_old_count
    FROM regexp_matches(v_updated, v_old_pattern, 'g');

    SELECT count(*)
    INTO v_new_count
    FROM regexp_matches(v_updated, v_new_pattern, 'g');

    IF v_old_count <> 0 OR v_new_count <> 1 THEN
        RAISE EXCEPTION
            'Confirmation queue replacement failed validation';
    END IF;

    EXECUTE v_updated;
END;
$migration$;

COMMIT;