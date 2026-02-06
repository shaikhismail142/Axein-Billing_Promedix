import { pool } from "@/lib/db";

export type TaxMonth = {
  month: string; // YYYY-MM
  label: string; // e.g., Feb 2026
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

export async function getTaxReport(fromRaw?: string | null, toRaw?: string | null) {
  const { from, to } = normalizeRange(fromRaw, toRaw);
  const fromDate = toDate(from, false);
  const toDateVal = toDate(to, true);

  const salesRows = await pool.query(
    `SELECT date_trunc('month', COALESCE(invoice_date, created_at))::date AS month,
            SUM((CASE WHEN COALESCE((meta->>'is_return')::boolean, false) THEN -1 ELSE 1 END)
                * COALESCE(tax_total, 0)) AS output_tax
       FROM sales
      WHERE COALESCE(invoice_date, created_at) >= $1
        AND COALESCE(invoice_date, created_at) <= $2
      GROUP BY 1
      ORDER BY 1`,
    [fromDate, toDateVal]
  );

  const purchaseRows = await pool.query(
    `SELECT date_trunc('month', COALESCE(bill_date, created_at))::date AS month,
            SUM(CASE WHEN status='draft' THEN 0 ELSE COALESCE(tax_total, 0) END) AS input_tax
       FROM purchases
      WHERE COALESCE(bill_date, created_at) >= $1
        AND COALESCE(bill_date, created_at) <= $2
      GROUP BY 1
      ORDER BY 1`,
    [fromDate, toDateVal]
  );

  const monthMap = new Map<string, TaxMonth>();
  const toLabel = (d: Date) => d.toLocaleDateString("en-IN", { month: "short", year: "numeric" });

  for (const r of salesRows.rows || []) {
    const d = new Date(r.month);
    const key = d.toISOString().slice(0, 7);
    const prev = monthMap.get(key) || { month: key, label: toLabel(d), input_tax: 0, output_tax: 0, net_tax: 0 };
    prev.output_tax = Number(r.output_tax || 0);
    monthMap.set(key, prev);
  }

  for (const r of purchaseRows.rows || []) {
    const d = new Date(r.month);
    const key = d.toISOString().slice(0, 7);
    const prev = monthMap.get(key) || { month: key, label: toLabel(d), input_tax: 0, output_tax: 0, net_tax: 0 };
    prev.input_tax = Number(r.input_tax || 0);
    monthMap.set(key, prev);
  }

  const months = Array.from(monthMap.values())
    .sort((a, b) => a.month.localeCompare(b.month))
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

  return { from, to, summary, months };
}
