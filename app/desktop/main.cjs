const { app, BrowserWindow, Menu, dialog, shell } = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const crypto = require("crypto");
const { pipeline } = require("stream/promises");

const APP_URL = process.env.AXEIN_APP_URL || "http://127.0.0.1:3000";
const PORTAL_URL = (process.env.AXEIN_LICENSE_PORTAL_URL || "https://axein.in").replace(/\/+$/, "");
const APP_VERSION = "1.3.0";
const RELEASE_TAG = `v${APP_VERSION}`;
const RELEASE_IMAGE = !process.env.AXEIN_WEB_IMAGE;
const WEB_IMAGE = process.env.AXEIN_WEB_IMAGE || `axein-billing-promedix:${APP_VERSION}`;
const LEGACY_LICENSE_PUBLIC_KEY =
  "MCowBQYDK2VwAyEAb5mB0eifFbLbrfvp5JNYwJ5ULHL2Iu61GFcgwue/nzI=";
const PORTAL_LICENSE_PUBLIC_KEY =
  "MCowBQYDK2VwAyEALYZmnyyHPYhB1OcPIzn3iRNrGy5hYmTlOOS8+xRlrl8=";
const LICENSE_PUBLIC_KEYS = JSON.stringify({
  "ed25519-v1": LEGACY_LICENSE_PUBLIC_KEY,
  "axein-2026-01": PORTAL_LICENSE_PUBLIC_KEY,
});
const SCHEMA_VERSION = "2026-07-23-v1";
const RELEASES_URL =
  "https://github.com/shaikhismail142/Axein-Billing_Promedix/releases";
const RELEASE_DOWNLOAD_URL = `${RELEASES_URL}/download/${RELEASE_TAG}`;

let mainWindow;
let composeFile;
let logFile;
let deviceHash = "";
let desktopActivationSecret = "";

function handleActivationDeepLink(url) {
  if (!url || !url.startsWith("axein-billing://activation/")) return;
  appendLog(`Activation handoff received: ${url.split("?")[0]}`);
  setStatus("Device request confirmed", "Waiting for Axein approval");
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
}

function appendLog(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  try {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.appendFileSync(logFile, line, "utf8");
  } catch (_) {}
}

function setStatus(title, detail = "") {
  appendLog(`${title}${detail ? `: ${detail}` : ""}`);
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("axein-status", { title, detail });
}

function run(command, args, options = {}) {
  appendLog(`$ ${command} ${args.join(" ")}`);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || app.getPath("userData"),
      windowsHide: true,
      env: { ...process.env, ...options.env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      appendLog(chunk.toString().trimEnd());
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      appendLog(chunk.toString().trimEnd());
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0 || options.allowFailure) resolve({ code, stdout, stderr });
      else reject(new Error(stderr.trim() || stdout.trim() || `${command} exited with ${code}`));
    });
  });
}

function requestJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const body = options.body ? Buffer.from(JSON.stringify(options.body), "utf8") : null;
    const client = target.protocol === "https:" ? https : http;
    const request = client.request(target, {
      method: options.method || (body ? "POST" : "GET"),
      timeout: options.timeout || 15000,
      headers: {
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json", "Content-Length": String(body.length) } : {}),
        ...(options.headers || {}),
      },
    }, (response) => {
      let raw = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { raw += chunk; });
      response.on("end", () => {
        let parsed = {};
        try { parsed = raw ? JSON.parse(raw) : {}; } catch (_) {}
        if (response.statusCode >= 200 && response.statusCode < 300) resolve(parsed);
        else reject(new Error(parsed.error || `Request failed with HTTP ${response.statusCode}.`));
      });
    });
    request.on("timeout", () => request.destroy(new Error("Request timed out.")));
    request.on("error", reject);
    if (body) request.write(body);
    request.end();
  });
}

