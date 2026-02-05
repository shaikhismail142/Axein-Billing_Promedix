// app/api/stock/adjust/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { pool } from "@/app/lib/db";
import { guardApiActivated } from "@/app/lib/activation-guard";
import { adjustStock } from "@/app/lib/inventory/stock";

type Body = {
  product_id: number | string;
  delta_qty: number | string;
  reason:
    | "sale" | "return" | "purchase" | "adjustment"
    | "damage" | "loss" | "promo" | "correction";
  note?: string | null;
  ref_type?: string | null;
  ref_id?: number | string | null;
  allow_negative_stock?: boolean;
};

export async function POST(req: Request) {
  // Allow during trial
  const guard = await guardApiActivated(true);
  if ("response" in guard) return guard.response;

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const pid = Number(body.product_id);
  const delta = Number(body.delta_qty);
  const reason = String(body.reason || "adjustment") as Body["reason"];
  if (!Number.isFinite(pid) || pid <= 0) {
    return NextResponse.json({ ok: false, error: "product_id is required" }, { status: 400 });
  }
  if (!Number.isFinite(delta) || delta === 0) {
    return NextResponse.json({ ok: false, error: "delta_qty must be non-zero" }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const res = await adjustStock({
      client,
      productId: pid,
      delta,
      reason,
      refType: body.ref_type ?? "adjustment",
      refId: body.ref_id ?? null,
      allowNegativeOverride: !!body.allow_negative_stock,
      meta: body.note ? { note: String(body.note) } : {},
    });

    if (!res.ok) {
      await client.query("ROLLBACK");
      return NextResponse.json({ ok: false, error: res.error }, { status: 400 });
    }

    await client.query("COMMIT");
    return NextResponse.json({ ok: true, ...res });
  } catch (e: any) {
    try { await client.query("ROLLBACK"); } catch {}
    return NextResponse.json({ ok: false, error: e?.message || "Adjustment failed" }, { status: 500 });
  } finally {
    client.release();
  }
}
