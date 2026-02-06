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
  payment_method?: string | null;
  customer_id?: number | null;
  customer?: { name: string; phone?: string; gstin?: string; address?: string } | null;
  customer_name?: string | null;
  items?: ReqItem[];
  patient_name?: string | null;
  doctor_name?: string | null;
  dc_no?: string | null;
};

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
    const salesCols = await getColumns(client, "sales");
    const saleItemCols = await getColumns(client, "sale_items");
    const productCols = await getColumns(client, "products");
    const prodCols: ProductCols = {
      hasMeta: productCols.has("meta"),
      hasStockQty: productCols.has("stock_qty"),
      hasStock: productCols.has("stock"),
    };
    const salesHasMeta = salesCols.has("meta");

    // Read current for stock diff + meta
    const curSelectCols = ["id"];
    if (salesHasMeta) curSelectCols.push("meta");
    if (salesCols.has("amount_paid")) curSelectCols.push("amount_paid");
    if (salesCols.has("payment_method")) curSelectCols.push("payment_method");
    if (salesCols.has("payment_status")) curSelectCols.push("payment_status");
    const curSale = await client.query(
      `SELECT ${curSelectCols.join(", ")} FROM sales WHERE id=$1 FOR UPDATE`,
      [saleId]
    );
    if (!curSale.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }
    const curRow = curSale.rows[0] as any;
    const curMeta = salesHasMeta ? ((curRow.meta ?? {}) as Record<string, any>) : {};
    const prevIsReturn = salesHasMeta ? !!curMeta.is_return : false;

    const prevItems = await client.query(
      `SELECT name, qty FROM sale_items WHERE sale_id=$1`,
      [saleId]
    );

    // Undo previous stock effects
    for (const row of prevItems.rows) {
      await adjustStockForItem(client, { name: row.name }, Number(row.qty), prevIsReturn ? -1 : +1, prodCols);
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
      const itemCols: string[] = [];
      const itemVals: any[] = [];
      const addItem = (col: string, val: any) => {
        if (saleItemCols.has(col)) { itemCols.push(col); itemVals.push(val); }
      };
      addItem("sale_id", saleId);
      addItem("product_id", it.product_id ?? null);
      addItem("name", it.name.trim());
      addItem("hsn_code", null);
      addItem("gst_slab", gst);
      addItem("qty", qty);
      addItem("unit", "pcs");
      addItem("unit_price", rate);
      addItem("discount_pct", disc);
      addItem("taxable", round2(taxable));
      addItem("tax", round2(tax));
      if (saleItemCols.has("cgst")) addItem("cgst", round2(tax / 2));
      if (saleItemCols.has("sgst")) addItem("sgst", round2(tax / 2));
      if (saleItemCols.has("igst")) addItem("igst", 0);
      addItem("total", round2(lineTotal));
      if (saleItemCols.has("meta")) addItem("meta", JSON.stringify(itemMeta));

      const ph = itemVals.map((_, i) => `$${i + 1}`).join(", ");
      await client.query(
        `INSERT INTO sale_items (${itemCols.join(", ")}) VALUES (${ph})`,
        itemVals
      );

      // Apply new stock effects
      const nextIsReturn = !!body.is_return;
      await adjustStockForItem(client, { product_id: it.product_id, name: it.name }, qty, nextIsReturn ? +1 : -1, prodCols);
    }

    // Totals + meta
    if (body.is_return) { subtotal = -subtotal; tax_total = -tax_total; total = -total; }
    const existingPaid = salesCols.has("amount_paid")
      ? Number(curRow.amount_paid ?? 0)
      : Number(curMeta.amount_paid ?? 0);
    const amountPaid = round2(Number(body.amount_paid ?? existingPaid ?? 0));
    const paid = Math.max(amountPaid, 0);
    const pendingAmount = round2(Math.max(total - paid, 0));
    const paymentStatus =
      paid >= total - 0.01 ? "Paid" : paid > 0 ? "Partial" : "Pending";
    const existingMethod = salesCols.has("payment_method")
      ? (curRow.payment_method ?? null)
      : (curMeta.payment_method ?? null);
    const paymentMethod =
      typeof body.payment_method === "string"
        ? body.payment_method.trim()
        : existingMethod;

    const updateCols: string[] = ["customer_id=$2"];
    const updateVals: any[] = [saleId, await resolveCustomerId(client, body)];
    let idx = 3;

    const addCol = (col: string, val: any) => {
      if (salesCols.has(col)) { updateCols.push(`${col}=$${idx++}`); updateVals.push(val); }
    };

    addCol("subtotal", round2(subtotal));
    addCol("tax_total", round2(tax_total));
    addCol("total", round2(total));
    addCol("taxable_value", round2(subtotal));
    addCol("grand_total", round2(total));
    addCol("roundoff", 0);
    addCol("round_off", 0);
    if (salesCols.has("cgst")) addCol("cgst", round2(tax_total / 2));
    if (salesCols.has("sgst")) addCol("sgst", round2(tax_total / 2));
    if (salesCols.has("igst")) addCol("igst", 0);

    addCol("amount_paid", paid);
    addCol("pending_amount", pendingAmount);
    addCol("payment_status", paymentStatus);
    addCol("payment_method", paymentMethod || null);
    await client.query(
      `UPDATE sales SET ${updateCols.join(", ")} WHERE id=$1`,
      updateVals
    );

    const newMeta = {
      ...(curMeta || {}),
      is_return: !!body.is_return,
      amount_paid: paid,
      pending_amount: pendingAmount,
      payment_status: paymentStatus,
      payment_method: paymentMethod || null,
      notes: typeof (body as any).notes === 'string'
        ? (body as any).notes
        : (curMeta.notes ?? null),
      patient_name: typeof body.patient_name === 'string' ? body.patient_name : (curMeta.patient_name ?? null),
      doctor_name: typeof body.doctor_name === 'string' ? body.doctor_name : (curMeta.doctor_name ?? null),
      dc_no: typeof body.dc_no === 'string' ? body.dc_no : (curMeta.dc_no ?? null),
    };

    if (salesHasMeta) {
      await client.query(
        `UPDATE sales SET meta=$2::jsonb WHERE id=$1`,
        [saleId, JSON.stringify(newMeta)]
      );
    }

    await client.query("COMMIT");

    // Optional: refresh sale_payments AFTER commit (avoid aborting main tx)
    try {
      const hasPayments = await client.query(
        `SELECT to_regclass('public.sale_payments') IS NOT NULL AS ok`
      );
      if (hasPayments.rows?.[0]?.ok) {
        await client.query(`DELETE FROM sale_payments WHERE sale_id=$1`, [saleId]);
        if (paid > 0) {
          await client.query(
            `INSERT INTO sale_payments (sale_id, method, amount, ref)
             VALUES ($1, $2, $3, NULL)`,
            [saleId, paymentMethod || "cash", paid]
          );
        }
      }
    } catch (e: any) {
      console.warn("sale_payments update skipped:", e?.message || e);
    }
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

