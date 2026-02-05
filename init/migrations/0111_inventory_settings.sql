-- 0111_inventory_settings.sql
-- Seed/normalize an inventory settings record in settings.value_json

BEGIN;

-- Ensure settings table exists
CREATE TABLE IF NOT EXISTS settings(
  id SERIAL PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  value_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Upsert inventory settings (merge defaults; existing values win)
INSERT INTO settings(key, value_json)
VALUES
('inventory', jsonb_build_object(
  'allow_negative_stock', false,
  'low_stock_threshold_default', 5,
  'reorder_multiplier', 1.5,
  'alert_channels', jsonb_build_array('dashboard')  -- later: 'email','whatsapp'
))
ON CONFLICT (key) DO UPDATE
SET value_json = settings.value_json || EXCLUDED.value_json,
    updated_at = now();

COMMIT;
