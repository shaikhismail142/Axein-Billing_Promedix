#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
AxEin – Bootstrap (Python)
v7.4 (fixed)
- Interactive GHCR tag picker (sorted by last update) when GHCR token provided
- Align S3 env names: S3_KEY / S3_SECRET
- MinIO console mapped 9003:9001 & healthcheck; web depends_on service_healthy
- LICENSE_PUBLIC_KEY discovery: info.json (publicKeyBase64 or publicKey_spki_base64) + .env.template/.env.example
- Add Mailpit service + depends_on
- Robust SQL migration apply (detects running db container id instead of assuming name)
- Expanded EXPECTED_TABLES to include inventory & notifications (uses stock_movements, not stock_ledger)
- Adds optional seed for near_expiry_days + minimal business_profile
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
from datetime import datetime

# ---------- Defaults ----------
DB_NAME_DEFAULT      = "axeindb"
DB_USER_DEFAULT      = "axeindb"
DB_PASS_DEFAULT      = "axeindbpass"
PG_SUPERUSER_DEFAULT = "postgres"
PG_SUPERPWD_DEFAULT  = "postgrespass"
TZ_DEFAULT           = "Asia/Kolkata"
WEB_IMAGE_DEFAULT    = "ghcr.io/shaikhismail142/axein-billing:latest"
GHCR_OWNER_DEFAULT   = "shaikhismail142"
GHCR_NAME_DEFAULT    = "axein-billing"

