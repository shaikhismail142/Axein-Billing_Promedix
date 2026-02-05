// app/api/quotations/[id]/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  // Quotation + customer name/meta
  const q = await pool.query(
    `select q.*,
            c.name  as customer_name,
            c.meta  as customer_meta
       from quotations q
       left join customers c on c.id = q.customer_id
      where q.id = $1
      limit 1`,
    [id]
  );
  if (q.rowCount === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const quotation = q.rows[0];

  // Items (description/qty/price/tax/discount)
  const itemsRs = await pool.query(
    `select id, product_id, description, qty, price, tax, discount, meta
       from quotation_items
      where quotation_id = $1
      order by id asc`,
    [id]
  );

  return NextResponse.json({
    quotation,
    items: itemsRs.rows,
  });
}
