import { pool } from '@/lib/db';
import NewQuotationForm from './NewQuotationForm';

export const dynamic = 'force-dynamic';

const toNum = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;

export default async function Page({ searchParams }: { searchParams?: { copyFrom?: string } }) {
  const productsResult = await pool.query(
    `SELECT id, name, price, meta FROM products ORDER BY lower(name) ASC LIMIT 2000`
  );
  const products = productsResult.rows.map((row) => ({
    id: Number(row.id),
    name: String(row.name || ''),
    price: row.price,
    meta: row.meta || {},
  }));

  const copyFrom = Number(searchParams?.copyFrom);
  if (!Number.isFinite(copyFrom) || copyFrom <= 0) {
    return <NewQuotationForm products={products} />;
  }

  const [quotationResult, itemResult] = await Promise.all([
    pool.query(
      `SELECT q.customer_id, q.valid_until, COALESCE(q.meta, '{}'::jsonb) AS meta,
              c.name AS customer_name
         FROM quotations q
         LEFT JOIN customers c ON c.id=q.customer_id
        WHERE q.id=$1 LIMIT 1`,
      [copyFrom]
    ),
    pool.query(
      `SELECT product_id, description, qty, price, tax, discount
         FROM quotation_items WHERE quotation_id=$1 ORDER BY id ASC`,
      [copyFrom]
    ),
  ]);

  const quotation = quotationResult.rows[0];
  if (!quotation) return <NewQuotationForm products={products} />;

  return (
    <NewQuotationForm
      products={products}
      initialQuotation={{
        customer_id: quotation.customer_id ? Number(quotation.customer_id) : null,
        customer_name: quotation.customer_name || null,
        valid_until: quotation.valid_until ? new Date(quotation.valid_until).toISOString().slice(0, 10) : null,
        meta: quotation.meta || {},
      }}
      initialItems={itemResult.rows.map((item) => ({
        product_id: item.product_id ? Number(item.product_id) : undefined,
        description: String(item.description || ''),
        qty: toNum(item.qty),
        price: toNum(item.price),
        tax: toNum(item.tax),
        discount: toNum(item.discount),
      }))}
    />
  );
}
