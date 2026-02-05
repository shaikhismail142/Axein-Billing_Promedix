// Lists recent stock_movements with product names
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { pool } from "@/app/lib/db";
import { guardApiActivated } from "@/app/lib/activation-guard";

export async function GET(req: Request) {
  const g = await guardApiActivated(true);
  if ("response" in g) return g.response;

  const url = new URL(req.url);
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') ?? 50)));

  const { rows } = await pool.query(
    `SELECT sm.*, p.name as product_name
       FROM stock_movements sm
       LEFT JOIN products p ON p.id = sm.product_id
       ORDER BY sm.created_at DESC
       LIMIT $1`,
    [limit]
  );
  return NextResponse.json(rows);
}
