// app/quotations/[id]/page.tsx
import Link from "next/link";
import PrintButton from "../_components/PrintButton";
import ConvertToSaleButton from "../_components/ConvertToSaleButton";
import { notFound } from "next/navigation";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;

type Item = {
  id: number;
  product_id: number | null;
  description: string;
  qty: number;
  price: number;
  tax: number;       // %
  discount: number;  // % or absolute (>100)
  category?: string | null;
  hsn_code?: string | null;
  batch_no?: string | null;
  exp_date?: string | null;
};

type Quotation = {
  id: number;
  quotation_number: string | null;
  quotation_date: string | null;
  valid_until?: string | null;
  customer_id?: number | null;
  customer_name?: string | null;
  meta?: any;
};

const toNum = (v: any, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const fmtDate = (v?: string | null) => (v ? new Date(v).toLocaleDateString("en-IN") : "");
const fmtINR = (n: number) => {
  const parts = n.toFixed(2).split(".");
  let x = parts[0];
  const last3 = x.slice(-3);
  const other = x.slice(0, -3);
  if (other) x = other.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + last3;
  return `INR (Rs/-) ${x}.${parts[1]}`;
};

export default async function Page({ params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isFinite(id)) notFound();

  // Load quotation + customer name; DO NOT select c.meta (customers.meta doesn't exist)
  const qRs = await pool.query(
    `select q.*,
            c.name  as customer_name
       from quotations q
       left join customers c on c.id = q.customer_id
      where q.id = $1
      limit 1`,
    [id]
  );
  if (qRs.rowCount === 0) {
    return (
      <div className="container">
        <div className="glass p-5">
          <h1 className="text-xl font-bold">Quotation</h1>
          <p className="mt-3">No data found.</p>
          <Link className="mt-4 inline-block glass-btn" href="/quotations">← Back to Quotations</Link>
        </div>
      </div>
    );
  }
  const quotation = qRs.rows[0] as Quotation;

  // Try to pull optional customer metadata from quotation.meta
  const customerMeta =
    (quotation.meta?.customer_meta as any) ??
    (quotation.meta?.customer as any) ??
    null;

  const itemsRs = await pool.query(
    `select qi.id, qi.product_id, qi.description, qi.qty, qi.price, qi.tax, qi.discount,
            qi.batch_no, qi.exp_date,
            COALESCE(p.category, p.meta->>'category') AS category,
            COALESCE(p.hsn_code, p.hsn, p.meta->>'hsn_code') AS hsn_code
       from quotation_items qi
       left join products p on p.id = qi.product_id
      where qi.quotation_id = $1
      order by qi.id asc`,
    [id]
  );
  const items = itemsRs.rows as Item[];

  // compute totals (same logic as before)
  let subtotal = 0, discountTotal = 0, taxTotal = 0, grand = 0;
  const rows = items.map((it) => {
    const qty = toNum(it.qty);
    const unit = toNum(it.price);
    const sub = qty * unit;

    const discRaw = Math.max(0, toNum(it.discount));
    const discAbs = discRaw > 0 ? (discRaw <= 100 ? sub * (discRaw / 100) : discRaw) : 0;

    const afterDisc = Math.max(0, sub - discAbs);
    const taxPct = Math.max(0, toNum(it.tax));
    const taxAmt = afterDisc * (taxPct / 100);
    const lineTotal = afterDisc + taxAmt;

    subtotal += sub;
    discountTotal += discAbs;
    taxTotal += taxAmt;
    grand += lineTotal;

    return {
      description: it.description ?? "",
      qty,
      unit,
      discPct: sub > 0 ? (discRaw <= 100 ? discRaw : (discAbs / sub) * 100) : 0,
      taxPct,
      lineTotal,
      category: it.category ?? "",
      hsn_code: it.hsn_code ?? "",
      batch_no: it.batch_no ?? "",
      exp_date: it.exp_date ?? "",
    };
  });

  const rounded = Number(grand.toFixed(2));
  const roundoff = Number((rounded - grand).toFixed(2));
  const final = Number((grand + roundoff).toFixed(2));

  return (
    <div className="container">
      {/* Action Bar */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">
            Quotation {quotation.quotation_number ?? `#${quotation.id}`}
          </h1>
          <p className="muted text-sm">
            Date: {fmtDate(quotation.quotation_date)}
            {quotation.valid_until ? ` · Valid Until: ${fmtDate(quotation.valid_until)}` : ""}
          </p>
          {quotation.customer_name && (
            <p className="mt-1 text-sm">
              <span className="font-medium">Bill To: </span>
              {quotation.customer_name}
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-2 no-print">
          <Link
            href={`/api/quotations/${quotation.id}/pdf`}
            className="btn-primary text-sm px-3 py-2 rounded-2xl"
          >
            View PDF
          </Link>
          <PrintButton href={`/api/quotations/${quotation.id}/pdf`} />

          {/* Smart convert button that handles "Already converted (sale_id X)" */}
          <ConvertToSaleButton quotationId={Number(quotation.id)} />

          <Link href="/quotations" className="glass-btn text-sm">← Back</Link>
        </div>
      </div>

      {/* Printable area */}
      <div className="print-area space-y-4">
        {/* Customer & Meta Card */}
        <div className="card p-4">
          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <div className="font-semibold mb-1">Customer</div>
              <div>{quotation.customer_name ?? "-"}</div>
              {customerMeta?.address && (
                <div className="mt-1 whitespace-pre-wrap">{customerMeta.address}</div>
              )}
              <div className="mt-1 text-sm muted">
                {(customerMeta?.phone && `Phone: ${customerMeta.phone}`) || ""}
                {(customerMeta?.gstin && `  ·  GSTIN: ${customerMeta.gstin}`) || ""}
              </div>
            </div>
            <div>
              <div className="font-semibold mb-1">Details</div>
              <div>Quotation #: {quotation.quotation_number ?? `#${quotation.id}`}</div>
              <div>Date: {fmtDate(quotation.quotation_date)}</div>
              {quotation.valid_until && <div>Valid Until: {fmtDate(quotation.valid_until)}</div>}
            </div>
          </div>
        </div>

        {/* Items Table */}
        <div className="card overflow-hidden">
          <table className="table text-sm">
            <thead>
              <tr className="text-left">
                <th>Item / Description</th>
                <th className="w-28">Category</th>
                <th className="w-28">HSN</th>
                <th className="w-28">Lot</th>
                <th className="w-28">Expiry</th>
                <th className="w-24">Qty</th>
                <th className="w-40">Price</th>
                <th className="w-28">Disc %</th>
                <th className="w-28">GST %</th>
                <th className="w-44">Line Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>{r.description}</td>
                  <td>{r.category || "—"}</td>
                  <td>{r.hsn_code || "—"}</td>
                  <td>{r.batch_no || "—"}</td>
                  <td>{r.exp_date ? fmtDate(r.exp_date) : "—"}</td>
                  <td>{r.qty}</td>
                  <td>{fmtINR(r.unit)}</td>
                  <td>{r.discPct.toFixed(2)}</td>
                  <td>{r.taxPct.toFixed(2)}</td>
                  <td>{fmtINR(r.lineTotal)}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={10} className="text-center py-6 muted">
                    No items added to this quotation.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Totals */}
        <div className="flex flex-col items-end gap-1">
          <div className="text-sm"><span className="font-medium">Subtotal:</span> {fmtINR(subtotal)}</div>
          <div className="text-sm"><span className="font-medium">Discount:</span> {fmtINR(discountTotal)}</div>
          <div className="text-sm"><span className="font-medium">Tax Total:</span> {fmtINR(taxTotal)}</div>
          <div className="text-sm"><span className="font-medium">Round Off:</span> {fmtINR(roundoff)}</div>
          <div className="text-base mt-1"><span className="font-semibold">Grand Total:</span> {fmtINR(final)}</div>
        </div>

        {/* Notes / Terms */}
        {quotation.meta?.notes && (
          <div className="card p-4">
            <div className="font-semibold mb-1">Notes</div>
            <div className="whitespace-pre-wrap">{String(quotation.meta.notes)}</div>
          </div>
        )}
        {quotation.meta?.terms && (
          <div className="card p-4">
            <div className="font-semibold mb-1">Terms</div>
            <div className="whitespace-pre-wrap">{String(quotation.meta.terms)}</div>
          </div>
        )}
      </div>
    </div>
  );
}
