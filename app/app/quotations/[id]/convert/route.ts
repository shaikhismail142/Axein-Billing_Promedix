import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/app/lib/db';

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
function nowIST(): Date {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000);
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

// Assumes you already have /api/sales creation logic.
// Here we read the quotation and call INSERTs similarly (without mutating stock if your app does it elsewhere).
export async function POST(_: NextRequest, { params }: { params: { id: string } }) {
  const db = await getDb();

  const q = (await db.query(`select * from quotations where id = $1`, [params.id])).rows[0];
  if (!q) return NextResponse.json({ error: 'Quotation not found' }, { status: 404 });
  const items = (await db.query(`select * from quotation_items where quotation_id = $1`, [params.id])).rows;

  // create sale (reusing your sales schema)
  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const invoice_no = await getNextInvoiceNo(client);
    let subtotal = 0, tax_total = 0, total = 0;

    const saleIns = await client.query(
      `insert into sales (customer_id, invoice_date, invoice_no, subtotal, tax_total, total, meta)
       values ($1, now(), $2, $3, $4, $5, $6::jsonb) returning *`,
      [
        q.customer_id,
        invoice_no,
        0,
        0,
        0,
        JSON.stringify({ source_quotation_id: q.id, notes: q.meta?.notes || '' }),
      ]
    );
    const sale = saleIns.rows[0];

    for (const it of items) {
      const qty = Number(it.qty || 0);
      const rate = Number(it.price || 0);
      const gst = Number(it.tax || 0);
      const discRaw = Number(it.discount || 0);
      const gross = qty * rate;
      const discAbs = discRaw > 0 ? (discRaw <= 100 ? gross * (discRaw / 100) : discRaw) : 0;
      const discPct = gross > 0 ? (discAbs / gross) * 100 : 0;
      const taxable = round2(gross - discAbs);
      const tax = round2((gst / 100) * taxable);
      const lineTotal = round2(taxable + tax);

      subtotal += taxable;
      tax_total += tax;
      total += lineTotal;

      const meta = {
        ...(it.batch_no ? { batch_no: it.batch_no } : {}),
        ...(it.exp_date ? { exp_date: it.exp_date } : {}),
      };

      await client.query(
        `insert into sale_items
           (sale_id, product_id, name, gst_slab, qty, unit_price, discount_pct, taxable, tax, total, meta)
         values
           ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          sale.id,
          it.product_id ?? null,
          it.description || "Item",
          gst,
          qty,
          rate,
          round2(discPct),
          taxable,
          tax,
          lineTotal,
          JSON.stringify(meta),
        ]
      );
    }

    const subtotalRounded = round2(subtotal);
    const taxRounded = round2(tax_total);
    const totalRounded = round2(total);
    const amountPaid = 0;
    const pendingAmount = totalRounded;
    const paymentStatus = "Pending";

    try {
      await client.query(
        `update sales
           set subtotal=$2, tax_total=$3, total=$4,
               amount_paid=$5, pending_amount=$6, payment_status=$7
         where id=$1`,
        [sale.id, subtotalRounded, taxRounded, totalRounded, amountPaid, pendingAmount, paymentStatus]
      );
    } catch {
      // fallback if payment columns don't exist
      await client.query(
        `update sales set subtotal=$2, tax_total=$3, total=$4 where id=$1`,
        [sale.id, subtotalRounded, taxRounded, totalRounded]
      );
    }

    await client.query("COMMIT");
    return NextResponse.json({ sale_id: sale.id });
  } catch (e) {
    await client.query("ROLLBACK");
    return NextResponse.json({ error: "Failed to convert quotation" }, { status: 500 });
  } finally {
    client.release();
  }
}
