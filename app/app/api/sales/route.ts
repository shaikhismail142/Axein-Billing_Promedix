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

async function getNextInvoiceNo(client: any): Promise<string> {
  const prefix = `${currentFYLabel()}/`;
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

async function getNextDcNo(client: any, companyName: string, baseDate?: Date): Promise<string> {
  const safeCompany = (companyName || "Company")
    .trim()
    .replace(/[\/]+/g, "-")
    .replace(/\s+/g, "")
    .replace(/[^a-zA-Z0-9_-]/g, "");
  const { ymd, hm } = fmtISTParts(baseDate || new Date());
  const prefix = `DC/${safeCompany}/${ymd}/`;

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

async function lockAndReadProductById(client: any, id: number) {
  const rs = await client.query(
    `SELECT id, meta
       FROM products
      WHERE id = $1
      FOR UPDATE`,
    [id]
  );
  if (rs.rowCount === 0) return null;
  const row = rs.rows[0] as { id: number; meta: any };
  const meta = row.meta || {};
  const current = Number(meta.stock_qty ?? meta.stock ?? 0) || 0;
  return { id: row.id, meta, current };
}

async function lockAndReadProductByName(client: any, productName: string) {
  const rs = await client.query(
    `SELECT id, meta
       FROM products
      WHERE lower(name) = lower($1)
      FOR UPDATE
      LIMIT 1`,
    [productName]
  );
  if (rs.rowCount === 0) return null;
  const row = rs.rows[0] as { id: number; meta: any };
  const meta = row.meta || {};
  const current = Number(meta.stock_qty ?? meta.stock ?? 0) || 0;
  return { id: row.id, meta, current };
}

async function applyStockDelta(
  client: any,
  productRef: { id?: number | null; name?: string | null },
  delta: number,
  allowNegative = false
) {
  const byId = Number(productRef.id);
  const locked =
    Number.isFinite(byId) && byId > 0
      ? await lockAndReadProductById(client, byId)
      : productRef.name
      ? await lockAndReadProductByName(client, String(productRef.name))
      : null;

  if (!locked) return;

  const { id, meta, current } = locked;
  let next = current + delta;
  if (!allowNegative) next = Math.max(0, next);

  const nextMeta = { ...meta, stock_qty: next };
  await client.query(`UPDATE products SET meta = $2::jsonb WHERE id = $1`, [
    id,
    JSON.stringify(nextMeta),
  ]);
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

    const discounted = unit_price * (1 - discount_pct / 100);
    const taxable = round2(discounted * qty);
    const tax = round2((gst_slab / 100) * taxable);
    const total = round2(taxable + tax);

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

    const customer_id = await resolveCustomerId(client, payload);
    const invoiceDateParam =
      payload.invoice_date && nstr(payload.invoice_date)
        ? new Date(String(payload.invoice_date))
        : new Date();
    const invoice_no = await getNextInvoiceNo(client);
    const bizRes = await client.query(`SELECT value_json FROM settings WHERE key='business' LIMIT 1`);
    const biz = (bizRes.rows?.[0]?.value_json ?? {}) as any;
    const dc_no = await getNextDcNo(client, String(biz?.name || "Company"), invoiceDateParam);

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

    let saleIns;
    try {
      saleIns = await client.query(
        `INSERT INTO sales
           (invoice_no, customer_id, subtotal, tax_total, total, invoice_date,
            amount_paid, pending_amount, payment_status, payment_method, meta)
         VALUES ($1,         $2,          $3,       $4,       $5,    $6,
                $7,         $8,            $9,            $10,            $11)
         RETURNING id`,
        [
          invoice_no,
          customer_id,
          subtotal,
          tax_total,
          grand_total,
          invoiceDateParam.toISOString(),
          paid,
          pending_amount,
          payment_status,
          payment_method,
          saleMeta,
        ]
      );
    } catch {
      // Back-compat if columns don't exist
      saleIns = await client.query(
        `INSERT INTO sales
           (invoice_no, customer_id, subtotal, tax_total, total, invoice_date, meta)
         VALUES ($1,         $2,          $3,       $4,       $5,    $6,           $7)
         RETURNING id`,
        [
          invoice_no,
          customer_id,
          subtotal,
          tax_total,
          grand_total,
          invoiceDateParam.toISOString(),
          saleMeta,
        ]
      );
    }
    const sale_id = Number(saleIns.rows[0].id);

    // Optional: record a payment row
    if (paid > 0) {
      try {
        const hasPayments = await client.query(
          `SELECT to_regclass('public.sale_payments') IS NOT NULL AS ok`
        );
        if (hasPayments.rows?.[0]?.ok) {
          await client.query(
            `INSERT INTO sale_payments (sale_id, method, amount, ref)
             VALUES ($1, $2, $3, $4)`,
            [sale_id, payment_method || "cash", paid, invoice_no || null]
          );
        }
      } catch {
        // ignore payments insert failures
      }
    }

    // Insert sale items + Adjust stock
    for (const ln of lines) {
      const itemMeta = {
        ...(ln.batch_no ? { batch_no: ln.batch_no } : {}),
        ...(ln.exp_date ? { exp_date: ln.exp_date } : {}),
      };
      await client.query(
        `INSERT INTO sale_items
           (sale_id, product_id, name, gst_slab, qty, unit_price, discount_pct, taxable, tax, total, meta)
         VALUES
           ($1,      $2,         $3,   $4,       $5,  $6,         $7,            $8,     $9,  $10, $11)`,
        [
          sale_id,
          ln.product_id,
          ln.name,
          ln.gst_slab,
          ln.qty,
          ln.unit_price,
          ln.discount_pct,
          ln.taxable,
          ln.tax,
          ln.total,
          JSON.stringify(itemMeta),
        ]
      );

      const delta = is_return ? ln.qty : -ln.qty;
      await applyStockDelta(
        client,
        { id: ln.product_id, name: ln.product_id ? null : ln.name },
        delta,
        allowNegative
      );
    }

    await client.query("COMMIT");

    return new Response(JSON.stringify({ id: sale_id, invoice_no }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error("Create sale failed:", err?.message || err);
    return new Response(
      JSON.stringify({ error: "Failed to save sale", detail: String(err?.message || err) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  } finally {
    client.release();
  }
}
