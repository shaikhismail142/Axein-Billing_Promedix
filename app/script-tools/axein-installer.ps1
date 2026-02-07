<#
  AxEin Billing – Windows Installer (v2)
  - Installs prerequisites (winget, Git, Docker Desktop, Node LTS)
  - Clones/updates repo
  - Writes docker-compose.yml
  - Starts services and waits for web
  - Generates license key and saves .txt to Downloads
  - (Optional) auto-applies license and business profile

  Usage (Run as Admin):
    .\axein-installer.ps1 -RepoUrl "https://github.com/<org>/<repo>.git" -Branch main -AppPort 3000
#>

param(
  [Parameter(Mandatory=$false)]
  [string] $RepoUrl = "https://github.com/shaikhismail142/Axein-Billing_Promedix.git",
  [Parameter(Mandatory=$false)]
  [string] $Branch  = "codex/healthcare-customization",
  [Parameter(Mandatory=$false)]
  [string] $WebImage = "ghcr.io/shaikhismail142/axein-billing-promedix:2026-02-07-v1",
  [Parameter(Mandatory=$false)]
  [int]    $AppPort = 3000,
  [switch] $SkipRedis,
  [switch] $SkipMinio,
  [switch] $SkipMailpit,
  [switch] $BuildFromSource
)

$ErrorActionPreference = 'Stop'
if ($PSStyle -and $PSStyle.OutputRendering) { $PSStyle.OutputRendering = 'ANSI' }

function Title($t){ Write-Host ""; Write-Host "══ $t ══" -ForegroundColor Cyan }
function Info ($m){ Write-Host "[axein] $m" -ForegroundColor Cyan }
function Ok   ($m){ Write-Host "[ok]    $m" -ForegroundColor Green }
function Warn ($m){ Write-Host "[warn]  $m" -ForegroundColor Yellow }
function Fail ($m){ Write-Host "[err]   $m" -ForegroundColor Red }

function Ensure-WinGet {
  try { Get-Command winget -ErrorAction Stop | Out-Null }
  catch { Fail "winget not found. Install 'App Installer' from Microsoft Store, then re-run."; exit 2 }
}
function Ensure-App($id, $name) {
  try {
    $found = (winget list --id $id 2>$null | Select-String $id)
    if (-not $found) {
      Info "Installing $name via winget"
      winget install --id $id --accept-source-agreements --accept-package-agreements --silent
      Ok "$name installed"
    } else { Ok "$name already installed" }
  } catch { Warn "winget install for $name hit an issue: $($_.Exception.Message)" }
}

function Read-NonEmpty($prompt) {
  $v = Read-Host -Prompt $prompt
  while ([string]::IsNullOrWhiteSpace($v)) { $v = Read-Host -Prompt $prompt }
  return $v
}

function Read-Date($prompt) {
  $v = Read-Host -Prompt $prompt
  while (-not [datetime]::TryParseExact($v, 'yyyy-MM-dd', $null, [System.Globalization.DateTimeStyles]::None, [ref]([datetime]::MinValue))) {
    $v = Read-Host -Prompt "$prompt (YYYY-MM-DD)"
  }
  return $v
}

function New-AxKey {
  $chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  function Rand4 {
    -join (1..4 | ForEach-Object { $chars[(Get-Random -Min 0 -Max $chars.Length)] })
  }
  return "AXEIN-$(Rand4)-$(Rand4)-$(Rand4)"
}

function Wait-Http($url, $timeoutSec=180) {
  $start = Get-Date
  while ((Get-Date) -lt $start.AddSeconds($timeoutSec)) {
    try {
      $res = Invoke-WebRequest -UseBasicParsing -Uri $url -Method GET -TimeoutSec 5
      if ($res.StatusCode -ge 200 -and $res.StatusCode -lt 500) { return $true }
    } catch { }
    Start-Sleep -Seconds 3
  }
  return $false
}

Title "AxEin Billing Installer"
if (-not ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole] "Administrator")) {
  Fail "Please run PowerShell as Administrator."; exit 1
}

# ---- Inputs ----
if (-not $RepoUrl) { $RepoUrl = Read-NonEmpty "Enter Git repo URL (HTTPS/SSH)" }

$CompanyName = Read-NonEmpty "Company Name"
$CompanyAddress = Read-Host "Company Address (optional)"
$CompanyPhone = Read-Host "Company Phone (optional)"
$CompanyGSTIN = Read-Host "Company GSTIN (optional)"
$CompanyStateCode = Read-Host "State Code (e.g., 27)"
$AdminEmail = Read-NonEmpty "Admin Email (for license)"
$LicenseStart = Read-Date "License Start Date (YYYY-MM-DD)"
$LicenseEnd = Read-Date "License End Date (YYYY-MM-DD)"

