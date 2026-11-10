
-- Step 6G: Authenticate and persist V2 catch-weight
-- invoice evidence alongside existing V1 evidence.
--
-- This migration:
--   - Preserves existing V1 evidence
--   - Allows authenticated V2 evidence
--   - Rejects mismatched version/source/status combinations
--   - Does not enable invoice-supported repricing
--   - Does not update ingredient prices
--
-- Applied to production Supabase on 2026-11-10.
-- Retained here for reproducible schema history.

BEGIN;

ALTER TABLE public.invoice_supported_price_evidence
    DROP CONSTRAINT IF EXISTS invoice_price_evidence_source_check,
    DROP CONSTRAINT IF EXISTS invoice_price_evidence_status_check,
    DROP CONSTRAINT IF EXISTS invoice_price_evidence_version_check;

ALTER TABLE public.invoice_supported_price_evidence
    ADD CONSTRAINT invoice_price_evidence_source_check
    CHECK (
        (
            evidence_version = 1
            AND source_type = 'structured_ocr_table'
            AND validation_status = 'source_table_consistent'
        )
        OR
        (
            evidence_version = 2
            AND source_type = 'independent_ocr_evidence'
            AND validation_status = 'source_charge_verified'
        )
    );

COMMIT;
