// app/lib/license.ts
// Offline license verification utilities (Ed25519), token parsing, and helpers.
// - Accepts "share-a-key" tokens you generate with your private key.
// - Verifies signature using one (or more) baked-in public keys selected by `kid`.
// - No network calls; fully offline.
//
// ✅ How to provide public keys (SPKI base64):
// Option A (recommended): set env LICENSE_PUBKEYS_JSON to a JSON map:
//   {"ed25519-v1":"<SPKI_BASE64>", "ed25519-v2":"<SPKI_BASE64_2>"}
// Option B: hard-code them in PUBLIC_KEYS below (keep private key secret!).
//
// Token format we expect (as issued by your `issue-license.js`):
//   L-AXEIN.<base64url(JSON payload)>.sig:<base64url(signature)>
//
// Payload example:
// {
//   "sub": "Acme Traders Pvt Ltd",
//   "plan": "pro",
//   "seats": 3,
//   "features": ["quotations","invoices","backup"],
//   "issued_at": "2025-09-27T12:02:00Z",
//   "expires_at": null,
//   "device_lock": false,
//   "device_hash": null,
//   "kid": "ed25519-v1"
// }

import crypto from 'crypto';

export type LicensePayload = {
  sub: string;
  plan?: string;
  seats?: number;
  features?: string[];
  issued_at?: string | null;      // ISO UTC
  expires_at?: string | null;     // ISO UTC or null for perpetual
  device_lock?: boolean;
  device_hash?: string | null;    // sha256(device_id|sub) if locked
  kid?: string;                   // key id label to select public key
  [k: string]: any;               // forward-compat
};

export type VerifiedLicense = {
  payload: LicensePayload;
  payloadBytes: Buffer;
  kid: string;
};

// ---- Public key provisioning -------------------------------------------------

/**
 * Optional hard-coded keys (fallback). You can paste your SPKI base64 here.
 * Example: { "ed25519-v1": "MCowBQYDK2VwAyEAXxx..." }
 */
const PUBLIC_KEYS_FALLBACK: Record<string, string> = {
  // "ed25519-v1": "<PASTE_SPki_BASE64_HERE>"
};

function loadPublicKeys(): Record<string, Buffer> {
  // 1) LICENSE_PUBKEYS_JSON env has priority
  const envJson = process.env.LICENSE_PUBKEYS_JSON?.trim();
  let mapping: Record<string, string> | null = null;

  if (envJson) {
    try {
      const parsed = JSON.parse(envJson);
      if (parsed && typeof parsed === 'object') {
        mapping = parsed as Record<string, string>;
      }
    } catch {
      throw new Error(
        'LICENSE_PUBKEYS_JSON is not valid JSON. Example: {"ed25519-v1":"<SPKI_BASE64>"}'
      );
    }
  }

  const source = mapping ?? PUBLIC_KEYS_FALLBACK;

  const out: Record<string, Buffer> = {};
  for (const [kid, spkiB64] of Object.entries(source)) {
    if (!spkiB64 || typeof spkiB64 !== 'string') continue;
    try {
      out[kid] = Buffer.from(spkiB64, 'base64'); // DER (SPKI) bytes
    } catch {
      // ignore malformed; will be caught on access
    }
  }
  return out;
}

const PUBKEYS_DER: Record<string, Buffer> = loadPublicKeys();

function getPublicKeyByKid(kid: string): crypto.KeyObject {
  const der = PUBKEYS_DER[kid];
  if (!der) {
    const available = Object.keys(PUBKEYS_DER);
    throw new Error(
      `Unknown key id (kid="${kid}"). Available kids: ${available.length ? available.join(', ') : '(none configured)'}`
    );
  }
  // Build a KeyObject from DER SPKI
  return crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
}

// ---- Base64url helpers -------------------------------------------------------

function b64urlToBuffer(b64url: string): Buffer {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  // pad to multiple of 4
  const pad = b64.length % 4 === 2 ? '==' : b64.length % 4 === 3 ? '=' : '';
  return Buffer.from(b64 + pad, 'base64');
}

