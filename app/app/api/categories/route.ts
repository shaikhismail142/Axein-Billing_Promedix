import { NextResponse } from "next/server";
import { pool } from "../../lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    let items: { id?: number; name: string }[] = [];
    try {
      const { rows } = await pool.query("SELECT id, name FROM categories ORDER BY name");
      items = rows;
    } catch {
      // categories table may not exist; fallback below
    }

    // Always include distinct categories from products (fallback + completeness)
    try {
      const { rows } = await pool.query(
        `
        SELECT DISTINCT
          COALESCE(NULLIF(p.meta->>'category',''), NULLIF(p.category,'')) AS name
        FROM products p
        WHERE COALESCE(NULLIF(p.meta->>'category',''), NULLIF(p.category,'')) IS NOT NULL
        ORDER BY 1
        `
      );
      const fromProducts = rows.map((r: any) => ({ name: String(r.name) }));
      const seen = new Set(items.map((i) => i.name.toLowerCase()));
      for (const it of fromProducts) {
        const key = it.name.toLowerCase();
        if (!seen.has(key)) {
          items.push(it);
          seen.add(key);
        }
      }
    } catch {
      // ignore
    }

    return NextResponse.json({ items });
  } catch (err) {
    console.error("GET /api/categories failed:", err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { name } = await req.json();
    const n = String(name || "").trim();
    if (!n) return NextResponse.json({ error: "Name required" }, { status: 400 });
    try {
      const { rows } = await pool.query(
        "INSERT INTO categories(name) VALUES($1) ON CONFLICT (name) DO NOTHING RETURNING id",
        [n]
      );
      return NextResponse.json({ id: rows?.[0]?.id ?? null, ok: true }, { status: 201 });
    } catch {
      // If categories table doesn't exist, silently succeed
      return NextResponse.json({ ok: true }, { status: 200 });
    }
  } catch (err) {
    console.error("POST /api/categories failed:", err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
