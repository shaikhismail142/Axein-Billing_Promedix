-- Safe schema upgrade with IF NOT EXISTS guards

-- Categories table
CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add missing product columns (for richer UI/features)
ALTER TABLE products ADD COLUMN IF NOT EXISTS hsn_code TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS gst_slab NUMERIC(5,2) DEFAULT 18; -- %
ALTER TABLE products ADD COLUMN IF NOT EXISTS cost_price NUMERIC(12,2) DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS unit TEXT DEFAULT 'pcs';
ALTER TABLE products ADD COLUMN IF NOT EXISTS brand TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS category_id INT REFERENCES categories(id);
ALTER TABLE products ADD COLUMN IF NOT EXISTS reorder_level INT DEFAULT 10;
ALTER TABLE products ADD COLUMN IF NOT EXISTS notes TEXT;

-- If category text exists and category_id is null, seed categories and backfill once
DO $$
BEGIN
  -- seed few default categories
  INSERT INTO categories(name) VALUES
    ('plumbing'), ('sanitary'), ('mirror'), ('other')
  ON CONFLICT DO NOTHING;

  -- backfill category_id from products.category text if possible
  IF EXISTS (SELECT 1 FROM information_schema.columns 
             WHERE table_name='products' AND column_name='category') THEN
    UPDATE products p
    SET category_id = c.id
    FROM categories c
    WHERE p.category_id IS NULL AND lower(p.category) = lower(c.name);
  END IF;
END $$;

-- Customers (minimal)
CREATE TABLE IF NOT EXISTS customers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  gstin TEXT,
  address TEXT,
  state TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Sales
CREATE TABLE IF NOT EXISTS sales (
  id BIGSERIAL PRIMARY KEY,
  invoice_no TEXT,
  customer_id INT REFERENCES customers(id),
  invoice_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  taxable_value NUMERIC(12,2) DEFAULT 0,
  cgst NUMERIC(12,2) DEFAULT 0,
  sgst NUMERIC(12,2) DEFAULT 0,
  igst NUMERIC(12,2) DEFAULT 0,
  discount_total NUMERIC(12,2) DEFAULT 0,
  round_off NUMERIC(12,2) DEFAULT 0,
  grand_total NUMERIC(12,2) DEFAULT 0,
  meta JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sale_items (
  id BIGSERIAL PRIMARY KEY,
  sale_id BIGINT REFERENCES sales(id) ON DELETE CASCADE,
  product_id INT REFERENCES products(id),
  name TEXT NOT NULL,
  hsn_code TEXT,
  gst_slab NUMERIC(5,2) DEFAULT 18,
  qty NUMERIC(12,3) NOT NULL,
  unit TEXT DEFAULT 'pcs',
  unit_price NUMERIC(12,2) NOT NULL,
  discount_pct NUMERIC(6,2) DEFAULT 0,
  taxable NUMERIC(12,2) DEFAULT 0,
  cgst NUMERIC(12,2) DEFAULT 0,
  sgst NUMERIC(12,2) DEFAULT 0,
  igst NUMERIC(12,2) DEFAULT 0,
  total NUMERIC(12,2) DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sale_payments (
  id BIGSERIAL PRIMARY KEY,
  sale_id BIGINT REFERENCES sales(id) ON DELETE CASCADE,
  method TEXT NOT NULL, -- cash, upi, card, bank, split
  amount NUMERIC(12,2) NOT NULL
);

-- Simple settings table for business profile
-- Canonical column is value_json (jsonb)
CREATE TABLE IF NOT EXISTS settings (
  id SERIAL PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  value_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- If an older schema had `value` instead of `value_json`, migrate it
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'settings' AND column_name = 'value'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'settings' AND column_name = 'value_json'
  ) THEN
    ALTER TABLE settings ADD COLUMN value_json JSONB;
    UPDATE settings SET value_json = COALESCE(value, '{}'::jsonb);
    ALTER TABLE settings ALTER COLUMN value_json SET DEFAULT '{}'::jsonb;
    ALTER TABLE settings ALTER COLUMN value_json SET NOT NULL;
    ALTER TABLE settings DROP COLUMN value;
  END IF;
END $$;

-- Views
CREATE OR REPLACE VIEW v_stock_on_hand AS
SELECT p.id AS product_id, p.name, p.sku, COALESCE(p.stock,0) AS qty_on_hand
FROM products p;

-- Seed sample settings if missing (use value_json)
INSERT INTO settings(key, value_json)
VALUES
('business_profile', jsonb_build_object(
  'shop_name','Your Shop Name',
  'address','Your Address',
  'gstin','YOURGSTIN1234Z5',
  'phone','+91-9999999999',
  'invoice_prefix','INV/2025-26/'
))
ON CONFLICT (key) DO NOTHING;

-- Ensure default categories exist
INSERT INTO categories(name) VALUES ('plumbing'),('sanitary'),('mirror'),('other')
ON CONFLICT DO NOTHING;