# Used as a simple "is schema present?" gate before/after migrations
EXPECTED_TABLES = [
    # core
    "settings", "customers", "products",
    # sales/quotes
    "sales", "sale_items", "quotations",
    # inventory & purchases (canonical table/column names in current app)
    "suppliers", "purchases", "purchase_items", "product_batches", "stock_movements",
    # adjustments (present in newer setups; harmless if absent, but helps bootstraps run migrations)
    "inventory_adjustments", "inventory_adjustment_items",
    # notifications
    "notifications",
]

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

    # 2) tools/license-keygen/info.json
    info_json = app_dir / "tools" / "license-keygen" / "info.json"
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
    for env_candidate in (app_dir / ".env.template", app_dir / ".env.example"):
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

    web_dep_minio = "\n      minio:\n        condition: service_healthy" if enable_minio else ""

    if web_image:
        web_block = f"""
  web:
    image: {web_image}{service_platform_yaml}
    pull_policy: always
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_started{web_dep_minio}
      mailpit:
        condition: service_started
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
      REDIS_HOST: redis
      REDIS_PORT: "6379"
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
      redis:
        condition: service_started{web_dep_minio}
      mailpit:
        condition: service_started
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
      REDIS_HOST: redis
      REDIS_PORT: "6379"
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
"""

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
  redis:
    image: redis:7
    ports: ["6379:6379"]
    restart: unless-stopped
{minio_service}{mailpit_block}{web_block}
"""
    dest.write_text(compose, encoding="utf-8")
    ok(f"docker-compose.yml written at {dest}")

# ---------- .env generation ----------

def write_env_file(dest: Path, app_port: int, tz: str, db_user: str, db_pass: str, db_name: str,
                   enable_minio: bool, base_url: str, license_pubkey: str | None):
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
        f"REDIS_HOST=redis",
        f"REDIS_PORT=6379",
        "HOST=0.0.0.0",
        "NEXT_TELEMETRY_DISABLED=1",
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
        "ALTER TABLE products ADD COLUMN IF NOT EXISTS meta JSONB NOT NULL DEFAULT '{}'::jsonb;"
    ], check=False)


def tables_missing(compose_file: Path, db_name: str, db_user: str) -> list[str]:
    q = "SELECT tablename FROM pg_tables WHERE schemaname='public';"
    out = run_out(["docker","compose","-f",os.fspath(compose_file),"exec","-T","db","psql","-U",db_user,"-d",db_name,"-Atqc",q], check=False)
    have = set([t.strip() for t in out.splitlines() if t.strip()])
    missing = [t for t in EXPECTED_TABLES if t not in have]
    return missing


def migration_candidates(app_dir: Path) -> list[Path]:
    mig_dir = app_dir / "db" / "migrations"
    candidates = sorted(Path(p) for p in glob(os.path.join(os.fspath(mig_dir), "*.sql")))
    if candidates:
        return candidates
    fallback = mig_dir / "999_app_compat.sql"
    return [fallback] if fallback.exists() else []


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
    missing = tables_missing(compose_file, db_name, db_user)
    if not missing:
        ok("Schema present. No migration needed.")
        return True

    warn(f"Missing tables detected: {', '.join(missing)}")
    cands = migration_candidates(app_dir)
    if not cands:
        fail("No migration SQL found (app/db/migrations/*.sql).")
        return False

    info(f"Applying {len(cands)} migration file(s)…")
    all_ok = True
    for fp in cands:
        ok(f"→ {fp.name}")
        if not apply_sql_file(compose_file, fp, db_name, db_user):
            all_ok = False
            warn(f"Migration failed for {fp.name}")
            break

    still_missing = tables_missing(compose_file, db_name, db_user)
    if still_missing:
        fail(f"Still missing after migration: {', '.join(still_missing)}")
        return False

    ok("Migrations complete and schema verified.")
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
    # near_expiry_days
    q = "SELECT 1 FROM settings WHERE key='near_expiry_days' LIMIT 1;"
    out = run_out(["docker","compose","-f",os.fspath(compose_file),"exec","-T","db",
                   "psql","-U",db_user,"-d",db_name,"-Atqc",q], check=False).strip()
    if out != "1":
        run(["docker","compose","-f",os.fspath(compose_file),"exec","-T","db","psql",
             "-U",db_user,"-d",db_name,"-v","ON_ERROR_STOP=1",
             "-c","INSERT INTO settings(key,value_json) VALUES ('near_expiry_days','180') ON CONFLICT (key) DO NOTHING;"], check=False)
        ok("Seeded near_expiry_days=180")

    # business_profile
    q2 = "SELECT 1 FROM settings WHERE key='business_profile' LIMIT 1;"
    out2 = run_out(["docker","compose","-f",os.fspath(compose_file),"exec","-T","db",
                    "psql","-U",db_user,"-d",db_name,"-Atqc",q2], check=False).strip()
    if out2 != "1":
        upsert = r"""INSERT INTO settings(key,value_json) VALUES ('business_profile', jsonb_build_object(
           'company_name','Your Company','address_line1','','address_line2','','city','',
           'state','','pincode','','phone','','email','','website','','gstin',''
        )) ON CONFLICT (key) DO NOTHING;"""
        run(["docker","compose","-f",os.fspath(compose_file),"exec","-T","db","psql",
             "-U",db_user,"-d",db_name,"-v","ON_ERROR_STOP=1","-c",upsert], check=False)
        ok("Seeded minimal business_profile")

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

    ports = [args.app_port, 5432, 6379]
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


def choose_web_image(base_image_default: str, owner: str, name: str, ghcr_token: str) -> str:
    """
    Present interactive selection of tags (newest first). If no token or listing fails,
    ask user for a tag or keep default.
    """
    default_image = base_image_default
    default_tag = default_image.split(":")[-1] if ":" in default_image else "latest"
    tag_rows = ghcr_list_tags(owner, name, ghcr_token) if ghcr_token else []

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
                return f"ghcr.io/{owner}/{name}:{picked}"
        elif sel:
            ok(f"Selected tag: {sel}")
            return f"ghcr.io/{owner}/{name}:{sel}"
        ok(f"Using default tag: {default_tag}")
        return f"ghcr.io/{owner}/{name}:{default_tag}"
    else:
        # No list (public/no token). Ask loosely.
        prompt = input(f"Enter image tag (Enter for '{default_tag}'): ").strip()
        tag = prompt or default_tag
        return f"ghcr.io/{owner}/{name}:{tag}"

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

# ---------- Main ----------

def main():
    ap = argparse.ArgumentParser(description="AxEin – Bootstrap (cross-platform)")
    ap.add_argument("--repo", default="", help="Git repo URL (HTTPS/SSH). If empty, you will be prompted.")
    ap.add_argument("--branch", default="main")
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
    ap.add_argument("--no-minio", action="store_true", help="Skip MinIO service & seeding.")
    ap.add_argument("--web-image", default=WEB_IMAGE_DEFAULT, help="Prebuilt web image (GHCR). Empty = build from source.")
    ap.add_argument("--ghcr-username", default="", help="GHCR username for docker login")
    ap.add_argument("--ghcr-token", default="", help="GitHub PAT with read:packages for GHCR tag listing")
    ap.add_argument("--seed-activation", action="store_true", help="Seed a baseline 'activation' settings row if missing.")

    args = ap.parse_args()

    host_os = platform.system()
    host_arch = platform.machine() or ""

    print()
    print("=== AxEin Installer ===")
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

    app_dir     = root_dir / "app"
    logs_dir    = root_dir / "logs"
    data_dir    = root_dir / "data"
    pgdata_dir  = data_dir / "postgres"
    init_dir    = root_dir / "init"
    backups_dir = root_dir / "backups" / "postgres"
    compose_file= root_dir / "docker-compose.yml"
    env_file    = root_dir / ".env"

    # ---------- Preflight ----------
    preinstall_and_preflight(args, target=("Windows" if target=="Windows" else "Unix"), root_dir=root_dir)

    repo_url = args.repo.strip() or input("Enter your Git repo URL (HTTPS/SSH): ").strip()
    if not repo_url:
        fail("Repo URL is required.")
        sys.exit(2)

    for p in [app_dir, logs_dir, data_dir, pgdata_dir, init_dir, backups_dir]:
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
    if args.ghcr_username and args.ghcr_token and args.web_image:
        info("Logging into GHCR…")
        if target == "Unix":
            run(["bash","-lc", f"echo '{args.ghcr_token}' | docker login ghcr.io -u {args.ghcr_username} --password-stdin"], check=False)
        else:
            run(["powershell","-NoProfile","-Command", f"$p='{args.ghcr_token}'; $p | docker login ghcr.io -u {args.ghcr_username} --password-stdin"], check=False)
        ok("GHCR login attempted.")

    # Interactive web image selection (GHCR)
    owner, name = GHCR_OWNER_DEFAULT, GHCR_NAME_DEFAULT
    picked_image = choose_web_image(args.web_image or WEB_IMAGE_DEFAULT, owner, name, args.ghcr_token.strip())
    ok(f"Using web image: {picked_image}")

    # Clone/pull
    if (app_dir / ".git").exists():
        info(f"Repo exists, pulling latest ({args.branch})…")
        run(["git","-C",os.fspath(app_dir),"fetch","--all","--prune"], check=False)
        run(["git","-C",os.fspath(app_dir),"checkout",args.branch])
        run(["git","-C",os.fspath(app_dir),"pull","--ff-only","origin",args.branch], check=False)
    else:
        info(f"Cloning {repo_url} ({args.branch}) into {app_dir}…")
        run(["git","clone","--branch",args.branch,"--single-branch",repo_url,os.fspath(app_dir)])
    ok("Source code ready.")

    # Discover LICENSE_PUBLIC_KEY automatically
    discovered_key = load_license_pubkey(app_dir, args.license_public_key.strip() or None)
    if discovered_key:
        ok(f"LICENSE_PUBLIC_KEY detected (starts with): {discovered_key[:16]}…")

    # Compose & env (always GENERATED)
    write_compose(dest=compose_file, root_dir=root_dir, app_dir=app_dir, app_port=args.app_port, tz=args.tz,
                  db_user=args.db_user, db_pass=args.db_pass, db_name=args.db_name,
                  pg_superuser=args.pg_superuser, pg_superpwd=args.pg_superpwd,
                  license_pubkey=discovered_key,
                  enable_minio=(not args.no_minio), web_image=(picked_image or None),
                  host_os=host_os, host_arch=host_arch)

    write_env_file(dest=env_file, app_port=args.app_port, tz=args.tz, db_user=args.db_user, db_pass=args.db_pass,
                   db_name=args.db_name, enable_minio=(not args.no_minio),
                   base_url=f"http://localhost:{args.app_port}", license_pubkey=discovered_key)

    # First-run SQL
    write_init_sql(init_dir, args.db_user, args.db_pass, args.db_name)

    # Pull / Up
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

    # Auto-migrate if needed
    if not auto_migrate(compose_file, app_dir, args.db_name, args.db_user):
        warn("Attempting a second migration pass after grants…")
        ensure_role_db_after_start(compose_file, args.db_name, args.db_user, args.db_pass, args.pg_superuser)
        ensure_products_meta(compose_file, args.db_name, args.db_user)
        if not auto_migrate(compose_file, app_dir, args.db_name, args.db_user):
            fail("Database migrations failed. Check SQL under app/db/migrations and DB logs.")

    # Optional post-migration seeds
    if args.seed_activation:
        seed_activation_if_missing(compose_file, args.db_name, args.db_user)
    seed_settings_defaults(compose_file, args.db_name, args.db_user)

    # Wait for web & smoke tests
    if not wait_for_web_ready(args.app_port, compose_file, timeout_sec=240):
        warn(f"Web did not return 200 on /. Run 'docker compose -f {compose_file} logs -f web' for details.")
    all_ok = smoke_tests(args.app_port)

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
