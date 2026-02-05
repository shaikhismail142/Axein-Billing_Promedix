<# ======================================================================
  AxEin – Windows Bootstrap (Dependencies · Clone/Update · Compose · Shortcuts)
  v1 (no-backup edition)

  What it does
  - Ensures winget, Git, Docker Desktop
  - Clones/updates your app repo into C:\AxEin\app
  - Writes docker-compose.yml for db/redis/minio/web
  - Seeds Postgres on FIRST init only (docker-entrypoint-initdb.d)
  - Brings stack up & checks health
  - Installs an `axein` helper and Start-menu/Desktop shortcuts

  What it does NOT do
  - No DB role/database fixing for reused clusters
  - No backup scheduling (by request)

  Usage (Run as Admin):
    .\axein_bootstrap.ps1 -RepoUrl "https://github.com/yourorg/yourapp.git" -Branch main
====================================================================== #>

param(
  [Parameter(Mandatory=$false)]
  [string] $RepoUrl = "",
  [Parameter(Mandatory=$false)]
  [string] $Branch  = "main",
  [Parameter(Mandatory=$false)]
  [int]    $AppPort = 3000,
  # DANGEROUS: wipes Postgres data to force a clean init (off by default)
  [switch] $ForceClean
)

# --------------------- Globals & Utils --------------------------------
$ErrorActionPreference = 'Stop'
if ($PSStyle -and $PSStyle.OutputRendering) { $PSStyle.OutputRendering = 'ANSI' }  # PS 7+ pretties

$AXEIN_ROOT     = 'C:\AxEin'
$APP_DIR        = Join-Path $AXEIN_ROOT 'app'
$LOGS_DIR       = Join-Path $AXEIN_ROOT 'logs'
$DATA_DIR       = Join-Path $AXEIN_ROOT 'data'
$PGDATA_DIR     = Join-Path $DATA_DIR 'postgres'
$PGINIT_DIR     = Join-Path $AXEIN_ROOT 'init'
$MINIO_DATA_DIR = Join-Path $DATA_DIR 'minio'
$BACKUPS_DIR    = Join-Path $AXEIN_ROOT 'backups\postgres'  # kept for mounting; not used here
$COMPOSE_FILE   = Join-Path $AXEIN_ROOT 'docker-compose.yml'
$HELPER_PATH    = 'C:\Program Files\AxEin'
$HELPER_EXE     = Join-Path $HELPER_PATH 'axein.ps1'

# App/DB settings (these are for the **application user** your app uses)
$DB_NAME  = 'axeindb'
$DB_USER  = 'axeindb'
$DB_PASS  = 'axeindbpass'
$TZ       = 'Asia/Kolkata'

# Postgres superuser inside container (default image’s bootstrap user)
$PG_SUPERUSER = 'postgres'
$PG_SUPERPWD  = 'postgrespass'  # only used on FIRST init; harmless for existing clusters

function Title($t){ Write-Host ""; Write-Host "══ $t ══" -ForegroundColor Cyan }
function Info ($m){ Write-Host "[axein] $m" -ForegroundColor Cyan }
function Ok   ($m){ Write-Host "[ok]    $m" -ForegroundColor Green }
function Warn ($m){ Write-Host "[warn]  $m" -ForegroundColor Yellow }
function Fail ($m){ Write-Host "[err]   $m" -ForegroundColor Red }

# --------------------- Preflight --------------------------------------
Title "AxEin Bootstrap"
if (-not ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole] "Administrator")) { Fail "Please run PowerShell as Administrator."; exit 1 }

# Ask for repo only if not supplied
if (-not $RepoUrl) {
  $RepoUrl = Read-Host -Prompt "Enter your Git repo URL (HTTPS/SSH)"
  if ([string]::IsNullOrWhiteSpace($RepoUrl)) { Fail "Repo URL is required."; exit 2 }
}

Info "Preparing folders under $AXEIN_ROOT"
$null = New-Item -Force -ItemType Directory -Path $APP_DIR, $LOGS_DIR, $PGDATA_DIR, $PGINIT_DIR, $MINIO_DATA_DIR, $BACKUPS_DIR

# Optionally nuke Postgres data for a clean first init
if ($ForceClean) {
  Warn "ForceClean: removing $PGDATA_DIR (DESTROYS existing Postgres data)"
  try { Remove-Item -Recurse -Force -ErrorAction Stop $PGDATA_DIR } catch { Fail "Failed to remove PGDATA: $($_.Exception.Message)"; exit 3 }
  $null = New-Item -Force -ItemType Directory -Path $PGDATA_DIR
}

