// app/lib/license-activation.ts
import "server-only";
import crypto from "node:crypto";
import { pool } from "@/app/lib/db";

export type LicensePayload = {
  license_key: string;
  email: string;
  expires_at: string; // ISO
  signature: string;  // base64
};

export type ActivationRecord = {
  mode: "active" | "trial" | "read_only" | "inactive";
  ok: boolean;
  reason?: string | null;

  // When active
  license?: Omit<LicensePayload, "signature"> | null;

  // When trial
  trial_allowed?: boolean;
  trial_started_at?: string | null;
  trial_expires_at?: string | null;
  source?: "legacy" | "portal" | null;
  portal_certificate?: PortalCertificate | null;
  portal_last_validated_at?: string | null;
  read_only?: boolean;

  updated_at: string;
};

export type PortalCertificate = {
  alg: "Ed25519";
  kid: string;
  payload: {
    schema: "axein.billing.activation.v1";
    license_id: string;
    customer_id: number;
    company_id: number;
    product: string;
    edition: string;
    device_hash: string;
    valid_from: string;
    valid_until: string;
    issued_at: string;
    lease_expires_at: string;
    nonce: string;
  };
  signature: string;
};

const NOW_ISO = () => new Date().toISOString();

const DEFAULTS: ActivationRecord = {
  mode: "inactive",
  ok: false,
  reason: null,
  license: null,
  trial_allowed: true,
  trial_started_at: null,
  trial_expires_at: null,
  source: null,
  portal_certificate: null,
  portal_last_validated_at: null,
  read_only: false,
  updated_at: NOW_ISO(),
};

function isModernActivationShape(v: any): v is ActivationRecord {
  return v && typeof v === "object" && typeof v.mode === "string" && typeof v.updated_at === "string";
}

/** Coerce legacy (flat) or wrapped shapes into a modern ActivationRecord */
function normalizeActivationShape(raw: any): ActivationRecord {
  if (!raw || typeof raw !== "object") return { ...DEFAULTS, updated_at: NOW_ISO() };

  // If wrapped { activation: {...} }, unwrap.
  const maybeInner = raw.activation ?? raw;

  if (isModernActivationShape(maybeInner)) {
    // Ensure defaults for optional flags
    const merged: ActivationRecord = {
      ...DEFAULTS,
      ...maybeInner,
      trial_allowed: maybeInner.trial_allowed ?? DEFAULTS.trial_allowed,
      updated_at: maybeInner.updated_at || NOW_ISO(),
    };
    return merged;
  }

  // Legacy flat shape from migration 0108: keys like is_licensed, license_key, license_payload, trial_* ...
  const isLicensed = !!maybeInner.is_licensed;
  const trialStarted = maybeInner.trial_started_at ? String(maybeInner.trial_started_at) : null;
  const trialExpires = maybeInner.trial_expires_at ? String(maybeInner.trial_expires_at) : null;
  const trialAllowed = maybeInner.trial_allowed !== false; // undefined => true

  let mode: ActivationRecord["mode"] = "inactive";
  if (isLicensed) mode = "active";
  else if (trialStarted && trialExpires && Date.parse(trialExpires) > Date.now()) mode = "trial";

  // Try to lift license payload if present
  let license: ActivationRecord["license"] = null;
  const lp = maybeInner.license_payload;
  if (lp && typeof lp === "object" && lp.license_key && lp.email && lp.expires_at) {
    license = { license_key: String(lp.license_key), email: String(lp.email), expires_at: String(lp.expires_at) };
  } else if (maybeInner.license_key) {
    // Minimal legacy info
    license = {
      license_key: String(maybeInner.license_key),
      email: String(maybeInner.email ?? ""),
      expires_at: String(maybeInner.expires_at ?? ""),
    };
  }

  return {
    ...DEFAULTS,
    mode,
    ok: isLicensed, // legacy "ok" roughly maps to licensed; trial->false
    reason: null,
    license,
    trial_allowed: trialAllowed,
    trial_started_at: trialStarted,
    trial_expires_at: trialExpires,
    updated_at: NOW_ISO(),
  };
}

