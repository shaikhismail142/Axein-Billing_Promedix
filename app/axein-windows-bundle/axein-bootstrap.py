#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
AxEin – Bootstrap (Python)
v7.5 (promedix)
- Interactive GHCR tag picker (sorted by last update) when GHCR token provided
- Align S3 env names: S3_KEY / S3_SECRET
- MinIO console mapped 9003:9001 & healthcheck; web depends_on service_healthy
- LICENSE_PUBLIC_KEY discovery: info.json (publicKeyBase64 or publicKey_spki_base64) + .env.template/.env.example
- Add Mailpit service + depends_on
- Robust SQL migration apply (detects running db container id instead of assuming name)
- Apply incremental migrations even when core schema already exists (202*.sql + 999_app_compat.sql)
- Seed settings keys used by current app (settings.key='business' and settings.key='inventory')
- Correct 'platform' placement for both image and build cases
- NEW: Guard ensure_products_meta() so products.meta JSONB always exists before migrations
"""
import argparse
import os
import platform
import shutil
import subprocess
import sys
import time
from pathlib import Path
import http.client
from glob import glob
import json
import re
import socket
import urllib.request
import urllib.error
import calendar
import random
import string
import hashlib
from datetime import datetime

# ---------- Defaults ----------
DB_NAME_DEFAULT      = "axeindb"
DB_USER_DEFAULT      = "axeindb"
DB_PASS_DEFAULT      = "axeindbpass"
PG_SUPERUSER_DEFAULT = "postgres"
PG_SUPERPWD_DEFAULT  = "postgrespass"
TZ_DEFAULT           = "Asia/Kolkata"
REPO_DEFAULT         = "https://github.com/shaikhismail142/Axein-Billing_Promedix.git"
BRANCH_DEFAULT       = "codex/healthcare-customization"
# Image install (recommended for Windows)
WEB_IMAGE_DEFAULT    = "ghcr.io/shaikhismail142/axein-billing-promedix:2026-02-07-v3"
GHCR_OWNER_DEFAULT   = "shaikhismail142"
GHCR_NAME_DEFAULT    = "axein-billing-promedix"

# Used as a simple "is schema present?" gate before/after migrations.
# Keep this minimal so an older DB doesn't force a full re-init.
CORE_TABLES = ["settings", "customers", "products", "sales", "sale_items"]

# ---------- Simple logging ----------
info = lambda m: print(f"[axein] {m}")
ok   = lambda m: print(f"[ok]    {m}")
warn = lambda m: print(f"[warn]  {m}")
fail = lambda m: print(f"[err]   {m}")

# ---------- Helpers ----------

def run(cmd, check=True, env=None, shell=False):
    printable = " ".join(cmd) if isinstance(cmd, (list, tuple)) else str(cmd)
    info(f"$ {printable}")
    try:
        rc = subprocess.call(cmd, shell=shell, env=env)
        if check and rc != 0:
            raise subprocess.CalledProcessError(rc, cmd)
        return rc
    except FileNotFoundError as e:
        fail(f"Command not found: {e}")
        if check:
            raise
        return 127

def run_out(cmd, check=True, shell=False):
    try:
        out = subprocess.check_output(cmd, stderr=subprocess.STDOUT, text=True, shell=shell)
        return out
    except subprocess.CalledProcessError as e:
        if check:
            fail(e.output)
            raise
        return e.output

def ensure_dir(p: Path):
    p.mkdir(parents=True, exist_ok=True)

def require(bin_name: str, hint: str):
    if shutil.which(bin_name):
        return
    fail(f"Required command not found: {bin_name}. {hint}")
    sys.exit(2)

def retry(fn, attempts=3, delay=5, what="operation"):
    for i in range(1, attempts+1):
        rc = fn()
        if rc == 0:
            return 0
        warn(f"{what} attempt {i}/{attempts} failed (rc={rc}).")
        if i < attempts:
            time.sleep(delay)
    return rc

# ---------- HTTP checks ----------

def http_get_status(host: str, port: int, path: str, timeout=5) -> int:
    conn = http.client.HTTPConnection(host, port, timeout=timeout)
    try:
        conn.request("GET", path)
        resp = conn.getresponse()
        _ = resp.read()
        return resp.status
    except Exception:
        return 0
    finally:
        try: conn.close()
        except Exception: pass

# ---------- LICENSE_PUBLIC_KEY discovery ----------

def resolve_license_tools_dir(app_dir: Path) -> Path | None:
    candidates = [
        app_dir / "tools" / "license-keygen",
        app_dir / "app" / "tools" / "license-keygen",
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return None

def load_license_pubkey(app_dir: Path, cli_key: str | None) -> str | None:
    """
    Return base64 SPKI public key for license verification if available.
    Priority:
      1) CLI: --license-public-key
      2) tools/license-keygen/info.json -> publicKeyBase64 or publicKey_spki_base64
      3) .env.template (preferred) or .env.example line LICENSE_PUBLIC_KEY=...
    """
    if cli_key:
        ok("Using LICENSE_PUBLIC_KEY from CLI flag.")
        return cli_key.strip()

    # 2) tools/license-keygen/info.json (support repo layouts)
    tools_dir = resolve_license_tools_dir(app_dir)
    for info_json in (
        tools_dir / "info.json" if tools_dir else None,
        app_dir / "tools" / "license-keygen" / "info.json",
        app_dir / "app" / "tools" / "license-keygen" / "info.json",
    ):
        if info_json is None:
            continue
        if info_json.exists():
            try:
                j = json.loads(info_json.read_text(encoding="utf-8"))
                for k in ("publicKeyBase64", "publicKey_spki_base64", "public", "spki"):
                    v = j.get(k)
                    if isinstance(v, str) and v.strip():
                        ok("Using LICENSE_PUBLIC_KEY from tools/license-keygen/info.json.")
                        return v.strip()
            except Exception as e:
                warn(f"Could not parse {info_json}: {e}")

    # 3) .env.template (preferred) or .env.example (fallback)
    for env_candidate in (
        app_dir / ".env.template",
        app_dir / ".env.example",
        app_dir / "app" / ".env.template",
        app_dir / "app" / ".env.example",
    ):
        if not env_candidate.exists():
            continue
        try:
            for line in env_candidate.read_text(encoding="utf-8").splitlines():
                m = re.match(r"^\s*LICENSE_PUBLIC_KEY\s*=\s*(.+)\s*$", line)
                if m:
                    ok(f"Using LICENSE_PUBLIC_KEY from {env_candidate.name}.")
                    return m.group(1).strip()
        except Exception as e:
            warn(f"Could not read {env_candidate}: {e}")

    warn("LICENSE_PUBLIC_KEY not found (flag/info.json/.env.template/.env.example). License verify will fail until set.")
    return None

# ---------- Compose generation ----------

def compose_platform_for(host_os: str, host_arch: str) -> str | None:
    arch = (host_arch or "").lower()
    if host_os == "Windows" or arch in ("x86_64", "amd64", "x64"):
        return "linux/amd64"
    if arch in ("arm64", "aarch64"):
        return "linux/arm64"
    return None

def write_compose(dest: Path, root_dir: Path, app_dir: Path, app_port: int, tz: str,
                  db_user: str, db_pass: str, db_name: str,
                  pg_superuser: str, pg_superpwd: str,
                  license_pubkey: str | None,
                  enable_redis: bool,
                  enable_mailpit: bool,
                  enable_minio: bool,
                  web_image: str | None,
                  host_os: str, host_arch: str):
    base_url = f"http://localhost:{app_port}"

    def p(pth: Path) -> str:
        return os.fspath(pth).replace("\\","/")

    platform_line = compose_platform_for(host_os, host_arch)
    service_platform_yaml = f"\n    platform: {platform_line}" if platform_line else ""
    license_env = f'LICENSE_PUBLIC_KEY: "{license_pubkey}"' if license_pubkey else ""

    minio_service = f"""
  minio:
    image: minio/minio:latest
    command: ["server", "/data", "--console-address", ":9001"]
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    ports: ["9000:9000", "9003:9001"]
    volumes:
      - type: bind
        source: {p(root_dir / 'data' / 'minio')}
        target: /data
    healthcheck:
      test: ["CMD-SHELL", "curl -sf http://localhost:9000/minio/health/ready || exit 1"]
      interval: 5s
      timeout: 4s
      retries: 40
    restart: unless-stopped
