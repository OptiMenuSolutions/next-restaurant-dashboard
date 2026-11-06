-- Step 11: Verified dish-cost calculation safeguard
--
-- Preserves the database function installed during Step 10.
--
-- Prevents estimated unit conversions from producing
-- financially verified dish costs.
--
-- Does not update existing restaurant, invoice,
-- ingredient, or menu-item records.

BEGIN;

CREATE OR REPLACE FUNCTION public.calculate_dish_cost(
  p_dish_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
  dish public.menu_items%rowtype;
  part record;
  conversion jsonb;
  total numeric := 0;
  issues jsonb := '[]'::jsonb;
  estimated boolean := false;
  line_count integer := 0;
BEGIN
  SELECT *
  INTO dish
  FROM public.menu_items
  WHERE id = p_dish_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  FOR part IN
    WITH recipe AS (
      SELECT
        ci.ingredient_id,
        ci.quantity,
        ci.unit
      FROM public.menu_item_components c
      JOIN public.component_ingredients ci
        ON ci.component_id = c.id
      WHERE c.menu_item_id = p_dish_id

      UNION ALL

      SELECT
        f.ingredient_id,
        f.quantity,
        NULL::text
      FROM public.menu_item_ingredients f
      WHERE f.menu_item_id = p_dish_id
        AND NOT EXISTS (
          SELECT 1
          FROM public.menu_item_components c
          WHERE c.menu_item_id = p_dish_id
        )
    )
    SELECT
      r.*,
      g.name,
      g.unit AS price_unit,
      g.last_price,
      g.is_estimated,
      g.price_status,
      g.price_approved_at,
      g.restaurant_id AS ingredient_restaurant
    FROM recipe r
    LEFT JOIN public.ingredients g
      ON g.id = r.ingredient_id
  LOOP
    line_count := line_count + 1;

    IF part.ingredient_restaurant
      IS DISTINCT FROM dish.restaurant_id
    THEN
      issues := issues || jsonb_build_array(
        'Unlinked or inaccessible ingredient'
      );
      CONTINUE;
    END IF;

    IF part.quantity = 0 THEN
      CONTINUE;
    END IF;

    IF part.quantity IS NULL
      OR part.quantity < 0
      OR part.quantity::text IN (
        'NaN',
        'Infinity',
        '-Infinity'
      )
      OR part.last_price IS NULL
      OR part.last_price < 0
      OR part.last_price::text IN (
        'NaN',
        'Infinity',
        '-Infinity'
      )
      OR part.price_status = 'needs_review'
      OR (
        part.is_estimated IS DISTINCT FROM FALSE
        AND part.price_approved_at IS NULL
      )
    THEN
      issues := issues || jsonb_build_array(
        'Missing or unapproved price/recipe data: ' ||
        COALESCE(part.name, 'Unlinked ingredient')
      );
      CONTINUE;
    END IF;

    conversion := public.om_cost_quantity(
      part.ingredient_id,
      part.quantity,
      COALESCE(
        NULLIF(BTRIM(part.unit), ''),
        part.price_unit
      ),
      part.price_unit
    );

    IF conversion IS NULL THEN
      issues := issues || jsonb_build_array(
        'Missing or conflicting conversion: ' ||
        part.name || ' (' ||
        COALESCE(part.unit, 'missing') || ' -> ' ||
        COALESCE(part.price_unit, 'missing') || ')'
      );
      CONTINUE;
    END IF;

    -- Estimated unit conversions must not authorize
    -- a financially verified dish cost.
    --
    -- Covers:
    -- - Approximate density conversions
    -- - AI-generated conversion factors
    -- - Linked default conversions marked estimated

    IF COALESCE(
      (conversion->>'estimated')::boolean,
      TRUE
    ) THEN
      issues := issues || jsonb_build_array(
        'Unverified conversion requires approval: ' ||
        part.name || ' (' ||
        COALESCE(part.unit, 'missing') || ' -> ' ||
        COALESCE(part.price_unit, 'missing') || ')'
      );
      CONTINUE;
    END IF;

    total := total
      + (conversion->>'quantity')::numeric
      * part.last_price;

    estimated := estimated
      OR (conversion->>'estimated')::boolean
      OR COALESCE(part.is_estimated, FALSE);
  END LOOP;

  IF line_count = 0 THEN
    issues := issues || jsonb_build_array(
      'No recipe ingredients'
    );
  END IF;

  IF jsonb_array_length(issues) > 0 THEN
    RETURN jsonb_build_object(
      'ready', FALSE,
      'issues', issues
    );
  END IF;

  RETURN jsonb_build_object(
    'ready', TRUE,
    'cost', ROUND(total, 2),
    'estimated', estimated
  );
END;
$function$;

COMMIT;