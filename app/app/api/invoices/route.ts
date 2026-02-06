// app/api/invoices/route.ts
import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PageParams = {
  page?: string;
  perPage?: string;
  q?: string;
  sort?: "date" | "invoice" | "customer" | "total";
  dir?: "asc" | "desc";
  from?: string;      // YYYY-MM-DD
  to?: string;        // YYYY-MM-DD
  customerId?: string;
};

async function getColumns(table: string): Promise<Set<string>> {
  const r = await pool.query(
    `SELECT LOWER(column_name) AS col
     FROM information_schema.columns
     WHERE table_schema='public' AND table_name=$1`,
    [table]
  );
  return new Set<string>(r.rows.map((x: any) => x.col));
}

// Use invoice_date with fallback to created_at
const DATE_EXPR = `COALESCE(s.invoice_date::timestamp, s.created_at)`;

function sortColumn(key: "date" | "invoice" | "customer" | "total") {
  switch (key) {
    case "invoice":  return `s.invoice_no`;
    case "customer": return `c.name`;
    case "total":    return `s.total`;
    case "date":
    default:         return DATE_EXPR;
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const sp = Object.fromEntries(url.searchParams.entries()) as PageParams;

  const page    = Math.max(1, Number(sp.page ?? 1));
  const perPage = Math.min(200, Math.max(1, Number(sp.perPage ?? 20)));
  const sort    = (sp.sort as PageParams["sort"]) ?? "date";
  const dir     = (sp.dir as PageParams["dir"]) ?? "desc";
  const q       = (sp.q ?? "").trim();
  const from    = (sp.from ?? "").trim();
  const to      = (sp.to ?? "").trim();
  const custId  = (sp.customerId ?? "").trim();

  const where: string[] = [];
  const params: any[] = [];
  let p = 1;

  if (q) {
    where.push(`(s.invoice_no ILIKE $${p} OR c.name ILIKE $${p})`);
    params.push(`%${q}%`);
    p++;
  }
  if (from) {
    where.push(`${DATE_EXPR} >= $${p}::timestamp`);
    params.push(`${from} 00:00:00`);
    p++;
  }
  if (to) {
    where.push(`${DATE_EXPR} < ($${p}::date + INTERVAL '1 day')`);
    params.push(to);
    p++;
  }
  if (custId) {
    where.push(`s.customer_id = $${p}::int`);
    params.push(Number(custId));
    p++;
  }

  const whereSQL = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const orderSQL = `ORDER BY ${sortColumn(sort!)} ${dir === "asc" ? "ASC" : "DESC"}, s.id ASC`;
  const offset   = (page - 1) * perPage;

  const salesCols = await getColumns("sales");
  const hasMeta = salesCols.has("meta");
  const totalExpr = salesCols.has("total")
    ? "s.total"
    : salesCols.has("grand_total")
    ? "s.grand_total"
    : "0";
  const paidExpr = salesCols.has("amount_paid")
    ? "s.amount_paid"
    : hasMeta
    ? "COALESCE((s.meta->>'amount_paid')::numeric, 0)"
    : "0";
  const pendingExpr = salesCols.has("pending_amount")
    ? "s.pending_amount"
    : `GREATEST(${totalExpr} - ${paidExpr}, 0)`;
  const statusExpr = salesCols.has("payment_status")
    ? "NULLIF(s.payment_status,'')"
    : hasMeta
    ? "(s.meta->>'payment_status')"
    : "NULL";

  // total count
  const { rows: countRows } = await pool.query(
    `
    SELECT COUNT(*)::int AS count
    FROM sales s
    LEFT JOIN customers c ON c.id = s.customer_id
    ${whereSQL}
    `,
    params
  );
  const total = countRows[0]?.count ?? 0;

  // page of items
  const { rows } = await pool.query(
    `
    SELECT
      s.id,
      s.invoice_no,
      ${DATE_EXPR} AS created_at,
      ${totalExpr} AS total,
      COALESCE(${pendingExpr}, 0) AS pending_amount,
      ${statusExpr} AS payment_status,
      c.name AS customer_name
    FROM sales s
    LEFT JOIN customers c ON c.id = s.customer_id
    ${whereSQL}
    ${orderSQL}
    LIMIT $${p} OFFSET $${p + 1}
    `,
    [...params, perPage, offset]
  );

  const items = rows.map((r: any) => ({
    id: r.id as number,
    invoice_no: r.invoice_no as string,
    created_at: new Date(r.created_at).toISOString(),
    total: Number(r.total ?? 0),
    pending_amount: Number(r.pending_amount ?? 0),
    payment_status: r.payment_status ?? null,
    customer_name: r.customer_name ?? null,
  }));

  const totalPages = Math.max(1, Math.ceil(total / perPage));

  return NextResponse.json({ items, total, page, perPage, totalPages });
}
