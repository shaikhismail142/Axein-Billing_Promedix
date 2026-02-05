// app/api/invoices/bulk-delete/route.ts
import { NextResponse } from "next/server";
import { pool } from "@/app/lib/db";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body) return new NextResponse("Bad JSON", { status: 400 });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Build a normalized subquery of matching sale IDs (same rules as list/export)
    const where: string[] = [];
    const params: unknown[] = [];

    if (body.all) {
      const q = (body.q || "").trim();
      const from = body.from || "";
      const to = body.to || "";

      const cte = `
        WITH norm AS (
          SELECT
            s.id,
            COALESCE(
              to_jsonb(s)->>'invoice_no',
              to_jsonb(s)->>'bill_no',
              to_jsonb(s)->>'sale_no',
              to_jsonb(s)->>'number'
            ) AS invno,
            COALESCE(
              (to_jsonb(s)->>'created_at')::timestamp,
              (to_jsonb(s)->>'created_on')::timestamp,
              (to_jsonb(s)->>'date')::timestamp
            ) AS dt,
            COALESCE(c.name, to_jsonb(s)->>'customer_name', '') AS cust
          FROM sales s
          LEFT JOIN customers c
            ON c.id = COALESCE((to_jsonb(s)->>'customer_id')::int, NULL)
        )
      `;

      if (q) { params.push(`%${q}%`); const i = params.length; where.push(`(invno ILIKE $${i} OR cust ILIKE $${i})`); }
      if (from) { params.push(from); where.push(`dt >= $${params.length}::date`); }
      if (to)   { params.push(to);   where.push(`dt < ($${params.length}::date + INTERVAL '1 day')`); }

      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
      const { rows } = await client.query(
        `${cte} SELECT id FROM norm ${whereSql}`,
        params
      );
      body.ids = rows.map((r: any) => r.id);
    }

    const ids: number[] =
      Array.isArray(body.ids) ? body.ids.filter((n: any) => Number.isFinite(Number(n))).map(Number) : [];

    if (ids.length === 0) {
      await client.query("ROLLBACK");
      return new NextResponse("No ids to delete", { status: 400 });
    }

    // If you have sale_items referencing sales(id), remove children first (safe no-op if FK ON DELETE CASCADE)
    await client.query(`DELETE FROM sale_items WHERE sale_id = ANY($1::int[])`, [ids]);
    await client.query(`DELETE FROM sale_payments WHERE sale_id = ANY($1::int[])`, [ids]).catch(() => { /* optional table */ });

    const del = await client.query(`DELETE FROM sales WHERE id = ANY($1::int[])`, [ids]);
    await client.query("COMMIT");

    return NextResponse.json({ deleted: del.rowCount ?? 0 });
  } catch (e: any) {
    await client.query("ROLLBACK");
    return new NextResponse(e?.message || "Delete failed", { status: 500 });
  } finally {
    client.release();
  }
}
