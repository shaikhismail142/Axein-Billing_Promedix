const { app, BrowserWindow, Menu, dialog, shell } = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const crypto = require("crypto");
const net = require("net");
const os = require("os");

const APP_VERSION = "1.4.0";
const PORTAL_URL = (process.env.AXEIN_LICENSE_PORTAL_URL || "https://axein.in").replace(/\/+$/, "");
const LEGACY_LICENSE_PUBLIC_KEY =
  "MCowBQYDK2VwAyEAb5mB0eifFbLbrfvp5JNYwJ5ULHL2Iu61GFcgwue/nzI=";
const PORTAL_LICENSE_PUBLIC_KEY =
  "MCowBQYDK2VwAyEALYZmnyyHPYhB1OcPIzn3iRNrGy5hYmTlOOS8+xRlrl8=";
const LICENSE_PUBLIC_KEYS = JSON.stringify({
  "ed25519-v1": LEGACY_LICENSE_PUBLIC_KEY,
  "axein-2026-01": PORTAL_LICENSE_PUBLIC_KEY,
});
const RELEASES_URL =
  "https://github.com/shaikhismail142/Axein-Billing_Promedix/releases";

let mainWindow;
let runtimeProcess;
let runtimeStopping = false;
let appUrl = "";
let logFile = "";
let deviceHash = "";
let desktopActivationSecret = "";

function appendLog(message) {
  const line = `[${new Date().toISOString()}] ${String(message || "").trimEnd()}\n`;
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
      appendLog(chunk.toString());
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      appendLog(chunk.toString());
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
    const request = client.request(
      target,
      {
        method: options.method || (body ? "POST" : "GET"),
        timeout: options.timeout || 15000,
        headers: {
          Accept: "application/json",
          ...(body
            ? { "Content-Type": "application/json", "Content-Length": String(body.length) }
            : {}),
          ...(options.headers || {}),
        },
      },
      (response) => {
        let raw = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          raw += chunk;
        });
        response.on("end", () => {
          let parsed = {};
          try {
            parsed = raw ? JSON.parse(raw) : {};
          } catch (_) {}
          if (response.statusCode >= 200 && response.statusCode < 300) resolve(parsed);
          else reject(new Error(parsed.error || `Request failed with HTTP ${response.statusCode}.`));
        });
      }
    );
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
  return crypto
    .createHash("sha256")
    .update(`axein-billing:v1|${raw}`, "utf8")
    .digest("hex");
}

function runtimeRoot() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "runtime")
    : path.resolve(__dirname, "runtime");
}

function runtimePaths() {
  const root = runtimeRoot();
  const standalone = path.join(root, "app", "standalone");
  const node =
    process.platform === "win32"
      ? path.join(root, "node", "node.exe")
      : process.platform === "darwin"
      ? path.join(root, "node", "bin", "node")
      : path.join(root, "node", "node");
  return {
    root,
    standalone,
    node,
    server: path.join(standalone, "server.js"),
    migrations: path.join(standalone, "db", "migrations"),
    pgliteEntry: path.join(standalone, "vendor", "pglite", "dist", "index.js"),
  };
}

function assertRuntimePresent(paths) {
  const required = [
    [paths.node, "bundled Node runtime"],
    [paths.server, "billing application server"],
    [paths.migrations, "database migrations"],
    [paths.pgliteEntry, "embedded database runtime"],
  ];
  const missing = required.filter(([file]) => !fs.existsSync(file));
  if (missing.length) {
    throw new Error(
      `The installer is incomplete. Missing ${missing.map(([, label]) => label).join(", ")}.`
    );
  }
}

function findAvailablePort(preferred = 3199) {
  const tryPort = (port) =>
    new Promise((resolve, reject) => {
      const server = net.createServer();
      server.unref();
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => {
        const address = server.address();
        const selected = typeof address === "object" && address ? address.port : port;
        server.close(() => resolve(selected));
      });
    });
  return tryPort(preferred).catch(() => tryPort(0));
}

