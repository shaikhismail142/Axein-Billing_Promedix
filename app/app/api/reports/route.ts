import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { guardApiActivated } from "@/app/lib/activation-guard";

// prevent prerendering
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // ✅ Require activation; allow trial users
  const g = await guardApiActivated(true);
  if ("response" in g) return g.response;

  try {
    const url = new URL(req.url);
    const fmt = url.searchParams.get("format");

    // Totals
    const [{ rows: a }, { rows: b }] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS total_products FROM products`),
      pool.query(`
        SELECT SUM(COALESCE(selling_price,0) * COALESCE(stock,0))::NUMERIC(14,2) AS stock_value
        FROM products
      `),
    ]);

    // Category breakdown — NO joins, only products.category
    const { rows: byCat } = await pool.query(`
      SELECT COALESCE(category,'other') AS category, COUNT(*)::int AS count
      FROM products
      GROUP BY COALESCE(category,'other')
      ORDER BY count DESC, category ASC
    `);

    // Sales for last 14 days (works even if there are zero rows)
    const { rows: sales14 } = await pool.query(`
      SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
             COALESCE(SUM(total),0)::numeric(12,2) AS amount
      FROM sales
      GROUP BY 1
      ORDER BY 1 DESC
      LIMIT 14
    `);

    if (fmt === "csv") {
      const header = "category,count\n" + byCat.map(r => `${r.category},${r.count}`).join("\n");
      return new Response(header, { headers: { "Content-Type": "text/csv" } });
    }

    return NextResponse.json({
      total_products: a[0]?.total_products ?? 0,
      stock_value: b[0]?.stock_value ?? 0,
      by_category: byCat,
      sales14,
    });
  } catch (err) {
    console.error("GET /api/reports failed:", err);
    return NextResponse.json({ error: "reports_failed" }, { status: 500 });
  }
}
