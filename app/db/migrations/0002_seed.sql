-- Sample products (safe to re-run with ON CONFLICT DO NOTHING)
INSERT INTO products(name, sku, category, gst_slab, selling_price, stock, opening_stock, reorder_level)
VALUES
  ('PVC Elbow 1/2"',      'PVC-ELB-12', 'plumbing', 18,  35.00, 120, 120, 20),
  ('Angle Valve Chrome',  'ANG-VAL-CHR','sanitary', 18, 210.00,  45,  45, 10),
  ('Bathroom Mirror 24x18','MIR-24x18', 'mirror',   12, 950.00,  10,  10,  2),
  ('PTFE Tape',           'PTFE-001',   'plumbing', 18,  18.00, 300, 300, 50)
ON CONFLICT DO NOTHING;
