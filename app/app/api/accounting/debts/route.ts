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

type CustomerDebtRow = {
  customer_key: string;
  customer_name: string;
  customer_id: number | null;
  invoice_id: number | null;
  invoice_no: string | null;
  invoice_date: string | null;
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
    const vendorKeyExpr = hasPMeta
      ? "COALESCE(CAST(p.supplier_id AS TEXT), COALESCE(p.meta->>'vendor_name', 'unknown'))"
      : "COALESCE(CAST(p.supplier_id AS TEXT), 'unknown')";
    const vendorNameExpr = hasPMeta
      ? "COALESCE(sup.name, p.meta->>'vendor_name', 'Unknown')"
      : "COALESCE(sup.name, 'Unknown')";
    const statusFilter = hasPStatus ? "AND p.status <> 'draft'" : "";

    const rows = (
      await client.query(
        `
        SELECT
          ${vendorKeyExpr} AS vendor_key,
          ${vendorNameExpr} AS vendor_name,
          p.supplier_id AS supplier_id,
          p.id AS bill_id,
          ${billNoExpr} AS bill_no,
          ${billDateExpr} AS bill_date,
          COALESCE(${totalExpr}, 0) AS total,
          COALESCE(${paidExpr}, 0) AS paid,
          COALESCE(${pendingExpr}, 0) AS pending
        FROM purchases p
        LEFT JOIN suppliers sup ON sup.id = p.supplier_id
        WHERE COALESCE(${pendingExpr}, 0) > 0
        ${statusFilter}
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
    const hasSMeta = sCols.has("meta");
    const salesTotalExpr = sCols.has("total")
      ? "s.total"
      : sCols.has("grand_total")
      ? "s.grand_total"
      : "0";
    const salesPaidExpr = sCols.has("amount_paid")
      ? "s.amount_paid"
      : hasSMeta
      ? "COALESCE((s.meta->>'amount_paid')::numeric, 0)"
      : "0";
    const salesPendingExpr = sCols.has("pending_amount")
      ? "s.pending_amount"
      : `GREATEST(${salesTotalExpr} - ${salesPaidExpr}, 0)`;
    const receivablesRes = await client.query(
      `SELECT COALESCE(SUM(${salesPendingExpr}),0) AS receivables FROM sales s`
    );
    const receivables = Number(receivablesRes.rows?.[0]?.receivables || 0);

    const payables = vendors.reduce((acc, v) => acc + Number(v.outstanding || 0), 0);
    const net = receivables - payables;

    // Customer debts (receivables)
    const custKeyExpr = hasSMeta
      ? "COALESCE(CAST(s.customer_id AS TEXT), COALESCE(s.meta->>'customer_name', 'unknown'))"
      : "COALESCE(CAST(s.customer_id AS TEXT), 'unknown')";
    const custNameExpr = hasSMeta
      ? "COALESCE(c.name, s.meta->>'customer_name', 'Unknown')"
      : "COALESCE(c.name, 'Unknown')";
    const invNoExpr = sCols.has("invoice_no") ? "s.invoice_no" : "NULL";
    const invDateExpr = sCols.has("invoice_date") ? "s.invoice_date" : "s.created_at";

    const custRows = (
      await client.query(
        `
        SELECT
          ${custKeyExpr} AS customer_key,
          ${custNameExpr} AS customer_name,
          s.customer_id AS customer_id,
          s.id AS invoice_id,
          ${invNoExpr} AS invoice_no,
          ${invDateExpr} AS invoice_date,
          COALESCE(${salesTotalExpr}, 0) AS total,
          COALESCE(${salesPaidExpr}, 0) AS paid,
          COALESCE(${salesPendingExpr}, 0) AS pending
        FROM sales s
        LEFT JOIN customers c ON c.id = s.customer_id
        WHERE COALESCE(${salesPendingExpr}, 0) > 0
        ORDER BY ${invDateExpr} DESC NULLS LAST
        `
      )
    ).rows as CustomerDebtRow[];

    const cMap = new Map<string, any>();
    const cAging = { bucket_0_30: 0, bucket_31_60: 0, bucket_60_plus: 0 };

    for (const r of custRows) {
      const key = r.customer_key || r.customer_name;
      if (!cMap.has(key)) {
        cMap.set(key, {
          customer_key: key,
          customer_name: r.customer_name,
          customer_id: r.customer_id ?? null,
          outstanding: 0,
          total_billed: 0,
          last_tx: r.invoice_date,
          status: "Pending",
          recent: [] as any[],
        });
      }
      const v = cMap.get(key);
      v.outstanding += Number(r.pending || 0);
      v.total_billed += Number(r.total || 0);
      if (!v.last_tx || (r.invoice_date && new Date(r.invoice_date) > new Date(v.last_tx))) {
        v.last_tx = r.invoice_date;
      }
      if (r.invoice_id != null) {
        v.recent.push({
          id: r.invoice_id,
          invoice_no: r.invoice_no,
          invoice_date: r.invoice_date,
          total: Number(r.total || 0),
          paid: Number(r.paid || 0),
          pending: Number(r.pending || 0),
        });
      }

      if (Number(r.pending) > 0 && r.invoice_date) {
        const d = new Date(r.invoice_date);
        d.setHours(0, 0, 0, 0);
        const days = Math.floor((today.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
        if (days <= 30) cAging.bucket_0_30 += Number(r.pending);
        else if (days <= 60) cAging.bucket_31_60 += Number(r.pending);
        else cAging.bucket_60_plus += Number(r.pending);
      }
    }

    const customers = Array.from(cMap.values()).map((v) => {
      v.recent.sort((a: any, b: any) => {
        const da = a.invoice_date ? new Date(a.invoice_date).getTime() : 0;
        const db = b.invoice_date ? new Date(b.invoice_date).getTime() : 0;
        return db - da;
      });
      v.recent = v.recent.slice(0, 3);
      v.status = v.outstanding > 0 ? "Open" : "Settled";
      return v;
    });

    customers.sort((a, b) => b.outstanding - a.outstanding);

    return NextResponse.json({
      ok: true,
      summary: {
        receivables,
        payables,
        net,
      },
      aging,
      vendors,
      customer_aging: cAging,
      customers,
    });
  } catch (err: any) {
    console.error("GET /api/accounting/debts", err);
    return NextResponse.json({ ok: false, error: err?.message || String(err) }, { status: 500 });
  } finally {
    client.release();
  }
}