function persistedSecret() {
  const file = path.join(app.getPath("userData"), "runtime", "desktop-secret");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) return fs.readFileSync(file, "utf8").trim();
  const secret = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(file, `${secret}\n`, { mode: 0o600 });
  return secret;
}

async function privacySafeDeviceHash() {
  let raw = "";
  if (process.platform === "win32") {
    const result = await run("reg", [
      "query",
      "HKLM\\SOFTWARE\\Microsoft\\Cryptography",
      "/v",
      "MachineGuid",
    ]);
    const match = result.stdout.match(/MachineGuid\s+REG_SZ\s+([^\r\n]+)/i);
    raw = match?.[1]?.trim() || "";
  } else if (process.platform === "darwin") {
    const result = await run("/usr/sbin/ioreg", ["-rd1", "-c", "IOPlatformExpertDevice"]);
    const match = result.stdout.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/i);
    raw = match?.[1]?.trim() || "";
  }
  if (!raw) throw new Error("This computer's device identifier could not be read.");
  return crypto.createHash("sha256").update(`axein-billing:v1|${raw}`, "utf8").digest("hex");
}

function dockerCompose(args, options) {
  return run("docker", ["compose", "-f", composeFile, ...args], options);
}

function imageArchitecture() {
  if (process.arch === "x64") return "amd64";
  if (process.arch === "arm64") return "arm64";
  throw new Error(`AxEin does not yet provide a desktop image for ${process.arch}.`);
}

function dockerPlatform() {
  return `linux/${imageArchitecture()}`;
}

async function imageExists() {
  const result = await run("docker", ["image", "inspect", WEB_IMAGE], { allowFailure: true });
  return result.code === 0;
}

