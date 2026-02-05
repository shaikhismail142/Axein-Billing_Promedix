-- 0114a_fix_stock_ledger.sql (safer, data-aware)
BEGIN;

DO $$
DECLARE
  col_type text := NULL;
  rowcount bigint := 0;
BEGIN
  -- Check if stock_ledger exists and capture type + rowcount
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name='stock_ledger' AND table_schema='public'
  ) THEN
    SELECT data_type
      INTO col_type
      FROM information_schema.columns
     WHERE table_name='stock_ledger'
       AND column_name='product_id'
       AND table_schema='public';

    EXECUTE 'SELECT COUNT(*) FROM stock_ledger' INTO rowcount;
  END IF;

  -- If wrong type and table has data, abort with instruction
  IF col_type ILIKE 'uuid' AND rowcount > 0 THEN
    RAISE EXCEPTION 'stock_ledger.product_id is UUID and table has % rows. Aborting to avoid data loss. Please run a mapped migration to convert UUID->INTEGER or export/import.', rowcount;
  END IF;

  -- If wrong type and table empty (or table missing), rebuild
  IF col_type ILIKE 'uuid' AND rowcount = 0 THEN
    RAISE NOTICE 'Rebuilding empty stock_ledger with INTEGER product_id…';
    DROP TABLE IF EXISTS stock_ledger;  -- no CASCADE needed; it’s empty
  END IF;
END$$;

-- Create the canonical schema (idempotent)
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

COMMIT;