# Backups ACL (helps Docker write if you later enable backups)
try {
  $acl  = Get-Acl $BACKUPS_DIR
  $rule = New-Object System.Security.AccessControl.FileSystemAccessRule('Authenticated Users','Modify','ContainerInherit,ObjectInherit','None','Allow')
  $has  = $false
  foreach ($r in $acl.Access) {
    if ($r.IdentityReference -like '*Authenticated Users*' -and
        ($r.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::Modify)) { $has = $true; break }
  }
  if (-not $has) { $acl.AddAccessRule($rule) | Out-Null; Set-Acl -Path $BACKUPS_DIR -AclObject $acl }
} catch { Warn ("Could not adjust ACLs on $($BACKUPS_DIR): $($_.Exception.Message)") }
Ok "Folders ready"

# --------------------- Ensure winget, Git, Docker ---------------------
Title "Prerequisites"
function Ensure-WinGet { try { Get-Command winget -ErrorAction Stop | Out-Null } catch { Warn "winget not found. Install 'App Installer' from Microsoft Store, then re-run."; throw } }
function Ensure-App($id, $name) {
  try {
    $found = (winget list --id $id 2>$null | Select-String $id)
    if (-not $found) { Info "Installing $name via winget"; winget install --id $id --accept-source-agreements --accept-package-agreements --silent; Ok "$name installed" }
    else { Ok "$name already installed" }
  } catch { Warn "winget install for $name hit an issue: $($_.Exception.Message)" }
}

Ensure-WinGet
Ensure-App -id 'Git.Git' -name 'Git'
Ensure-App -id 'Docker.DockerDesktop' -name 'Docker Desktop'
try {
  if (-not (Get-Process -Name 'Docker Desktop' -ErrorAction SilentlyContinue)) {
    Info "Starting Docker Desktop…"; Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe" -Verb RunAs | Out-Null
  } else { Ok "Docker Desktop already running" }
} catch { Warn "Could not start Docker Desktop: $($_.Exception.Message)" }

Info "Waiting for Docker engine…"
$deadline = (Get-Date).AddMinutes(5); $dockerOk = $false
while ((Get-Date) -lt $deadline) { try { $null = docker info 2>$null; if ($LASTEXITCODE -eq 0) { $dockerOk = $true; break } } catch {}; Start-Sleep 3 }
if (-not $dockerOk) { Fail "Docker Engine did not become ready. Open Docker Desktop, wait for 'Running', then re-run."; exit 4 }
Ok "Docker engine is up"

# --------------------- Clone / Update Repo ----------------------------
Title "Application Source"
function Ensure-GitRepo($repoUrl, $branch, $dest) {
  if (Test-Path (Join-Path $dest ".git")) {
    Info "Repo exists, pulling latest ($branch)…"
    Push-Location $dest
    try {
      git fetch --all --prune
      git checkout $branch
      git pull --ff-only origin $branch
    } catch { Warn "Git pull failed: $($_.Exception.Message)" }
    Pop-Location
  } else {
    Info "Cloning $repoUrl ($branch) into $dest…"
    try {
      if (-not (Test-Path $dest)) { $null = New-Item -Force -ItemType Directory -Path $dest }
      git clone --branch $branch --single-branch $repoUrl $dest
    } catch { Fail "Git clone failed: $($_.Exception.Message)"; exit 5 }
  }
  Ok "Source ready"
}
Ensure-GitRepo -repoUrl $RepoUrl -branch $Branch -dest $APP_DIR

# --------------------- Compose file -----------------------------------
Title "Compose"
Info "Writing $COMPOSE_FILE"
$composeTpl = @"
name: axein
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_USER: {PG_SUPERUSER}
      POSTGRES_PASSWORD: {PG_SUPERPWD}
      TZ: {TZ}
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U {PG_SUPERUSER}"]
      interval: 10s
      timeout: 5s
      retries: 12
    shm_size: "1g"
    volumes:
      - type: bind
        source: {PGDATA_DIR}
        target: /var/lib/postgresql/data
      - type: bind
        source: {BACKUPS_DIR}
        target: /backups
      - type: bind
        source: {PGINIT_DIR}
        target: /docker-entrypoint-initdb.d

  redis:
    image: redis:7
    ports:
      - "6379:6379"

  minio:
    image: minio/minio:latest
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    command: ["server", "/data", "--console-address", ":9001"]
    ports:
      - "9000:9000"
      - "9001:9001"
    volumes:
      - type: bind
        source: {MINIO_DATA_DIR}
        target: /data

  web:
    build:
      context: {APP_DIR}
      dockerfile: Dockerfile
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_started
      minio:
        condition: service_started
    environment:
      NODE_ENV: production
      TZ: {TZ}
      PORT: "3000"
      NEXT_PUBLIC_BASE_URL: http://localhost:{APP_PORT}
      DATABASE_URL: postgresql://{DB_USER}:{DB_PASS}@db:5432/{DB_NAME}
      POSTGRES_HOST: db
      POSTGRES_PORT: "5432"
      POSTGRES_USER: {DB_USER}
      POSTGRES_PASSWORD: {DB_PASS}
      POSTGRES_DB: {DB_NAME}
      REDIS_HOST: redis
      REDIS_PORT: "6379"
      S3_ENDPOINT: http://minio:9000
      S3_ACCESS_KEY: minioadmin
      S3_SECRET_KEY: minioadmin
      S3_BUCKET: axein
      S3_REGION: ap-south-1
      S3_FORCE_PATH_STYLE: "true"
    ports:
      - "{APP_PORT}:3000"
    restart: unless-stopped
