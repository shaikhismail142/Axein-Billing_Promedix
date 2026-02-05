'use client';

import { useState } from 'react';

export default function LicenseForm() {
  const [licenseKey, setLicenseKey] = useState('');
  const [email, setEmail] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [signature, setSignature] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setMsg(null); setErr(null);
    try {
      const res = await fetch('/api/license/verify-key', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          license_key: licenseKey.trim(),
          email: email.trim(),
          expires_at: expiresAt.trim(),
          signature: signature.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.error || `Failed (${res.status})`);
      setMsg('License verified and saved. App is now activated.');
    } catch (e: any) {
      setErr(e?.message ?? 'Verification failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="rounded-2xl border p-4 shadow-sm bg-white dark:bg-neutral-900">
      <h3 className="font-medium mb-3">Enter License</h3>
      <div className="grid gap-3">
        <input className="border rounded-lg px-3 py-2 bg-transparent"
               placeholder="License Key (AXEIN-XXXX-XXXX-XXXX)"
               value={licenseKey} onChange={(e) => setLicenseKey(e.target.value)} required />
        <input className="border rounded-lg px-3 py-2 bg-transparent"
               placeholder="Licensed Email"
               value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input className="border rounded-lg px-3 py-2 bg-transparent"
               placeholder="Expires At (ISO, e.g. 2026-12-31T00:00:00Z)"
               value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} required />
        <textarea className="border rounded-lg px-3 py-2 bg-transparent font-mono"
                  placeholder="Signature (base64)"
                  value={signature} onChange={(e) => setSignature(e.target.value)} required rows={3} />
        <div className="flex items-center gap-3">
          <button type="submit" disabled={busy}
                  className="px-4 py-2 rounded-lg bg-blue-600 text-white disabled:opacity-60">
            {busy ? 'Verifying…' : 'Verify & Activate'}
          </button>
          <button type="button"
                  onClick={() => { setLicenseKey(''); setEmail(''); setExpiresAt(''); setSignature(''); setMsg(null); setErr(null); }}
                  className="px-3 py-2 rounded-lg border">
            Clear
          </button>
        </div>
        {msg && <p className="text-green-600 text-sm">{msg}</p>}
        {err && <p className="text-red-600 text-sm">{err}</p>}
      </div>
    </form>
  );
}
