BEGIN;

-- Ensure gen_random_uuid() exists (pgcrypto)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- IMPORTANT:
-- products.id is INTEGER in this project, so stock_ledger.product_id MUST be INTEGER too.
-- Keep id/ref_id/batch_id as UUID (fine), but do NOT FK batch_id because table name/type can vary across installs.

CREATE TABLE IF NOT EXISTS stock_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id integer NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  batch_id uuid,
  direction text NOT NULL CHECK (direction IN ('IN','OUT','ADJ')),
  qty numeric(18,3) NOT NULL,
  ref_table text,
  ref_id uuid,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Useful indexes
CREATE INDEX IF NOT EXISTS idx_stock_ledger_product_created_at ON stock_ledger (product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_ledger_batch_id ON stock_ledger (batch_id);
CREATE INDEX IF NOT EXISTS idx_stock_ledger_ref ON stock_ledger (ref_table, ref_id);

COMMIT;
