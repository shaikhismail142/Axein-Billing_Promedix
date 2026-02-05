// app/api/activation/status/route.ts
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { pool } from "@/app/lib/db";
import { currentFingerprint } from "@/app/lib/fingerprint";

const NO_STORE = { headers: { "Cache-Control": "no-store" } };

export async function GET() {
  // Dev/ops bypass: if activation isn't required, always report ok=true
  if (process.env.APP_ACTIVATION_REQUIRED !== "true") {
    return NextResponse.json({ ok: true, reason: null }, NO_STORE);
  }

  const client = await pool.connect();
  try {
    const fpNow = currentFingerprint(); // compute for this machine

    const q = await client.query(`SELECT v FROM app_state WHERE k='activation'`);
    if (q.rowCount === 0) {
      return NextResponse.json({ ok: false, reason: "not_activated" }, NO_STORE);
    }

    const v = (q.rows[0].v ?? {}) as { ok?: boolean; fp?: string };
    const ok = Boolean(v.ok) && v.fp === fpNow.value;

    return NextResponse.json(
      { ok, reason: ok ? null : (v.ok ? "fingerprint_mismatch" : "not_activated") },
      NO_STORE
    );
  } catch (e) {
    console.error("activation/status error", e);
    return NextResponse.json({ ok: false, reason: "server_error" }, NO_STORE);
  } finally {
    client.release();
  }
}
