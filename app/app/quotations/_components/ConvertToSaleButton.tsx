// app/quotations/_components/ConvertToSaleButton.tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Props = {
  quotationId: number;
  className?: string;
};

export default function ConvertToSaleButton({ quotationId, className }: Props) {
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

      // 1) Try JSON first
      let json: any = {};
      try {
        json = await res.json();
      } catch {
        json = {};
      }

      // Success path (freshly converted)
      if (json?.ok && json?.sale_id) {
        router.push(json.redirect || `/invoices/${json.sale_id}`);
        return;
      }

      // Handle "Already converted (sale_id X)" from your API
      const err = String(json?.error || '');
      const match = err.match(/Already converted\s*\(sale_id\s*([0-9]+)\)/i);
      if (match?.[1]) {
        router.push(`/invoices/${match[1]}`);
        return;
      }

      // 2) Fallback: check Location header if API uses redirect headers
      const loc = res.headers.get('Location');
      if (loc) {
        router.push(loc);
        return;
      }

      // 3) Last resort: show message
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
        className={className ?? 'text-sm px-3 py-2 rounded-2xl bg-emerald-600 text-white border border-emerald-700 hover:opacity-95 disabled:opacity-60'}
      >
        {busy ? 'Converting…' : 'Convert to Sale'}
      </button>
      {msg ? <span className="text-sm text-amber-700">{msg}</span> : null}
    </div>
  );
}