// ---- Token parsing & verification --------------------------------------------

export function parseToken(token: string): { payloadBytes: Buffer; payload: LicensePayload; sig: Buffer; kid: string } {
  if (!token || typeof token !== 'string') {
    throw new Error('License token is empty.');
  }

  // Expected shape: L-AXEIN.<payload>.sig:<signature>
  const prefix = 'L-AXEIN.';
  const sigSep = '.sig:';

  if (!token.startsWith(prefix) || !token.includes(sigSep)) {
    throw new Error('Invalid license token format.');
  }

  const withoutPrefix = token.slice(prefix.length);
  const [payloadB64u, sigB64u] = withoutPrefix.split(sigSep);
  if (!payloadB64u || !sigB64u) throw new Error('Invalid license token segments.');

  const payloadBytes = b64urlToBuffer(payloadB64u);
  let payload: LicensePayload;
  try {
    payload = JSON.parse(payloadBytes.toString('utf8'));
  } catch {
    throw new Error('License payload is not valid JSON.');
  }

  const kid = (payload.kid ?? '').toString();
  if (!kid) throw new Error('License payload missing "kid".');

  const sig = b64urlToBuffer(sigB64u);

  return { payloadBytes, payload, sig, kid };
}

export function verifyEd25519Signature(
    publicKey: crypto.KeyObject,
    payloadBytes: Uint8Array | Buffer,
    signature: Uint8Array | Buffer
  ): boolean {
    // Force both to concrete Uint8Array (ArrayBufferView) for TS
    const data: Uint8Array = Buffer.isBuffer(payloadBytes)
      ? new Uint8Array(payloadBytes)
      : (payloadBytes as Uint8Array);
  
    const sig: Uint8Array = Buffer.isBuffer(signature)
      ? new Uint8Array(signature)
      : (signature as Uint8Array);
  
    // Ed25519: pass null as digest algorithm
    return crypto.verify(null, data, publicKey, sig);
  }

/**
 * Parse & verify the token. Throws on any failure.
 * Returns the verified payload and associated info.
 */
export function parseAndVerifyToken(token: string): VerifiedLicense {
  const { payloadBytes, payload, sig, kid } = parseToken(token);
  const pubKey = getPublicKeyByKid(kid);

  const ok = verifyEd25519Signature(pubKey, payloadBytes, sig);
  if (!ok) throw new Error('License signature verification failed.');

  // Basic semantic checks (non-cryptographic)
  if (!payload.sub || typeof payload.sub !== 'string') {
    throw new Error('License payload must include a non-empty "sub" (customer).');
  }

  // If expires_at is present and not null, ensure it parses as a date
  if (payload.expires_at !== null && payload.expires_at !== undefined) {
    const d = new Date(String(payload.expires_at));
    if (Number.isNaN(d.getTime())) {
      throw new Error('License payload has invalid "expires_at".');
    }
  }

  return { payload, payloadBytes, kid };
}

// ---- Device hash helper ------------------------------------------------------

/** Deterministic binding: sha256(device_id|sub) => hex */
export function computeDeviceHash(deviceId: string, subject: string): string {
  return crypto.createHash('sha256').update(`${deviceId}|${subject}`, 'utf8').digest('hex');
}

// ---- Expiry helpers ----------------------------------------------------------

export function isExpired(expires_at: string | null | undefined, now: Date = new Date()): boolean {
  if (!expires_at) return false; // perpetual
  const d = new Date(expires_at);
  if (Number.isNaN(d.getTime())) return true; // treat invalid as expired
  return now.getTime() > d.getTime();
}

/** Optional small skew tolerance (minutes) when evaluating expiry. */
export function isExpiredWithSkew(expires_at: string | null | undefined, skewMinutes = 10, now: Date = new Date()): boolean {
  if (!expires_at) return false;
  const d = new Date(expires_at);
  if (Number.isNaN(d.getTime())) return true;
  return now.getTime() > d.getTime() + skewMinutes * 60 * 1000;
}