# ---- Paths ----
$AXEIN_ROOT   = 'C:\AxEin'
$APP_DIR      = Join-Path $AXEIN_ROOT 'app'
$DATA_DIR     = Join-Path $AXEIN_ROOT 'data'
$PGDATA_DIR   = Join-Path $DATA_DIR 'postgres'
$MINIO_DIR    = Join-Path $DATA_DIR 'minio'
$LOGS_DIR     = Join-Path $AXEIN_ROOT 'logs'
$BACKUPS_DIR  = Join-Path $AXEIN_ROOT 'backups\postgres'
$COMPOSE_FILE = Join-Path $AXEIN_ROOT 'docker-compose.yml'

Title "Prerequisites"
Ensure-WinGet
Ensure-App -id 'Git.Git' -name 'Git'
Ensure-App -id 'Docker.DockerDesktop' -name 'Docker Desktop'
Ensure-App -id 'OpenJS.NodeJS.LTS' -name 'Node.js LTS'

try {
  if (-not (Get-Process -Name 'Docker Desktop' -ErrorAction SilentlyContinue)) {
    Info "Starting Docker Desktop…"; Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe" -Verb RunAs | Out-Null
  } else { Ok "Docker Desktop already running" }
} catch { Warn "Could not start Docker Desktop: $($_.Exception.Message)" }

Info "Waiting for Docker engine…"
$deadline = (Get-Date).AddMinutes(5); $dockerOk = $false
while ((Get-Date) -lt $deadline) {
  try { $null = docker info 2>$null; if ($LASTEXITCODE -eq 0) { $dockerOk = $true; break } } catch {}
  Start-Sleep 3
}
if (-not $dockerOk) { Fail "Docker Engine not ready. Open Docker Desktop and re-run."; exit 3 }
Ok "Docker engine is up"

Title "Folders"
$null = New-Item -Force -ItemType Directory -Path $APP_DIR, $DATA_DIR, $PGDATA_DIR, $LOGS_DIR, $BACKUPS_DIR
if (-not $SkipMinio) { $null = New-Item -Force -ItemType Directory -Path $MINIO_DIR }

Title "Repository"
if (Test-Path (Join-Path $APP_DIR '.git')) {
  Info "Repo exists, pulling latest ($Branch)…"
  Push-Location $APP_DIR
  git fetch --all --prune
  git checkout $Branch
  git pull --ff-only origin $Branch
  Pop-Location
} else {
  Info "Cloning $RepoUrl ($Branch) into $APP_DIR…"
  git clone --branch $Branch --single-branch $RepoUrl $APP_DIR
}
Ok "Source ready"

# ---- License public key ----
$infoPath = Join-Path $APP_DIR 'tools\license-keygen\info.json'
if (-not (Test-Path $infoPath)) { Fail "Missing $infoPath (public key)."; exit 4 }
$pub = (Get-Content $infoPath -Raw | ConvertFrom-Json).publicKeyBase64
if (-not $pub) { Fail "info.json missing publicKeyBase64"; exit 5 }

