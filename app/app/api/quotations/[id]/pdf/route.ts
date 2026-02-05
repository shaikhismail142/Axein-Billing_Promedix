// app/api/quotations/[id]/pdf/route.ts
import { pool } from "@/lib/db";
import PDFDocument from "pdfkit";
import fs from "fs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** ------------ types & utils ------------- */
type Quotation = {
  id: number;
  quotation_number: string | null;
  quotation_date: string | null;
  valid_until: string | null;
  customer_id: number | null;
  customer_name: string | null;
  meta?: any;
};

type QItem = {
  description: string | null;
  qty: number | null;
  price: number | null;
  tax: number | null;       // GST %
  discount: number | null;  // % or absolute (>100)
  category?: string | null;
  hsn_code?: string | null;
  batch_no?: string | null;
  exp_date?: string | null;
};

type BusinessProfile = {
  company_name?: string;
  address_line1?: string;
  address_line2?: string;
  city?: string;
  state?: string;
  pincode?: string;
  phone?: string;
  email?: string;
  gstin?: string;
  website?: string;
  // legacy/alt
  name?: string;
  address?: string;
  shop_name?: string;
  state_code?: string;
};

const toNum = (v: any, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

const fmtINR = (n: number) => {
  const v = toNum(n, 0);
  const parts = v.toFixed(2).split(".");
  let x = parts[0];
  const last3 = x.slice(-3);
  const other = x.slice(0, -3);
  if (other) x = other.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + last3;
  return `INR (Rs/-) ${x}.${parts[1]}`;
};
const fmtAmt = (n: number) => {
  const v = toNum(n, 0);
  const parts = v.toFixed(2).split(".");
  let x = parts[0];
  const last3 = x.slice(-3);
  const other = x.slice(0, -3);
  if (other) x = other.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + last3;
  return `${x}.${parts[1]}`;
};
const fmtDate = (v?: string | null) => (v ? new Date(v).toLocaleDateString("en-IN") : "-");
const fmtDateTime = (d = new Date()) =>
  d.toLocaleString("en-IN", { hour12: false }); // e.g., 27/09/2025, 16:35:12

/** Fonts */
function tryRegisterFonts(doc: any) {
  const paths = [
    "/usr/share/fonts/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  ];
  for (const p of paths) {
    try {
      if (fs.existsSync(p)) {
        doc.registerFont("DejaVu", p);
        return "DejaVu";
      }
    } catch {}
  }
  return undefined;
}

/** Normalize BusinessProfile from multiple shapes/keys */
function normalizeBusinessProfile(raw: any): Required<BusinessProfile> {
  const bp = (raw?.business_profile ?? raw ?? {}) as BusinessProfile;
  const company_name = bp.company_name || bp.shop_name || bp.name || "";
  const address_line1 = bp.address_line1 || bp.address || "";
  const address_line2 = bp.address_line2 || "";
  const city = bp.city || "";
  const state = bp.state || bp.state_code || "";
  const pincode = bp.pincode || "";
  const phone = bp.phone || "";
  const email = bp.email || "";
  const website = bp.website || "";
  const gstin = bp.gstin || "";
  return {
    company_name, address_line1, address_line2, city, state, pincode,
    phone, email, website, gstin, name: bp.name, address: bp.address,
    shop_name: bp.shop_name, state_code: bp.state_code
  };
}

/** ------------ route ------------- */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isFinite(id)) {
    return new Response(JSON.stringify({ error: "Invalid id" }), { status: 400 });
  }

  // Quotation + customer name
  const qRs = await pool.query(
    `select q.*, c.name as customer_name
       from quotations q
       left join customers c on c.id = q.customer_id
      where q.id=$1
      limit 1`,
    [id]
  );
  if (qRs.rowCount === 0) {
    return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
  }
  const q = qRs.rows[0] as Quotation;

  // Items
  const itRs = await pool.query(
    `select qi.description, qi.qty, qi.price, qi.tax, qi.discount, qi.batch_no, qi.exp_date,
            COALESCE(p.category, p.meta->>'category') AS category,
            COALESCE(p.hsn_code, p.hsn, p.meta->>'hsn_code') AS hsn_code
       from quotation_items qi
       left join products p on p.id = qi.product_id
      where qi.quotation_id=$1
      order by qi.id asc`,
    [id]
  );
  const items = itRs.rows as QItem[];

  // Business profile: prefer key='business_profile'; fallback to 'business'; latest row wins
  const sRs = await pool.query(
    `select value_json from settings where key in ('business_profile','business') order by id desc limit 1`
  );
  const rawVal = sRs.rows?.[0]?.value_json || {};
  const business = normalizeBusinessProfile(rawVal);

  // ---------- compute rows & totals ----------
  type Row = {
    desc: string;
    category: string;
    hsn: string;
    batch: string;
    exp: string;
    qty: number;
    price: number;
    discPct: number;
    gstPct: number;
    gross: number;
    discAbs: number;
    taxable: number;
    taxAbs: number;
    lineTotal: number;
  };

  let subtotal = 0, discountTotal = 0, taxTotal = 0, grand = 0;
  const rows: Row[] = items.map((it) => {
    const qty = clamp(toNum(it.qty, 0), 0, 1e9);
    const price = clamp(toNum(it.price, 0), 0, 1e9);
    const gross = qty * price;

    const rawDisc = toNum(it.discount, 0);
    const discAbs = rawDisc > 0 ? (rawDisc <= 100 ? gross * (rawDisc / 100) : rawDisc) : 0;
    const discPct = gross > 0 ? clamp((discAbs / gross) * 100, 0, 100) : 0;

    const taxable = Math.max(0, gross - discAbs);
    const gstPct = clamp(toNum(it.tax, 0), 0, 100);
    const taxAbs = taxable * (gstPct / 100);
    const lineTotal = taxable + taxAbs;

    subtotal += taxable;
    discountTotal += discAbs;
    taxTotal += taxAbs;
    grand += lineTotal;

    return {
      desc: (it.description ?? "").toString(),
      category: (it.category ?? "").toString(),
      hsn: (it.hsn_code ?? "").toString(),
      batch: (it.batch_no ?? "").toString(),
      exp: it.exp_date ? fmtDate(it.exp_date) : "",
      qty: round2(qty),
      price: round2(price),
      discPct: round2(discPct),
      gstPct: round2(gstPct),
      gross: round2(gross),
      discAbs: round2(discAbs),
      taxable: round2(taxable),
      taxAbs: round2(taxAbs),
      lineTotal: round2(lineTotal),
    };
  });

  const rounded = round2(grand);
  const roundoff = round2(rounded - grand);
  const final = round2(grand + roundoff);

  // ---------- PDF (Tally-like layout) ----------
  const doc = new PDFDocument({ size: "A4", margin: 36 }); // no bufferPages
  const genAt = new Date();
  doc.info.Title = `Quotation ${q.quotation_number ?? q.id}`;
  doc.info.CreationDate = genAt as any;

  const registered = tryRegisterFonts(doc);
  const baseFont = registered ?? "Helvetica";
  const boldFont = registered ? undefined : "Helvetica-Bold";

  const pageW = doc.page.width;
  const pageH = doc.page.height;
  const margin = 36;
  const contentW = pageW - margin * 2;

  // Header
  doc.font(boldFont || baseFont).fontSize(26).text("QUOTATION", margin, margin, { width: contentW - 220 });
  // Right meta box (also shows generation timestamp)
  const rightW = 210, rightX = margin + contentW - rightW, topY = margin;
  doc.rect(rightX, topY, rightW, 86).strokeColor("#9ca3af").lineWidth(0.8).stroke();
  doc.font(baseFont).fontSize(10).fillColor("#111");
  doc.text(`No: ${q.quotation_number ?? q.id}`, rightX + 10, topY + 10, { width: rightW - 20, align: "right" });
  doc.text(`Date: ${fmtDate(q.quotation_date)}`, rightX + 10, topY + 26, { width: rightW - 20, align: "right" });
  doc.text(`Valid Until: ${fmtDate(q.valid_until)}`, rightX + 10, topY + 42, { width: rightW - 20, align: "right" });
  doc.text(`Generated: ${fmtDateTime(genAt)}`, rightX + 10, topY + 58, { width: rightW - 20, align: "right" });

  // Company block
  const compX = margin, compY = margin + 34, compW = contentW - rightW - 12;
  const lines: string[] = [];
  if (business.company_name) lines.push(String(business.company_name));
  const addrParts = [business.address_line1, business.address_line2, business.city, business.state, business.pincode]
    .filter(Boolean).map(String);
  if (addrParts.length) lines.push(addrParts.join(", "));
  if (business.gstin) lines.push(`GSTIN: ${business.gstin}`);
  if (business.phone) lines.push(`Phone: ${business.phone}`);
  if (business.email) lines.push(`Email: ${business.email}`);

  if (lines.length) {
    const compH = Math.max(38, 8 + lines.length * 13);
    doc.rect(compX, compY - 4, compW, compH).strokeColor("#9ca3af").lineWidth(0.8).stroke();
    let ly = compY;
    doc.font(boldFont || baseFont).fontSize(12);
    if (business.company_name) { doc.text(String(business.company_name), compX + 8, ly, { width: compW - 16 }); ly += 15; }
    doc.font(baseFont).fontSize(10);
    for (const l of lines.slice(business.company_name ? 1 : 0)) { doc.text(l, compX + 8, ly, { width: compW - 16 }); ly += 13; }
  }

  // Horizontal rule
  let y = Math.max(compY + Math.max(38, 8 + lines.length * 13), topY + 96) + 10;
  doc.moveTo(margin, y).lineTo(margin + contentW, y).strokeColor("#111").lineWidth(1).stroke();

  // Bill To
  y += 8;
  const billH = 42;
  doc.rect(margin, y, contentW, billH).strokeColor("#9ca3af").lineWidth(0.8).stroke();
  doc.font(boldFont || baseFont).fontSize(11).text("Bill To:", margin + 8, y + 8);
  doc.font(baseFont).fontSize(11).text((q.customer_name ?? "-").toString(), margin + 8, y + 24, { width: contentW - 16 });
  y += billH + 10;

  // Table header (smaller font, left aligned; GST% widened)
  const cols = [
    { key: "desc",  label: "Description", w: 150, align: "left"  as const },
    { key: "cat",   label: "Category",    w: 45,  align: "left"  as const },
    { key: "hsn",   label: "HSN",         w: 45,  align: "left"  as const },
    { key: "lot",   label: "Lot",         w: 50,  align: "left"  as const },
    { key: "exp",   label: "Exp",         w: 50,  align: "left"  as const },
    { key: "qty",   label: "Qty",         w: 30,  align: "right" as const },
    { key: "price", label: "Rate",        w: 45,  align: "right" as const },
    { key: "disc",  label: "Disc%",       w: 35,  align: "right" as const },
    { key: "gst",   label: "GST%",        w: 35,  align: "right" as const },
    { key: "total", label: "Amt",         w: 38,  align: "right" as const },
  ];
  const tableX = margin;
  const tableW = cols.reduce((s, c) => s + c.w, 0); // ~523

  // Header lines
  doc.moveTo(tableX, y).lineTo(tableX + tableW, y).strokeColor("#9ca3af").lineWidth(0.8).stroke();
  y += 5;
  doc.font(boldFont || baseFont).fontSize(8.5).fillColor("#111");
  let hx = tableX + 4;
  for (const c of cols) { doc.text(c.label, hx, y, { width: c.w - 8, align: "left" }); hx += c.w; }
  y += 15;
  doc.moveTo(tableX, y).lineTo(tableX + tableW, y).strokeColor("#9ca3af").lineWidth(0.8).stroke();

  // Helpers
  const padY = 6;
  const stripe = "#f9fafb";
  const ensurePage = (rowHeight: number) => {
    if (y + rowHeight + 170 > pageH - margin) {
      // Draw footer on THIS page (first page only requirement -> only if page number is 1)
      if (doc.page.index === 0) {
        drawFooterFirstPage(doc, baseFont, genAt);
      }
      doc.addPage();
      // new page header
      y = margin;
      doc.moveTo(tableX, y).lineTo(tableX + tableW, y).strokeColor("#9ca3af").lineWidth(0.8).stroke();
      y += 5;
      doc.font(boldFont || baseFont).fontSize(8.5).fillColor("#111");
      let hx2 = tableX + 4;
      for (const c of cols) { doc.text(c.label, hx2, y, { width: c.w - 8, align: "left" }); hx2 += c.w; }
      y += 15;
      doc.moveTo(tableX, y).lineTo(tableX + tableW, y).strokeColor("#9ca3af").lineWidth(0.8).stroke();
    }
  };

  // Rows (height from all columns; vertical borders first; small lineGap)
  doc.font(baseFont).fontSize(8.5).fillColor("#111");
  rows.forEach((r, idx) => {
    const cellTexts = [
      String(r.desc || "-"),
      String(r.category || "-"),
      String(r.hsn || "-"),
      String(r.batch || "-"),
      String(r.exp || "-"),
      r.qty.toFixed(2),
      fmtAmt(r.price),
      r.discPct.toFixed(2),
      r.gstPct.toFixed(2),
      fmtAmt(r.lineTotal),
    ];
    const colWidths = cols.map(c => c.w - 8);
    let textH = 0;
    for (let i = 0; i < cellTexts.length; i++) {
      const h = doc.heightOfString(cellTexts[i] || "-", { width: colWidths[i], lineGap: 1 });
      textH = Math.max(textH, h);
    }
    const rowH = Math.max(18, textH + padY * 2);

    ensurePage(rowH);

    if (idx % 2 === 1) { doc.save(); doc.rect(tableX, y, tableW, rowH).fill(stripe).restore(); }

    // vertical borders
    let vx = tableX;
    for (const c of cols) {
      doc.moveTo(vx, y).lineTo(vx, y + rowH).strokeColor("#e5e7eb").lineWidth(0.6).stroke();
      vx += c.w;
    }
    doc.moveTo(tableX + tableW, y).lineTo(tableX + tableW, y + rowH).strokeColor("#e5e7eb").lineWidth(0.6).stroke();

    // text
    let cx = tableX + 4;
    const baseY = y + padY;
    for (let i = 0; i < cols.length; i++) {
      doc.text(cellTexts[i], cx, baseY, { width: colWidths[i], align: cols[i].align, lineGap: 1 });
      cx += cols[i].w;
    }

    // bottom border
    doc.moveTo(tableX, y + rowH).lineTo(tableX + tableW, y + rowH).strokeColor("#e5e7eb").lineWidth(0.6).stroke();

    y += rowH;
  });

  // Bottom border of table
  doc.moveTo(tableX, y).lineTo(tableX + tableW, y).strokeColor("#9ca3af").lineWidth(0.8).stroke();

  // Totals card (right)
  y += 10;
  const cardW = 260;
  const cardX = margin + contentW - cardW;
  const cardPad = 12;
  const needH = 136;
  if (y + needH > pageH - margin) {
    if (doc.page.index === 0) drawFooterFirstPage(doc, baseFont, genAt);
    doc.addPage();
    y = margin;
  }

  doc.rect(cardX, y, cardW, needH).strokeColor("#9ca3af").lineWidth(0.8).stroke();
  let cy = y + cardPad;
  const row = (label: string, value: string, strong = false) => {
    doc.font((strong ? boldFont : undefined) || baseFont).fontSize(10).fillColor("#111");
    doc.text(label, cardX + cardPad, cy, { width: 120 });
    doc.text(value, cardX + cardW - cardPad - 120, cy, { width: 120, align: "right" });
    cy += 16;
  };
  row("Subtotal:", fmtINR(subtotal));
  row("Discount:", `-${fmtINR(discountTotal)}`);
  row("Tax Total:", fmtINR(taxTotal));
  row("Round Off:", fmtINR(roundoff));
  doc.moveTo(cardX + cardPad, cy - 4).lineTo(cardX + cardW - cardPad, cy - 4).strokeColor("#9ca3af").lineWidth(0.8).stroke();
  row("Grand Total:", fmtINR(final), true);

  // Notes & Terms (left)
  cy += 8;
  let notesY = Math.max(cy, y + cardPad);
  if (q.meta?.notes) {
    if (notesY + 42 > pageH - margin) {
      if (doc.page.index === 0) drawFooterFirstPage(doc, baseFont, genAt);
      doc.addPage(); notesY = margin;
    }
    doc.font((boldFont || baseFont)).fontSize(11).text("Notes:", margin, notesY);
    notesY += 16;
    doc.font(baseFont).fontSize(10).fillColor("#333")
      .text(String(q.meta.notes), margin, notesY, { width: contentW - cardW - 24, lineGap: 1 });
    notesY += doc.heightOfString(String(q.meta.notes), { width: contentW - cardW - 24, lineGap: 1 }) + 8;
    doc.fillColor("#111");
  }
  if (q.meta?.terms) {
    if (notesY + 42 > pageH - margin) {
      if (doc.page.index === 0) drawFooterFirstPage(doc, baseFont, genAt);
      doc.addPage(); notesY = margin;
    }
    doc.font((boldFont || baseFont)).fontSize(11).text("Terms & Conditions:", margin, notesY);
    notesY += 16;
    doc.font(baseFont).fontSize(10).fillColor("#333")
      .text(String(q.meta.terms), margin, notesY, { width: contentW - cardW - 24, lineGap: 1 });
    doc.fillColor("#111");
  }

  // --- Footer: ONLY on first page, once ---
  if (doc.page.index === 0) {
    drawFooterFirstPage(doc, baseFont, genAt);
  }

  // stream -> ArrayBuffer
  const chunks: Uint8Array[] = [];
  const done = new Promise<Uint8Array>((resolve, reject) => {
    doc.on("data", (d: Buffer) => chunks.push(new Uint8Array(d)));
    doc.on("end", () => {
      const size = chunks.reduce((s, c) => s + c.length, 0);
      const out = new Uint8Array(size);
      let off = 0;
      for (const c of chunks) { out.set(c, off); off += c.length; }
      resolve(out);
    });
    doc.on("error", reject);
  });
  doc.end();
  const pdf = await done;
  const ab = pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength) as ArrayBuffer;

  return new Response(ab, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="quotation-${q.quotation_number ?? q.id}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}

/** footer (first page only) */
function drawFooterFirstPage(doc: any, baseFont: string, genAt: Date) {
  const m = 36;
  const y = doc.page.height - m + 8;
  doc.font(baseFont || "Helvetica").fontSize(8).fillColor("#6b7280");
  doc.text(`Generated by AxEin Billing • Generated on ${genAt.toLocaleString("en-IN", { hour12: false })}`, m, y, {
    width: doc.page.width - m * 2,
    align: "center",
  });
  doc.fillColor("#111");
}
