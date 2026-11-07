-- Finding #020: Invoice-supported pricing evidence
--
-- Establishes protected, immutable pricing evidence.
--
-- Does not:
--   - Change existing invoice prices
--   - Update ingredient prices
--   - Recalculate recipe costs
--   - Activate invoice-supported repricing
--
-- Evidence is inserted only after server-side
-- authentication and confirmation.
--
-- Historical invoice items receive no evidence.

BEGIN;

-- ============================================================
-- 1. Evidence table
-- ============================================================

CREATE TABLE IF NOT EXISTS
public.invoice_supported_price_evidence (

    id uuid PRIMARY KEY
        DEFAULT gen_random_uuid(),

    invoice_item_id uuid NOT NULL UNIQUE
        REFERENCES public.invoice_items(id)
        ON DELETE CASCADE,

    invoice_id uuid NOT NULL
        REFERENCES public.invoices(id)
        ON DELETE CASCADE,

    restaurant_id uuid NOT NULL
        REFERENCES public.restaurants(id)
        ON DELETE CASCADE,

    source_type text NOT NULL,

    validation_status text NOT NULL,

    evidence_version integer NOT NULL
        DEFAULT 1,

    source_fingerprint text NOT NULL,

    pricing_fingerprint text NOT NULL,

    evidence jsonb NOT NULL,

    created_at timestamptz NOT NULL
        DEFAULT now(),

    invalidated_at timestamptz,

    invalidation_reason text,

    CONSTRAINT invoice_price_evidence_source_check
        CHECK (
            source_type = 'structured_ocr_table'
        ),

    CONSTRAINT invoice_price_evidence_status_check
        CHECK (
            validation_status =
                'source_table_consistent'
        ),

    CONSTRAINT invoice_price_evidence_version_check
        CHECK (
            evidence_version = 1
        ),

    CONSTRAINT invoice_price_evidence_fingerprint_check
        CHECK (
            source_fingerprint ~ '^[0-9a-f]{64}$'
            AND
            pricing_fingerprint ~ '^[0-9a-f]{64}$'
        ),

    CONSTRAINT invoice_price_evidence_content_check
        CHECK (
            jsonb_typeof(evidence) = 'object'
            AND evidence <> '{}'::jsonb
        ),

    CONSTRAINT invoice_price_evidence_invalidation_check
        CHECK (
            invalidated_at IS NOT NULL
            OR invalidation_reason IS NULL
        )
);

-- ============================================================
-- 2. Indexes
-- ============================================================

CREATE INDEX IF NOT EXISTS
invoice_supported_price_evidence_restaurant_idx
ON public.invoice_supported_price_evidence (
    restaurant_id,
    invoice_id
);

CREATE INDEX IF NOT EXISTS
invoice_supported_price_evidence_active_idx
ON public.invoice_supported_price_evidence (
    invoice_item_id
)
WHERE invalidated_at IS NULL;

-- A signed proof can authorize at most one saved
-- invoice-item evidence record.
--
-- Invalidating evidence does not release its proof
-- for reuse.

CREATE UNIQUE INDEX IF NOT EXISTS
invoice_supported_price_evidence_proof_unique_idx
ON public.invoice_supported_price_evidence (
    source_fingerprint
);

-- ============================================================
-- 3. Access restrictions
-- ============================================================

ALTER TABLE public.invoice_supported_price_evidence
ENABLE ROW LEVEL SECURITY;

REVOKE ALL
ON public.invoice_supported_price_evidence
FROM PUBLIC, anon, authenticated;

-- No browser-facing policies are created.
-- Application writes must use the protected server role.

-- ============================================================
-- 4. Validate ownership before evidence insertion
-- ============================================================

CREATE OR REPLACE FUNCTION
public.validate_invoice_supported_price_evidence()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    actual_invoice_id uuid;
    actual_restaurant_id uuid;
