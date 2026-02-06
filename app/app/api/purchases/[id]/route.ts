export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { guardApiActivated } from "@/lib/activation-guard";

const asNum = (v: any, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const dateOrNull = (s?: string | null) =>
  s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;

async function getTableColumns(client: any, table: string): Promise<Set<string>> {
  const r = await client.query(
    `SELECT LOWER(column_name) AS col
       FROM information_schema.columns
      WHERE table_schema='public' AND table_name = $1`,
    [table]
  );
  return new Set<string>(r.rows.map((x: any) => x.col));
}

async function productsTableExists(client: any) {
  const r = await client.query(`SELECT to_regclass('public.products') IS NOT NULL AS ok`);
  return !!r.rows?.[0]?.ok;
}

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  await guardApiActivated(true);
  const id = params.id;

  const client = await pool.connect();
  try {
    const pCols = await getTableColumns(client, "purchases");
    const iCols = await getTableColumns(client, "purchase_items");
    const hasProducts = await productsTableExists(client);

    const selectHdr = [
      pCols.has("id") ? "id" : "NULL AS id",
      pCols.has("supplier_id") ? "supplier_id" : "NULL AS supplier_id",
      pCols.has("invoice_no") ? "invoice_no" : (pCols.has("bill_no") ? "bill_no AS invoice_no" : "NULL AS invoice_no"),
      pCols.has("invoice_date")
        ? "to_char(invoice_date, 'YYYY-MM-DD') AS invoice_date"
        : (pCols.has("bill_date") ? "to_char(bill_date, 'YYYY-MM-DD') AS invoice_date" : "NULL AS invoice_date"),
      pCols.has("total_amount") ? "total_amount::text" : (pCols.has("grand_total") ? "grand_total::text AS total_amount" : "'0'::text AS total_amount"),
      pCols.has("total_tax") ? "total_tax::text" : (pCols.has("tax_total") ? "tax_total::text AS total_tax" : "'0'::text AS total_tax"),
      pCols.has("amount_paid")
        ? "amount_paid::text"
        : "COALESCE((meta->>'amount_paid')::text, '0') AS amount_paid",
      pCols.has("pending_amount")
        ? "pending_amount::text"
        : "NULL AS pending_amount",
      pCols.has("payment_status")
        ? "payment_status"
        : "COALESCE(meta->>'payment_status', NULL) AS payment_status",
      pCols.has("payment_method")
        ? "payment_method"
        : "COALESCE(meta->>'payment_method', NULL) AS payment_method",
      pCols.has("meta") ? "meta" : "'{}'::jsonb AS meta",
      pCols.has("created_at") ? "created_at" : "now() AS created_at",
    ].join(", ");
    const hdr = await client.query(`SELECT ${selectHdr} FROM purchases WHERE id = $1`, [id]);
    if (hdr.rowCount === 0) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

    // items + product label
    const productNameSql = hasProducts
      ? `COALESCE(pr.name, ${iCols.has("description") ? "pi.description" : "NULL"}, pi.product_id::text)`
      : (iCols.has("description") ? "COALESCE(pi.description, pi.product_id::text)" : "pi.product_id::text");

    const selectIt = [
      iCols.has("id") ? "pi.id" : "NULL AS id",
      iCols.has("product_id") ? "pi.product_id" : "NULL AS product_id",
      `(${productNameSql}) AS product_label`,
      iCols.has("qty") ? "pi.qty::text" : "'0'::text AS qty",
      iCols.has("cost_price") ? "pi.cost_price::text" : (iCols.has("purchase_rate") ? "pi.purchase_rate::text AS cost_price" : "'0'::text AS cost_price"),
      iCols.has("mrp") ? "pi.mrp::text" : "NULL::text AS mrp",
      iCols.has("tax_rate") ? "pi.tax_rate::text" : (iCols.has("gst_slab") ? "pi.gst_slab::text AS tax_rate" : "'0'::text AS tax_rate"),
      iCols.has("discount") ? "pi.discount::text" : (iCols.has("discount_pct") ? "pi.discount_pct::text AS discount" : "'0'::text AS discount"),
      iCols.has("meta") ? "pi.meta" : "'{}'::jsonb AS meta",
    ].join(", ");

    const joinProducts = hasProducts ? "LEFT JOIN products pr ON pr.id::text = pi.product_id::text" : "";
    const items = await client.query(
      `SELECT ${selectIt} FROM purchase_items pi ${joinProducts} WHERE pi.purchase_id = $1 ORDER BY ${iCols.has("id") ? "pi.id" : "1"}`,
      [id]
    );

    return NextResponse.json({ ok: true, purchase: hdr.rows[0], items: items.rows });
  } catch (err: any) {
    console.error("GET /api/purchases/[id]", err);
    return NextResponse.json({ ok: false, error: err?.message || String(err) }, { status: 500 });
  } finally {
    client.release();
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  await guardApiActivated(true);
  const id = params.id;
  const body = await req.json().catch(() => ({}));

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const pCols = await getTableColumns(client, "purchases");
    const iCols = await getTableColumns(client, "purchase_items");

    const fields: string[] = [];
    const values: any[] = [];
    let i = 1;

    if (body.invoice_no !== undefined && pCols.has("invoice_no")) {
      fields.push(`invoice_no = $${i++}`); values.push(body.invoice_no ?? null);
    }
    if (body.invoice_date !== undefined) {
      if (pCols.has("invoice_date")) {
        fields.push(`invoice_date = COALESCE($${i++}::date, invoice_date)`); values.push(body.invoice_date ?? null);
      } else if (pCols.has("bill_date")) {
        fields.push(`bill_date = COALESCE($${i++}::date, bill_date)`); values.push(body.invoice_date ?? null);
      }
    }
    if (body.meta !== undefined && pCols.has("meta")) {
      fields.push(`meta = coalesce(meta,'{}'::jsonb) || $${i++}`); values.push(body.meta ?? {});
    }
    if (body.amount_paid !== undefined && pCols.has("amount_paid")) {
      fields.push(`amount_paid = $${i++}`); values.push(asNum(body.amount_paid));
    }
    if (body.payment_method !== undefined && pCols.has("payment_method")) {
      fields.push(`payment_method = $${i++}`); values.push(body.payment_method ?? null);
    }

    if (fields.length) {
      await client.query(`UPDATE purchases SET ${fields.join(", ")} WHERE id = $${i}`, [...values, id]);
    }

    if (body.amount_paid !== undefined) {
      const totRes = await client.query(
        `SELECT COALESCE(grand_total, total_amount, 0) AS total FROM purchases WHERE id=$1`,
        [id]
      );
      const total = asNum(totRes.rows?.[0]?.total ?? 0);
      const paid = asNum(body.amount_paid);
      const pending = Math.max(total - paid, 0);
      const status = paid >= total - 0.01 ? "Paid" : paid > 0 ? "Partial" : "Pending";
      if (pCols.has("pending_amount")) {
        await client.query(`UPDATE purchases SET pending_amount=$1 WHERE id=$2`, [pending, id]);
      }
      if (pCols.has("payment_status")) {
        await client.query(`UPDATE purchases SET payment_status=$1 WHERE id=$2`, [status, id]);
      }
      if (pCols.has("meta")) {
        await client.query(
          `UPDATE purchases SET meta = coalesce(meta,'{}') || $1::jsonb WHERE id = $2`,
          [JSON.stringify({ amount_paid: paid, pending_amount: pending, payment_status: status }), id]
        );
      }
    }

    if (Array.isArray(body.items)) {
      await client.query(`DELETE FROM purchase_items WHERE purchase_id = $1`, [id]);

      let subtotal = 0, total_tax = 0, discount_total = 0;
      for (const it of body.items) {
        const qty = asNum(it.qty);
        const cost = asNum(it.cost_price);
        subtotal += qty * cost;
        total_tax += (asNum(it.tax_rate) / 100) * (qty * cost);
        discount_total += asNum(it.discount);

        const cols: string[] = ["purchase_id", "product_id"];
        const vals: any[] = [id, it.product_id];
        const ph: string[] = [`$1`, `$2`];
        let j = 3;

        if (iCols.has("qty"))           { cols.push("qty");           vals.push(qty); ph.push(`$${j++}`); }
        if (iCols.has("purchase_rate")) { cols.push("purchase_rate"); vals.push(cost); ph.push(`$${j++}`); }
        if (iCols.has("cost_price"))    { cols.push("cost_price");    vals.push(cost); ph.push(`$${j++}`); }
        if (iCols.has("mrp"))           { cols.push("mrp");           vals.push(it.mrp == null ? null : asNum(it.mrp)); ph.push(`$${j++}`); }
        if (iCols.has("gst_slab"))      { cols.push("gst_slab");      vals.push(it.tax_rate == null ? 0 : asNum(it.tax_rate)); ph.push(`$${j++}`); }
        if (iCols.has("tax_rate"))      { cols.push("tax_rate");      vals.push(it.tax_rate == null ? 0 : asNum(it.tax_rate)); ph.push(`$${j++}`); }
        if (iCols.has("discount_pct"))  { cols.push("discount_pct");  vals.push(it.discount == null ? 0 : asNum(it.discount)); ph.push(`$${j++}`); }
        if (iCols.has("discount"))      { cols.push("discount");      vals.push(it.discount == null ? 0 : asNum(it.discount)); ph.push(`$${j++}`); }

        if (iCols.has("meta")) {
          const itemMeta: any = {};
          const bn = it?.meta?.batch?.batch_no ?? it.batch_no ?? null;
          const md = it?.meta?.batch?.mfg_date ?? it.mfg_date ?? null;
          const ed = it?.meta?.batch?.exp_date ?? it.exp_date ?? null;
          if (bn || md || ed) {
            itemMeta.batch = { batch_no: bn || null, mfg_date: dateOrNull(md), exp_date: dateOrNull(ed) };
          }
          cols.push("meta"); vals.push(itemMeta); ph.push(`$${j++}`);
        }

        await client.query(
          `INSERT INTO purchase_items (${cols.join(", ")}) VALUES (${ph.join(", ")})`,
          vals
        );
      }

      // write totals to whichever columns exist
      if (pCols.has("subtotal"))       await client.query(`UPDATE purchases SET subtotal = $1 WHERE id = $2`, [subtotal, id]);
      if (pCols.has("tax_total"))      await client.query(`UPDATE purchases SET tax_total = $1 WHERE id = $2`, [total_tax, id]);
      if (pCols.has("discount_total")) await client.query(`UPDATE purchases SET discount_total = $1 WHERE id = $2`, [discount_total, id]);
      const grand = subtotal + total_tax - discount_total;
      if (pCols.has("grand_total"))    await client.query(`UPDATE purchases SET grand_total = $1 WHERE id = $2`, [grand, id]);
      if (pCols.has("total_amount"))   await client.query(`UPDATE purchases SET total_amount = $1 WHERE id = $2`, [grand, id]);
      if (pCols.has("total_tax"))      await client.query(`UPDATE purchases SET total_tax = $1 WHERE id = $2`, [total_tax, id]);
      if (!pCols.has("subtotal") && pCols.has("meta")) {
        await client.query(
          `UPDATE purchases SET meta = jsonb_set(coalesce(meta,'{}'), '{totals}', $1::jsonb, true) WHERE id = $2`,
          [JSON.stringify({ subtotal, total_tax, discount_total, total_amount: grand }), id]
        );
      }

      // Recompute payment status if columns exist
      if (pCols.has("amount_paid") || pCols.has("pending_amount") || pCols.has("payment_status")) {
        const paid = asNum(body.amount_paid ?? 0);
        const pending = Math.max(grand - paid, 0);
        const status = paid >= grand - 0.01 ? "Paid" : paid > 0 ? "Partial" : "Pending";
        if (pCols.has("amount_paid")) {
          await client.query(`UPDATE purchases SET amount_paid=$1 WHERE id=$2`, [paid, id]);
        }
        if (pCols.has("pending_amount")) {
          await client.query(`UPDATE purchases SET pending_amount=$1 WHERE id=$2`, [pending, id]);
        }
        if (pCols.has("payment_status")) {
          await client.query(`UPDATE purchases SET payment_status=$1 WHERE id=$2`, [status, id]);
        }
        if (pCols.has("meta")) {
          await client.query(
            `UPDATE purchases SET meta = coalesce(meta,'{}') || $1::jsonb WHERE id = $2`,
            [JSON.stringify({ amount_paid: paid, pending_amount: pending, payment_status: status }), id]
          );
        }
      }
    }

    await client.query("COMMIT");
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("PATCH /api/purchases/[id]", err);
    return NextResponse.json({ ok: false, error: err?.message || String(err) }, { status: 500 });
  } finally {
    client.release();
  }
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  await guardApiActivated(true);
  const id = params.id;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM purchase_items WHERE purchase_id = $1`, [id]);
    await client.query(`DELETE FROM purchases WHERE id = $1`, [id]);
    await client.query("COMMIT");
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("DELETE /api/purchases/[id]", err);
    return NextResponse.json({ ok: false, error: err?.message || String(err) }, { status: 500 });
  } finally {
    client.release();
  }
}
