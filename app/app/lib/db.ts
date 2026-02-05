import { Pool } from "pg";

/**
 * Prefer DATABASE_URL when present (Render/Heroku/etc).
 * Otherwise fall back to docker-compose defaults:
 *   host=db user=app password=app db=app
 */

const connString = process.env.DATABASE_URL;

export const pool = connString
  ? new Pool({ connectionString: connString, max: 10 })
  : new Pool({
      host: process.env.PGHOST || process.env.DB_HOST || "db",
      port: Number(process.env.PGPORT || 5432),
      user: process.env.PGUSER || "app",
      password: process.env.PGPASSWORD || "app",
      database: process.env.PGDATABASE || "app",
      max: 10,
    });

/** Minimal pg-like type (avoids TS 'Pool' type namespace issues) */
type PgLike = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[] }>;
  connect?: () => Promise<{
    query: (text: string, params?: any[]) => Promise<{ rows: any[] }>;
    release: () => void;
  }>;
};

/** Return the shared pool as a pg-like object */
export function getDb(): PgLike {
  return pool as unknown as PgLike;
}

// Optional ping for health checks
export async function ping() {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}
