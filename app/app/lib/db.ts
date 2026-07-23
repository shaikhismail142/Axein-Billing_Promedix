import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Pool } from "pg";

type QueryArgs = [text: string, params?: any[]];
type QueryResult = { rows: any[]; rowCount?: number };

type PgLike = {
  query: (...args: QueryArgs) => Promise<QueryResult>;
  connect: () => Promise<PgClientLike>;
  end: () => Promise<void>;
};

type PgClientLike = {
  query: (...args: QueryArgs) => Promise<QueryResult>;
  release: () => void;
};

type PoolLike = {
  query: (...args: QueryArgs) => Promise<QueryResult>;
  connect: () => Promise<PgClientLike>;
  end: () => Promise<void>;
};

type PoolConfigLike = Record<string, any>;

type Candidate = {
  label: string;
  config: PoolConfigLike;
};

type EmbeddedResult = {
  rows?: any[];
  rowCount?: number;
  affectedRows?: number;
};

type EmbeddedDb = {
  query: (text: string, params?: any[]) => Promise<EmbeddedResult>;
  exec?: (text: string) => Promise<unknown>;
  close?: () => Promise<void> | void;
};

const connString = process.env.DATABASE_URL?.trim();
const isDesktopRuntime = process.env.AXEIN_DESKTOP === "1";
const osUser = process.env.USER || process.env.USERNAME || "postgres";

const defaultPort = Number(process.env.PGPORT || "5432");
const explicitPgHost = process.env.PGHOST || process.env.DB_HOST;
const explicitPgUser = process.env.PGUSER || process.env.DB_USER;
const explicitPgPass = process.env.PGPASSWORD || process.env.DB_PASSWORD;
const explicitPgDb = process.env.PGDATABASE || process.env.DB_NAME;

function hasExplicitPgEnv() {
  return ["PGHOST", "PGPORT", "PGUSER", "PGPASSWORD", "PGDATABASE", "DB_HOST", "DB_USER", "DB_PASSWORD", "DB_NAME"].some(
    (key) => Boolean(process.env[key])
  );
}

function isLocalHost(host: string | undefined) {
  if (!host) return true;
  const value = String(host).trim().toLowerCase();
  if (!value) return true;
  return value === "localhost" || value === "127.0.0.1" || value === "::1" || value.startsWith("/");
}

function isLocalDatabaseUrl(connectionString: string) {
  try {
    const u = new URL(connectionString);
    return isLocalHost(u.hostname || u.host);
  } catch {
    return false;
  }
}

function baseConfig(): PoolConfigLike {
  return {
    host: explicitPgHost || (isDesktopRuntime ? "127.0.0.1" : "db"),
    port: defaultPort,
    user: explicitPgUser || "app",
    password: explicitPgPass || "app",
    database: explicitPgDb || "app",
    max: 10,
    connectionTimeoutMillis: 2000,
  };
}

function localFallbackCandidates(): Candidate[] {
  const list: Candidate[] = [];
  const includeSockets = process.platform !== "win32";
  const socketHosts = ["/tmp", "/var/run/postgresql"];

  if (includeSockets) {
    for (const host of socketHosts) {
      list.push({
        label: `local socket ${host} (${osUser}/${osUser})`,
        config: { host, port: 5432, user: osUser, database: osUser, max: 10, connectionTimeoutMillis: 1500 },
      });
      list.push({
        label: `local socket ${host} (${osUser}/postgres)`,
        config: { host, port: 5432, user: osUser, database: "postgres", max: 10, connectionTimeoutMillis: 1500 },
      });
    }
  }

  list.push({
    label: `localhost (${osUser}/${osUser})`,
    config: { host: "127.0.0.1", port: 5432, user: osUser, database: osUser, max: 10, connectionTimeoutMillis: 1500 },
  });
  list.push({
    label: `localhost (${osUser}/postgres)`,
    config: { host: "127.0.0.1", port: 5432, user: osUser, database: "postgres", max: 10, connectionTimeoutMillis: 1500 },
  });
  list.push({
    label: "localhost (postgres/postgres)",
    config: { host: "127.0.0.1", port: 5432, user: "postgres", database: "postgres", max: 10, connectionTimeoutMillis: 1500 },
  });

  return list;
}

