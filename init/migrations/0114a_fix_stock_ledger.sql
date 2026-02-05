DO $$
BEGIN
  IF to_regclass('public.stock_ledger') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_stock_ledger_product_created_at ON stock_ledger (product_id, created_at DESC)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_stock_ledger_batch_id ON stock_ledger (batch_id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_stock_ledger_ref ON stock_ledger (ref_table, ref_id)';
  END IF;
END
$$;
