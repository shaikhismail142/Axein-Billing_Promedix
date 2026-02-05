export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

/** GET /api/customers?q=...   → { items: [{id,name,phone,gstin,address}] } */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const q = (url.searchParams.get("q") || "").trim();
    const limit = Math.min(50, Number(url.searchParams.get("limit") || 20));

    if (!q) {
      const rs = await pool.query(
        `SELECT id, name, phone, gstin, address
           FROM customers
          ORDER BY name ASC
          LIMIT $1`,
        [limit]
      );
      return NextResponse.json({ items: rs.rows });
    }

    const rs = await pool.query(
      `SELECT id, name, phone, gstin, address
         FROM customers
        WHERE name ILIKE $1
           OR phone ILIKE $1
           OR gstin ILIKE $1
        ORDER BY name ASC
        LIMIT $2`,
      [`%${q}%`, limit]
    );
    return NextResponse.json({ items: rs.rows });
  } catch (err) {
    console.error("GET /api/customers failed:", err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

/** Optional: create a quick customer if needed */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!body?.name || typeof body.name !== "string") {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    const rs = await pool.query(
      `INSERT INTO customers(name, phone, gstin, address)
       VALUES($1, $2, $3, $4)
       RETURNING id`,
      [
        body.name.trim(),
        body.phone ? String(body.phone) : null,
        body.gstin ? String(body.gstin) : null,
        body.address ? String(body.address) : null,
      ]
    );
    return NextResponse.json({ id: rs.rows[0].id }, { status: 201 });
  } catch (err) {
    console.error("POST /api/customers failed:", err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
