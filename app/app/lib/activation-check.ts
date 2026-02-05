// app/lib/activation-check.ts
import { pool } from '@/app/lib/db';
import { currentFingerprint } from '@/app/lib/fingerprint';

function envTrue(val: string | undefined | null): boolean {
  const v = String(val ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

/**
 * Returns true if the app still needs activation.
 * - If APP_ACTIVATION_REQUIRED is falsy (0/false), activation is disabled.
 * - If DB flag app_state['activation'].v.ok === true, activation is NOT required.
 * - Optional per-device binding with APP_ACTIVATION_BIND_FINGERPRINT=1.
 */
export async function isActivationRequired(): Promise<boolean> {
  // If explicitly disabled (dev/QA), never require activation
  if (!envTrue(process.env.APP_ACTIVATION_REQUIRED)) return false;

  const client = await pool.connect();
  try {
    // NOTE: no generic on client.query — cast rows instead
    const q = await client.query(`SELECT v FROM public.app_state WHERE k='activation' LIMIT 1`);
    if (!q.rows || q.rows.length === 0) return true; // no flag yet → require activation

    const row = q.rows[0] as any;
    const v = (row?.v ?? {}) as {
      ok?: boolean;
      fp?: string;              // legacy single fingerprint
      fingerprints?: string[];  // preferred list of verified fingerprints
    };

    if (v.ok === true) {
      if (envTrue(process.env.APP_ACTIVATION_BIND_FINGERPRINT)) {
        const { value: fp } = currentFingerprint();
        const allowed = Array.isArray(v.fingerprints)
          ? v.fingerprints
          : v.fp
          ? [v.fp]
          : [];
        return !allowed.includes(fp);
      }
      return false; // globally activated
    }

    return true; // ok !== true → still requires activation
  } finally {
    client.release();
  }
}

/** Convenience wrapper: true if already activated, false if activation still required. */
export async function isActivated(): Promise<boolean> {
  return !(await isActivationRequired());
}
