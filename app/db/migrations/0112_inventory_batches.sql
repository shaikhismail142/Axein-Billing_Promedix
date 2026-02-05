-- 0112_inventory_batches.sql (reconciled)
-- Canonical table: product_batches (INT FKs, names the app expects)
-- Adds useful extra columns from old "batches" without changing app behavior.

DO $$
BEGIN
  IF to_regclass('public.product_batches') IS NULL THEN
    CREATE TABLE product_batches (
      id          SERIAL PRIMARY KEY,
      product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      batch_code  TEXT NOT NULL,
      mfg_date    DATE,
      expiry_date DATE,
      qty         NUMERIC(18,3) NOT NULL DEFAULT 0,

      -- Extras preserved from old 0112:
      cost_price  NUMERIC(18,2),
      mrp         NUMERIC(18,2),
      supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
      meta        JSONB NOT NULL DEFAULT '{}'::jsonb,

      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  ELSE
    -- Ensure columns exist (idempotent)
    ALTER TABLE product_batches
      ADD COLUMN IF NOT EXISTS batch_code  TEXT,
      ADD COLUMN IF NOT EXISTS mfg_date    DATE,
      ADD COLUMN IF NOT EXISTS expiry_date DATE,
      ADD COLUMN IF NOT EXISTS qty         NUMERIC(18,3) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS cost_price  NUMERIC(18,2),
      ADD COLUMN IF NOT EXISTS mrp         NUMERIC(18,2),
      ADD COLUMN IF NOT EXISTS supplier_id INTEGER,
      ADD COLUMN IF NOT EXISTS meta        JSONB NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      ADD COLUMN IF NOT EXISTS updated_at  TIMESTAMPTZ NOT NULL DEFAULT now();

    -- Add supplier FK if missing
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints
      WHERE table_name='product_batches'
        AND constraint_name='product_batches_supplier_id_fkey'
    ) AND EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name='product_batches' AND column_name='supplier_id'
    ) THEN
      ALTER TABLE product_batches
        ADD CONSTRAINT product_batches_supplier_id_fkey
        FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL;
    END IF;
  END IF;
END $$;

-- Indexes (idempotent)
CREATE INDEX IF NOT EXISTS idx_product_batches_prod      ON product_batches(product_id);
CREATE INDEX IF NOT EXISTS idx_product_batches_expiry    ON product_batches(expiry_date);
CREATE INDEX IF NOT EXISTS idx_product_batches_batchcode ON product_batches(batch_code);
CREATE INDEX IF NOT EXISTS idx_product_batches_qty_pos   ON product_batches(product_id) WHERE qty > 0;

-- updated_at trigger (idempotent)
CREATE OR REPLACE FUNCTION set_updated_at_product_batches()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_product_batches_updated_at ON product_batches;
CREATE TRIGGER trg_product_batches_updated_at
BEFORE UPDATE ON product_batches
FOR EACH ROW EXECUTE FUNCTION set_updated_at_product_batches();
