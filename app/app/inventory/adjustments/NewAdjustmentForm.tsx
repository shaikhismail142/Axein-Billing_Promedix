'use client';

import { useState } from 'react';

type Reason =
  | "sale" | "return" | "purchase" | "adjustment"
  | "damage" | "loss" | "promo" | "correction";

export default function NewAdjustmentForm() {
  const [productId, setProductId] = useState<string>('');
  const [delta, setDelta] = useState<string>('');
  const [reason, setReason] = useState<Reason>('adjustment');
  const [note, setNote] = useState<string>('');
  const [allowNeg, setAllowNeg] = useState<boolean>(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const res = await fetch('/api/stock/adjust', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: Number(productId),
          delta_qty: Number(delta),
          reason,
          note,
          allow_negative_stock: allowNeg
        }),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j.error || 'Failed');
      setMsg(`✅ Adjusted: before ${j.before} → after ${j.after}`);
      setProductId(''); setDelta(''); setReason('adjustment'); setNote(''); // reset
      // soft reload recent movements (best-effort)
      setTimeout(() => window.location.reload(), 500);
    } catch (e:any) {
      setMsg(`❌ ${e.message || 'Adjustment failed'}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-2 md:grid-cols-6">
      <input className="input md:col-span-1" placeholder="Product ID"
             value={productId} onChange={e=>setProductId(e.target.value)} required />
      <input className="input md:col-span-1" placeholder="Δ Qty (e.g., -2 or 5)"
             value={delta} onChange={e=>setDelta(e.target.value)} required />
      <select className="input md:col-span-1" value={reason} onChange={e=>setReason(e.target.value as Reason)}>
        {["adjustment","damage","loss","promo","correction","purchase","sale","return"].map(r=>
          <option key={r} value={r}>{r}</option>
        )}
      </select>
      <input className="input md:col-span-2" placeholder="Note (optional)"
             value={note} onChange={e=>setNote(e.target.value)} />
      <label className="flex items-center gap-2 md:col-span-1">
        <input type="checkbox" checked={allowNeg} onChange={e=>setAllowNeg(e.target.checked)} />
        <span className="text-sm">Allow negative</span>
      </label>
      <div className="md:col-span-6 flex items-center gap-2">
        <button className="btn-primary" disabled={busy} type="submit">{busy?'Saving…':'Save Adjustment'}</button>
        {msg && <div className="text-sm">{msg}</div>}
      </div>
    </form>
  );
}
