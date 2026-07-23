#!/usr/bin/env node
import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..", "..");

const runtimeNodeDir = path.join(root, "desktop", "runtime", "node");

function run(cmd, args, cwd = root) {
  const out = spawnSync(cmd, args, { cwd, stdio: "pipe", encoding: "utf8" });
  if (out.status !== 0) {
    throw new Error(
      `${cmd} ${args.join(" ")} failed (${out.status}): ${out.stderr?.trim() || out.stdout?.trim() || "unknown error"}`,
    );
  }
  return (out.stdout || "").trim();
}

function archTag() {
  if (process.arch === "arm64") return "arm64";
  if (process.arch === "x64") return "x64";
  throw new Error(`Unsupported architecture for desktop node bundle: ${process.arch}`);
}

async function cleanRuntimeNodeDir() {
  await fs.rm(runtimeNodeDir, { recursive: true, force: true });
  await fs.mkdir(runtimeNodeDir, { recursive: true });
}

async function copyPortableNodeForDarwin() {
  const version = process.env.AXEIN_NODE_VERSION || "20.19.5";
  const vTag = `v${version}`;
  const darwinArch = archTag();
  const distName = `node-${vTag}-darwin-${darwinArch}`;
  const archiveName = `${distName}.tar.gz`;
  const downloadUrl = `https://nodejs.org/dist/${vTag}/${archiveName}`;

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "axein-node-"));
  const archivePath = path.join(tempRoot, archiveName);
  const extractDir = path.join(tempRoot, "extract");
  await fs.mkdir(extractDir, { recursive: true });

  try {
    run("curl", ["-fL", downloadUrl, "-o", archivePath]);
    run("tar", ["-xzf", archivePath, "-C", extractDir]);

    const srcRoot = path.join(extractDir, distName);
    const srcBinDir = path.join(srcRoot, "bin");
    const srcLibDir = path.join(srcRoot, "lib");
    const srcNode = path.join(srcBinDir, "node");

    if (!fssync.existsSync(srcNode) || !fssync.existsSync(srcLibDir)) {
      throw new Error(`Portable Node archive extracted without expected bin/lib at ${srcRoot}`);
    }

    await fs.mkdir(path.join(runtimeNodeDir, "bin"), { recursive: true });
    await fs.cp(srcBinDir, path.join(runtimeNodeDir, "bin"), { recursive: true });
    await fs.cp(srcLibDir, path.join(runtimeNodeDir, "lib"), { recursive: true });
    // npm/npx symlinks inside official tarballs point to full extracted paths.
    // The desktop runtime only needs `node`.
    await fs.rm(path.join(runtimeNodeDir, "bin", "npm"), { force: true });
    await fs.rm(path.join(runtimeNodeDir, "bin", "npx"), { force: true });
    await fs.chmod(path.join(runtimeNodeDir, "bin", "node"), 0o755);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }

  return {
    source: `official-dist ${downloadUrl}`,
    target: path.join(runtimeNodeDir, "bin", "node"),
  };
}

async function copyProcessNodeDefault() {
  const explicit = process.env.AXEIN_NODE_BIN ? path.resolve(process.env.AXEIN_NODE_BIN) : null;
  const sourceNode = explicit || process.execPath;

  if (!fssync.existsSync(sourceNode)) {
    throw new Error(`Node binary not found at ${sourceNode}`);
  }

  const isWin = process.platform === "win32";
  const target = path.join(runtimeNodeDir, isWin ? "node.exe" : "node");
  await fs.copyFile(sourceNode, target);
  if (!isWin) {
    await fs.chmod(target, 0o755);
  }

  return { source: sourceNode, target };
}

async function removeDanglingSymlinks(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await removeDanglingSymlinks(fullPath);
      continue;
    }
    if (!entry.isSymbolicLink()) continue;
    try {
      // stat() follows symlinks and throws when the target does not exist.
      await fs.stat(fullPath);
    } catch {
      await fs.rm(fullPath, { force: true });
      console.warn(`Removed dangling symlink from bundled runtime: ${fullPath}`);
    }
  }
}

async function main() {
  await cleanRuntimeNodeDir();

  let bundled;
  if (process.platform === "darwin" && !process.env.AXEIN_NODE_BIN) {
    bundled = await copyPortableNodeForDarwin();
  } else {
    bundled = await copyProcessNodeDefault();
  }

  // Tauri packaging rejects missing resource paths. Some Node distros include
  // symlinks (e.g. corepack) whose targets may be absent on CI images.
  await removeDanglingSymlinks(runtimeNodeDir);

  const note = [
    "Bundled Node runtime for AxEin desktop.",
    `Source: ${bundled.source}`,
    `Target: ${bundled.target}`,
    `Generated at: ${new Date().toISOString()}`,
  ].join("\n");

  await fs.writeFile(path.join(runtimeNodeDir, "README.txt"), note, "utf8");
  console.log(`Bundled node runtime -> ${bundled.target}`);
}

main().catch((err) => {
  console.error("prepare-node-runtime failed:", err.message || err);
  process.exit(1);
});