""" if enable_minio else ""

    web_dep_redis = "\n      redis:\n        condition: service_started" if enable_redis else ""
    web_dep_minio = "\n      minio:\n        condition: service_healthy" if enable_minio else ""
    web_dep_mailpit = "\n      mailpit:\n        condition: service_started" if enable_mailpit else ""

    redis_env_block = "      REDIS_HOST: redis\n      REDIS_PORT: \"6379\"\n" if enable_redis else ""

    redis_service = """
  redis:
    image: redis:7
    ports: ["6379:6379"]
    restart: unless-stopped
""" if enable_redis else ""

    if web_image:
        web_block = f"""
  web:
    image: {web_image}{service_platform_yaml}
    pull_policy: always
    depends_on:
      db:
        condition: service_healthy
{(web_dep_redis + web_dep_minio + web_dep_mailpit).rstrip()}
    environment:
      NODE_ENV: production
      TZ: {tz}
      PORT: "3000"
      NEXT_PUBLIC_BASE_URL: {base_url}
      DATABASE_URL: postgresql://{db_user}:{db_pass}@db:5432/{db_name}
      POSTGRES_HOST: db
      POSTGRES_PORT: "5432"
      POSTGRES_USER: {db_user}
      POSTGRES_PASSWORD: {db_pass}
      POSTGRES_DB: {db_name}
{redis_env_block.rstrip()}
      S3_ENDPOINT: {"http://minio:9000" if enable_minio else ""}
      S3_KEY: {"minioadmin" if enable_minio else ""}
      S3_SECRET: {"minioadmin" if enable_minio else ""}
      S3_BUCKET: {"axein" if enable_minio else ""}
      S3_REGION: ap-south-1
      S3_FORCE_PATH_STYLE: "true"
      {license_env}
    ports: ["{app_port}:3000"]
    restart: unless-stopped
"""
    else:
        # build-from-source path
        web_block = f"""
  web:
    build:
      context: {p(app_dir)}
      dockerfile: Dockerfile
    image: axein-web:local{service_platform_yaml}
    depends_on:
      db:
        condition: service_healthy
{(web_dep_redis + web_dep_minio + web_dep_mailpit).rstrip()}
    environment:
      NODE_ENV: production
      TZ: {tz}
      PORT: "3000"
      NEXT_PUBLIC_BASE_URL: {base_url}
      DATABASE_URL: postgresql://{db_user}:{db_pass}@db:5432/{db_name}
      POSTGRES_HOST: db
      POSTGRES_PORT: "5432"
      POSTGRES_USER: {db_user}
      POSTGRES_PASSWORD: {db_pass}
      POSTGRES_DB: {db_name}
{redis_env_block.rstrip()}
      S3_ENDPOINT: {"http://minio:9000" if enable_minio else ""}
      S3_KEY: {"minioadmin" if enable_minio else ""}
      S3_SECRET: {"minioadmin" if enable_minio else ""}
      S3_BUCKET: {"axein" if enable_minio else ""}
      S3_REGION: ap-south-1
      S3_FORCE_PATH_STYLE: "true"
      {license_env}
    ports: ["{app_port}:3000"]
    restart: unless-stopped
"""

    mailpit_block = """
  mailpit:
    image: axllent/mailpit:latest
    ports: ["8025:8025", "1025:1025"]
    restart: unless-stopped
""" if enable_mailpit else ""

    compose = f"""name: axein
services:
  db:
    image: postgres:16.4
    environment:
      POSTGRES_USER: {pg_superuser}
      POSTGRES_PASSWORD: {pg_superpwd}
      TZ: {tz}
    ports: ["5432:5432"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U {pg_superuser}"]
      interval: 10s
      timeout: 5s
      retries: 12
    shm_size: "1g"
    volumes:
      - type: bind
        source: {p(root_dir / 'data' / 'postgres')}
        target: /var/lib/postgresql/data
      - type: bind
        source: {p(root_dir / 'backups' / 'postgres')}
        target: /backups
      - type: bind
        source: {p(root_dir / 'init')}
        target: /docker-entrypoint-initdb.d
    restart: unless-stopped
{redis_service}{minio_service}{mailpit_block}{web_block}
"""
    dest.write_text(compose, encoding="utf-8")
    ok(f"docker-compose.yml written at {dest}")

# ---------- .env generation ----------

def write_env_file(dest: Path, app_port: int, tz: str, db_user: str, db_pass: str, db_name: str,
                   enable_redis: bool, enable_mailpit: bool, enable_minio: bool,
                   base_url: str, license_pubkey: str | None):
    lines = [
        f"NODE_ENV=production",
        f"TZ={tz}",
        f"PORT=3000",
        f"NEXT_PUBLIC_BASE_URL={base_url}",
        f"DATABASE_URL=postgresql://{db_user}:{db_pass}@db:5432/{db_name}",
        f"POSTGRES_HOST=db",
        f"POSTGRES_PORT=5432",
        f"POSTGRES_USER={db_user}",
        f"POSTGRES_PASSWORD={db_pass}",
        f"POSTGRES_DB={db_name}",
        "HOST=0.0.0.0",
        "NEXT_TELEMETRY_DISABLED=1",
    ]
    if enable_redis:
        lines += [
            "REDIS_HOST=redis",
            "REDIS_PORT=6379",
        ]
    if enable_mailpit:
        lines += [
            # SMTP defaults (Mailpit)
            "SMTP_HOST=mailpit",
            "SMTP_PORT=1025",
            "SMTP_SECURE=false",
            "SMTP_USER=",
            "SMTP_PASS=",
            'SMTP_FROM="AxEin Billing <dev@local>"',
            "SMTP_DRIVER=console",
        ]
    if enable_minio:
        lines += [
            "S3_ENDPOINT=http://minio:9000",
            "S3_REGION=ap-south-1",
            "S3_BUCKET=axein",
            "S3_KEY=minioadmin",
            "S3_SECRET=minioadmin",
            "S3_FORCE_PATH_STYLE=true",
        ]
    if license_pubkey:
        lines.append(f"LICENSE_PUBLIC_KEY={license_pubkey}")
    dest.write_text("\n".join(lines) + "\n", encoding="utf-8")
    ok(f".env written at {dest}")

# ---------- DB first-run SQL ----------

def write_init_sql(init_dir: Path, db_user: str, db_pass: str, db_name: str):
    sql = f"""DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '{db_user}') THEN
    CREATE ROLE {db_user} WITH LOGIN PASSWORD '{db_pass}';
  END IF;
END
$$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_database WHERE datname = '{db_name}') THEN
    CREATE DATABASE {db_name} OWNER {db_user};
  END IF;
END
$$;
GRANT ALL PRIVILEGES ON DATABASE {db_name} TO {db_user};
"""
    ensure_dir(init_dir)
    (init_dir / "00_app.sql").write_text(sql, encoding="utf-8")
    ok(f"Init SQL written: {init_dir / '00_app.sql'}")

# ---------- Post-start ensures & migrations ----------

def ensure_role_db_after_start(compose_file: Path, db_name: str, db_user: str, db_pass: str, pg_superuser: str):
    info("Ensuring Postgres role & database exist (idempotent)…")
    role_sql = f"""DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '{db_user}') THEN
    CREATE ROLE {db_user} WITH LOGIN PASSWORD '{db_pass}';
  END IF;
END
$$;"""
    run(["docker","compose","-f",os.fspath(compose_file),"exec","-T","db","psql","-U",pg_superuser,"-v","ON_ERROR_STOP=1","-c",role_sql], check=False)

    out = run_out(["docker","compose","-f",os.fspath(compose_file),"exec","-T","db","bash","-lc",
                   f"psql -U {pg_superuser} -Atqc \"SELECT 1 FROM pg_database WHERE datname='{db_name}'\""] , check=False).strip()
    if out != "1":
        info(f"Database '{db_name}' missing — creating…")
        run(["docker","compose","-f",os.fspath(compose_file),"exec","-T","db","createdb","-U",pg_superuser,"-O",db_user,db_name])
    else:
        ok(f"Database '{db_name}' exists.")

    grant_sql = f"""
