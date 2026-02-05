// app/api/inventory/settings/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { pool } from "@/app/lib/db";
import { guardApiActivated } from "@/app/lib/activation-guard";

export async function GET() {
  const g = await guardApiActivated(true);
  if ("response" in g) return g.response;

  const rs = await pool.query(`SELECT value_json FROM settings WHERE key='inventory' LIMIT 1`);
  return NextResponse.json(rs.rows?.[0]?.value_json ?? {});
}

export async function PATCH(req: Request) {
  const g = await guardApiActivated(true);
  if ("response" in g) return g.response;

  let payload: any = {};
  try { payload = await req.json(); } catch {}
  const merged = {
    allow_negative_stock: !!payload.allow_negative_stock,
    low_stock_threshold_default: Number(payload.low_stock_threshold_default ?? 5),
    reorder_multiplier: Number(payload.reorder_multiplier ?? 1.5),
    alert_channels: Array.isArray(payload.alert_channels) ? payload.alert_channels : ["dashboard"],
  };

  await pool.query(
    `INSERT INTO settings(key, value_json)
       VALUES ('inventory', $1::jsonb)
     ON CONFLICT (key) DO UPDATE
       SET value_json = $1::jsonb`,
    [JSON.stringify(merged)]
  );

  return NextResponse.json({ ok: true, settings: merged });
}
