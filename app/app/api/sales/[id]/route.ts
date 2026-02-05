// app/api/sales/[id]/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

type ReqItem = {
  product_id?: number;
  name: string;
  gst_slab: number;
  qty: number;
  unit_price: number;
  discount_pct: number;
  batch_no?: string | null;
  exp_date?: string | null;
};
type ReqBody = {
  is_return?: boolean;
  amount_paid?: number;
  customer_id?: number | null;
  customer?: { name: string; phone?: string; gstin?: string; address?: string } | null;
  customer_name?: string | null;
  items?: ReqItem[];
  patient_name?: string | null;
  doctor_name?: string | null;
  dc_no?: string | null;
};

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const saleId = Number(params.id);
  if (!Number.isFinite(saleId)) return NextResponse.json({ error: "Invalid sale id" }, { status: 400 });

  let body: ReqBody;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }

  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) return NextResponse.json({ error: "At least one item required." }, { status: 400 });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Read current for stock diff + meta
    const curSale = await client.query(`SELECT id, meta FROM sales WHERE id=$1 FOR UPDATE`, [saleId]);
    if (!curSale.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }
    const curMeta = (curSale.rows[0].meta ?? {}) as Record<string, any>;
    const prevIsReturn = !!curMeta.is_return;

    const prevItems = await client.query(
      `SELECT name, qty FROM sale_items WHERE sale_id=$1`,
      [saleId]
    );

    // Undo previous stock effects
    for (const row of prevItems.rows) {
      await adjustStockForItem(client, { name: row.name }, Number(row.qty), prevIsReturn ? -1 : +1);
    }

    // Replace items
    await client.query(`DELETE FROM sale_items WHERE sale_id=$1`, [saleId]);

    let subtotal = 0, tax_total = 0, total = 0;
    for (const it of items) {
      if (!it.name || isNaN(+it.qty) || isNaN(+it.unit_price))
        return NextResponse.json({ error: "Invalid item values." }, { status: 400 });

      const qty = +it.qty || 0;
      const rate = +it.unit_price || 0;
      const disc = +it.discount_pct || 0;
      const gst = +it.gst_slab || 0;

      const gross = qty * rate;
      const discount = (gross * disc) / 100;
      const taxable = gross - discount;
      const tax = (taxable * gst) / 100;
      const lineTotal = taxable + tax;

      subtotal += taxable; tax_total += tax; total += lineTotal;

      const itemMeta = {
        ...(it.batch_no ? { batch_no: String(it.batch_no).trim() } : {}),
        ...(it.exp_date ? { exp_date: String(it.exp_date).trim() } : {}),
      };
      await client.query(
        `INSERT INTO sale_items (sale_id, product_id, name, gst_slab, qty, unit_price, discount_pct, taxable, tax, total, meta)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [saleId, it.product_id ?? null, it.name.trim(), gst, qty, rate, disc, round2(taxable), round2(tax), round2(lineTotal), JSON.stringify(itemMeta)]
      );

      // Apply new stock effects
      const nextIsReturn = !!body.is_return;
      await adjustStockForItem(client, { product_id: it.product_id, name: it.name }, qty, nextIsReturn ? +1 : -1);
    }

    // Totals + meta
    if (body.is_return) { subtotal = -subtotal; tax_total = -tax_total; total = -total; }
    await client.query(
      `UPDATE sales SET subtotal=$2, tax_total=$3, total=$4, customer_id=$5
        WHERE id=$1`,
      [saleId, round2(subtotal), round2(tax_total), round2(total),
       await resolveCustomerId(client, body)]
    );

    const newMeta = {
      ...(curMeta || {}),
      is_return: !!body.is_return,
      amount_paid: round2(Number(body.amount_paid ?? (curMeta.amount_paid ?? 0))),
      notes: typeof (body as any).notes === 'string'
        ? (body as any).notes
        : (curMeta.notes ?? null),
      patient_name: typeof body.patient_name === 'string' ? body.patient_name : (curMeta.patient_name ?? null),
      doctor_name: typeof body.doctor_name === 'string' ? body.doctor_name : (curMeta.doctor_name ?? null),
      dc_no: typeof body.dc_no === 'string' ? body.dc_no : (curMeta.dc_no ?? null),
    };

    await client.query(
      `UPDATE sales SET meta=$2::jsonb WHERE id=$1`,
      [saleId, JSON.stringify(newMeta)]
    );

    await client.query("COMMIT");
    return NextResponse.json({ ok: true, id: saleId });
  } catch (err: any) {
    await client.query("ROLLBACK");
    return NextResponse.json({ error: err?.message || "Failed to update invoice." }, { status: 500 });
  } finally {
    client.release();
  }
}

/** ------- helpers (same as POST) ------- */
async function resolveCustomerId(client: any, body: { customer_id?: number|null; customer?: any; customer_name?: string|null; }) {
  if (body.customer_id) return body.customer_id;
  const name = (body.customer?.name || body.customer_name || "").trim();
  if (!name) return null;
  const found = await client.query(`SELECT id FROM customers WHERE LOWER(name)=LOWER($1) LIMIT 1`, [name]);
  if (found.rowCount) return found.rows[0].id as number;
  const ins = await client.query(
    `INSERT INTO customers (name, phone, gstin, address) VALUES ($1,$2,$3,$4) RETURNING id`,
    [name, body.customer?.phone ?? null, body.customer?.gstin ?? null, body.customer?.address ?? null]
  );
  return ins.rows[0].id as number;
}

async function adjustStockForItem(client: any, product: { product_id?: number; name: string }, qty: number, direction: 1|-1) {
  try {
    let prod = null;
    if (product.product_id) {
      const r = await client.query(`SELECT id, meta FROM products WHERE id=$1`, [product.product_id]);
      if (r.rowCount) prod = r.rows[0];
    }
    if (!prod) {
      const r = await client.query(`SELECT id, meta FROM products WHERE LOWER(name)=LOWER($1) LIMIT 1`, [product.name.trim()]);
      if (r.rowCount) prod = r.rows[0];
    }
    if (!prod) {
      const ins = await client.query(`INSERT INTO products (name, meta) VALUES ($1,'{}'::jsonb) RETURNING id, meta`, [product.name.trim()]);
      prod = ins.rows[0];
    }
    const current = Number((prod.meta?.stock_qty ?? 0));
    const next = current + (direction * qty);
    const newMeta = { ...(prod.meta || {}), stock_qty: round2(next) };
    await client.query(`UPDATE products SET meta=$2::jsonb WHERE id=$1`, [prod.id, JSON.stringify(newMeta)]);
  } catch { /* swallow if no products table */ }
}

function round2(n: number) { return Math.round((n + Number.EPSILON) * 100) / 100; }
