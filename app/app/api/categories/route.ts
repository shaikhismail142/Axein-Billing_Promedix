import { NextResponse } from "next/server";
import { pool } from "../../lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { rows } = await pool.query("SELECT id, name FROM categories ORDER BY name");
    return NextResponse.json({ items: rows });
  } catch (err) {
    console.error("GET /api/categories failed:", err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { name } = await req.json();
    const { rows } = await pool.query("INSERT INTO categories(name) VALUES($1) RETURNING id", [name]);
    return NextResponse.json({ id: rows[0].id }, { status: 201 });
  } catch (err) {
    console.error("POST /api/categories failed:", err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