ALTER DATABASE {db_name} OWNER TO {db_user};
ALTER SCHEMA public OWNER TO {db_user};
GRANT ALL ON SCHEMA public TO {db_user};
"""
    run(["docker","compose","-f",os.fspath(compose_file),"exec","-T","db","psql","-U",pg_superuser,"-d",db_name,"-v","ON_ERROR_STOP=1","-c",grant_sql], check=False)
    ok("Role/database ensured.")

def ensure_products_meta(compose_file: Path, db_name: str, db_user: str):
    """Ensure products.meta JSONB exists before running migrations (idempotent)."""
    run([
        "docker","compose","-f",os.fspath(compose_file),"exec","-T","db",
        "psql","-U",db_user,"-d",db_name,"-v","ON_ERROR_STOP=1","-c",
        """DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='products') THEN
    ALTER TABLE products ADD COLUMN IF NOT EXISTS meta JSONB NOT NULL DEFAULT '{}'::jsonb;
  END IF;
END $$;"""
    ], check=False)


def ensure_sale_items_meta(compose_file: Path, db_name: str, db_user: str):
    """Ensure sale_items.meta JSONB exists (idempotent)."""
    run([
        "docker","compose","-f",os.fspath(compose_file),"exec","-T","db",
        "psql","-U",db_user,"-d",db_name,"-v","ON_ERROR_STOP=1","-c",
        """DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='sale_items') THEN
    ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS meta JSONB NOT NULL DEFAULT '{}'::jsonb;
  END IF;
END $$;"""
    ], check=False)


def ensure_sales_meta(compose_file: Path, db_name: str, db_user: str):
    """Ensure sales.meta JSONB exists (idempotent)."""
    run([
        "docker","compose","-f",os.fspath(compose_file),"exec","-T","db",
        "psql","-U",db_user,"-d",db_name,"-v","ON_ERROR_STOP=1","-c",
        """DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='sales') THEN
    ALTER TABLE sales ADD COLUMN IF NOT EXISTS meta JSONB NOT NULL DEFAULT '{}'::jsonb;
  END IF;
END $$;"""
    ], check=False)


def tables_missing(compose_file: Path, db_name: str, db_user: str, expected: list[str] | None = None) -> list[str]:
    q = "SELECT tablename FROM pg_tables WHERE schemaname='public';"
    out = run_out(["docker","compose","-f",os.fspath(compose_file),"exec","-T","db","psql","-U",db_user,"-d",db_name,"-Atqc",q], check=False)
    have = set([t.strip() for t in out.splitlines() if t.strip()])
    expected = expected or CORE_TABLES
    missing = [t for t in expected if t not in have]
    return missing


SOFT_FAIL_MIGRATIONS: set[str] = set()

def migration_candidates(app_dir: Path, mode: str) -> list[Path]:
    mig_dir = app_dir / "db" / "migrations"
    all_sql = sorted(Path(p) for p in glob(os.path.join(os.fspath(mig_dir), "*.sql")))
    if not all_sql:
        return []

    if mode == "full":
        return all_sql

    # "incremental": safe-to-run patch migrations for existing DBs
    out: list[Path] = []
    for fp in all_sql:
        nm = fp.name
        if nm == "999_app_compat.sql" or re.match(r"^202\d{8}.*\.sql$", nm) or re.match(r"^202\d{8}[a-z].*\.sql$", nm):
            out.append(fp)
    return sorted(out, key=lambda p: p.name)


def apply_sql_file(compose_file: Path, sql_path: Path, db_name: str, db_user: str) -> bool:
    # Copy using the actual container id (robust across OS/compose)
    cid = run_out(["docker","compose","-f",os.fspath(compose_file),"ps","-q","db"], check=False).strip()
    if not cid:
        warn("Could not determine db container id for docker cp; trying psql < file fallback.")
        # Fallback: stream file into psql (best effort; primarily for non-standard shells)
        if platform.system() == "Windows":
            rc = run(["powershell","-NoProfile","-Command",
                      f"Get-Content -Raw '{os.fspath(sql_path)}' | docker compose -f {os.fspath(compose_file)} exec -T db psql -U {db_user} -d {db_name} -v ON_ERROR_STOP=1"],
                     check=False)
        else:
            rc = run(["bash","-lc", f"docker compose -f {os.fspath(compose_file)} exec -T db psql -U {db_user} -d {db_name} -v ON_ERROR_STOP=1 < {os.fspath(sql_path)}"], check=False)
        return rc == 0

    run(["docker","cp",os.fspath(sql_path), f"{cid}:/tmp/{sql_path.name}"], check=False)
    rc = run(["docker","compose","-f",os.fspath(compose_file),"exec","-T","db","psql","-U",db_user,"-d",db_name,"-v","ON_ERROR_STOP=1","-f",f"/tmp/{sql_path.name}"], check=False)
    return rc == 0


def auto_migrate(compose_file: Path, app_dir: Path, db_name: str, db_user: str) -> bool:
    missing_core = tables_missing(compose_file, db_name, db_user, expected=CORE_TABLES)
    mode = "full" if missing_core else "incremental"

    if mode == "full":
        warn(f"Core tables missing: {', '.join(missing_core)}")
        info("Applying full migration set (fresh install)…")
    else:
        info("Core schema present. Applying incremental migrations (patch/compat)…")

    cands = migration_candidates(app_dir, mode=mode)
    if not cands:
        ok("No migration SQL files found under app/db/migrations/*.sql. Skipping.")
        return True

    info(f"Applying {len(cands)} migration file(s)…")
    all_ok = True
    for fp in cands:
        ok(f"→ {fp.name}")
        if not apply_sql_file(compose_file, fp, db_name, db_user):
            warn(f"Migration failed for {fp.name}")
            if fp.name in SOFT_FAIL_MIGRATIONS:
                warn(f"Continuing despite failure of {fp.name} (marked as soft-fail).")
                continue
            all_ok = False
            break

    still_missing_core = tables_missing(compose_file, db_name, db_user, expected=CORE_TABLES)
    if still_missing_core:
        fail(f"Still missing core tables after migration: {', '.join(still_missing_core)}")
        return False

    ok("Migrations complete and core schema verified.")
    return all_ok


def seed_activation_if_missing(compose_file: Path, db_name: str, db_user: str):
    info("Seeding activation settings (idempotent)…")
    check = "SELECT 1 FROM settings WHERE key='activation' LIMIT 1;"
    out = run_out(["docker","compose","-f",os.fspath(compose_file),"exec","-T","db","psql","-U",db_user,"-d",db_name,"-Atqc",check], check=False).strip()
    if out == "1":
        ok("Activation settings exist. Skip.")
        return
    upsert = r"""
INSERT INTO settings(key, value_json)
VALUES ('activation', jsonb_build_object(
  'active', false,
  'trialActive', false,
  'trialEnabled', true,
  'trialDays', 7
))
ON CONFLICT (key) DO NOTHING;
"""
    run(["docker","compose","-f",os.fspath(compose_file),"exec","-T","db","psql","-U",db_user,"-d",db_name,"-v","ON_ERROR_STOP=1","-c",upsert], check=False)
    ok("Activation settings seeded (if absent).")


def seed_settings_defaults(compose_file: Path, db_name: str, db_user: str):
    info("Seeding required settings defaults (idempotent)…")
    # Skip if settings table doesn't exist yet
    table_check = run_out([
        "docker","compose","-f",os.fspath(compose_file),"exec","-T","db",
        "psql","-U",db_user,"-d",db_name,"-Atqc",
        "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='settings' LIMIT 1;"
    ], check=False).strip()
    if table_check != "1":
        warn("Settings table not found yet; skipping settings seed for now.")
        return

    # inventory.near_expiry_days (used by /inventory/expiry + alerts)
    inv_upsert = r"""
