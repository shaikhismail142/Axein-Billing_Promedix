// app/api/admin/restore/route.ts
import { NextRequest } from 'next/server';
import { isAdmin } from '@/app/lib/auth';
import { getDb } from '@/app/lib/db';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import * as csvSync from 'csv-parse/sync';
import JSZip from 'jszip';

// TAR reader
// eslint-disable-next-line @typescript-eslint/no-var-requires
const tar = require('tar-stream');

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

type PgLike = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[] }>;
  connect?: () => Promise<{
    query: (text: string, params?: any[]) => Promise<{ rows: any[] }>;
    release: () => void;
  }>;
};

type PgClient = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[] }>;
};

// ---------------- tar + bytes utilities ----------------

function mapTarError(e: unknown): string {
  const msg = (e as any)?.message?.toString?.() || '';
  if (/Unexpected end of data|short read|unexpected EOF/i.test(msg)) return 'Archive appears truncated';
  if (/invalid|corrupt|unexpected/i.test(msg)) return 'Invalid or unsupported archive';
  return 'Archive read error';
}

function sniffFormat(u8: Uint8Array): 'zip' | 'gz' | 'tar_or_unknown' {
  if (u8.byteLength >= 4 && u8[0] === 0x50 && u8[1] === 0x4B && u8[2] === 0x03 && u8[3] === 0x04) return 'zip'; // PK..
  if (u8.byteLength >= 2 && u8[0] === 0x1F && u8[1] === 0x8B) return 'gz'; // 1F 8B
  return 'tar_or_unknown';
}

async function readTarIntoMap(buffer: Uint8Array): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    const extract = tar.extract();
    const out = new Map<string, Buffer>();

    extract.on('entry', (header: any, stream: any, next: any) => {
      const chunks: Uint8Array[] = [];
      stream.on('data', (c: any) => {
        const u8 = (c && typeof c.length === 'number')
          ? Uint8Array.from(c as ArrayLike<number>)
          : new Uint8Array(0);
        chunks.push(u8);
      });
      stream.on('end', () => {
        if (header && header.name && header.type === 'file') {
          let total = 0;
          for (const ch of chunks) total += ch.byteLength;
          const mergedU8 = new Uint8Array(total);
          let off = 0;
          for (const ch of chunks) { mergedU8.set(ch, off); off += ch.byteLength; }
          out.set(header.name, Buffer.from(mergedU8));
        }
        next();
      });
      stream.on('error', reject);
    });

    extract.on('finish', () => resolve(out));
    extract.on('error', reject);

    extract.end(Buffer.from(buffer)); // feed one Buffer (prevents EOF issues)
  });
}

async function readZipIntoMap(buffer: Uint8Array): Promise<Map<string, Buffer>> {
  const out = new Map<string, Buffer>();
  const zip = await JSZip.loadAsync(buffer);
  const entries = Object.values(zip.files);
  await Promise.all(
    entries.map(async (f) => {
      if (f.dir) return;
      const content = await f.async('nodebuffer');
      out.set(f.name, content as Buffer);
    })
  );
  return out;
}

function normalizeTarBytes(u8: Uint8Array): Uint8Array {
  const rem = u8.byteLength % 512;
  if (rem !== 0) {
    const pad = 512 - rem;
    const padded = new Uint8Array(u8.byteLength + pad);
    padded.set(u8);
    u8 = padded;
    logLine(`restore: padded to 512-byte boundary (+${pad})`);
  }

  const needEOA = u8.byteLength < 1024 || !isAllZero(u8.subarray(u8.byteLength - 1024));
  if (needEOA) {
    const appended = new Uint8Array(u8.byteLength + 1024);
    appended.set(u8);
    u8 = appended;
    logLine('restore: appended end-of-archive zeros (+1024)');
  }
  return u8;
}

function isAllZero(view: Uint8Array): boolean {
  for (let i = 0; i < view.length; i++) if (view[i] !== 0) return false;
  return true;
}

// ---------------- data normalization helpers ----------------

