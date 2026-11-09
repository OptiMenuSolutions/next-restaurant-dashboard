-- Finding #020:
-- Separate authenticated invoice pricing evidence
-- from the selected recipe ingredient association.
--
-- Pricing changes continue to invalidate evidence.
-- Ingredient association changes do not invalidate
-- the underlying supplier-document evidence.
--
-- This migration does not:
--   - Reactivate previously invalidated evidence
--   - Update ingredient prices
--   - Change existing invoice records
--   - Enable automatic ingredient repricing

BEGIN;

CREATE OR REPLACE FUNCTION
public.invalidate_invoice_supported_price_evidence()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN

    -- Evidence authenticates the original invoice
    -- pricing information, not the selected recipe
    -- ingredient association.
    --
    -- Changes to authenticated pricing or product
    -- identity must continue to invalidate evidence.

    IF (
        OLD.quantity IS DISTINCT FROM NEW.quantity
        OR OLD.unit IS DISTINCT FROM NEW.unit
        OR OLD.unit_cost IS DISTINCT FROM NEW.unit_cost
        OR OLD.amount IS DISTINCT FROM NEW.amount
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

COMMIT;