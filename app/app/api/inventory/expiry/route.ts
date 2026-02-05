export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { pool } from "@/app/lib/db";
import { guardApiActivated } from "@/app/lib/activation-guard";

export async function GET(req: Request) {
  const g = await guardApiActivated(true);
  if ("response" in g) return g.response;

  const url = new URL(req.url);
  const days = Math.min(365, Math.max(1, Number(url.searchParams.get('days') ?? 90)));

  const { rows } = await pool.query(
    `SELECT pb.*, p.name as product_name
       FROM product_batches pb
       JOIN products p ON p.id = pb.product_id
      WHERE pb.expiry_date IS NOT NULL
        AND pb.expiry_date <= (CURRENT_DATE + $1::interval)
      ORDER BY pb.expiry_date ASC`,
    [`${days} days`]
  );

  return NextResponse.json(rows);
}