"@

$compose = $composeTpl
$repl = @{
  '{DB_USER}'        = $DB_USER
  '{DB_PASS}'        = $DB_PASS
  '{DB_NAME}'        = $DB_NAME
  '{TZ}'             = $TZ
  '{APP_PORT}'       = "$AppPort"
  '{PGDATA_DIR}'     = ($PGDATA_DIR -replace '\\','/')
  '{BACKUPS_DIR}'    = ($BACKUPS_DIR -replace '\\','/')
  '{MINIO_DATA_DIR}' = ($MINIO_DATA_DIR -replace '\\','/')
  '{APP_DIR}'        = ($APP_DIR -replace '\\','/')
  '{PGINIT_DIR}'     = ($PGINIT_DIR -replace '\\','/')
  '{PG_SUPERUSER}'   = $PG_SUPERUSER
  '{PG_SUPERPWD}'    = $PG_SUPERPWD
}
foreach ($k in $repl.Keys) { $compose = $compose.Replace($k, $repl[$k]) }
Set-Content -Path $COMPOSE_FILE -Encoding UTF8 -Value $compose
Ok "docker-compose.yml written"

# --------------------- Init SQL (FIRST RUN ONLY) ----------------------
Title "Postgres seed (first run only)"
# This file runs ONLY when PGDATA is empty (first container init).
# It creates the application role + database. Safe to keep around.
$initSql = @"
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '{DB_USER}') THEN
    CREATE ROLE {DB_USER} WITH LOGIN PASSWORD '{DB_PASS}';
  END IF;
END
\$\$;

DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_database WHERE datname = '{DB_NAME}') THEN
    CREATE DATABASE {DB_NAME} OWNER {DB_USER};
  END IF;
END
\$\$;

GRANT ALL PRIVILEGES ON DATABASE {DB_NAME} TO {DB_USER};
"@
$initSql = $initSql.Replace('{DB_USER}', $DB_USER).Replace('{DB_PASS}', $DB_PASS).Replace('{DB_NAME}', $DB_NAME)
$initPath = Join-Path $PGINIT_DIR '00_app.sql'
Set-Content -Path $initPath -Encoding UTF8 -Value $initSql
Ok "Init SQL written: $initPath"

# --------------------- Bring up stack ---------------------------------
Title "Compose Up"
Info "Starting containers (this may take a few minutes the first time)…"
docker compose -f $COMPOSE_FILE up -d --build
if ($LASTEXITCODE -ne 0) { Fail "docker compose up failed ($LASTEXITCODE)"; exit $LASTEXITCODE }

# --------------------- Health Checks ----------------------------------
function Wait-For-DbReady {
  param([int]$TimeoutSec = 120)
  Info "Waiting for Postgres health…"
  $start = Get-Date
  while ((Get-Date) - $start -lt [TimeSpan]::FromSeconds($TimeoutSec)) {
    docker compose -f $COMPOSE_FILE exec -T db pg_isready -U $PG_SUPERUSER | Out-Null
    if ($LASTEXITCODE -eq 0) { return $true }
    Start-Sleep 3; Write-Host "." -NoNewline
  }
  Write-Host ""; return $false
}
if (-not (Wait-For-DbReady -TimeoutSec 120)) {
  Warn "Postgres did not pass readiness within timeout. The container logs may still show it’s ready."
}

# Quick ping for redis/minio containers up
$ps = docker compose -f $COMPOSE_FILE ps
$webUp = ($ps | Select-String "web"   | Select-String "Up")
$dbUp  = ($ps | Select-String "db"    | Select-String "Up")
$rdUp  = ($ps | Select-String "redis" | Select-String "Up")
$miUp  = ($ps | Select-String "minio" | Select-String "Up")
Ok ("Status: " + (@("web:$([bool]$webUp)","db:$([bool]$dbUp)","redis:$([bool]$rdUp)","minio:$([bool]$miUp)") -join "  "))

