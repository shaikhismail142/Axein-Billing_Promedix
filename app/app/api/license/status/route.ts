// app/api/license/status/route.ts
import 'server-only';
import { NextResponse } from 'next/server';
import os from 'node:os';
import crypto from 'node:crypto';
import { getActivationStatus, getActivationRecord } from '@/app/lib/license-activation';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function stableDeviceId() {
  // Derive a stable, non-PII device id from hostname (works in Docker too)
  const h = os.hostname();
  return crypto.createHash('sha1').update(h).digest('hex'); // 40 chars
}

export async function GET() {
  try {
    const status = await getActivationStatus();       // may auto-start a 7-day trial once
    const rec = await getActivationRecord();          // raw persisted record (if any)

    const isLicensed = status.mode === 'active';
    const trialActive = status.mode === 'trial';

    // pick an expiry to display
    const expiresAt =
      (trialActive && rec?.trial_expires_at) ||
      (isLicensed && rec?.license?.expires_at) ||
      null;

    const daysLeft =
      expiresAt
        ? Math.max(0, Math.ceil((Date.parse(expiresAt) - Date.now()) / (1000 * 60 * 60 * 24)))
        : 0;

    // In our model, trial is allowed until it's started once (then we flip it false).
    // Treat undefined as true for backward compatibility.
    const trialEnabled = rec?.trial_allowed !== false;

    // Panel wants these exact names:
    const payload = {
      ok: true,
      // legacy/simple flags
      isLicensed,
      trialActive,
      daysLeft,
      expiresAt,
      canStartTrial: trialEnabled && !isLicensed && !trialActive,

      // panel extras
      deviceId: stableDeviceId(),
      trialStartedAt: rec?.trial_started_at ?? null,
      trialExpiresAt: rec?.trial_expires_at ?? null,
      trialEnabled,
      trialDays: 7, // fixed window
      serverTimeUTC: new Date().toISOString(),

      // structured status for newer callers
      status,
    };

    return NextResponse.json(payload, { status: 200 });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? 'Failed to read status' },
      { status: 500 }
    );
  }
}
