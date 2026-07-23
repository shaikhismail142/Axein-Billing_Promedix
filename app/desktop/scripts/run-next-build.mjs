#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..", "..");

const env = {
  ...process.env,
  AXEIN_DESKTOP: "1",
  NEXT_TELEMETRY_DISABLED: "1",
  APP_REQUIRE_BUSINESS_SETUP: process.env.APP_REQUIRE_BUSINESS_SETUP || "true",
};

const build = spawnSync(
  process.execPath,
  ["./node_modules/next/dist/bin/next", "build"],
  {
    cwd: root,
    env,
    stdio: "inherit",
  }
);

if (build.status !== 0) {
  process.exit(build.status ?? 1);
}
