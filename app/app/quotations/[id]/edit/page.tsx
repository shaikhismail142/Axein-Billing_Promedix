import Link from "next/link";
import { notFound } from "next/navigation";
import { pool } from "@/lib/db";
import NewQuotationForm from "../../new/NewQuotationForm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const toNum = (v: any, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

export default async function Page({ params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isFinite(id)) notFound();

  const qRs = await pool.query(
    `select q.id,
            q.quotation_number,
            q.customer_id,
            q.valid_until,
            coalesce(q.meta, '{}'::jsonb) as meta,
            c.name as customer_name
       from quotations q
       left join customers c on c.id = q.customer_id
      where q.id = $1
      limit 1`,
    [id]
  );

  if (!qRs.rows.length) notFound();

  const itemsRs = await pool.query(
    `select product_id, description, qty, price, tax, discount, batch_no, exp_date
       from quotation_items
      where quotation_id = $1
      order by id asc`,
    [id]
  );

  const productsRs = await pool.query(
    `select id,
            name,
            category,
            coalesce(hsn_code, hsn, meta->>'hsn_code') as hsn_code,
            meta,
            coalesce(meta->>'batch_no', meta->>'lot_no', '') as batch_no,
            coalesce(meta->>'exp_date', meta->>'expiry_date', '') as exp_date
       from products
      order by lower(name) asc`,
  );

  const products = productsRs.rows.map((p) => ({
    id: Number(p.id),
    name: String(p.name ?? ""),
    category: p.category ?? null,
    hsn_code: p.hsn_code ?? null,
    meta: p.meta ?? {},
    batch_no: p.batch_no ?? null,
    exp_date: p.exp_date ?? null,
  }));

  const initialItems = itemsRs.rows.map((it) => ({
    product_id: it.product_id ? Number(it.product_id) : undefined,
    description: String(it.description ?? ""),
    qty: toNum(it.qty, 0),
    price: toNum(it.price, 0),
    tax: toNum(it.tax, 0),
    discount: toNum(it.discount, 0),
    batch_no: it.batch_no ?? "",
    exp_date: it.exp_date ? String(it.exp_date).slice(0, 10) : "",
  }));

  const quotation = qRs.rows[0];

  return (
    <div className="container">
      <div className="mb-4">
        <Link href={`/quotations/${id}`} className="glass-btn text-sm">
          Back to quotation
        </Link>
      </div>
      <NewQuotationForm
        products={products}
        initialQuotation={{
          id: Number(quotation.id),
          quotation_number: quotation.quotation_number ?? null,
          customer_id: quotation.customer_id ? Number(quotation.customer_id) : null,
          customer_name: quotation.customer_name ?? null,
          valid_until: quotation.valid_until ? String(quotation.valid_until).slice(0, 10) : null,
          meta: quotation.meta ?? {},
        }}
        initialItems={initialItems}
      />
    </div>
  );
}
