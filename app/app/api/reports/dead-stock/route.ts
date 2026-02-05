import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const days = Math.max(1, Number(url.searchParams.get("days") ?? 30));
  const onlyBelow = (url.searchParams.get("below") ?? "").toLowerCase() === "true";

  const { rows } = await pool.query(
    `
    WITH recent AS (
      SELECT DISTINCT lower(si.name) AS nm
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      WHERE s.invoice_date >= NOW() - INTERVAL '${days} days'
    )
    SELECT
      p.id,
      p.name,
      COALESCE(NULLIF(p.meta->>'stock_qty','')::int, 0) AS stock_qty,
      COALESCE(NULLIF(p.meta->>'low_stock_threshold','')::int, 0) AS low_stock_threshold
    FROM products p
    LEFT JOIN recent r ON lower(p.name) = r.nm
    WHERE r.nm IS NULL
      ${onlyBelow ? "AND COALESCE(NULLIF(p.meta->>'stock_qty','')::int, 0) <= COALESCE(NULLIF(p.meta->>'low_stock_threshold','')::int, 0)" : ""}
    ORDER BY p.name ASC
    `
  );

  return NextResponse.json({ items: rows, days, onlyBelow });
}
