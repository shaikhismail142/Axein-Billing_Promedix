-- Minimal products table to get the UI & API working quickly
CREATE TABLE IF NOT EXISTS products (
  id             SERIAL PRIMARY KEY,
  name           TEXT NOT NULL,
  sku            TEXT UNIQUE,
  category       TEXT CHECK (category IN ('plumbing','sanitary','mirror','other')) DEFAULT 'other',
  selling_price  NUMERIC(12,2) NOT NULL DEFAULT 0,
  stock          INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Sample data (edit as you like)
INSERT INTO products (name, sku, category, selling_price, stock) VALUES
  ('PVC Elbow 1/2"', 'PVC-ELB-12', 'plumbing', 35.00, 120),
  ('Angle Valve Chrome', 'ANG-VAL-CHR', 'sanitary', 210.00, 45),
  ('Bathroom Mirror 24x18', 'MIR-24x18', 'mirror', 950.00, 10),
  ('PTFE Tape', 'PTFE-001', 'plumbing', 18.00, 300)
ON CONFLICT (sku) DO NOTHING;