BEGIN

    SELECT
        ii.invoice_id,
        i.restaurant_id
    INTO
        actual_invoice_id,
        actual_restaurant_id
    FROM public.invoice_items ii
    JOIN public.invoices i
        ON i.id = ii.invoice_id
    WHERE ii.id = NEW.invoice_item_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'Invoice evidence references an unknown invoice item';
    END IF;

    IF actual_invoice_id IS DISTINCT FROM NEW.invoice_id
       OR actual_restaurant_id IS DISTINCT FROM NEW.restaurant_id
    THEN
        RAISE EXCEPTION
            'Invoice evidence ownership mismatch';
    END IF;

    IF NEW.invalidated_at IS NOT NULL
       OR NEW.invalidation_reason IS NOT NULL
    THEN
        RAISE EXCEPTION
            'New invoice evidence must begin active';
    END IF;

    RETURN NEW;

END;
$$;

DROP TRIGGER IF EXISTS
validate_invoice_supported_price_evidence_trigger
ON public.invoice_supported_price_evidence;

CREATE TRIGGER
validate_invoice_supported_price_evidence_trigger
BEFORE INSERT
ON public.invoice_supported_price_evidence
FOR EACH ROW
EXECUTE FUNCTION
public.validate_invoice_supported_price_evidence();

-- ============================================================
-- 5. Prevent evidence modification or reactivation
-- ============================================================

CREATE OR REPLACE FUNCTION
public.protect_invoice_supported_price_evidence()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN

    -- Evidence contents and ownership are immutable.
    IF
        OLD.invoice_item_id IS DISTINCT FROM NEW.invoice_item_id
        OR OLD.invoice_id IS DISTINCT FROM NEW.invoice_id
        OR OLD.restaurant_id IS DISTINCT FROM NEW.restaurant_id
        OR OLD.source_type IS DISTINCT FROM NEW.source_type
        OR OLD.validation_status IS DISTINCT FROM NEW.validation_status
        OR OLD.evidence_version IS DISTINCT FROM NEW.evidence_version
        OR OLD.source_fingerprint IS DISTINCT FROM NEW.source_fingerprint
        OR OLD.pricing_fingerprint IS DISTINCT FROM NEW.pricing_fingerprint
        OR OLD.evidence IS DISTINCT FROM NEW.evidence
        OR OLD.created_at IS DISTINCT FROM NEW.created_at
    THEN
        RAISE EXCEPTION
            'Authenticated invoice evidence cannot be modified';
    END IF;

    -- Previously invalidated evidence cannot be restored.
    IF OLD.invalidated_at IS NOT NULL THEN
        RAISE EXCEPTION
            'Invalidated invoice evidence cannot be modified';
    END IF;

    -- Only a transition from active to invalidated is allowed.
    IF NEW.invalidated_at IS NULL
       OR NEW.invalidation_reason IS NULL
       OR BTRIM(NEW.invalidation_reason) = ''
    THEN
        RAISE EXCEPTION
            'Evidence updates must explicitly invalidate the record';
    END IF;

    RETURN NEW;

END;
$$;

DROP TRIGGER IF EXISTS
protect_invoice_supported_price_evidence_trigger
ON public.invoice_supported_price_evidence;

CREATE TRIGGER
protect_invoice_supported_price_evidence_trigger
BEFORE UPDATE
ON public.invoice_supported_price_evidence
FOR EACH ROW
EXECUTE FUNCTION
public.protect_invoice_supported_price_evidence();

-- ============================================================
-- 6. Invalidate evidence when invoice lines change
-- ============================================================

CREATE OR REPLACE FUNCTION
public.invalidate_invoice_supported_price_evidence()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN

    IF (
        OLD.quantity IS DISTINCT FROM NEW.quantity
        OR OLD.unit IS DISTINCT FROM NEW.unit
        OR OLD.unit_cost IS DISTINCT FROM NEW.unit_cost
        OR OLD.amount IS DISTINCT FROM NEW.amount
        OR OLD.ingredient_id IS DISTINCT FROM NEW.ingredient_id
        OR OLD.invoice_id IS DISTINCT FROM NEW.invoice_id
        OR OLD.item_name IS DISTINCT FROM NEW.item_name
    ) THEN

        UPDATE public.invoice_supported_price_evidence
        SET
            invalidated_at = now(),
            invalidation_reason = 'invoice_line_modified'
        WHERE invoice_item_id = OLD.id
          AND invalidated_at IS NULL;

    END IF;

    RETURN NEW;

END;
$$;

DROP TRIGGER IF EXISTS
invalidate_invoice_supported_price_evidence_trigger
ON public.invoice_items;

