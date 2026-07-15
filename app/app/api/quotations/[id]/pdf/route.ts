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
    `select qi.description, qi.qty, qi.price, qi.tax, qi.discount, qi.batch_no,
            to_char(qi.exp_date, 'YYYY-MM-DD') as exp_date,
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
      exp: it.exp_date ? String(it.exp_date) : "",
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

  // ---------- PDF (streamlined print layout) ----------
  const doc = new PDFDocument({ size: "A4", margin: 28, bufferPages: true });
  const genAt = new Date();
  doc.info.Title = `Quotation ${q.quotation_number ?? q.id}`;
  doc.info.CreationDate = genAt as any;

  const registered = tryRegisterFonts(doc);
  const baseFont = registered ?? "Helvetica";
  const boldFont = "Helvetica-Bold";

  const pageW = doc.page.width;
  const pageH = doc.page.height;
  const margin = 28;
  const footerH = 24;
  const contentW = pageW - margin * 2;
  const navy = "#173b73";
  const ink = "#111827";
  const muted = "#4b5563";
  const border = "#aab2c0";
  const grid = "#d9dee7";
  const soft = "#f5f7fb";
  const headerFill = "#eef3fb";

  const shortDate = (v?: string | null) => {
    if (!v) return "-";
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return "-";
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "2-digit" });
  };

  const safeText = (v: any, fallback = "-") => {
    const t = v === null || v === undefined ? "" : String(v).trim();
    return t || fallback;
  };

  const drawCard = (x: number, y: number, w: number, h: number, fill = "#ffffff") => {
    doc.save();
    doc.roundedRect(x, y, w, h, 3).fillAndStroke(fill, border);
    doc.restore();
  };

  const drawHeader = () => {
    const y0 = margin;
    doc.fillColor(navy).font(boldFont).fontSize(25).text("QUOTATION", margin, y0, { width: 260 });

    const metaW = 210;
    const metaX = margin + contentW - metaW;
    drawCard(metaX, y0, metaW, 86);
    doc.fillColor(ink).font(baseFont).fontSize(9.5);
    doc.text(`No: ${q.quotation_number ?? q.id}`, metaX + 10, y0 + 10, { width: metaW - 20, align: "right" });
    doc.text(`Date: ${fmtDate(q.quotation_date)}`, metaX + 10, y0 + 27, { width: metaW - 20, align: "right" });
    doc.text(`Valid Until: ${fmtDate(q.valid_until)}`, metaX + 10, y0 + 44, { width: metaW - 20, align: "right" });
    doc.text(`Generated: ${fmtDateTime(genAt)}`, metaX + 10, y0 + 61, { width: metaW - 20, align: "right" });

    const compX = margin;
    const compY = y0 + 42;
    const compW = contentW - metaW - 14;
    const companyLines: string[] = [];
    if (business.company_name) companyLines.push(String(business.company_name));
    const addrParts = [business.address_line1, business.address_line2, business.city, business.state, business.pincode]
      .filter(Boolean).map(String);
    if (addrParts.length) companyLines.push(addrParts.join(", "));
    if (business.gstin) companyLines.push(`GSTIN: ${business.gstin}`);
    if (business.phone) companyLines.push(`Phone: ${business.phone}`);
    if (business.email) companyLines.push(`Email: ${business.email}`);
    if (business.website) companyLines.push(`Website: ${business.website}`);

    const compH = Math.max(50, 12 + companyLines.length * 12);
    drawCard(compX, compY, compW, compH);
    let ly = compY + 8;
    doc.fillColor(ink).font(boldFont).fontSize(12).text(companyLines[0] || "axein.in", compX + 10, ly, { width: compW - 20 });
    ly += 15;
    doc.font(baseFont).fontSize(9).fillColor(muted);
    for (const line of companyLines.slice(1)) {
      doc.text(line, compX + 10, ly, { width: compW - 20 });
      ly += 12;
    }

    const afterCards = Math.max(compY + compH, y0 + 98);
    doc.moveTo(margin, afterCards + 8).lineTo(margin + contentW, afterCards + 8).strokeColor(navy).lineWidth(1.2).stroke();

    const billY = afterCards + 18;
    drawCard(margin, billY, contentW, 48, "#ffffff");
    doc.fillColor(ink).font(boldFont).fontSize(10).text("Bill To", margin + 10, billY + 8);
    doc.font(baseFont).fontSize(11).text(safeText(q.customer_name), margin + 10, billY + 25, { width: contentW - 20 });

    return billY + 62;
  };

  const cols = [
    { key: "desc", label: "Description", w: 166, align: "left" as const },
    { key: "cat", label: "Cat", w: 48, align: "left" as const },
    { key: "hsn", label: "HSN", w: 38, align: "left" as const },
    { key: "lot", label: "Lot", w: 36, align: "left" as const },
    { key: "exp", label: "Exp", w: 46, align: "left" as const },
    { key: "qty", label: "Qty", w: 30, align: "right" as const },
    { key: "rate", label: "Rate", w: 47, align: "right" as const },
    { key: "disc", label: "Disc", w: 34, align: "right" as const },
    { key: "gst", label: "GST", w: 32, align: "right" as const },
    { key: "amt", label: "Amount", w: 62, align: "right" as const },
  ];
  const tableX = margin;
  const tableW = cols.reduce((sum, c) => sum + c.w, 0);
  const tablePadX = 4;
  const tableFontSize = 7.8;
  const headerH = 22;

  const drawTableHeader = (y: number, continued = false) => {
    if (continued) {
      doc.fillColor(muted).font(baseFont).fontSize(8).text(`Quotation ${q.quotation_number ?? q.id} - continued`, tableX, y - 12, {
        width: tableW,
        align: "right",
      });
    }
    doc.save();
    doc.rect(tableX, y, tableW, headerH).fillAndStroke(headerFill, border);
    doc.restore();
    let x = tableX;
    doc.fillColor(ink).font(boldFont).fontSize(7.6);
    for (const c of cols) {
      doc.rect(x, y, c.w, headerH).strokeColor(border).lineWidth(0.6).stroke();
      doc.text(c.label, x + tablePadX, y + 7, { width: c.w - tablePadX * 2, align: c.align });
      x += c.w;
    }
    return y + headerH;
  };

  let y = drawHeader();
  y = drawTableHeader(y);

  const ensureSpace = (needed: number, tableContinued = false) => {
    if (y + needed > pageH - margin - footerH) {
      doc.addPage();
      y = margin + 16;
      if (tableContinued) y = drawTableHeader(y, true);
    }
  };

  const drawTableRow = (r: Row, idx: number) => {
    doc.font(baseFont).fontSize(tableFontSize).fillColor(ink);
    const cells = [
      safeText(r.desc),
      safeText(r.category),
      safeText(r.hsn),
      safeText(r.batch),
      r.exp ? shortDate(r.exp) : "-",
      r.qty.toFixed(2),
      fmtAmt(r.price),
      r.discPct.toFixed(2),
      r.gstPct.toFixed(2),
      fmtAmt(r.lineTotal),
    ];

    const textHeights = cells.map((txt, i) =>
      doc.heightOfString(txt, { width: cols[i].w - tablePadX * 2, lineGap: 1 })
    );
    const rowH = Math.max(24, Math.ceil(Math.max(...textHeights) + 12));
    ensureSpace(rowH, true);

    if (idx % 2 === 1) {
      doc.save();
      doc.rect(tableX, y, tableW, rowH).fill(soft);
      doc.restore();
    }

    let x = tableX;
    doc.font(baseFont).fontSize(tableFontSize).fillColor(ink);
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      doc.rect(x, y, c.w, rowH).strokeColor(grid).lineWidth(0.45).stroke();
      doc.text(cells[i], x + tablePadX, y + 6, {
        width: c.w - tablePadX * 2,
        align: c.align,
        lineGap: 1,
      });
      x += c.w;
    }
    y += rowH;
  };

  rows.forEach(drawTableRow);
  doc.rect(tableX, y - 0.2, tableW, 0.2).strokeColor(border).lineWidth(0.8).stroke();
  y += 12;

  const drawTotals = () => {
    const cardW = 268;
    const cardH = 116;
    ensureSpace(cardH + 10, false);
    const cardX = margin + contentW - cardW;
    drawCard(cardX, y, cardW, cardH, "#ffffff");
    let ty = y + 12;
    const totalRow = (label: string, value: string, strong = false) => {
      doc.fillColor(ink).font(strong ? boldFont : baseFont).fontSize(strong ? 10.2 : 9.2);
      doc.text(label, cardX + 12, ty, { width: 110 });
      doc.text(value, cardX + cardW - 142, ty, { width: 130, align: "right" });
      ty += strong ? 17 : 15;
    };
    totalRow("Subtotal", fmtINR(subtotal));
    totalRow("Discount", `-${fmtINR(discountTotal)}`);
    totalRow("Tax Total", fmtINR(taxTotal));
    totalRow("Round Off", fmtINR(roundoff));
    doc.moveTo(cardX + 12, ty - 4).lineTo(cardX + cardW - 12, ty - 4).strokeColor(border).lineWidth(0.8).stroke();
    totalRow("Grand Total", fmtINR(final), true);
    y += cardH + 14;
  };
  drawTotals();

  const wrapLines = (text: string, width: number, fontSize = 8.8) => {
    doc.font(baseFont).fontSize(fontSize);
    const out: string[] = [];
    const paras = String(text || "").replace(/\r/g, "").split("\n");
    for (const para of paras) {
      const words = para.trim().split(/\s+/).filter(Boolean);
      if (!words.length) {
        out.push("");
        continue;
      }
      let line = "";
      for (const word of words) {
        const next = line ? `${line} ${word}` : word;
        if (doc.widthOfString(next) <= width || !line) {
          line = next;
        } else {
          out.push(line);
          line = word;
        }
      }
      if (line) out.push(line);
    }
    return out;
  };

  const drawBoxedText = (title: string, text: string | undefined | null) => {
    const raw = String(text || "").trim();
    if (!raw) return;
    const boxX = margin;
    const boxW = contentW;
    const pad = 10;
    const titleH = 15;
    const lineH = 11;
    const lines = wrapLines(raw, boxW - pad * 2, 8.6);
    let index = 0;
    let part = 0;

    while (index < lines.length) {
      let available = pageH - margin - footerH - y;
      if (available < 70) {
        doc.addPage();
        y = margin;
        available = pageH - margin - footerH - y;
      }
      const maxLines = Math.max(1, Math.floor((available - pad * 2 - titleH) / lineH));
      const chunk = lines.slice(index, index + maxLines);
      const boxH = pad * 2 + titleH + chunk.length * lineH;

      drawCard(boxX, y, boxW, boxH, "#ffffff");
      doc.fillColor(navy).font(boldFont).fontSize(10.5)
        .text(part ? `${title} (continued)` : title, boxX + pad, y + pad, { width: boxW - pad * 2 });
      let lineY = y + pad + titleH;
      doc.fillColor(ink).font(baseFont).fontSize(8.6);
      for (const line of chunk) {
        doc.text(line, boxX + pad, lineY, { width: boxW - pad * 2, lineBreak: false });
        lineY += lineH;
      }
      y += boxH + 10;
      index += chunk.length;
      part += 1;
    }
  };

  drawBoxedText("Notes", q.meta?.notes);
  drawBoxedText("Terms & Conditions", q.meta?.terms);

  const addFooters = () => {
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const fy = pageH - 40;
      doc.moveTo(margin, fy - 6).lineTo(pageW - margin, fy - 6).strokeColor("#d1d5db").lineWidth(0.5).stroke();

      doc.fillColor(navy).font(boldFont).fontSize(8.5);
      const brand = "axein.in";
      doc.text(brand, (pageW - doc.widthOfString(brand)) / 2, fy, { lineBreak: false });

      doc.fillColor("#6b7280").font(baseFont).fontSize(7.5);
      const pageLabel = `Page ${i - range.start + 1} of ${range.count}`;
      doc.text(pageLabel, pageW - margin - doc.widthOfString(pageLabel), fy, { lineBreak: false });
    }
    doc.switchToPage(range.start + range.count - 1);
    doc.fillColor(ink);
  };
  addFooters();

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
