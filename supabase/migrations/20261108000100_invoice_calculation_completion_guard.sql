-- Finding #020
-- Protect invoice recalculation completion against
-- invalid generations and expired worker leases.

BEGIN;

CREATE OR REPLACE FUNCTION public.finish_invoice_calculations(
    p_restaurant_id uuid,
    p_lease uuid,
    p_generation bigint,
    p_error text
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$

    UPDATE public.invoice_calculation_jobs
    SET
        completed_generation = CASE
            WHEN p_error IS NULL THEN
                GREATEST(
                    completed_generation,
                    LEAST(p_generation, generation)
                )
            ELSE completed_generation
        END,

        last_error = LEFT(p_error, 3000),
        finished_at = NOW(),
        lease_token = NULL,
        lease_until = NULL

    WHERE restaurant_id = p_restaurant_id
      AND lease_token = p_lease
      AND lease_until > NOW()
      AND p_generation IS NOT NULL
      AND p_generation >= completed_generation;

$function$;

COMMIT;