Title "Compose"
$redisBlock = if (-not $SkipRedis) {@"
  redis:
    image: redis:7
    ports: ["6379:6379"]
    restart: unless-stopped
"@} else { "" }

$minioBlock = if (-not $SkipMinio) {@"
  minio:
    image: minio/minio:latest
    command: ["server", "/data", "--console-address", ":9001"]
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    ports: ["9000:9000", "9003:9001"]
    volumes:
      - type: bind
        source: $($MINIO_DIR -replace '\\','/')
        target: /data
    healthcheck:
      test: ["CMD-SHELL", "curl -sf http://localhost:9000/minio/health/ready || exit 1"]
      interval: 5s
      timeout: 4s
      retries: 40
    restart: unless-stopped
"@} else { "" }

$mailpitBlock = if (-not $SkipMailpit) {@"
  mailpit:
    image: axllent/mailpit:latest
    ports: ["8025:8025", "1025:1025"]
    restart: unless-stopped
"@} else { "" }

$depends = @()
$depends += "      db:\n        condition: service_healthy"
if (-not $SkipRedis) { $depends += "      redis:\n        condition: service_started" }
if (-not $SkipMinio) { $depends += "      minio:\n        condition: service_healthy" }
if (-not $SkipMailpit) { $depends += "      mailpit:\n        condition: service_started" }
$dependsBlock = ($depends -join "\n")

$webBlock = if ($BuildFromSource) { @"
  web:
    build:
      context: $((Join-Path $APP_DIR 'app') -replace '\\','/')
      dockerfile: Dockerfile
    depends_on:
$dependsBlock
    environment:
      NODE_ENV: production
      TZ: Asia/Kolkata
      PORT: "3000"
      NEXT_PUBLIC_BASE_URL: http://localhost:$AppPort
      DATABASE_URL: postgresql://axeindb:axeindbpass@db:5432/axeindb
      POSTGRES_HOST: db
      POSTGRES_PORT: "5432"
      POSTGRES_USER: axeindb
      POSTGRES_PASSWORD: axeindbpass
      POSTGRES_DB: axeindb
      LICENSE_PUBLIC_KEY: "$pub"
      REDIS_HOST: redis
      REDIS_PORT: "6379"
      S3_ENDPOINT: http://minio:9000
      S3_KEY: minioadmin
      S3_SECRET: minioadmin
      S3_BUCKET: axein
      S3_REGION: ap-south-1
      S3_FORCE_PATH_STYLE: "true"
    ports: ["$AppPort:3000"]
    restart: unless-stopped
"@ } else { @"
  web:
    image: $WebImage
    depends_on:
$dependsBlock
    environment:
      NODE_ENV: production
      TZ: Asia/Kolkata
      PORT: "3000"
      NEXT_PUBLIC_BASE_URL: http://localhost:$AppPort
      DATABASE_URL: postgresql://axeindb:axeindbpass@db:5432/axeindb
      POSTGRES_HOST: db
      POSTGRES_PORT: "5432"
      POSTGRES_USER: axeindb
      POSTGRES_PASSWORD: axeindbpass
      POSTGRES_DB: axeindb
      LICENSE_PUBLIC_KEY: "$pub"
      REDIS_HOST: redis
      REDIS_PORT: "6379"
      S3_ENDPOINT: http://minio:9000
      S3_KEY: minioadmin
      S3_SECRET: minioadmin
      S3_BUCKET: axein
      S3_REGION: ap-south-1
      S3_FORCE_PATH_STYLE: "true"
    ports: ["$AppPort:3000"]
    restart: unless-stopped
"@ }

$compose = @"
name: axein
services:
  db:
    image: postgres:16.4
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgrespass
      TZ: Asia/Kolkata
    ports: ["5432:5432"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 12
    shm_size: "1g"
    volumes:
      - type: bind
        source: $($PGDATA_DIR -replace '\\','/')
        target: /var/lib/postgresql/data
      - type: bind
        source: $($BACKUPS_DIR -replace '\\','/')
        target: /backups
      - type: bind
        source: $((Join-Path $APP_DIR 'init') -replace '\\','/')
        target: /docker-entrypoint-initdb.d

$redisBlock$minioBlock$mailpitBlock
$webBlock
"@

Set-Content -Path $COMPOSE_FILE -Value $compose -Encoding UTF8
Ok "Compose written: $COMPOSE_FILE"

Title "Start Services"
Push-Location $AXEIN_ROOT
& docker compose -f $COMPOSE_FILE up -d --build
Pop-Location

Info "Waiting for web app…"
if (-not (Wait-Http "http://localhost:$AppPort" 240)) {
  Warn "Web app did not respond within timeout. You can still activate later."
}

# ---- License generation ----
Title "License"
$licenseKey = New-AxKey
$expiresIso = "$LicenseEnd`T23:59:59.000Z"
$privateKey = Join-Path $APP_DIR 'tools\license-keygen\ed25519-private.pem'
$signScript = Join-Path $APP_DIR 'tools\license-keygen\sign-license.js'
if (-not (Test-Path $privateKey)) { Warn "Missing private key: $privateKey" } else {
  $json = node $signScript --key $privateKey --license $licenseKey --email $AdminEmail --expires $expiresIso | Out-String
  $licenseObj = $json | ConvertFrom-Json

  $downloads = Join-Path $env:USERPROFILE 'Downloads'
  $safeName = ($CompanyName -replace '[^a-zA-Z0-9-_]+','_')
  $txtPath = Join-Path $downloads "AxEin-License-$safeName.txt"

  @"
company_name=$CompanyName
license_start=$LicenseStart
license_end=$LicenseEnd
license_key=$($licenseObj.license_key)
email=$($licenseObj.email)
expires_at=$($licenseObj.expires_at)
signature=$($licenseObj.signature)
"@ | Set-Content -Path $txtPath -Encoding UTF8

  Ok "License saved to: $txtPath"

  # Try auto-activation
  try {
    $payload = @{
      license_key = $licenseObj.license_key
      email = $licenseObj.email
      expires_at = $licenseObj.expires_at
      signature = $licenseObj.signature
    } | ConvertTo-Json
    Invoke-RestMethod -Method POST -Uri "http://localhost:$AppPort/api/license/verify-key" -ContentType "application/json" -Body $payload | Out-Null
    Ok "License activated"
  } catch {
    Warn "Auto-activation failed. You can paste the .txt into Activate screen later."
  }
}

# ---- Save business profile ----
try {
  $bizPayload = @{
    name = $CompanyName
    address = $CompanyAddress
    phone = $CompanyPhone
    gstin = $CompanyGSTIN
    invoice_prefix = 'INV'
    state_code = $CompanyStateCode
  } | ConvertTo-Json
  Invoke-RestMethod -Method PUT -Uri "http://localhost:$AppPort/api/settings" -ContentType "application/json" -Body $bizPayload | Out-Null
  Ok "Business profile saved"
} catch {
  Warn "Could not save business profile automatically. You can update it in Settings later."
}

Ok "Installation complete. Open http://localhost:$AppPort"
