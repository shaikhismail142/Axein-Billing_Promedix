import { pool } from "@/lib/db";

export type TaxMonth = {
  period: string; // YYYY-MM or YYYY-Qn
  label: string; // e.g., Feb 2026 or Q1 2026
  input_tax: number;
  output_tax: number;
  net_tax: number;
};

export type TaxSummary = {
  input_tax: number;
  output_tax: number;
  net_tax: number;
  status: "Payable" | "Credit";
};

const columnCache = new Map<string, Set<string>>();

async function getColumns(table: string): Promise<Set<string>> {
  const cached = columnCache.get(table);
  if (cached) return cached;
  const r = await pool.query(
    `SELECT LOWER(column_name) AS col
     FROM information_schema.columns
     WHERE table_schema='public' AND table_name=$1`,
    [table]
  );
  const cols = new Set<string>(r.rows.map((x: any) => x.col));
  columnCache.set(table, cols);
  return cols;
}

function toDate(d: string, endOfDay = false): Date {
  const base = endOfDay ? `${d}T23:59:59.999` : `${d}T00:00:00.000`;
  const dt = new Date(base);
  return Number.isNaN(dt.getTime()) ? new Date() : dt;
}

export function normalizeRange(from?: string | null, to?: string | null): { from: string; to: string } {
  const today = new Date();
  const toISO = today.toISOString().slice(0, 10);
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - 30);
  const fromISO = fromDate.toISOString().slice(0, 10);

  const f = (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) ? from : fromISO;
  const t = (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) ? to : toISO;
  return { from: f, to: t };
}

export async function getTaxReport(
  fromRaw?: string | null,
  toRaw?: string | null,
  opts?: { group?: "month" | "quarter"; includeDraft?: boolean }
) {
  const { from, to } = normalizeRange(fromRaw, toRaw);
  const fromDate = toDate(from, false);
  const toDateVal = toDate(to, true);
  const group: "month" | "quarter" = opts?.group === "quarter" ? "quarter" : "month";
  const includeDraft = opts?.includeDraft === true;

  const salesCols = await getColumns("sales");
  const purchaseCols = await getColumns("purchases");
  const hasSalesMeta = salesCols.has("meta");
  const hasSalesInvoiceDate = salesCols.has("invoice_date");
  const hasSalesCreated = salesCols.has("created_at");
  const hasPurchStatus = purchaseCols.has("status");
  const hasPurchBill = purchaseCols.has("bill_date");
  const hasPurchCreated = purchaseCols.has("created_at");

  const salesGroupExpr = group === "quarter"
    ? `date_trunc('quarter', ${hasSalesInvoiceDate ? "COALESCE(invoice_date, created_at)" : hasSalesCreated ? "created_at" : "now()"})::date`
    : `date_trunc('month', ${hasSalesInvoiceDate ? "COALESCE(invoice_date, created_at)" : hasSalesCreated ? "created_at" : "now()"})::date`;

  const purchaseGroupExpr = group === "quarter"
    ? `date_trunc('quarter', ${hasPurchBill ? "COALESCE(bill_date, created_at)" : hasPurchCreated ? "created_at" : "now()"})::date`
    : `date_trunc('month', ${hasPurchBill ? "COALESCE(bill_date, created_at)" : hasPurchCreated ? "created_at" : "now()"})::date`;

  const salesDateExpr = hasSalesInvoiceDate
    ? "COALESCE(invoice_date, created_at)"
    : hasSalesCreated
    ? "created_at"
    : "now()";

  const purchaseDateExpr = hasPurchBill
    ? "COALESCE(bill_date, created_at)"
    : hasPurchCreated
    ? "created_at"
    : "now()";

  const salesSignExpr = hasSalesMeta
    ? "CASE WHEN COALESCE((meta->>'is_return')::boolean, false) THEN -1 ELSE 1 END"
    : "1";

  const salesRows = await pool.query(
    `SELECT ${salesGroupExpr} AS period,
            SUM((${salesSignExpr}) * COALESCE(tax_total, 0)) AS output_tax
       FROM sales
      WHERE ${salesDateExpr} >= $1
        AND ${salesDateExpr} <= $2
      GROUP BY 1
      ORDER BY 1`,
    [fromDate, toDateVal]
  );

  const purchaseRows = await pool.query(
    `SELECT ${purchaseGroupExpr} AS period,
            SUM(${hasPurchStatus ? "CASE WHEN status='draft' AND $3::boolean = false THEN 0 ELSE COALESCE(tax_total, 0) END" : "COALESCE(tax_total, 0)"}) AS input_tax
       FROM purchases
      WHERE ${purchaseDateExpr} >= $1
        AND ${purchaseDateExpr} <= $2
      GROUP BY 1
      ORDER BY 1`,
    [fromDate, toDateVal, includeDraft]
  );

  const monthMap = new Map<string, TaxMonth>();
  const toLabel = (d: Date) => {
    if (group === "quarter") {
      const q = Math.floor(d.getUTCMonth() / 3) + 1;
      return `Q${q} ${d.getUTCFullYear()}`;
    }
    return d.toLocaleDateString("en-IN", { month: "short", year: "numeric" });
  };

  for (const r of salesRows.rows || []) {
    const d = new Date(r.period);
    const key = group === "quarter"
      ? `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`
      : d.toISOString().slice(0, 7);
    const prev = monthMap.get(key) || { period: key, label: toLabel(d), input_tax: 0, output_tax: 0, net_tax: 0 };
    prev.output_tax = Number(r.output_tax || 0);
    monthMap.set(key, prev);
  }

  for (const r of purchaseRows.rows || []) {
    const d = new Date(r.period);
    const key = group === "quarter"
      ? `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`
      : d.toISOString().slice(0, 7);
    const prev = monthMap.get(key) || { period: key, label: toLabel(d), input_tax: 0, output_tax: 0, net_tax: 0 };
    prev.input_tax = Number(r.input_tax || 0);
    monthMap.set(key, prev);
  }

  const months = Array.from(monthMap.values())
    .sort((a, b) => a.period.localeCompare(b.period))
    .map((m) => ({ ...m, net_tax: Number(m.output_tax || 0) - Number(m.input_tax || 0) }));

  const outputTotal = months.reduce((s, m) => s + Number(m.output_tax || 0), 0);
  const inputTotal = months.reduce((s, m) => s + Number(m.input_tax || 0), 0);
  const netTotal = outputTotal - inputTotal;

  const summary: TaxSummary = {
    input_tax: Number(inputTotal.toFixed(2)),
    output_tax: Number(outputTotal.toFixed(2)),
    net_tax: Number(netTotal.toFixed(2)),
    status: netTotal >= 0 ? "Payable" : "Credit",
  };

  return { from, to, summary, months, group, includeDraft };
}
