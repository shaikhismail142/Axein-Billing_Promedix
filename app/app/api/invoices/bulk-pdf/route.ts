// app/api/invoices/bulk-pdf/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { pool } from "@/lib/db";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import JSZip from "jszip";

export async function POST(req: Request) {
  let body: { ids: number[] };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 });
  }

  const ids = Array.isArray(body.ids)
    ? body.ids.map(Number).filter((n) => Number.isFinite(n))
    : [];
  if (!ids.length) {
    return new Response(JSON.stringify({ error: "No ids" }), { status: 400 });
  }

  const zip = new JSZip();

  for (const id of ids) {
    const saleRs = await pool.query(
      `
      SELECT s.*,
             c.name    AS customer_name,
             c.phone   AS customer_phone,
             c.gstin   AS customer_gstin,
             c.address AS customer_address,
             (s.meta->>'patient_name') AS patient_name,
             (s.meta->>'doctor_name')  AS doctor_name,
             (s.meta->>'dc_no')        AS dc_no
      FROM sales s
      LEFT JOIN customers c ON c.id = s.customer_id
      WHERE s.id = $1
    `,
      [id]
    );
    if (!saleRs.rowCount) continue;

    const sale = saleRs.rows[0] as any;
    const items = (
      await pool.query(
        `SELECT si.*, 
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

    // Build a simple A4 PDF for each invoice
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([595, 842]); // A4 portrait
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

    const margin = 40;
    let y = 800;
    const lineH = 14;

    page.drawText("INVOICE", { x: margin, y, size: 18, font: bold });
    y -= 24;

    page.drawText(`No: ${sale.invoice_no || sale.id}`, { x: margin, y, size: 12, font });
    y -= lineH;

    const dt = sale.invoice_date || sale.created_at;
    page.drawText(
      `Date: ${new Date(dt).toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        hour12: true,
      })}`,
      { x: margin, y, size: 12, font }
    );
    y -= lineH;
    if (sale.dc_no) {
      page.drawText(`DC No: ${sale.dc_no}`, { x: margin, y, size: 10, font });
      y -= lineH;
    }
    if (sale.patient_name) {
      page.drawText(`Patient: ${sale.patient_name}`, { x: margin, y, size: 10, font });
      y -= lineH;
    }
    if (sale.doctor_name) {
      page.drawText(`Doctor: ${sale.doctor_name}`, { x: margin, y, size: 10, font });
      y -= lineH;
    }

    if (sale.customer_name) {
      page.drawText(`Bill To: ${sale.customer_name}`, { x: margin, y, size: 12, font });
      y -= lineH;
      if (sale.customer_address) {
        page.drawText(String(sale.customer_address), {
          x: margin,
          y,
          size: 10,
          font,
          color: rgb(0.25, 0.25, 0.25),
        });
        y -= lineH;
      }
      if (sale.customer_phone) {
        page.drawText(`Phone: ${sale.customer_phone}`, { x: margin, y, size: 10, font });
        y -= lineH;
      }
      if (sale.customer_gstin) {
        page.drawText(`GSTIN: ${sale.customer_gstin}`, { x: margin, y, size: 10, font });
        y -= lineH;
      }
    } else {
      page.drawText(`Bill To: Cash/Walk-in`, { x: margin, y, size: 12, font });
      y -= lineH;
    }

    // Table header
    const cols = [
      margin,
      margin + 30,
      margin + 280,
      margin + 340,
      margin + 390,
      margin + 440,
      margin + 500,
    ];
    const head = ["#", "Item", "Qty", "Rate", "GST%", "Tax", "Total"];
    head.forEach((h, i) => page.drawText(h, { x: cols[i], y, size: 10, font: bold }));
    y -= lineH;

    items.forEach((it: any, i: number) => {
      page.drawText(String(i + 1), { x: cols[0], y, size: 10, font });
      const metaBits = [
        it.category ? `Cat: ${it.category}` : null,
        it.hsn_code ? `HSN: ${it.hsn_code}` : null,
        it.batch_no ? `Lot: ${it.batch_no}` : null,
        it.exp_date ? `Exp: ${it.exp_date}` : null,
      ].filter(Boolean).join(" | ");
      const nameLine = String(it.name);
      const yRow = y;
      page.drawText(nameLine, { x: cols[1], y: yRow, size: 10, font });
      if (metaBits) {
        page.drawText(metaBits, { x: cols[1], y: yRow - 10, size: 8, font, color: rgb(0.3, 0.3, 0.3) });
      }
      page.drawText(String(Number(it.qty)), { x: cols[2], y: yRow, size: 10, font });
      page.drawText(String(Number(it.unit_price).toFixed(2)), {
        x: cols[3],
        y: yRow,
        size: 10,
        font,
      });
      page.drawText(String(Number(it.gst_slab || 0).toFixed(0)), {
        x: cols[4],
        y: yRow,
        size: 10,
        font,
      });
      page.drawText(String(Number(it.tax || 0).toFixed(2)), { x: cols[5], y: yRow, size: 10, font });
      page.drawText(String(Number(it.total || 0).toFixed(2)), {
        x: cols[6],
        y: yRow,
        size: 10,
        font,
      });
      y -= metaBits ? lineH + 10 : lineH;

      if (y < 80) {
        // naive pagination
        y = 800;
        pdf.addPage();
      }
    });

    y -= 8;
    page.drawText(`Grand Total: ₹${Number(sale.total || 0).toFixed(2)}`, {
      x: cols[5],
      y,
      size: 12,
      font: bold,
    });

    const bytes = await pdf.save(); // Uint8Array
    const filename = `invoice-${sale.invoice_no || id}.pdf`;
    zip.file(filename, bytes);
  }

  // ✅ Generate a Blob so it's an unquestioned BodyInit
  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });

  return new Response(blob, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": "attachment; filename=invoices.zip",
      "Cache-Control": "no-store",
    },
  });
}
