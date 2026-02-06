// app/api/purchases/route.ts
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { guardApiActivated } from "@/lib/activation-guard";

/* ---------------------------------- types --------------------------------- */

type ItemIn = {
  product_id: string | number;
  qty: number | string;
  cost_price?: number | string | null;
  mrp?: number | string | null;
  tax_rate?: number | string | null;
  discount?: number | string | null;
  batch_no?: string | null;
  mfg_date?: string | null;  // YYYY-MM-DD
  exp_date?: string | null;  // YYYY-MM-DD
  name?: string | null;      // optional, used when auto-creating product
};

export type PurchaseCreateIn = {
  vendor_name?: string | null;
  supplier_id?: string | null;
  invoice_no?: string | null;
  purchase_date?: string | null; // YYYY-MM-DD
  notes?: string | null;
  paid?: boolean;
  amount_paid?: number | string | null;
  payment_method?: string | null;
  add_to_inventory?: boolean;
  items: ItemIn[];
};

/* --------------------------------- helpers -------------------------------- */

const asNum = (v: any, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const normQty = (v: any) => clamp(asNum(v, 0), 0, 1e12);
const normMoney = (v: any) => clamp(asNum(v, 0), -1e12, 1e12);
const normTax = (v: any) => clamp(asNum(v, 0), 0, 999.99);
const dateOrNull = (s?: string | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);

async function getTableColumns(client: any, table: string): Promise<Set<string>> {
  const r = await client.query(
    `SELECT LOWER(column_name) AS col
       FROM information_schema.columns
      WHERE table_schema='public' AND table_name = $1`,
    [table]
  );
  return new Set<string>(r.rows.map((x: any) => x.col));
}

async function detectBatchesTable(client: any): Promise<{ table: "product_batches" | "batches"; cols: Set<string> } | null> {
  const r = await client.query(
    `SELECT COALESCE(
       (SELECT 'product_batches' WHERE to_regclass('public.product_batches') IS NOT NULL),
       (SELECT 'batches'          WHERE to_regclass('public.batches') IS NOT NULL)
     ) AS t`
  );
  const table = r.rows?.[0]?.t as "product_batches" | "batches" | null;
  if (!table) return null;
  const cols = await getTableColumns(client, table);
  return { table, cols };
}

/* ----------------------------------- GET ---------------------------------- */
/** List purchases with search + pagination support */
export async function GET(req: NextRequest) {
  await guardApiActivated(true);

  const { searchParams } = new URL(req.url);
  const limit = Math.max(1, Math.min(100, Number(searchParams.get("limit") || 20)));
  const offset = Math.max(0, Number(searchParams.get("offset") || 0));
  const q = (searchParams.get("q") || "").trim().toLowerCase();

  const client = await pool.connect();
  try {
    const cols = await getTableColumns(client, "purchases");

    // search field preference
    const invNoCol = cols.has("invoice_no") ? "invoice_no" : (cols.has("bill_no") ? "bill_no" : null);
    const idCol = cols.has("id") ? "id" : null;

    const where: string[] = [];
    const params: any[] = [];

    if (q) {
      if (invNoCol) {
        where.push(`${invNoCol} ILIKE $${params.length + 1}`);
        params.push(`%${q}%`);
      } else if (idCol) {
        where.push(`CAST(${idCol} AS TEXT) ILIKE $${params.length + 1}`);
        params.push(`%${q}%`);
      }
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const totalRes = await client.query(`SELECT COUNT(*)::int AS c FROM purchases ${whereSql}`, params);
    const total = totalRes.rows?.[0]?.c ?? 0;

    params.push(limit, offset);

    const selectList = [
      idCol ? `${idCol} AS id` : "NULL AS id",
      cols.has("supplier_id") ? "supplier_id" : "NULL AS supplier_id",
      invNoCol ? `${invNoCol} AS invoice_no` : "NULL AS invoice_no",
      cols.has("invoice_date")
        ? "to_char(invoice_date, 'YYYY-MM-DD') AS invoice_date"
        : (cols.has("bill_date") ? "to_char(bill_date, 'YYYY-MM-DD') AS invoice_date" : "NULL AS invoice_date"),
      cols.has("total_amount") ? "total_amount::text" :
        (cols.has("grand_total") ? "grand_total::text" : "'0'::text AS total_amount"),
      cols.has("total_tax") ? "total_tax::text" :
        (cols.has("tax_total") ? "tax_total::text" : "'0'::text AS total_tax"),
      cols.has("amount_paid")
        ? "amount_paid::text"
        : "COALESCE((meta->>'amount_paid')::text, '0') AS amount_paid",
      cols.has("pending_amount")
        ? "pending_amount::text"
        : "NULL AS pending_amount",
      cols.has("payment_status")
        ? "payment_status"
        : "COALESCE(meta->>'payment_status', NULL) AS payment_status",
      cols.has("payment_method")
        ? "payment_method"
        : "COALESCE(meta->>'payment_method', NULL) AS payment_method",
      cols.has("status") ? "status" : "NULL AS status",
      cols.has("meta") ? "meta" : "'{}'::jsonb AS meta",
      cols.has("created_at") ? "created_at" : "now() AS created_at",
    ].join(", ");

    const orderBy =
      (cols.has("created_at") && "created_at DESC") ||
      (idCol && `${idCol} DESC`) ||
      "1";

    const listRes = await client.query(
      `SELECT ${selectList}
         FROM purchases
         ${whereSql}
         ORDER BY ${orderBy}
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    return NextResponse.json({ ok: true, total, rows: listRes.rows });
  } catch (err: any) {
    console.error("GET /api/purchases", err);
    return NextResponse.json({ ok: false, error: err?.message || String(err) }, { status: 500 });
  } finally {
    client.release();
  }
}

/* ----------------------------------- POST --------------------------------- */
export async function POST(req: NextRequest) {
  await guardApiActivated(true);

  const body = (await req.json().catch(() => ({}))) as PurchaseCreateIn;
  if (!body || !Array.isArray(body.items) || body.items.length === 0) {
    return NextResponse.json({ ok: false, error: "No purchase items provided" }, { status: 400 });
  }
  for (let i = 0; i < body.items.length; i++) {
    const it = body.items[i];
    if (!it?.product_id) return NextResponse.json({ ok: false, error: `items[${i}].product_id is required` }, { status: 400 });
    if (normQty(it.qty) <= 0) return NextResponse.json({ ok: false, error: `items[${i}].qty must be > 0` }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const purchasesCols = await getTableColumns(client, "purchases");
    const itemsCols = await getTableColumns(client, "purchase_items");

    // Validate product IDs (avoid FK failure when products table exists)
    const prodTableExists = await client
      .query(`SELECT to_regclass('public.products') IS NOT NULL AS ok`)
      .then((r: any) => !!r.rows?.[0]?.ok);

    if (prodTableExists) {
      const productIds = Array.from(new Set(body.items.map((it) => String(it.product_id))));
      const found = await client.query(
        `SELECT id::text FROM products WHERE id::text = ANY($1::text[])`,
        [productIds]
      );
      const foundSet = new Set<string>(found.rows.map((r: any) => String(r.id)));
      const missing = productIds.filter((id) => !foundSet.has(String(id)));
      if (missing.length > 0) {
        await client.query("ROLLBACK").catch(() => {});
        return NextResponse.json(
          { ok: false, error: `Unknown product_id(s): ${missing.join(", ")}` },
          { status: 400 }
        );
      }
    }

    // Header data
    const invoice_no = body.invoice_no || null;
    const invoice_date = dateOrNull(body.purchase_date) || null;
    const supplier_id = body.supplier_id || null;

    // Totals (safe math)
    const subtotal = body.items.reduce((acc, it) => acc + normQty(it.qty) * normMoney(it.cost_price), 0);
    const total_tax = body.items.reduce((acc, it) => acc + (normTax(it.tax_rate) / 100) * (normQty(it.qty) * normMoney(it.cost_price)), 0);
    const discount_total = body.items.reduce((a, it) => a + normMoney(it.discount), 0);
    const total_amount = subtotal + total_tax - discount_total;

    const amount_paid = normMoney(body.amount_paid ?? (body.paid ? total_amount : 0));
    const pending_amount = Math.max(0, normMoney(total_amount - amount_paid));
    const payment_status =
      amount_paid >= total_amount - 0.01 ? "Paid" : amount_paid > 0 ? "Partial" : "Pending";
    const payment_method = body.payment_method ? String(body.payment_method) : null;

    const meta: any = {
      vendor_name: body.vendor_name || null,
      notes: body.notes || null,
      paid: !!body.paid || payment_status === "Paid",
      posted: !!body.add_to_inventory,
      amount_paid,
      pending_amount,
      payment_status,
      payment_method,
    };
    if (!purchasesCols.has("invoice_no") && !purchasesCols.has("bill_no")) meta.invoice_no = invoice_no;
    if (!purchasesCols.has("invoice_date") && !purchasesCols.has("bill_date") && invoice_date) meta.invoice_date = invoice_date;
    if (!purchasesCols.has("supplier_id") && supplier_id) meta.supplier_id = supplier_id;
    if (!purchasesCols.has("total_amount") && !purchasesCols.has("grand_total")) {
      meta.totals = { subtotal, total_tax, discount_total, total_amount };
    }

    // ---------- Insert purchase header (support both schemas) ----------
    const pCols: string[] = [];
    const pVals: any[] = [];
    const pPh: string[] = [];
    let i = 1;

    if (purchasesCols.has("supplier_id")) { pCols.push("supplier_id"); pVals.push(supplier_id); pPh.push(`$${i++}`); }
    if (purchasesCols.has("invoice_no")) { pCols.push("invoice_no"); pVals.push(invoice_no); pPh.push(`$${i++}`); }
    if (purchasesCols.has("bill_no"))     { pCols.push("bill_no");     pVals.push(invoice_no); pPh.push(`$${i++}`); }

    if (purchasesCols.has("invoice_date")) {
      pCols.push("invoice_date"); pVals.push(invoice_date); pPh.push(`COALESCE($${i++}::date, now())`);
    } else if (purchasesCols.has("bill_date")) {
      pCols.push("bill_date"); pVals.push(invoice_date); pPh.push(`COALESCE($${i++}::date, now())`);
    }

    if (purchasesCols.has("total_amount")) { pCols.push("total_amount"); pVals.push(total_amount); pPh.push(`$${i++}`); }
    if (purchasesCols.has("grand_total"))  { pCols.push("grand_total");  pVals.push(total_amount); pPh.push(`$${i++}`); }
    if (purchasesCols.has("tax_total"))    { pCols.push("tax_total");    pVals.push(total_tax);    pPh.push(`$${i++}`); }
    if (purchasesCols.has("subtotal"))     { pCols.push("subtotal");     pVals.push(subtotal);     pPh.push(`$${i++}`); }
    if (purchasesCols.has("discount_total")) { pCols.push("discount_total"); pVals.push(discount_total); pPh.push(`$${i++}`); }
    if (purchasesCols.has("amount_paid")) { pCols.push("amount_paid"); pVals.push(amount_paid); pPh.push(`$${i++}`); }
    if (purchasesCols.has("pending_amount")) { pCols.push("pending_amount"); pVals.push(pending_amount); pPh.push(`$${i++}`); }
    if (purchasesCols.has("payment_status")) { pCols.push("payment_status"); pVals.push(payment_status); pPh.push(`$${i++}`); }
    if (purchasesCols.has("payment_method")) { pCols.push("payment_method"); pVals.push(payment_method); pPh.push(`$${i++}`); }

    if (purchasesCols.has("meta")) { pCols.push("meta"); pVals.push(meta); pPh.push(`$${i++}`); }
    if (purchasesCols.has("status")) { pCols.push("status"); pVals.push(body.add_to_inventory ? "applied" : "draft"); pPh.push(`$${i++}`); }

    let purchase_id: string;
    if (pCols.length === 0) {
      const r = await client.query(`INSERT INTO purchases DEFAULT VALUES RETURNING id`);
      purchase_id = String(r.rows[0].id);
    } else {
      const r = await client.query(
        `INSERT INTO purchases (${pCols.join(", ")})
         VALUES (${pPh.join(", ")})
         RETURNING id`,
        pVals
      );
      purchase_id = String(r.rows[0].id);
    }

    // ---------- Insert items (handle alt column names) ----------
    for (const it of body.items) {
      const qty = normQty(it.qty);
      const cost = normMoney(it.cost_price);
      const mrp  = it.mrp == null ? null : normMoney(it.mrp);
      const tax  = normTax(it.tax_rate);
      const disc = it.discount == null ? 0 : normMoney(it.discount);

      const cols: string[] = ["purchase_id", "product_id"];
      const vals: any[] = [purchase_id, it.product_id];
      const ph: string[] = [`$1`, `$2`];
      let j = 3;

      // qty
      if (itemsCols.has("qty")) { cols.push("qty"); vals.push(qty); ph.push(`$${j++}`); }

      // cost / rate
      if (itemsCols.has("cost_price")) { cols.push("cost_price"); vals.push(cost); ph.push(`$${j++}`); }
      if (itemsCols.has("purchase_rate")) { cols.push("purchase_rate"); vals.push(cost); ph.push(`$${j++}`); }

      // mrp
      if (itemsCols.has("mrp")) { cols.push("mrp"); vals.push(mrp); ph.push(`$${j++}`); }

      // tax%
      if (itemsCols.has("tax_rate")) { cols.push("tax_rate"); vals.push(tax); ph.push(`$${j++}`); }
      if (itemsCols.has("gst_slab")) { cols.push("gst_slab"); vals.push(tax); ph.push(`$${j++}`); }

      // discount value / pct
      if (itemsCols.has("discount")) { cols.push("discount"); vals.push(disc); ph.push(`$${j++}`); }
      if (itemsCols.has("discount_pct")) { cols.push("discount_pct"); vals.push(disc); ph.push(`$${j++}`); }

      // description fallback (if schema has it and we have a name)
      if (itemsCols.has("description") && (it as any).name) {
        cols.push("description"); vals.push((it as any).name); ph.push(`$${j++}`);
      }

      // meta: stash batch
      if (itemsCols.has("meta")) {
        const itemMeta: any = {};
        if (it.batch_no || it.mfg_date || it.exp_date) {
          itemMeta.batch = {
            batch_no: it.batch_no || null,
            mfg_date: dateOrNull(it.mfg_date),
            exp_date: dateOrNull(it.exp_date),
          };
        }
        cols.push("meta"); vals.push(itemMeta); ph.push(`$${j++}`);
      }

      await client.query(
        `INSERT INTO purchase_items (${cols.join(", ")})
         VALUES (${ph.join(", ")})`,
        vals
      );
    }

    // ---------- Optional inventory posting ----------
    if (body.add_to_inventory) {
      const batchInfo = await detectBatchesTable(client);
      if (batchInfo) {
        const { table: batchesTable, cols: bCols } = batchInfo;
        const bnCol = bCols.has("batch_no") ? "batch_no" : (bCols.has("batch_code") ? "batch_code" : null);
        const qtyCol = bCols.has("qty") ? "qty" : (bCols.has("quantity") ? "quantity" : null);
        const mfgCol = bCols.has("mfg_date") ? "mfg_date" : (bCols.has("mfd_date") ? "mfd_date" : null);
        const expCol = bCols.has("exp_date") ? "exp_date" : (bCols.has("expiry_date") ? "expiry_date" : null);

        for (const it of body.items) {
          const bn = (it.batch_no || "").trim();
          const md = dateOrNull(it.mfg_date);
          const ed = dateOrNull(it.exp_date);
          const qty = normQty(it.qty);

          const whereParts: string[] = [`product_id = $1`];
          const selParams: any[] = [it.product_id];
          let pIdx = 2;

          if (bnCol)  { whereParts.push(`COALESCE(LOWER(${bnCol}), '') = LOWER($${pIdx++})`); selParams.push(bn || ""); }
          if (mfgCol) { whereParts.push(`COALESCE(${mfgCol}::date, '1900-01-01') = COALESCE($${pIdx++}::date, '1900-01-01')`); selParams.push(md); }
          if (expCol) { whereParts.push(`COALESCE(${expCol}::date, '1900-01-01') = COALESCE($${pIdx++}::date, '1900-01-01')`); selParams.push(ed); }

          const selSql = `SELECT id FROM ${batchesTable} WHERE ${whereParts.join(" AND ")} LIMIT 1`;
          const sel = await client.query(selSql, selParams);

          if (sel.rowCount > 0 && qtyCol) {
            const bid = String(sel.rows[0].id);
            await client.query(`UPDATE ${batchesTable} SET ${qtyCol} = ${qtyCol} + $1 WHERE id = $2`, [qty, bid]);
          } else {
            const insCols: string[] = ["product_id"];
            const insPh: string[] = ["$1"];
            const insVals: any[] = [it.product_id];
            let k = 2;

            if (bnCol)  { insCols.push(bnCol);  insPh.push(`NULLIF($${k++},'')`); insVals.push(bn); }
            if (mfgCol) { insCols.push(mfgCol); insPh.push(`$${k++}`); insVals.push(md); }
            if (expCol) { insCols.push(expCol); insPh.push(`$${k++}`); insVals.push(ed); }
            if (qtyCol) { insCols.push(qtyCol); insPh.push(`$${k++}`); insVals.push(qty); }
            if (bCols.has("cost_price")) { insCols.push("cost_price"); insPh.push(`$${k++}`); insVals.push(normMoney(it.cost_price)); }
            if (bCols.has("mrp"))        { insCols.push("mrp");        insPh.push(`$${k++}`); insVals.push(it.mrp == null ? null : normMoney(it.mrp)); }
            if (bCols.has("supplier_id")){ insCols.push("supplier_id");insPh.push(`$${k++}`); insVals.push(body.supplier_id || null); }
            if (bCols.has("meta"))       { insCols.push("meta");       insPh.push(`$${k++}`); insVals.push({ source: "purchase", purchase_id }); }

            const insSql = `INSERT INTO ${batchesTable} (${insCols.join(", ")}) VALUES (${insPh.join(", ")})`;
            await client.query(insSql, insVals);
          }
        }

        // Mark posted=true (if purchases.meta exists)
        if (purchasesCols.has("meta")) {
          await client.query(
            `UPDATE purchases
               SET meta = jsonb_set(coalesce(meta,'{}'::jsonb), '{posted}', 'true'::jsonb, true)
             WHERE id = $1`,
            [purchase_id]
          );
        }
      }
    }

    await client.query("COMMIT");
    return NextResponse.json({ ok: true, purchase_id, total_amount, subtotal });
  } catch (err: any) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("POST /api/purchases error:", err);
    return NextResponse.json({ ok: false, error: err?.message || String(err) }, { status: 500 });
  } finally {
    client.release();
  }
}
