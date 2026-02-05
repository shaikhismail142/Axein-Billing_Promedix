-- 0112_inventory_adjustments.sql
-- Inventory Adjustments (header + lines), optimized for posting & audit
BEGIN;

CREATE TABLE IF NOT EXISTS inventory_adjustments (
  id            BIGSERIAL PRIMARY KEY,
  adjustment_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  status        TEXT NOT NULL DEFAULT 'draft', -- 'draft' | 'posted' | 'reversed'
  reason        TEXT NOT NULL DEFAULT 'adjustment',
  reference     TEXT,
  notes         TEXT,
  created_by    TEXT,                          -- optional: email/uid
  approved_by   TEXT,                          -- optional: email/uid
  meta          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  posted_at     TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS inventory_adjustment_items (
  id             BIGSERIAL PRIMARY KEY,
  adjustment_id  BIGINT NOT NULL REFERENCES inventory_adjustments(id) ON DELETE CASCADE,
  product_id     BIGINT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  delta_qty      NUMERIC NOT NULL,             -- + adds stock / - removes stock
  unit_cost      NUMERIC,                      -- optional valuation
  notes          TEXT,
  meta           JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_inv_adj_date      ON inventory_adjustments (adjustment_date DESC);
CREATE INDEX IF NOT EXISTS idx_inv_adj_status    ON inventory_adjustments (status);
CREATE INDEX IF NOT EXISTS idx_inv_adj_reason    ON inventory_adjustments (reason);
CREATE INDEX IF NOT EXISTS idx_inv_adj_createdat ON inventory_adjustments (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_inv_adj_items_adj ON inventory_adjustment_items (adjustment_id);
CREATE INDEX IF NOT EXISTS idx_inv_adj_items_pid ON inventory_adjustment_items (product_id);

COMMIT;