# --------------------- Helper CLI -------------------------------------
Title "Helper CLI"
Info "Installing helper: axein"
$null = New-Item -Force -ItemType Directory -Path $HELPER_PATH

$axeinScript = @'
# AxEin helper (Windows PowerShell)
param([Parameter(Position=0)][string] $cmd = '',[Parameter(ValueFromRemainingArguments=$true)][string[]] $rest)
Set-StrictMode -Version Latest; $ErrorActionPreference = 'Stop'
function Info ($m){ Write-Host "[axein] $m" -ForegroundColor Cyan }
function Ok   ($m){ Write-Host "[ok] $m"   -ForegroundColor Green }
function Warn ($m){ Write-Host "[warn] $m" -ForegroundColor Yellow }
function Fail ($m){ Write-Host "[err] $m"  -ForegroundColor Red }

$Compose = 'C:\AxEin\docker-compose.yml'
$AppUrl  = 'http://localhost:3000'

function Show-Help {
@"
AxEin helper – commands:
  axein open          # open app in browser
  axein status        # docker compose ps
  axein logs          # follow web logs
  axein db-logs       # tail db logs
  axein update        # pull/build & restart (rebuild web)
  axein restart       # restart all containers
  axein down          # stop & remove containers
  axein doctor        # diagnostics (docker versions, ports)
"@ | Write-Host
}

switch ($cmd) {
  ''| 'help' { Show-Help }
  'open'      { Start-Process $AppUrl }
  'status'    { docker compose -f $Compose ps }
  'logs'      { docker compose -f $Compose logs -f --since=10m web }
  'db-logs'   { docker compose -f $Compose logs -f --since=10m db }
  'update'    { docker compose -f $Compose pull; docker compose -f $Compose up -d --build; Ok "Updated & restarted." }
  'restart'   { docker compose -f $Compose restart }
  'down'      { docker compose -f $Compose down }
  'doctor'    {
                 Write-Host "Docker version:"; docker version
                 Write-Host "`nCompose ps:"; docker compose -f $Compose ps
                 Write-Host "`nPort check 3000:"; netstat -ano | Select-String ":3000"
              }
  default     { Show-Help; exit 64 }
}
'@
Set-Content -Path $HELPER_EXE -Value $axeinScript -Encoding UTF8

# Put helper on PATH (system)
$envPaths = [System.Environment]::GetEnvironmentVariable('Path','Machine')
if ($envPaths -notlike "*$HELPER_PATH*") { [System.Environment]::SetEnvironmentVariable('Path', ($envPaths + ";" + $HELPER_PATH), 'Machine') }

# --------------------- Shortcuts --------------------------------------
Title "Shortcuts"
$StartMenu = Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs\AxEin'
$Desktop   = [Environment]::GetFolderPath('CommonDesktopDirectory')
$null = New-Item -Force -ItemType Directory -Path $StartMenu

function New-Shortcut($name,$target,$args=''){
  $wsh=New-Object -ComObject WScript.Shell
  $sc=$wsh.CreateShortcut("$name.lnk")
  $sc.TargetPath="powershell.exe"
  $sc.Arguments="-NoExit -ExecutionPolicy Bypass -File `"$target`" $args"
  $sc.IconLocation="C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe,0"
  $sc.Save()
}
New-Shortcut (Join-Path $StartMenu 'AxEin – Status') $HELPER_EXE 'status'
New-Shortcut (Join-Path $StartMenu 'AxEin – Web Logs') $HELPER_EXE 'logs'
New-Shortcut (Join-Path $StartMenu 'AxEin – Stop')    $HELPER_EXE 'down'
Copy-Item (Join-Path $StartMenu 'AxEin – Status.lnk') $Desktop -Force
Copy-Item (Join-Path $StartMenu 'AxEin – Web Logs.lnk') $Desktop -Force
Ok "Shortcuts created (Desktop & Start Menu)"

# --------------------- Final Output -----------------------------------
Title "Done"
Ok "AxEin is up!  Open the app: http://localhost:$AppPort"
Write-Host @"
Helper: axein help
Quick:
  axein open       # open app
  axein status     # container status
  axein logs       # follow web logs
  axein db-logs    # tail Postgres logs
  axein update     # pull/build & restart
  axein restart    # restart containers
  axein down       # stop & remove
"@
try { Start-Process "http://localhost:$AppPort" } catch {}
