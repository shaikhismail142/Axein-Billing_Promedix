// app/lib/activation-guard.ts
import 'server-only';
import { NextResponse } from 'next/server';
import { getActivationStatus } from '@/app/lib/license-activation';

type ActiveStatus =
  | { mode: 'active' }
  | { mode: 'trial'; trial_expires_at: string }
  | { mode: 'inactive'; reason?: string };

// --- Build-time detection (avoid DB during next build) ---
function isBuildTime() {
  return process.env.NEXT_PHASE === 'phase-production-build' || process.env.BUILDING === '1';
}

function buildBypassStatus(): Extract<ActiveStatus, { mode: 'trial' }> {
  // Harmless synthetic trial so pages/APIs can prerender without DB
  const trial_expires_at = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  return { mode: 'trial', trial_expires_at };
}

/**
 * Guard for API routes:
 *  - mode 'active' passes
 *  - mode 'trial' passes if allowTrial=true
 *  - otherwise returns JSON 402 with reason
 */
export async function guardApiActivated(allowTrial = true): Promise<
  | { ok: true; status: ActiveStatus }
  | { ok: false; response: NextResponse }
> {
  // Skip DB during build
  if (isBuildTime()) {
    if (allowTrial) {
      const st = buildBypassStatus();
      return { ok: true, status: st };
    }
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: 'Activation required' }, { status: 402 }),
    };
  }

  const st = (await getActivationStatus()) as ActiveStatus;
  const ok = st.mode === 'active' || (allowTrial && st.mode === 'trial');

  if (ok) return { ok: true, status: st };

  const reason = st.mode === 'inactive' && 'reason' in st ? st.reason : 'Activation required';
  return {
    ok: false,
    response: NextResponse.json({ ok: false, error: reason || 'Activation required' }, { status: 402 }),
  };
}

/**
 * Server helper for page loaders (RSC):
 * - Returns {ok:true, status} when allowed
 * - Else throws an Error (you can catch or redirect)
 */
export async function ensureActivated(allowTrial = true): Promise<{ ok: true; status: ActiveStatus }> {
  // Skip DB during build
  if (isBuildTime()) {
    if (allowTrial) {
      const st = buildBypassStatus();
      return { ok: true, status: st };
    }
    const err: Error & { code?: string } = new Error('Activation required');
    err.code = 'NOT_ACTIVATED';
    throw err;
  }

  const st = (await getActivationStatus()) as ActiveStatus;
  const ok = st.mode === 'active' || (allowTrial && st.mode === 'trial');
  if (ok) return { ok: true, status: st };

  const reason = st.mode === 'inactive' && 'reason' in st ? st.reason : 'Activation required';
  const err: Error & { code?: string } = new Error(reason || 'Activation required');
  err.code = 'NOT_ACTIVATED';
  throw err;
}
