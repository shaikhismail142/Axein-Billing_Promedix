-- 0108_trial_activation.sql
-- Purpose: Seed/normalize the activation record used for trial & licensing
-- Notes:
-- - Ensures a stable device_id is created once and preserved across updates
-- - Adds/keeps default fields without overwriting any existing values
-- - Safe to run multiple times

BEGIN;

-- Required for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Make sure settings.key is unique (idempotent)
CREATE UNIQUE INDEX IF NOT EXISTS idx_settings_key ON settings(key);

-- Insert activation record if missing, else merge defaults without overriding existing values.
-- Merge strategy: (defaults || existing)  => existing wins
WITH defaults AS (
  SELECT jsonb_build_object(
    'is_licensed',      to_jsonb(false),
    'license_key',      to_jsonb(NULL::text),
    'license_payload',  to_jsonb(NULL::jsonb),
    'activated_at',     to_jsonb(NULL::timestamptz),
    'trial_started_at', to_jsonb(NULL::timestamptz),
    'trial_expires_at', to_jsonb(NULL::timestamptz),
    'trial_allowed',    to_jsonb(true),
    'device_id',        to_jsonb(gen_random_uuid()::text)
  ) AS j
)
INSERT INTO settings (key, value_json)
SELECT 'activation', j FROM defaults
ON CONFLICT (key) DO UPDATE
SET value_json =
  (
    -- Build a defaults object but preserve existing device_id if present
    jsonb_build_object(
      'is_licensed',      to_jsonb(false),
      'license_key',      to_jsonb(NULL::text),
      'license_payload',  to_jsonb(NULL::jsonb),
      'activated_at',     to_jsonb(NULL::timestamptz),
      'trial_started_at', to_jsonb(NULL::timestamptz),
      'trial_expires_at', to_jsonb(NULL::timestamptz),
      'trial_allowed',    to_jsonb(true),
      'device_id',        to_jsonb(COALESCE(settings.value_json->>'device_id', gen_random_uuid()::text))
    )
  ) || settings.value_json
WHERE settings.key = 'activation';

-- (Optional) Helpful CHECKs to keep types sane (no-op if already exist)
-- You can comment these out if your settings table disallows per-key constraints.
-- DO $$ BEGIN
--   ALTER TABLE settings
--   ADD CONSTRAINT settings_activation_is_object
--   CHECK (key <> 'activation' OR jsonb_typeof(value_json) = 'object');
-- EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMIT;
