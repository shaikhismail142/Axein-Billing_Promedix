import { NextRequest } from 'next/server';
import { getDb } from '@/app/lib/db';
import PDFDocument from 'pdfkit';
import fs from 'node:fs';
import path from 'node:path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function inr(n: number | string | null | undefined) {
  const v = Number(n ?? 0);
  return `INR (Rs/-) ${v.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
}

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const db = await getDb();

  const inv = (
    await db.query(
      `select i.*, c.name as customer_name, c.meta as customer_meta, s.value_json as settings
         from invoices i
         left join customers c on c.id = i.customer_id
         left join settings s on s.key = 'business'
        where i.id = $1`,
      [params.id]
    )
  ).rows[0];

  if (!inv) {
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const items = (
    await db.query(
      `select * from invoice_items where invoice_id = $1 order by id asc`,
      [params.id]
    )
  ).rows;

  const doc = new PDFDocument({ size: 'A4', margin: 36 });

  // Fonts
  try {
    const fontPath = path.join(process.cwd(), 'public', 'fonts', 'Inter-Regular.ttf');
    const fontData = fs.readFileSync(fontPath);
    doc.registerFont('Body', fontData);
    doc.font('Body');
  } catch (e) {
    console.error('PDF font register failed. Ensure public/fonts/Inter-Regular.ttf exists.', e);
    return new Response('Font missing (public/fonts/Inter-Regular.ttf).', { status: 500 });
  }

  // Collect PDF bytes
  const chunks: Uint8Array[] = [];
  doc.on('data', (c: unknown) => {
    if (c instanceof Uint8Array) chunks.push(c);
    else if (typeof Buffer !== 'undefined' && c instanceof Buffer) chunks.push(new Uint8Array(c));
    else chunks.push(new Uint8Array(c as ArrayBufferLike));
  });
  const done = new Promise<Uint8Array>((resolve) => {
    doc.on('end', () => {
      const total = chunks.reduce((s, u) => s + u.byteLength, 0);
      const merged = new Uint8Array(total);
      let o = 0; for (const u of chunks) { merged.set(u, o); o += u.byteLength; }
      resolve(merged);
    });
  });

  // Header & business info
  const biz = inv.settings || {};
  const rightX = doc.page.width - doc.page.margins.right;

  // Logo (optional, max height 48)
  try {
    const logoUrl = biz.logo_url;
    if (logoUrl && typeof logoUrl === 'string' && logoUrl.trim()) {
      if (/^https?:\/\//i.test(logoUrl)) {
        // Fetch remote logo
        const res = await fetch(logoUrl);
        if (res.ok) {
          const ab = await res.arrayBuffer();
          const buf = Buffer.from(ab);
          const { height } = doc
            .image(buf, rightX - 160, 36, { fit: [160, 48], align: 'right' })
            .currentLineHeight(true);
          doc.moveDown(height ? 0.5 : 0.2);
        }
      } else {
        // Local path
        const p = logoUrl.startsWith('/') ? logoUrl : path.join(process.cwd(), logoUrl);
        if (fs.existsSync(p)) {
          const { height } = doc
            .image(p, rightX - 160, 36, { fit: [160, 48], align: 'right' })
            .currentLineHeight(true);
          doc.moveDown(height ? 0.5 : 0.2);
        }
      }
    }
  } catch {
    // Ignore logo errors to avoid breaking PDF
  }

  // Title & business block
  doc.fontSize(18).text(biz.name || 'Your Business Name', 36, 36);
  doc.fontSize(11).text(`${biz.address || ''}`, 36, doc.y + 2);
  if (biz.gstin) doc.text(`GSTIN: ${biz.gstin}`, 36);
  if (biz.phone) doc.text(`Phone: ${biz.phone}`, 36);
  doc.moveDown();

  // Invoice header (right)
  doc.fontSize(20).text('INVOICE', { align: 'right' });
  doc.fontSize(10).text(`No: ${inv.invoice_number ?? inv.id}`, { align: 'right' });
  doc.text(
    `Date: ${new Date(inv.invoice_date ?? inv.created_at ?? Date.now()).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata', hour12: true,
    })}`,
    { align: 'right' }
  );
  if (inv.due_date) {
    doc.text(`Due: ${new Date(inv.due_date).toLocaleDateString('en-IN')}`, { align: 'right' });
  }
  doc.moveDown(1);

  // Customer
  doc.fontSize(12).text('Bill To:', { underline: true });
  doc.text(inv.customer_name || 'Walk-in Customer');
  const cmeta = inv.customer_meta || {};
  if (cmeta.address) doc.text(cmeta.address);
  if (cmeta.phone) doc.text(`Phone: ${cmeta.phone}`);
  doc.moveDown(1);

  // Table header
  doc.fontSize(11).text('Items:', { underline: true });
  doc.moveDown(0.5);
  const colX = [36, 260, 330, 390, 450, 510]; // desc, qty, price, tax, disc, total
  doc.fontSize(10).text('Description', colX[0], doc.y);
  doc.text('Qty', colX[1], doc.y);
  doc.text('Price', colX[2], doc.y);
  doc.text('Tax %', colX[3], doc.y);
  doc.text('Disc', colX[4], doc.y);
  doc.text('Line Total', colX[5], doc.y);
  doc.moveDown(0.4);
  doc.moveTo(36, doc.y).lineTo(559, doc.y).stroke();

  let subtotal = 0, taxTotal = 0, discountTotal = 0, grand = 0;
  for (const it of items) {
    const qty = Number(it.qty) || 0;
    const price = Number(it.price) || 0;
    const sub = qty * price;
    const discAbs = it.discount > 0 ? (it.discount <= 100 ? sub * (it.discount / 100) : it.discount) : 0;
    const afterDisc = sub - discAbs;
    const taxAmt = afterDisc * ((Number(it.tax) || 0) / 100);
    const lineTotal = afterDisc + taxAmt;

    doc.text(String(it.description ?? ''), colX[0], doc.y);
    doc.text(qty.toFixed(2), colX[1], doc.y);
    doc.text(inr(price), colX[2], doc.y);
    doc.text((Number(it.tax) || 0).toFixed(2), colX[3], doc.y);
    doc.text(discAbs ? inr(discAbs) : '-', colX[4], doc.y);
    doc.text(inr(lineTotal), colX[5], doc.y);

    subtotal += sub;
    discountTotal += discAbs;
    taxTotal += taxAmt;
    grand += lineTotal;
    doc.moveDown(0.2);
  }

  // Totals
  doc.moveDown(0.5);
  doc.moveTo(36, doc.y).lineTo(559, doc.y).stroke();
  doc.moveDown(0.5);

  // Extra charge (from inv.meta if present)
  const meta = inv.meta || {};
  const extraLabel = meta?.extra_label || null;
  const extraAmount = Number(meta?.extra_amount || 0) || 0;
  if (extraAmount > 0) grand += extraAmount;

  doc.text(`Subtotal: ${inr(subtotal)}`, { align: 'right' });
  doc.text(`Discount: ${inr(discountTotal)}`, { align: 'right' });
  doc.text(`Tax: ${inr(taxTotal)}`, { align: 'right' });
  if (extraAmount > 0) {
    doc.text(`${String(extraLabel || 'Additional Charge')}: ${inr(extraAmount)}`, { align: 'right' });
  }
  doc.fontSize(12).text(`Total: ${inr(grand)}`, { align: 'right' });

  // Notes/Terms
  if ((meta?.notes) || (meta?.terms)) {
    doc.moveDown(1);
    doc.fontSize(11).text('Notes / Terms:', { underline: true });
    if (meta?.notes) doc.fontSize(10).text(String(meta.notes));
    if (meta?.terms) doc.fontSize(10).text(String(meta.terms));
  }

  doc.end();
  const pdfBytes = await done;

  const ab = new ArrayBuffer(pdfBytes.byteLength);
  new Uint8Array(ab).set(pdfBytes);

  return new Response(ab, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${inv.invoice_number ?? 'invoice'}.pdf"`,
      'Content-Length': String(pdfBytes.byteLength),
    },
  });
}
