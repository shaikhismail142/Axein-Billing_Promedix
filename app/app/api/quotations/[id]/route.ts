// app/api/quotations/[id]/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

type Item = {
  product_id?: number | null;
  description: string;
  qty: number;
  price: number;
  tax: number;
  discount: number;
  batch_no?: string | null;
  exp_date?: string | null;
};

const toNum = (v: any, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const cleanText = (v: any) => {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  return t === "" ? null : t;
};
const cleanDate = (v: any) => {
  const t = cleanText(v);
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  return null;
};

function isValidItems(items: Item[]) {
  if (!Array.isArray(items) || items.length === 0) return false;
  return items.every((it) =>
    typeof it.description === "string" &&
    Number.isFinite(Number(it.qty)) && Number(it.qty) >= 0 &&
    Number.isFinite(Number(it.price)) && Number(it.price) >= 0 &&
    Number.isFinite(Number(it.tax)) && Number(it.tax) >= 0 &&
    Number.isFinite(Number(it.discount)) && Number(it.discount) >= 0
  );
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  // Quotation + customer name. Keep customer metadata in quotation.meta for compatibility.
  const q = await pool.query(
    `select q.*,
            c.name as customer_name
       from quotations q
       left join customers c on c.id = q.customer_id
      where q.id = $1
      limit 1`,
    [id]
  );
  if (q.rowCount === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const quotation = q.rows[0];

  // Items (description/qty/price/tax/discount)
  const itemsRs = await pool.query(
    `select id, product_id, description, qty, price, tax, discount, batch_no, exp_date
       from quotation_items
      where quotation_id = $1
      order by id asc`,
    [id]
  );

  return NextResponse.json({
    quotation,
    items: itemsRs.rows,
  });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
  }

  const payload = await req.json().catch(() => ({} as any));
  const {
    customer_id = null,
    customer_name = null,
    items = [],
    notes = "",
    terms = "",
    valid_until = null,
  }: {
    customer_id?: number | null;
    customer_name?: string | null;
    items?: Item[];
    notes?: string;
    terms?: string;
    valid_until?: string | null;
  } = payload ?? {};

  if (!isValidItems(items as Item[])) {
    return NextResponse.json({ ok: false, error: "Invalid or empty items" }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const exists = await client.query(`select id, meta from quotations where id = $1 for update`, [id]);
    if (!exists.rows.length) {
      await client.query("ROLLBACK");
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }

    let customerId: number | null = customer_id ?? null;
    const name = cleanText(customer_name);

    if (customerId && name) {
      await client.query(`update customers set name = $2 where id = $1`, [customerId, name]);
    } else if (!customerId && name) {
      const found = await client.query(`select id from customers where lower(name)=lower($1) limit 1`, [name]);
      if (found.rows.length) {
        customerId = found.rows[0].id;
      } else {
        const inserted = await client.query(`insert into customers (name) values ($1) returning id`, [name]);
        customerId = inserted.rows[0].id;
      }
    }

    const currentMeta = exists.rows[0]?.meta || {};
    const meta = {
      ...currentMeta,
      notes: notes ?? "",
      terms: terms ?? "",
    };

    await client.query(
      `update quotations
          set customer_id = $2,
              valid_until = $3,
              meta = $4::jsonb,
              updated_at = now()
        where id = $1`,
      [id, customerId, cleanDate(valid_until), JSON.stringify(meta)]
    );

    await client.query(`delete from quotation_items where quotation_id = $1`, [id]);

    for (const raw of items as Item[]) {
      const qty = toNum(raw.qty, 0);
      const price = toNum(raw.price, 0);
      const tax = toNum(raw.tax, 0);
      const discount = toNum(raw.discount, 0);
      const subtotal = qty * price;
      const discountAbs = discount > 0 ? (discount <= 100 ? subtotal * (discount / 100) : discount) : 0;
      const taxable = Math.max(0, subtotal - discountAbs);
      const total = taxable + taxable * (tax / 100);

      await client.query(
        `insert into quotation_items
          (quotation_id, product_id, description, qty, price, tax, discount, total, batch_no, exp_date)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          id,
          raw.product_id ?? null,
          raw.description ?? "",
          qty,
          price,
          tax,
          discount,
          Number(total.toFixed(2)),
          cleanText(raw.batch_no),
          cleanDate(raw.exp_date),
        ]
      );
    }

    await client.query("COMMIT");
    return NextResponse.json({ ok: true, data: { id } }, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("PATCH /api/quotations/[id] failed:", e);
    return NextResponse.json({ ok: false, error: "Failed to update quotation" }, { status: 500 });
  } finally {
    client.release();
  }
}
