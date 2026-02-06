export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { pool } from "@/lib/db";

/** -------- Types for request payload ---------- */
type NewSaleItem = {
  product_id?: number | string | null;
  name: string;
  qty: number | string;
  unit_price: number | string;
  discount_pct?: number | string | null;
  gst_slab?: number | string | null;
  batch_no?: string | null;       // Lot/Batch No (optional)
  exp_date?: string | null;        // Expiry date (YYYY-MM-DD)
};

type NewSaleBody = {
  customer_id?: number | string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  customer_gstin?: string | null;
  customer_address?: string | null;
  patient_name?: string | null;
  doctor_name?: string | null;

  invoice_date?: string | null; // ISO string (optional)
  is_return?: boolean;
  amount_paid?: number | string | null;
  payment_method?: string | null;
  notes?: string | null;
  terms?: string | null;               // NEW
  extra_label?: string | null;         // NEW
  extra_amount?: number | string | null; // NEW

  allow_negative_stock?: boolean;

  items: NewSaleItem[];
};

/** -------- Helpers ---------- */

function nstr(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function nowIST(): Date {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000);
}

function fmtISTParts(d = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === t)?.value || "";
  const ymd = `${get("year")}${get("month")}${get("day")}`;
  const hm = `${get("hour")}${get("minute")}`;
  return { ymd, hm };
}

function currentFYLabel(d = nowIST()): string {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const startYear = m <= 3 ? y - 1 : y;
  const a = String(startYear % 100).padStart(2, "0");
  const b = String((startYear + 1) % 100).padStart(2, "0");
  return `FY${a}-${b}`;
}

const columnCache = new Map<string, Set<string>>();
async function getColumns(client: any, table: string): Promise<Set<string>> {
  const cached = columnCache.get(table);
  if (cached) return cached;
  const r = await client.query(
    `SELECT LOWER(column_name) AS col
     FROM information_schema.columns
     WHERE table_schema='public' AND table_name=$1`,
    [table]
  );
  const cols = new Set<string>(r.rows.map((x: any) => x.col));
  columnCache.set(table, cols);
  return cols;
}

type ProductCols = { hasMeta: boolean; hasStockQty: boolean; hasStock: boolean };

async function getNextInvoiceNo(client: any, salesCols: Set<string>): Promise<string> {
  const prefix = `${currentFYLabel()}/`;
  if (!salesCols.has("invoice_no")) {
    const { ymd, hm } = fmtISTParts();
    return `INV/${ymd}/${hm}-${Math.floor(Math.random() * 900 + 100)}`;
  }
  const rs = await client.query(
    `SELECT invoice_no
       FROM sales
      WHERE invoice_no LIKE $1
      ORDER BY id DESC
      LIMIT 1`,
    [prefix + "%"]
  );
  let seq = 1;
  if (rs.rowCount > 0) {
    const last = String(rs.rows[0].invoice_no || "");
    const m = last.match(/(\d+)\s*$/);
    if (m) seq = Number(m[1]) + 1;
  }
  return `${prefix}${String(seq).padStart(5, "0")}`;
}

async function getNextDcNo(
  client: any,
  companyName: string,
  baseDate: Date | undefined,
  salesCols: Set<string>
): Promise<string> {
  const safeCompany = (companyName || "Company")
    .trim()
    .replace(/[\/]+/g, "-")
    .replace(/\s+/g, "")
    .replace(/[^a-zA-Z0-9_-]/g, "");
  const { ymd, hm } = fmtISTParts(baseDate || new Date());
  const prefix = `DC/${safeCompany}/${ymd}/`;
  try {
    if (salesCols.has("dc_no")) {
      const rs = await client.query(
        `SELECT dc_no
           FROM sales
          WHERE dc_no LIKE $1
          ORDER BY id DESC
          LIMIT 1`,
        [prefix + "%"]
      );
      let seq = 1;
      if (rs.rowCount > 0) {
        const last = String(rs.rows[0]?.dc_no || "");
        const m = last.match(/-(\d+)\s*$/);
        if (m) seq = Number(m[1]) + 1;
      }
      return `${prefix}${hm}-${String(seq).padStart(3, "0")}`;
    }
    if (salesCols.has("meta")) {
      const rs = await client.query(
        `SELECT meta->>'dc_no' AS dc_no
           FROM sales
          WHERE (meta->>'dc_no') LIKE $1
          ORDER BY id DESC
          LIMIT 1`,
        [prefix + "%"]
      );
      let seq = 1;
      if (rs.rowCount > 0) {
        const last = String(rs.rows[0]?.dc_no || "");
        const m = last.match(/-(\d+)\s*$/);
        if (m) seq = Number(m[1]) + 1;
      }
      return `${prefix}${hm}-${String(seq).padStart(3, "0")}`;
    }
  } catch {
    // ignore and fall back
  }
  return `${prefix}${hm}-${String(1).padStart(3, "0")}`;
}

