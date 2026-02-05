// app/quotations/_components/ConvertToSaleButton.tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function ConvertToSaleButton({ quotationId }: { quotationId: number }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();

  async function handleConvert() {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/quotations/${quotationId}/convert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      // Some implementations return 200 with {ok:true}, others return 400 with an "Already converted" error.
      const json = await res.json().catch(() => ({} as any));

      // Success path (your earlier flow)
      if (json?.ok && json?.sale_id) {
        const redirect = json.redirect || `/invoices/${json.sale_id}`;
        router.push(redirect);
        return;
      }

      // If API says "Already converted (sale_id 2)" -> parse and redirect
      const err: string = json?.error || '';
      const m = err.match(/Already converted\s*\(sale_id\s*([0-9]+)\)/i);
      if (m && m[1]) {
        const saleId = m[1];
        router.push(`/invoices/${saleId}`);
        return;
      }

      // Fallbacks: try Location header if present
      const loc = res.headers.get('Location');
      if (loc) {
        router.push(loc);
        return;
      }

      // Show a friendly message if we can't infer anything
      setMsg(json?.error || 'Failed to convert this quotation.');
    } catch (e: any) {
      setMsg(e?.message || 'Unexpected error.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={handleConvert}
        disabled={busy}
        className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-60"
      >
        {busy ? 'Converting…' : 'Convert to Sale'}
      </button>
      {msg ? <span className="text-sm text-amber-700">{msg}</span> : null}
    </div>
  );
}
