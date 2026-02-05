import { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_: NextRequest) {
  return new Response(JSON.stringify({ error: 'Use /api/quotations/[id]/pdf' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' },
  });
}
