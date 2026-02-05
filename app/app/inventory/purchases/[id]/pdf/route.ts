export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";
export const runtime = "nodejs";

import PDFDocument from "pdfkit";
import { NextRequest } from "next/server";
import { pool } from "@/lib/db";
import { guardApiActivated } from "@/lib/activation-guard";

const INR = (n: any) => `INR (Rs/-) ${Number(n || 0).toFixed(2)}`;

async function loadBusinessProfile(client: any) {
  const r = await client.query(
    `SELECT value_json FROM settings WHERE key IN ('business_profile','business') ORDER BY key LIMIT 1`
  );
  const v = r.rows?.[0]?.value_json || {};
  const bp = v.business_profile || v || {};
  return {
    company_name: bp.company_name || bp.name || "Your Company",
    address1: bp.address1 || bp.address_line1 || "",
    address2: bp.address2 || bp.address_line2 || "",
    city: bp.city || "",
    state: bp.state || "",
    pincode: bp.pincode || bp.pin || "",
    phone: bp.phone || "",
    email: bp.email || "",
    website: bp.website || "",
    gstin: bp.gstin || "",
  };
}

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  await guardApiActivated(true);
  const id = params.id;

  const client = await pool.connect();
  try {
    const hdr = await client.query(
      `SELECT id, supplier_id, invoice_no,
              to_char(invoice_date, 'YYYY-MM-DD') AS invoice_date,
              total_amount::float8, total_tax::float8, meta, created_at
       FROM purchases
       WHERE id = $1`,
      [id]
    );
    if (hdr.rowCount === 0) return new Response("Not found", { status: 404 });

    const p = hdr.rows[0];

    const itemsRes = await client.query(
      `SELECT product_id,
              qty::float8 AS qty,
              cost_price::float8 AS cost_price,
              mrp::float8 AS mrp,
              tax_rate::float8 AS tax_rate,
              discount::float8 AS discount,
              meta
       FROM purchase_items
       WHERE purchase_id = $1
       ORDER BY id`,
      [id]
    );
    const items = itemsRes.rows;

    const bp = await loadBusinessProfile(client);

    // Build PDF
    const doc = new PDFDocument({ size: "A4", margin: 36 });

    // Stream the PDF via Web ReadableStream to avoid Buffer/BodyInit type issues
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        // fonts
        try {
          doc.font("/usr/share/fonts/dejavu/DejaVuSans.ttf");
        } catch {
          doc.font("Helvetica");
        }

        // pipe PDFKit data to controller
        doc.on("data", (chunk: any) => controller.enqueue(new Uint8Array(chunk)));
        doc.on("end", () => controller.close());
        doc.on("error", (err: any) => controller.error(err));

        // Header (Company)
        doc.fontSize(18).text(bp.company_name);
        doc.moveDown(0.25);
        doc.fontSize(9);
        const addrLines = [
          bp.address1,
          bp.address2,
          [bp.city, bp.state, bp.pincode].filter(Boolean).join(" "),
        ].filter(Boolean);
        addrLines.forEach((ln) => doc.text(ln));
        const contactBits = [
          bp.phone && `Ph: ${bp.phone}`,
          bp.email && `Email: ${bp.email}`,
          bp.website && `Web: ${bp.website}`,
          bp.gstin && `GSTIN: ${bp.gstin}`,
        ].filter(Boolean);
        if (contactBits.length) doc.text(contactBits.join("  ·  "));
        doc.moveDown();

        // Title
        doc.fontSize(14).text("PURCHASE VOUCHER", { align: "right" });
        doc.moveDown(0.25);

        // Voucher meta box
        const yStart = doc.y;
        doc.fontSize(10);
        doc.text(`Received From: ${p.meta?.vendor_name || "-"}`);
        doc.text(`Paid Status: ${p.meta?.paid ? "Paid" : "Unpaid"}`);
        doc.text(`Notes: ${p.meta?.notes || "-"}`);
        doc.moveUp(3);
        doc.text(`Voucher #${p.id}`, { align: "right" });
        doc.text(`Invoice No: ${p.invoice_no || "-"}`, { align: "right" });
        doc.text(`Date: ${p.invoice_date || "-"}`, { align: "right" });
        doc.moveDown();

        doc.moveTo(36, yStart - 6).lineTo(559, yStart - 6).strokeColor("#999").stroke();

        // Table header
        doc.moveDown(0.5);
        const cols = [
          { label: "Product", w: 180, align: "left" as const },
          { label: "Qty", w: 50, align: "right" as const },
          { label: "Cost", w: 80, align: "right" as const },
          { label: "MRP", w: 70, align: "right" as const },
          { label: "Tax%", w: 60, align: "right" as const },
          { label: "Discount", w: 80, align: "right" as const },
        ];
        doc.fontSize(10).fillColor("#555");
        cols.forEach((c, i) => {
          doc.text(c.label, { continued: i < cols.length - 1, width: c.w, align: c.align });
        });
        doc.text("");
        doc.moveTo(36, doc.y + 2).lineTo(559, doc.y + 2).strokeColor("#ddd").stroke();

        // Rows
        doc.moveDown(0.2).fillColor("#000");
        let subtotal = 0;
        let taxTotal = 0;
        let discTotal = 0;

        for (const it of items) {
          const lineAmt = Number(it.qty || 0) * Number(it.cost_price || 0);
          subtotal += lineAmt;
          taxTotal += (Number(it.tax_rate || 0) / 100) * lineAmt;
          discTotal += Number(it.discount || 0);

          const row = [
            String(it.product_id),
            String(it.qty || 0),
            INR(it.cost_price),
            it.mrp == null ? "-" : INR(it.mrp),
            String(it.tax_rate ?? 0),
            String(it.discount ?? 0),
          ];

          cols.forEach((c, i) => {
            doc.text(row[i], { continued: i < cols.length - 1, width: c.w, align: c.align });
          });
          doc.text("");
          doc.moveDown(0.1);
        }

        const grand = subtotal + taxTotal - discTotal;

        // Totals
        doc.moveDown(0.5);
        doc.moveTo(36, doc.y).lineTo(559, doc.y).strokeColor("#ddd").stroke();
        doc.moveDown(0.3);
        const xRight = 559;
        const labelW = 120;
        const valW = 100;
        const lineR = (label: string, val: string) => {
          doc.text(label, xRight - labelW - valW - 4, doc.y, { width: labelW, align: "right" });
          doc.text(val, xRight - valW, doc.y, { width: valW, align: "right" });
          doc.moveDown(0.2);
        };
        doc.fontSize(10);
        lineR("Subtotal", INR(subtotal));
        lineR("Tax", INR(taxTotal));
        lineR("Discount", INR(discTotal));
        doc.moveDown(0.2);
        doc.fontSize(12);
        lineR("Grand Total", INR(grand));

        doc.moveDown(1);
        doc.fontSize(9).fillColor("#555").text(`Generated by AxEin Billing · Purchase #${p.id}`, { align: "right" });

        doc.end();
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="purchase_${p.id}.pdf"`,
        "cache-control": "no-store",
      },
    });
  } catch (e: any) {
    console.error("PDF error", e);
    return new Response("Failed to generate PDF", { status: 500 });
  } finally {
    client.release();
  }
}
