import NewQuotationForm from './NewQuotationForm';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const url =
    `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/products?limit=1000`;
  const res = await fetch(url, { cache: 'no-store' });
  const data = res.ok ? await res.json().catch(() => ({ items: [] })) : { items: [] };
  const products = Array.isArray(data?.items) ? data.items : [];
  return <NewQuotationForm products={products} />;
}