CREATE TRIGGER
invalidate_invoice_supported_price_evidence_trigger
AFTER UPDATE
ON public.invoice_items
FOR EACH ROW
EXECUTE FUNCTION
public.invalidate_invoice_supported_price_evidence();

-- ============================================================
-- 7. Persistent confirmation request identities
-- ============================================================

CREATE TABLE IF NOT EXISTS
public.invoice_confirmation_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    restaurant_id uuid NOT NULL
        REFERENCES public.restaurants(id),

    request_id text NOT NULL,

    request_fingerprint text NOT NULL,

    invoice_id uuid NOT NULL
        REFERENCES public.invoices(id) ON DELETE CASCADE,

    result jsonb NOT NULL,

    created_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT invoice_confirmation_request_unique
        UNIQUE (restaurant_id, request_id),

    CONSTRAINT invoice_confirmation_request_id_check
        CHECK (
            length(request_id) BETWEEN 16 AND 128
        ),

    CONSTRAINT invoice_confirmation_fingerprint_check
        CHECK (
            request_fingerprint ~ '^[0-9a-f]{64}$'
        )
);

ALTER TABLE public.invoice_confirmation_requests
ENABLE ROW LEVEL SECURITY;

REVOKE ALL
ON public.invoice_confirmation_requests
FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 8. Atomic invoice confirmation
-- ============================================================

