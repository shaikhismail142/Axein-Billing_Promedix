// app/api/alerts/route.ts
// AxEin Billing — Alerts API
// Returns counts for low-stock, near-expiry, expired, plus a few top items for the bell dropdown

export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { guardApiActivated } from "@/lib/activation-guard";

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

    // 2) Low stock (products.meta)
    const lowStockSql = `
      SELECT id, name, (meta->>'sku') AS sku,
             COALESCE((meta->>'stock_qty')::numeric, 0) AS stock_qty,
             COALESCE((meta->>'low_stock_threshold')::numeric, 0) AS low_stock_threshold
      FROM products
      WHERE COALESCE((meta->>'stock_qty')::numeric, 0) <= COALESCE((meta->>'low_stock_threshold')::numeric, 0)
      ORDER BY COALESCE((meta->>'stock_qty')::numeric, 0) ASC
      LIMIT 10;
    `;

    // 3) Expiry (product_batches)
    const expirySql = `
      WITH base AS (
        SELECT b.id AS batch_id, b.product_id, COALESCE(p.name, p.meta->>'name') AS product_name,
               b.batch_no, b.expiry_date::date AS expiry_date,
               (b.expiry_date::date - CURRENT_DATE) AS days_until,
               b.qty::numeric AS qty
        FROM product_batches b
        LEFT JOIN products p ON p.id = b.product_id
        WHERE b.expiry_date IS NOT NULL
      )
      SELECT * FROM base ORDER BY expiry_date ASC NULLS LAST;
    `;

    const [lowRes, expRes] = await Promise.all([
      client.query(lowStockSql),
      client.query(expirySql),
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

    return NextResponse.json({
      ok: true,
      near_expiry_days: nearDays,
      counts: {
        low_stock: lowItems.length, // we only fetched top 10 but count here = top list length; adjust if you want full COUNT
        near_expiry: near,
        expired: expired,
      },
      items: {
        low_stock: lowItems,
        expiry: expItems,
      },
    });
  } catch (err: any) {
    console.error('GET /api/alerts error', err);
    return NextResponse.json({ ok: false, error: err?.message || String(err) }, { status: 500 });
  } finally {
    client.release();
  }
}
