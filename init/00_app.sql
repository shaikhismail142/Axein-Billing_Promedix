-- Create role if missing (allowed inside DO)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'axeindb') THEN
    CREATE ROLE axeindb WITH LOGIN PASSWORD 'axeindbpass';
  END IF;
END
$$;

-- Create database if missing (MUST NOT be inside DO)
SELECT 'CREATE DATABASE axeindb OWNER axeindb'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'axeindb')
\gexec

GRANT ALL PRIVILEGES ON DATABASE axeindb TO axeindb;
