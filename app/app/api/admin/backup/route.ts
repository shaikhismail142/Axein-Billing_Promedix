import { NextRequest } from 'next/server';
import { getDb } from '@/app/lib/db';
import { isAdmin } from '@/app/lib/auth';

import PDFDocument from 'pdfkit';
import { stringify as csvStringify } from 'csv-stringify';
import fs from 'node:fs';
import path from 'node:path';
import archiver from 'archiver';
import { PassThrough } from 'node:stream';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const LOG_PATH =
  process.env.AXEIN_LOG_FILE ||
  path.join(process.env.AXEIN_LOG_DIR || '/var/log/axein', 'backup.log');

function logLine(line: string) {
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    fs.appendFileSync(LOG_PATH, `[${new Date().toISOString()}] ${line}\n`);
  } catch {}
}

function istStamp(d = new Date()) {
  const tz = 'Asia/Kolkata';
  const s = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(d).reduce((acc, p) => ((acc as any)[p.type] = p.value, acc), {} as any);
  return `${s.year}${s.month}${s.day}_${s.hour}${s.minute}${s.second}`;
}

type PgLike = { query: (text: string, params?: any[]) => Promise<{ rows: any[] }> };

async function tableToCsv(pool: PgLike, sql: string): Promise<Buffer> {
  const { rows } = await pool.query(sql);
  return new Promise((resolve, reject) => {
    let text = '';
    const csv = csvStringify({ header: true });
    csv.on('data', (chunk) => {
      text += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    });
    csv.on('end', () => resolve(Buffer.from(text, 'utf8')));
    csv.on('error', reject);
    for (const r of rows) csv.write(r);
    csv.end();
  });
}

async function makeInvoicePdf(pool: PgLike, saleId: string): Promise<Buffer> {
  const { rows: saleRows } = await pool.query(
    `SELECT s.id, s.created_at, s.invoice_date, s.meta, s.customer_id,
            COALESCE(c.name,'Walk-in Customer') AS customer_name,
            COALESCE(c.phone,'') AS customer_phone
     FROM sales s
     LEFT JOIN customers c ON c.id = s.customer_id
     WHERE s.id = $1`,
    [saleId]
  );
  if (!saleRows.length) throw new Error('sale not found');

  const { rows: itemRows } = await pool.query(
    `SELECT si.*, COALESCE(p.name, '') AS product_name
     FROM sale_items si
     LEFT JOIN products p ON p.id = si.product_id
     WHERE si.sale_id = $1
     ORDER BY si.id`,
    [saleId]
  );

  return await new Promise<Buffer>((resolve) => {
    const doc = new PDFDocument({ size: 'A4', margin: 36 });
    const parts: Uint8Array[] = [];
    doc.on('data', (c: Uint8Array) => parts.push(c));
    doc.on('end', () => {
      let total = 0; for (const p of parts) total += p.length;
      const merged = new Uint8Array(total);
      let off = 0; for (const p of parts) { merged.set(p, off); off += p.length; }
      resolve(Buffer.from(merged));
    });

    const sale = saleRows[0];
    // Simple invoice layout
    doc.fontSize(18).text('AxEin Invoice', { align: 'right' });
    doc.moveDown(0.5);
    doc.fontSize(10).text(`Invoice ID: ${sale.id}`, { align: 'right' });
    doc.text(`Invoice Date: ${sale.invoice_date ?? sale.created_at}`, { align: 'right' });
    doc.moveDown(1).fontSize(12).text('Bill To:', { underline: true });
    doc.fontSize(10).text(sale.customer_name);
    if (sale.customer_phone) doc.text(sale.customer_phone);

    doc.moveDown(1).fontSize(12).text('Items', { underline: true });
    const startX = 36, col = [startX, startX+230, startX+320, startX+390, startX+470];
    doc.moveDown(0.5).fontSize(10)
      .text('Product', col[0], doc.y, { width: 230 })
      .text('Qty',   col[1], doc.y, { width: 60 })
      .text('Price', col[2], doc.y, { width: 60 })
      .text('Tax',   col[3], doc.y, { width: 60 })
      .text('Total', col[4], doc.y, { width: 80 });
    doc.moveDown(0.2).moveTo(startX, doc.y).lineTo(559, doc.y).stroke();

    let grand = 0;
    for (const it of itemRows) {
      const qty   = Number(it.quantity ?? it.qty ?? 1);
      const price = Number(it.price ?? it.unit_price ?? 0);
      const tax   = Number(it.tax ?? 0);
      const total = Number(it.total ?? (qty * price + tax));
      grand += total;

      doc.moveDown(0.15);
      doc.text(String(it.product_name ?? ''), col[0], doc.y, { width: 230 });
      doc.text(qty.toString(), col[1], doc.y, { width: 60 });
      doc.text(price.toFixed(2), col[2], doc.y, { width: 60 });
      doc.text(tax.toFixed(2),   col[3], doc.y, { width: 60 });
      doc.text(total.toFixed(2), col[4], doc.y, { width: 80 });
    }
    doc.moveDown(0.5).moveTo(startX, doc.y).lineTo(559, doc.y).stroke();
    doc.moveDown(0.3).fontSize(12).text(`Grand Total: ₹ ${grand.toFixed(2)}`, { align: 'right' });
    doc.end();
  });
}

