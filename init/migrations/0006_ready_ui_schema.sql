-- Customers
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename='customers') THEN
    CREATE TABLE customers(
      id        SERIAL PRIMARY KEY,
      name      TEXT NOT NULL,
      phone     TEXT,
      gstin     TEXT,
      address   TEXT,
      city      TEXT,
      state     TEXT,
      pincode   TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE INDEX idx_customers_name ON customers USING gin (to_tsvector('simple', coalesce(name,'')));
    CREATE INDEX idx_customers_phone ON customers (phone);
  END IF;
END $$;

-- Sales (Invoices)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename='sales') THEN
    CREATE TABLE sales(
      id          SERIAL PRIMARY KEY,
      invoice_no  TEXT UNIQUE NOT NULL,
      customer_id INT REFERENCES customers(id),
      subtotal    NUMERIC(12,2) NOT NULL DEFAULT 0,
      tax_total   NUMERIC(12,2) NOT NULL DEFAULT 0,
      roundoff    NUMERIC(12,2) NOT NULL DEFAULT 0,
      total       NUMERIC(12,2) NOT NULL DEFAULT 0,
      created_at  TIMESTAMPTZ DEFAULT now()
    );
    CREATE INDEX idx_sales_created ON sales (created_at DESC);
  END IF;
END $$;

-- Sales Items
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename='sale_items') THEN
    CREATE TABLE sale_items(
      id            SERIAL PRIMARY KEY,
      sale_id       INT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
      product_id    INT REFERENCES products(id),
      name          TEXT NOT NULL,
      gst_slab      INT NOT NULL DEFAULT 18,
      qty           NUMERIC(12,3) NOT NULL,
      unit_price    NUMERIC(12,2) NOT NULL,
      discount_pct  NUMERIC(6,2) NOT NULL DEFAULT 0,
      taxable       NUMERIC(12,2) NOT NULL DEFAULT 0,
      tax           NUMERIC(12,2) NOT NULL DEFAULT 0,
      total         NUMERIC(12,2) NOT NULL DEFAULT 0
    );
    CREATE INDEX idx_sale_items_sale ON sale_items (sale_id);
  END IF;
END $$;

-- Payments
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename='sale_payments') THEN
    CREATE TABLE sale_payments(
      id       SERIAL PRIMARY KEY,
      sale_id  INT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
      method   TEXT NOT NULL,             -- cash / upi / card / bank / split
      amount   NUMERIC(12,2) NOT NULL,
      ref      TEXT
    );
    CREATE INDEX idx_sale_payments_sale ON sale_payments (sale_id);
  END IF;
END $$;

-- Settings (business profile)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename='settings') THEN
    CREATE TABLE settings(
      id         SERIAL PRIMARY KEY,
      key        TEXT UNIQUE NOT NULL,
      value_json JSONB NOT NULL DEFAULT '{}'::jsonb
    );
    INSERT INTO settings(key, value_json) VALUES
      ('business', jsonb_build_object(
        'name','Your Shop Name',
        'address','Street, City',
        'phone','0000000000',
        'gstin','',
        'invoice_prefix','INV',
        'state_code','27',
        'signature_name','Owner Name',
        'signature_title','Proprietor',
        'signature_image_url',''
      ));
  END IF;
END $$;

-- Stock value view (for dashboard)
CREATE OR REPLACE VIEW v_stock_value AS
SELECT
  COALESCE(SUM(COALESCE(selling_price,0) * COALESCE(stock,0)),0)::NUMERIC(14,2) AS stock_value
FROM products;
