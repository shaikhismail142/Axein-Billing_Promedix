// app/api/reports/customers/retention/route.ts
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
    WITH orders AS (
      SELECT s.customer_id
      FROM sales s
      WHERE s.invoice_date >= $1::date
        AND s.invoice_date < ($2::date + INTERVAL '1 day')
        AND s.customer_id IS NOT NULL
      GROUP BY s.customer_id
    ),
    first_seen AS (
      SELECT customer_id, MIN(invoice_date)::date AS first_date
      FROM sales
      WHERE customer_id IS NOT NULL
      GROUP BY customer_id
    )
    SELECT
      SUM(CASE WHEN fs.first_date >= $1::date AND fs.first_date < ($2::date + INTERVAL '1 day') THEN 1 ELSE 0 END)::int AS new_count,
      SUM(CASE WHEN fs.first_date <  $1::date THEN 1 ELSE 0 END)::int AS repeat_count
    FROM orders o
    JOIN first_seen fs ON fs.customer_id = o.customer_id
    `,
    [from, to]
  );

  return NextResponse.json(rows[0] || { new_count: 0, repeat_count: 0 });
}