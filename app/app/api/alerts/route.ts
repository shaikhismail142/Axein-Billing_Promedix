// app/api/alerts/route.ts
// AxEin Billing — Alerts API
// Returns counts for low-stock, near-expiry, expired, plus a few top items for the bell dropdown

export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { guardApiActivated } from "@/lib/activation-guard";

async function getColumns(client: any, table: string): Promise<Set<string>> {
  const r = await client.query(
    `SELECT LOWER(column_name) AS col
     FROM information_schema.columns
     WHERE table_schema='public' AND table_name=$1`,
    [table]
  );
  return new Set<string>(r.rows.map((x: any) => x.col));
}

async function tableExists(client: any, table: string): Promise<boolean> {
  const r = await client.query(`SELECT to_regclass($1) IS NOT NULL AS ok`, [`public.${table}`]);
  return !!r.rows?.[0]?.ok;
}

export async function GET(_req: NextRequest) {
  await guardApiActivated(true);
  const client = await pool.connect();
  try {
    // 1) near_expiry_days from settings (inventory)
    let nearDays = 30;
    try {
      const s = await client.query(
        `SELECT (value_json->>'near_expiry_days')::int AS d FROM settings WHERE key='inventory' LIMIT 1`
      );
      const d = s.rows?.[0]?.d;
      if (Number.isFinite(d) && d > 0 && d < 3650) nearDays = d;
    } catch {}

    const productCols = await getColumns(client, "products");
    const hasMeta = productCols.has("meta");
    const hasStockQty = productCols.has("stock_qty");
    const hasLow = productCols.has("low_stock_threshold");
    const hasSku = productCols.has("sku");

    const stockExpr = hasMeta
      ? "COALESCE((meta->>'stock_qty')::numeric, 0)"
      : hasStockQty
      ? "COALESCE(stock_qty, 0)"
      : "0";
    const lowExpr = hasMeta
      ? "COALESCE((meta->>'low_stock_threshold')::numeric, 0)"
      : hasLow
      ? "COALESCE(low_stock_threshold, 0)"
      : "0";
    const skuExpr = hasMeta
      ? "(meta->>'sku')"
      : hasSku
      ? "sku"
      : "NULL";

    // 2) Low stock (meta or columns)
    const lowStockSql = `
      SELECT id, name, ${skuExpr} AS sku,
             ${stockExpr} AS stock_qty,
             ${lowExpr} AS low_stock_threshold
      FROM products
      WHERE ${stockExpr} <= ${lowExpr}
      ORDER BY ${stockExpr} ASC
      LIMIT 10;
    `;

    const lowCountSql = `
      SELECT COUNT(*)::int AS cnt
      FROM products
      WHERE ${stockExpr} <= ${lowExpr};
    `;

    const hasBatches = await tableExists(client, "product_batches");
    const expirySql = hasBatches
      ? `
        WITH base AS (
          SELECT b.id AS batch_id, b.product_id, COALESCE(p.name, ${hasMeta ? "p.meta->>'name'" : "NULL"}) AS product_name,
                 b.batch_no, b.expiry_date::date AS expiry_date,
                 (b.expiry_date::date - CURRENT_DATE) AS days_until,
                 b.qty::numeric AS qty
          FROM product_batches b
          LEFT JOIN products p ON p.id = b.product_id
          WHERE b.expiry_date IS NOT NULL
        )
        SELECT * FROM base ORDER BY expiry_date ASC NULLS LAST;
      `
      : null;

    const [lowRes, lowCountRes, expRes] = await Promise.all([
      client.query(lowStockSql),
      client.query(lowCountSql),
      expirySql ? client.query(expirySql) : Promise.resolve({ rows: [] }),
    ]);

    const lowItems = lowRes.rows.map(r => ({
      type: 'low_stock' as const,
      id: r.id,
      label: r.name,
      sku: r.sku,
      stock_qty: Number(r.stock_qty),
      threshold: Number(r.low_stock_threshold),
      href: `/products?low=1&highlight=${r.id}`,
    }));

    let near = 0, expired = 0;
    const expItems: any[] = [];
    for (const r of expRes.rows) {
      const days = Number(r.days_until);
      if (!Number.isFinite(days)) continue;
      if (days < 0) expired++;
      else if (days <= nearDays) near++;
      if (expItems.length < 10 && (days < 0 || days <= nearDays)) {
        expItems.push({
          type: days < 0 ? 'expired' : 'near_expiry',
          product_id: r.product_id,
          product_name: r.product_name || `#${r.product_id}`,
          batch_id: r.batch_id,
          batch_no: r.batch_no,
          expiry_date: r.expiry_date,
          days_until: days,
          qty: Number(r.qty),
          href: `/inventory/expiry#${days < 0 ? 'expired' : 'near'}`,
        });
      }
    }

    // 4) Debt alerts (pending vendor bills)
    const pCols = await getColumns(client, "purchases");
    const hasPMeta = pCols.has("meta");
    const hasPStatus = pCols.has("status");
    const totalExpr = pCols.has("grand_total")
      ? "p.grand_total"
      : pCols.has("total_amount")
      ? "p.total_amount"
      : "0";
    const paidExpr = pCols.has("amount_paid")
      ? "p.amount_paid"
      : hasPMeta
      ? "COALESCE((p.meta->>'amount_paid')::numeric, 0)"
      : "0";
    const pendingExpr = pCols.has("pending_amount")
      ? "p.pending_amount"
      : `GREATEST(${totalExpr} - ${paidExpr}, 0)`;
    const billDateExpr = pCols.has("bill_date")
      ? "p.bill_date"
      : "p.created_at";
    const vendorNameExpr = hasPMeta
      ? "COALESCE(sup.name, p.meta->>'vendor_name', 'Unknown')"
      : "COALESCE(sup.name, 'Unknown')";
    const statusFilter = hasPStatus ? "AND p.status <> 'draft'" : "";

    const debtRows = (
      await client.query(
        `
        SELECT ${vendorNameExpr} AS vendor_name,
               SUM(${pendingExpr}) AS pending,
               MAX(${billDateExpr}) AS last_tx
          FROM purchases p
          LEFT JOIN suppliers sup ON sup.id = p.supplier_id
         WHERE COALESCE(${pendingExpr}, 0) > 0
         ${statusFilter}
         GROUP BY 1
         ORDER BY pending DESC
         LIMIT 6
        `
      )
    ).rows as { vendor_name: string; pending: number; last_tx: string | null }[];

    const debtCountRes = await client.query(
      `
      SELECT COUNT(*)::int AS cnt
        FROM (
          SELECT 1
            FROM purchases p
           WHERE COALESCE(${pendingExpr}, 0) > 0
           ${statusFilter}
           GROUP BY COALESCE(CAST(p.supplier_id AS TEXT), 'unknown')
        ) x
      `
    );
    const debtCount = Number(debtCountRes.rows?.[0]?.cnt || 0);
    const debtTotal = debtRows.reduce((a, b) => a + Number(b.pending || 0), 0);

    return NextResponse.json({
      ok: true,
      near_expiry_days: nearDays,
      counts: {
        low_stock: Number(lowCountRes.rows?.[0]?.cnt || lowItems.length),
        near_expiry: near,
        expired: expired,
        debts: debtCount,
      },
      items: {
        low_stock: lowItems,
        expiry: expItems,
        debts: debtRows.map((d, i) => ({
          type: "debt",
          id: i + 1,
          vendor_name: d.vendor_name,
          pending: Number(d.pending || 0),
          last_tx: d.last_tx,
          href: `/accounting?focus=debts#debts`,
        })),
      },
      debts: { total_pending: debtTotal },
    });
  } catch (err: any) {
    console.error('GET /api/alerts error', err);
    return NextResponse.json({ ok: false, error: err?.message || String(err) }, { status: 500 });
  } finally {
    client.release();
  }
}
