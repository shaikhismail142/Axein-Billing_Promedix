-- Make sure required columns exist on sales
ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS subtotal  NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS roundoff  NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total     NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ  DEFAULT now();

-- Optional: backfill total if there are rows missing it
UPDATE sales
SET total = COALESCE(total, 0) + COALESCE(subtotal, 0) + COALESCE(tax_total, 0)
WHERE total IS NULL;
