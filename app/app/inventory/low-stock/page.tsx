// app/inventory/low-stock/page.tsx
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { pool } from '@/lib/db';

type Row = { id: number; name: string; meta: any };

function inr(n: number) {
  return `INR (Rs/-) ${Number(n || 0).toFixed(2)}`;
}

export default async function InventoryPage() {
  const rs = await pool.query(`SELECT id, name, meta FROM products ORDER BY name ASC`);
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
          <span className="muted" style={{ fontSize: 12 }}>{list.length} products</span>
        </div>

        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 60 }}>ID</th>
                <th>Name</th>
                <th style={{ width: 140, textAlign: 'right' }}>Price</th>
                <th style={{ width: 160, textAlign: 'right' }}>Stock</th>
                <th style={{ width: 200, textAlign: 'right' }}>Low Stock Threshold</th>
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
                    <InlineStockEdit id={p.id} initial={p.stock} />
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <InlineLowEdit id={p.id} initial={p.low} />
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn-outline">Actions</button>
                  </td>
                </tr>
              ))}
              {list.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 16 }}>
                    No products found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function InlineLowEdit({ id, initial }: { id: number; initial: number }) {
  return (
    <form
      action={`/api/products/${id}`}
      method="post"
      style={{ display: 'inline-flex', gap: 6, justifyContent: 'flex-end', width: '100%' }}
    >
      <input type="hidden" name="_method" value="PATCH" />
      <input
        type="number"
        name="low_stock_threshold"
        defaultValue={initial}
        min={0}
        style={{ width: 110, textAlign: 'right' }}
      />
      <button type="submit" className="btn-outline">Save</button>
    </form>
  );
}

function InlineStockEdit({ id, initial }: { id: number; initial: number }) {
  return (
    <form
      action={`/api/products/${id}`}
      method="post"
      style={{ display: 'inline-flex', gap: 6, justifyContent: 'flex-end', width: '100%' }}
    >
      <input type="hidden" name="_method" value="PATCH" />
      <input
        type="number"
        name="stock_qty"
        defaultValue={initial}
        min={0}
        style={{ width: 110, textAlign: 'right' }}
      />
      <button type="submit" className="btn-outline">Save</button>
    </form>
  );
}