function toNum(x: any) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function toDateVal(x: any): Date | null {
  if (x == null || x === '') return null;
  if (x instanceof Date) return isNaN(x.getTime()) ? null : x;
  const n = Number(x);
  if (Number.isFinite(n)) {
    if (n > 1e12) return new Date(n);        // epoch ms
    if (n > 1e9)  return new Date(n * 1000); // epoch sec
  }
  const d = new Date(String(x));
  return isNaN(d.getTime()) ? null : d;
}

function parseMetaMaybe(v: any): Record<string, any> {
  if (!v) return {};
  if (typeof v === 'object') return v;
  try { return JSON.parse(String(v)); } catch { return {}; }
}

function mergeMeta(base: Record<string, any>, extra: Record<string, any>): Record<string, any> {
  return { ...(base || {}), ...(extra || {}) };
}

function isBlank(x: any): boolean {
  return x === null || x === undefined || (typeof x === 'string' && x.trim() === '');
}

// ---------------- schema introspection + sanitization ----------------

type ColInfo = { data_type: string; udt_name: string; is_nullable: 'YES' | 'NO' };

async function getColumnInfoMap(client: PgClient, table: string): Promise<Map<string, ColInfo>> {
  const { rows } = await client.query(
    `SELECT column_name, data_type, udt_name, is_nullable
       FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1`,
    [table]
  );
  const m = new Map<string, ColInfo>();
  for (const r of rows || []) {
    m.set(String(r.column_name), {
      data_type: String(r.data_type),
      udt_name: String(r.udt_name),
      is_nullable: (String(r.is_nullable).toUpperCase() === 'YES' ? 'YES' : 'NO'),
    });
  }
  return m;
}

function isNumericType(ci?: ColInfo): boolean {
  if (!ci) return false;
  const t = ci.data_type.toLowerCase();
  return ['integer','bigint','smallint','numeric','real','double precision','decimal'].includes(t);
}
function isBooleanType(ci?: ColInfo): boolean {
  return !!ci && ci.data_type.toLowerCase() === 'boolean';
}
function isDateType(ci?: ColInfo): boolean {
  if (!ci) return false;
  const t = ci.data_type.toLowerCase();
  return t.includes('timestamp') || t === 'date';
}
function isJsonType(ci?: ColInfo): boolean {
  if (!ci) return false;
  const t = ci.data_type.toLowerCase();
  return t === 'json' || t === 'jsonb';
}
function isUuidType(ci?: ColInfo): boolean {
  return !!ci && ci.udt_name.toLowerCase() === 'uuid';
}

function sanitizeByType(value: any, ci?: ColInfo): any {
  if (value === '') return null; // critical fix: "" -> NULL
  if (!ci) return value;
  if (isNumericType(ci)) {
    if (value === null || value === undefined) return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  if (isBooleanType(ci)) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'boolean') return value;
    const s = String(value).trim().toLowerCase();
    if (['true','t','1','yes','y'].includes(s)) return true;
    if (['false','f','0','no','n'].includes(s)) return false;
    return null;
  }
  if (isDateType(ci))   return toDateVal(value);
  if (isJsonType(ci))   return parseMetaMaybe(value);
  if (isUuidType(ci))   return isBlank(value) ? null : String(value);
  return (value === undefined) ? null : value; // text/other
}

function sanitizeRecordByTypes(record: Record<string, any>, info: Map<string, ColInfo>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(record)) {
    const ci = info.get(k);
    const val = (v === '') ? null : v;
    out[k] = sanitizeByType(val, ci);
  }
  return out;
}

// ---------------- fallbacks for NOT NULL columns ----------------

function fallbackCustomerName(r: any): string {
  return (r.name && String(r.name).trim()) ||
         (r.email && String(r.email).trim()) ||
         (r.phone && String(r.phone).trim()) ||
         `Customer ${r.id}`;
}

function fallbackProductName(r: any): string {
  return (r.name && String(r.name).trim()) || `Product ${r.id}`;
}

function fallbackItemName(r: any, productNames: Map<string, string>): string {
  if (r.name && String(r.name).trim()) return String(r.name).trim();
  const pid = r.product_id ?? r.productId ?? r.productID ?? null;
  if (pid && productNames.has(String(pid))) return productNames.get(String(pid)) as string;
  return `Item ${r.id}`;
}

