export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

function inr(n: number | string | null | undefined) {
  const v = Number(n ?? 0);
  const amt = v.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
  return `INR (Rs/-) ${amt}`;
}
function fmtDateIST12h(dt: string | Date | null | undefined) {
  if (!dt) return "";
  const d = new Date(dt);
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "numeric", minute: "2-digit", hour12: true,
  }).format(d);
}

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isFinite(id)) {
    return new NextResponse("Invalid invoice id", { status: 400 });
  }

  // business
  let biz: any = {
    name: "Your Shop Name", address: "", phone: "", gstin: "",
    signature_name: "Owner Name", signature_title: "Proprietor", signature_image_url: "",
    logo_url: "",
  };
  try {
    const rs = await pool.query(`SELECT value_json FROM settings WHERE key='business'`);
    const v = rs.rows?.[0]?.value_json;
    if (v && typeof v === "object") biz = { ...biz, ...v };
  } catch {}

  // sale + customer (+meta extras)
  const saleRs = await pool.query(
    `SELECT s.id, s.invoice_no, s.customer_id, s.subtotal, s.tax_total, s.total,
            s.created_at, s.invoice_date,
            COALESCE((s.meta->>'is_return')::boolean, false)  AS is_return,
            COALESCE(s.amount_paid, (s.meta->>'amount_paid')::numeric, 0)   AS amount_paid,
            COALESCE(s.pending_amount,
                     GREATEST(s.total - COALESCE(s.amount_paid, (s.meta->>'amount_paid')::numeric, 0), 0)) AS pending_amount,
            COALESCE(NULLIF(s.payment_status,''), (s.meta->>'payment_status')) AS payment_status,
            COALESCE(NULLIF(s.payment_method,''), (s.meta->>'payment_method')) AS payment_method,
            (s.meta->>'notes')                                AS notes,
            (s.meta->>'terms')                                AS terms,
            (s.meta->>'extra_label')                          AS extra_label,
            COALESCE((s.meta->>'extra_amount')::numeric, 0)  AS extra_amount,
            (s.meta->>'patient_name')                          AS patient_name,
            (s.meta->>'doctor_name')                           AS doctor_name,
            (s.meta->>'dc_no')                                 AS dc_no,
            c.name AS customer_name, c.phone AS customer_phone,
            c.gstin AS customer_gstin, c.address AS customer_address,
            c.city AS customer_city, c.state AS customer_state, c.pincode AS customer_pin
       FROM sales s
       LEFT JOIN customers c ON c.id = s.customer_id
      WHERE s.id = $1`,
    [id]
  );
  if (saleRs.rowCount === 0) return new NextResponse("Invoice not found", { status: 404 });
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
        WHERE si.sale_id=$1
        ORDER BY si.id`, [id]
    )
  ).rows as any[];

  const displayDate = s.invoice_date ?? s.created_at;
  const balanceDue = Number(
    s.pending_amount ?? Math.max(Number(s.total || 0) - Number(s.amount_paid || 0), 0)
  );

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Invoice ${s.invoice_no ?? id}</title>
  <style>
    @page { size: A4; margin: 12mm; }
    @media print {
      html, body { background:#fff !important; }
      * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .noprint { display:none !important; }
      thead { display: table-header-group; }
      tfoot { display: table-footer-group; }
      table, tr, td, th { break-inside: avoid; page-break-inside: avoid; }
      .no-break { break-inside: avoid; page-break-inside: avoid; }
    }
    body { font-family: "Manrope", ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; margin:24px; color:#0b1220; }
    h1,h2,h3 { margin:0; }
    .row { display:flex; justify-content:space-between; align-items:flex-start; gap:12px; }
    .muted { color:#64748b; }
    .logo { max-height:48px; object-fit:contain; }
    .header { border-radius:16px; overflow:hidden; border:1px solid #e5e7eb; }
    .header-top { background:#1f4a8f; color:#fff; padding:18px 20px; display:flex; gap:16px; justify-content:space-between; align-items:flex-start; }
    .header-title { font-size:26px; font-weight:700; letter-spacing:0.08em; }
    .header-meta { text-align:right; font-size:12px; line-height:1.4; }
    .balance { background:#eef2ff; color:#0b1220; padding:8px 20px; text-align:right; font-weight:700; }
    table { width:100%; border-collapse:collapse; margin-top:12px; }
    th, td { border-top:1px solid #e5e7eb; padding:6px 8px; text-align:left; vertical-align:top; }
    .right { text-align:right; }
    .totals { margin-top:12px; display:flex; justify-content:flex-end; }
    .box { border:1px solid #e5e7eb; padding:10px; min-width:280px; }
    .badge { display:inline-block; padding:2px 8px; margin-left:6px; border-radius:9999px; font-size:12px; font-weight:700; border:1px solid transparent; }
    .badge-return { background:#FEF2F2; color:#B91C1C; border-color:#FCA5A5; }
    .badge-paid   { background:#ECFDF5; color:#065F46; border-color:#6EE7B7; }
    .badge-partial{ background:#FFF7ED; color:#92400E; border-color:#FDBA74; }
    .badge-pending{ background:#EFF6FF; color:#1D4ED8; border-color:#93C5FD; }
    .notes { margin-top:12px; }
    .notes h4 { margin:0 0 6px 0; }
    .notes p { margin:0 0 6px 0; white-space:pre-wrap; }
  </style>
</head>
<body>
  <div class="noprint" style="margin-bottom:12px">
    <button onclick="window.close()" style="border:1px solid #e5e7eb; padding:6px 10px; border-radius:6px">Close</button>
    <button onclick="window.print()" style="border:1px solid #e5e7eb; padding:6px 10px; border-radius:6px">Print</button>
  </div>

  <div class="header">
    <div class="header-top">
      <div>
        <div class="header-title">INVOICE</div>
        <div style="margin-top:8px; font-weight:600;">${biz.name || "Your Shop Name"}</div>
        ${biz.address ? `<div style="opacity:0.85">${biz.address}</div>` : ""}
        ${biz.gstin ? `<div>GSTIN: ${biz.gstin}</div>` : ""}
        ${biz.phone ? `<div>Phone: ${biz.phone}</div>` : ""}
      </div>
      <div class="header-meta">
        ${biz.logo_url ? `<div><img class="logo" src="${biz.logo_url}" alt="Logo" /></div>` : ""}
        <div><b>No:</b> ${s.invoice_no ?? id}</div>
        ${s.dc_no ? `<div><b>DC No:</b> ${s.dc_no}</div>` : ""}
        <div><b>Date/Time:</b> ${fmtDateIST12h(displayDate)}</div>
        ${s.patient_name ? `<div><b>Patient:</b> ${s.patient_name}</div>` : ""}
        ${s.doctor_name ? `<div><b>Doctor:</b> ${s.doctor_name}</div>` : ""}
        <div style="margin-top:6px">
            ${
          s.is_return
            ? `<span class="badge badge-return">RETURN</span>`
            : (s.payment_status || "").toLowerCase() === "paid"
            ? `<span class="badge badge-paid">PAID</span>`
            : (s.payment_status || "").toLowerCase() === "partial"
            ? `<span class="badge badge-partial">PARTIAL</span>`
            : `<span class="badge badge-pending">PENDING</span>`
        }
        </div>
      </div>
    </div>
    <div class="balance">Balance Due ${inr(balanceDue)}</div>
  </div>

  ${s.customer_name ? `
    <div style="margin-top:10px">
      <b>Bill To:</b>
      <div>${s.customer_name}</div>
      ${s.customer_gstin ? `<div>GSTIN: ${s.customer_gstin}</div>` : ""}
      ${ (s.customer_address || s.customer_city || s.customer_state || s.customer_pin)
        ? `<div class="muted">${[s.customer_address, s.customer_city, s.customer_state, s.customer_pin].filter(Boolean).join(", ")}</div>` : "" }
      ${s.customer_phone ? `<div>Phone: ${s.customer_phone}</div>` : ""}
    </div>` : ""}

  <table>
    <thead>
      <tr>
        <th style="width:40px">#</th>
        <th>Description</th>
        <th style="width:90px">Category</th>
        <th style="width:90px">HSN</th>
        <th style="width:90px">Lot</th>
        <th style="width:90px">Expiry</th>
        <th class="right" style="width:70px">Qty</th>
        <th class="right" style="width:100px">Rate</th>
        <th class="right" style="width:80px">Disc%</th>
        <th class="right" style="width:70px">GST%</th>
        <th class="right" style="width:120px">Taxable</th>
        <th class="right" style="width:100px">Tax</th>
        <th class="right" style="width:120px">Amount</th>
      </tr>
    </thead>
    <tbody>
      ${items.map((it: any, i: number) => `
        <tr>
          <td>${i + 1}</td>
          <td>${it.name}</td>
          <td>${it.category ?? "—"}</td>
          <td>${it.hsn_code ?? "—"}</td>
          <td>${it.batch_no ?? "—"}</td>
          <td>${it.exp_date ? String(it.exp_date) : "—"}</td>
          <td class="right">${Number(it.qty)}</td>
          <td class="right">${inr(it.unit_price)}</td>
          <td class="right">${Number(it.discount_pct || 0).toFixed(2)}</td>
          <td class="right">${Number(it.gst_slab || 0).toFixed(0)}</td>
          <td class="right">${inr(it.taxable)}</td>
          <td class="right">${inr(it.tax)}</td>
          <td class="right">${inr(it.total)}</td>
        </tr>
      `).join("")}
    </tbody>
  </table>

  <div class="totals no-break">
    <div class="box">
      <div class="row"><span>Taxable</span><b>${inr(s.subtotal)}</b></div>
      <div class="row"><span>Tax</span><b>${inr(s.tax_total)}</b></div>
      ${Number(s.extra_amount || 0) > 0
        ? `<div class="row"><span>${s.extra_label || 'Additional Charge'}</span><b>${inr(s.extra_amount)}</b></div>`
        : ''
      }
      <div class="row" style="border-top:1px solid #e5e7eb; margin-top:6px; padding-top:6px">
        <span>Grand Total</span><b>${inr(s.total)}</b>
      </div>
      <div class="row"><span>Amount Paid</span><b>${inr(s.amount_paid)}</b></div>
      <div class="row"><span>Balance Due</span><b>${inr(s.pending_amount ?? Math.max(Number(s.total||0) - Number(s.amount_paid||0),0))}</b></div>
      ${s.payment_method ? `<div class="row"><span>Method</span><b>${s.payment_method}</b></div>` : ''}
      ${
        biz.signature_name
          ? `<div style="margin-top:12px; text-align:right">
               ${biz.signature_image_url ? `<img src="${biz.signature_image_url}" alt="signature" style="height:60px" />` : ""}
               <div style="border-top:1px solid #e5e7eb; margin-top:6px; padding-top:6px">
                 <div><b>${biz.signature_name}</b></div>
                 <div class="muted">${biz.signature_title || ""}</div>
               </div>
             </div>`
          : ""
      }
    </div>
  </div>

  ${
    s.notes || s.terms
      ? `<div class="notes no-break">
           <h4>Notes / Terms</h4>
           ${s.notes ? `<p>${String(s.notes).replace(/</g,"&lt;")}</p>` : ""}
           ${s.terms ? `<p>${String(s.terms).replace(/</g,"&lt;")}</p>` : ""}
         </div>`
      : ''
  }

  ${
    (biz.bank_account_name || biz.bank_account_number || biz.bank_ifsc || biz.bank_name || biz.bank_branch || biz.bank_upi)
      ? `<div class="notes no-break">
           <h4>Bank Details</h4>
           ${biz.bank_name ? `<p>Bank: ${biz.bank_name}</p>` : ""}
           ${biz.bank_branch ? `<p>Branch: ${biz.bank_branch}</p>` : ""}
           ${biz.bank_account_name ? `<p>A/C Name: ${biz.bank_account_name}</p>` : ""}
           ${biz.bank_account_number ? `<p>A/C No: ${biz.bank_account_number}</p>` : ""}
           ${biz.bank_ifsc ? `<p>IFSC: ${biz.bank_ifsc}</p>` : ""}
           ${biz.bank_upi ? `<p>UPI: ${biz.bank_upi}</p>` : ""}
         </div>`
      : ''
  }

  <script>
    window.addEventListener('load', () => { try { window.print(); } catch(e) {} });
  </script>
</body>
</html>`;

  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
