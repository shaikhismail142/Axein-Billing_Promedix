-- Ensure settings table exists (used by Business/Print)
CREATE TABLE IF NOT EXISTS public.settings (
  key text PRIMARY KEY,
  value_json jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- Ensure customers has the fields the UI uses
CREATE TABLE IF NOT EXISTS public.customers (
  id          SERIAL PRIMARY KEY,
  name        text NOT NULL,
  phone       text,
  gstin       text,
  address     text,
  city        text,
  state       text,
  pincode     text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  meta        jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- Ensure products has price + meta jsonb (stock, low_stock_threshold, cost_price, etc.)
CREATE TABLE IF NOT EXISTS public.products (
  id          SERIAL PRIMARY KEY,
  name        text NOT NULL,
  price       numeric(12,2) NOT NULL DEFAULT 0,
  gst_slab    numeric(5,2),
  created_at  timestamptz NOT NULL DEFAULT now(),
  meta        jsonb NOT NULL DEFAULT '{}'::jsonb
);
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS price numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS meta  jsonb         NOT NULL DEFAULT '{}'::jsonb;

-- Ensure sales has these totals and meta jsonb (the app reads flags from meta)
CREATE TABLE IF NOT EXISTS public.sales (
  id           BIGSERIAL PRIMARY KEY,
  invoice_no   text,
  customer_id  integer REFERENCES public.customers(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  invoice_date timestamptz,
  subtotal     numeric(12,2) NOT NULL DEFAULT 0,
  tax_total    numeric(12,2) NOT NULL DEFAULT 0,
  roundoff     numeric(12,2) NOT NULL DEFAULT 0,
  total        numeric(12,2) NOT NULL DEFAULT 0,
  meta         jsonb         NOT NULL DEFAULT '{}'::jsonb
);
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS invoice_date timestamptz,
  ADD COLUMN IF NOT EXISTS subtotal     numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_total    numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS roundoff     numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total        numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS meta         jsonb         NOT NULL DEFAULT '{}'::jsonb;

-- Ensure sale_items shape the app expects
CREATE TABLE IF NOT EXISTS public.sale_items (
  id            BIGSERIAL PRIMARY KEY,
  sale_id       bigint NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  name          text NOT NULL,
  gst_slab      numeric(5,2),
  qty           numeric(12,3) NOT NULL DEFAULT 0,
  unit_price    numeric(12,2) NOT NULL DEFAULT 0,
  discount_pct  numeric(6,3)  NOT NULL DEFAULT 0,
  taxable       numeric(12,2) NOT NULL DEFAULT 0,
  tax           numeric(12,2) NOT NULL DEFAULT 0,
  total         numeric(12,2) NOT NULL DEFAULT 0
);

-- Helpful indexes
CREATE INDEX IF NOT EXISTS customers_name_idx ON public.customers (LOWER(name));
CREATE INDEX IF NOT EXISTS products_name_idx  ON public.products  (LOWER(name));
CREATE INDEX IF NOT EXISTS sales_created_at_idx ON public.sales(created_at);
CREATE INDEX IF NOT EXISTS sales_customer_id_idx ON public.sales(customer_id);

-- Seed default business settings if missing (Print header uses this)
INSERT INTO public.settings(key, value_json)
VALUES (
  'business',
  jsonb_build_object(
    'name','Your Shop Name',
    'address','', 'phone','', 'gstin','',
    'signature_name','Owner Name',
    'signature_title','Proprietor',
    'signature_image_url',''
  )
) ON CONFLICT (key) DO NOTHING;

-- =========================
-- Email OTP Activation (single-tenant)
-- =========================

-- Activation status (single-install flag)
CREATE TABLE IF NOT EXISTS public.app_state (
  k TEXT PRIMARY KEY,
  v JSONB NOT NULL
);

INSERT INTO public.app_state (k, v)
SELECT 'activation', jsonb_build_object('ok', false)
WHERE NOT EXISTS (SELECT 1 FROM public.app_state WHERE k='activation');

-- OTP storage
CREATE TABLE IF NOT EXISTS public.otp_verifications (
  id           BIGSERIAL PRIMARY KEY,
  email        TEXT NOT NULL,
  code_hash    TEXT NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  attempts     INT NOT NULL DEFAULT 0,
  consumed     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  requester_ip INET,
  fingerprint  TEXT
);

-- Per-email rate limit (24h window)
CREATE TABLE IF NOT EXISTS public.otp_rate_limits (
  email        TEXT PRIMARY KEY,
  window_start TIMESTAMPTZ NOT NULL,
  count        INT NOT NULL DEFAULT 0
);

-- Helpful indexes
CREATE INDEX IF NOT EXISTS idx_otp_email_created  ON public.otp_verifications (email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_otp_expires        ON public.otp_verifications (expires_at);

-- --- Extra-safe compat to match restore behavior across older DBs ---

-- Some datasets store customer email as a first-class column:
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS email text;

-- sale_items often needs meta/created_at for flexible imports:
ALTER TABLE public.sale_items
  ADD COLUMN IF NOT EXISTS meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();


-- Track when an OTP was actually used
ALTER TABLE public.otp_verifications
  ADD COLUMN IF NOT EXISTS consumed_at timestamptz;

-- Our one-bit activation latch is stored here
CREATE TABLE IF NOT EXISTS public.app_state (
  k TEXT PRIMARY KEY,
  v JSONB NOT NULL
);

-- Seed default if missing
INSERT INTO public.app_state (k, v)
SELECT 'activation', jsonb_build_object('ok', false)
WHERE NOT EXISTS (SELECT 1 FROM public.app_state WHERE k='activation');

