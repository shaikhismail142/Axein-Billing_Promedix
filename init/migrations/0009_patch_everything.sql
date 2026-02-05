-- Ensure SETTINGS has value_json (and relax any legacy NOT NULL on "value")
DO $$
BEGIN
  IF to_regclass('public.settings') IS NULL THEN
    CREATE TABLE settings(
      id SERIAL PRIMARY KEY,
      key TEXT UNIQUE NOT NULL,
      value_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  END IF;
END $$;

ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS value_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='settings' AND column_name='value'
  ) THEN
    BEGIN
      EXECUTE 'ALTER TABLE settings ALTER COLUMN value DROP NOT NULL';
    EXCEPTION WHEN undefined_column THEN
      NULL;
    END;
  END IF;
END $$;

-- unique index on key
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_settings_key_unique'
  ) THEN
    CREATE UNIQUE INDEX idx_settings_key_unique ON settings(key);
  END IF;
END $$;

-- seed business settings if missing
INSERT INTO settings(key, value_json) VALUES
('business', jsonb_build_object(
  'name','Your Shop Name',
  'address','Street, City',
  'phone','',
  'gstin','',
  'invoice_prefix','INV',
  'state_code','27',
  'signature_name','Owner Name',
  'signature_title','Proprietor',
  'signature_image_url',''
))
ON CONFLICT (key) DO NOTHING;

--------------------------------------------------------------------------------
-- CUSTOMERS: add missing columns used by UI/invoice page
--------------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.customers') IS NULL THEN
    CREATE TABLE customers(
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT,
      gstin TEXT,
      address TEXT,
      city TEXT,
      state TEXT,
      pincode TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  END IF;
END $$;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS phone   TEXT,
  ADD COLUMN IF NOT EXISTS gstin   TEXT,
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS city    TEXT,
  ADD COLUMN IF NOT EXISTS state   TEXT,
  ADD COLUMN IF NOT EXISTS pincode TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

--------------------------------------------------------------------------------
-- SALES: ensure totals + created_at (some DBs had an old sales table)
--------------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.sales') IS NULL THEN
    CREATE TABLE sales(
      id SERIAL PRIMARY KEY,
      invoice_no TEXT UNIQUE NOT NULL,
      customer_id INT REFERENCES customers(id),
      subtotal   NUMERIC(12,2) NOT NULL DEFAULT 0,
      tax_total  NUMERIC(12,2) NOT NULL DEFAULT 0,
      roundoff   NUMERIC(12,2) NOT NULL DEFAULT 0,
      total      NUMERIC(12,2) NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  END IF;
END $$;

ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS subtotal   NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_total  NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS roundoff   NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total      NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ   DEFAULT now();

-- ensure invoice_no exists & unique (if your legacy table didn’t have it)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='sales' AND column_name='invoice_no'
  ) THEN
    ALTER TABLE sales ADD COLUMN invoice_no TEXT;
    -- Make unique if it isn't already
    IF NOT EXISTS (
      SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='sales_invoice_no_key'
    ) THEN
      CREATE UNIQUE INDEX sales_invoice_no_key ON sales(invoice_no);
    END IF;
  END IF;
END $$;

--------------------------------------------------------------------------------
-- SALE_ITEMS: add missing columns used by /api/sales and invoice pages
--------------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.sale_items') IS NULL THEN
    CREATE TABLE sale_items(
      id SERIAL PRIMARY KEY,
      sale_id INT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
      product_id INT,
      name TEXT NOT NULL,
      gst_slab INT NOT NULL DEFAULT 18,
      qty NUMERIC(12,3) NOT NULL,
      unit_price NUMERIC(12,2) NOT NULL,
      discount_pct NUMERIC(6,2) NOT NULL DEFAULT 0,
      taxable NUMERIC(12,2) NOT NULL DEFAULT 0,
      tax NUMERIC(12,2) NOT NULL DEFAULT 0,
      total NUMERIC(12,2) NOT NULL DEFAULT 0
    );
  END IF;
END $$;

ALTER TABLE sale_items
  ADD COLUMN IF NOT EXISTS sale_id      INT REFERENCES sales(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS product_id   INT,
  ADD COLUMN IF NOT EXISTS name         TEXT,
  ADD COLUMN IF NOT EXISTS gst_slab     INT NOT NULL DEFAULT 18,
  ADD COLUMN IF NOT EXISTS qty          NUMERIC(12,3),
  ADD COLUMN IF NOT EXISTS unit_price   NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS discount_pct NUMERIC(6,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS taxable      NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax          NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total        NUMERIC(12,2) NOT NULL DEFAULT 0;

-- upgrade column types if legacy schema had INT, etc.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sale_items' AND column_name='qty' AND data_type<>'numeric') THEN
    ALTER TABLE sale_items ALTER COLUMN qty TYPE NUMERIC(12,3) USING qty::numeric;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sale_items' AND column_name='unit_price' AND data_type<>'numeric') THEN
    ALTER TABLE sale_items ALTER COLUMN unit_price TYPE NUMERIC(12,2) USING unit_price::numeric;
  END IF;
END $$;

-- not-null safety for critical columns
UPDATE sale_items
SET discount_pct = COALESCE(discount_pct,0),
    taxable      = COALESCE(taxable,0),
    tax          = COALESCE(tax,0),
    total        = COALESCE(total,0);

--------------------------------------------------------------------------------
-- STOCK VALUE VIEW
--------------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.v_stock_value') IS NULL THEN
    CREATE VIEW v_stock_value AS
    SELECT SUM(COALESCE(selling_price,0) * COALESCE(stock,0))::NUMERIC(14,2) AS stock_value FROM products;
  END IF;
END $$;
