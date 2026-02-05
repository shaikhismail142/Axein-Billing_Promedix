-- Products (minimal core)
CREATE TABLE IF NOT EXISTS products (
  id             SERIAL PRIMARY KEY,
  name           TEXT NOT NULL,
  sku            TEXT UNIQUE,
  hsn            TEXT,
  category       TEXT NOT NULL DEFAULT 'other', -- plumbing/sanitary/mirror/other
  brand          TEXT,
  unit           TEXT NOT NULL DEFAULT 'pcs',
  gst_slab       INTEGER NOT NULL DEFAULT 18,   -- 0/5/12/18/28
  mrp            NUMERIC(12,2),
  cost_price     NUMERIC(12,2),
  selling_price  NUMERIC(12,2),
  opening_stock  INTEGER NOT NULL DEFAULT 0,
  stock          INTEGER NOT NULL DEFAULT 0,
  reorder_level  INTEGER NOT NULL DEFAULT 5,
  location       TEXT,
  notes          TEXT,
  created_at     TIMESTAMPTZ DEFAULT now()
);

-- Useful indexes
CREATE INDEX IF NOT EXISTS idx_products_name ON products USING gin (to_tsvector('simple', coalesce(name,'') ));
CREATE INDEX IF NOT EXISTS idx_products_sku  ON products (sku);
CREATE INDEX IF NOT EXISTS idx_products_cat  ON products (category);
