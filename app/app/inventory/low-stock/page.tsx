// app/inventory/low-stock/page.tsx
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { pool } from '@/lib/db';

type Row = { id: number; name: string; meta: any };

function inr(n: number) {
  return `INR (Rs/-) ${Number(n || 0).toFixed(2)}`;
}

export default async function InventoryPage({ searchParams }: { searchParams: { q?: string; page?: string; updated?: string; error?: string } }) {
  const q = (searchParams?.q || "").trim();
  const page = Math.max(1, Number(searchParams?.page || 1));
  const updated = (searchParams?.updated || "").trim();
  const error = (searchParams?.error || "").trim();
  const perPage = 20;
  const offset = (page - 1) * perPage;
  const returnTo = `/inventory/low-stock?${new URLSearchParams({ q, page: String(page) }).toString()}`;

  const where: string[] = [];
  const params: any[] = [];
  if (q) {
    params.push(`%${q}%`);
    where.push(`(p.name ILIKE $${params.length} OR (p.meta->>'sku') ILIKE $${params.length})`);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const countRes = await pool.query(`SELECT COUNT(*)::int AS cnt FROM products p ${whereSql}`, params);
  const total = countRes.rows?.[0]?.cnt ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / perPage));

  const rs = await pool.query(
    `SELECT id, name, meta FROM products p ${whereSql} ORDER BY name ASC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, perPage, offset]
  );
  const list = (rs.rows as Row[]).map((p) => {
    const m = p.meta || {};
    return {
      id: p.id,
      name: p.name,
      price: Number(m.selling_price ?? m.price ?? 0),
      stock: Number(m.stock_qty ?? m.stock ?? 0),
      low: Number(m.low_stock_threshold ?? 0),
    };
  });

  return (
    <div>
      <div className="card" style={{ padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <h1 style={{ margin: 0 }}>Inventory</h1>
          <span className="muted" style={{ fontSize: 12 }}>{total} products</span>
        </div>

        {/* Search */}
        <form method="get" action="/inventory/low-stock" className="no-print mt-3">
          <div className="flex gap-2">
            <input
              type="text"
              name="q"
              defaultValue={q}
              placeholder="Search by name or SKU…"
              className="w-[320px]"
            />
            <button className="btn-outline px-3 py-2">Search</button>
            {q && (
              <a href="/inventory/low-stock" className="glass-btn px-3 py-2 rounded-2xl">Clear</a>
            )}
          </div>
        </form>

        {(updated || error) && (
          <div
            className="mt-3 rounded-xl border px-3 py-2 text-sm"
            style={{ background: error ? "rgba(244,63,94,0.08)" : "rgba(16,185,129,0.08)" }}
          >
            {error ? "Could not save changes. Please try again." : "Changes saved successfully."}
          </div>
        )}

        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 60 }}>ID</th>
                <th>Name</th>
                <th style={{ width: 140, textAlign: 'right' }}>Price</th>
                <th style={{ width: 220, textAlign: 'right' }}>Stock / Low Threshold</th>
                <th style={{ width: 120 }} />
              </tr>
            </thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.id}>
                  <td>{p.id}</td>
                  <td style={{ maxWidth: 420, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</td>
                  <td style={{ textAlign: 'right' }}>{inr(p.price)}</td>
                  <td style={{ textAlign: 'right' }}>
                    <InlineStockLowEdit id={p.id} stock={p.stock} low={p.low} returnTo={returnTo} />
                  </td>
                  <td style={{ textAlign: 'right' }} />
                </tr>
              ))}
              {list.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted" style={{ textAlign: 'center', padding: 16 }}>
                    No products found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="mt-3 flex items-center justify-between text-sm">
          <div className="muted">
            Page {page} of {totalPages} • {total} results
          </div>
          <div className="flex items-center gap-2">
            <a
              className={`px-3 py-2 rounded-xl border ${page <= 1 ? "pointer-events-none opacity-50" : ""}`}
              href={`/inventory/low-stock?${new URLSearchParams({ q, page: String(page - 1) }).toString()}`}
            >
              Prev
            </a>
            <a
              className={`px-3 py-2 rounded-xl border ${page >= totalPages ? "pointer-events-none opacity-50" : ""}`}
              href={`/inventory/low-stock?${new URLSearchParams({ q, page: String(page + 1) }).toString()}`}
            >
              Next
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

function InlineStockLowEdit({ id, stock, low, returnTo }: { id: number; stock: number; low: number; returnTo: string }) {
  return (
    <form
      action={`/api/products/${id}`}
      method="post"
      style={{ display: 'inline-flex', gap: 6, justifyContent: 'flex-end', width: '100%' }}
    >
      <input type="hidden" name="_method" value="PATCH" />
      <input type="hidden" name="return_to" value={returnTo} />
      <input
        type="number"
        name="stock_qty"
        defaultValue={stock}
        min={0}
        style={{ width: 110, textAlign: 'right' }}
      />
      <input
        type="number"
        name="low_stock_threshold"
        defaultValue={low}
        min={0}
        style={{ width: 110, textAlign: 'right' }}
      />
      <button type="submit" className="btn-outline">Save</button>
    </form>
  );
}
