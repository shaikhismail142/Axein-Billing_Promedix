-- Optional but recommended for auditability and reporting
CREATE TABLE IF NOT EXISTS stock_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  batch_id uuid REFERENCES batches(id) ON DELETE SET NULL,
  direction text NOT NULL CHECK (direction IN ('IN','OUT','ADJ')),
  qty numeric(18,3) NOT NULL,
  ref_table text,
  ref_id uuid,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_ledger_product ON stock_ledger(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_ledger_batch ON stock_ledger(batch_id);
CREATE INDEX IF NOT EXISTS idx_stock_ledger_created ON stock_ledger(created_at DESC);
