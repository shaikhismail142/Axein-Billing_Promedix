import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";

function sha256(s: string) {
  return crypto.createHash("sha256").update(s, "utf8").digest("hex");
}

function read(path: string): string | null {
  try { return fs.readFileSync(path, "utf8").trim(); } catch { return null; }
}

function ensureInstallId(): string {
  const dir = "/install";
  const file = `${dir}/INSTALL_ID`;
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(file)) {
      const id = crypto.randomUUID();
      fs.writeFileSync(file, id + "\n", { encoding: "utf8" });
      return id;
    }
    return read(file) || "no-install-id";
  } catch {
    return "no-install-id";
  }
}

function readMachineId(): string {
  return (
    read("/etc/machine-id") ||
    read("/var/lib/dbus/machine-id") ||
    "no-machine-id"
  );
}

export function currentFingerprint(): { value: string; details: Record<string, string> } {
  const installId = ensureInstallId();   // persists via /install mount
  const machineId = readMachineId();     // stable per host VM
  const host = os.hostname();

  const raw = `${machineId}|${installId}|${host}`;
  return { value: sha256(raw), details: { machineId, installId, host } };
}
