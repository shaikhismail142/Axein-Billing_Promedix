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

DO $$
DECLARE
  has_grand boolean;
  has_total boolean;
  total_expr text := '0';
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='purchases' AND column_name='grand_total'
  ) INTO has_grand;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='purchases' AND column_name='total_amount'
  ) INTO has_total;

  IF has_grand THEN
    total_expr := 'grand_total';
  ELSIF has_total THEN
    total_expr := 'total_amount';
  END IF;

  EXECUTE format($f$
    UPDATE purchases
       SET amount_paid = COALESCE(%1$s, 0)
     WHERE (meta->>'paid')::boolean = true
       AND (amount_paid IS NULL OR amount_paid = 0);
  $f$, total_expr);

  -- Backfill pending_amount and payment_status
  EXECUTE format($f$
    UPDATE purchases
       SET pending_amount = GREATEST(COALESCE(%1$s, 0) - COALESCE(amount_paid, 0), 0),
           payment_status = CASE
             WHEN COALESCE(amount_paid, 0) >= COALESCE(%1$s, 0) - 0.01 THEN 'Paid'
             WHEN COALESCE(amount_paid, 0) > 0 THEN 'Partial'
             ELSE 'Pending'
           END
     WHERE (pending_amount IS NULL OR pending_amount = 0 OR payment_status IS NULL);
  $f$, total_expr);
END $$;
