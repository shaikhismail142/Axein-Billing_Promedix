const { app, BrowserWindow, Menu, dialog, shell } = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const http = require("http");

const APP_URL = process.env.AXEIN_APP_URL || "http://127.0.0.1:3000";
const WEB_IMAGE = process.env.AXEIN_WEB_IMAGE ||
  "ghcr.io/shaikhismail142/axein-billing-promedix:2026-07-20-v1";
const LICENSE_PUBLIC_KEY =
  "MCowBQYDK2VwAyEAb5mB0eifFbLbrfvp5JNYwJ5ULHL2Iu61GFcgwue/nzI=";
const SCHEMA_VERSION = "2026-07-20-v1";
const RELEASES_URL =
  "https://github.com/shaikhismail142/Axein-Billing_Promedix/releases";

let mainWindow;
let composeFile;
let logFile;

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

function dockerCompose(args, options) {
  return run("docker", ["compose", "-f", composeFile, ...args], options);
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
        for f in $$(find /migrations -maxdepth 1 -name '*.sql' | sort); do
          echo "Applying $$(basename $$f)";
          psql -h db -U axeindb -d axeindb -v ON_ERROR_STOP=1 -f "$$f";
        done
  web:
    image: ${WEB_IMAGE}
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
      LICENSE_PUBLIC_KEY: "${LICENSE_PUBLIC_KEY}"
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

async function ensureRuntime() {
  if ((await httpReady(`${APP_URL}/api/health`)) || (await httpReady(APP_URL))) {
    setStatus("AxEin is ready", "Using the running local service");
    await mainWindow.loadURL(APP_URL);
    return;
  }

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

  const marker = path.join(app.getPath("userData"), `schema-${SCHEMA_VERSION}.done`);
  if (!fs.existsSync(marker)) {
    setStatus("Preparing the billing database", "Applying safe schema updates");
    await dockerCompose(["--profile", "tools", "run", "--rm", "migrate"]);
    fs.writeFileSync(marker, new Date().toISOString(), "utf8");
  }

  setStatus("Starting AxEin Billing", "Downloading the app once may take a few minutes");
  await dockerCompose(["pull", "web"]);
  await dockerCompose(["up", "-d", "web"]);

  setStatus("Opening your workspace", "Waiting for the secure local service");
  if (!(await waitForWeb())) {
    throw new Error("AxEin did not become ready in time. Open Diagnostics from the Help menu.");
  }
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
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    const userData = app.getPath("userData");
    composeFile = path.join(userData, "runtime", "docker-compose.yml");
    logFile = path.join(userData, "logs", "desktop.log");
    if (process.platform === "win32" || process.platform === "darwin") {
      app.setLoginItemSettings({ openAtLogin: true });
    }
    createWindow();
    installMenu();
    ensureRuntime().catch(showFailure);
  });

  app.on("window-all-closed", () => app.quit());
}
