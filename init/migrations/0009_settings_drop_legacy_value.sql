-- If legacy "value" column exists, try to migrate it then drop it
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='settings' AND column_name='value'
  ) THEN
    -- Best-effort: if "value" looked like JSON, merge it into value_json
    BEGIN
      UPDATE settings
      SET value_json = COALESCE(value_json, '{}'::jsonb) || (value::jsonb)
      WHERE value IS NOT NULL;
    EXCEPTION WHEN others THEN
      -- ignore bad json in "value"
      NULL;
    END;

    -- ensure we can drop it (remove NOT NULL if present), then drop legacy column
    BEGIN
      ALTER TABLE settings ALTER COLUMN value DROP NOT NULL;
    EXCEPTION WHEN others THEN
      NULL;
    END;

    ALTER TABLE settings DROP COLUMN IF EXISTS value;
  END IF;
END $$;

-- Seed default business if missing (now that "value" can't block inserts)
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
