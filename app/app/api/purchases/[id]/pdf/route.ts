export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";
export const runtime = "nodejs";

import PDFDocument from "pdfkit";
import { NextRequest } from "next/server";
import { pool } from "@/lib/db";
import { guardApiActivated } from "@/lib/activation-guard";
import { registerPdfFonts } from "@/lib/pdfFonts";

/* ---------- helpers ---------- */

function money(n: any) {
  const v = Number(n || 0);
  return `INR (Rs/-) ${v.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

async function getTableColumns(client: any, table: string): Promise<Set<string>> {
  const r = await client.query(
    `SELECT LOWER(column_name) AS col
       FROM information_schema.columns
      WHERE table_schema='public' AND table_name = $1`,
    [table]
  );
  return new Set<string>(r.rows.map((x: any) => x.col));
}

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

/* ---------- pdf drawing primitives ---------- */

type Col = { key: string; label: string; w: number; align: "left" | "right" | "center" };

function drawTableHeader(
  doc: PDFDocument,
  leftX: number,
  rightX: number,
  y: number,
  cols: Col[],
  boldFace: string
) {
  // band
  doc.save();
  doc.rect(leftX, y, rightX - leftX, 20).fill("#F2F3F5");
  doc.restore();

  doc.font(boldFace).fillColor("#111").fontSize(10);
  let x = leftX + 8;
  for (const c of cols) {
    const cellX = x;
    const w = c.w - 8; // inner padding (right)
    doc.text(c.label, cellX, y + 5, { width: w, align: c.align });
    x += c.w;
  }

  // underline
  doc.moveTo(leftX, y + 20).lineTo(rightX, y + 20).strokeColor("#E3E5E8").lineWidth(1).stroke();
}

function drawRow(
  doc: PDFDocument,
  leftX: number,
  _rightX: number,
  y: number,
  cols: Col[],
  row: Record<string, any>,
  regularFace: string
) {
  doc.font(regularFace).fillColor("#222").fontSize(10);

  let x = leftX + 8;
  for (const c of cols) {
    const v = row[c.key];
    const w = c.w - 12; // inner padding
    doc.text(String(v ?? ""), x, y + 4, { width: w, align: c.align });
    x += c.w;
  }
  // row separation
  doc.moveTo(leftX, y + 22).lineTo(_rightX, y + 22).strokeColor("#F0F1F3").lineWidth(1).stroke();
}

function ensureSpace(doc: PDFDocument, needed: number, drawHeader: () => void) {
  const bottomY = doc.page.height - doc.page.margins.bottom;
  if (doc.y + needed > bottomY) {
    doc.addPage();
    drawHeader();
  }
}

/* ---------- route ---------- */

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  await guardApiActivated(true);
  const id = params.id;

  const client = await pool.connect();
  try {
    const pCols = await getTableColumns(client, "purchases");
    const iCols = await getTableColumns(client, "purchase_items");

    // Dynamic header columns
    const invNoCol =
      (pCols.has("invoice_no") && "invoice_no") ||
      (pCols.has("bill_no") && "bill_no") ||
      null;
    const dateCol =
      (pCols.has("invoice_date") && "invoice_date") ||
      (pCols.has("bill_date") && "bill_date") ||
      null;

    const hdrSql = `
      SELECT
        id,
        ${pCols.has("supplier_id") ? "supplier_id" : "NULL AS supplier_id"},
        ${invNoCol ? `${invNoCol} AS invoice_no` : "NULL AS invoice_no"},
        ${dateCol ? `to_char(${dateCol}, 'YYYY-MM-DD') AS invoice_date` : "NULL AS invoice_date"},
        ${pCols.has("meta") ? "meta" : "'{}'::jsonb AS meta"}
      FROM purchases
      WHERE id = $1
    `;
    const h = await client.query(hdrSql, [id]);
    if (h.rowCount === 0) return new Response("Not found", { status: 404 });
    const P = h.rows[0];

    // Fully-qualified item columns
    const qtyExpr = (iCols.has("qty") && "pi.qty") || "0";
    const costExpr =
      (iCols.has("cost_price") && "pi.cost_price") ||
      (iCols.has("purchase_rate") && "pi.purchase_rate") ||
      "0";
    const mrpExpr = (iCols.has("mrp") && "pi.mrp") || "NULL";
    const taxExpr =
      (iCols.has("tax_rate") && "pi.tax_rate") ||
      (iCols.has("gst_slab") && "pi.gst_slab") ||
      "0";
    const discExpr =
      (iCols.has("discount") && "pi.discount") ||
      (iCols.has("discount_pct") && "pi.discount_pct") ||
      "0";
    const descExpr = iCols.has("description") ? "pi.description" : "NULL";

    const itemsSql = `
      SELECT
        pi.product_id,
        (${qtyExpr})::float8  AS qty,
        (${costExpr})::float8 AS cost_price,
        (${mrpExpr})::float8  AS mrp,
        (${taxExpr})::float8  AS tax_rate,
        (${discExpr})::float8 AS discount,
        ${iCols.has("meta") ? "pi.meta" : "'{}'::jsonb AS meta"},
        COALESCE(${descExpr}, p.name, pi.product_id::text) AS product_name
      FROM purchase_items pi
      LEFT JOIN products p ON p.id::text = pi.product_id::text
      WHERE pi.purchase_id = $1
      ORDER BY pi.id
    `;
    const rs = await client.query(itemsSql, [id]);
    const items = rs.rows;

    // Totals
    let subtotal = 0, taxTotal = 0, discTotal = 0;
    for (const it of items) {
      const line = Number(it.qty || 0) * Number(it.cost_price || 0);
      subtotal += line;
      taxTotal += (Number(it.tax_rate || 0) / 100) * line;
      discTotal += Number(it.discount || 0);
    }
    const grand = subtotal + taxTotal - discTotal;

    const bp = await loadBusinessProfile(client);

    // ----- Build PDF -----
    const doc = new PDFDocument({ size: "A4", margin: 36 });
    const { regularFace, boldFace } = registerPdfFonts(doc);
    const leftX = doc.page.margins.left;
    const rightX = doc.page.width - doc.page.margins.right;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        doc.on("data", (chunk: any) => controller.enqueue(new Uint8Array(chunk)));
        doc.on("end", () => controller.close());
        doc.on("error", (err: any) => controller.error(err));

        // Company heading
        doc.font(boldFace).fontSize(20).fillColor("#111").text(bp.company_name, leftX, 36, {
          width: rightX - leftX,
        });

        // Contact / address
        doc.moveDown(0.25).font(regularFace).fontSize(9).fillColor("#444");
        const address = [bp.address1, bp.address2, [bp.city, bp.state, bp.pincode].filter(Boolean).join(" ")].filter(Boolean);
        for (const ln of address) doc.text(ln, { width: 320 });
        const contactBits = [
          bp.phone && `Ph: ${bp.phone}`,
          bp.email && `Email: ${bp.email}`,
          bp.website && `Web: ${bp.website}`,
          bp.gstin && `GSTIN: ${bp.gstin}`,
        ].filter(Boolean);
        if (contactBits.length) doc.text(contactBits.join("  ·  "), { width: 320 });

        // Title + voucher info
        doc.font(boldFace).fontSize(14).fillColor("#111").text("PURCHASE VOUCHER", rightX - 240, 36, {
          width: 240,
          align: "right",
        });
        doc.font(regularFace).fontSize(10).fillColor("#111");
        const y0 = 36 + 22;
        const infoRight = (label: string, val: string) =>
          doc.text(`${label}: ${val}`, rightX - 240, doc.y, { width: 240, align: "right" });
        doc.moveDown(0.2);
        infoRight("Voucher #", String(P.id));
        infoRight("Invoice No", String(P.invoice_no ?? "-"));
        infoRight("Date", String(P.invoice_date ?? "-"));

        // Horizontal rule
        const hrY = Math.max(doc.y, y0) + 8;
        doc.moveTo(leftX, hrY).lineTo(rightX, hrY).strokeColor("#BFC3C9").lineWidth(1).stroke();
        doc.moveDown(0.6);

        // Meta left block
        doc.font(boldFace).fillColor("#111").text("Details", leftX, hrY + 6);
        doc.font(regularFace).fillColor("#222");
        const vendor = P?.meta?.vendor_name || "-";
        const paid = P?.meta?.paid ? "Paid" : "Unpaid";
        const notes = P?.meta?.notes || "-";
        doc.text(`Received From: ${vendor}`);
        doc.text(`Paid Status: ${paid}`);
        doc.text(`Notes: ${notes}`);
        doc.moveDown(0.6);

        // Table
        const cols: Col[] = [
          { key: "product_name", label: "Product",  w: 230, align: "left"  },
          { key: "qty",          label: "Qty",      w: 60,  align: "right" },
          { key: "cost",         label: "Cost",     w: 100, align: "right" },
          { key: "mrp",          label: "MRP",      w: 80,  align: "right" },
          { key: "tax",          label: "Tax%",     w: 60,  align: "right" },
          { key: "disc",         label: "Discount", w: 110, align: "right" },
        ];

        const makeRow = (it: any) => ({
          product_name: String(it.product_name || it.product_id),
          qty: Number(it.qty || 0).toLocaleString("en-IN"),
          cost: money(it.cost_price),
          mrp: it.mrp == null ? "-" : money(it.mrp),
          tax: Number(it.tax_rate || 0).toLocaleString("en-IN"),
          disc: Number(it.discount || 0).toLocaleString("en-IN"),
        });

        const headerY = doc.y + 6;
        const drawHeader = () => drawTableHeader(doc, leftX, rightX, doc.y, cols, boldFace);
        drawHeader();
        doc.y = headerY + 20;

        const rowHeight = 24;
        for (const it of items) {
          ensureSpace(doc, rowHeight + 100, () => {
            drawHeader();
            doc.y += 20;
          });
          drawRow(doc, leftX, rightX, doc.y, cols, makeRow(it), regularFace);
          doc.y += rowHeight;
        }

        // Totals block (right column)
        ensureSpace(doc, 120, () => {
          drawHeader();
          doc.y += 20;
        });

        doc.moveDown(0.3);
        const labelW = 120, valW = 130;
        const gx = rightX - (labelW + valW) - 10;

        const lineR = (label: string, val: string, bold = false) => {
          doc.font(bold ? boldFace : regularFace).fontSize(bold ? 11 : 10);
          doc.text(label, gx, doc.y + 6, { width: labelW, align: "right" });
          doc.text(val,   gx + labelW + 10, doc.y + 6, { width: valW, align: "right" });
          doc.moveDown(0.2);
        };

        // Separator
        doc.moveTo(gx, doc.y + 4).lineTo(rightX, doc.y + 4).strokeColor("#E3E5E8").lineWidth(1).stroke();

        lineR("Subtotal", money(subtotal));
        lineR("Tax",      money(taxTotal));
        lineR("Discount", money(discTotal));
        doc.moveDown(0.2);
        doc.font(boldFace).fontSize(12);
        lineR("Grand Total", money(grand), true);

        // Footer
        doc.moveDown(1.2);
        doc.font(regularFace).fontSize(9).fillColor("#6B7280");
        doc.text(`Generated by AxEin Billing · Purchase #${P.id}`, rightX - 260, doc.y, { width: 260, align: "right" });

        doc.end();
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="purchase_${P.id}.pdf"`,
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
