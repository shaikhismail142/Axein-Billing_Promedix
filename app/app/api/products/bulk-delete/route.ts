// app/api/products/bulk-delete/route.ts
import { NextResponse } from "next/server";
import { pool } from "@/app/lib/db";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const ids: number[] | undefined = Array.isArray(body?.ids) ? body.ids : undefined;
  const all: boolean = !!body?.all;
  const q: string = (body?.q || "").trim();

  if (!all && (!ids || ids.length === 0)) {
    return NextResponse.json({ error: "Provide ids[] or set all=true" }, { status: 400 });
  }

  if (all) {
    const params: any[] = [];
    const where: string[] = [];
    if (q) {
      params.push(`%${q}%`);
      where.push(`(p.name ILIKE $${params.length} OR (p.meta->>'sku') ILIKE $${params.length})`);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const { rowCount } = await pool.query(`DELETE FROM products p ${whereSql}`, params);
    return NextResponse.json({ ok: true, deleted: rowCount, scope: "all-filtered" });
  } else {
    const clean = ids.filter((n) => Number.isFinite(Number(n))).map(Number);
    const { rowCount } = await pool.query(
      `DELETE FROM products WHERE id = ANY($1::int[])`,
      [clean]
    );
    return NextResponse.json({ ok: true, deleted: rowCount, scope: "selected" });
  }
}