async function tableExists(pool: PgLike, table: string): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT to_regclass($1) AS reg`,
    [`public.${table}`]
  );
  return !!rows?.[0]?.reg;
}

export async function POST(req: NextRequest) {
  try {
    if (!(await isAdmin(req))) return new Response('Forbidden', { status: 403 });

    const pool: PgLike = getDb();

    // 1) Create a zip archive in-memory
    const archive = archiver('zip', { zlib: { level: 9 } });
    const stream = new PassThrough();
    const chunks: Buffer[] = [];
    stream.on('data', (c) => chunks.push(Buffer.from(c)));
    const done = new Promise<void>((resolve, reject) => {
      stream.on('end', resolve);
      stream.on('error', reject);
      archive.on('error', reject);
    });
    archive.pipe(stream);

    // 2) Add manifest
    const startedAt = new Date().toISOString();
    const manifest = Buffer.from(JSON.stringify({
      name: 'AxEin Full Backup',
      version: 2,
      started_at: startedAt,
      app_tz: 'Asia/Kolkata',
      format: 'zip',
      includes: ['db csv', 'invoice pdfs'],
    }, null, 2));
    archive.append(manifest, { name: 'manifest.json' });

    // 3) DB CSVs (only if tables exist)
    const tables = [
      'customers',
      'categories',
      'products',
      'suppliers',
      'purchases',
      'purchase_items',
      'quotations',
      'quotation_items',
      'sales',
      'sale_items',
      'product_batches',
      'stock_movements',
      'inventory_adjustments',
      'inventory_adjustment_items',
      'notifications',
    ];

    for (const table of tables) {
      if (!(await tableExists(pool, table))) continue;
      try {
        const csv = await tableToCsv(pool, `SELECT * FROM ${table}`);
        archive.append(csv, { name: `db/${table}.csv` });
      } catch (e: any) {
        logLine(`backup: table ${table} failed (${e?.message || e})`);
      }
    }

    const { rows: settings } = await pool.query('SELECT key, value_json FROM settings ORDER BY key');
    const settingsBuf = Buffer.from(JSON.stringify(settings, null, 2));
    archive.append(settingsBuf, { name: 'db/settings.json' });

    // 4) Invoice PDFs (best effort)
    const { rows: saleIds } = await pool.query('SELECT id FROM sales ORDER BY id');
    for (const r of saleIds as Array<{ id: string }>) {
      try {
        const pdf = await makeInvoicePdf(pool, r.id);
        archive.append(pdf, { name: `invoices/${r.id}.pdf` });
      } catch (e: any) {
        logLine(`invoice ${r.id} pdf fail: ${e.message}`);
      }
    }

    // 5) Finalize & wait
    await archive.finalize();
    await done;

    const total = chunks.reduce((s, c) => s + c.length, 0);
    const zipBytes = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      zipBytes.set(c, off);
      off += c.length;
    }
    const filename = `axein-backup-${istStamp()}.zip`;

    return new Response(zipBytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Length': String(zipBytes.byteLength),
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e: any) {
    logLine(`backup failed: ${e.message}`);
    return new Response('Backup failed', { status: 500 });
  }
}
