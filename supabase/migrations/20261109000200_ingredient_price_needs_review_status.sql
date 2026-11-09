-- Finding #020:
-- Support ingredients requiring price reverification.
--
-- Existing statuses remain valid:
-- pending, approved, invoice.
--
-- Add needs_review for ingredients whose previous
-- invoice-supported price is no longer verified.
--
-- This migration does not update ingredient records,
-- invoice records, or existing pricing values.

BEGIN;

ALTER TABLE public.ingredients
DROP CONSTRAINT IF EXISTS ingredients_price_status_check;

ALTER TABLE public.ingredients
ADD CONSTRAINT ingredients_price_status_check
CHECK (
    price_status IN (
        'pending',
        'approved',
        'invoice',
        'needs_review'
    )
);

COMMIT;