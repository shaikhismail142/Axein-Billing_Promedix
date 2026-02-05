-- 00_app.sql (runs in default 'postgres' db during init)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'axeindb') THEN
    CREATE ROLE axeindb WITH LOGIN PASSWORD 'axeindbpass';
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_database WHERE datname = 'axeindb') THEN
    CREATE DATABASE axeindb OWNER axeindb;
  END IF;
END
$$;

GRANT ALL PRIVILEGES ON DATABASE axeindb TO axeindb;