function buildCandidates(): Candidate[] {
  const candidates: Candidate[] = [];
  const hasPgEnv = hasExplicitPgEnv();

  if (connString) {
    candidates.push({
      label: "DATABASE_URL",
      config: { connectionString: connString, max: 10, connectionTimeoutMillis: 2500 },
    });
  }

  if (!connString || hasPgEnv) {
    candidates.push({ label: "PG env/default", config: baseConfig() });
  }

  const localByBase = isLocalHost(baseConfig().host as string | undefined);
  const localByUrl = connString ? isLocalDatabaseUrl(connString) : false;
  const shouldTryLocalFallbacks = isDesktopRuntime && (!connString || localByBase || localByUrl);

  if (shouldTryLocalFallbacks) {
    candidates.push(...localFallbackCandidates());
  }

  // Stable ordering with duplicate collapse.
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.label}:${JSON.stringify(candidate.config)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sanitizeError(err: unknown) {
  const e = err as { code?: string; message?: string } | null;
  const code = e?.code ? ` [${e.code}]` : "";
  return `${e?.message || String(err)}${code}`;
}

type RuntimeDbState = {
  activePool: PoolLike | null;
  activeLabel: string | null;
  resolvingPool: Promise<PoolLike> | null;
  embeddedPool: PoolLike | null;
  resolvingEmbeddedPool: Promise<PoolLike> | null;
};

function runtimeDbState(): RuntimeDbState {
  const g = globalThis as typeof globalThis & {
    __AXEIN_DB_STATE__?: RuntimeDbState;
  };
  if (!g.__AXEIN_DB_STATE__) {
    g.__AXEIN_DB_STATE__ = {
      activePool: null,
      activeLabel: null,
      resolvingPool: null,
      embeddedPool: null,
      resolvingEmbeddedPool: null,
    };
  }
  return g.__AXEIN_DB_STATE__;
}

function shouldUseEmbeddedFallback() {
  return isDesktopRuntime || process.env.AXEIN_USE_EMBEDDED_DB === "1";
}

async function pathExists(p: string) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function candidateMigrationsDirs() {
  const list: string[] = [];
  const explicit = process.env.AXEIN_MIGRATIONS_DIR?.trim();
  if (explicit) list.push(path.resolve(explicit));

  const cwd = process.cwd();
  list.push(path.join(cwd, "db", "migrations"));
  list.push(path.resolve(cwd, "..", "db", "migrations"));
  list.push(path.resolve(cwd, "..", "..", "db", "migrations"));
  list.push(path.resolve(cwd, "..", "..", "..", "db", "migrations"));

  const seen = new Set<string>();
  return list.filter((p) => {
    if (seen.has(p)) return false;
    seen.add(p);
    return true;
  });
}

async function resolveMigrationsDir() {
  for (const dir of candidateMigrationsDirs()) {
    if (await pathExists(dir)) return dir;
  }
  throw new Error(`Desktop migrations directory not found. Tried: ${candidateMigrationsDirs().join("; ")}`);
}

function adaptSqlForEmbedded(sql: string) {
  return sql
    .replace(/^\s*CREATE\s+EXTENSION\s+IF\s+NOT\s+EXISTS\s+pgcrypto\s*;?\s*$/gim, "")
    .replace(/\r\n/g, "\n");
}

async function ensureEmbeddedCompat(db: EmbeddedDb) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.query(`
    CREATE OR REPLACE FUNCTION gen_random_uuid()
    RETURNS UUID AS $$
      SELECT (
        substr(md5(random()::text || clock_timestamp()::text), 1, 8) || '-' ||
        substr(md5(random()::text || clock_timestamp()::text), 9, 4) || '-4' ||
        substr(md5(random()::text || clock_timestamp()::text), 14, 3) || '-' ||
        to_hex((8 + floor(random() * 4))::int) ||
        substr(md5(random()::text || clock_timestamp()::text), 18, 3) || '-' ||
        substr(md5(random()::text || clock_timestamp()::text), 21, 12)
      )::uuid;
    $$ LANGUAGE sql VOLATILE;
  `);
}

async function executeEmbeddedSql(db: EmbeddedDb, sql: string) {
  if (typeof db.exec === "function") {
    await db.exec(sql);
    return;
  }
  await db.query(sql);
}

