'use client';

import { useEffect, useState } from 'react';

type Settings = {
  allow_negative_stock: boolean;
  low_stock_threshold_default: number;
  reorder_multiplier: number;
  alert_channels: string[];
};

const DEFAULTS: Settings = {
  allow_negative_stock: false,
  low_stock_threshold_default: 5,
  reorder_multiplier: 1.5,
  alert_channels: ['dashboard'],
};

export default function InventorySettingsPage() {
  const [form, setForm] = useState<Settings>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const r = await fetch('/api/inventory/settings', { cache: 'no-store' });
        const j = await r.json();
        setForm({ ...DEFAULTS, ...(j||{}) });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function save() {
    setSaving(true); setMsg(null);
    try {
      const r = await fetch('/api/inventory/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || 'Save failed');
      setMsg('✅ Saved');
    } catch (e:any) {
      setMsg(`❌ ${e.message || 'Failed'}`);
    } finally {
      setSaving(false);
      setTimeout(()=>setMsg(null), 2000);
    }
  }

  if (loading) return <main className="container"><div className="card p-4">Loading…</div></main>;

  return (
    <main className="container space-y-4">
      <div className="card p-4">
        <h1 className="text-xl font-bold">Inventory Settings</h1>
        <div className="grid gap-3 md:grid-cols-2 mt-3">
          <label className="flex gap-2 items-center">
            <input type="checkbox"
              checked={form.allow_negative_stock}
              onChange={e=>setForm(f=>({...f, allow_negative_stock: e.target.checked}))}/>
            <span>Allow negative stock</span>
          </label>
          <input className="input" type="number" min={0}
                 value={form.low_stock_threshold_default}
                 onChange={e=>setForm(f=>({...f, low_stock_threshold_default: Number(e.target.value||0)}))}
                 placeholder="Default low-stock threshold"/>
          <input className="input" type="number" step="0.1" min={0}
                 value={form.reorder_multiplier}
                 onChange={e=>setForm(f=>({...f, reorder_multiplier: Number(e.target.value||0)}))}
                 placeholder="Reorder multiplier (e.g., 1.5)"/>
          <input className="input"
                 value={form.alert_channels.join(',')}
                 onChange={e=>setForm(f=>({...f, alert_channels: e.target.value.split(',').map(s=>s.trim()).filter(Boolean)}))}
                 placeholder="Alert channels (comma separated)"/>
        </div>
        <div className="mt-3 flex gap-2">
          <button className="btn-primary" onClick={save} disabled={saving}>{saving?'Saving…':'Save'}</button>
          {msg && <div className="text-sm">{msg}</div>}
        </div>
      </div>
    </main>
  );
}
