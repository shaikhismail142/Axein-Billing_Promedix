import { pool } from "@/lib/db";
import PDFDocument from "pdfkit";
import fs from "node:fs";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------- Types ----------
type Sale = {
  id: number;
  invoice_no: string | null;
  invoice_date: string | null;
  subtotal: number | null;
  tax_total: number | null;
  total: number | null;
  customer_name: string | null;
  amount_paid: number;
  pending_amount?: number;
  payment_status?: string | null;
  payment_method?: string | null;
  notes: string | null;
  terms: string | null; // ⬅️ NEW: read from s.meta->>'terms'
  extra_label?: string | null;
  extra_amount?: number | null;
  patient_name?: string | null;
  doctor_name?: string | null;
  dc_no?: string | null;
};

type Item = {
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

type Biz = {
  name?: string;
  address?: string;
  phone?: string;
  gstin?: string;
  state_code?: string;
  logo_url?: string; // ⬅️ NEW
  bank_account_name?: string;
  bank_account_number?: string;
  bank_ifsc?: string;
  bank_name?: string;
  bank_branch?: string;
  bank_upi?: string;
};

// ---------- Helpers ----------
const toNum = (v: any, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

// INR with decimals (for qty/rate/amount/totals)
function inrNumber(n: number) {
  const v = toNum(n, 0);
  const parts = v.toFixed(2).split(".");
  let x = parts[0];
  const last3 = x.slice(-3);
  const other = x.slice(0, -3);
  if (other) x = other.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + last3;
  return `${x}.${parts[1]}`;
}
function inr(n: number) { return `INR (Rs/-) ${inrNumber(n)}`; }

// INR **without decimals** (for Discount column)
function inrInt(n: number) {
  const v = Math.round(toNum(n, 0));
  const s = String(Math.abs(v));
  const last3 = s.slice(-3);
  const other = s.slice(0, -3);
  const grouped = other ? other.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + last3 : last3;
  return (v < 0 ? "-" : "") + grouped;
}

// Load logo from data URL, http(s), or /public path
async function loadLogoBuffer(req: Request, url?: string | null): Promise<Buffer | null> {
  if (!url || typeof url !== "string") return null;
  const src = url.trim();
  if (!src) return null;

  try {
    // data URL
    if (src.startsWith("data:image/")) {
      const m = src.match(/^data:(.+?);base64,(.+)$/);
      if (m) return Buffer.from(m[2], "base64");
      return null;
    }

    // absolute public path: "/logo.png"
    if (src.startsWith("/")) {
      const p = path.join(process.cwd(), "public", src);
      if (fs.existsSync(p)) return fs.readFileSync(p);

      // fallback to fetching via origin if needed
      const proto = req.headers.get("x-forwarded-proto") || "http";
      const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
      if (host) {
        const abs = `${proto}://${host}${src}`;
        const res = await fetch(abs, { cache: "no-store" });
        if (res.ok) {
          const ab = await res.arrayBuffer();
          return Buffer.from(ab);
        }
      }
      return null;
    }

    // plain filename under public/
    if (!src.startsWith("http://") && !src.startsWith("https://")) {
      const p = path.join(process.cwd(), "public", src);
      if (fs.existsSync(p)) return fs.readFileSync(p);
      return null;
    }

    // http/https
    const res = await fetch(src, { cache: "no-store" });
    if (!res.ok) return null;
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
  } catch {
    return null;
  }
}

// ---------- Layout constants ----------
const MARGIN = 36;
const FOOTER_H = 28;
const HEADER_GAP = 8;
const SIG_H = 56;
const GAP_SIG_QUOTE = 10;
const QUOTE_H = 14;
const QUOTE_TEXT = "Thank you for your business! — We value your trust.";

// Typeface scale tuned for billing
const FS_TITLE = 15;
const FS_BASE = 10;
const FS_SMALL = 9;

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isFinite(id)) {
    return new Response(JSON.stringify({ error: "Invalid id" }), { status: 400 });
  }

  // ---- Sale & items ----
  const saleRs = await pool.query(
    `SELECT s.id, s.invoice_no, s.invoice_date, s.subtotal, s.tax_total, s.total,
            COALESCE(s.amount_paid, (s.meta->>'amount_paid')::numeric, 0) AS amount_paid,
            COALESCE(s.pending_amount,
                     GREATEST(s.total - COALESCE(s.amount_paid, (s.meta->>'amount_paid')::numeric, 0), 0)) AS pending_amount,
            COALESCE(NULLIF(s.payment_status,''), (s.meta->>'payment_status')) AS payment_status,
            COALESCE(NULLIF(s.payment_method,''), (s.meta->>'payment_method')) AS payment_method,
            (s.meta->>'notes') AS notes,
            (s.meta->>'terms') AS terms,
            (s.meta->>'extra_label') AS extra_label,
            COALESCE((s.meta->>'extra_amount')::numeric, 0) AS extra_amount,
            (s.meta->>'patient_name') AS patient_name,
            (s.meta->>'doctor_name')  AS doctor_name,
            (s.meta->>'dc_no')        AS dc_no,
            c.name AS customer_name
       FROM sales s
       LEFT JOIN customers c ON c.id = s.customer_id
      WHERE s.id=$1`,
    [id]
  );
  if (saleRs.rowCount === 0) return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
  const sale = saleRs.rows[0] as Sale;

  const items = (
    await pool.query(
      `SELECT si.name, si.qty, si.unit_price, si.discount_pct, si.gst_slab, si.taxable, si.tax, si.total,
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
    )
  ).rows as Item[];

  // ---- Business settings ----
  const bizRs = await pool.query(`SELECT value_json FROM settings WHERE key='business' LIMIT 1`);
  const biz: Biz = (bizRs.rows?.[0]?.value_json ?? {}) as Biz;

  // ---- Invoice defaults (for notes/terms fallback) ----
  const defRs = await pool.query(`SELECT value_json FROM settings WHERE key='invoice_defaults' LIMIT 1`);
  const invDefaults = (defRs.rows?.[0]?.value_json ?? {}) as {
    notes_default?: string;
    terms_default?: string;
  };

  const notesText =
    (sale.notes && sale.notes.trim()) ||
    (invDefaults.notes_default && invDefaults.notes_default.trim()) ||
    null;

  const termsText =
    (sale.terms && sale.terms.trim()) ||
    (invDefaults.terms_default && invDefaults.terms_default.trim()) ||
    null;

  const amountPaid = toNum(sale.amount_paid, 0);
  const balance = toNum(
    sale.pending_amount ?? Math.max(0, toNum(sale.total, 0) - amountPaid),
    Math.max(0, toNum(sale.total, 0) - amountPaid)
  );

  // ---- PDF setup ----
  const doc = new PDFDocument({ size: "A4", margin: MARGIN, bufferPages: true });
  doc.info.Title = `Invoice ${sale.invoice_no ?? sale.id}`;

  try {
    // Prefer DejaVu if present (covers symbols), fallback to Helvetica
    // @ts-ignore - path is present in most Linux containers
    doc.registerFont("DejaVu", "/usr/share/fonts/dejavu/DejaVuSans.ttf");
    doc.font("DejaVu");
  } catch { doc.font("Helvetica"); }

  const pageW = doc.page.width;
  const pageH = doc.page.height;
  const contentW = pageW - MARGIN * 2;

  // Preload logo (so header can use it)
  const logoBuf = await loadLogoBuffer(req, biz.logo_url);

  // ---------- Header with reliable separator & logo ----------
  const renderPageHeader = () => {
    const leftW = Math.floor(contentW * 0.60);
    const rightW = contentW - leftW;

    // Draw logo (non-distorting). Keep height 40, width auto.
    const startY = doc.y;
    if (logoBuf) {
      try {
        doc.image(logoBuf, MARGIN, startY, { height: 40 });
        doc.y = startY + 44; // push content below logo
      } catch {
        // ignore image failures and continue
      }
    }

    const topY = doc.y;

    // Left: shop
    doc.font("Helvetica-Bold").fontSize(FS_TITLE)
      .text((biz.name || "").trim() || "Your Business Name", { width: leftW, lineBreak: false });
    doc.moveDown(0.1);

    doc.font("Helvetica").fontSize(FS_SMALL).fillColor("#444");
    if ((biz.address || "").trim()) doc.text((biz.address || "").trim(), { width: leftW });

    const idBits: string[] = [];
    if ((biz.gstin || "").trim()) idBits.push(`GSTIN: ${(biz.gstin || "").trim()}`);
    if ((biz.state_code || "").trim()) idBits.push(`State Code: ${(biz.state_code || "").trim()}`);
    if (idBits.length) doc.text(idBits.join("  •  "), { width: leftW });

    if ((biz.phone || "").trim()) doc.text(`Phone: ${(biz.phone || "").trim()}`, { width: leftW });

    const leftBottom = doc.y;

    // Right: invoice meta (top aligned to header block)
    doc.fillColor("#000");
    doc.font("Helvetica-Bold").fontSize(FS_BASE + 1.2);
    doc.text(`Invoice: ${sale.invoice_no ?? sale.id}`, MARGIN + leftW, topY, {
      width: rightW, align: "right", lineBreak: false,
    });
    doc.font("Helvetica").fontSize(FS_BASE).fillColor("#444");
    doc.text(`Customer: ${sale.customer_name ?? "-"}`, MARGIN + leftW, undefined, {
      width: rightW, align: "right", lineBreak: false,
    });
    if (sale.dc_no) {
      doc.text(`DC No: ${sale.dc_no}`, MARGIN + leftW, undefined, {
        width: rightW, align: "right", lineBreak: false,
      });
    }
    doc.text(
      `Date: ${new Date(sale.invoice_date ?? Date.now()).toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata", hour12: true,
        day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit",
      })}`,
      MARGIN + leftW,
      undefined,
      { width: rightW, align: "right", lineBreak: false }
    );
    if (sale.patient_name) {
      doc.text(`Patient: ${sale.patient_name}`, MARGIN + leftW, undefined, {
        width: rightW, align: "right", lineBreak: false,
      });
    }
    if (sale.doctor_name) {
      doc.text(`Doctor: ${sale.doctor_name}`, MARGIN + leftW, undefined, {
        width: rightW, align: "right", lineBreak: false,
      });
    }

    // Ensure separator is **below** the taller block (text or logo)
    const approxLineH = 13.5; // baseline height heuristic
    const rightLines =
      3 +
      (sale.dc_no ? 1 : 0) +
      (sale.patient_name ? 1 : 0) +
      (sale.doctor_name ? 1 : 0);
    const rightBottom = topY + approxLineH * rightLines + 2;
    const sepY = Math.max(leftBottom, rightBottom) + 8;

    doc.strokeColor("#d1d5db").lineWidth(0.8).moveTo(MARGIN, sepY).lineTo(MARGIN + contentW, sepY).stroke();
    doc.y = sepY + 10; // clean gap before table
    doc.fillColor("#000");
  };
  renderPageHeader();

  // Balance due is shown in totals box below; keep header clean.
  doc.moveDown(0.6);

  // ---------- Table (full width; centered cells; equal numeric widths) ----------
  const tableX = MARGIN;
  const tableW = contentW;
  let y = doc.y + HEADER_GAP;

  // Column plan (fixed widths to fit healthcare metadata)
  const colDescW   = 140;
  const colCatW    = 45;
  const colHsnW    = 45;
  const colLotW    = 45;
  const colExpW    = 45;
  const colQtyW    = 35;
  const colRateW   = 45;
  const colGstW    = 35;
  const colDiscW   = 35;
  const colAmountW = tableW - (
    colDescW + colCatW + colHsnW + colLotW + colExpW +
    colQtyW + colRateW + colGstW + colDiscW
  ); // exact fit

  const headerH = 26;

  const drawTableHeader = () => {
    doc.save();
    doc.roundedRect(tableX, y, tableW, headerH, 6).fill("#f3f4f6").restore();
    doc.strokeColor("#d1d5db").lineWidth(0.6).roundedRect(tableX, y, tableW, headerH, 6).stroke();

    doc.font("Helvetica-Bold").fontSize(FS_BASE);
    let cx = tableX;
    const put = (label: string, w: number) => {
      doc.text(label, cx, y + 7, { width: w, align: "center", lineBreak: false });
      cx += w;
    };
    put("Description", colDescW);
    put("Category",    colCatW);
    put("HSN",         colHsnW);
    put("Lot",         colLotW);
    put("Exp",         colExpW);
    put("Qty",         colQtyW);
    put("Rate",        colRateW);
    put("GST%",        colGstW);
    put("Disc",        colDiscW);
    put("Amount",      colAmountW);

    // verticals
    cx = tableX;
    doc.strokeColor("#e5e7eb").lineWidth(0.5);
    [colDescW, colCatW, colHsnW, colLotW, colExpW, colQtyW, colRateW, colGstW, colDiscW, colAmountW].forEach(w => {
      doc.moveTo(cx, y).lineTo(cx, y + headerH).stroke();
      cx += w;
    });
    doc.moveTo(tableX + tableW, y).lineTo(tableX + tableW, y + headerH).stroke();

    y += headerH;
    doc.font("Helvetica").fontSize(FS_SMALL);
  };
  drawTableHeader();

  const rowPadY = 6;
  const stripe = "#fbfbfb";

  // Reserve bottom only for signature + quote + footer (totals live just under table)
  const RESERVED_BOTTOM = SIG_H + GAP_SIG_QUOTE + QUOTE_H + FOOTER_H + 26;
  const usableBottomForTable = () => pageH - MARGIN - RESERVED_BOTTOM;

  const ensurePage = (needed: number) => {
    if (y + needed > usableBottomForTable()) {
      doc.addPage();
      renderPageHeader();
      y = doc.y + HEADER_GAP;
      drawTableHeader();
    }
  };

  items.forEach((it, i) => {
    const qty = toNum(it.qty, 0);
    const rate = toNum(it.unit_price, 0);
    const gstPct = Math.max(0, Math.round(toNum(it.gst_slab, 0))); // integer %
    const discPct = Math.max(0, toNum(it.discount_pct, 0));
    const gross = qty * rate;
    const discAbsRounded = Math.round(gross * (discPct / 100));    // whole ₹ for display
    const lineAmount = toNum(it.total ?? gross - discAbsRounded + (it.tax ?? 0), 0);

    const desc = (it.name ?? "").toString().trim() || "-";
    const category = (it.category ?? "").toString().trim() || "-";
    const hsn = (it.hsn_code ?? "").toString().trim() || "-";
    const lot = (it.batch_no ?? "").toString().trim() || "-";
    const exp = (it.exp_date ?? "").toString().trim() || "-";

    const colTexts = [
      { text: desc, width: colDescW - 14, align: "left" as const },
      { text: category, width: colCatW - 8, align: "left" as const },
      { text: hsn, width: colHsnW - 8, align: "left" as const },
      { text: lot, width: colLotW - 8, align: "left" as const },
      { text: exp, width: colExpW - 8, align: "left" as const },
      { text: inrNumber(qty), width: colQtyW, align: "center" as const },
      { text: inrNumber(rate), width: colRateW, align: "center" as const },
      { text: String(gstPct), width: colGstW, align: "center" as const },
      { text: discAbsRounded ? inrInt(discAbsRounded) : "-", width: colDiscW, align: "center" as const },
      { text: inrNumber(lineAmount), width: colAmountW, align: "center" as const },
    ];

    let textH = 0;
    for (const ct of colTexts) {
      const h = doc.heightOfString(ct.text, { width: ct.width, align: ct.align as any });
      textH = Math.max(textH, h);
    }
    const rowH = Math.max(20, textH + rowPadY * 2);

    ensurePage(rowH + 1);

    if (i % 2 === 1) doc.save().rect(tableX, y, tableW, rowH).fill(stripe).restore();

    doc.strokeColor("#e5e7eb").lineWidth(0.5).moveTo(tableX, y).lineTo(tableX + tableW, y).stroke();

    let cx = tableX;
    const baseY = y + rowPadY;

    // description (left-align is more readable)
    doc.fillColor("#111").text(desc, cx + 7, baseY, { width: colDescW - 14, align: "left" });
    cx += colDescW;

    const leftCell = (val: string, w: number) =>
      doc.text(val, cx + 4, baseY, { width: w - 8, align: "left", lineBreak: false });
    const centerCell = (val: string, w: number) =>
      doc.text(val, cx, baseY, { width: w, align: "center", lineBreak: false });

    leftCell(category, colCatW); cx += colCatW;
    leftCell(hsn, colHsnW);      cx += colHsnW;
    leftCell(lot, colLotW);      cx += colLotW;
    leftCell(exp, colExpW);      cx += colExpW;

    centerCell(inrNumber(qty),  colQtyW);    cx += colQtyW;
    centerCell(inrNumber(rate), colRateW);   cx += colRateW;
    centerCell(String(gstPct),  colGstW);    cx += colGstW;
    centerCell(discAbsRounded ? inrInt(discAbsRounded) : "-", colDiscW); cx += colDiscW;
    centerCell(inrNumber(lineAmount), colAmountW);

    // verticals
    cx = tableX;
    doc.strokeColor("#eef2f7").lineWidth(0.5);
    [colDescW, colCatW, colHsnW, colLotW, colExpW, colQtyW, colRateW, colGstW, colDiscW, colAmountW].forEach(w => {
      doc.moveTo(cx, y).lineTo(cx, y + rowH).stroke();
      cx += w;
    });
    doc.moveTo(tableX + tableW, y).lineTo(tableX + tableW, y + rowH).stroke();

    y += rowH;
  });

  // table bottom border
  doc.strokeColor("#d1d5db").lineWidth(0.6).moveTo(tableX, y).lineTo(tableX + tableW, y).stroke();

  // ---------- Totals (right-aligned under table) ----------
  const taxable = toNum(sale.subtotal, 0);
  const taxTotal = toNum(sale.tax_total, 0);
  const grand = toNum(sale.total, 0);
  const extraAmount = toNum((sale as any).extra_amount, 0);
  const extraLabel = ((sale as any).extra_label || "").toString().trim() || "Additional Charge";

  // (amountPaid / balance already computed above)

  const cardW = 330;
  const cardX = tableX + tableW - cardW;
  const cardPad = 12;

  // dynamic height (Taxable+Tax+Grand+Paid+Balance+Method + note)
  const rowsCount =
    3 + // taxable, tax, grand
    (extraAmount > 0 ? 1 : 0) +
    2 + // paid, balance
    (sale.payment_method ? 1 : 0);
  const cardH = rowsCount * 18 + 24 + 18;

  let cy = y + 14;
  if (cy + cardH > pageH - MARGIN - (SIG_H + GAP_SIG_QUOTE + QUOTE_H + FOOTER_H + 26)) {
    doc.addPage();
    renderPageHeader();
    cy = doc.y + HEADER_GAP + 8;
  }

  doc.roundedRect(cardX, cy, cardW, cardH, 10).strokeColor("#d1d5db").lineWidth(0.8).stroke();

  const totalRow = (label: string, val: string, strong = false, color?: string) => {
    cy += 12;
    if (strong) doc.font("Helvetica-Bold").fontSize(FS_BASE + 0.2);
    else doc.font("Helvetica").fontSize(FS_BASE);
    doc.fillColor(color || "#111");
    doc.text(label, cardX + cardPad, cy, { width: 140, align: "left", lineBreak: false });
    doc.text(val,   cardX + cardW - cardPad - 140, cy, { width: 140, align: "right", lineBreak: false });
    cy += 4;
  };

  totalRow("Taxable",    inr(taxable));
  totalRow("Tax",        inr(taxTotal));
  if (extraAmount > 0) {
    totalRow(extraLabel, inr(extraAmount));
  }
  doc.strokeColor("#d1d5db").moveTo(cardX + cardPad, cy + 6).lineTo(cardX + cardW - cardPad, cy + 6).stroke();
  cy += 8;
  totalRow("Grand Total", inr(grand), true);
  totalRow("Amount Paid", inr(amountPaid));
  totalRow("Balance Due", inr(balance), true, balance === 0 ? "#065f46" : "#111");
  if (sale.payment_method) {
    totalRow("Method", String(sale.payment_method || ""));
  }

  cy += 6;
  doc.font("Helvetica").fontSize(FS_SMALL).fillColor("#6b7280")
     .text("All amounts are in INR (Rs/-).", cardX + cardPad, cy, {
       width: cardW - cardPad * 2, align: "right", lineBreak: false
     });
  doc.fillColor("#000");

  let contentBottom = cy + 16;

  // Bank details (optional)
  const bankLines: string[] = [];
  if (biz.bank_name) bankLines.push(`Bank: ${biz.bank_name}`);
  if (biz.bank_branch) bankLines.push(`Branch: ${biz.bank_branch}`);
  if (biz.bank_account_name) bankLines.push(`A/C Name: ${biz.bank_account_name}`);
  if (biz.bank_account_number) bankLines.push(`A/C No: ${biz.bank_account_number}`);
  if (biz.bank_ifsc) bankLines.push(`IFSC: ${biz.bank_ifsc}`);
  if (biz.bank_upi) bankLines.push(`UPI: ${biz.bank_upi}`);

  if (bankLines.length) {
    const bankTop = contentBottom + 8;
    const bankBlockH = bankLines.length * 14 + 22;
    if (bankTop + bankBlockH > pageH - MARGIN - (SIG_H + GAP_SIG_QUOTE + QUOTE_H + FOOTER_H + 24)) {
      doc.addPage();
      renderPageHeader();
      contentBottom = doc.y + HEADER_GAP;
    }
    const boxW = contentW;
    doc.roundedRect(MARGIN, bankTop, boxW, bankBlockH, 10).strokeColor("#d1d5db").lineWidth(0.8).stroke();
    doc.font("Helvetica-Bold").fontSize(FS_BASE).fillColor("#111").text("Bank Details", MARGIN + 12, bankTop + 8);
    doc.font("Helvetica").fontSize(FS_BASE).fillColor("#333");
    let by = bankTop + 26;
    for (const line of bankLines) {
      doc.text(line, MARGIN + 12, by, { width: boxW - 24 });
      by += 14;
    }
    doc.fillColor("#000");
    contentBottom = bankTop + bankBlockH;
  }

  // Optional Notes
  if (notesText) {
    const notesTop = contentBottom + 10;
    if (notesTop + 50 > pageH - MARGIN - (SIG_H + GAP_SIG_QUOTE + QUOTE_H + FOOTER_H + 24)) {
      doc.addPage();
      renderPageHeader();
      contentBottom = doc.y + HEADER_GAP;
    }
    doc.font("Helvetica-Bold").fontSize(FS_BASE).text("Notes", MARGIN, notesTop);
    doc.font("Helvetica").fillColor("#333").fontSize(FS_BASE)
      .text(String(notesText), MARGIN, doc.y + 6, { width: contentW });
    doc.fillColor("#000");
    contentBottom = doc.y;
  }

  // NEW: Terms & Conditions (with fallback to settings)
  if (termsText) {
    const termsTop = contentBottom + 10;
    if (termsTop + 50 > pageH - MARGIN - (SIG_H + GAP_SIG_QUOTE + QUOTE_H + FOOTER_H + 24)) {
      doc.addPage();
      renderPageHeader();
      contentBottom = doc.y + HEADER_GAP;
    }
    doc.font("Helvetica-Bold").fontSize(FS_BASE).text("Terms & Conditions", MARGIN, termsTop);
    doc.font("Helvetica").fillColor("#333").fontSize(FS_BASE)
      .text(String(termsText), MARGIN, doc.y + 6, { width: contentW });
    doc.fillColor("#000");
    contentBottom = doc.y;
  }

  // ---------- Signature + Quote pinned to bottom ----------
  const bottomY = doc.page.height - MARGIN - FOOTER_H;
  const finalQuoteY = bottomY - QUOTE_H;
  const finalSigY = finalQuoteY - GAP_SIG_QUOTE - SIG_H;

  if (contentBottom > finalSigY - 10) {
    doc.addPage();
    renderPageHeader();
  }
  const sigX = MARGIN;
  const sigW = contentW;

  doc.roundedRect(sigX, finalSigY, sigW, SIG_H, 10).strokeColor("#d1d5db").lineWidth(0.8).stroke();
  doc.font("Helvetica").fontSize(FS_BASE).fillColor("#6b7280")
     .text("Authorised Signatory", sigX + 12, finalSigY + 10, {
       width: sigW - 24, align: "left", lineBreak: false
     });
  doc.strokeColor("#9ca3af").moveTo(sigX + 24, finalSigY + SIG_H - 22).lineTo(sigX + sigW / 2, finalSigY + SIG_H - 22).stroke();
  doc.fillColor("#000");

  doc.font("Helvetica-Oblique").fontSize(FS_SMALL).fillColor("#6b7280")
     .text(QUOTE_TEXT, MARGIN, finalQuoteY, { width: contentW, align: "center", lineBreak: false });
  doc.fillColor("#000");

  // ---------- Footer (Page X of Y) ----------
  const { start, count } = doc.bufferedPageRange();
  for (let i = start; i < start + count; i++) {
    doc.switchToPage(i);
    const py = doc.page.height - MARGIN - 12;
    doc.font("Helvetica").fontSize(8).fillColor("#6b7280");
    doc.text(
      `Generated by AxEin Billing • ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour12: true })}`,
      MARGIN, py, { width: pageW - MARGIN * 2, align: "left", lineBreak: false }
    );
    doc.text(`Page ${i - start + 1} of ${count}`, MARGIN, py, {
      width: pageW - MARGIN * 2, align: "right", lineBreak: false,
    });
    doc.fillColor("#000");
  }

  // ---- stream to Response ----
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
      "Content-Disposition": `inline; filename="invoice-${sale.invoice_no ?? sale.id}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
