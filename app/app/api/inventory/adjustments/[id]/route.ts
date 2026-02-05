export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { pool } from "@/app/lib/db";
import { guardApiActivated } from "@/app/lib/activation-guard";

function nstr(v: unknown) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const g = await guardApiActivated(true);
  if ("response" in g) return g.response;

  const id = Number(params.id);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
  }

  const head = await pool.query(
    `SELECT id, adjustment_date, status, reason, reference, notes, created_at, posted_at, meta
       FROM inventory_adjustments WHERE id=$1`,
    [id]
  );
  if (head.rowCount === 0) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }
  const items = await pool.query(
    `SELECT ia.id, ia.product_id, p.name AS product_name, ia.delta_qty, ia.unit_cost, ia.notes
       FROM inventory_adjustment_items ia
       JOIN products p ON p.id = ia.product_id
      WHERE ia.adjustment_id = $1
      ORDER BY ia.id ASC`,
    [id]
  );

  return NextResponse.json({ ok: true, header: head.rows[0], items: items.rows });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const g = await guardApiActivated(true);
  if ("response" in g) return g.response;

  const id = Number(params.id);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
  }

  let payload: any = {};
  try { payload = await req.json(); } catch {}

  const head = await pool.query(`SELECT status FROM inventory_adjustments WHERE id=$1`, [id]);
  if (head.rowCount === 0) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }
  if (head.rows[0].status !== "draft") {
    return NextResponse.json({ ok: false, error: "Only drafts can be edited" }, { status: 400 });
  }

  const fields: string[] = [];
  const paramsArr: any[] = [];
  if (payload.adjustment_date) {
    paramsArr.push(new Date(String(payload.adjustment_date)).toISOString());
    fields.push(`adjustment_date = $${paramsArr.length}`);
  }
  if (payload.reason) {
    paramsArr.push(String(payload.reason));
    fields.push(`reason = $${paramsArr.length}`);
  }
  if (payload.reference !== undefined) {
    paramsArr.push(nstr(payload.reference));
    fields.push(`reference = $${paramsArr.length}`);
  }
  if (payload.notes !== undefined) {
    paramsArr.push(nstr(payload.notes));
    fields.push(`notes = $${paramsArr.length}`);
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    if (fields.length) {
      paramsArr.push(id);
      await client.query(
        `UPDATE inventory_adjustments SET ${fields.join(", ")} WHERE id=$${paramsArr.length}`,
        paramsArr
      );
    }

    if (Array.isArray(payload.items)) {
      // replace-all strategy for simplicity & correctness
      await client.query(`DELETE FROM inventory_adjustment_items WHERE adjustment_id=$1`, [id]);

      const normItems = [];
      for (const it of payload.items) {
        const pid = Number(it.product_id);
        const delta = Number(it.delta_qty);
        if (!Number.isFinite(pid) || pid <= 0) {
          throw new Error("Invalid product_id in items");
        }
        if (!Number.isFinite(delta) || delta === 0) {
          throw new Error("delta_qty must be non-zero in items");
        }
        const unit_cost = it.unit_cost == null ? null : Number(it.unit_cost);
        normItems.push({ product_id: pid, delta_qty: delta, unit_cost, notes: nstr(it.notes) });
      }

      for (const it of normItems) {
        await client.query(
          `INSERT INTO inventory_adjustment_items
            (adjustment_id, product_id, delta_qty, unit_cost, notes)
           VALUES ($1, $2, $3, $4, $5)`,
          [id, it.product_id, it.delta_qty, it.unit_cost, it.notes]
        );
      }

      // refresh summary
      const sum = await client.query(
        `SELECT COUNT(*)::int AS lines, COALESCE(SUM(delta_qty),0) AS net_delta
           FROM inventory_adjustment_items
          WHERE adjustment_id = $1`,
        [id]
      );
      await client.query(
        `UPDATE inventory_adjustments
            SET meta = jsonb_set(COALESCE(meta,'{}'::jsonb), '{items_summary}',
                                 to_jsonb($2::json), true)
          WHERE id=$1`,
        [id, { lines: sum.rows[0].lines, net_delta: Number(sum.rows[0].net_delta) }]
      );
    }

    await client.query("COMMIT");
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    try { await client.query("ROLLBACK"); } catch {}
    return NextResponse.json({ ok: false, error: e?.message || "Update failed" }, { status: 500 });
  } finally {
    client.release();
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const g = await guardApiActivated(true);
  if ("response" in g) return g.response;

  const id = Number(params.id);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
  }

  const rs = await pool.query(`SELECT status FROM inventory_adjustments WHERE id=$1`, [id]);
  if (rs.rowCount === 0) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }
  if (rs.rows[0].status !== "draft") {
    return NextResponse.json({ ok: false, error: "Only drafts can be deleted" }, { status: 400 });
  }

  await pool.query(`DELETE FROM inventory_adjustments WHERE id=$1`, [id]);
  return NextResponse.json({ ok: true });
}
