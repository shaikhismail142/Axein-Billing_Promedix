-- Lightweight notification center
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL,            -- near_expiry | expired | low_stock | backup_failed | license_warning | ...
  severity text NOT NULL CHECK (severity IN ('info','warning','critical')),
  title text NOT NULL,
  message text,
  link_url text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_read boolean NOT NULL DEFAULT false,
  audience text NOT NULL DEFAULT 'all',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(is_read) WHERE is_read=false;
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);
