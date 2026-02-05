'use client';

import { useState } from 'react';

export default function TrialCard() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const start = async () => {
    setBusy(true); setMsg(null); setErr(null);
    try {
      const res = await fetch('/api/license/start-trial', { method: 'POST' });
      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.error || `Failed (${res.status})`);
      const days = typeof json?.daysLeft === 'number' ? `${json.daysLeft} day(s)` : 'started';
      setMsg(`Trial ${days}.`);
    } catch (e: any) {
      setErr(e?.message ?? 'Could not start trial');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border p-4 shadow-sm bg-white dark:bg-neutral-900">
      <h3 className="font-medium mb-2">Start Trial</h3>
      <p className="text-sm text-gray-500 mb-3">
        You can start a one-time trial if it’s enabled and you’re not already licensed.
      </p>
      <button onClick={start} disabled={busy}
              className="px-4 py-2 rounded-lg bg-amber-500 text-white disabled:opacity-60">
        {busy ? 'Starting…' : 'Start Trial'}
      </button>
      {msg && <p className="text-green-600 text-sm mt-2">{msg}</p>}
      {err && <p className="text-red-600 text-sm mt-2">{err}</p>}
    </div>
  );
}
