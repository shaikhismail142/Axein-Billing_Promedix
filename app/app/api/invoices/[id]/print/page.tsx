// app/invoices/[id]/print/page.tsx
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { pool } from "@/lib/db";

function inr(n: number | string | null | undefined) {
  const v = Number(n ?? 0);
  return `₹${v.toFixed(2)}`;
}

function fmtDateIST12h(dt: string | Date | null | undefined) {
  if (!dt) return "";
  const d = new Date(dt);
  return d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour12: true });
}

export default async function PrintInvoice({ params }: { params: { id: string } }) {
  const id = Number(params.id);

  const bizRs = await pool.query(`SELECT value_json FROM settings WHERE key='business'`);
  const biz = bizRs.rows?.[0]?.value_json || {};

  const saleRs = await pool.query(
    `SELECT s.id, s.invoice_no, s.customer_id, s.subtotal, s.tax_total, s.total,
            s.created_at, s.invoice_date,
            COALESCE((s.meta->>'is_return')::boolean, false)   AS is_return,
            COALESCE((s.meta->>'amount_paid')::numeric, 0)     AS amount_paid,
            (s.meta->>'notes')                                  AS notes,
            (s.meta->>'patient_name')                            AS patient_name,
            (s.meta->>'doctor_name')                             AS doctor_name,
            (s.meta->>'dc_no')                                   AS dc_no,
            c.name AS customer_name, c.phone AS customer_phone, c.gstin AS customer_gstin, c.address AS customer_address
       FROM sales s
       LEFT JOIN customers c ON c.id = s.customer_id
      WHERE s.id = $1`,
    [id]
  );
  if (saleRs.rowCount === 0) {
    return (
      <html>
        <head><title>Invoice not found</title></head>
        <body><div style={{ padding: 24 }}>Invoice not found.</div></body>
      </html>
    );
  }
  const s = saleRs.rows[0] as any;

  const items = (
    await pool.query(
      `SELECT si.id, si.name, si.gst_slab, si.qty, si.unit_price, si.discount_pct, si.taxable, si.tax, si.total,
              COALESCE(p.category, p.meta->>'category') AS category,
              COALESCE(p.hsn_code, p.hsn, p.meta->>'hsn_code') AS hsn_code,
              (si.meta->>'batch_no') AS batch_no,
              (si.meta->>'exp_date') AS exp_date
         FROM sale_items si
         LEFT JOIN products p
           ON p.id = si.product_id
           OR (si.product_id IS NULL AND LOWER(p.name) = LOWER(si.name))
        WHERE si.sale_id = $1
        ORDER BY si.id`,
      [id]
    )
  ).rows as any[];

  return (
    <html>
      <head>
        <meta charSet="utf-8" />
        <title>Invoice {s.invoice_no || id}</title>
        <style>{`
          body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; margin: 24px; color: #111827; }
          h1,h2,h3 { margin: 0; }
          .row { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
          .muted { color: #64748b; }
          table { width: 100%; border-collapse: collapse; margin-top: 12px; }
          th, td { border-top: 1px solid #e5e7eb; padding: 6px 8px; text-align: left; vertical-align: top; }
          .right { text-align: right; }
          .totals { margin-top: 12px; display: flex; justify-content: flex-end; }
          .box { border: 1px solid #e5e7eb; padding: 10px; min-width: 280px; }
          .noprint { margin-bottom: 12px; }
          @media print {
            .noprint { display: none; }
            body { margin: 0.5in; }
          }
          .badge { display:inline-block; padding:2px 8px; margin-left:6px; border-radius:9999px; font-size:12px; font-weight:700; border:1px solid transparent; }
          .badge-return { background:#FEF2F2; color:#B91C1C; border-color:#FCA5A5; }
          .badge-paid   { background:#ECFDF5; color:#065F46; border-color:#6EE7B7; }
          .badge-partial{ background:#FFF7ED; color:#92400E; border-color:#FDBA74; }
          .badge-pending{ background:#EFF6FF; color:#1D4ED8; border-color:#93C5FD; }
        `}</style>
      </head>
      <body>
        <div className="noprint">
          <a href={`/invoices/${id}`} style={{ border: "1px solid #e5e7eb", padding: "6px 10px", borderRadius: 6, marginRight: 6, textDecoration: "none" }}>Back</a>
          <button id="printBtn" style={{ border: "1px solid #e5e7eb", padding: "6px 10px", borderRadius: 6 }}>Print</button>
          <script
            dangerouslySetInnerHTML={{
              __html: `
                addEventListener('load', () => {
                  const b = document.getElementById('printBtn');
                  if (b) b.addEventListener('click', () => window.print());
                  setTimeout(() => window.print(), 120);
                });
              `,
            }}
          />
        </div>

        <div className="row">
          <div>
            <h2>{biz.name || "Your Shop Name"}</h2>
            {biz.address && <div className="muted">{biz.address}</div>}
            {biz.gstin && <div>GSTIN: {biz.gstin}</div>}
            {biz.phone && <div>Phone: {biz.phone}</div>}
          </div>
          <div style={{ textAlign: "right" }}>
            <h3>Invoice</h3>
            <div><b>No:</b> {s.invoice_no || id}</div>
            {s.dc_no && <div><b>DC No:</b> {s.dc_no}</div>}
            <div><b>Date/Time:</b> {fmtDateIST12h(s.invoice_date || s.created_at)}</div>
            {s.patient_name && <div><b>Patient:</b> {s.patient_name}</div>}
            {s.doctor_name && <div><b>Doctor:</b> {s.doctor_name}</div>}
            <div style={{ marginTop: 6 }}>
              {s.is_return ? (
                <span className="badge badge-return">RETURN</span>
              ) : Number(s.amount_paid || 0) >= Number(s.total || 0) - 0.01 ? (
                <span className="badge badge-paid">PAID</span>
              ) : Number(s.amount_paid || 0) > 0 ? (
                <span className="badge badge-partial">PARTIAL</span>
              ) : (
                <span className="badge badge-pending">PENDING</span>
              )}
            </div>
          </div>
        </div>

        {s.customer_name && (
          <div style={{ marginTop: 10 }}>
            <b>Bill To:</b>
            <div>{s.customer_name}</div>
            {s.customer_gstin && <div>GSTIN: {s.customer_gstin}</div>}
            {(s.customer_address || s.customer_phone) && (
              <div className="muted">
                {[s.customer_address, s.customer_phone].filter(Boolean).join(" • ")}
              </div>
            )}
          </div>
        )}

        <table>
          <thead>
            <tr>
              <th style={{ width: 40 }}>#</th>
              <th>Description</th>
              <th style={{ width: 90 }}>Category</th>
              <th style={{ width: 90 }}>HSN</th>
              <th style={{ width: 90 }}>Lot</th>
              <th style={{ width: 90 }}>Expiry</th>
              <th className="right" style={{ width: 70 }}>Qty</th>
              <th className="right" style={{ width: 100 }}>Rate</th>
              <th className="right" style={{ width: 80 }}>Disc%</th>
              <th className="right" style={{ width: 70 }}>GST%</th>
              <th className="right" style={{ width: 120 }}>Taxable</th>
              <th className="right" style={{ width: 100 }}>Tax</th>
              <th className="right" style={{ width: 120 }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it: any, i: number) => (
              <tr key={it.id}>
                <td>{i + 1}</td>
                <td>{it.name}</td>
                <td>{it.category ?? "—"}</td>
                <td>{it.hsn_code ?? "—"}</td>
                <td>{it.batch_no ?? "—"}</td>
                <td>{it.exp_date ?? "—"}</td>
                <td className="right">{Number(it.qty)}</td>
                <td className="right">{inr(it.unit_price)}</td>
                <td className="right">{Number(it.discount_pct || 0).toFixed(2)}</td>
                <td className="right">{Number(it.gst_slab || 0).toFixed(0)}</td>
                <td className="right">{inr(it.taxable)}</td>
                <td className="right">{inr(it.tax)}</td>
                <td className="right">{inr(it.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="totals">
          <div className="box">
            <div className="row"><span>Taxable</span><b>{inr(s.subtotal)}</b></div>
            <div className="row"><span>Tax</span><b>{inr(s.tax_total)}</b></div>
            <div className="row" style={{ borderTop: "1px solid #e5e7eb", marginTop: 6, paddingTop: 6 }}>
              <span>Grand Total</span><b>{inr(s.total)}</b>
            </div>
          </div>
        </div>

        {(biz.bank_account_name || biz.bank_account_number || biz.bank_ifsc || biz.bank_name || biz.bank_branch || biz.bank_upi) && (
          <div style={{ marginTop: 12 }}>
            <b>Bank Details:</b>
            <div className="muted" style={{ marginTop: 4 }}>
              {biz.bank_name && <div>Bank: {biz.bank_name}</div>}
              {biz.bank_branch && <div>Branch: {biz.bank_branch}</div>}
              {biz.bank_account_name && <div>A/C Name: {biz.bank_account_name}</div>}
              {biz.bank_account_number && <div>A/C No: {biz.bank_account_number}</div>}
              {biz.bank_ifsc && <div>IFSC: {biz.bank_ifsc}</div>}
              {biz.bank_upi && <div>UPI: {biz.bank_upi}</div>}
            </div>
          </div>
        )}
      </body>
    </html>
  );
}
