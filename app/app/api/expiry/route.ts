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

    const sql = `
      WITH base AS (
        SELECT 
          b.id AS batch_id,
          b.product_id,
          COALESCE(p.name, p.meta->>'name') AS product_name,
          b.batch_no,
          b.mfg_date::date AS mfg_date,
          b.expiry_date::date AS expiry_date,
          b.qty::numeric AS qty,
          (b.expiry_date::date - CURRENT_DATE) AS days_until
        FROM product_batches b
        LEFT JOIN products p ON p.id = b.product_id
        WHERE b.expiry_date IS NOT NULL
      )
      SELECT * FROM base ORDER BY expiry_date ASC NULLS LAST;
    `;

    const { rows } = await client.query(sql);

    const near_expiry: any[] = [];
    const expired: any[] = [];
    for (const r of rows) {
      const days = Number(r.days_until);
      const row = {
        batch_id: r.batch_id,
        product_id: r.product_id,
        product_name: r.product_name || `#${r.product_id}`,
        batch_no: r.batch_no,
        mfg_date: r.mfg_date,
        expiry_date: r.expiry_date,
        qty: Number(r.qty),
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