INSERT INTO settings(key, value_json)
VALUES ('inventory', jsonb_build_object('near_expiry_days', 180))
ON CONFLICT (key) DO UPDATE
SET value_json =
  CASE
    WHEN COALESCE(settings.value_json, '{}'::jsonb) ? 'near_expiry_days'
      THEN COALESCE(settings.value_json, '{}'::jsonb)
    ELSE COALESCE(settings.value_json, '{}'::jsonb) || jsonb_build_object('near_expiry_days', 180)
  END;
"""
    run(["docker","compose","-f",os.fspath(compose_file),"exec","-T","db","psql",
         "-U",db_user,"-d",db_name,"-v","ON_ERROR_STOP=1","-c",inv_upsert], check=False)

    # business profile (used by invoice/quotation/tax prints)
    biz_upsert = r"""
INSERT INTO settings(key, value_json)
VALUES ('business', jsonb_build_object(
  'name','Your Company',
  'address','',
  'phone','',
  'gstin','',
  'state_code','',
  'logo_url',''
))
ON CONFLICT (key) DO UPDATE
SET value_json =
  COALESCE(settings.value_json, '{}'::jsonb) ||
  (EXCLUDED.value_json - ARRAY(
    SELECT jsonb_object_keys(COALESCE(settings.value_json, '{}'::jsonb))
  ));
