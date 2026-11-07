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
-- 7. Atomic invoice-line and evidence insertion
-- ============================================================
--
-- Only the privileged server role may execute this function.
--
-- All invoice items and evidence records are inserted
-- within the same PostgreSQL transaction.
--
-- If any insertion fails, PostgreSQL rolls back
-- the entire function call.
--
-- The application must authenticate source proofs
-- before supplying evidence records.

CREATE OR REPLACE FUNCTION
public.save_invoice_lines_with_evidence(
    p_restaurant_id uuid,
    p_invoice_id uuid,
    p_lines jsonb,
    p_evidence jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $function$
DECLARE
    v_restaurant_id uuid;
    v_line_count integer;
    v_evidence_count integer;
BEGIN

    -- Validate required inputs.

    IF p_restaurant_id IS NULL
       OR p_invoice_id IS NULL
       OR p_lines IS NULL
       OR jsonb_typeof(p_lines) <> 'array'
       OR jsonb_array_length(p_lines) = 0
       OR p_evidence IS NULL
       OR jsonb_typeof(p_evidence) <> 'array'
    THEN
        RAISE EXCEPTION
            'Invalid invoice persistence request';
    END IF;

    -- Verify invoice ownership.

    SELECT restaurant_id
    INTO v_restaurant_id
    FROM public.invoices
    WHERE id = p_invoice_id
    FOR UPDATE;

    IF NOT FOUND
       OR v_restaurant_id IS DISTINCT FROM p_restaurant_id
    THEN
        RAISE EXCEPTION
            'Invoice does not belong to restaurant';
    END IF;

    -- Reject malformed or duplicate line identities.

    IF EXISTS (
        SELECT 1
        FROM jsonb_array_elements(p_lines) AS item
        WHERE item->>'id' IS NULL
           OR item->>'invoice_id' IS DISTINCT FROM
              p_invoice_id::text
    ) THEN
        RAISE EXCEPTION
            'Invalid invoice line identity';
    END IF;

    IF (
        SELECT COUNT(*)
        FROM jsonb_array_elements(p_lines)
    ) <> (
        SELECT COUNT(DISTINCT item->>'id')
        FROM jsonb_array_elements(p_lines) AS item
    ) THEN
        RAISE EXCEPTION
            'Duplicate invoice line identity';
    END IF;

    -- Insert the invoice items.
    --
    -- Only explicitly recognized fields are persisted.

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
        COALESCE(l.reviewed, FALSE),
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
    FROM jsonb_to_recordset(p_lines) AS l (
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

    -- Insert authenticated evidence.
    --
    -- The evidence ownership trigger independently
    -- checks each invoice-item relationship.
    --
    -- The unique source fingerprint prevents replay.

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
    FROM jsonb_to_recordset(p_evidence) AS e (
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

    RETURN jsonb_build_object(
        'success', TRUE,
        'invoice_id', p_invoice_id,
        'lines_saved', v_line_count,
        'evidence_saved', v_evidence_count
    );

END;
$function$;

-- Do not expose the transactional writer
-- to browser-authenticated database roles.

REVOKE ALL ON FUNCTION
public.save_invoice_lines_with_evidence(
    uuid,
    uuid,
    jsonb,
    jsonb
)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
public.save_invoice_lines_with_evidence(
    uuid,
    uuid,
    jsonb,
    jsonb
)
TO service_role;

COMMIT;