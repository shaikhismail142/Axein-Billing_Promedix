// app/api/invoices/export/route.ts
import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(req: Request) {
  const url   = new URL(req.url);
  const q     = url.searchParams.get("q")?.trim();
  const from  = url.searchParams.get("from")?.trim();
  const to    = url.searchParams.get("to")?.trim();
  const idsP  = url.searchParams.get("ids")?.trim();

  const where: string[] = [];
  const params: any[] = [];
  let p = 1;

  if (idsP) {
    const ids = idsP
      .split(",")
      .map((x) => Number(x.trim()))
      .filter((n) => Number.isFinite(n));
    if (!ids.length) {
      return NextResponse.json({ error: "No valid ids provided" }, { status: 400 });
    }
    where.push(`s.id = ANY($${p}::int[])`);
    params.push(ids);
    p++;
  } else {
    if (from) {
      where.push(`COALESCE(s.invoice_date::date, s.created_at::date) >= $${p}::date`);
      params.push(from);
      p++;
    }
    if (to) {
      where.push(`COALESCE(s.invoice_date::date, s.created_at::date) < ($${p}::date + INTERVAL '1 day')`);
      params.push(to);
      p++;
    }
    if (q) {
      where.push(`(s.invoice_no ILIKE $${p} OR c.name ILIKE $${p})`);
      params.push(`%${q}%`);
      p++;
    }
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const { rows } = await pool.query(
    `
    SELECT
      s.id,
      s.invoice_no,
      COALESCE(s.invoice_date::timestamp, s.created_at) AS invoice_ts,
      s.customer_id,
      c.name AS customer_name,
      s.subtotal,
      s.tax_total,
      s.total,
      (s.meta->>'amount_paid')::numeric AS amount_paid,
      (s.meta->>'notes') AS notes
    FROM sales s
    LEFT JOIN customers c ON c.id = s.customer_id
    ${whereSql}
    ORDER BY COALESCE(s.invoice_date::timestamp, s.created_at) ASC, s.id ASC
    `,
    params
  );

  const lines: string[] = [];
  lines.push([
    "id",
    "invoice_no",
    "invoice_date",
    "customer_id",
    "customer_name",
    "subtotal",
    "tax_total",
    "total",
    "amount_paid",
    "notes",
  ].join(","));

  for (const r of rows) {
    lines.push([
      csvEscape(r.id),
      csvEscape(r.invoice_no ?? r.id),
      csvEscape(new Date(r.invoice_ts).toISOString()),
      csvEscape(r.customer_id ?? ""),
      csvEscape(r.customer_name ?? ""),
      csvEscape(r.subtotal ?? ""),
      csvEscape(r.tax_total ?? ""),
      csvEscape(r.total ?? ""),
      csvEscape(r.amount_paid ?? ""),
      csvEscape(r.notes ?? ""),
    ].join(","));
  }

  const csv = "\uFEFF" + lines.join("\n"); // BOM helps Excel
  const name =
    from && to ? `invoices_${from}_${to}.csv`
    : idsP ? "invoices_selected.csv"
    : "invoices_export.csv";

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