function httpReady(url, timeout = 2500) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout }, (response) => {
      response.resume();
      resolve(response.statusCode >= 200 && response.statusCode < 500);
    });
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.on("error", () => resolve(false));
  });
}

async function waitForWeb(seconds = 120) {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    if (runtimeProcess?.exitCode != null) return false;
    if (await httpReady(`${appUrl}/api/health`)) return true;
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  return false;
}

async function startLocalRuntime() {
  const paths = runtimePaths();
  assertRuntimePresent(paths);
  const port = await findAvailablePort(Number(process.env.AXEIN_DESKTOP_PORT || 3199));
  appUrl = `http://127.0.0.1:${port}`;
  const dataDirectory = path.join(app.getPath("userData"), "data", "pglite");
  const uploadsDirectory = path.join(app.getPath("userData"), "uploads", "logos");
  fs.mkdirSync(dataDirectory, { recursive: true });
  fs.mkdirSync(uploadsDirectory, { recursive: true });

  setStatus("Starting AxEin Billing", "Preparing the private local database");
  appendLog(`Runtime root: ${paths.root}`);
  appendLog(`Data directory: ${dataDirectory}`);
  appendLog(`Uploads directory: ${uploadsDirectory}`);
  appendLog(`Local URL: ${appUrl}`);

  runtimeStopping = false;
  runtimeProcess = spawn(paths.node, [paths.server], {
    cwd: paths.standalone,
    windowsHide: true,
    env: {
      ...process.env,
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      AXEIN_DESKTOP: "1",
      AXEIN_RUNTIME_ROOT: paths.root,
      AXEIN_FORCE_EMBEDDED_DB: "1",
      AXEIN_DB_DATA_DIR: dataDirectory,
      AXEIN_MIGRATIONS_DIR: paths.migrations,
      AXEIN_PGLITE_ENTRY: paths.pgliteEntry,
      AXEIN_UPLOADS_DIR: uploadsDirectory,
      AXEIN_LOG_FILE: logFile,
      AXEIN_DEVICE_HASH: deviceHash,
      AXEIN_DESKTOP_ACTIVATION_SECRET: desktopActivationSecret,
      AXEIN_LICENSE_PORTAL_URL: PORTAL_URL,
      LICENSE_PUBLIC_KEY: LEGACY_LICENSE_PUBLIC_KEY,
      LICENSE_PUBKEYS_JSON: LICENSE_PUBLIC_KEYS,
      NEXT_PUBLIC_BASE_URL: appUrl,
      HOSTNAME: "127.0.0.1",
      PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  runtimeProcess.stdout.on("data", (chunk) => appendLog(`[runtime] ${chunk.toString()}`));
  runtimeProcess.stderr.on("data", (chunk) => appendLog(`[runtime] ${chunk.toString()}`));
  runtimeProcess.on("error", (error) => appendLog(`Runtime process error: ${error.stack || error}`));
  runtimeProcess.on("exit", (code, signal) => {
    appendLog(`Runtime exited code=${code} signal=${signal || ""}`);
    runtimeProcess = null;
    if (!runtimeStopping && !app.isQuitting) {
      setStatus("Local service stopped", "Use AxEin Billing > Restart Local Service");
    }
  });

  setStatus("Opening your workspace", "Applying safe database updates");
  if (!(await waitForWeb())) {
    throw new Error("The local billing service did not become ready. Open Diagnostics for details.");
  }
}

async function stopLocalRuntime() {
  if (!runtimeProcess) return;
  runtimeStopping = true;
  const child = runtimeProcess;
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch (_) {}
      resolve();
    }, 5000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    try {
      child.kill("SIGTERM");
    } catch (_) {
      clearTimeout(timer);
      resolve();
    }
  });
  runtimeProcess = null;
}

async function restartRuntime() {
  setStatus("Restarting AxEin Billing", "Your data remains safely stored");
  await stopLocalRuntime();
  await startLocalRuntime();
  await mainWindow.loadURL(appUrl);
}

function certificateFile() {
  return path.join(app.getPath("userData"), "license", "portal-certificate.json");
}