async function applyEmbeddedMigrations(db: EmbeddedDb) {
  const migrationsDir = await resolveMigrationsDir();
  const entries = await fs.readdir(migrationsDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  await ensureEmbeddedCompat(db);
  const appliedRs = await db.query(`SELECT name FROM public.schema_migrations`);
  const applied = new Set((appliedRs.rows || []).map((row: any) => String(row.name)));

  for (const name of files) {
    if (applied.has(name)) continue;
    const raw = await fs.readFile(path.join(migrationsDir, name), "utf8");
    const sql = adaptSqlForEmbedded(raw);
    if (!sql.trim()) {
      await db.query(
        `INSERT INTO public.schema_migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`,
        [name]
      );
      continue;
    }
    try {
      await executeEmbeddedSql(db, sql);
      await db.query(
        `INSERT INTO public.schema_migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`,
        [name]
      );
    } catch (err) {
      throw new Error(`Embedded migration failed (${name}): ${sanitizeError(err)}`);
    }
  }
}

class EmbeddedPool implements PoolLike {
  private db: EmbeddedDb;

  constructor(db: EmbeddedDb) {
    this.db = db;
  }

  async query(...args: QueryArgs) {
    const [text, params] = args;
    const normalizedParams = Array.isArray(params)
      ? params.map((value) => {
          if (typeof value === "bigint") return value.toString();
          if (typeof value === "number" && Number.isFinite(value) && Number.isInteger(value)) {
            return value.toString();
          }
          return value;
        })
      : [];
    const result = await this.db.query(text, normalizedParams);
    const rows = Array.isArray(result?.rows) ? result.rows : [];
    const affected =
      typeof result?.rowCount === "number"
        ? result.rowCount
        : rows.length > 0
        ? rows.length
        : typeof result?.affectedRows === "number"
        ? result.affectedRows
        : 0;
    return { rows, rowCount: affected };
  }

  async connect() {
    return {
      query: (...args: QueryArgs) => this.query(...args),
      release: () => {},
    };
  }

  async end() {
    await this.db.close?.();
  }
}

async function resolveEmbeddedDataDir() {
  const explicit = process.env.AXEIN_DB_DATA_DIR?.trim();
  const fallback = isDesktopRuntime
    ? path.join(os.homedir(), ".axein-billing-desktop", "db")
    : path.join(process.cwd(), ".axein-dev-db");
  const target = path.resolve(explicit || fallback);
  await fs.mkdir(target, { recursive: true });
  return target;
}

async function resolvePgliteEntry() {
  const explicit = process.env.AXEIN_PGLITE_ENTRY?.trim();
  if (explicit && (await pathExists(explicit))) return path.resolve(explicit);
  const cwd = process.cwd();
  const candidates = [
    path.join(cwd, "vendor", "pglite", "dist", "index.js"),
    path.resolve(cwd, "..", "vendor", "pglite", "dist", "index.js"),
    path.resolve(cwd, "..", "..", "vendor", "pglite", "dist", "index.js"),
    path.join(cwd, "node_modules", "@electric-sql", "pglite", "dist", "index.js"),
    path.resolve(cwd, "..", "node_modules", "@electric-sql", "pglite", "dist", "index.js"),
    path.resolve(cwd, "..", "..", "node_modules", "@electric-sql", "pglite", "dist", "index.js"),
  ];

  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    [
      "Unable to locate embedded PGlite runtime module (index.js).",
      "Tried vendor and node_modules locations.",
    ].join(" ")
  );
}

async function resolveEmbeddedPool(): Promise<PoolLike> {
  const state = runtimeDbState();
  if (state.embeddedPool) return state.embeddedPool;
  if (state.resolvingEmbeddedPool) return state.resolvingEmbeddedPool;

  state.resolvingEmbeddedPool = (async () => {
    const dataDir = await resolveEmbeddedDataDir();
    const entry = await resolvePgliteEntry();
    const dynamicImport = new Function("moduleUrl", "return import(moduleUrl);") as (
      moduleUrl: string
    ) => Promise<{ PGlite: new (options: any) => EmbeddedDb }>;
    const { PGlite } = await dynamicImport(pathToFileURL(entry).href);
    const db = new PGlite(dataDir);
    await applyEmbeddedMigrations(db);
    const p = new EmbeddedPool(db);
    state.embeddedPool = p;
    return p;
  })();

  try {
    return await state.resolvingEmbeddedPool;
  } finally {
    state.resolvingEmbeddedPool = null;
  }
}

async function resolvePool(): Promise<PoolLike> {
  const state = runtimeDbState();
  if (state.activePool) return state.activePool;
  if (state.resolvingPool) return state.resolvingPool;

  state.resolvingPool = (async () => {
    if (process.env.AXEIN_FORCE_EMBEDDED_DB === "1") {
      const embedded = await resolveEmbeddedPool();
      state.activePool = embedded;
      state.activeLabel = "embedded-db (pglite)";
      return embedded;
    }

    const attempts: string[] = [];
    const candidates = buildCandidates();

    for (const candidate of candidates) {
      const p = new Pool(candidate.config);
      try {
        const c = await p.connect();
        try {
          await c.query("SELECT 1");
        } finally {
          c.release();
        }
        state.activePool = p;
        state.activeLabel = candidate.label;
        if (isDesktopRuntime) {
          console.log(`[db] connected via ${candidate.label}`);
        }
        return p;
      } catch (err) {
        attempts.push(`- ${candidate.label}: ${sanitizeError(err)}`);
        await p.end().catch(() => {});
      }
    }

    if (shouldUseEmbeddedFallback()) {
      const embedded = await resolveEmbeddedPool();
      state.activePool = embedded;
      state.activeLabel = "embedded-db (pglite)";
      if (attempts.length > 0) {
        console.warn(`[db] postgres unavailable; using embedded-db fallback\n${attempts.join("\n")}`);
      } else if (isDesktopRuntime) {
        console.warn("[db] using embedded-db fallback");
      }
      return embedded;
    }

    throw new Error(`Unable to connect to Postgres.\nTried:\n${attempts.join("\n")}`);
  })();

  try {
    return await state.resolvingPool;
  } finally {
    state.resolvingPool = null;
  }
}

export const pool: PgLike = {
  async query(...args: QueryArgs) {
    const p = await resolvePool();
    return (await p.query(...args)) as QueryResult;
  },
  async connect() {
    const p = await resolvePool();
    return p.connect();
  },
  async end() {
    const state = runtimeDbState();
    if (!state.activePool) return;
    await state.activePool.end();
    state.activePool = null;
    state.activeLabel = null;
    state.embeddedPool = null;
  },
};

/** Return the shared pool as a pg-like object. */
export function getDb(): PgLike {
  return pool;
}

export function getDbConnectionLabel() {
  return runtimeDbState().activeLabel;
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
