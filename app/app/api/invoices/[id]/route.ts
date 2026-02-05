// app/api/invoices/[id]/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export async function PATCH(_req: Request, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "Bad id" }, { status: 400 });
  let body: any;
  try { body = await _req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const rs = await client.query(`SELECT meta FROM sales WHERE id=$1 FOR UPDATE`, [id]);
    if (!rs.rowCount) { await client.query("ROLLBACK"); return NextResponse.json({ error: "Not found" }, { status: 404 }); }
    const meta = { ...(rs.rows[0].meta || {}) };

    if (typeof body.is_return === "boolean") meta.is_return = body.is_return;
    if (body.amount_paid !== undefined) meta.amount_paid = Number(body.amount_paid || 0);
    if (typeof body.notes === "string") meta.notes = body.notes;

    await client.query(`UPDATE sales SET meta=$2, updated_at=now() WHERE id=$1`, [id, meta]);
    await client.query("COMMIT");
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    await client.query("ROLLBACK");
    console.error("PATCH /api/invoices/[id] failed", e);
    return NextResponse.json({ error: e?.message || "Failed" }, { status: 500 });
  } finally {
    client.release();
  }
}
