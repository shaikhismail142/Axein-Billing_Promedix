#!/usr/bin/env node
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..", "..");
const embeddedDataDir = path.join(root, "desktop", "runtime", "data", "pglite");
const embeddedUploadsDir = path.join(root, "desktop", "runtime", "data", "uploads", "logos");
fs.mkdirSync(embeddedDataDir, { recursive: true });
fs.mkdirSync(embeddedUploadsDir, { recursive: true });

const serverPath = path.join(root, "desktop", "runtime", "app", "standalone", "server.js");
if (!fs.existsSync(serverPath)) {
  console.error("Missing desktop runtime server. Run: npm run desktop:prepare-runtime");
  process.exit(1);
}

const env = {
  ...process.env,
  NODE_ENV: "production",
  AXEIN_DESKTOP: "1",
  APP_REQUIRE_BUSINESS_SETUP: process.env.APP_REQUIRE_BUSINESS_SETUP || "true",
  PORT: process.env.PORT || "3199",
  HOSTNAME: process.env.HOSTNAME || "127.0.0.1",
  NEXT_PUBLIC_BASE_URL:
    process.env.NEXT_PUBLIC_BASE_URL ||
    `http://${process.env.HOSTNAME || "127.0.0.1"}:${process.env.PORT || "3199"}`,
  AXEIN_FORCE_EMBEDDED_DB: process.env.AXEIN_FORCE_EMBEDDED_DB || "1",
  AXEIN_DB_DATA_DIR: process.env.AXEIN_DB_DATA_DIR || embeddedDataDir,
  AXEIN_UPLOADS_DIR: process.env.AXEIN_UPLOADS_DIR || embeddedUploadsDir,
  AXEIN_LOG_FILE:
    process.env.AXEIN_LOG_FILE ||
    path.join(root, "desktop", "runtime", "data", "logs", "desktop-runtime.log"),
  AXEIN_MIGRATIONS_DIR:
    process.env.AXEIN_MIGRATIONS_DIR || path.join(path.dirname(serverPath), "db", "migrations"),
};

const child = spawn(process.execPath, [serverPath], {
  cwd: path.dirname(serverPath),
  env,
  stdio: "inherit",
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    if (!child.killed) child.kill(sig);
  });
}

child.on("exit", (code) => process.exit(code ?? 0));
