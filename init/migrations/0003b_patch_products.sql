-- Patch existing products table to match current schema expectations
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS hsn            TEXT,
  ADD COLUMN IF NOT EXISTS brand          TEXT,
  ADD COLUMN IF NOT EXISTS unit           TEXT NOT NULL DEFAULT 'pcs',
  ADD COLUMN IF NOT EXISTS gst_slab       INTEGER NOT NULL DEFAULT 18,
  ADD COLUMN IF NOT EXISTS mrp            NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS cost_price     NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS selling_price  NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS opening_stock  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stock          INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reorder_level  INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS location       TEXT,
  ADD COLUMN IF NOT EXISTS notes          TEXT;

-- Helpful indexes (no-ops if already present)
CREATE INDEX IF NOT EXISTS idx_products_name ON products USING gin (to_tsvector('simple', coalesce(name,'')));
CREATE INDEX IF NOT EXISTS idx_products_sku  ON products (sku);
CREATE INDEX IF NOT EXISTS idx_products_cat  ON products (category);
