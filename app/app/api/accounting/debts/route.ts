export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { guardApiActivated } from "@/lib/activation-guard";

type DebtRow = {
  vendor_key: string;
  vendor_name: string;
  supplier_id: number | null;
  bill_id: number | null;
  bill_no: string | null;
  bill_date: string | null;
  total: number;
  paid: number;
  pending: number;
};

async function getColumns(client: any, table: string): Promise<Set<string>> {
  const r = await client.query(
    `SELECT LOWER(column_name) AS col
     FROM information_schema.columns
     WHERE table_schema='public' AND table_name=$1`,
    [table]
  );
  return new Set<string>(r.rows.map((x: any) => x.col));
}

export async function GET(_req: NextRequest) {
  await guardApiActivated(true);

  const client = await pool.connect();
  try {
    const pCols = await getColumns(client, "purchases");
    const sCols = await getColumns(client, "sales");

    const totalExpr = pCols.has("grand_total")
      ? "p.grand_total"
      : pCols.has("total_amount")
      ? "p.total_amount"
      : "0";
    const paidExpr = pCols.has("amount_paid")
      ? "p.amount_paid"
      : "COALESCE((p.meta->>'amount_paid')::numeric, 0)";
    const pendingExpr = pCols.has("pending_amount")
      ? "p.pending_amount"
      : `GREATEST(${totalExpr} - ${paidExpr}, 0)`;
    const billDateExpr = pCols.has("invoice_date")
      ? "p.invoice_date"
      : pCols.has("bill_date")
      ? "p.bill_date"
      : "p.created_at";
    const billNoExpr = pCols.has("invoice_no")
      ? "p.invoice_no"
      : pCols.has("bill_no")
      ? "p.bill_no"
      : "NULL";

    const rows = (
      await client.query(
        `
        SELECT
          COALESCE(CAST(p.supplier_id AS TEXT), COALESCE(p.meta->>'vendor_name', 'unknown')) AS vendor_key,
          COALESCE(sup.name, p.meta->>'vendor_name', 'Unknown') AS vendor_name,
          p.supplier_id AS supplier_id,
          p.id AS bill_id,
          ${billNoExpr} AS bill_no,
          ${billDateExpr} AS bill_date,
          COALESCE(${totalExpr}, 0) AS total,
          COALESCE(${paidExpr}, 0) AS paid,
          COALESCE(${pendingExpr}, 0) AS pending
        FROM purchases p
        LEFT JOIN suppliers sup ON sup.id = p.supplier_id
        ORDER BY ${billDateExpr} DESC NULLS LAST
        `
      )
    ).rows as DebtRow[];

    // Aggregate per vendor
    const map = new Map<string, any>();
    const aging = { bucket_0_30: 0, bucket_31_60: 0, bucket_60_plus: 0 };
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const r of rows) {
      const key = r.vendor_key || r.vendor_name;
      if (!map.has(key)) {
        map.set(key, {
          vendor_key: key,
          vendor_name: r.vendor_name,
          supplier_id: r.supplier_id ?? null,
          outstanding: 0,
          total_billed: 0,
          last_tx: r.bill_date,
          status: "Pending",
          recent: [] as any[],
        });
      }
      const v = map.get(key);
      v.outstanding += Number(r.pending || 0);
      v.total_billed += Number(r.total || 0);
      if (!v.last_tx || (r.bill_date && new Date(r.bill_date) > new Date(v.last_tx))) {
        v.last_tx = r.bill_date;
      }
      if (r.bill_id != null) {
        v.recent.push({
          id: r.bill_id,
          bill_no: r.bill_no,
          bill_date: r.bill_date,
          total: Number(r.total || 0),
          paid: Number(r.paid || 0),
          pending: Number(r.pending || 0),
        });
      }

      // Aging buckets (for pending only)
      if (Number(r.pending) > 0 && r.bill_date) {
        const d = new Date(r.bill_date);
        d.setHours(0, 0, 0, 0);
        const days = Math.floor((today.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
        if (days <= 30) aging.bucket_0_30 += Number(r.pending);
        else if (days <= 60) aging.bucket_31_60 += Number(r.pending);
        else aging.bucket_60_plus += Number(r.pending);
      }
    }

    const vendors = Array.from(map.values()).map((v) => {
      v.recent.sort((a: any, b: any) => {
        const da = a.bill_date ? new Date(a.bill_date).getTime() : 0;
        const db = b.bill_date ? new Date(b.bill_date).getTime() : 0;
        return db - da;
      });
      v.recent = v.recent.slice(0, 3);
      v.status = v.outstanding > 0 ? "Open" : "Settled";
      return v;
    });

    vendors.sort((a, b) => b.outstanding - a.outstanding);

    // Receivables (sales pending)
    const salesTotalExpr = sCols.has("total") ? "s.total" : "0";
    const salesPaidExpr = sCols.has("amount_paid")
      ? "s.amount_paid"
      : "COALESCE((s.meta->>'amount_paid')::numeric, 0)";
    const salesPendingExpr = sCols.has("pending_amount")
      ? "s.pending_amount"
      : `GREATEST(${salesTotalExpr} - ${salesPaidExpr}, 0)`;
    const receivablesRes = await client.query(
      `SELECT COALESCE(SUM(${salesPendingExpr}),0) AS receivables FROM sales s`
    );
    const receivables = Number(receivablesRes.rows?.[0]?.receivables || 0);

    const payables = vendors.reduce((acc, v) => acc + Number(v.outstanding || 0), 0);
    const net = receivables - payables;

    return NextResponse.json({
      ok: true,
      summary: {
        receivables,
        payables,
        net,
      },
      aging,
      vendors,
    });
  } catch (err: any) {
    console.error("GET /api/accounting/debts", err);
    return NextResponse.json({ ok: false, error: err?.message || String(err) }, { status: 500 });
  } finally {
    client.release();
  }
}

