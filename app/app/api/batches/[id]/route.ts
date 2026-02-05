// app/api/batches/[id]/route.ts

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { pool } from "../../../lib/db";

type ColMap = {
  table: string;
  id: string;
  product_id: string;
  batch_no?: string;
  mfg_date?: string;   // date
  exp_date?: string;   // date
  qty?: string;        // numeric
  cost_price?: string; // numeric
  mrp?: string;        // numeric
  supplier_id?: string;
};

async function detectBatchesTableAndColumns(client: any): Promise<ColMap> {
  const tRes = await client.query(`
    SELECT COALESCE(
      (SELECT 'product_batches' WHERE to_regclass('public.product_batches') IS NOT NULL),
      (SELECT 'batches'          WHERE to_regclass('public.batches') IS NOT NULL),
      ''
    ) AS t
  `);
  const table = (tRes.rows?.[0] as any)?.t || "";
  if (!table) throw new Error("No batches table found (expected product_batches or batches).");

  const colsRes = await client.query(
    `SELECT LOWER(column_name) AS col
     FROM information_schema.columns
     WHERE table_schema='public' AND table_name=$1`,
    [table]
  );
  const cols = new Set<string>(colsRes.rows.map((r: any) => r.col));
  const pick = (...candidates: string[]) => candidates.find((c) => cols.has(c));

  const id = pick("id") || "id";
  const product_id = pick("product_id") || "product_id";
  const batch_no = pick("batch_no", "batch", "batch_code", "batchcode");
  const mfg_date = pick("mfg_date", "manufacture_date", "manufacturing_date", "mfd_date", "mfg_on");
  const exp_date = pick("exp_date", "expiry_date", "expiration_date", "exp_dt", "expiry_on", "expire_on");
  const qty = pick("qty", "quantity", "available_qty", "stock_qty");
  const cost_price = pick("cost_price", "cost", "purchase_price", "base_cost");
  const mrp = pick("mrp", "retail_price", "sell_price", "selling_price", "price");
  const supplier_id = pick("supplier_id", "vendor_id");

  return { table, id, product_id, batch_no, mfg_date, exp_date, qty, cost_price, mrp, supplier_id };
}

function isISODate(s: unknown) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  // Skip DB during builder stage
  if (process.env.BUILDING === "1") {
    return Response.json({ ok: true, note: "build-skip" });
  }

  const id = params.id;
  if (!id) return Response.json({ ok: false, error: "Missing id" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const { mfg_date, exp_date } = body || {};

  if (mfg_date !== undefined && mfg_date !== null && !isISODate(mfg_date)) {
    return Response.json({ ok: false, error: "mfg_date must be YYYY-MM-DD" }, { status: 400 });
  }
  if (exp_date !== undefined && exp_date !== null && !isISODate(exp_date)) {
    return Response.json({ ok: false, error: "exp_date must be YYYY-MM-DD" }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    const map = await detectBatchesTableAndColumns(client);
    const t = map.table;

    const sets: string[] = [];
    const paramsArr: any[] = [];
    let i = 1;

    if (map.mfg_date !== undefined && mfg_date !== undefined) {
      if (mfg_date === null) {
        sets.push(`${map.mfg_date} = NULL`);
      } else {
        sets.push(`${map.mfg_date} = $${i++}::date`);
        paramsArr.push(mfg_date);
      }
    }
    if (map.exp_date !== undefined && exp_date !== undefined) {
      if (exp_date === null) {
        sets.push(`${map.exp_date} = NULL`);
      } else {
        sets.push(`${map.exp_date} = $${i++}::date`);
        paramsArr.push(exp_date);
      }
    }

    if (sets.length === 0) {
      return Response.json({ ok: false, error: "Nothing to update" }, { status: 400 });
    }

    // WHERE id
    paramsArr.push(id);

    await client.query(`UPDATE ${t} SET ${sets.join(", ")} WHERE ${map.id} = $${i}`, paramsArr);

    // Return updated row (shape matches /api/batches GET)
    const sel = [
      `b.${map.id} AS id`,
      `b.${map.product_id} AS product_id`,
      `p.name AS product_name`,
      `(p.meta->>'sku') AS sku`,
      map.batch_no ? `b.${map.batch_no} AS batch_no` : `'—'::text AS batch_no`,
      map.mfg_date ? `to_char(b.${map.mfg_date}, 'YYYY-MM-DD') AS mfg_date` : `NULL::text AS mfg_date`,
      map.exp_date ? `to_char(b.${map.exp_date}, 'YYYY-MM-DD') AS exp_date` : `NULL::text AS exp_date`,
      map.qty ? `b.${map.qty}::text AS qty` : `'0'::text AS qty`,
      map.cost_price ? `b.${map.cost_price}::text AS cost_price` : `NULL::text AS cost_price`,
      map.mrp ? `b.${map.mrp}::text AS mrp` : `NULL::text AS mrp`,
      map.supplier_id ? `b.${map.supplier_id}::text AS supplier_id` : `NULL::text AS supplier_id`,
      map.exp_date ? `(b.${map.exp_date} - CURRENT_DATE) AS days_left` : `NULL::int AS days_left`,
    ].join(",\n        ");

    const { rows } = await client.query(
      `SELECT ${sel}
       FROM ${t} b
       JOIN products p ON p.id = b.${map.product_id}
       WHERE b.${map.id} = $1`,
      [id]
    );

    return Response.json({ ok: true, item: rows?.[0] ?? null });
  } catch (err: any) {
    console.error("PATCH /api/batches/[id] error:", err);
    return Response.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
  } finally {
    client.release();
  }
}