// Ensure required NOT NULLs are set (either compute, or decide to skip)
function ensureNonNullsOrSkip(
  table: 'customers' | 'products' | 'sales' | 'sale_items',
  wants: Record<string, any>,
  info: Map<string, ColInfo>,
  row: any,
  ctx: { productNames?: Map<string,string> }
): { ok: boolean; wants?: Record<string, any>; reason?: string } {
  const must = (col: string) => info.get(col)?.is_nullable === 'NO';

  if (table === 'customers') {
    if (must('name') && (wants.name == null || wants.name === '')) {
      wants.name = fallbackCustomerName(row);
    }
    if (must('created_at') && wants.created_at == null) wants.created_at = new Date();
  }

  if (table === 'products') {
    if (must('name') && (wants.name == null || wants.name === '')) {
      wants.name = fallbackProductName(row);
    }
    if (must('created_at') && wants.created_at == null) wants.created_at = new Date();
  }

  if (table === 'sales') {
    // Some schemas require invoice_date; if so and missing, use created_at or now
    if (must('invoice_date') && wants.invoice_date == null) {
      wants.invoice_date = wants.created_at ?? new Date();
    }
    if (must('created_at') && wants.created_at == null) wants.created_at = new Date();
    if (must('customer_id') && (wants.customer_id == null || wants.customer_id === '')) {
      return { ok: false, reason: 'sales: missing required customer_id' };
    }
  }

  if (table === 'sale_items') {
    // FK requirements
    if (must('sale_id') && (wants.sale_id == null || wants.sale_id === '')) {
      return { ok: false, reason: 'sale_items: missing required sale_id' };
    }
    if (must('product_id') && (wants.product_id == null || wants.product_id === '')) {
      // If product_id is required and missing, we cannot infer safely → skip
      return { ok: false, reason: 'sale_items: missing required product_id' };
    }
    // Name requirement
    if (info.has('name') && must('name') && (wants.name == null || wants.name === '')) {
      wants.name = fallbackItemName(row, ctx.productNames || new Map());
    }
    // Quantity requirement (some schemas have NOT NULL)
    if (info.has('quantity') && must('quantity') && wants.quantity == null) wants.quantity = 1;
    if (info.has('qty')       && must('qty')       && wants.qty == null)       wants.qty = 1;
    // price/tax/total defaults if required
    if (info.has('price') && must('price') && wants.price == null) wants.price = 0;
    if (info.has('unit_price') && must('unit_price') && wants.unit_price == null) wants.unit_price = 0;
    if (info.has('rate') && must('rate') && wants.rate == null) wants.rate = 0;

    if (info.has('tax') && must('tax') && wants.tax == null) wants.tax = 0;
    if (info.has('gst') && must('gst') && wants.gst == null) wants.gst = 0;

    if (info.has('total') && must('total') && wants.total == null) wants.total = 0;
    if (info.has('amount') && must('amount') && wants.amount == null) wants.amount = 0;
    if (info.has('line_total') && must('line_total') && wants.line_total == null) wants.line_total = 0;

    if (must('created_at') && wants.created_at == null) wants.created_at = new Date();
  }

  return { ok: true, wants };
}

async function upsertRowDynamic(
  client: PgClient,
  table: string,
  colsAvailable: Set<string>,
  colValues: Record<string, any>,
  conflictCol: string,
  updateColsExclude: Set<string> = new Set(['created_at', conflictCol])
) {
  const entries = Object.entries(colValues).filter(([c, v]) => colsAvailable.has(c) && v !== undefined);
  const presentCols = entries.map(([c]) => c);
  if (!presentCols.includes(conflictCol)) {
    throw new Error(`Missing required column "${conflictCol}" for table "${table}"`);
  }
  const placeholders = entries.map((_, i) => `$${i + 1}`).join(',');
  const values = entries.map(([, v]) => v);
  const updateCols = presentCols.filter((c) => !updateColsExclude.has(c));

  let sql: string;
  if (updateCols.length > 0) {
    const updateSet = updateCols.map((c) => `${c}=EXCLUDED.${c}`).join(', ');
    sql = `INSERT INTO ${table} (${presentCols.join(', ')}) VALUES (${placeholders})
           ON CONFLICT (${conflictCol}) DO UPDATE SET ${updateSet}`;
  } else {
    sql = `INSERT INTO ${table} (${presentCols.join(', ')}) VALUES (${placeholders})
           ON CONFLICT (${conflictCol}) DO NOTHING`;
  }

  await client.query(sql, values);
}

