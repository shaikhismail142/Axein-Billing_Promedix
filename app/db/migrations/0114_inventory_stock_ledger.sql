-- Optional but recommended for auditability and reporting
-- Canonical schema (INT product_id) to match products(id)
CREATE TABLE IF NOT EXISTS stock_ledger (
  id            BIGSERIAL PRIMARY KEY,
  product_id    INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  movement_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  ref_type      TEXT NOT NULL,            -- 'purchase','sale','adjustment','return'
  ref_id        TEXT,
  qty_change    NUMERIC(14,3) NOT NULL,   -- +in / -out
  balance_qty   NUMERIC(14,3) NOT NULL DEFAULT 0,
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_ledger_prod ON stock_ledger(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_ledger_date ON stock_ledger(movement_date);
