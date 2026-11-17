-- Minimal snapshot of the inspected POS tables for isolated PostgreSQL tests.

CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;

CREATE TABLE public.pos_connections (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  restaurant_id uuid NOT NULL,
  provider text NOT NULL,
  status text DEFAULT 'pending'::text NOT NULL,
  access_token text,
  refresh_token text,
  merchant_id text,
  locations jsonb,
  expires_at timestamp with time zone,
  last_synced_at timestamp with time zone,
  last_error text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  shift4_location_id integer,
  shift4_merchant_id text,
  shift4_timezone text,
  token_refreshed_at timestamp with time zone,
  token_error text,
  PRIMARY KEY (id)
);

CREATE TABLE public.pos_sales (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  restaurant_id uuid NOT NULL,
  sale_date date NOT NULL,
  item_name text NOT NULL,
  category text,
  quantity_sold numeric(10,2) DEFAULT 0,
  revenue numeric(10,2) DEFAULT 0,
  unit_price numeric(10,2),
  hour_of_day integer,
  day_of_week text,
  voids integer DEFAULT 0,
  comps numeric(10,2) DEFAULT 0,
  pos_system text,
  created_at timestamp with time zone DEFAULT now(),
  upload_session_id uuid,
  refunds integer DEFAULT 0 NOT NULL,
  PRIMARY KEY (id)
);

CREATE TABLE public.pos_tickets (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  restaurant_id uuid NOT NULL,
  pos_system text NOT NULL,
  external_ticket_id text NOT NULL,
  ticket_type text,
  opened_at timestamp with time zone,
  closed_at timestamp with time zone,
  business_date date,
  raw jsonb,
  synced_at timestamp with time zone DEFAULT now() NOT NULL,
  order_number text,
  order_type text,
  revenue_center text,
  table_name text,
  guest_count integer,
  opened_by_ref text,
  closed_by_ref text,
  void_reason text,
  total_items numeric,
  total_discounts numeric,
  total_tax numeric,
  total_tips numeric,
  total_grand numeric,
  PRIMARY KEY (id)
);

CREATE TABLE public.pos_ticket_lines (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  ticket_id uuid NOT NULL,
  restaurant_id uuid NOT NULL,
  external_line_id text NOT NULL,
  item_name text,
  category text,
  line_type text,
  quantity numeric,
  unit_price numeric,
  item_amount numeric,
  discount_amount numeric,
  is_non_sales_revenue boolean DEFAULT false,
  added_at timestamp with time zone,
  item_ref text,
  void_reason text,
  modifier_amount numeric,
  modifiers jsonb DEFAULT '[]'::jsonb NOT NULL,
  discounts jsonb DEFAULT '[]'::jsonb NOT NULL,
  special_requests jsonb DEFAULT '[]'::jsonb NOT NULL,
  PRIMARY KEY (id)
);

ALTER TABLE public.pos_connections ADD UNIQUE (restaurant_id, provider);

ALTER TABLE public.pos_tickets ADD UNIQUE (restaurant_id, pos_system, external_ticket_id);

ALTER TABLE public.pos_ticket_lines ADD UNIQUE (ticket_id, external_line_id);

ALTER TABLE public.pos_ticket_lines ADD FOREIGN KEY (ticket_id) REFERENCES public.pos_tickets(id) ON DELETE CASCADE;

ALTER TABLE public.pos_connections ENABLE ROW LEVEL SECURITY;

GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
