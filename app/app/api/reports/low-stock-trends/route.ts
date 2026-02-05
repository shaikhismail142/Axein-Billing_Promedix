import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (!from || !to) return NextResponse.json({ error: "from/to required" }, { status: 400 });

  const { rows } = await pool.query(
    `
    WITH low_now AS (
      SELECT lower(p.name) AS nm
      FROM products p
      WHERE COALESCE(NULLIF(p.meta->>'stock_qty','')::int, 0)
          <= COALESCE(NULLIF(p.meta->>'low_stock_threshold','')::int, 0)
    ),
    sold AS (
      SELECT s.invoice_date::date AS d, lower(si.name) AS nm
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      WHERE s.invoice_date >= $1::date
        AND s.invoice_date < ($2::date + INTERVAL '1 day')
      GROUP BY s.invoice_date::date, lower(si.name)
    )
    SELECT d::date AS date, COUNT(*)::int AS low_count
    FROM sold
    WHERE nm IN (SELECT nm FROM low_now)
    GROUP BY d
    ORDER BY d
    `,
    [from, to]
  );

  return NextResponse.json({ items: rows });
}