async function resolveCustomerId(client: any, payload: NewSaleBody): Promise<number | null> {
  if (payload.customer_id != null && payload.customer_id !== "") {
    const id = Number(payload.customer_id);
    if (Number.isFinite(id)) return id;
  }

  const name = nstr(payload.customer_name);
  if (!name) return null;

  const found = await client.query(
    `SELECT id FROM customers WHERE lower(name) = lower($1) LIMIT 1`,
    [name]
  );
  if (found.rowCount > 0) return Number(found.rows[0].id);

  const ins = await client.query(
    `INSERT INTO customers (name, phone, gstin, address)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [
      name,
      nstr(payload.customer_phone),
      nstr(payload.customer_gstin),
      nstr(payload.customer_address),
    ]
  );
  return Number(ins.rows[0].id);
}

/** ----- Stock helpers ----- **/

async function lockAndReadProductById(client: any, id: number, cols: ProductCols) {
  const selectCols = ["id"];
  if (cols.hasMeta) selectCols.push("meta");
  if (cols.hasStockQty) selectCols.push("stock_qty");
  if (cols.hasStock) selectCols.push("stock");
  const rs = await client.query(
    `SELECT ${selectCols.join(", ")}
       FROM products
      WHERE id = $1
      FOR UPDATE`,
    [id]
  );
  if (rs.rowCount === 0) return null;
  const row = rs.rows[0] as any;
  const meta = cols.hasMeta ? (row.meta || {}) : {};
  const current = cols.hasMeta
    ? Number(meta.stock_qty ?? meta.stock ?? 0) || 0
    : cols.hasStockQty
    ? Number(row.stock_qty ?? 0) || 0
    : cols.hasStock
    ? Number(row.stock ?? 0) || 0
    : 0;
  return { id: row.id, meta, current };
}

async function lockAndReadProductByName(client: any, productName: string, cols: ProductCols) {
  const selectCols = ["id"];
  if (cols.hasMeta) selectCols.push("meta");
  if (cols.hasStockQty) selectCols.push("stock_qty");
  if (cols.hasStock) selectCols.push("stock");
  const rs = await client.query(
    `SELECT ${selectCols.join(", ")}
       FROM products
      WHERE lower(name) = lower($1)
      FOR UPDATE
      LIMIT 1`,
    [productName]
  );
  if (rs.rowCount === 0) return null;
  const row = rs.rows[0] as any;
  const meta = cols.hasMeta ? (row.meta || {}) : {};
  const current = cols.hasMeta
    ? Number(meta.stock_qty ?? meta.stock ?? 0) || 0
    : cols.hasStockQty
    ? Number(row.stock_qty ?? 0) || 0
    : cols.hasStock
    ? Number(row.stock ?? 0) || 0
    : 0;
  return { id: row.id, meta, current };
}

async function applyStockDelta(
  client: any,
  productRef: { id?: number | null; name?: string | null },
  delta: number,
  allowNegative = false,
  cols: ProductCols
) {
  if (!cols.hasMeta && !cols.hasStockQty && !cols.hasStock) return;
  const byId = Number(productRef.id);
  const locked =
    Number.isFinite(byId) && byId > 0
      ? await lockAndReadProductById(client, byId, cols)
      : productRef.name
      ? await lockAndReadProductByName(client, String(productRef.name), cols)
      : null;

  if (!locked) return;

  const { id, meta, current } = locked;
  let next = current + delta;
  if (!allowNegative) next = Math.max(0, next);

  if (cols.hasMeta) {
    const nextMeta = { ...meta, stock_qty: next };
    await client.query(`UPDATE products SET meta = $2::jsonb WHERE id = $1`, [
      id,
      JSON.stringify(nextMeta),
    ]);
    return;
  }
  if (cols.hasStockQty) {
    await client.query(`UPDATE products SET stock_qty = $2 WHERE id = $1`, [id, next]);
    return;
  }
  if (cols.hasStock) {
    await client.query(`UPDATE products SET stock = $2 WHERE id = $1`, [id, next]);
  }
}

/** -------- Main handler ---------- */

export async function POST(req: Request) {
  let payload: NewSaleBody;
  try {
    payload = (await req.json()) as NewSaleBody;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const items = Array.isArray(payload.items) ? payload.items : [];
  if (items.length === 0) {
    return new Response(JSON.stringify({ error: "At least one item is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const allowNegative = !!payload.allow_negative_stock;
  const is_return = !!payload.is_return;

  type Line = {
    product_id: number | null;
    name: string;
    qty: number;
    unit_price: number;
    discount_pct: number;
    gst_slab: number;
    taxable: number;
    tax: number;
    total: number;
    batch_no?: string | null;
    exp_date?: string | null;
  };

  const lines: Line[] = [];
  let discount_total = 0;
  for (const it of items) {
    const product_id =
      it.product_id != null && it.product_id !== ""
        ? Number(it.product_id)
        : null;

    const name = nstr((it as any).name) || "Item";
    const qty = Number((it as any).qty ?? 0);
    const unit_price = Number((it as any).unit_price ?? 0);
    const discount_pct = Number((it as any).discount_pct ?? 0) || 0;
    const gst_slab = Number((it as any).gst_slab ?? 0) || 0;

    if (!Number.isFinite(qty) || qty <= 0) {
      return new Response(JSON.stringify({ error: `Invalid qty for "${name}"` }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (!Number.isFinite(unit_price) || unit_price < 0) {
      return new Response(JSON.stringify({ error: `Invalid unit price for "${name}"` }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const gross = unit_price * qty;
    const discounted = unit_price * (1 - discount_pct / 100);
    const taxable = round2(discounted * qty);
    const tax = round2((gst_slab / 100) * taxable);
    const total = round2(taxable + tax);
    const discountAmount = round2(Math.max(gross - taxable, 0));
    discount_total += discountAmount;

    lines.push({
      product_id: Number.isFinite(product_id as number) ? (product_id as number) : null,
      name,
      qty,
      unit_price: round2(unit_price),
      discount_pct: round2(discount_pct),
      gst_slab: round2(gst_slab),
      taxable,
      tax,
      total,
      batch_no: nstr((it as any).batch_no),
      exp_date: nstr((it as any).exp_date),
    });
  }

  const subtotal = round2(lines.reduce((a, b) => a + b.taxable, 0));
  const tax_total = round2(lines.reduce((a, b) => a + b.tax, 0));
  discount_total = round2(discount_total);

  // NEW: extra
  const extra_amount = round2(Number(payload.extra_amount ?? 0) || 0);
  const grand_total = round2(subtotal + tax_total + extra_amount);

  const amount_paid = round2(Number(payload.amount_paid ?? 0) || 0);
  const paid = Math.max(amount_paid, 0);
  const pending_amount = round2(Math.max(grand_total - paid, 0));
  const payment_status =
    paid >= grand_total - 0.01 ? "Paid" : paid > 0 ? "Partial" : "Pending";
  const payment_method = nstr(payload.payment_method);
  const notes = nstr(payload.notes);
  const terms = nstr(payload.terms);
  const extra_label = nstr(payload.extra_label) || (extra_amount > 0 ? "Additional Charge" : null);
  const patient_name = nstr(payload.patient_name);
  const doctor_name = nstr(payload.doctor_name);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const salesCols = await getColumns(client, "sales");
    const saleItemCols = await getColumns(client, "sale_items");
    const productCols = await getColumns(client, "products");
    const prodCols: ProductCols = {
      hasMeta: productCols.has("meta"),
      hasStockQty: productCols.has("stock_qty"),
      hasStock: productCols.has("stock"),
    };

    if (salesCols.size === 0) throw new Error("Sales table not found or has no columns.");
    if (saleItemCols.size === 0) throw new Error("Sale items table not found or has no columns.");

    const customer_id = await resolveCustomerId(client, payload);
    const invoiceDateParam =
      payload.invoice_date && nstr(payload.invoice_date)
        ? new Date(String(payload.invoice_date))
        : new Date();
    const invoice_no = await getNextInvoiceNo(client, salesCols);
    const bizRes = await client.query(`SELECT value_json FROM settings WHERE key='business' LIMIT 1`);
    const biz = (bizRes.rows?.[0]?.value_json ?? {}) as any;
    const dc_no = await getNextDcNo(client, String(biz?.name || "Company"), invoiceDateParam, salesCols);

    // Insert sale (meta kept as JS object to match existing pattern)
    const saleMeta = {
      is_return,
      amount_paid: paid,
      pending_amount,
      payment_status,
      payment_method,
      notes,
      terms,
      extra_label,
      extra_amount,
      patient_name,
      doctor_name,
      dc_no,
    };

    const saleCols: string[] = [];
    const saleVals: any[] = [];
    const addSale = (col: string, val: any) => {
      if (salesCols.has(col)) { saleCols.push(col); saleVals.push(val); }
    };

    addSale("invoice_no", invoice_no);
    addSale("customer_id", customer_id);
    addSale("invoice_date", invoiceDateParam.toISOString());
    addSale("created_at", invoiceDateParam.toISOString());

    addSale("subtotal", subtotal);
    addSale("tax_total", tax_total);
    addSale("total", grand_total);

    // Compat columns
    addSale("taxable_value", subtotal);
    addSale("grand_total", grand_total);
    addSale("roundoff", 0);
    addSale("round_off", 0);
    addSale("discount_total", discount_total);
    if (salesCols.has("cgst")) addSale("cgst", round2(tax_total / 2));
    if (salesCols.has("sgst")) addSale("sgst", round2(tax_total / 2));
    if (salesCols.has("igst")) addSale("igst", 0);

    addSale("amount_paid", paid);
    addSale("pending_amount", pending_amount);
    addSale("payment_status", payment_status);
    addSale("payment_method", payment_method);
    addSale("meta", saleMeta);
    addSale("dc_no", dc_no);

    const salePlaceholders = saleVals.map((_, i) => `$${i + 1}`).join(", ");
    const saleIns = await client.query(
      `INSERT INTO sales (${saleCols.join(", ")})
       VALUES (${salePlaceholders})
       RETURNING id`,
      saleVals
    );
    const sale_id = Number(saleIns.rows[0].id);

    const paymentRow = paid > 0
      ? { sale_id, method: payment_method || "cash", amount: paid, ref: invoice_no || null }
      : null;

    // Insert sale items + Adjust stock
    for (const ln of lines) {
      const itemMeta = {
        ...(ln.batch_no ? { batch_no: ln.batch_no } : {}),
        ...(ln.exp_date ? { exp_date: ln.exp_date } : {}),
      };
      const itemCols: string[] = [];
      const itemVals: any[] = [];
      const addItem = (col: string, val: any) => {
        if (saleItemCols.has(col)) { itemCols.push(col); itemVals.push(val); }
      };

      addItem("sale_id", sale_id);
      addItem("product_id", ln.product_id);
      addItem("name", ln.name);
      addItem("hsn_code", null);
      addItem("gst_slab", ln.gst_slab);
      addItem("qty", ln.qty);
      addItem("unit", "pcs");
      addItem("unit_price", ln.unit_price);
      addItem("discount_pct", ln.discount_pct);
      addItem("taxable", ln.taxable);
      addItem("tax", ln.tax);
      if (saleItemCols.has("cgst")) addItem("cgst", round2(ln.tax / 2));
      if (saleItemCols.has("sgst")) addItem("sgst", round2(ln.tax / 2));
      if (saleItemCols.has("igst")) addItem("igst", 0);
      addItem("total", ln.total);
      if (saleItemCols.has("meta")) addItem("meta", JSON.stringify(itemMeta));

      const ph = itemVals.map((_, i) => `$${i + 1}`).join(", ");
      await client.query(
        `INSERT INTO sale_items (${itemCols.join(", ")}) VALUES (${ph})`,
        itemVals
      );

      const delta = is_return ? ln.qty : -ln.qty;
      await applyStockDelta(
        client,
        { id: ln.product_id, name: ln.product_id ? null : ln.name },
        delta,
        allowNegative,
        prodCols
      );
    }

    await client.query("COMMIT");

    // Optional: record a payment row AFTER commit to avoid aborting the main tx
    if (paymentRow) {
      try {
        const hasPayments = await client.query(
          `SELECT to_regclass('public.sale_payments') IS NOT NULL AS ok`
        );
        if (hasPayments.rows?.[0]?.ok) {
          await client.query(
            `INSERT INTO sale_payments (sale_id, method, amount, ref)
             VALUES ($1, $2, $3, $4)`,
            [paymentRow.sale_id, paymentRow.method, paymentRow.amount, paymentRow.ref]
          );
        }
      } catch (e: any) {
        console.warn("sale_payments insert skipped:", e?.message || e);
      }
    }

    return new Response(JSON.stringify({ id: sale_id, invoice_no }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    try { await client.query("ROLLBACK"); } catch {}
    const detail = String(err?.message || err);
    console.error("Create sale failed:", detail);
    return new Response(
      JSON.stringify({ error: detail || "Failed to save sale", detail }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  } finally {
    client.release();
  }
}