// ---------------- main route ----------------

export async function POST(req: NextRequest) {
  if (!(await isAdmin(req))) return new Response('Forbidden', { status: 403 });

  const url = new URL(req.url);
  const ct = req.headers.get('content-type') || '';

  let apply = (url.searchParams.get('apply') || 'false') === 'true';
  let u8: Uint8Array;

  if (ct.startsWith('application/x-tar') || ct.startsWith('application/octet-stream') || ct.startsWith('application/zip')) {
    const ab = await req.arrayBuffer();
    u8 = new Uint8Array(ab);
  } else if (ct.includes('multipart/form-data')) {
    const form = await req.formData();
    apply = (form.get('apply') || 'false') === 'true';
    const file = form.get('file') as File | null;
    if (!file) return new Response('No file', { status: 400 });
    u8 = new Uint8Array(await file.arrayBuffer());
  } else {
    return new Response('Send .zip or .tar as raw upload or multipart file', { status: 400 });
  }

  const fmt = sniffFormat(u8);
  if (fmt === 'gz')  return new Response('You uploaded a .tar.gz. Please upload a plain .tar or a .zip.', { status: 400 });

  try {
    const ext = fmt === 'zip' ? 'zip' : 'tar';
    const tmpPath = path.join(os.tmpdir(), `axein-restore-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`);
    fs.writeFileSync(tmpPath, u8);
  } catch {}

  try {
    let entries: Map<string, Buffer>;
    if (fmt === 'zip') {
      entries = await readZipIntoMap(u8);
    } else {
      u8 = normalizeTarBytes(u8);
      try {
        entries = await readTarIntoMap(u8);
      } catch (e) {
        logLine(`restore: first parse failed (${(e as any)?.message}); retry with extra zeros`);
        const extra = new Uint8Array(u8.byteLength + 1024);
        extra.set(u8);
        u8 = extra;
        entries = await readTarIntoMap(u8);
      }
    }

    const has = async (name: string) => entries.has(name);
    const entryBuffer = async (name: string) => {
      const b = entries.get(name);
      if (!b) throw new Error(`Missing ${name}`);
      return b;
    };

    const hasManifest  = await has('manifest.json');
    const hasCustomers = await has('db/customers.csv');
    const hasCategories = await has('db/categories.csv');
    const hasProducts  = await has('db/products.csv');
    const hasSuppliers = await has('db/suppliers.csv');
    const hasPurchases = await has('db/purchases.csv');
    const hasPurchaseItems = await has('db/purchase_items.csv');
    const hasQuotations = await has('db/quotations.csv');
    const hasQuotationItems = await has('db/quotation_items.csv');
    const hasSales     = await has('db/sales.csv');
    const hasSaleItems = await has('db/sale_items.csv');
    const hasBatches = await has('db/product_batches.csv');
    const hasMovements = await has('db/stock_movements.csv');
    const hasAdjustments = await has('db/inventory_adjustments.csv');
    const hasAdjustmentItems = await has('db/inventory_adjustment_items.csv');
    const hasNotifications = await has('db/notifications.csv');
    const hasSettings  = await has('db/settings.json');

    const invoicesPdfCount = [...entries.keys()].filter((n) => n.startsWith('invoices/') && n.endsWith('.pdf')).length;

    const report = {
      hasManifest,
      hasCustomers,
      hasCategories,
      hasProducts,
      hasSuppliers,
      hasPurchases,
      hasPurchaseItems,
      hasQuotations,
      hasQuotationItems,
      hasSales,
      hasSaleItems,
      hasBatches,
      hasMovements,
      hasAdjustments,
      hasAdjustmentItems,
      hasNotifications,
      hasSettings,
      invoicesPdfCount,
    };

    if (!apply) {
      return Response.json({ ok: true, report });
    }

    const parseCsvIf = async (name: string) =>
      (await has(name))
        ? (csvSync.parse(await entryBuffer(name), { columns: true, skip_empty_lines: true, trim: true }) as any[])
        : [];
    const parseJsonIf = async (name: string) =>
      (await has(name)) ? JSON.parse((await entryBuffer(name)).toString('utf8')) : null;

    const customers: any[]   = await parseCsvIf('db/customers.csv');
    const categories: any[]  = await parseCsvIf('db/categories.csv');
    const products: any[]    = await parseCsvIf('db/products.csv');
    const suppliers: any[]   = await parseCsvIf('db/suppliers.csv');
    const purchases: any[]   = await parseCsvIf('db/purchases.csv');
    const purchaseItems: any[] = await parseCsvIf('db/purchase_items.csv');
    const quotations: any[]  = await parseCsvIf('db/quotations.csv');
    const quotationItems: any[] = await parseCsvIf('db/quotation_items.csv');
    const sales: any[]       = await parseCsvIf('db/sales.csv');
    const items: any[]       = await parseCsvIf('db/sale_items.csv');
    const productBatches: any[] = await parseCsvIf('db/product_batches.csv');
    const stockMovements: any[] = await parseCsvIf('db/stock_movements.csv');
    const inventoryAdjustments: any[] = await parseCsvIf('db/inventory_adjustments.csv');
    const inventoryAdjustmentItems: any[] = await parseCsvIf('db/inventory_adjustment_items.csv');
    const notifications: any[] = await parseCsvIf('db/notifications.csv');
    const settingsArr: any[] = (await parseJsonIf('db/settings.json')) ?? [];

    // Build product name map from CSV (used to fill sale_items.name)
    const productNames = new Map<string, string>();
    for (const p of products) {
      if (!isBlank(p.id) && !isBlank(p.name)) productNames.set(String(p.id), String(p.name));
    }

    const pool: PgLike = (getDb() as unknown) as PgLike;
    const client = pool.connect ? await pool.connect() : (pool as any);
    try {
      await client.query('BEGIN');

      // Column/type maps
      const infoCustomers = await getColumnInfoMap(client, 'customers');
      const infoCategories = await getColumnInfoMap(client, 'categories');
      const infoProducts  = await getColumnInfoMap(client, 'products');
      const infoSuppliers = await getColumnInfoMap(client, 'suppliers');
      const infoPurchases = await getColumnInfoMap(client, 'purchases');
      const infoPurchaseItems = await getColumnInfoMap(client, 'purchase_items');
      const infoQuotations = await getColumnInfoMap(client, 'quotations');
      const infoQuotationItems = await getColumnInfoMap(client, 'quotation_items');
      const infoSales     = await getColumnInfoMap(client, 'sales');
      const infoItems     = await getColumnInfoMap(client, 'sale_items');
      const infoBatches   = await getColumnInfoMap(client, 'product_batches');
      const infoMovements = await getColumnInfoMap(client, 'stock_movements');
      const infoAdjustments = await getColumnInfoMap(client, 'inventory_adjustments');
      const infoAdjustmentItems = await getColumnInfoMap(client, 'inventory_adjustment_items');
      const infoNotifications = await getColumnInfoMap(client, 'notifications');
      const infoSettings  = await getColumnInfoMap(client, 'settings');

      const colsCustomers = new Set(infoCustomers.keys());
      const colsCategories = new Set(infoCategories.keys());
      const colsProducts  = new Set(infoProducts.keys());
      const colsSuppliers = new Set(infoSuppliers.keys());
      const colsPurchases = new Set(infoPurchases.keys());
      const colsPurchaseItems = new Set(infoPurchaseItems.keys());
      const colsQuotations = new Set(infoQuotations.keys());
      const colsQuotationItems = new Set(infoQuotationItems.keys());
      const colsSalesSet  = new Set(infoSales.keys());
      const colsItemsSet  = new Set(infoItems.keys());
      const colsBatches = new Set(infoBatches.keys());
      const colsMovements = new Set(infoMovements.keys());
      const colsAdjustments = new Set(infoAdjustments.keys());
      const colsAdjustmentItems = new Set(infoAdjustmentItems.keys());
      const colsNotifications = new Set(infoNotifications.keys());

      // categories (if present)
      for (const r of categories) {
        if (!colsCategories.size) break;
        const wants: Record<string, any> = sanitizeRecordByTypes(r, infoCategories);
        if (wants.id == null || wants.id === '') continue;
        try {
          await upsertRowDynamic(client, 'categories', colsCategories, wants, 'id');
        } catch (e: any) {
          logLine(`categories: skip row id=${r.id} (${e?.message || e})`);
        }
      }

      // customers (full restore)
      for (const r of customers) {
        const wants: Record<string, any> = sanitizeRecordByTypes(r, infoCustomers);
        if (colsCustomers.has('meta') && !colsCustomers.has('email') && !isBlank(r.email)) {
          wants.meta = mergeMeta(parseMetaMaybe(wants.meta), { email: r.email });
        }

        // Ensure NOT NULLs
        const nn = ensureNonNullsOrSkip('customers', wants, infoCustomers, r, {});
        if (!nn.ok) { logLine(nn.reason || 'customers: skipped due to NOT NULL'); continue; }

        const sanitized = sanitizeRecordByTypes(nn.wants!, infoCustomers);
        if (sanitized.id == null || sanitized.id === '') {
          logLine('customers: skipped row with missing id after sanitization');
          continue;
        }
        await upsertRowDynamic(client, 'customers', colsCustomers, sanitized, 'id');
      }

      // products (full restore)
      for (const r of products) {
        const wants: Record<string, any> = sanitizeRecordByTypes(r, infoProducts);

        const nn = ensureNonNullsOrSkip('products', wants, infoProducts, r, {});
        if (!nn.ok) { logLine(nn.reason || 'products: skipped due to NOT NULL'); continue; }

        const sanitized = sanitizeRecordByTypes(nn.wants!, infoProducts);
        if (sanitized.id == null || sanitized.id === '') {
          logLine('products: skipped row with missing id after sanitization');
          continue;
        }
        await upsertRowDynamic(client, 'products', colsProducts, sanitized, 'id');

        // Also feed name map if it was missing
        if (!isBlank(r.id) && !isBlank(sanitized.name)) {
          productNames.set(String(r.id), String(sanitized.name));
        }
      }

      // suppliers
      for (const r of suppliers) {
        if (!colsSuppliers.size) break;
        const wants: Record<string, any> = sanitizeRecordByTypes(r, infoSuppliers);
        if (wants.id == null || wants.id === '') continue;
        try {
          await upsertRowDynamic(client, 'suppliers', colsSuppliers, wants, 'id');
        } catch (e: any) {
          logLine(`suppliers: skip row id=${r.id} (${e?.message || e})`);
        }
      }

      // purchases
      for (const r of purchases) {
        if (!colsPurchases.size) break;
        const wants: Record<string, any> = sanitizeRecordByTypes(r, infoPurchases);
        if (wants.id == null || wants.id === '') continue;
        try {
          await upsertRowDynamic(client, 'purchases', colsPurchases, wants, 'id');
        } catch (e: any) {
          logLine(`purchases: skip row id=${r.id} (${e?.message || e})`);
        }
      }

      // purchase_items
      for (const r of purchaseItems) {
        if (!colsPurchaseItems.size) break;
        const wants: Record<string, any> = sanitizeRecordByTypes(r, infoPurchaseItems);
        if (wants.id == null || wants.id === '') continue;
        try {
          await upsertRowDynamic(client, 'purchase_items', colsPurchaseItems, wants, 'id');
        } catch (e: any) {
          logLine(`purchase_items: skip row id=${r.id} (${e?.message || e})`);
        }
      }

      // quotations
      for (const r of quotations) {
        if (!colsQuotations.size) break;
        const wants: Record<string, any> = sanitizeRecordByTypes(r, infoQuotations);
        if (wants.id == null || wants.id === '') continue;
        try {
          await upsertRowDynamic(client, 'quotations', colsQuotations, wants, 'id');
        } catch (e: any) {
          logLine(`quotations: skip row id=${r.id} (${e?.message || e})`);
        }
      }

      // quotation_items
      for (const r of quotationItems) {
        if (!colsQuotationItems.size) break;
        const wants: Record<string, any> = sanitizeRecordByTypes(r, infoQuotationItems);
        if (wants.id == null || wants.id === '') continue;
        try {
          await upsertRowDynamic(client, 'quotation_items', colsQuotationItems, wants, 'id');
        } catch (e: any) {
          logLine(`quotation_items: skip row id=${r.id} (${e?.message || e})`);
        }
      }

      // sales (full restore)
      for (const r of sales) {
        const wants: Record<string, any> = sanitizeRecordByTypes(r, infoSales);

        const nn = ensureNonNullsOrSkip('sales', wants, infoSales, r, {});
        if (!nn.ok) { logLine(nn.reason || 'sales: skipped due to NOT NULL'); continue; }

        const sanitized = sanitizeRecordByTypes(nn.wants!, infoSales);
        if (sanitized.id == null || sanitized.id === '') {
          logLine('sales: skipped row with missing id after sanitization');
          continue;
        }
        await upsertRowDynamic(client, 'sales', colsSalesSet, sanitized, 'id');
      }

      // sale_items (synonyms + sanitization + NOT NULL defaults)
      for (const r of items) {
        const qty       = toNum(r.quantity ?? r.qty ?? 1);
        const price     = toNum(r.price ?? r.unit_price ?? r.rate ?? 0);
        const tax       = toNum(r.tax ?? r.gst ?? 0);
        const totalCalc = toNum(r.total ?? r.amount ?? r.line_total ?? (qty * price + tax));
        const createdAt = toDateVal(r.created_at) ?? new Date();

        const wants: Record<string, any> = { id: r.id };

        // FKs (allow null if blank; NOT NULL enforced later)
        if (colsItemsSet.has('sale_id'))    wants.sale_id = isBlank(r.sale_id) ? null : r.sale_id;
        if (colsItemsSet.has('product_id')) wants.product_id = isBlank(r.product_id) ? null : r.product_id;

        // name if the column exists (value may be filled later if required)
        if (colsItemsSet.has('name') && r.name != null) wants.name = r.name;

        // quantity variants
        if (colsItemsSet.has('quantity'))        wants.quantity = qty;
        else if (colsItemsSet.has('qty'))        wants.qty = qty;

        // price variants
        if (colsItemsSet.has('price'))           wants.price = price;
        else if (colsItemsSet.has('unit_price')) wants.unit_price = price;
        else if (colsItemsSet.has('rate'))       wants.rate = price;

        // tax variants
        if (colsItemsSet.has('tax'))             wants.tax = tax;
        else if (colsItemsSet.has('gst'))        wants.gst = tax;

        // total variants
        if (colsItemsSet.has('total'))           wants.total = totalCalc;
        else if (colsItemsSet.has('amount'))     wants.amount = totalCalc;
        else if (colsItemsSet.has('line_total')) wants.line_total = totalCalc;

        if (colsItemsSet.has('created_at'))      wants.created_at = createdAt;

        // meta catch-all
        if (colsItemsSet.has('meta')) {
          const extras: Record<string, any> = {};
          if (!('quantity' in wants) && !('qty' in wants)) extras.quantity = qty;
          if (!('price' in wants) && !('unit_price' in wants) && !('rate' in wants)) extras.price = price;
          if (!('tax' in wants) && !('gst' in wants)) extras.tax = tax;
          if (!('total' in wants) && !('amount' in wants) && !('line_total' in wants)) extras.total = totalCalc;
          wants.meta = mergeMeta(parseMetaMaybe(r.meta), extras);
        }

        // Ensure NOT NULLs / fill required fields
        const nn = ensureNonNullsOrSkip('sale_items', wants, infoItems, r, { productNames });
        if (!nn.ok) { logLine(nn.reason || 'sale_items: skipped due to NOT NULL'); continue; }

        const sanitized = sanitizeRecordByTypes(nn.wants!, infoItems);
        if (sanitized.id == null || sanitized.id === '') {
          logLine('sale_items: skipped row with missing id after sanitization');
          continue;
        }

        await upsertRowDynamic(client, 'sale_items', colsItemsSet, sanitized, 'id');
      }

      // product_batches
      for (const r of productBatches) {
        if (!colsBatches.size) break;
        const wants: Record<string, any> = sanitizeRecordByTypes(r, infoBatches);
        if (wants.id == null || wants.id === '') continue;
        try {
          await upsertRowDynamic(client, 'product_batches', colsBatches, wants, 'id');
        } catch (e: any) {
          logLine(`product_batches: skip row id=${r.id} (${e?.message || e})`);
        }
      }

      // stock_movements
      for (const r of stockMovements) {
        if (!colsMovements.size) break;
        const wants: Record<string, any> = sanitizeRecordByTypes(r, infoMovements);
        if (wants.id == null || wants.id === '') continue;
        try {
          await upsertRowDynamic(client, 'stock_movements', colsMovements, wants, 'id');
        } catch (e: any) {
          logLine(`stock_movements: skip row id=${r.id} (${e?.message || e})`);
        }
      }

      // inventory_adjustments
      for (const r of inventoryAdjustments) {
        if (!colsAdjustments.size) break;
        const wants: Record<string, any> = sanitizeRecordByTypes(r, infoAdjustments);
        if (wants.id == null || wants.id === '') continue;
        try {
          await upsertRowDynamic(client, 'inventory_adjustments', colsAdjustments, wants, 'id');
        } catch (e: any) {
          logLine(`inventory_adjustments: skip row id=${r.id} (${e?.message || e})`);
        }
      }

      // inventory_adjustment_items
      for (const r of inventoryAdjustmentItems) {
        if (!colsAdjustmentItems.size) break;
        const wants: Record<string, any> = sanitizeRecordByTypes(r, infoAdjustmentItems);
        if (wants.id == null || wants.id === '') continue;
        try {
          await upsertRowDynamic(client, 'inventory_adjustment_items', colsAdjustmentItems, wants, 'id');
        } catch (e: any) {
          logLine(`inventory_adjustment_items: skip row id=${r.id} (${e?.message || e})`);
        }
      }

      // notifications
      for (const r of notifications) {
        if (!colsNotifications.size) break;
        const wants: Record<string, any> = sanitizeRecordByTypes(r, infoNotifications);
        if (wants.id == null || wants.id === '') continue;
        try {
          await upsertRowDynamic(client, 'notifications', colsNotifications, wants, 'id');
        } catch (e: any) {
          logLine(`notifications: skip row id=${r.id} (${e?.message || e})`);
        }
      }

      // settings
      if (Array.isArray(settingsArr) && infoSettings.has('key') && infoSettings.has('value_json')) {
        for (const s of settingsArr) {
          const sql = `
            INSERT INTO settings (key, value_json)
            VALUES ($1,$2)
            ON CONFLICT (key) DO UPDATE SET value_json=EXCLUDED.value_json
          `;
          await client.query(sql, [s.key, s.value_json ?? {}]);
        }
      }

      await client.query('COMMIT');
      return Response.json({ ok: true, applied: true, report });
    } catch (e: any) {
      try { await client.query('ROLLBACK'); } catch {}
      logLine(`restore failed: ${e.message}`);
      return new Response(`Restore failed: ${e.message}`, { status: 500 });
    } finally {
      if ((client as any).release) (client as any).release();
    }
  } catch (e: any) {
    const msg = mapTarError(e);
    logLine(`restore: fatal ${msg} (${e?.message || e})`);
    return new Response(msg, { status: 400 });
  }
}
