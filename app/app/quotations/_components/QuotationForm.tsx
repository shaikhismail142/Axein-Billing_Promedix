'use client';

import { useState, useEffect } from 'react';

type Product = { id: string; name: string; meta: any };
type Item = { product_id?: string; description: string; qty: number; price: number; tax: number; discount: number };

export default function QuotationForm() {
  const [products, setProducts] = useState<Product[]>([]);
  const [items, setItems] = useState<Item[]>([
    { description: '', qty: 1, price: 0, tax: 0, discount: 0 }
  ]);
  const [customerId, setCustomerId] = useState<string | undefined>();
  const [notes, setNotes] = useState('');
  const [terms, setTerms] = useState('');
  const [validUntil, setValidUntil] = useState<string>('');

  useEffect(() => {
    (async () => {
      const res = await fetch('/api/products?limit=1000', { cache: 'no-store' });
      const json = await res.json();
      setProducts(json.data || []);
    })();
  }, []);

  function onProductSelect(idx: number, pid: string) {
    const p = products.find(x => x.id === pid);
    const cp = p?.meta?.cost_price ?? 0; // reuse cost price; editable
    setItems(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], product_id: pid, description: p?.name || '', price: cp };
      return next;
    });
  }

  async function onSubmit() {
    const body = {
      customer_id: customerId || null,
      valid_until: validUntil || null,
      notes,
      terms,
      items
    };
    const res = await fetch('/api/quotations', { method: 'POST', body: JSON.stringify(body) });
    const json = await res.json();
    if (json?.data?.id) {
      location.href = `/quotations/${json.data.id}`;
    } else {
      alert('Failed to create quotation');
    }
  }

  return (
    <div className="rounded-2xl border border-white/15 p-4 bg-white/5 space-y-4">
      {/* TODO: swap with your customer picker */}
      <input className="px-3 py-2 rounded-xl bg-white/10 w-full" placeholder="Customer ID (optional)" onChange={e=>setCustomerId(e.target.value)} />

      <div className="space-y-2">
        {items.map((it, i) => (
          <div key={i} className="grid grid-cols-12 gap-2 items-center">
            <select className="col-span-3 px-3 py-2 rounded-xl bg-white/10"
              value={it.product_id || ''} onChange={e=>onProductSelect(i, e.target.value)}>
              <option value="">Select product…</option>
              {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <input className="col-span-3 px-3 py-2 rounded-xl bg-white/10" value={it.description}
                   onChange={e=>setItems(s=>{ const n=[...s]; n[i]={...n[i], description:e.target.value}; return n;})}
                   placeholder="Description" />
            <input type="number" step="0.001" className="col-span-2 px-3 py-2 rounded-xl bg-white/10" value={it.qty}
                   onChange={e=>setItems(s=>{ const n=[...s]; n[i]={...n[i], qty:Number(e.target.value)}; return n;})}
                   placeholder="Qty" />
            <input type="number" step="0.01" className="col-span-2 px-3 py-2 rounded-xl bg-white/10" value={it.price}
                   onChange={e=>setItems(s=>{ const n=[...s]; n[i]={...n[i], price:Number(e.target.value)}; return n;})}
                   placeholder="Price (cost)" />
            <div className="col-span-2 flex gap-2">
              <input type="number" step="0.01" className="w-1/2 px-3 py-2 rounded-xl bg-white/10" value={it.tax}
                     onChange={e=>setItems(s=>{ const n=[...s]; n[i]={...n[i], tax:Number(e.target.value)}; return n;})}
                     placeholder="Tax %" />
              <input type="number" step="0.01" className="w-1/2 px-3 py-2 rounded-xl bg-white/10" value={it.discount}
                     onChange={e=>setItems(s=>{ const n=[...s]; n[i]={...n[i], discount:Number(e.target.value)}; return n;})}
                     placeholder="Disc %/₹" />
            </div>
          </div>
        ))}
        <button className="px-3 py-2 rounded-xl bg-white/10" onClick={()=>setItems(s=>[...s, { description:'', qty:1, price:0, tax:0, discount:0 }])}>+ Add item</button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <textarea className="px-3 py-2 rounded-2xl bg-white/10" rows={4} placeholder="Notes" value={notes} onChange={e=>setNotes(e.target.value)} />
        <div className="flex flex-col gap-2">
          <textarea className="px-3 py-2 rounded-2xl bg-white/10" rows={4} placeholder="Terms" value={terms} onChange={e=>setTerms(e.target.value)} />
          <input type="date" className="px-3 py-2 rounded-xl bg-white/10" value={validUntil} onChange={e=>setValidUntil(e.target.value)} />
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <button className="px-4 py-2 rounded-2xl bg-white/20 hover:bg-white/30" onClick={onSubmit}>Save Quotation</button>
      </div>
    </div>
  );
}
