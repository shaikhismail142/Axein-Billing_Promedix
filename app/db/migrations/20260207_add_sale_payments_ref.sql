-- 20260207_add_sale_payments_ref.sql
-- Add ref column for payment reference (idempotent)

ALTER TABLE sale_payments
  ADD COLUMN IF NOT EXISTS ref TEXT;
