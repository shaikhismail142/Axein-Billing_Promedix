-- Add updated_at to products for "last edited" display
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- Backfill from created_at if available
UPDATE products
SET updated_at = COALESCE(updated_at, created_at, now());
