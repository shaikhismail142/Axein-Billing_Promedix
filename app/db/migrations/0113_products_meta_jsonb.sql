-- 0113_products_meta_jsonb.sql
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS meta JSONB NOT NULL DEFAULT '{}'::jsonb;
