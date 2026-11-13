BEGIN;

ALTER TABLE public.restaurants
    ADD COLUMN IF NOT EXISTS operational_timezone text;

COMMENT ON COLUMN public.restaurants.operational_timezone IS
    'Restaurant local IANA time zone for operational calendar dates. '
    'NULL means not configured; do not infer from the server time zone.';

CREATE OR REPLACE FUNCTION
    public.validate_restaurant_operational_timezone()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
BEGIN
    -- Browser clients must use the authenticated settings API so the
    -- setting, audit record, and calculation job are saved together.
    IF TG_OP = 'UPDATE' THEN
        IF current_user IN ('anon', 'authenticated')
           AND NEW.operational_timezone
               IS DISTINCT FROM OLD.operational_timezone
        THEN
            RAISE EXCEPTION
                'Update the restaurant time zone through account settings'
                USING ERRCODE = '42501';
        END IF;

        IF NEW.operational_timezone
           IS DISTINCT FROM OLD.operational_timezone
        THEN
            -- Serialize with inventory commits and invalidate any build
            -- that started before this time-zone change.
            PERFORM pg_catalog.pg_advisory_xact_lock(
                pg_catalog.hashtextextended(
                    'current_inventory:' || NEW.id::text,
                    0
                )
            );

            DELETE FROM public.inventory_build_state
            WHERE restaurant_id = NEW.id;
        END IF;
    END IF;

    -- Existing restaurants may remain unconfigured during rollout.
    IF NEW.operational_timezone IS NULL THEN
        RETURN NEW;
    END IF;

    -- Require a recognized regional time-zone name or explicit UTC.
    -- Abbreviations such as EST do not reliably describe DST rules.
    IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_timezone_names AS z
        WHERE z.name = NEW.operational_timezone
          AND z.name NOT LIKE 'posix/%'
          AND z.name NOT LIKE 'right/%'
          AND (
              z.name = 'UTC'
              OR position('/' IN z.name) > 0
          )
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = '22023',
            MESSAGE = 'Invalid restaurant operational time zone';
    END IF;

    RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION
    public.validate_restaurant_operational_timezone()
FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS
    validate_restaurant_operational_timezone
ON public.restaurants;

CREATE TRIGGER validate_restaurant_operational_timezone
BEFORE INSERT OR UPDATE OF operational_timezone
ON public.restaurants
FOR EACH ROW
EXECUTE FUNCTION public.validate_restaurant_operational_timezone();

-- Backfill only when every connected Shift4 record for a restaurant
-- supplies the same valid time zone. Preserve configured values.
WITH connected_timezones AS (
    SELECT
        c.restaurant_id,
        min(c.shift4_timezone) AS time_zone
    FROM public.pos_connections AS c
    WHERE c.provider = 'shift4'
      AND c.status = 'connected'
    GROUP BY c.restaurant_id
    HAVING count(*) = count(c.shift4_timezone)
       AND count(DISTINCT c.shift4_timezone) = 1
),
valid_timezones AS (
    SELECT c.restaurant_id, c.time_zone
    FROM connected_timezones AS c
    WHERE EXISTS (
        SELECT 1
        FROM pg_catalog.pg_timezone_names AS z
        WHERE z.name = c.time_zone
          AND z.name NOT LIKE 'posix/%'
          AND z.name NOT LIKE 'right/%'
          AND (
              z.name = 'UTC'
              OR position('/' IN z.name) > 0
          )
    )
)
UPDATE public.restaurants AS r
SET operational_timezone = v.time_zone
FROM valid_timezones AS v
WHERE r.id = v.restaurant_id
  AND r.operational_timezone IS NULL;