export function verifySignatureEd25519(
  payload: Omit<LicensePayload, "signature">,
  signatureB64: string,
  publicKeyBase64: string
): boolean {
  const canonical = `${payload.license_key}\n${payload.email}\n${payload.expires_at}`;

  const publicKey = crypto.createPublicKey({
    key: Buffer.from(publicKeyBase64, "base64"),
    format: "der",
    type: "spki",
  });

  // Use Uint8Array to satisfy TS: ArrayBufferView
  const data = new TextEncoder().encode(canonical);
  const signature = Uint8Array.from(Buffer.from(signatureB64, "base64"));

  return crypto.verify(
    null,          // Ed25519 ignores digest algorithm
    data,          // ArrayBufferView
    publicKey,     // KeyObject
    signature      // ArrayBufferView
  );
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function portalPublicKeys(): Record<string, string> {
  const configured = process.env.LICENSE_PUBKEYS_JSON?.trim();
  if (configured) {
    try {
      const parsed = JSON.parse(configured);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      throw new Error("LICENSE_PUBKEYS_JSON is invalid.");
    }
  }
  const legacy = process.env.LICENSE_PUBLIC_KEY?.trim();
  return legacy ? { "axein-2026-01": legacy } : {};
}

export function verifyPortalCertificate(
  certificate: PortalCertificate,
  expectedDeviceHash = process.env.AXEIN_DEVICE_HASH || ""
): PortalCertificate {
  if (!certificate || certificate.alg !== "Ed25519" || !certificate.kid) {
    throw new Error("Portal activation certificate format is invalid.");
  }
  if (certificate.payload?.schema !== "axein.billing.activation.v1") {
    throw new Error("Portal activation certificate schema is unsupported.");
  }
  if (expectedDeviceHash && certificate.payload.device_hash !== expectedDeviceHash) {
    throw new Error("This activation certificate belongs to another computer.");
  }
  const publicKeyBase64 = portalPublicKeys()[certificate.kid];
  if (!publicKeyBase64) throw new Error(`No public key is configured for ${certificate.kid}.`);
  const publicKey = crypto.createPublicKey({
    key: Buffer.from(publicKeyBase64, "base64"),
    format: "der",
    type: "spki",
  });
  const signature = Buffer.from(
    certificate.signature.replace(/-/g, "+").replace(/_/g, "/"),
    "base64"
  );
  const ok = crypto.verify(
    null,
    new TextEncoder().encode(stableJson(certificate.payload)),
    publicKey,
    Uint8Array.from(signature)
  );
  if (!ok) throw new Error("Portal activation certificate signature is invalid.");
  const today = new Date().toISOString().slice(0, 10);
  if (today < certificate.payload.valid_from || today > certificate.payload.valid_until) {
    throw new Error("Portal license is outside its validity period.");
  }
  return certificate;
}

export async function savePortalCertificate(
  certificate: PortalCertificate,
  deviceHash: string
): Promise<ActivationRecord> {
  const verified = verifyPortalCertificate(certificate, deviceHash);
  return saveActivationRecord({
    mode: "active",
    ok: true,
    reason: null,
    source: "portal",
    portal_certificate: verified,
    portal_last_validated_at: NOW_ISO(),
    read_only: false,
    license: {
      license_key: verified.payload.license_id,
      email: "",
      expires_at: `${verified.payload.valid_until}T23:59:59.999Z`,
    },
  });
}

async function refreshPortalCertificate(record: ActivationRecord): Promise<ActivationRecord> {
  const certificate = record.portal_certificate;
  if (!certificate) return record;
  const last = Date.parse(record.portal_last_validated_at || certificate.payload.issued_at);
  if (Number.isFinite(last) && Date.now() - last < 24 * 60 * 60 * 1000) return record;
  const origin = (process.env.AXEIN_LICENSE_PORTAL_URL || "https://axein.in").replace(/\/+$/, "");
  try {
    const response = await fetch(`${origin}/api/v1/billing/activation/validate/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        licenseId: certificate.payload.license_id,
        deviceHash: certificate.payload.device_hash,
        certificateSignature: certificate.signature,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status >= 400 && response.status < 500) {
        return saveActivationRecord({
          mode: "read_only",
          ok: false,
          read_only: true,
          reason: body?.error || "The central license service rejected this activation.",
        });
      }
      throw new Error(body?.error || "The central license service is temporarily unavailable.");
    }
    if (!body?.certificate) throw new Error("Validation response did not include a certificate.");
    return savePortalCertificate(body.certificate, certificate.payload.device_hash);
  } catch {
    return record;
  }
}

/** Load the current activation record (normalized), or null if nothing persisted yet. */
export async function getActivationRecord(): Promise<ActivationRecord | null> {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT value_json
       FROM settings
       WHERE key='activation'
       ORDER BY id DESC
       LIMIT 1`
    );
    const rows = (res as unknown as { rows: Array<{ value_json: any }> }).rows;
    if (!rows || !rows[0]) return null;

    const v = rows[0].value_json ?? null;
    if (!v) return null;

    return normalizeActivationShape(v);
  } finally {
    client.release();
  }
}

/**
 * Save/merge the activation record.
 * Accepts a partial, merges with current + defaults, stamps updated_at, persists wrapped as { activation: ... },
 * mirrors "ok" into app_state, and returns the merged record.
 */
export async function saveActivationRecord(patch: Partial<ActivationRecord>): Promise<ActivationRecord> {
  const client = await pool.connect();
  try {
    // Read current (tolerate legacy)
    const current = await (async () => {
      const res = await client.query(
        `SELECT value_json
         FROM settings
         WHERE key='activation'
         ORDER BY id DESC
         LIMIT 1`
      );
      const rows = (res as unknown as { rows: Array<{ value_json: any }> }).rows;
      if (!rows || !rows[0]) return null;
      return normalizeActivationShape(rows[0].value_json);
    })();

    const merged: ActivationRecord = {
      ...DEFAULTS,
      ...(current ?? {}),
      ...(patch ?? {}),
      updated_at: NOW_ISO(),
    };

    const wrapper = { activation: merged };

    // Source of truth
    await client.query(
      `
      INSERT INTO settings (key, value_json)
      VALUES ('activation', $1::jsonb)
      ON CONFLICT (key) DO UPDATE SET value_json = EXCLUDED.value_json
      `,
      [JSON.stringify(wrapper)]
    );

    // Legacy mirror (optional)
    await client.query(
        `
        INSERT INTO app_state (k, v)
        VALUES ('activation', jsonb_build_object('ok', $1::boolean, 'updated_at', to_char(NOW(),'YYYY-MM-DD"T"HH24:MI:SS"Z"')))
        ON CONFLICT (k) DO UPDATE
          SET v = EXCLUDED.v
        `,
        [merged.ok === true]
      );

    return merged;
  } finally {
    client.release();
  }
}

/** Normalize activation into a light-weight status */
export async function getActivationStatus(): Promise<{
  isLicensed: boolean;
  mode: "active" | "trial" | "read_only" | "inactive";
  trialActive: boolean;
  canStartTrial: boolean;
  daysLeft: number | null;
  expiresAt: string | null;
  readOnly?: boolean;
  source?: "legacy" | "portal" | null;
  reason?: string | null;
}> {
  let a = await getActivationRecord();
  if (!a) {
    return {
      isLicensed: false,
      mode: "inactive",
      trialActive: false,
      canStartTrial: true,
      daysLeft: 0,
      expiresAt: null,
      reason: "No activation record",
    };
  }

  if (a.source === "portal" && a.portal_certificate) {
    try {
      verifyPortalCertificate(a.portal_certificate);
      a = await refreshPortalCertificate(a);
      const leaseExpires = Date.parse(a.portal_certificate?.payload.lease_expires_at || "");
      const readOnly =
        a.read_only === true ||
        !Number.isFinite(leaseExpires) ||
        Date.now() > leaseExpires;
      const expiresAt = `${a.portal_certificate.payload.valid_until}T23:59:59.999Z`;
      if (a.read_only !== readOnly || a.mode !== (readOnly ? "read_only" : "active")) {
        a = await saveActivationRecord({
          mode: readOnly ? "read_only" : "active",
          ok: !readOnly,
          read_only: readOnly,
          reason: readOnly ? "Connect to the internet to refresh the seven-day offline lease." : null,
        });
      }
      return {
        isLicensed: true,
        mode: readOnly ? "read_only" : "active",
        trialActive: false,
        canStartTrial: false,
        daysLeft: Math.max(0, Math.ceil((Date.parse(expiresAt) - Date.now()) / 86400000)),
        expiresAt,
        readOnly,
        source: "portal",
        reason: a.reason ?? null,
      };
    } catch (error: any) {
      return {
        isLicensed: false,
        mode: "inactive",
        trialActive: false,
        canStartTrial: false,
        daysLeft: 0,
        expiresAt: a.portal_certificate.payload.valid_until,
        readOnly: true,
        source: "portal",
        reason: error?.message || "Portal activation is invalid.",
      };
    }
  }

  const mode = a.mode ?? "inactive";
  const isLicensed = mode === "active";
  const trialActive = mode === "trial";
  const canStartTrial = !!a.trial_allowed && !isLicensed && !trialActive;

  let daysLeft: number | null = null;
  let expiresAt: string | null = null;
  if (trialActive && a.trial_expires_at) {
    const ms = new Date(a.trial_expires_at).getTime() - Date.now();
    daysLeft = ms > 0 ? Math.ceil(ms / 86400000) : 0;
    expiresAt = a.trial_expires_at;
  } else if (isLicensed && a.license?.expires_at) {
    expiresAt = a.license.expires_at;
  }

  return {
    isLicensed,
    mode,
    trialActive,
    canStartTrial,
    daysLeft,
    expiresAt,
    readOnly: false,
    source: a.source ?? "legacy",
    reason: a.reason ?? null,
  };
}

/** Seed/flip a 7-day trial window and persist it (helper used by admin or verify-key) */
export async function startTrial(days = 7) {
  const now = new Date();
  const expires = new Date(now.getTime() + days * 86400000);

  const record = await saveActivationRecord({
    mode: "trial",
    ok: false,
    reason: null,
    license: null,
    trial_allowed: false, // once started, disable starting again
    trial_started_at: now.toISOString(),
    trial_expires_at: expires.toISOString(),
  });

  return record;
}
