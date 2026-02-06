// app/invoices/[id]/edit/page.tsx
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { notFound } from "next/navigation";
import { pool } from "@/lib/db";
import InvoiceEditForm from "./InvoiceEditForm";

type Sale = {
  id: number;
  invoice_no: string | null;
  customer_id: number | null;
  subtotal: number | null;
  tax_total: number | null;
  total: number | null;
  created_at: string | null;
  invoice_date: string | null;
  is_return: boolean;
  amount_paid: number;
  pending_amount?: number;
  payment_status?: string | null;
  payment_method?: string | null;
  notes: string | null;
  customer_name?: string | null;
  patient_name?: string | null;
  doctor_name?: string | null;
  dc_no?: string | null;
};

type Item = {
  id: number;
  product_id?: number | null;
  name: string | null;
  gst_slab: number | null;     // %
  qty: number | null;
  unit_price: number | null;
  discount_pct: number | null; // %
  batch_no?: string | null;
  exp_date?: string | null;
};

export default async function EditInvoicePage({ params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isFinite(id)) notFound();

  const saleRs = await pool.query(
    `SELECT s.id, s.invoice_no, s.customer_id, s.subtotal, s.tax_total, s.total,
            s.created_at, s.invoice_date,
            COALESCE((s.meta->>'is_return')::boolean, false) AS is_return,
            COALESCE(s.amount_paid, (s.meta->>'amount_paid')::numeric, 0)  AS amount_paid,
            COALESCE(s.pending_amount,
                     GREATEST(s.total - COALESCE(s.amount_paid, (s.meta->>'amount_paid')::numeric, 0), 0)) AS pending_amount,
            COALESCE(NULLIF(s.payment_status,''), (s.meta->>'payment_status')) AS payment_status,
            COALESCE(NULLIF(s.payment_method,''), (s.meta->>'payment_method')) AS payment_method,
            (s.meta->>'notes')                               AS notes,
            (s.meta->>'patient_name')                        AS patient_name,
            (s.meta->>'doctor_name')                         AS doctor_name,
            (s.meta->>'dc_no')                               AS dc_no,
            c.name AS customer_name
       FROM sales s
       LEFT JOIN customers c ON c.id = s.customer_id
      WHERE s.id=$1`,
    [id]
  );
  if (saleRs.rowCount === 0) notFound();
  const sale = saleRs.rows[0] as Sale;

  // ❌ remove: pool.query<Item>(...)  ->  ✅ use pool.query(...) and cast rows
  const itemsRs = await pool.query(
    `SELECT id, product_id, name, gst_slab, qty, unit_price, discount_pct,
            (meta->>'batch_no') AS batch_no,
            (meta->>'exp_date') AS exp_date
       FROM sale_items
      WHERE sale_id=$1
      ORDER BY id`,
    [id]
  );
  const items = itemsRs.rows as Item[];

  return (
    <div className="container">
      <div className="card p-4">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold">
              Edit Invoice #{sale.invoice_no ?? sale.id}
            </h1>
            <p className="text-sm text-gray-600">
              Customer: {sale.customer_name ?? "Walk-in"}
            </p>
          </div>
        </div>

        <InvoiceEditForm sale={sale} items={items} />
      </div>
    </div>
  );
}