function downloadFile(url, destination, redirects = 5) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https:") ? https : http;
    const request = client.get(url, { headers: { "User-Agent": "AxEin-Billing-Desktop" } }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        if (redirects <= 0) {
          reject(new Error("Too many redirects while downloading the AxEin application image."));
          return;
        }
        const nextUrl = new URL(response.headers.location, url).toString();
        resolve(downloadFile(nextUrl, destination, redirects - 1));
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Application image download failed with HTTP ${response.statusCode}.`));
        return;
      }

      const partial = `${destination}.part`;
      const total = Number(response.headers["content-length"] || 0);
      let received = 0;
      let lastReported = 0;
      response.on("data", (chunk) => {
        received += chunk.length;
        if (received - lastReported < 5 * 1024 * 1024 && received !== total) return;
        lastReported = received;
        const progress = total
          ? `${Math.round((received / total) * 100)}% (${Math.round(received / 1048576)} MB)`
          : `${Math.round(received / 1048576)} MB`;
        setStatus("Downloading AxEin Billing", progress);
      });

      pipeline(response, fs.createWriteStream(partial))
        .then(() => {
          fs.renameSync(partial, destination);
          resolve();
        })
        .catch((error) => {
          try { fs.rmSync(partial, { force: true }); } catch (_) {}
          reject(error);
        });
    });
    request.on("error", reject);
    request.setTimeout(120000, () => request.destroy(new Error("Application image download timed out.")));
  });
}

async function ensureWebImage() {
  if (await imageExists()) {
    setStatus("Application image ready", WEB_IMAGE);
    return;
  }

  if (!RELEASE_IMAGE) {
    setStatus("Downloading the configured application image", WEB_IMAGE);
    await run("docker", ["pull", "--platform", dockerPlatform(), WEB_IMAGE]);
    return;
  }

  const assetName = `AxEin-Billing-Image-linux-${imageArchitecture()}.tar.gz`;
  const cacheDirectory = path.join(app.getPath("userData"), "cache");
  const archive = path.join(cacheDirectory, assetName);
  fs.mkdirSync(cacheDirectory, { recursive: true });

  setStatus("Downloading AxEin Billing", "One-time application setup");
  await downloadFile(`${RELEASE_DOWNLOAD_URL}/${assetName}`, archive);
  setStatus("Installing AxEin Billing", "Loading the local application image");
  await run("docker", ["load", "-i", archive]);
  try { fs.rmSync(archive, { force: true }); } catch (_) {}

  if (!(await imageExists())) {
    throw new Error(`The downloaded application image did not provide ${WEB_IMAGE}.`);
  }
}

function migrationsPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "migrations")
    : path.resolve(__dirname, "../db/migrations");
}

function yamlPath(value) {
  return value.replace(/\\/g, "/").replace(/"/g, "\\\"");
}

function composeYaml() {
  const migrations = yamlPath(migrationsPath());
  const platform = dockerPlatform();
  return `name: axein-desktop
services:
  db:
    image: postgres:16.4
    environment:
      POSTGRES_USER: axeindb
      POSTGRES_PASSWORD: axeindbpass
      POSTGRES_DB: axeindb
      TZ: Asia/Kolkata
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U axeindb -d axeindb"]
      interval: 3s
      timeout: 3s
      retries: 30
    volumes:
      - axein_db:/var/lib/postgresql/data
    restart: unless-stopped
  redis:
    image: redis:7.2.5
    volumes:
      - axein_redis:/data
    restart: unless-stopped
  minio:
    image: minio/minio:RELEASE.2024-08-17T01-24-54Z
    command: server /data --console-address :9001
    environment:
      MINIO_ROOT_USER: minio
      MINIO_ROOT_PASSWORD: miniominiom
    volumes:
      - axein_minio:/data
    restart: unless-stopped
  mailpit:
    image: axllent/mailpit:latest
    restart: unless-stopped
  migrate:
    image: postgres:16.4
    profiles: ["tools"]
    depends_on:
      db:
        condition: service_healthy
    environment:
      PGPASSWORD: axeindbpass
    volumes:
      - "${migrations}:/migrations:ro"
    entrypoint: ["sh", "-lc"]
    command:
      - >-
        set -eu;
        if psql -h db -U axeindb -d axeindb -Atqc
        "SELECT to_regclass('public.products') IS NOT NULL
        AND to_regclass('public.sales') IS NOT NULL" | grep -qx t; then
          echo "Existing database detected; applying compatibility migrations";
          files=$$(find /migrations -maxdepth 1 -type f
          \\( -name '202*.sql' -o -name '999_app_compat.sql' \\) | sort);
        else
          echo "Fresh database detected; applying the complete schema";
          files=$$(find /migrations -maxdepth 1 -type f -name '*.sql' | sort);
        fi;
        for f in $$files; do
          echo "Applying $$(basename $$f)";
          psql -h db -U axeindb -d axeindb -v ON_ERROR_STOP=1 -f "$$f";
        done
  web:
    image: ${WEB_IMAGE}
    platform: ${platform}
    pull_policy: never
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_started
      minio:
        condition: service_started
      mailpit:
        condition: service_started
    environment:
      NODE_ENV: production
      TZ: Asia/Kolkata
      PORT: "3000"
      NEXT_PUBLIC_BASE_URL: http://localhost:3000
      DATABASE_URL: postgresql://axeindb:axeindbpass@db:5432/axeindb
      POSTGRES_HOST: db
      POSTGRES_PORT: "5432"
      POSTGRES_USER: axeindb
      POSTGRES_PASSWORD: axeindbpass
      POSTGRES_DB: axeindb
      REDIS_HOST: redis
      REDIS_PORT: "6379"
      S3_ENDPOINT: http://minio:9000
      S3_KEY: minio
      S3_SECRET: miniominiom
      S3_BUCKET: axein
      S3_REGION: ap-south-1
      S3_FORCE_PATH_STYLE: "true"
      LICENSE_PUBLIC_KEY: "${LEGACY_LICENSE_PUBLIC_KEY}"
      LICENSE_PUBKEYS_JSON: '${LICENSE_PUBLIC_KEYS}'
      AXEIN_DEVICE_HASH: "${deviceHash}"
      AXEIN_DESKTOP_ACTIVATION_SECRET: "${desktopActivationSecret}"
      AXEIN_LICENSE_PORTAL_URL: "${PORTAL_URL}"
    ports:
      - "3000:3000"
    restart: unless-stopped
volumes:
  axein_db:
  axein_redis:
  axein_minio:
`;
}

function httpReady(url, timeout = 2500) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout }, (response) => {
      response.resume();
      resolve(response.statusCode >= 200 && response.statusCode < 500);
    });
    req.on("timeout", () => { req.destroy(); resolve(false); });
    req.on("error", () => resolve(false));
  });
}

async function waitForWeb(seconds = 180) {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    if (await httpReady(`${APP_URL}/api/health`)) return true;
    if (await httpReady(APP_URL)) return true;
    await new Promise((resolve) => setTimeout(resolve, 2500));
  }
  return false;
}

function certificateFile() {
  return path.join(app.getPath("userData"), "license", "portal-certificate.json");
}

async function localLicenseStatus() {
  try {
    return await requestJson(`${APP_URL}/api/license/status`, { timeout: 5000 });
  } catch {
    return null;
  }
}

async function importPortalCertificate(certificate) {
  await requestJson(`${APP_URL}/api/license/portal-certificate`, {
    body: { certificate, deviceHash },
    headers: { "X-Axein-Desktop-Secret": desktopActivationSecret },
  });
}

async function ensurePortalActivation() {
  const status = await localLicenseStatus();
  if (status?.isLicensed || status?.trialActive) return;

  const saved = certificateFile();
  if (fs.existsSync(saved)) {
    try {
      const certificate = JSON.parse(fs.readFileSync(saved, "utf8"));
      await importPortalCertificate(certificate);
      if ((await localLicenseStatus())?.isLicensed) return;
    } catch (error) {
      appendLog(`Saved portal certificate rejected: ${error.message}`);
    }
  }

  setStatus("Connecting to Axein licensing", "Creating a privacy-safe device request");
  const activation = await requestJson(`${PORTAL_URL}/api/v1/billing/activation/request/`, {
    body: {
      deviceHash,
      deviceName: require("os").hostname(),
      platform: process.platform === "win32" ? "windows" : "macos",
      architecture: process.arch,
      appVersion: APP_VERSION,
      callbackUri: `axein-billing://activation/${deviceHash.slice(0, 16)}`,
    },
  });
  if (!activation?.challenge || !activation?.verifier || !activation?.browserUrl) {
    throw new Error("Axein did not return a complete activation challenge.");
  }
  await shell.openExternal(activation.browserUrl);
  setStatus("Approve this computer in your browser", "Sign in, select your purchase, then wait for Axein approval");

  const deadline = Date.now() + 20 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 4000));
    const result = await requestJson(`${PORTAL_URL}/api/v1/billing/activation/poll/`, {
      body: { challenge: activation.challenge, verifier: activation.verifier },
      timeout: 10000,
    });
    if (result?.status === "approved" && result.certificate) {
      fs.mkdirSync(path.dirname(saved), { recursive: true });
      fs.writeFileSync(saved, JSON.stringify(result.certificate, null, 2), { mode: 0o600 });
      await importPortalCertificate(result.certificate);
      setStatus("License approved", "This computer is ready");
      return;
    }
    if (["expired", "rejected"].includes(result?.status)) {
      throw new Error(`Activation request was ${result.status}.`);
    }
  }
  throw new Error("Activation approval timed out. Reopen Axein Billing to create a new request.");
}

