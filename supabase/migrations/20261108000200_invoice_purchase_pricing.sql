-- Preserve supplier purchase-level information separately
-- from ingredient-level invoice costing.
--
-- Existing quantity, unit, and unit_cost columns remain
-- the normalized ingredient-level representation.
--
-- New columns are nullable for historical compatibility.
-- Do not fabricate purchase information for old invoices.

BEGIN;

ALTER TABLE public.invoice_items
    ADD COLUMN IF NOT EXISTS purchase_quantity numeric,
    ADD COLUMN IF NOT EXISTS purchase_unit text,
    ADD COLUMN IF NOT EXISTS purchase_unit_price numeric,
    ADD COLUMN IF NOT EXISTS package_quantity numeric,
    ADD COLUMN IF NOT EXISTS package_unit text,
    ADD COLUMN IF NOT EXISTS package_description text,
    ADD COLUMN IF NOT EXISTS package_validation_status text;

COMMENT ON COLUMN public.invoice_items.purchase_quantity IS
    'Number of supplier purchasing units recorded on the invoice.';

COMMENT ON COLUMN public.invoice_items.purchase_unit IS
    'Supplier purchasing unit, such as case, each, or lb.';

COMMENT ON COLUMN public.invoice_items.purchase_unit_price IS
    'Price per supplier purchasing unit, before conversion into ingredient units.';

COMMENT ON COLUMN public.invoice_items.package_quantity IS
    'Document-supported physical ingredient quantity per purchased unit.';

COMMENT ON COLUMN public.invoice_items.package_unit IS
    'Physical unit represented by package_quantity.';

COMMENT ON COLUMN public.invoice_items.package_description IS
    'Original package description extracted from the supplier invoice.';

COMMENT ON COLUMN public.invoice_items.package_validation_status IS
    'Status of the package quantity verification used during invoice costing.';

COMMIT;