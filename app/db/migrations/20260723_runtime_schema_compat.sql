-- Runtime schema compatibility for upgraded and freshly installed systems.
-- This migration is intentionally idempotent because the Windows bootstrap
-- applies dated compatibility migrations on every upgrade.

BEGIN;

ALTER TABLE IF EXISTS products
  ADD COLUMN IF NOT EXISTS meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

ALTER TABLE IF EXISTS sales
  ADD COLUMN IF NOT EXISTS meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pending_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'Pending',
  ADD COLUMN IF NOT EXISTS payment_method TEXT,
  ADD COLUMN IF NOT EXISTS dc_no TEXT;

UPDATE sales
SET amount_paid = COALESCE(
      amount_paid,
      NULLIF(meta->>'amount_paid', '')::numeric,
      0
    ),
    pending_amount = GREATEST(
      COALESCE(total, 0) - COALESCE(
        amount_paid,
        NULLIF(meta->>'amount_paid', '')::numeric,
        0
      ),
      0
    ),
    payment_status = CASE
      WHEN COALESCE(
        amount_paid,
        NULLIF(meta->>'amount_paid', '')::numeric,
        0
      ) >= COALESCE(total, 0) - 0.01 THEN 'Paid'
      WHEN COALESCE(
        amount_paid,
        NULLIF(meta->>'amount_paid', '')::numeric,
        0
      ) > 0 THEN 'Partial'
      ELSE 'Pending'
    END
WHERE payment_status IS NULL
   OR payment_status = ''
   OR pending_amount IS NULL;

DO $$
BEGIN
  IF to_regclass('public.purchases') IS NOT NULL THEN
    ALTER TABLE purchases
      ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(12,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS pending_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'Pending',
      ADD COLUMN IF NOT EXISTS payment_method TEXT;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.sale_payments') IS NULL
     AND to_regclass('public.sales') IS NOT NULL THEN
    CREATE TABLE sale_payments (
      id BIGSERIAL PRIMARY KEY,
      sale_id BIGINT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
      method TEXT NOT NULL,
      amount NUMERIC(12,2) NOT NULL,
      ref TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  ELSIF to_regclass('public.sale_payments') IS NOT NULL THEN
    ALTER TABLE sale_payments
      ADD COLUMN IF NOT EXISTS ref TEXT,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_sale_payments_sale
  ON sale_payments(sale_id);

DO $$
BEGIN
  IF to_regclass('public.quotation_items') IS NOT NULL THEN
    ALTER TABLE quotation_items
      ADD COLUMN IF NOT EXISTS batch_no TEXT,
      ADD COLUMN IF NOT EXISTS exp_date DATE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  title TEXT NOT NULL,
  message TEXT,
  link_url TEXT,
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON notifications(is_read, created_at DESC);

COMMIT;
