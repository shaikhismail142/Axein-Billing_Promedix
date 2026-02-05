export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { pool } from "@/app/lib/db";
import { guardApiActivated } from "@/app/lib/activation-guard";
import { adjustStock } from "@/app/lib/inventory/stock";

type ReasonLiteral =
  | "adjustment" | "sale" | "return" | "purchase"
  | "damage" | "loss" | "promo" | "correction";

const ALLOWED_REASONS = new Set<ReasonLiteral>([
  "adjustment","sale","return","purchase","damage","loss","promo","correction"
]);

async function getInventorySettings(client: any) {
  const rs = await client.query(
    `SELECT value_json FROM settings WHERE key='inventory' LIMIT 1`
  );
  const j = rs.rows?.[0]?.value_json || {};
  return { allow_negative_stock: !!j.allow_negative_stock };
}

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const g = await guardApiActivated(true);
  if ("response" in g) return g.response;

  const id = Number(params.id);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const head = await client.query(
      `SELECT id, status, reason, reference, notes
         FROM inventory_adjustments
        WHERE id=$1
        FOR UPDATE`,
      [id]
    );
    if (head.rowCount === 0) throw new Error("Not found");
    if (head.rows[0].status !== "draft") throw new Error("Only drafts can be posted");

    const items = await client.query(
      `SELECT product_id, delta_qty, unit_cost, notes
         FROM inventory_adjustment_items
        WHERE adjustment_id=$1
        ORDER BY id ASC
        FOR UPDATE`,
      [id]
    );
    if (items.rowCount === 0) throw new Error("No items to post");

    const settings = await getInventorySettings(client);
    const allowNeg = !!settings.allow_negative_stock;

    // Normalize the reason to a typed literal
    const rawReason = String(head.rows[0].reason ?? "adjustment").toLowerCase();
    const reason: ReasonLiteral = ALLOWED_REASONS.has(rawReason as ReasonLiteral)
      ? (rawReason as ReasonLiteral)
      : "adjustment";

    // Apply all deltas atomically
    for (const it of items.rows) {
      const res = await adjustStock({
        client,
        productId: Number(it.product_id),
        delta: Number(it.delta_qty),
        reason, // <- typed literal
        refType: "inventory_adjustment",
        refId: id,
        allowNegativeOverride: allowNeg,
        meta: {
          note: it.notes || null,
          reference: head.rows[0].reference || null,
          unit_cost: it.unit_cost ?? null,
        },
      });
      if (!res.ok) throw new Error(res.error || "Stock update failed");
    }

    await client.query(
      `UPDATE inventory_adjustments
          SET status='posted',
              posted_at = now(),
              meta = jsonb_set(COALESCE(meta,'{}'::jsonb), '{posted_summary}', to_jsonb(now()), true)
        WHERE id=$1`,
      [id]
    );

    await client.query("COMMIT");
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    try { await client.query("ROLLBACK"); } catch {}
    return NextResponse.json({ ok: false, error: e?.message || "Post failed" }, { status: 400 });
  } finally {
    client.release();
  }
}
