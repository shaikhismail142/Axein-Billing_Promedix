-- 20260206_add_purchase_payment_fields.sql
-- Add payment tracking columns to purchases (idempotent)

ALTER TABLE purchases
  ADD COLUMN IF NOT EXISTS amount_paid    NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pending_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'Pending',
  ADD COLUMN IF NOT EXISTS payment_method TEXT;

-- Backfill amount_paid from meta.paid or meta.amount_paid if present
UPDATE purchases
SET amount_paid = COALESCE((meta->>'amount_paid')::numeric, 0)
WHERE (meta->>'amount_paid') IS NOT NULL
  AND (amount_paid IS NULL OR amount_paid = 0);

UPDATE purchases
SET amount_paid = COALESCE(grand_total, total_amount, 0)
WHERE (meta->>'paid')::boolean = true
  AND (amount_paid IS NULL OR amount_paid = 0);

-- Backfill pending_amount and payment_status
UPDATE purchases
SET pending_amount = GREATEST(COALESCE(grand_total, total_amount, 0) - COALESCE(amount_paid, 0), 0),
    payment_status = CASE
      WHEN COALESCE(amount_paid, 0) >= COALESCE(grand_total, total_amount, 0) - 0.01 THEN 'Paid'
      WHEN COALESCE(amount_paid, 0) > 0 THEN 'Partial'
      ELSE 'Pending'
    END
WHERE (pending_amount IS NULL OR pending_amount = 0 OR payment_status IS NULL);

