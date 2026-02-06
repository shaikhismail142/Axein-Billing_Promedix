-- 20260206_add_sales_payment_fields.sql
-- Add payment fields to sales (idempotent)

ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS amount_paid    NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pending_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'Pending',
  ADD COLUMN IF NOT EXISTS payment_method TEXT;

-- Backfill amount_paid from meta (if present)
UPDATE sales
SET amount_paid = COALESCE(amount_paid, 0) + COALESCE((meta->>'amount_paid')::numeric, 0)
WHERE (meta->>'amount_paid') IS NOT NULL
  AND (amount_paid IS NULL OR amount_paid = 0);

-- Backfill pending_amount and payment_status
UPDATE sales
SET pending_amount = GREATEST(COALESCE(total, 0) - COALESCE(amount_paid, 0), 0),
    payment_status = CASE
      WHEN COALESCE(amount_paid, 0) >= COALESCE(total, 0) - 0.01 THEN 'Paid'
      WHEN COALESCE(amount_paid, 0) > 0 THEN 'Partial'
      ELSE 'Pending'
    END
WHERE (pending_amount IS NULL OR pending_amount = 0 OR payment_status IS NULL);