async function adjustStockForItem(
  client: any,
  product: { product_id?: number; name: string },
  qty: number,
  direction: 1|-1,
  cols: ProductCols
) {
  try {
    let prod = null;
    if (product.product_id) {
      const selectCols = ["id"];
      if (cols.hasMeta) selectCols.push("meta");
      if (cols.hasStockQty) selectCols.push("stock_qty");
      if (cols.hasStock) selectCols.push("stock");
      const r = await client.query(`SELECT ${selectCols.join(", ")} FROM products WHERE id=$1`, [product.product_id]);
      if (r.rowCount) prod = r.rows[0];
    }
    if (!prod) {
      const selectCols = ["id"];
      if (cols.hasMeta) selectCols.push("meta");
      if (cols.hasStockQty) selectCols.push("stock_qty");
      if (cols.hasStock) selectCols.push("stock");
      const r = await client.query(`SELECT ${selectCols.join(", ")} FROM products WHERE LOWER(name)=LOWER($1) LIMIT 1`, [product.name.trim()]);
      if (r.rowCount) prod = r.rows[0];
    }
    if (!prod) {
      if (cols.hasMeta) {
        const ins = await client.query(`INSERT INTO products (name, meta) VALUES ($1,'{}'::jsonb) RETURNING id, meta`, [product.name.trim()]);
        prod = ins.rows[0];
      } else {
        const ins = await client.query(`INSERT INTO products (name) VALUES ($1) RETURNING id`, [product.name.trim()]);
        prod = ins.rows[0];
      }
    }
    const current = cols.hasMeta
      ? Number((prod.meta?.stock_qty ?? 0))
      : cols.hasStockQty
      ? Number(prod.stock_qty ?? 0)
      : cols.hasStock
      ? Number(prod.stock ?? 0)
      : 0;
    const next = current + (direction * qty);
    if (cols.hasMeta) {
      const newMeta = { ...(prod.meta || {}), stock_qty: round2(next) };
      await client.query(`UPDATE products SET meta=$2::jsonb WHERE id=$1`, [prod.id, JSON.stringify(newMeta)]);
    } else if (cols.hasStockQty) {
      await client.query(`UPDATE products SET stock_qty=$2 WHERE id=$1`, [prod.id, round2(next)]);
    } else if (cols.hasStock) {
      await client.query(`UPDATE products SET stock=$2 WHERE id=$1`, [prod.id, round2(next)]);
    }
  } catch { /* swallow if no products table */ }
}

function round2(n: number) { return Math.round((n + Number.EPSILON) * 100) / 100; }