CREATE TABLE IF NOT EXISTS public.restaurant_timezone_audit (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id uuid NOT NULL
        REFERENCES public.restaurants(id) ON DELETE CASCADE,
    actor_id uuid NOT NULL,
    old_timezone text,
    new_timezone text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.restaurant_timezone_audit
    ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.restaurant_timezone_audit
FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT, INSERT ON public.restaurant_timezone_audit
TO service_role;

CREATE INDEX IF NOT EXISTS restaurant_timezone_audit_restaurant_idx
ON public.restaurant_timezone_audit (
    restaurant_id, created_at
);

CREATE OR REPLACE FUNCTION public.set_restaurant_operational_timezone(
    p_restaurant_id uuid,
    p_actor_id uuid,
    p_expected_timezone text,
    p_timezone text,
    p_queue_calculations boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
    v_restaurant public.restaurants%ROWTYPE;
    v_audit_id uuid;
    v_effective_date date;
BEGIN
    IF p_restaurant_id IS NULL
       OR p_actor_id IS NULL
       OR p_timezone IS NULL
       OR p_queue_calculations IS NULL
    THEN
        RAISE EXCEPTION 'Invalid restaurant time-zone request'
            USING ERRCODE = '22023';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_timezone_names AS z
        WHERE z.name = p_timezone
          AND z.name NOT LIKE 'posix/%'
          AND z.name NOT LIKE 'right/%'
          AND (
              z.name = 'UTC'
              OR position('/' IN z.name) > 0
          )
    ) THEN
        RAISE EXCEPTION 'Invalid restaurant operational time zone'
            USING ERRCODE = '22023';
    END IF;

    PERFORM 1
    FROM public.profiles
    WHERE id = p_actor_id
      AND restaurant_id = p_restaurant_id
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Restaurant access denied'
            USING ERRCODE = '42501';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
            'admin-invoice:' || p_restaurant_id::text,
            0
        )
    );

    SELECT *
    INTO v_restaurant
    FROM public.restaurants
    WHERE id = p_restaurant_id
      AND user_id = p_actor_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Restaurant owner access required'
            USING ERRCODE = '42501';
    END IF;

    -- Ownership is checked before handling an identical retry.
    IF v_restaurant.operational_timezone
       IS NOT DISTINCT FROM p_timezone
    THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', true,
            'changed', false,
            'calculations_queued', false,
            'restaurant', pg_catalog.jsonb_build_object(
                'id', v_restaurant.id,
                'operational_timezone',
                    v_restaurant.operational_timezone
            )
        );
    END IF;

    IF v_restaurant.operational_timezone
       IS DISTINCT FROM p_expected_timezone
    THEN
        RAISE EXCEPTION
            'Restaurant time zone changed; reload before saving'
            USING ERRCODE = '40001';
    END IF;

    -- This is the effective date of a settings change.
    -- It does not supply or alter any invoice delivery date.
    v_effective_date :=
        (pg_catalog.now() AT TIME ZONE p_timezone)::date;

    IF v_restaurant.operational_timezone IS NOT NULL THEN
        v_effective_date := LEAST(
            v_effective_date,
            (
                pg_catalog.now()
                AT TIME ZONE v_restaurant.operational_timezone
            )::date
        );
    END IF;

    UPDATE public.restaurants
    SET operational_timezone = p_timezone
    WHERE id = p_restaurant_id
      AND user_id = p_actor_id;

    INSERT INTO public.restaurant_timezone_audit (
        restaurant_id,
        actor_id,
        old_timezone,
        new_timezone
    )
    VALUES (
        p_restaurant_id,
        p_actor_id,
        v_restaurant.operational_timezone,
        p_timezone
    )
    RETURNING id INTO v_audit_id;

    IF p_queue_calculations IS TRUE THEN
        INSERT INTO public.invoice_calculation_jobs (
            restaurant_id,
            effective_date
        )
        VALUES (
            p_restaurant_id,
            v_effective_date
        )
        ON CONFLICT (restaurant_id)
        DO UPDATE SET
            generation =
                public.invoice_calculation_jobs.generation + 1,
            effective_date = LEAST(
                public.invoice_calculation_jobs.effective_date,
                EXCLUDED.effective_date
            ),
            updated_at = pg_catalog.now();
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'changed', true,
        'audit_id', v_audit_id,
        'calculations_queued', p_queue_calculations,
        'restaurant', pg_catalog.jsonb_build_object(
            'id', v_restaurant.id,
            'operational_timezone', p_timezone
        )
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.set_restaurant_operational_timezone(
    uuid, uuid, text, text, boolean
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.set_restaurant_operational_timezone(
    uuid, uuid, text, text, boolean
) TO service_role;

CREATE OR REPLACE FUNCTION public.restaurant_local_today(
    p_restaurant_id uuid
)
RETURNS date
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
    v_timezone text;
BEGIN
    SELECT operational_timezone
    INTO v_timezone
    FROM public.restaurants
    WHERE id = p_restaurant_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Restaurant not found or inaccessible'
            USING ERRCODE = 'P0002';
    END IF;

    IF v_timezone IS NULL THEN
        RAISE EXCEPTION 'Restaurant time zone is not configured'
            USING ERRCODE = '22023';
    END IF;

    RETURN (
        pg_catalog.clock_timestamp() AT TIME ZONE v_timezone
    )::date;
END;
$function$;

REVOKE ALL ON FUNCTION public.restaurant_local_today(uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.restaurant_local_today(uuid)
TO service_role;

DO $migration$
DECLARE
    v_function regprocedure := to_regprocedure(
        'public.commit_inventory_build(uuid,uuid,jsonb,jsonb)'
    );
    v_definition text;
    v_original text;
    v_updated text;
    v_old_count integer;
    v_new_count integer;

    v_old_pattern text :=
        'v_date[[:space:]]*>[[:space:]]*'
        || '\(clock_timestamp\(\)[[:space:]]+at[[:space:]]+'
        || 'time[[:space:]]+zone[[:space:]]+'
        || '''America/New_York''\)::date';

    v_new_pattern text :=
        'v_date[[:space:]]*>[[:space:]]*'
        || 'public\.restaurant_local_today\(p_restaurant_id\)';
BEGIN
    IF v_function IS NULL THEN
        RAISE EXCEPTION 'Required inventory commit function is missing';
    END IF;

    v_definition := pg_get_functiondef(v_function);

    SELECT count(*)
    INTO v_old_count
    FROM regexp_matches(v_definition, v_old_pattern, 'g');

    SELECT count(*)
    INTO v_new_count
    FROM regexp_matches(v_definition, v_new_pattern, 'g');

    IF v_old_count = 0 AND v_new_count = 1 THEN
        RETURN;
    END IF;

    IF v_old_count <> 1 OR v_new_count <> 0 THEN
        RAISE EXCEPTION
            'Unexpected inventory count-date guard: old %, new %',
            v_old_count,
            v_new_count;
    END IF;

    v_original := substring(v_definition FROM v_old_pattern);

    v_updated := replace(
        v_definition,
        v_original,
        'v_date > public.restaurant_local_today(p_restaurant_id)'
    );

    SELECT count(*)
    INTO v_old_count
    FROM regexp_matches(v_updated, v_old_pattern, 'g');

    SELECT count(*)
    INTO v_new_count
    FROM regexp_matches(v_updated, v_new_pattern, 'g');

    IF v_old_count <> 0 OR v_new_count <> 1 THEN
        RAISE EXCEPTION
            'Inventory count-date replacement failed validation';
    END IF;

    EXECUTE v_updated;
END;
$migration$;

DO $migration$
DECLARE
    v_function regprocedure := to_regprocedure(
        'public.review_inventory_count(uuid,uuid,uuid,date,text)'
    );
    v_definition text;
    v_original text;
    v_updated text;
    v_old_count integer;
    v_new_count integer;

    v_old_pattern text :=
        'p_effective_date[[:space:]]*>[[:space:]]*'
        || '\(current_timestamp[[:space:]]+at[[:space:]]+'
        || 'time[[:space:]]+zone[[:space:]]+'
        || '''America/New_York''\)::date';

    v_new_pattern text :=
        'p_effective_date[[:space:]]*>[[:space:]]*'
        || 'public\.restaurant_local_today\(p_restaurant_id\)';
BEGIN
    IF v_function IS NULL THEN
        RAISE EXCEPTION 'Required inventory review function is missing';
    END IF;

    v_definition := pg_get_functiondef(v_function);

    SELECT count(*)
    INTO v_old_count
    FROM regexp_matches(v_definition, v_old_pattern, 'g');

    SELECT count(*)
    INTO v_new_count
    FROM regexp_matches(v_definition, v_new_pattern, 'g');

    IF v_old_count = 0 AND v_new_count = 1 THEN
        RETURN;
    END IF;

    IF v_old_count <> 1 OR v_new_count <> 0 THEN
        RAISE EXCEPTION
            'Unexpected inventory review-date guard: old %, new %',
            v_old_count,
            v_new_count;
    END IF;

    v_original := substring(v_definition FROM v_old_pattern);

    v_updated := replace(
        v_definition,
        v_original,
        'p_effective_date > public.restaurant_local_today(p_restaurant_id)'
    );

    SELECT count(*)
    INTO v_old_count
    FROM regexp_matches(v_updated, v_old_pattern, 'g');

    SELECT count(*)
    INTO v_new_count
    FROM regexp_matches(v_updated, v_new_pattern, 'g');

    IF v_old_count <> 0 OR v_new_count <> 1 THEN
        RAISE EXCEPTION
            'Inventory review-date replacement failed validation';
    END IF;

    EXECUTE v_updated;
END;
$migration$;

CREATE OR REPLACE FUNCTION public.enforce_waste_confirmation_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
    IF NEW.presumed_qty IS DISTINCT FROM OLD.presumed_qty
       OR NEW.presumed_value IS DISTINCT FROM OLD.presumed_value
    THEN
        RAISE EXCEPTION
            'presumed_qty and presumed_value cannot be modified after creation';
    END IF;

    NEW.confirmed_waste_qty := OLD.confirmed_waste_qty;
    NEW.adjustment_qty := OLD.adjustment_qty;

    IF NEW.status IS DISTINCT FROM OLD.status THEN

        -- Backend expiration records an unanswered prompt.
        -- Preserve the existing response and adjustment fields.
        IF OLD.status = 'pending'
           AND NEW.status = 'expired_unconfirmed'
           AND auth.uid() IS NULL
           AND pg_catalog.current_setting('role', true) = 'service_role'
        THEN
            NEW.confirmed_by := OLD.confirmed_by;
            NEW.confirmed_at := OLD.confirmed_at;
            NEW.days_lasted := OLD.days_lasted;
            RETURN NEW;
        END IF;

        -- The nightly job may reopen a kept confirmation.
        IF OLD.status = 'kept'
           AND NEW.status = 'pending'
           AND auth.uid() IS NULL
        THEN
            NEW.last_asked_date :=
                public.restaurant_local_today(NEW.restaurant_id);

            RETURN NEW;
        END IF;

        IF OLD.status NOT IN ('pending', 'expired_unconfirmed') THEN
            RAISE EXCEPTION
                'this confirmation has already been resolved';
        END IF;

        IF NEW.status = 'pending' THEN
            RAISE EXCEPTION 'invalid confirmation transition';
        END IF;

        -- Owner responses still require authentication.
        IF auth.uid() IS NULL THEN
            RAISE EXCEPTION
                'authentication required to resolve confirmation';
        END IF;

        NEW.confirmed_by := auth.uid();
        NEW.confirmed_at := now();

        IF NEW.status = 'kept' THEN
            NEW.kept_days := OLD.kept_days + 1;

        ELSIF NEW.status IN ('confirmed_wasted', 'confirmed_used') THEN
            -- Preserve the existing modeled-adjustment behavior.
            NEW.adjustment_qty := OLD.presumed_qty;

            IF OLD.delivery_date IS NOT NULL THEN
                NEW.days_lasted :=
                    public.restaurant_local_today(NEW.restaurant_id)
                    - OLD.delivery_date;
            END IF;
        END IF;
    END IF;

    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.maintain_restaurant_waste_confirmations(
    p_restaurant_id uuid,
    p_expiry_window_days integer DEFAULT 3
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
    v_timezone text;
    v_today date;
    v_cutoff date;
    v_reasked integer;
    v_expired integer;
BEGIN
    IF p_restaurant_id IS NULL
       OR p_expiry_window_days IS NULL
       OR p_expiry_window_days < 1
    THEN
        RAISE EXCEPTION 'Invalid waste-confirmation maintenance request'
            USING ERRCODE = '22023';
    END IF;

    -- Keep the configured time zone stable throughout maintenance.
    SELECT operational_timezone
    INTO v_timezone
    FROM public.restaurants
    WHERE id = p_restaurant_id
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Restaurant not found or inaccessible'
            USING ERRCODE = 'P0002';
    END IF;

    IF v_timezone IS NULL THEN
        RAISE EXCEPTION 'Restaurant time zone is not configured'
            USING ERRCODE = '22023';
    END IF;

    v_today := (
        pg_catalog.clock_timestamp() AT TIME ZONE v_timezone
    )::date;

    v_cutoff := v_today - p_expiry_window_days;

    -- Reask on a later local day than the latest known response.
    UPDATE public.waste_confirmations
    SET status = 'pending'
    WHERE restaurant_id = p_restaurant_id
      AND status = 'kept'
      AND COALESCE(
          (confirmed_at AT TIME ZONE v_timezone)::date,
          last_asked_date,
          (created_at AT TIME ZONE v_timezone)::date
      ) < v_today;

    GET DIAGNOSTICS v_reasked = ROW_COUNT;

    -- Retain the existing strict "older than cutoff" date rule.
    UPDATE public.waste_confirmations
    SET status = 'expired_unconfirmed'
    WHERE restaurant_id = p_restaurant_id
      AND status = 'pending'
      AND COALESCE(
          last_asked_date,
          (created_at AT TIME ZONE v_timezone)::date
      ) < v_cutoff;

    GET DIAGNOSTICS v_expired = ROW_COUNT;

    RETURN pg_catalog.jsonb_build_object(
        'restaurant_id', p_restaurant_id,
        'local_today', v_today,
        'reasked', v_reasked,
        'expired', v_expired
    );
END;
$function$;

REVOKE ALL ON FUNCTION
    public.maintain_restaurant_waste_confirmations(uuid, integer)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
    public.maintain_restaurant_waste_confirmations(uuid, integer)
TO service_role;

CREATE TABLE IF NOT EXISTS public.restaurant_shipping_address_audit (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id uuid NOT NULL
        REFERENCES public.restaurants(id) ON DELETE CASCADE,
    actor_id uuid NOT NULL,
    old_address jsonb NOT NULL,
    new_address jsonb NOT NULL,
    old_timezone text,
    new_timezone text NOT NULL,
    resolution_source text NOT NULL
        DEFAULT 'google_geocoding_geo_tz',
    google_place_id text,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (jsonb_typeof(old_address) = 'object'),
    CHECK (jsonb_typeof(new_address) = 'object'),
    CHECK (resolution_source = 'google_geocoding_geo_tz')
);

ALTER TABLE public.restaurant_shipping_address_audit
    ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.restaurant_shipping_address_audit
FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT, INSERT ON public.restaurant_shipping_address_audit
TO service_role;

CREATE INDEX IF NOT EXISTS restaurant_shipping_address_audit_restaurant_idx
ON public.restaurant_shipping_address_audit (restaurant_id, created_at);

CREATE OR REPLACE FUNCTION public.protect_restaurant_shipping_address()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
BEGIN
    IF current_user IN ('anon', 'authenticated') THEN
        IF TG_OP = 'INSERT' THEN
            IF NEW.shipping_address_line1 IS NOT NULL
               OR NEW.shipping_city IS NOT NULL
               OR NEW.shipping_state IS NOT NULL
               OR NEW.shipping_zip IS NOT NULL
            THEN
                RAISE EXCEPTION 'Save the shipping address through account setup'
                    USING ERRCODE = '42501';
            END IF;
        ELSIF ROW(
            NEW.shipping_address_line1, NEW.shipping_city,
            NEW.shipping_state, NEW.shipping_zip
        ) IS DISTINCT FROM ROW(
            OLD.shipping_address_line1, OLD.shipping_city,
            OLD.shipping_state, OLD.shipping_zip
        ) THEN
            RAISE EXCEPTION 'Save the shipping address through account setup'
                USING ERRCODE = '42501';
        END IF;
    END IF;
    RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.protect_restaurant_shipping_address()
FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS protect_restaurant_shipping_address
ON public.restaurants;

CREATE TRIGGER protect_restaurant_shipping_address
BEFORE INSERT OR UPDATE OF
    shipping_address_line1, shipping_city, shipping_state, shipping_zip
ON public.restaurants
FOR EACH ROW
EXECUTE FUNCTION public.protect_restaurant_shipping_address();

CREATE OR REPLACE FUNCTION public.save_restaurant_shipping_address(
    p_restaurant_id uuid,
    p_actor_id uuid,
    p_expected jsonb,
    p_address jsonb,
    p_timezone text,
    p_place_id text,
    p_complete_onboarding boolean DEFAULT false,
    p_queue_calculations boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
    v_restaurant public.restaurants%ROWTYPE;
    v_old_address jsonb;
    v_current jsonb;
    v_key text;
    v_timezone_result jsonb;
    v_audit_id uuid;
    v_changed boolean;
    v_queued boolean := false;
BEGIN
    IF p_restaurant_id IS NULL OR p_actor_id IS NULL
       OR p_timezone IS NULL
       OR p_complete_onboarding IS NULL
       OR p_queue_calculations IS NULL
       OR jsonb_typeof(p_expected) IS DISTINCT FROM 'object'
       OR jsonb_typeof(p_address) IS DISTINCT FROM 'object'
    THEN
        RAISE EXCEPTION 'Invalid shipping address request'
            USING ERRCODE = '22023';
    END IF;

    IF (SELECT count(*) FROM jsonb_object_keys(p_address)) <> 4 THEN
        RAISE EXCEPTION 'Unexpected shipping address fields'
            USING ERRCODE = '22023';
    END IF;

    FOREACH v_key IN ARRAY ARRAY[
        'shipping_address_line1', 'shipping_city',
        'shipping_state', 'shipping_zip'
    ] LOOP
        IF jsonb_typeof(p_address->v_key) IS DISTINCT FROM 'string'
           OR btrim(p_address->>v_key) = ''
           OR (p_address->>v_key) <> btrim(p_address->>v_key)
           OR (p_address->>v_key) ~ '[[:cntrl:]]'
           OR length(p_address->>v_key) >
               (CASE WHEN v_key = 'shipping_address_line1' THEN 200 ELSE 100 END)
        THEN
            RAISE EXCEPTION 'Invalid shipping address field'
                USING ERRCODE = '22023';
        END IF;
    END LOOP;

    IF (p_address->>'shipping_state') NOT IN (
        'AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI',
        'ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN',
        'MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH',
        'OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA',
        'WV','WI','WY','PR','VI','GU','AS','MP'
    ) OR (p_address->>'shipping_zip') !~ '^[0-9]{5}(-[0-9]{4})?$'
       OR (p_place_id IS NOT NULL AND (
           btrim(p_place_id) = '' OR length(p_place_id) > 500
       ))
    THEN
        RAISE EXCEPTION 'Invalid shipping address or place identifier'
            USING ERRCODE = '22023';
    END IF;

    PERFORM 1
    FROM public.profiles
    WHERE id = p_actor_id AND restaurant_id = p_restaurant_id
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Restaurant access denied'
            USING ERRCODE = '42501';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
            'admin-invoice:' || p_restaurant_id::text, 0
        )
    );

    SELECT * INTO v_restaurant
    FROM public.restaurants
    WHERE id = p_restaurant_id AND user_id = p_actor_id
      AND deactivated_at IS NULL
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Active restaurant owner access required'
            USING ERRCODE = '42501';
    END IF;

    v_old_address := jsonb_build_object(
        'shipping_address_line1', v_restaurant.shipping_address_line1,
        'shipping_city', v_restaurant.shipping_city,
        'shipping_state', v_restaurant.shipping_state,
        'shipping_zip', v_restaurant.shipping_zip
    );
    v_current := v_old_address || jsonb_build_object(
        'operational_timezone', v_restaurant.operational_timezone
    );
    v_changed := v_old_address IS DISTINCT FROM p_address
        OR v_restaurant.operational_timezone IS DISTINCT FROM p_timezone;

    -- Check ownership before an identical retry. A retry adds no audit or job.
    IF v_changed THEN
        IF v_current IS DISTINCT FROM p_expected THEN
            RAISE EXCEPTION 'Restaurant address changed; reload before saving'
                USING ERRCODE = '40001';
        END IF;

        -- Reuse the tested timezone audit, queue and build-token safeguards.
        v_timezone_result := public.set_restaurant_operational_timezone(
            p_restaurant_id,
            p_actor_id,
            v_restaurant.operational_timezone,
            p_timezone,
            p_queue_calculations
        );
        v_queued := (v_timezone_result->>'calculations_queued')::boolean;

        UPDATE public.restaurants
        SET shipping_address_line1 = p_address->>'shipping_address_line1',
            shipping_city = p_address->>'shipping_city',
            shipping_state = p_address->>'shipping_state',
            shipping_zip = p_address->>'shipping_zip'
        WHERE id = p_restaurant_id;

        INSERT INTO public.restaurant_shipping_address_audit (
            restaurant_id, actor_id, old_address, new_address,
            old_timezone, new_timezone, google_place_id
        ) VALUES (
            p_restaurant_id, p_actor_id, v_old_address, p_address,
            v_restaurant.operational_timezone, p_timezone, p_place_id
        ) RETURNING id INTO v_audit_id;
    END IF;

    IF p_complete_onboarding THEN
        UPDATE public.restaurants
        SET onboarding_completed_at = COALESCE(onboarding_completed_at, now())
        WHERE id = p_restaurant_id AND onboarding_completed_at IS NULL;
    END IF;

    SELECT * INTO v_restaurant
    FROM public.restaurants
    WHERE id = p_restaurant_id;

    RETURN jsonb_build_object(
        'success', true,
        'changed', v_changed,
        'audit_id', v_audit_id,
        'calculations_queued', v_queued,
        'restaurant', jsonb_build_object(
            'id', v_restaurant.id,
            'shipping_address_line1', v_restaurant.shipping_address_line1,
            'shipping_city', v_restaurant.shipping_city,
            'shipping_state', v_restaurant.shipping_state,
            'shipping_zip', v_restaurant.shipping_zip,
            'operational_timezone', v_restaurant.operational_timezone,
            'onboarding_completed_at', v_restaurant.onboarding_completed_at
        )
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.save_restaurant_shipping_address(
    uuid, uuid, jsonb, jsonb, text, text, boolean, boolean
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.save_restaurant_shipping_address(
    uuid, uuid, jsonb, jsonb, text, text, boolean, boolean
) TO service_role;

-- Initialize legacy accounts whose recorded shipping address is in NJ.
-- NJ has one operational time zone. Do not overwrite configured values.
-- The fixed sample has no shipping address; its NY zone follows the owner's
-- confirmation that current accounts use the NJ restaurant-local calendar.
WITH initialized AS (
    UPDATE public.restaurants AS r
    SET operational_timezone = 'America/New_York'
    WHERE r.operational_timezone IS NULL
      AND (
          (
              upper(btrim(r.shipping_state)) = 'NJ'
              AND NULLIF(btrim(r.shipping_address_line1), '') IS NOT NULL
              AND NULLIF(btrim(r.shipping_city), '') IS NOT NULL
              AND NULLIF(btrim(r.shipping_zip), '') IS NOT NULL
          )
          OR r.id = '00000000-0000-0000-0000-000000000001'::uuid
      )
    RETURNING r.id, r.operational_timezone
)
INSERT INTO public.invoice_calculation_jobs (
    restaurant_id, effective_date
)
SELECT
    id,
    (pg_catalog.now() AT TIME ZONE operational_timezone)::date
FROM initialized
ON CONFLICT (restaurant_id)
DO UPDATE SET
    generation = public.invoice_calculation_jobs.generation + 1,
    effective_date = LEAST(
        public.invoice_calculation_jobs.effective_date,
        EXCLUDED.effective_date
    ),
    updated_at = pg_catalog.now();

COMMIT;