async function localLicenseStatus() {
  try {
    return await requestJson(`${appUrl}/api/license/status`, { timeout: 5000 });
  } catch {
    return null;
  }
}

async function importPortalCertificate(certificate) {
  await requestJson(`${appUrl}/api/license/portal-certificate`, {
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

  setStatus("Connecting to AxEin licensing", "Creating a privacy-safe device request");
  const activation = await requestJson(`${PORTAL_URL}/api/v1/billing/activation/request/`, {
    body: {
      deviceHash,
      deviceName: os.hostname(),
      platform: process.platform === "win32" ? "windows" : "macos",
      architecture: process.arch,
      appVersion: APP_VERSION,
      callbackUri: `axein-billing://activation/${deviceHash.slice(0, 16)}`,
    },
  });
  if (!activation?.challenge || !activation?.verifier || !activation?.browserUrl) {
    throw new Error("AxEin did not return a complete activation challenge.");
  }
  await shell.openExternal(activation.browserUrl);
  setStatus(
    "Approve this computer in your browser",
    "Sign in, select your purchase, then wait for AxEin approval"
  );

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
  throw new Error("Activation approval timed out. Reopen AxEin Billing to create a new request.");
}

function handleActivationDeepLink(url) {
  if (!url || !url.startsWith("axein-billing://activation/")) return;
  appendLog(`Activation handoff received: ${url.split("?")[0]}`);
  setStatus("Device request confirmed", "Waiting for AxEin approval");
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
}

async function ensureRuntime() {
  await startLocalRuntime();
  await ensurePortalActivation();
  await mainWindow.loadURL(appUrl);
}

function installMenu() {
  const template = [
    {
      label: "AxEin Billing",
      submenu: [
        { label: "Open in Browser", click: () => shell.openExternal(appUrl) },
        {
          label: "Restart Local Service",
          click: () => restartRuntime().catch(showFailure),
        },
        {
          label: "Open Data Folder",
          click: () => shell.openPath(path.join(app.getPath("userData"), "data")),
        },
        { type: "separator" },
        { role: "reload" },
        { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Help",
      submenu: [
        { label: "Open Diagnostics Log", click: () => shell.openPath(logFile) },
        {
          label: "Open License Portal",
          click: () => shell.openExternal(`${PORTAL_URL}/axein-billing/account/licenses`),
        },
        { label: "Check for Updates", click: () => shell.openExternal(RELEASES_URL) },
        {
          label: "Customer Handbook",
          click: () => shell.openExternal(`${PORTAL_URL}/axein-billing/features`),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function showFailure(error) {
  appendLog(error?.stack || String(error));
  setStatus("AxEin needs attention", error?.message || String(error));
  dialog
    .showMessageBox(mainWindow, {
      type: "error",
      title: "AxEin Billing could not start",
      message: error?.message || String(error),
      detail: `Diagnostics: ${logFile}`,
      buttons: ["Open Diagnostics", "Close"],
    })
    .then(({ response }) => {
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
      sandbox: true,
      preload: path.join(__dirname, "renderer", "preload.cjs"),
    },
  });
  mainWindow.loadFile(path.join(__dirname, "renderer", "status.html"));
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (appUrl && url.startsWith(appUrl)) return { action: "allow" };
    shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith("file:") || (appUrl && url.startsWith(appUrl))) return;
    event.preventDefault();
    shell.openExternal(url);
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_event, commandLine) => {
    handleActivationDeepLink(commandLine.find((value) => value.startsWith("axein-billing://")));
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
    app.isQuitting = false;
    logFile = path.join(app.getPath("userData"), "logs", "desktop.log");
    desktopActivationSecret = persistedSecret();
    deviceHash = await privacySafeDeviceHash();
    createWindow();
    installMenu();
    ensureRuntime().catch(showFailure);
  });

  app.on("before-quit", (event) => {
    if (app.isQuitting || !runtimeProcess) return;
    event.preventDefault();
    app.isQuitting = true;
    stopLocalRuntime().finally(() => app.quit());
  });

  app.on("window-all-closed", () => app.quit());
}
