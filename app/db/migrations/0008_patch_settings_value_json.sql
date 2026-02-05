-- Create table if missing
DO $$
BEGIN
  IF to_regclass('public.settings') IS NULL THEN
    CREATE TABLE settings(
      id SERIAL PRIMARY KEY,
      key TEXT UNIQUE NOT NULL,
      value_json JSONB NOT NULL DEFAULT '{}'::jsonb
    );
  END IF;
END $$;

-- Add value_json if the table exists but column is missing
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='settings' AND column_name='value_json') IS FALSE THEN
    ALTER TABLE settings ADD COLUMN value_json JSONB NOT NULL DEFAULT '{}'::jsonb;
  END IF;
END $$;

-- If there was a legacy "value" column, try to copy JSON from it (best-effort)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='settings' AND column_name='value') THEN
    BEGIN
      UPDATE settings SET value_json = value::jsonb WHERE value IS NOT NULL;
    EXCEPTION WHEN others THEN
      -- ignore invalid json in legacy "value"
      NULL;
    END;
  END IF;
END $$;

-- Ensure unique index on key
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_settings_key_unique'
  ) THEN
    CREATE UNIQUE INDEX idx_settings_key_unique ON settings(key);
  END IF;
END $$;

-- *** RELAX legacy NOT NULL on settings.value (so inserts that omit it won't fail) ***
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='settings' AND column_name='value'
  ) THEN
    BEGIN
      EXECUTE 'ALTER TABLE settings ALTER COLUMN value DROP NOT NULL';
    EXCEPTION WHEN others THEN
      -- if it’s already nullable or different type, ignore
      NULL;
    END;
  END IF;
END $$;

-- Seed default business settings if missing
INSERT INTO settings(key, value_json) VALUES
('business', jsonb_build_object(
  'name','Your Shop Name',
  'address','Street, City',
  'phone','',
  'gstin','',
  'invoice_prefix','INV',
  'state_code','27',
  'signature_name','Owner Name',
  'signature_title','Proprietor',
  'signature_image_url',''
))
ON CONFLICT (key) DO NOTHING;