async function ensureRuntime() {
  setStatus("Checking Docker Desktop", "This keeps billing data on this computer");
  try {
    await run("docker", ["info"]);
    await run("docker", ["compose", "version"]);
  } catch (error) {
    throw new Error(
      "Docker Desktop is not installed or is not running. Install/start Docker Desktop, then reopen AxEin Billing."
    );
  }

  fs.mkdirSync(path.dirname(composeFile), { recursive: true });
  fs.writeFileSync(composeFile, composeYaml(), "utf8");

  setStatus("Starting local data services", "PostgreSQL, Redis, storage, and mail service");
  await dockerCompose(["up", "-d", "db", "redis", "minio", "mailpit"]);

  await ensureWebImage();

  const marker = path.join(app.getPath("userData"), `schema-${SCHEMA_VERSION}.done`);
  if (!fs.existsSync(marker)) {
    setStatus("Preparing the billing database", "Applying safe schema updates");
    await dockerCompose(["--profile", "tools", "run", "--rm", "migrate"]);
    fs.writeFileSync(marker, new Date().toISOString(), "utf8");
  }

  setStatus("Starting AxEin Billing", "Connecting the desktop app to your local data");
  await dockerCompose(["up", "-d", "web"]);

  setStatus("Opening your workspace", "Waiting for the secure local service");
  if (!(await waitForWeb())) {
    throw new Error("AxEin did not become ready in time. Open Diagnostics from the Help menu.");
  }
  await ensurePortalActivation();
  await mainWindow.loadURL(APP_URL);
}

