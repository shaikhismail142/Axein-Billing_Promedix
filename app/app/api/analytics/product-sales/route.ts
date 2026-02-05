export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from"); // YYYY-MM-DD
  const to = searchParams.get("to");     // YYYY-MM-DD

  // Default to current FY (Apr 1 → today, IST)
  const now = new Date();
  const fyStart = new Date(now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1, 3, 1);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const dateFrom = from ?? fmt(fyStart);
  const dateTo = to ?? fmt(now);

  // Sum by product; schema uses sale_items.name (not description)
  // taxable column already includes discounts; tax % in sale_items.tax
  const q = `
    SELECT
      COALESCE(p.name, si.name) AS product_name,
      SUM(si.qty)::numeric                                    AS total_qty,
      SUM(si.taxable)::numeric                                AS taxable,
      SUM(si.taxable * (COALESCE(si.tax,0)/100.0))::numeric   AS tax,
      SUM(si.taxable * (1 + COALESCE(si.tax,0)/100.0))::numeric AS total
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id
    LEFT JOIN products p ON lower(p.name) = lower(si.name)
    WHERE (COALESCE(s.invoice_date, s.created_at) AT TIME ZONE 'Asia/Kolkata')::date
          BETWEEN $1::date AND $2::date
    GROUP BY 1
    ORDER BY total DESC
  `;

  const { rows } = await pool.query(q, [dateFrom, dateTo]);

  const data = rows.map(r => ({
    product_name: r.product_name as string,
    total_qty: Number(r.total_qty),
    taxable: Number(r.taxable),
    tax: Number(r.tax),
    total: Number(r.total),
  }));

  return NextResponse.json({ from: dateFrom, to: dateTo, data });
}
