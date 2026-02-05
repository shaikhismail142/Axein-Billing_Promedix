// app/api/expiry/route.ts
// AxEin Billing — Expiry API
// Returns { ok, near_expiry_days, near_expiry: BatchRow[], expired: BatchRow[] }

export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { guardApiActivated } from "@/lib/activation-guard";

export async function GET(_req: NextRequest) {
  await guardApiActivated(true); // allow trial
  const url = new URL(_req.url);
  const q = (url.searchParams.get("q") || "").trim();
  const client = await pool.connect();
  try {
    // near_expiry_days comes from settings (key='inventory' -> value_json.near_expiry_days), default 30
    let nearDays = 30;
    try {
      const s = await client.query(
        `SELECT (value_json->>'near_expiry_days')::int AS d
         FROM settings WHERE key = 'inventory' LIMIT 1`
      );
      const d = s.rows?.[0]?.d;
      if (Number.isFinite(d) && d > 0 && d < 3650) nearDays = d;
    } catch {}

    const rows: any[] = [];

    // Detect batch table (product_batches or legacy batches)
    let batchTable = "";
    let batchCols = new Set<string>();
    try {
      const tRes = await client.query(`
        SELECT COALESCE(
          (SELECT 'product_batches' WHERE to_regclass('public.product_batches') IS NOT NULL),
          (SELECT 'batches'          WHERE to_regclass('public.batches') IS NOT NULL),
          ''
        ) AS t
      `);
      batchTable = (tRes.rows?.[0] as any)?.t || "";
      if (batchTable) {
        const colsRes = await client.query(
          `SELECT LOWER(column_name) AS col
           FROM information_schema.columns
           WHERE table_schema='public' AND table_name=$1`,
          [batchTable]
        );
        batchCols = new Set<string>(colsRes.rows.map((r: any) => r.col));
      }
    } catch {
      batchTable = "";
    }

    const pick = (...candidates: string[]) => candidates.find((c) => batchCols.has(c));
    const productIdCol = pick("product_id") || "product_id";
    const batchNoCol = pick("batch_no", "batch_code", "batch", "batchcode");
    const expCol = pick("expiry_date", "exp_date", "expiration_date", "expiry_on", "expire_on");
    const mfgCol = pick("mfg_date", "mfg", "manufacture_date", "mfg_on");
    const qtyCol = pick("qty", "quantity", "stock_qty");

    const params: any[] = [];
    const whereParts: string[] = [];
    if (q) {
      params.push(`%${q}%`);
      const idx = params.length;
      const batchNoExpr = batchNoCol ? `b.${batchNoCol}::text` : "''";
      whereParts.push(`(p.name ILIKE $${idx} OR ${batchNoExpr} ILIKE $${idx})`);
    }

    // Batch rows (if table + expiry column exist)
    if (batchTable && expCol) {
      const whereSql = whereParts.length ? `AND ${whereParts.join(" AND ")}` : "";
      const batchNoExpr = batchNoCol ? `b.${batchNoCol}::text` : "NULL::text";
      const mfgExpr = mfgCol ? `b.${mfgCol}::date` : "NULL::date";
      const qtyExpr = qtyCol ? `b.${qtyCol}::numeric` : "0::numeric";

      const batchSql = `
        SELECT
          b.id AS batch_id,
          b.${productIdCol} AS product_id,
          COALESCE(p.name, p.meta->>'name') AS product_name,
          ${batchNoExpr} AS batch_no,
          ${mfgExpr} AS mfg_date,
          b.${expCol}::date AS expiry_date,
          ${qtyExpr} AS qty
        FROM ${batchTable} b
        LEFT JOIN products p ON p.id = b.${productIdCol}
        WHERE b.${expCol} IS NOT NULL
        ${whereSql}
        ORDER BY b.${expCol} ASC NULLS LAST
      `;
      const batchRes = await client.query(batchSql, params);
      rows.push(
        ...(batchRes.rows || []).map((r: any) => ({
          row_id: `b-${r.batch_id}`,
          batch_id: r.batch_id,
          product_id: r.product_id,
          product_name: r.product_name || `#${r.product_id}`,
          batch_no: r.batch_no,
          mfg_date: r.mfg_date,
          expiry_date: r.expiry_date,
          qty: Number(r.qty || 0),
        }))
      );
    }

    // Product-level expiry (from products.meta) — only when batch expiry missing
    const expExpr = `
      CASE
        WHEN (p.meta->>'exp_date') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN (p.meta->>'exp_date')::date
        WHEN (p.meta->>'expiry_date') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN (p.meta->>'expiry_date')::date
        ELSE NULL
      END
    `;
    const pParams: any[] = [];
    const pWhere: string[] = [`${expExpr} IS NOT NULL`];
    if (q) {
      pParams.push(`%${q}%`);
      const idx = pParams.length;
      pWhere.push(
        `(p.name ILIKE $${idx} OR (p.meta->>'sku') ILIKE $${idx} OR COALESCE(p.meta->>'category','') ILIKE $${idx})`
      );
    }
    const pWhereSql = pWhere.length ? `WHERE ${pWhere.join(" AND ")}` : "";
    const prodSql = `
      SELECT
        p.id AS product_id,
        p.name AS product_name,
        ${expExpr} AS expiry_date,
        COALESCE(NULLIF(p.meta->>'stock_qty','')::numeric, NULLIF(p.meta->>'stock','')::numeric, 0) AS qty
      FROM products p
      ${pWhereSql}
      ORDER BY ${expExpr} ASC NULLS LAST, p.name ASC
    `;
    const prodRes = await client.query(prodSql, pParams);

    const batchProductIds = new Set(
      rows.map((r) => Number(r.product_id)).filter((n) => Number.isFinite(n))
    );
    const productRows = (prodRes.rows || [])
      .map((r: any) => ({
        row_id: `p-${r.product_id}`,
        batch_id: null,
        product_id: r.product_id,
        product_name: r.product_name || `#${r.product_id}`,
        batch_no: null,
        mfg_date: null,
        expiry_date: r.expiry_date,
        qty: Number(r.qty || 0),
      }))
      .filter((r: any) => !batchProductIds.has(Number(r.product_id)));

    rows.push(...productRows);

    const near_expiry: any[] = [];
    const expired: any[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const r of rows) {
      if (!r.expiry_date) continue;
      const exp = new Date(r.expiry_date);
      exp.setHours(0, 0, 0, 0);
      const days = Math.floor((exp.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      const row = {
        row_id: r.row_id,
        batch_id: r.batch_id,
        product_id: r.product_id,
        product_name: r.product_name || `#${r.product_id}`,
        batch_no: r.batch_no,
        mfg_date: r.mfg_date,
        expiry_date: r.expiry_date,
        qty: Number(r.qty || 0),
        days_until: days,
      };
      if (Number.isFinite(days)) {
        if (days < 0) expired.push(row);
        else if (days <= nearDays) near_expiry.push(row);
      }
    }

    return NextResponse.json({ ok: true, near_expiry_days: nearDays, near_expiry, expired });
  } catch (err: any) {
    console.error("GET /api/expiry error", err);
    return NextResponse.json({ ok: false, error: err?.message || String(err) }, { status: 500 });
  } finally {
    client.release();
  }
}
