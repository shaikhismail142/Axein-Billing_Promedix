// app/api/quotations/bulk-delete/route.ts
import { NextResponse } from "next/server";
import { getDb } from "@/app/lib/db";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body) return new NextResponse("Bad JSON", { status: 400 });

  const db = await getDb();
  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const where: string[] = [];
    const params: unknown[] = [];

    if (body.all) {
      const q = (body.q || "").trim();

      if (q) {
        params.push(`%${q}%`);
        where.push(`(c.name ILIKE $${params.length} OR q.quotation_number ILIKE $${params.length})`);
      }

      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
      const { rows } = await client.query(
        `
        SELECT q.id
        FROM quotations q
        LEFT JOIN customers c ON c.id = q.customer_id
        ${whereSql}
        `,
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

    await client.query(`DELETE FROM quotation_items WHERE quotation_id = ANY($1::int[])`, [ids]);
    const del = await client.query(`DELETE FROM quotations WHERE id = ANY($1::int[])`, [ids]);
    await client.query("COMMIT");

    const deleted =
      (del as any)?.rowCount ??
      (Array.isArray((del as any)?.rows) ? (del as any).rows.length : 0);
    return NextResponse.json({ deleted });
  } catch (e: any) {
    await client.query("ROLLBACK");
    return new NextResponse(e?.message || "Delete failed", { status: 500 });
  } finally {
    client.release();
  }
}