"""
    run(["docker","compose","-f",os.fspath(compose_file),"exec","-T","db","psql",
         "-U",db_user,"-d",db_name,"-v","ON_ERROR_STOP=1","-c",biz_upsert], check=False)

    ok("Settings defaults ensured.")

# ---------- (NEW) Pre-Install + Preflight ----------

def is_windows_admin():
    if platform.system() != "Windows":
        return False
    try:
        import ctypes
        return ctypes.windll.shell32.IsUserAnAdmin() != 0
    except Exception:
        return False

def port_in_use(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.4)
        return s.connect_ex(("127.0.0.1", port)) == 0

def ensure_brew():
    if shutil.which("brew"):
        return True
    warn("Homebrew not found. Attempting to install Homebrew (non-interactive).")
    rc = run(["bash","-lc",
              r'/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'],
             check=False)
    if rc == 0 and shutil.which("brew"):
        ok("Homebrew installed.")
        return True
    warn("Could not auto-install Homebrew. Please install it from https://brew.sh and re-run.")
    return False

def linux_distro():
    try:
        data = Path("/etc/os-release").read_text(encoding="utf-8")
        if "ubuntu" in data.lower() or "debian" in data.lower():
            return "debian"
        if "fedora" in data.lower():
            return "fedora"
        if any(x in data.lower() for x in ("centos", "rhel", "rocky", "almalinux")):
            return "rhel"
    except Exception:
        pass
    return "other"

def install_git(target: str):
    if shutil.which("git"):
        return
    info("Git not found — attempting installation.")
    if target == "Windows":
        if not shutil.which("winget"):
            fail("winget not found. Install Git manually from https://git-scm.com/download/win and re-run.")
            return
        run(["winget","install","-e","--id","Git.Git","--source","winget","--accept-package-agreements","--accept-source-agreements"], check=False)
    else:
        sysname = platform.system()
        if sysname == "Darwin":
            if ensure_brew():
                run(["brew","install","git"], check=False)
        else:
            distro = linux_distro()
            if distro == "debian":
                run(["bash","-lc","sudo apt-get update"], check=False)
                run(["bash","-lc","sudo apt-get install -y git"], check=False)
            elif distro in ("fedora","rhel"):
                run(["bash","-lc","sudo dnf install -y git || sudo yum install -y git"], check=False)
            else:
                warn("Unknown Linux distro. Please install git using your package manager.")
    if shutil.which("git"):
        ok("Git installed.")
    else:
        warn("Git installation may have failed. Proceeding will likely fail later.")

def install_node(target: str):
    if shutil.which("node"):
        return
    info("Node.js not found — attempting installation.")
    if target == "Windows":
        if not shutil.which("winget"):
            warn("winget not found. Install Node.js manually from https://nodejs.org/ and re-run.")
            return
        run(["winget","install","-e","--id","OpenJS.NodeJS.LTS","--source","winget","--accept-package-agreements","--accept-source-agreements"], check=False)
    else:
        sysname = platform.system()
        if sysname == "Darwin":
            if ensure_brew():
                run(["brew","install","node"], check=False)
        else:
            distro = linux_distro()
            if distro == "debian":
                run(["bash","-lc","sudo apt-get update"], check=False)
                run(["bash","-lc","sudo apt-get install -y nodejs npm"], check=False)
            elif distro in ("fedora","rhel"):
                run(["bash","-lc","sudo dnf install -y nodejs npm || sudo yum install -y nodejs npm"], check=False)
            else:
                warn("Unknown Linux distro. Please install Node.js using your package manager.")
    if resolve_node_exe():
        ok("Node.js installed (or already present).")
    else:
        warn("Node.js installation may have failed. Proceeding will likely fail later.")

def resolve_node_exe() -> str | None:
    # 1) PATH
    if shutil.which("node"):
        return shutil.which("node")
    # 2) Common Windows paths
    candidates = []
    pf = os.environ.get("ProgramFiles")
    pfx86 = os.environ.get("ProgramFiles(x86)")
    if pf:
        candidates.append(os.path.join(pf, "nodejs", "node.exe"))
    if pfx86:
        candidates.append(os.path.join(pfx86, "nodejs", "node.exe"))
    for c in candidates:
        if c and os.path.exists(c):
            return c
    return None

def ensure_node_on_path():
    node_exe = resolve_node_exe()
    if not node_exe:
        return
    node_dir = os.path.dirname(node_exe)
    if node_dir and node_dir not in os.environ.get("PATH",""):
        os.environ["PATH"] = node_dir + os.pathsep + os.environ.get("PATH","")

def install_docker(target: str):
    if shutil.which("docker"):
        return
    info("Docker not found — attempting installation.")
    if target == "Windows":
        if not shutil.which("winget"):
            fail("winget not found. Install Docker Desktop manually: https://www.docker.com/products/docker-desktop/")
            return
        if not is_windows_admin():
            warn("Windows install needs Administrator. Please re-run this script in an elevated PowerShell.")
        run(["winget","install","-e","--id","Docker.DockerDesktop","--source","winget","--accept-package-agreements","--accept-source-agreements"], check=False)
        run(["powershell","-NoProfile","-Command","Start-Process -FilePath \"$Env:ProgramFiles\\Docker\\Docker\\Docker Desktop.exe\" -WindowStyle Minimized"], check=False)
    else:
        sysname = platform.system()
        if sysname == "Darwin":
            if ensure_brew():
                run(["brew","install","--cask","docker"], check=False)
                run(["open","-a","Docker"], check=False)
        else:
            distro = linux_distro()
            if distro == "debian":
                run(["bash","-lc","sudo apt-get update"], check=False)
                run(["bash","-lc","sudo apt-get install -y docker.io"], check=False)
                run(["bash","-lc","sudo systemctl enable --now docker"], check=False)
                run(["bash","-lc",f"sudo usermod -aG docker {os.environ.get('USER','')}"], check=False)
                warn("If this is your first time joining the 'docker' group, you may need to log out and log in again.")
            elif distro in ("fedora","rhel"):
                run(["bash","-lc","sudo dnf install -y docker docker-compose-plugin || sudo yum install -y docker docker-compose-plugin"], check=False)
                run(["bash","-lc","sudo systemctl enable --now docker"], check=False)
                run(["bash","-lc",f"sudo usermod -aG docker {os.environ.get('USER','')}"], check=False)
                warn("If this is your first time joining the 'docker' group, you may need to log out and log in again.")
            else:
                warn("Unknown Linux distro. Please install Docker using your package manager.")
    if shutil.which("docker"):
        ok("Docker installed (or found).")
    else:
        warn("Docker installation may have failed. Proceeding will likely fail later.")

def wait_for_docker_daemon(timeout=180):
    info("Waiting for Docker daemon to be ready…")
    deadline = time.time() + timeout
    while time.time() < deadline:
        rc = run(["docker","info"], check=False)
        if rc == 0:
            ok("Docker daemon is running.")
            return True
        time.sleep(3)
        print(".", end="", flush=True)
    print()
    return False

def preinstall_and_preflight(args, target: str, root_dir: Path):
    install_git(target)
    install_docker(target)
    # Node is used for license signing (tools/license-keygen/sign-license.js)
    install_node(target)
    ensure_node_on_path()

    if target == "Windows":
        # Try to set Docker Desktop to start on login (best-effort)
        try:
            docker_exe = r"C:\Program Files\Docker\Docker\Docker Desktop.exe"
            if os.path.exists(docker_exe):
                run([
                    "powershell","-NoProfile","-Command",
                    "New-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' "
                    "-Name 'Docker Desktop' -Value '\"C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe\"' "
                    "-PropertyType String -Force"
                ], check=False)
                ok("Docker Desktop auto-start enabled (current user).")
        except Exception as e:
            warn(f"Could not enable Docker auto-start: {e}")

    if platform.system() == "Darwin" and shutil.which("open"):
        run(["open","-g","-a","Docker"], check=False)

    if not wait_for_docker_daemon(timeout=180):
        warn("Docker engine is not running. Start Docker Desktop / Engine and rerun.")

    if target == "Windows":
        if not is_windows_admin():
            warn("Not running elevated. If install/start failed, re-run as Administrator.")
        if shutil.which("wsl"):
            out = run_out(["wsl","--status"], check=False)
            if ("Default Version: 2" not in out) and ("Running" not in out):
                warn("WSL may not be fully enabled/configured.")

    try:
        total, used, free = shutil.disk_usage(str(root_dir))
        if free < 5 * 1024**3:
            warn("Less than 5 GB free disk space; pulls/builds or database may fail.")
    except Exception:
        pass

    ports = [args.app_port, 5432]
    if not args.no_redis:
        ports += [6379]
    if not args.no_mailpit:
        ports += [1025, 8025]
    if not args.no_minio:
        ports += [9000, 9003]
    busy = [p for p in ports if port_in_use(p)]
    if busy:
        warn("Ports already in use: " + ", ".join(map(str, busy)))

    rc = run(["docker","compose","version"], check=False)
    if rc != 0:
        warn("Docker Compose v2 not detected; your next step may fail.")

    ver = run_out(["docker","version","--format","{{.Server.Version}}"], check=False).strip()
    if ver:
        info(f"Docker server version: {ver}")

# ---------- GHCR tag listing & selection ----------

def ghcr_list_tags(owner: str, name: str, token: str) -> list[tuple[str, str]]:
    """
    Returns list of (tag, updated_at_iso) sorted by updated_at desc.
    Requires a GitHub token with read:packages for private packages.
    """
    url = f"https://api.github.com/users/{owner}/packages/container/{name}/versions?per_page=100"
    req = urllib.request.Request(url, headers={
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {token}",
        "X-GitHub-Api-Version": "2022-11-28"
    })
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        warn(f"Could not list GHCR tags (HTTP {e.code}). Proceeding without list.")
        return []
    except Exception as e:
        warn(f"Could not list GHCR tags: {e}")
        return []

    rows: list[tuple[str,str]] = []
    for ver in data:
        updated = ver.get("updated_at") or ver.get("created_at") or ""
        tags = (ver.get("metadata") or {}).get("container", {}).get("tags") or []
        for t in tags:
            rows.append((t, updated))

    # sort newest first
    def key_fn(item):
        ts = item[1]
        try:
            return datetime.fromisoformat(ts.replace("Z","+00:00"))
        except Exception:
            return datetime.min

    rows.sort(key=key_fn, reverse=True)

    # de-dup tags keeping newest timestamp
    seen, out = set(), []
    for t, ts in rows:
        if t in seen: continue
        seen.add(t)
        out.append((t, ts))

    return out


def parse_image_ref(ref: str):
    """
    Returns (registry, owner, name, tag)
    Examples:
      ghcr.io/org/repo:tag -> ("ghcr.io","org","repo","tag")
      org/repo:tag         -> ("ghcr.io","org","repo","tag")
      repo:tag             -> ("ghcr.io","", "repo","tag")
    """
    ref = ref.strip()
    registry = "ghcr.io"
    tag = ""
    # split tag (last ':' after last '/')
    if ":" in ref and ref.rfind(":") > ref.rfind("/"):
        ref, tag = ref.rsplit(":", 1)
    parts = ref.split("/")
    if len(parts) >= 3:
        registry = parts[0]
        owner = parts[1]
        name = parts[2]
    elif len(parts) == 2:
        owner = parts[0]
        name = parts[1]
    else:
        owner = ""
        name = parts[0]
    return registry, owner, name, tag


def choose_web_image(base_image_default: str, ghcr_token: str) -> str:
    """
    Present interactive selection of tags (newest first). If no token or listing fails,
    ask user for a tag or keep default.
    """
    default_image = base_image_default
    registry, owner, name, default_tag = parse_image_ref(default_image)
    if not default_tag:
        default_tag = "latest"
    tag_rows = ghcr_list_tags(owner, name, ghcr_token) if (ghcr_token and owner and name and registry == "ghcr.io") else []

    if tag_rows:
        print("\nAvailable image tags (newest first):")
        shown = tag_rows[:15]
        for i, (tag, ts) in enumerate(shown, 1):
            print(f"  {i:2d}) {tag:15s}  updated: {ts}")
        sel = input(f"Pick a tag by number (1-{len(shown)}), or enter a tag, or Enter for '{default_tag}': ").strip()
        if sel.isdigit():
            idx = int(sel)
            if 1 <= idx <= len(shown):
                picked = shown[idx-1][0]
                ok(f"Selected tag: {picked}")
                return f"{registry}/{owner}/{name}:{picked}" if owner else f"{registry}/{name}:{picked}"
        elif sel:
            ok(f"Selected tag: {sel}")
            return f"{registry}/{owner}/{name}:{sel}" if owner else f"{registry}/{name}:{sel}"
        ok(f"Using default tag: {default_tag}")
        return f"{registry}/{owner}/{name}:{default_tag}" if owner else f"{registry}/{name}:{default_tag}"
    else:
        # No list (public/no token). Ask loosely.
        prompt = input(f"Enter image tag (Enter for '{default_tag}'): ").strip()
        tag = prompt or default_tag
        return f"{registry}/{owner}/{name}:{tag}" if owner else f"{registry}/{name}:{tag}"

# ---------- Wait helpers ----------

def wait_for_service(compose_file: Path, service: str, cmd: list[str], timeout_sec=180) -> bool:
    info(f"Waiting for service '{service}' to be ready…")
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        rc = run(["docker","compose","-f",os.fspath(compose_file),"exec","-T",service] + cmd, check=False)
        if rc == 0:
            ok(f"Service '{service}' is ready.")
            return True
        time.sleep(3)
        print(".", end="", flush=True)
    print()
    fail(f"Timeout while waiting for '{service}'.")
    return False


def wait_for_web_ready(app_port: int, compose_file: Path, timeout_sec=240) -> bool:
    info("Waiting for web to respond…")
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        for path in ("/api/health", "/"):
            if http_get_status("127.0.0.1", app_port, path) == 200:
                ok("Web returned 200.")
                return True
        time.sleep(3)
        print(".", end="", flush=True)
    print()
    warn("Web did not return 200 in time.")
    return False

def resolve_app_src(repo_dir: Path) -> Path:
    """
    Support repo layouts:
      - repo/app (Next.js app lives here)
      - repo (Next.js app at root)
    """
    if (repo_dir / "app" / "package.json").exists():
        return repo_dir / "app"
    if (repo_dir / "package.json").exists():
        return repo_dir
    if (repo_dir / "app").exists():
        return repo_dir / "app"
    return repo_dir

def docker_login_ghcr(username: str, token: str, target: str) -> bool:
    if not username or not token:
        return False
    info("Logging into GHCR…")
    if target == "Unix":
        rc = run(["bash","-lc", f"echo '{token}' | docker login ghcr.io -u {username} --password-stdin"], check=False)
    else:
        rc = run(["powershell","-NoProfile","-Command", f"$p='{token}'; $p | docker login ghcr.io -u {username} --password-stdin"], check=False)
    if rc == 0:
        ok("GHCR login succeeded.")
        return True
    warn("GHCR login failed.")
    return False


def smoke_tests(app_port: int) -> bool:
    info("Running smoke tests…")
    ok_count = 0
    if http_get_status("127.0.0.1", app_port, "/") == 200:
        ok("GET / -> 200")
        ok_count += 1
    if http_get_status("127.0.0.1", app_port, "/api/health") == 200:
        ok("GET /api/health -> 200")
        ok_count += 1
    return ok_count >= 1

# ---------- Self-update helpers ----------

def file_sha256(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()

def maybe_reexec_with_repo_script(app_dir: Path, allow_reexec: bool = True):
    if not allow_reexec:
        return
    try:
        current = Path(__file__).resolve()
        repo_script = (app_dir / "axein-windows-bundle" / "axein-bootstrap.py")
        if not repo_script.exists():
            repo_script = (app_dir / "app" / "axein-windows-bundle" / "axein-bootstrap.py")
        repo_script = repo_script.resolve()
        if not repo_script.exists():
            return
        if current == repo_script:
            return
        if file_sha256(current) == file_sha256(repo_script):
            return
        resp = input("A newer bootstrap was found in the repo. Re-run it now? [Y/n]: ").strip().lower()
        if resp in ("", "y", "yes"):
            args = [a for a in sys.argv[1:] if a != "--no-reexec"]
            cmd = [sys.executable, os.fspath(repo_script)] + args + ["--no-reexec"]
            info("Re-launching updated bootstrap…")
            run(cmd, check=False)
            sys.exit(0)
    except Exception as e:
        warn(f"Self-update check failed: {e}")

# ---------- License helpers ----------

def rand_group(n=4) -> str:
    alphabet = string.ascii_uppercase + string.digits
    return "".join(random.choice(alphabet) for _ in range(n))

def generate_license_key() -> str:
    return f"AXEIN-{rand_group()}-{rand_group()}-{rand_group()}"

def parse_date_yyyy_mm_dd(s: str) -> datetime.date:
    return datetime.strptime(s, "%Y-%m-%d").date()

def add_months(d, months: int):
    y = d.year + (d.month - 1 + months) // 12
    m = (d.month - 1 + months) % 12 + 1
    day = min(d.day, calendar.monthrange(y, m)[1])
    return datetime(y, m, day).date()

def compute_expiry(start_date, months: int):
    return add_months(start_date, months)

def prompt_license_details():
    print("\n--- License Setup ---")
    company = input("Company name (required): ").strip()
    while not company:
        company = input("  Please enter company name: ").strip()

    email = input("Company email (required, or type 'skip' to use admin@local): ").strip()
    while True:
        if email.lower() == "skip" or email == "":
            email = "admin@local"
            break
        if email and ("@" in email) and ("." in email.split("@")[-1]):
            break
        email = input("  Please enter a valid email (or 'skip'): ").strip()

    term_raw = (input("License term in months [6/12] (default: 12): ").strip() or "12")
    try:
        term_months = int(term_raw)
    except Exception:
        term_months = 12
    if term_months not in (6, 12):
        warn("Invalid term. Using 12 months.")
        term_months = 12

    today_str = datetime.now().strftime("%Y-%m-%d")
    start_date = parse_date_yyyy_mm_dd(today_str)
    use_custom = input(f"Start date will be {today_str}. Use a different start date? [y/N]: ").strip().lower()
    if use_custom in ("y", "yes"):
        start_str = input("Start date (YYYY-MM-DD): ").strip() or today_str
        while True:
            try:
                start_date = parse_date_yyyy_mm_dd(start_str)
                break
            except Exception:
                start_str = input("  Please use YYYY-MM-DD: ").strip() or today_str

    computed_end = compute_expiry(start_date, term_months)
    end_date = computed_end
    print(f"License end date will be: {end_date}")

    phone = input("Phone (optional): ").strip()
    gstin = input("GSTIN (optional): ").strip()
    state_code = input("State code (optional): ").strip()

    return {
        "company": company,
        "email": email,
        "term_months": term_months,
        "start_date": start_date,
        "end_date": end_date,
        "phone": phone,
        "gstin": gstin,
        "state_code": state_code,
    }

def sign_license_with_node(app_dir: Path, license_key: str, email: str, expires_iso: str) -> dict | None:
    node_exe = resolve_node_exe()
    if not node_exe:
        warn("Node.js not found; cannot generate license.")
        return None
    tools_dir = resolve_license_tools_dir(app_dir)
    if not tools_dir:
        warn("License keygen tools not found (tools/license-keygen missing).")
        return None
    key_path = tools_dir / "ed25519-private.pem"
    sign_script = tools_dir / "sign-license.js"
    if not key_path.exists() or not sign_script.exists():
        warn(f"License signing files missing. Expected:\n  {key_path}\n  {sign_script}")
        return None

    cmd = [
        node_exe,
        os.fspath(sign_script),
        "--key", os.fspath(key_path),
        "--license", license_key,
        "--email", email,
        "--expires", expires_iso,
    ]
    out = run_out(cmd, check=False).strip()
    try:
        payload = json.loads(out)
        return payload
    except Exception:
        warn("License signing failed. Output was not JSON.")
        return None

def save_license_txt(payload: dict, downloads_dir: Path) -> Path | None:
    try:
        downloads_dir.mkdir(parents=True, exist_ok=True)
        key = str(payload.get("license_key", "license"))
        out_path = downloads_dir / f"{key}.txt"
        out_path.write_text(
            "\n".join([
                f"license_key={payload.get('license_key','')}",
                f"email={payload.get('email','')}",
                f"expires_at={payload.get('expires_at','')}",
                f"signature={payload.get('signature','')}",
            ]) + "\n",
            encoding="utf-8"
        )
        return out_path
    except Exception as e:
        warn(f"Could not write license file to Downloads: {e}")
        return None

def apply_license(app_port: int, payload: dict) -> bool:
    try:
        body = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            f"http://127.0.0.1:{app_port}/api/license/verify-key",
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            if data.get("ok"):
                ok("License applied successfully.")
                return True
            warn(f"License apply failed: {data}")
    except Exception as e:
        warn(f"License apply request failed: {e}")
    return False

def apply_business_settings(app_port: int, company: str, email: str, phone: str, gstin: str, state_code: str):
    value_json = { "name": company }
    if email:
        value_json["email"] = email
    if phone:
        value_json["phone"] = phone
    if gstin:
        value_json["gstin"] = gstin
    if state_code:
        value_json["state_code"] = state_code
    payload = {"key": "business", "value_json": value_json}
    try:
        body = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            f"http://127.0.0.1:{app_port}/api/settings",
            data=body,
            headers={"Content-Type": "application/json"},
            method="PATCH",
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            if resp.status == 200:
                ok("Business settings updated from installer.")
                return True
    except Exception as e:
        warn(f"Business settings update failed: {e}")
    return False

def ensure_license_keys(app_src_dir: Path) -> bool:
    """
    Ensure ed25519 private key exists (for signing). If missing, attempt to generate with init-keys.js.
    Returns True if private key exists after this step.
    """
    tools_dir = resolve_license_tools_dir(app_src_dir)
    if not tools_dir:
        warn("License keygen tools not found (tools/license-keygen missing).")
        return False
    key_path = tools_dir / "ed25519-private.pem"
    if key_path.exists():
        return True
    node_exe = resolve_node_exe()
    init_script = tools_dir / "init-keys.js"
    if node_exe and init_script.exists():
        warn("License private key missing. Generating new keypair locally…")
        if platform.system() == "Windows":
            run(["powershell","-NoProfile","-Command", f"cd '{os.fspath(tools_dir)}'; & '{node_exe}' .\\init-keys.js"], check=False)
        else:
            run(["bash","-lc", f"cd '{os.fspath(tools_dir)}' && '{node_exe}' ./init-keys.js"], check=False)
    return key_path.exists()

# ---------- Main ----------

def main():
    ap = argparse.ArgumentParser(description="AxEin – Bootstrap (cross-platform)")
    ap.add_argument("--repo", default=REPO_DEFAULT, help=f"Git repo URL (default: {REPO_DEFAULT})")
    ap.add_argument("--branch", default=BRANCH_DEFAULT, help=f"Git branch (default: {BRANCH_DEFAULT})")
    ap.add_argument("--app-port", type=int, default=3000)

    # DB & system
    ap.add_argument("--db-name", default=DB_NAME_DEFAULT)
    ap.add_argument("--db-user", default=DB_USER_DEFAULT)
    ap.add_argument("--db-pass", default=DB_PASS_DEFAULT)
    ap.add_argument("--pg-superuser", default=PG_SUPERUSER_DEFAULT)
    ap.add_argument("--pg-superpwd", default=PG_SUPERPWD_DEFAULT)
    ap.add_argument("--tz", default=TZ_DEFAULT)

    # Options
    ap.add_argument("--force-clean", action="store_true", help="DESTROYS existing Postgres data for a clean init.")
    ap.add_argument("--license-public-key", default="", help="SPKI base64 for LICENSE_PUBLIC_KEY (optional).")
    ap.add_argument("--no-redis", action="store_true", help="Skip Redis service.")
    ap.add_argument("--no-mailpit", action="store_true", help="Skip Mailpit (SMTP dev inbox) service.")
    ap.add_argument("--no-minio", action="store_true", help="Skip MinIO service & seeding.")
    ap.add_argument("--web-image", default=WEB_IMAGE_DEFAULT, help="Prebuilt web image (GHCR). Empty = build from source.")
    ap.add_argument("--pick-tag", action="store_true", help="Show GHCR tag picker even if a tag is specified.")
    ap.add_argument("--build-from-source", action="store_true", help="Force build from source (ignore --web-image).")
    ap.add_argument("--no-reexec", action="store_true", help="Disable self-update/reexec from repo.")
    ap.add_argument("--ghcr-username", default="", help="GHCR username for docker login")
    ap.add_argument("--ghcr-token", default="", help="GitHub PAT with read:packages for GHCR tag listing")
    ap.add_argument("--seed-activation", action="store_true", help="Seed a baseline 'activation' settings row if missing.")

    args = ap.parse_args()

    host_os = platform.system()
    host_arch = platform.machine() or ""

    print()
    print("=== AxEin Installer ===")
    print(f"Script: {os.path.abspath(__file__)}")
    print(f"Detected host: {host_os} / {host_arch}")
    print("1) Windows\n2) mac/Linux")
    choice = input("Install target [1/2] (Enter to auto-detect): ").strip()
    target = "Windows" if (choice == "1" or (choice == "" and host_os == "Windows")) else ("Unix" if choice == "2" else ("Unix" if host_os != "Windows" else "Windows"))

    if target == "Windows":
        root_dir = Path(r"C:\AxEin")
        helper_dir = Path(r"C:\Program Files\AxEin")
    else:
        root_dir = Path.home() / "AxEin"
        helper_dir = Path.home() / ".axein"

    repo_dir    = root_dir / "app"
    logs_dir    = root_dir / "logs"
    data_dir    = root_dir / "data"
    pgdata_dir  = data_dir / "postgres"
    init_dir    = root_dir / "init"
    backups_dir = root_dir / "backups" / "postgres"
    compose_file= root_dir / "docker-compose.yml"
    env_file    = root_dir / ".env"

    # ---------- Preflight ----------
    preinstall_and_preflight(args, target=("Windows" if target=="Windows" else "Unix"), root_dir=root_dir)

    repo_url = args.repo.strip()
    if not repo_url:
        repo_url = input(f"Enter your Git repo URL (Enter for {REPO_DEFAULT}): ").strip() or REPO_DEFAULT
    ok(f"Using repo: {repo_url} (branch: {args.branch})")

    for p in [repo_dir, logs_dir, data_dir, pgdata_dir, init_dir, backups_dir]:
        ensure_dir(p)

    if args.force_clean and pgdata_dir.exists():
        warn(f"ForceClean: removing {pgdata_dir} (DESTROYS existing Postgres data)")
        shutil.rmtree(pgdata_dir, ignore_errors=True)
        ensure_dir(pgdata_dir)

    # Requires
    require("git", "Install Git first.")
    require("docker", "Install Docker Desktop (Windows/mac) or Docker Engine (Linux). Start Docker before running.")
    rc = run(["docker","compose","version"], check=False)
    if rc != 0:
        fail("Docker Compose plugin missing. Install Docker Desktop >= v2.20 or Docker Compose v2.")
        sys.exit(2)

    # GHCR login (optional but recommended for tag listing/private pulls)
    if args.web_image and args.web_image.strip() and args.ghcr_username and args.ghcr_token:
        docker_login_ghcr(args.ghcr_username, args.ghcr_token, target)

    # Web image selection: default to image (recommended for Windows)
    picked_image: str | None = None
    if args.build_from_source:
        ok("Build-from-source requested; skipping web image.")
        picked_image = None
    else:
        web_image = (args.web_image or "").strip()
        if web_image:
            # If GHCR image and no creds, prompt
            if web_image.startswith("ghcr.io/") and not args.ghcr_token:
                prompt = input("GHCR image may be private. Login now? [Y/n]: ").strip().lower()
                if prompt in ("", "y", "yes"):
                    default_user = web_image.split("/")[1] if "/" in web_image else GHCR_OWNER_DEFAULT
                    gh_user = input(f"GHCR username (default {default_user}): ").strip() or default_user
                    gh_token = input("GHCR token (PAT with read:packages): ").strip()
                    if gh_token:
                        args.ghcr_username = gh_user
                        args.ghcr_token = gh_token
                        docker_login_ghcr(gh_user, gh_token, target)
            # If a tag is already provided, use it directly (skip picker)
            has_tag = (":" in web_image and web_image.rfind(":") > web_image.rfind("/"))
            if has_tag and not args.pick_tag:
                picked_image = web_image
            else:
                if args.ghcr_token:
                    picked_image = choose_web_image(web_image, args.ghcr_token.strip())
                else:
                    picked_image = web_image if ":" in web_image else f"{web_image}:latest"
            ok(f"Using web image: {picked_image}")
        else:
            ok("No --web-image provided; will build web from source (local image).")

    # Clone/pull
    if (repo_dir / ".git").exists():
        info(f"Repo exists, pulling latest ({args.branch})…")
        run(["git","-C",os.fspath(repo_dir),"fetch","--all","--prune"], check=False)
        run(["git","-C",os.fspath(repo_dir),"checkout",args.branch])
        run(["git","-C",os.fspath(repo_dir),"pull","--ff-only","origin",args.branch], check=False)
    else:
        info(f"Cloning {repo_url} ({args.branch}) into {repo_dir}…")
        run(["git","clone","--branch",args.branch,"--single-branch",repo_url,os.fspath(repo_dir)])
    ok("Source code ready.")

    # If running from a copied script, re-exec from repo for latest fixes
    maybe_reexec_with_repo_script(repo_dir, allow_reexec=(not args.no_reexec))

    app_src_dir = resolve_app_src(repo_dir)

    # Discover LICENSE_PUBLIC_KEY automatically
    discovered_key = load_license_pubkey(app_src_dir, args.license_public_key.strip() or None)
    if discovered_key:
        ok(f"LICENSE_PUBLIC_KEY detected (starts with): {discovered_key[:16]}…")
    else:
        tools_dir = resolve_license_tools_dir(app_src_dir)
        info_path = (tools_dir / "info.json") if tools_dir else (app_src_dir / "tools" / "license-keygen" / "info.json")
        warn(f"LICENSE_PUBLIC_KEY not found. Expected at: {info_path}")
        # Attempt to generate keys if missing
        if ensure_license_keys(app_src_dir):
            discovered_key = load_license_pubkey(app_src_dir, args.license_public_key.strip() or None)
            if discovered_key:
                ok(f"LICENSE_PUBLIC_KEY generated (starts with): {discovered_key[:16]}…")

    # Ask for license details early and generate payload for copy/paste
    license_payload = None
    try:
        # Ensure signing key exists (generates local keypair if missing)
        _ = ensure_license_keys(app_src_dir)
        # Reload public key if it was generated
        discovered_key = load_license_pubkey(app_src_dir, args.license_public_key.strip() or None)
        if discovered_key:
            ok(f"LICENSE_PUBLIC_KEY detected (starts with): {discovered_key[:16]}…")

        gen_now = input("Generate license payload now? [Y/n]: ").strip().lower()
        if gen_now in ("", "y", "yes"):
            details = prompt_license_details()
            license_key = generate_license_key()
            expires_iso = f"{details['end_date']}T23:59:59.000Z"
            license_payload = sign_license_with_node(
                app_dir=app_src_dir,
                license_key=license_key,
                email=details["email"],
                expires_iso=expires_iso,
            )
            if license_payload:
                print("\n--- License Payload (copy/paste) ---")
                print(json.dumps(license_payload, indent=2))
                print("------------------------------------\n")
                home = Path(os.path.expanduser("~"))
                downloads = home / "Downloads"
                saved = save_license_txt(license_payload, downloads)
                if saved:
                    ok(f"License saved to: {saved}")
    except Exception as e:
        warn(f"License generation skipped due to error: {e}")

    # Compose & env (always GENERATED)
    write_compose(dest=compose_file, root_dir=root_dir, app_dir=app_src_dir, app_port=args.app_port, tz=args.tz,
                  db_user=args.db_user, db_pass=args.db_pass, db_name=args.db_name,
                  pg_superuser=args.pg_superuser, pg_superpwd=args.pg_superpwd,
                  license_pubkey=discovered_key,
                  enable_redis=(not args.no_redis),
                  enable_mailpit=(not args.no_mailpit),
                  enable_minio=(not args.no_minio), web_image=(picked_image or None),
                  host_os=host_os, host_arch=host_arch)

    write_env_file(dest=env_file, app_port=args.app_port, tz=args.tz, db_user=args.db_user, db_pass=args.db_pass,
                   db_name=args.db_name,
                   enable_redis=(not args.no_redis),
                   enable_mailpit=(not args.no_mailpit),
                   enable_minio=(not args.no_minio),
                   base_url=f"http://localhost:{args.app_port}", license_pubkey=discovered_key)

    # First-run SQL
    write_init_sql(init_dir, args.db_user, args.db_pass, args.db_name)

    # Pull / Up
    # Pre-pull web image to catch auth/tag errors early
    if picked_image:
        info(f"Pulling web image: {picked_image}")
        web_rc = run(["docker","pull", picked_image], check=False)
        if web_rc != 0:
            warn("Web image pull failed.")
            fallback = input("Switch to build-from-source instead? [Y/n]: ").strip().lower()
            if fallback in ("", "y", "yes"):
                picked_image = None
                write_compose(dest=compose_file, root_dir=root_dir, app_dir=app_src_dir, app_port=args.app_port, tz=args.tz,
                              db_user=args.db_user, db_pass=args.db_pass, db_name=args.db_name,
                              pg_superuser=args.pg_superuser, pg_superpwd=args.pg_superpwd,
                              license_pubkey=discovered_key,
                              enable_redis=(not args.no_redis),
                              enable_mailpit=(not args.no_mailpit),
                              enable_minio=(not args.no_minio), web_image=None,
                              host_os=host_os, host_arch=host_arch)

    info("Pulling container images…")
    retry(lambda: run(["docker","compose","-f",os.fspath(compose_file),"pull"], check=False), attempts=3, delay=5, what="compose pull")

    info("Starting containers (first time may take a few minutes)…")
    retry(lambda: run(["docker","compose","-f",os.fspath(compose_file),"up","-d","--build"], check=False), attempts=2, delay=5, what="compose up")

    # Health: DB
    if not wait_for_service(compose_file, "db", ["pg_isready","-U",args.pg_superuser], timeout_sec=180):
        sys.exit(5)

    ensure_role_db_after_start(compose_file, args.db_name, args.db_user, args.db_pass, args.pg_superuser)

    # Ensure JSONB meta exists before migrations (prevents early API writes from failing)
    ensure_products_meta(compose_file, args.db_name, args.db_user)
    ensure_sales_meta(compose_file, args.db_name, args.db_user)
    ensure_sale_items_meta(compose_file, args.db_name, args.db_user)

    # Auto-migrate if needed
    if not auto_migrate(compose_file, app_src_dir, args.db_name, args.db_user):
        warn("Attempting a second migration pass after grants…")
        ensure_role_db_after_start(compose_file, args.db_name, args.db_user, args.db_pass, args.pg_superuser)
        ensure_products_meta(compose_file, args.db_name, args.db_user)
        ensure_sales_meta(compose_file, args.db_name, args.db_user)
        ensure_sale_items_meta(compose_file, args.db_name, args.db_user)
        if not auto_migrate(compose_file, app_src_dir, args.db_name, args.db_user):
            fail("Database migrations failed. Check SQL under app/db/migrations and DB logs.")

    # Optional post-migration seeds
    if args.seed_activation:
        seed_activation_if_missing(compose_file, args.db_name, args.db_user)
    seed_settings_defaults(compose_file, args.db_name, args.db_user)

    # Wait for web & smoke tests
    if not wait_for_web_ready(args.app_port, compose_file, timeout_sec=240):
        warn(f"Web did not return 200 on /. Run 'docker compose -f {compose_file} logs -f web' for details.")
    all_ok = smoke_tests(args.app_port)

    # Apply license (optional) once web is up
    if license_payload:
        try:
            do_apply = input("Apply license to running app now? [Y/n]: ").strip().lower()
            if do_apply in ("", "y", "yes"):
                apply_license(args.app_port, license_payload)
        except Exception as e:
            warn(f"License apply skipped due to error: {e}")

    # Helper
    ensure_dir(helper_dir)
    if target == "Windows":
        helper = helper_dir / "axein.cmd"
        helper.write_text(f"""@echo off