CREATE OR REPLACE FUNCTION
public.save_invoice_confirmation_transactional(
    p_restaurant_id uuid,
    p_request_id text,
    p_request_fingerprint text,
    p_append_to_invoice_id uuid,
    p_invoice jsonb,
    p_files jsonb,
    p_lines jsonb,
    p_evidence jsonb,
    p_queue_calculations boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $function$

DECLARE
    v_invoice_id uuid;
    v_existing public.invoice_confirmation_requests%ROWTYPE;
    v_result jsonb;
    v_line_count integer;
    v_evidence_count integer;
    v_file_count integer;
    v_next_page integer;
BEGIN

    -- --------------------------------------------------------
    -- Validate request envelope
    -- --------------------------------------------------------

    IF p_restaurant_id IS NULL
       OR p_request_id IS NULL
       OR length(p_request_id) NOT BETWEEN 16 AND 128
       OR p_request_fingerprint IS NULL
       OR p_request_fingerprint !~ '^[0-9a-f]{64}$'
       OR p_invoice IS NULL
       OR pg_catalog.jsonb_typeof(p_invoice) <> 'object'
       OR p_files IS NULL
       OR pg_catalog.jsonb_typeof(p_files) <> 'array'
       OR p_lines IS NULL
       OR pg_catalog.jsonb_typeof(p_lines) <> 'array'
       OR pg_catalog.jsonb_array_length(p_lines) = 0
       OR p_evidence IS NULL
       OR pg_catalog.jsonb_typeof(p_evidence) <> 'array'
    THEN
        RAISE EXCEPTION
            'Invalid invoice confirmation request';
    END IF;

    -- Serialize retries of the same confirmation request.

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
            'invoice-confirmation:' ||
            p_restaurant_id::text || ':' ||
            p_request_id,
            0
        )
    );

    -- --------------------------------------------------------
    -- Idempotency: return an existing successful result
    -- --------------------------------------------------------

    SELECT *
    INTO v_existing
    FROM public.invoice_confirmation_requests
    WHERE restaurant_id = p_restaurant_id
      AND request_id = p_request_id;

    IF FOUND THEN

        IF v_existing.request_fingerprint
           IS DISTINCT FROM p_request_fingerprint
        THEN
            RAISE EXCEPTION
                'Confirmation request ID was reused with different contents';
        END IF;

        RETURN v_existing.result ||
            pg_catalog.jsonb_build_object(
                'replayed', true
            );

    END IF;

    -- --------------------------------------------------------
    -- Create or lock the parent invoice
    -- --------------------------------------------------------

    IF p_append_to_invoice_id IS NOT NULL THEN

        v_invoice_id := p_append_to_invoice_id;

        -- Serialize appends to the same invoice.

        PERFORM pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended(
                'invoice-append:' ||
                p_restaurant_id::text || ':' ||
                v_invoice_id::text,
                0
            )
        );

        PERFORM 1
        FROM public.invoices
        WHERE id = v_invoice_id
          AND restaurant_id = p_restaurant_id
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION
                'Append target does not belong to restaurant';
        END IF;

    ELSE

        v_invoice_id := (p_invoice->>'id')::uuid;

        IF v_invoice_id IS NULL THEN
            RAISE EXCEPTION
                'New invoice ID is required';
        END IF;

        INSERT INTO public.invoices (
            id,
            restaurant_id,
            supplier,
            number,
            date,
            amount,
            non_food_total,
            tax_amount,
            fees_amount,
            file_url,
            ocr_text,
            reviewed,
            is_sample
        )
        VALUES (
            v_invoice_id,
            p_restaurant_id,
            p_invoice->>'supplier',
            p_invoice->>'number',
            (p_invoice->>'date')::date,
            (p_invoice->>'amount')::numeric,
            (p_invoice->>'non_food_total')::numeric,
            (p_invoice->>'tax_amount')::numeric,
            (p_invoice->>'fees_amount')::numeric,
            p_invoice->>'file_url',
            p_invoice->>'ocr_text',
            false,
            false
        );

    END IF;

    -- --------------------------------------------------------
    -- Validate invoice-line identities
    -- --------------------------------------------------------

    IF EXISTS (
        SELECT 1
        FROM pg_catalog.jsonb_array_elements(p_lines) AS item
        WHERE item->>'id' IS NULL
           OR item->>'invoice_id'
              IS DISTINCT FROM v_invoice_id::text
    ) THEN
        RAISE EXCEPTION
            'Invoice line identity mismatch';
    END IF;

    IF (
        SELECT COUNT(*)
        FROM pg_catalog.jsonb_array_elements(p_lines)
    ) <> (
        SELECT COUNT(DISTINCT item->>'id')
        FROM pg_catalog.jsonb_array_elements(p_lines) AS item
    ) THEN
        RAISE EXCEPTION
            'Duplicate invoice line IDs';
    END IF;

    -- --------------------------------------------------------
    -- Save file references
    -- --------------------------------------------------------

    SELECT COALESCE(MAX(page_number), 0) + 1
    INTO v_next_page
    FROM public.invoice_files
    WHERE invoice_id = v_invoice_id;

    INSERT INTO public.invoice_files (
        invoice_id,
        file_url,
        page_number
    )
    SELECT
        v_invoice_id,
        f.file_url,
        v_next_page + f.ordinality::integer - 1
    FROM pg_catalog.jsonb_array_elements_text(
        p_files
    ) WITH ORDINALITY AS f(file_url, ordinality);

    GET DIAGNOSTICS v_file_count = ROW_COUNT;

    -- --------------------------------------------------------
    -- Save invoice items
    -- --------------------------------------------------------

    INSERT INTO public.invoice_items (
        id,
        invoice_id,
        item_name,
        quantity,
        unit,
        unit_cost,
        amount,
        ingredient_name_normalized,
        category,
        ingredient_id,
        reviewed,
        original_quantity,
        original_price,
        price_verification_status,
        price_verification_source,
        price_verified_at,
        price_verified_by,
        price_verification_evidence,
        match_candidates
    )
    SELECT
        l.id,
        l.invoice_id,
        l.item_name,
        l.quantity,
        l.unit,
        l.unit_cost,
        l.amount,
        l.ingredient_name_normalized,
        l.category,
        l.ingredient_id,
        COALESCE(l.reviewed, false),
        l.original_quantity,
        l.original_price,
        COALESCE(
            l.price_verification_status,
            'unknown'
        ),
        l.price_verification_source,
        l.price_verified_at,
        l.price_verified_by,
        l.price_verification_evidence,
        l.match_candidates
    FROM pg_catalog.jsonb_to_recordset(p_lines) AS l (
        id uuid,
        invoice_id uuid,
        item_name text,
        quantity numeric,
        unit text,
        unit_cost numeric,
        amount numeric,
        ingredient_name_normalized text,
        category text,
        ingredient_id uuid,
        reviewed boolean,
        original_quantity numeric,
        original_price numeric,
        price_verification_status text,
        price_verification_source text,
        price_verified_at timestamptz,
        price_verified_by uuid,
        price_verification_evidence jsonb,
        match_candidates jsonb
    );

    GET DIAGNOSTICS v_line_count = ROW_COUNT;

    -- --------------------------------------------------------
    -- Validate evidence references
    -- --------------------------------------------------------

    IF EXISTS (
        SELECT 1
        FROM pg_catalog.jsonb_array_elements(p_evidence) AS e
        WHERE e->>'invoice_id'
              IS DISTINCT FROM v_invoice_id::text
           OR e->>'restaurant_id'
              IS DISTINCT FROM p_restaurant_id::text
           OR NOT EXISTS (
                SELECT 1
                FROM pg_catalog.jsonb_array_elements(
                    p_lines
                ) AS l
                WHERE l->>'id' =
                    e->>'invoice_item_id'
           )
    ) THEN
        RAISE EXCEPTION
            'Evidence ownership or line identity mismatch';
    END IF;

    -- --------------------------------------------------------
    -- Save authenticated source evidence
    -- --------------------------------------------------------

    INSERT INTO public.invoice_supported_price_evidence (
        invoice_item_id,
        invoice_id,
        restaurant_id,
        source_type,
        validation_status,
        evidence_version,
        source_fingerprint,
        pricing_fingerprint,
        evidence
    )
    SELECT
        e.invoice_item_id,
        e.invoice_id,
        e.restaurant_id,
        e.source_type,
        e.validation_status,
        e.evidence_version,
        e.source_fingerprint,
        e.pricing_fingerprint,
        e.evidence
    FROM pg_catalog.jsonb_to_recordset(
        p_evidence
    ) AS e (
        invoice_item_id uuid,
        invoice_id uuid,
        restaurant_id uuid,
        source_type text,
        validation_status text,
        evidence_version integer,
        source_fingerprint text,
        pricing_fingerprint text,
        evidence jsonb
    );

    GET DIAGNOSTICS v_evidence_count = ROW_COUNT;

    -- --------------------------------------------------------
    -- Queue recoverable invoice calculations
    -- --------------------------------------------------------
    --
    -- The job is committed atomically with the invoice.
    --
    -- Failed transactions do not create jobs.
    -- Successful retries return the existing receipt
    -- without incrementing the job generation again.

    IF p_queue_calculations THEN

        INSERT INTO public.invoice_calculation_jobs (
            restaurant_id,
            effective_date
        )
        VALUES (
            p_restaurant_id,
            COALESCE(
                (p_invoice->>'date')::date,
                CURRENT_DATE
            )
        )
        ON CONFLICT (restaurant_id)
        DO UPDATE SET
            generation =
                public.invoice_calculation_jobs.generation + 1,
            effective_date =
                LEAST(
                    COALESCE(
                        public.invoice_calculation_jobs.effective_date,
                        EXCLUDED.effective_date
                    ),
                    EXCLUDED.effective_date
                ),
            updated_at = NOW();

    END IF;

    -- --------------------------------------------------------
    -- Save the successful confirmation receipt
    -- --------------------------------------------------------

    v_result := pg_catalog.jsonb_build_object(
        'success', true,
        'invoice_id', v_invoice_id,
        'lines_saved', v_line_count,
        'files_saved', v_file_count,
        'evidence_saved', v_evidence_count,
        'replayed', false
    );

    INSERT INTO public.invoice_confirmation_requests (
        restaurant_id,
        request_id,
        request_fingerprint,
        invoice_id,
        result
    )
    VALUES (
        p_restaurant_id,
        p_request_id,
        p_request_fingerprint,
        v_invoice_id,
        v_result
    );

    RETURN v_result;

END;
$function$;

-- ------------------------------------------------------------
-- Restrict access to the privileged server role
-- ------------------------------------------------------------

REVOKE ALL ON FUNCTION
public.save_invoice_confirmation_transactional(
    uuid,
    text,
    text,
    uuid,
    jsonb,
    jsonb,
    jsonb,
    jsonb,
    boolean
)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
public.save_invoice_confirmation_transactional(
    uuid,
    text,
    text,
    uuid,
    jsonb,
    jsonb,
    jsonb,
    jsonb,
    boolean
)
TO service_role;

COMMIT;