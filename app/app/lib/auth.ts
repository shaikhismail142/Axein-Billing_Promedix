import { NextRequest } from 'next/server';

// Dev-friendly admin guard.
// - If DISABLE_ADMIN_CHECK=1 (compose), always allow.
// - Else allow requests that send x-admin: 1 (curl or local UI if you add it).
export async function isAdmin(req: NextRequest) {
  if (process.env.DISABLE_ADMIN_CHECK === '1') return true;

  const hdr = req.headers.get('x-admin');
  if (hdr === '1') return true;

  // Optional cookie fallback (if you ever set it in UI)
  const cookie = req.headers.get('cookie') || '';
  if (/\bx-admin=1\b/.test(cookie)) return true;

  return false;
}
