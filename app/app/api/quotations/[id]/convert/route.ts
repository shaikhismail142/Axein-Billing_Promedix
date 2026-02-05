// app/api/quotations/[id]/convert/route.ts
import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
function toNum(v: any, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}
// Clamp helpers
function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const qid = Number(params.id);
  if (!Number.isFinite(qid)) {
    return NextResponse.json({ ok: false, error: 'Invalid quotation id' }, { status: 400 });
  }

  // Idempotency: meta.source_quotation_id
  const existed = (
    await pool.query(
      `select id from sales where (meta->>'source_quotation_id')::int = $1 limit 1`,
      [qid]
    )
  ).rows[0];
  if (existed?.id) {
    return NextResponse.json({
      ok: true,
      sale_id: existed.id,
      redirect: `/invoices/${existed.id}`,
      info: 'Already converted',
    });
  }

  // Load quotation header
  const quotation = (
    await pool.query(
      `select q.*, c.id as customer_id, c.name as customer_name
         from quotations q
         left join customers c on c.id = q.customer_id
        where q.id=$1
        limit 1`,
      [qid]
    )
  ).rows[0];
  if (!quotation) {
    return NextResponse.json({ ok: false, error: 'Quotation not found' }, { status: 404 });
  }

  // Load items
  const qItems = (
    await pool.query(
      `select id, description, qty, price, tax, discount, product_id
         from quotation_items
        where quotation_id = $1
        order by id asc`,
      [qid]
    )
  ).rows;

  if (!qItems.length) {
    return NextResponse.json({ ok: false, error: 'Quotation has no items' }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const meta = {
      source_quotation_id: quotation.id,
      amount_paid: 0,
      is_return: false,
      notes: quotation?.meta?.notes ?? null,
    };

    const saleRow = (
      await client.query(
        `insert into sales (customer_id, invoice_date, subtotal, tax_total, total, meta, created_at)
         values ($1, now(), 0, 0, 0, $2::jsonb, now())
         returning id`,
        [quotation.customer_id ?? null, JSON.stringify(meta)]
      )
    ).rows[0];
    const saleId = saleRow.id;

    let subtotal = 0, tax_total = 0, total = 0;

    for (const it of qItems) {
      const name = String(it.description ?? '').trim() || 'Item';
      const qty = clamp(toNum(it.qty, 0), 0, 1e9);
      const unit_price = clamp(toNum(it.price, 0), 0, 1e9);

      // Discount: quotation.discount may be % or absolute (>100). Convert to % safely.
      const gross = qty * unit_price;
      let discount_pct = 0;
      if (gross > 0) {
        const rawDisc = toNum(it.discount, 0);
        const discAbs = rawDisc > 0 ? (rawDisc <= 100 ? gross * (rawDisc / 100) : rawDisc) : 0;
        discount_pct = clamp((discAbs / gross) * 100, 0, 100);
      }

      // GST: quotation.tax should be a %, but if it’s out-of-range, clamp to 0..100 to avoid DB overflow
      const gst_slab = clamp(toNum(it.tax, 0), 0, 100); // change to 28 if you want only 0..28

      const discount = gross * (discount_pct / 100);
      const taxable = Math.max(0, gross - discount);
      const tax = taxable * (gst_slab / 100);
      const lineTotal = taxable + tax;

      subtotal += taxable;
      tax_total += tax;
      total += lineTotal;

      // Guard against absurdly large money figures that could overflow narrow NUMERIC columns
      const taxableSafe = clamp(round2(taxable), -9_999_999_999, 9_999_999_999);
      const taxSafe     = clamp(round2(tax),     -9_999_999_999, 9_999_999_999);
      const totalSafe   = clamp(round2(lineTotal), -9_999_999_999, 9_999_999_999);

      await client.query(
        `insert into sale_items (sale_id, name, gst_slab, qty, unit_price, discount_pct, taxable, tax, total)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          saleId,
          name,
          round2(gst_slab),
          round2(qty),
          round2(unit_price),
          round2(discount_pct),
          taxableSafe,
          taxSafe,
          totalSafe,
        ]
      );
    }

    await client.query(
      `update sales
          set subtotal=$2, tax_total=$3, total=$4
        where id=$1`,
      [saleId, round2(subtotal), round2(tax_total), round2(total)]
    );

    await client.query('COMMIT');
    return NextResponse.json({ ok: true, sale_id: saleId, redirect: `/invoices/${saleId}` });
  } catch (e: any) {
    await client.query('ROLLBACK');
    return NextResponse.json(
      { ok: false, error: e?.message || 'Failed to convert this quotation' },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}

export async function GET(req: Request, ctx: { params: { id: string } }) {
  return POST(req, ctx);
}
