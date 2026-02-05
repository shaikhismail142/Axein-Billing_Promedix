-- 0110_inventory_core.sql
-- Core Inventory: suppliers, purchases, purchase_items, product_batches, stock_movements
-- Safe/idempotent: guarded with IF NOT EXISTS, minimal constraints to fit your current app.

BEGIN;

-- Suppliers (basic CRM for purchases)
CREATE TABLE IF NOT EXISTS suppliers (
  id           BIGSERIAL PRIMARY KEY,
  name         TEXT NOT NULL,
  phone        TEXT,
  email        TEXT,
  gstin        TEXT,
  address      TEXT,
  meta         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_suppliers_name ON suppliers (LOWER(name));

-- Purchases (Draft -> Applied)
CREATE TABLE IF NOT EXISTS purchases (
  id             BIGSERIAL PRIMARY KEY,
  supplier_id    BIGINT REFERENCES suppliers(id) ON DELETE SET NULL,
  bill_no        TEXT,
  bill_date      TIMESTAMPTZ,
  subtotal       NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax_total      NUMERIC(12,2) NOT NULL DEFAULT 0,
  other_charges  NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  grand_total    NUMERIC(12,2) NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','applied')),
  meta           JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_purchases_created ON purchases (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_purchases_supplier ON purchases (supplier_id);

-- Purchase line items (supports inline batch fields)
CREATE TABLE IF NOT EXISTS purchase_items (
  id            BIGSERIAL PRIMARY KEY,
  purchase_id   BIGINT NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  product_id    INT REFERENCES products(id) ON DELETE SET NULL,
  description   TEXT,                          -- fallback if product renamed
  qty           NUMERIC(12,3) NOT NULL CHECK (qty >= 0),
  unit          TEXT DEFAULT 'pcs',
  purchase_rate NUMERIC(12,2) NOT NULL DEFAULT 0,
  gst_slab      NUMERIC(5,2) NOT NULL DEFAULT 0,
  discount_pct  NUMERIC(6,2) NOT NULL DEFAULT 0,
  taxable       NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax           NUMERIC(12,2) NOT NULL DEFAULT 0,
  total         NUMERIC(12,2) NOT NULL DEFAULT 0,

  -- batch/lot (optional inline capture)
  batch_no      TEXT,
  mfg_date      DATE,
  expiry_date   DATE,

  meta          JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_purchase_items_pid ON purchase_items (purchase_id);

-- Product batches/lots (pharmacy & grocery)
CREATE TABLE IF NOT EXISTS product_batches (
  id            BIGSERIAL PRIMARY KEY,
  product_id    INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  batch_no      TEXT,
  mfg_date      DATE,
  expiry_date   DATE,
  purchase_rate NUMERIC(12,2) NOT NULL DEFAULT 0,
  qty           NUMERIC(12,3) NOT NULL DEFAULT 0,
  meta          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Uniqueness: same product + batch number (if provided)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='uniq_product_batches_pid_batch'
  ) THEN
    CREATE UNIQUE INDEX uniq_product_batches_pid_batch
      ON product_batches(product_id, COALESCE(batch_no, ''));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_product_batches_expiry ON product_batches (expiry_date);

-- Stock movements (single source of truth for any delta)
CREATE TABLE IF NOT EXISTS stock_movements (
  id           BIGSERIAL PRIMARY KEY,
  product_id   INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  delta_qty    NUMERIC(12,3) NOT NULL,
  reason       TEXT NOT NULL,        -- 'sale','return','purchase','adjustment','damage','loss','promo','correction'
  ref_type     TEXT,                  -- e.g., 'sale','purchase','adjustment'
  ref_id       BIGINT,
  before_qty   NUMERIC(12,3),
  after_qty    NUMERIC(12,3),
  meta         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stock_movements_prod ON stock_movements (product_id, created_at DESC);

COMMIT;
