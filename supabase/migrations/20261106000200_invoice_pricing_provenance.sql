-- Step 11: Invoice pricing provenance
--
-- Records whether an invoice line's pricing is supported
-- by verified source information.
--
-- Existing historical records remain "unknown".
-- No existing prices, quantities, or ingredient links
-- are modified.

BEGIN;

ALTER TABLE public.invoice_items
ADD COLUMN IF NOT EXISTS price_verification_status
TEXT NOT NULL DEFAULT 'unknown';

ALTER TABLE public.invoice_items
ADD COLUMN IF NOT EXISTS price_verification_source
TEXT;

ALTER TABLE public.invoice_items
ADD COLUMN IF NOT EXISTS price_verified_at
TIMESTAMPTZ;

ALTER TABLE public.invoice_items
ADD COLUMN IF NOT EXISTS price_verified_by
UUID;

ALTER TABLE public.invoice_items
ADD COLUMN IF NOT EXISTS price_verification_evidence
JSONB;

-- Only recognized verification states are allowed.

ALTER TABLE public.invoice_items
ADD CONSTRAINT invoice_items_price_verification_status_check
CHECK (
  price_verification_status IN (
    'unknown',
    'verified',
    'unverified'
  )
);

-- A verified price must have supporting evidence.

ALTER TABLE public.invoice_items
ADD CONSTRAINT invoice_items_verified_price_evidence_check
CHECK (
  price_verification_status <> 'verified'
  OR (
    price_verification_source IS NOT NULL
    AND BTRIM(price_verification_source) <> ''
    AND price_verified_at IS NOT NULL
    AND price_verification_evidence IS NOT NULL
    AND JSONB_TYPEOF(price_verification_evidence) = 'object'
    AND price_verification_evidence <> '{}'::jsonb
  )
);

CREATE INDEX IF NOT EXISTS
invoice_items_price_verification_status_idx
ON public.invoice_items (
  price_verification_status
);

COMMIT;