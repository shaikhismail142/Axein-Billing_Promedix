// app/api/products/low-stock/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

/** GET: list products where stock_qty <= low_stock_threshold (meta) */
export async function GET() {
  try {
    const r = await pool.query(`
      SELECT id, name,
        COALESCE((meta->>'stock_qty')::numeric,0) AS stock_qty,
        COALESCE((meta->>'low_stock_threshold')::numeric,0) AS low_stock_threshold
      FROM products
      WHERE COALESCE((meta->>'stock_qty')::numeric,0) <= COALESCE((meta->>'low_stock_threshold')::numeric,0)
      ORDER BY name
      LIMIT 200
    `);
    return NextResponse.json({ items: r.rows });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed" }, { status: 500 });
  }
}

/** PATCH: set threshold or stock manually
 * body: { product_id, low_stock_threshold?, stock_qty? }
 */
export async function PATCH(req: Request) {
  let body: { product_id: number; low_stock_threshold?: number; stock_qty?: number };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Bad JSON" }, { status: 400 }); }
  if (!Number.isFinite(body.product_id)) return NextResponse.json({ error: "product_id required" }, { status: 400 });

  try {
    const r = await pool.query(`SELECT id, meta FROM products WHERE id=$1`, [body.product_id]);
    if (!r.rowCount) return NextResponse.json({ error: "Product not found" }, { status: 404 });

    const meta = r.rows[0].meta || {};
    if (typeof body.low_stock_threshold === "number") meta.low_stock_threshold = body.low_stock_threshold;
    if (typeof body.stock_qty === "number") meta.stock_qty = body.stock_qty;

    await pool.query(`UPDATE products SET meta=$2::jsonb WHERE id=$1`, [body.product_id, JSON.stringify(meta)]);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed" }, { status: 500 });
  }
}
