'use client';

import * as React from 'react';

// ---- Types (local) ----
type Product = {
  id: number;
  name: string;
  meta?: {
    sku?: string;
    selling_price?: number;
    hsn_code?: string;
    unit?: string;
  };
  category?: string | null;
  hsn_code?: string | null;
  batch_no?: string | null;
  exp_date?: string | null;
};

type Item = {
  product_id?: number;
  description: string;
  qty: number;
  price: number;
  tax: number;      // percent
  discount: number; // percent or absolute (server handles both)
  batch_no?: string;
  exp_date?: string;
};

export default function NewQuotationForm({ products }: { products: Product[] }) {
  // Items
  const [items, setItems] = React.useState<Item[]>([
    { product_id: undefined, description: '', qty: 1, price: 0, tax: 0, discount: 0, batch_no: '', exp_date: '' },
  ]);

  // Customer fields
  const [customerName, setCustomerName] = React.useState<string>(''); // free text
  const [customerId, setCustomerId] = React.useState<string>('');     // keep as string, parse on save

  // Misc fields
  const [notes, setNotes] = React.useState('');
  const [terms, setTerms] = React.useState('');
  const [validUntil, setValidUntil] = React.useState<string>('');

  // Save state
  const [saving, setSaving] = React.useState(false);
  const [savedId, setSavedId] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const onSelectProduct = (row: number, productId: number) => {
    const p = products.find((x) => x.id === Number(productId));
    setItems((prev) => {
      const next = [...prev];
      const price = Number(p?.meta?.selling_price ?? 0);
      next[row] = {
        ...next[row],
        product_id: Number(productId) || undefined,
        description: next[row].description || p?.name || '',
        price,
        batch_no: p?.batch_no ?? next[row].batch_no ?? '',
        exp_date: p?.exp_date ?? next[row].exp_date ?? '',
      };
      return next;
    });
  };

  const onChange = (row: number, field: keyof Item, value: string) => {
    setItems((prev) => {
      const next = [...prev];
      const v = field === 'description' ? value : Number(value || 0);
      next[row] = { ...next[row], [field]: v } as Item;
      return next;
    });
  };

  const addRow = () =>
    setItems((prev) => [
      ...prev,
      { product_id: undefined, description: '', qty: 1, price: 0, tax: 0, discount: 0, batch_no: '', exp_date: '' },
    ]);

  const saveQuotation = async () => {
    setSaving(true);
    setError(null);
    try {
      // Parse optional numeric ID safely (avoid NaN)
      const parsedId =
        customerId.trim() === ''
          ? null
          : Number.isFinite(Number(customerId))
          ? Number(customerId)
          : null;

      const res = await fetch('/api/quotations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_id: parsedId,                    // may be null
          customer_name: customerName || null,      // allow free text name
          items,
          notes,
          terms,
          valid_until: validUntil || null,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setSavedId(data.id);
    } catch (e) {
      console.error(e);
      setError('Failed to save quotation');
    } finally {
      setSaving(false);
    }
  };

  const openPdf = () => {
    if (savedId) window.open(`/quotations/${savedId}/pdf`, '_blank', 'noopener');
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">New Quotation</h1>

      {/* Customer fields */}
      <div className="grid grid-cols-12 gap-3">
        <div className="col-span-6">
          <label className="block text-sm font-medium mb-1">Customer Name (optional)</label>
          <input
            className="w-full rounded-md border px-3 py-2"
            placeholder="e.g. Rahul Sharma"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
          />
        </div>
        <div className="col-span-6">
          <label className="block text-sm font-medium mb-1">Customer ID (optional)</label>
          <input
            type="number"
            className="w-full rounded-md border px-3 py-2"
            placeholder="e.g. 12"
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)} // keep string; parse on save
          />
        </div>
      </div>

      {/* Items */}
      {items.map((it, i) => (
        <div
          key={i}
          className="grid grid-cols-12 gap-3 rounded-xl border p-4 bg-white/60 backdrop-blur"
        >
          {/* Product */}
          <div className="col-span-3">
            <label className="block text-sm font-medium mb-1">Product</label>
            <select
              className="w-full rounded-md border px-3 py-2"
              value={it.product_id ?? ''}
              onChange={(e) => onSelectProduct(i, Number(e.target.value))}
            >
              <option value="">Select product…</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.meta?.sku ? ` • ${p.meta.sku}` : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Description */}
          <div className="col-span-3">
            <label className="block text-sm font-medium mb-1">Description</label>
            <input
              className="w-full rounded-md border px-3 py-2"
              value={it.description}
              onChange={(e) => onChange(i, 'description', e.target.value)}
              placeholder="Item description"
            />
          </div>

          {/* Quantity */}
          <div className="col-span-2">
            <label className="block text-sm font-medium mb-1">Quantity</label>
            <input
              type="number"
              step="0.01"
              className="w-full rounded-md border px-3 py-2 text-right"
              value={it.qty}
              onChange={(e) => onChange(i, 'qty', e.target.value)}
            />
          </div>

          {/* Price */}
          <div className="col-span-2">
            <label className="block text-sm font-medium mb-1">Price</label>
            <input
              type="number"
              step="0.01"
              className="w-full rounded-md border px-3 py-2 text-right"
              value={it.price}
              onChange={(e) => onChange(i, 'price', e.target.value)}
            />
          </div>

          {/* Tax % */}
          <div className="col-span-1">
            <label className="block text-sm font-medium mb-1">Tax %</label>
            <input
              type="number"
              step="0.01"
              className="w-full rounded-md border px-3 py-2 text-right"
              value={it.tax}
              onChange={(e) => onChange(i, 'tax', e.target.value)}
            />
          </div>

          {/* Discount */}
          <div className="col-span-1">
            <label className="block text-sm font-medium mb-1">Discount</label>
            <input
              type="number"
              step="0.01"
              className="w-full rounded-md border px-3 py-2 text-right"
              value={it.discount}
              onChange={(e) => onChange(i, 'discount', e.target.value)}
              placeholder="0"
            />
          </div>

          {/* Extra item details */}
          <div className="col-span-12 grid grid-cols-12 gap-3">
            <div className="col-span-3">
              <label className="block text-xs font-medium mb-1">Category</label>
              <div className="w-full rounded-md border px-3 py-2 text-xs bg-white/40">
                {products.find((p) => p.id === Number(it.product_id))?.category || '—'}
              </div>
            </div>
            <div className="col-span-3">
              <label className="block text-xs font-medium mb-1">HSN Code</label>
              <div className="w-full rounded-md border px-3 py-2 text-xs bg-white/40">
                {products.find((p) => p.id === Number(it.product_id))?.hsn_code ||
                  products.find((p) => p.id === Number(it.product_id))?.meta?.hsn_code ||
                  '—'}
              </div>
            </div>
            <div className="col-span-3">
              <label className="block text-xs font-medium mb-1">Lot / Batch No</label>
              <input
                className="w-full rounded-md border px-3 py-2 text-xs"
                value={it.batch_no ?? ''}
                onChange={(e) => setItems((s) => { const n=[...s]; n[i]={...n[i], batch_no: e.target.value}; return n; })}
                placeholder="e.g., L1234"
              />
            </div>
            <div className="col-span-3">
              <label className="block text-xs font-medium mb-1">Expiry Date</label>
              <input
                type="date"
                className="w-full rounded-md border px-3 py-2 text-xs"
                value={it.exp_date ?? ''}
                onChange={(e) => setItems((s) => { const n=[...s]; n[i]={...n[i], exp_date: e.target.value}; return n; })}
              />
            </div>
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={addRow}
        className="rounded-lg border px-3 py-2 text-sm"
      >
        + Add item
      </button>

      {/* Notes / Terms / Valid Until */}
      <div className="grid grid-cols-12 gap-3">
        <div className="col-span-6">
          <label className="block text-sm font-medium mb-1">Notes</label>
          <textarea
            className="w-full rounded-md border px-3 py-2"
            rows={4}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        <div className="col-span-6">
          <label className="block text-sm font-medium mb-1">Terms</label>
          <textarea
            className="w-full rounded-md border px-3 py-2"
            rows={4}
            value={terms}
            onChange={(e) => setTerms(e.target.value)}
          />
          <div className="mt-3">
            <label className="block text-sm font-medium mb-1">Valid Until</label>
            <input
              type="date"
              className="w-full rounded-md border px-3 py-2"
              value={validUntil}
              onChange={(e) => setValidUntil(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Actions */}
      {error && <p className="text-red-600 text-sm">{error}</p>}
      <div className="flex gap-3">
        <button
          type="button"
          onClick={saveQuotation}
          disabled={saving || items.length === 0}
          className="rounded-lg bg-black text-white px-4 py-2 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save Quotation'}
        </button>
        <button
          type="button"
          onClick={openPdf}
          disabled={!savedId}
          className="rounded-lg border px-4 py-2 disabled:opacity-50"
          title={savedId ? 'Open PDF' : 'Save first to get a PDF'}
        >
          Print / PDF
        </button>
      </div>
    </div>
  );
}