async function restartServices() {
  setStatus("Restarting AxEin services");
  await dockerCompose(["restart", "web", "db", "redis", "minio", "mailpit"]);
  if (await waitForWeb(90)) await mainWindow.loadURL(APP_URL);
}

function installMenu() {
  const template = [
    {
      label: "AxEin Billing",
      submenu: [
        { label: "Open in Browser", click: () => shell.openExternal(APP_URL) },
        { label: "Restart Local Services", click: () => restartServices().catch(showFailure) },
        { type: "separator" },
        { role: "reload" },
        { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" }, { role: "redo" }, { type: "separator" },
        { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" }, { role: "forceReload" },
        { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Help",
      submenu: [
        { label: "Open Diagnostics Log", click: () => shell.openPath(logFile) },
        { label: "Open License Portal", click: () => shell.openExternal(`${PORTAL_URL}/axein-billing/account/licenses`) },
        { label: "Check for Updates", click: () => shell.openExternal(RELEASES_URL) },
        { label: "Docker Desktop", click: () => shell.openExternal("https://www.docker.com/products/docker-desktop/") },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function showFailure(error) {
  appendLog(error?.stack || String(error));
  setStatus("AxEin needs attention", error?.message || String(error));
  dialog.showMessageBox(mainWindow, {
    type: "error",
    title: "AxEin Billing could not start",
    message: error?.message || String(error),
    detail: `Diagnostics: ${logFile}`,
    buttons: ["Open Diagnostics", "Close"],
  }).then(({ response }) => {
    if (response === 0) shell.openPath(logFile);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 980,
    minHeight: 680,
    show: false,
    backgroundColor: "#eef4ff",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "renderer", "preload.cjs"),
    },
  });
  mainWindow.loadFile(path.join(__dirname, "renderer", "status.html"));
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(APP_URL)) return { action: "allow" };
    shell.openExternal(url);
    return { action: "deny" };
  });
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", (_event, commandLine) => {
    handleActivationDeepLink(
      commandLine.find((value) => value.startsWith("axein-billing://"))
    );
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.on("open-url", (event, url) => {
    event.preventDefault();
    handleActivationDeepLink(url);
  });

  app.whenReady().then(async () => {
    app.setAsDefaultProtocolClient("axein-billing");
    const userData = app.getPath("userData");
    composeFile = path.join(userData, "runtime", "docker-compose.yml");
    logFile = path.join(userData, "logs", "desktop.log");
    desktopActivationSecret = persistedSecret();
    deviceHash = await privacySafeDeviceHash();
    if (process.platform === "win32" || process.platform === "darwin") {
      app.setLoginItemSettings({ openAtLogin: true });
    }
    createWindow();
    installMenu();
    ensureRuntime().catch(showFailure);
  });

  app.on("window-all-closed", () => app.quit());
}
