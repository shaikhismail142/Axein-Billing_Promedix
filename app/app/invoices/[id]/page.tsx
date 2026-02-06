// app/invoices/[id]/page.tsx
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import Link from "next/link";
import { notFound } from "next/navigation";
import { pool } from "@/lib/db";

type Sale = {
  id: number;
  invoice_no: string | null;
  invoice_date: string | null;
  subtotal: number | null;
  tax_total: number | null;
  total: number | null;
  amount_paid: number;
  pending_amount: number;
  payment_status?: string | null;
  payment_method?: string | null;
  customer_name: string | null;
  patient_name?: string | null;
  doctor_name?: string | null;
  dc_no?: string | null;
};

type SaleItem = {
  id: number;
  name: string | null;
  qty: number | null;
  unit_price: number | null;
  discount_pct: number | null; // %
  gst_slab: number | null;     // %
  taxable: number | null;
  tax: number | null;
  total: number | null;
  category?: string | null;
  hsn_code?: string | null;
  batch_no?: string | null;
  exp_date?: string | null;
};

const inr = (n: number) => {
  const parts = n.toFixed(2).split(".");
  let x = parts[0];
  const last3 = x.slice(-3);
  const other = x.slice(0, -3);
  if (other) x = other.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + last3;
  return `INR (Rs/-) ${x}.${parts[1]}`;
};
const toNum = (v: any, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

export default async function InvoicePage({ params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isFinite(id)) notFound();

  // Header
  const saleRs = await pool.query(
    `SELECT s.id, s.invoice_no, s.invoice_date, s.subtotal, s.tax_total, s.total,
            COALESCE(s.amount_paid, (s.meta->>'amount_paid')::numeric, 0) AS amount_paid,
            COALESCE(s.pending_amount,
                     GREATEST(s.total - COALESCE(s.amount_paid, (s.meta->>'amount_paid')::numeric, 0), 0)) AS pending_amount,
            COALESCE(NULLIF(s.payment_status,''), (s.meta->>'payment_status')) AS payment_status,
            COALESCE(NULLIF(s.payment_method,''), (s.meta->>'payment_method')) AS payment_method,
            (s.meta->>'patient_name') AS patient_name,
            (s.meta->>'doctor_name')  AS doctor_name,
            (s.meta->>'dc_no')        AS dc_no,
            c.name AS customer_name
       FROM sales s
       LEFT JOIN customers c ON c.id = s.customer_id
      WHERE s.id=$1`,
    [id]
  );
  if (saleRs.rowCount === 0) notFound();
  const s = saleRs.rows[0] as Sale;

  // Items
  const itemsRs = await pool.query(
    `SELECT si.id, si.name, si.qty, si.unit_price, si.discount_pct, si.gst_slab, si.taxable, si.tax, si.total,
            COALESCE(p.category, p.meta->>'category') AS category,
            COALESCE(p.hsn_code, p.hsn, p.meta->>'hsn_code') AS hsn_code,
            (si.meta->>'batch_no') AS batch_no,
            (si.meta->>'exp_date') AS exp_date
       FROM sale_items si
       LEFT JOIN products p
         ON p.id = si.product_id
         OR (si.product_id IS NULL AND LOWER(p.name) = LOWER(si.name))
      WHERE si.sale_id=$1
      ORDER BY si.id`,
    [id]
  );
  const items = itemsRs.rows as SaleItem[];

  // Derived totals
  const subtotal = toNum(s.subtotal, 0);
  const taxTotal = toNum(s.tax_total, 0);
  const grand = toNum(s.total, 0);
  const amountPaid = toNum(s.amount_paid, 0);
  const balance = toNum(s.pending_amount ?? Math.max(0, grand - amountPaid), 0);
  const paymentStatus = s.payment_status || (amountPaid >= grand - 0.01 ? "Paid" : amountPaid > 0 ? "Partial" : "Pending");

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Invoice {s.invoice_no ?? s.id}</h1>
          <p className="text-sm text-gray-600">Customer: {s.customer_name ?? "-"}</p>
          {(s.patient_name || s.doctor_name || s.dc_no) && (
            <div className="text-sm text-gray-600 space-y-0.5">
              {s.patient_name && <div>Patient: {s.patient_name}</div>}
              {s.doctor_name && <div>Doctor: {s.doctor_name}</div>}
              {s.dc_no && <div>DC No: {s.dc_no}</div>}
            </div>
          )}
          <p className="text-sm text-gray-600">
            Date: {new Date(s.invoice_date ?? Date.now()).toLocaleString("en-IN", {
              timeZone: "Asia/Kolkata",
              hour12: true,
            })}
          </p>
        </div>

        <div className="flex gap-2">
          <Link
            href={`/api/invoices/${id}/pdf`}
            className="rounded-lg border px-4 py-2 text-sm"
            target="_blank"
            rel="noopener"
          >
            Print / PDF
          </Link>
          <Link
            href={`/invoices/${id}/edit`}
            className="rounded-lg border px-4 py-2 text-sm hover:bg-gray-50"
          >
            Edit
          </Link>
          <Link href="/invoices" className="rounded-lg border px-4 py-2 text-sm">
            ← Back
          </Link>
        </div>
      </div>

      {/* Items */}
      <div className="rounded-xl border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-700 dark:bg-slate-100 dark:text-slate-900">
            <tr>
              <th className="text-left px-3 py-2">Description</th>
              <th className="text-left px-3 py-2">Category</th>
              <th className="text-left px-3 py-2">HSN</th>
              <th className="text-left px-3 py-2">Lot</th>
              <th className="text-left px-3 py-2">Expiry</th>
              <th className="text-right px-3 py-2">Qty</th>
              <th className="text-right px-3 py-2">Price</th>
              <th className="text-right px-3 py-2">Tax %</th>
              <th className="text-right px-3 py-2">Discount</th>
              <th className="text-right px-3 py-2">Line Total</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => {
              const qty = toNum(it.qty, 0);
              const price = toNum(it.unit_price, 0);
              const gross = qty * price;
              const discPct = Math.max(0, toNum(it.discount_pct, 0));
              const discAbs = gross * (discPct / 100);
              const gstPct = Math.max(0, toNum(it.gst_slab, 0));
              const lineTotal = toNum(it.total ?? 0, 0); // stored in DB by convert/save
              return (
                <tr key={it.id} className="border-t">
                  <td className="px-3 py-2">{it.name ?? ""}</td>
                  <td className="px-3 py-2">{it.category ?? "-"}</td>
                  <td className="px-3 py-2">{it.hsn_code ?? "-"}</td>
                  <td className="px-3 py-2">{it.batch_no ?? "-"}</td>
                  <td className="px-3 py-2">
                    {it.exp_date ? new Date(it.exp_date).toLocaleDateString("en-IN") : "-"}
                  </td>
                  <td className="px-3 py-2 text-right">{qty.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right">{inr(price)}</td>
                  <td className="px-3 py-2 text-right">{gstPct.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right">
                    {discAbs > 0 ? inr(discAbs) : "-"}
                  </td>
                  <td className="px-3 py-2 text-right">{inr(lineTotal)}</td>
                </tr>
              );
            })}
            {items.length === 0 && (
              <tr>
                <td colSpan={10} className="px-3 py-6 text-center text-gray-500">
                  No items on this invoice.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Totals */}
      <div className="flex flex-col items-end gap-1">
        <div className="text-sm">
          <span className="font-medium">Subtotal:</span> {inr(subtotal)}
        </div>
        <div className="text-sm">
          <span className="font-medium">Tax:</span> {inr(taxTotal)}
        </div>
        <div className="border-t mt-1 pt-2 w-full max-w-sm"></div>
        <div className="text-base">
          <span className="font-semibold">Grand Total:</span> {inr(grand)}
        </div>
        <div className="text-sm">
          <span className="font-medium">Amount Paid:</span> {inr(amountPaid)}
        </div>
        <div className="text-sm">
          <span className="font-medium">Pending:</span> {inr(balance)}
        </div>
        <div className="text-sm">
          <span className="font-medium">Payment Status:</span> {paymentStatus}
          {s.payment_method ? ` • ${s.payment_method}` : ""}
        </div>
      </div>
    </div>
  );
}
