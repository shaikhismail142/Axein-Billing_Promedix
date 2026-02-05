import { NextResponse } from "next/server";
import { pool } from "../../lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { rows } = await pool.query(
      `SELECT p.id, p.name, p.sku, COALESCE(c.name,'other') as category, p.stock, p.reorder_level
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE p.stock <= COALESCE(p.reorder_level,10)
       ORDER BY p.stock ASC, p.name ASC LIMIT 200`
    );
    return NextResponse.json({ items: rows });
  } catch (err) {
    console.error("GET /api/low-stock failed:", err);
    return NextResponse.json({ error: "Failed to fetch low stock" }, { status: 500 });
  }
}
