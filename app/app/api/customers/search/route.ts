import { NextResponse } from "next/server";
import { pool } from "@/app/lib/db"; // your pg Pool

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "").trim();
  const limit = Math.min(Math.max(parseInt(searchParams.get("limit") || "10", 10), 1), 50);

  try {
    const client = await pool.connect();
    try {
      // Adjust fields to your customers table; meta is JSONB per your project
      const values: any[] = [];
      let where = "";
      if (q) {
        values.push(`%${q}%`, `%${q}%`, `%${q}%`);
        where = `
          WHERE
            c.name ILIKE $1 OR
            COALESCE(c.email, '') ILIKE $2 OR
            COALESCE(c.phone, '') ILIKE $3
        `;
      }

      values.push(limit);
      const sql = `
        SELECT
          c.id,
          c.name,
          c.email,
          c.phone,
          c.meta
        FROM customers c
        ${where}
        ORDER BY c.name ASC
        LIMIT $${values.length}
      `;
      const { rows } = await client.query(sql, values);

      return NextResponse.json({ ok: true, items: rows, count: rows.length }, {
        headers: { "Cache-Control": "no-store" },
      });
    } finally {
      client.release();
    }
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || "Search failed" }, { status: 500 });
  }
}