setlocal enableextensions
set COMPOSE={os.fspath(compose_file)}
set PROJECT=axein
set APPURL=http://localhost:{args.app_port}
if "%~1"=="" goto :help
if /I "%~1"=="open"    start "" "%APPURL%" & goto :eof
if /I "%~1"=="status"  docker compose -f "%COMPOSE%" -p "%PROJECT%" ps & goto :eof
if /I "%~1"=="logs"    docker compose -f "%COMPOSE%" -p "%PROJECT%" logs -f --since=10m web & goto :eof
if /I "%~1"=="restart" docker compose -f "%COMPOSE%" -p "%PROJECT%" restart & goto :eof
if /I "%~1"=="down"    docker compose -f "%COMPOSE%" -p "%PROJECT%" down & goto :eof
:help
echo AxEin helper - commands:
echo   axein open        # open app
echo   axein status      # compose ps
echo   axein logs        # follow logs
echo   axein restart     # restart containers
echo   axein down        # stop & remove
goto :eof
""", encoding="utf-8")
        ok(f"Helper installed at {helper}.")
    else:
        helper_bin = helper_dir / "axein"
        helper_bin.write_text(f"""#!/usr/bin/env bash
set -euo pipefail
COMPOSE="{os.fspath(compose_file)}"
PROJECT=axein
APPURL="http://localhost:{args.app_port}"
case "${{1-}}" in
  open)    open "$APPURL" 2>/dev/null || xdg-open "$APPURL" ;;
  status)  docker compose -f "$COMPOSE" -p "$PROJECT" ps ;;
  logs)    docker compose -f "$COMPOSE" -p "$PROJECT" logs -f --since=10m web ;;
  restart) docker compose -f "$COMPOSE" -p "$PROJECT" restart ;;
  down)    docker compose -f "$COMPOSE" -p "$PROJECT" down ;;
  *) echo "Usage: axein [open|status|logs|restart|down]" ;;
esac
""", encoding="utf-8")
        os.chmod(helper_bin, 0o755)
        ok(f"Helper installed at {helper_bin}.")

    if all_ok:
        ok(f"✅ AxEin is up! Open: http://localhost:{args.app_port}")
    else:
        warn("AxEin started, but some endpoints failed smoke tests. Check logs.")

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print()
        warn("Cancelled by user.")
        sys.exit(130)
