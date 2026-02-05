'use client';

import React, { useRef, useState } from 'react';

export default function RestorePanel() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string>('');
  const [report, setReport] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>('');

  async function doRestore(apply: boolean) {
    setMsg('');
    setReport(null);

    const f = fileRef.current?.files?.[0];
    if (!f) { setMsg('Please choose a .tar backup file'); return; }

    // Basic client check (non-blocking if user overrides)
    if (!f.name.endsWith('.tar')) {
      setMsg('Selected file is not a .tar archive'); return;
    }

    const fd = new FormData();
    fd.append('file', f);
    fd.append('apply', String(apply));

    setBusy(true);
    try {
      const res = await fetch('/api/admin/restore', {
        method: 'POST',
        body: fd, // IMPORTANT: do NOT set Content-Type; let the browser set multipart boundary
      });

      const text = await res.text();
      // Try JSON first
      try {
        const json = JSON.parse(text);
        if (res.ok) {
          if (apply) {
            setMsg('Restore applied successfully ✅');
          } else {
            setMsg('Validation succeeded ✅');
            setReport(json.report ?? json);
          }
        } else {
          setMsg(json?.error || text || 'Restore failed');
        }
      } catch {
        // Not JSON
        if (res.ok) {
          setMsg(apply ? 'Restore applied successfully ✅' : 'Validation succeeded ✅');
        } else {
          setMsg(text || 'Restore failed');
        }
      }
    } catch (e: any) {
      setMsg(e?.message || 'Network error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 rounded-2xl border p-4 md:p-6">
      <h3 className="text-lg font-semibold">Restore from backup (.tar)</h3>
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <input
          ref={fileRef}
          type="file"
          accept=".tar,application/x-tar"
          onChange={(e) => setFileName(e.target.files?.[0]?.name || '')}
          className="block w-full rounded-lg border p-2"
        />
        {fileName && <span className="text-sm text-gray-500">Selected: {fileName}</span>}
      </div>

      <div className="flex gap-3">
        <button
          onClick={() => doRestore(false)}
          disabled={busy}
          className="rounded-xl px-4 py-2 shadow bg-white/60 hover:bg-white disabled:opacity-50"
        >
          Validate
        </button>
        <button
          onClick={() => doRestore(true)}
          disabled={busy}
          className="rounded-xl px-4 py-2 shadow bg-white/60 hover:bg-white disabled:opacity-50"
        >
          Apply
        </button>
      </div>

      {busy && <p className="text-sm opacity-70">Working…</p>}
      {!!msg && <p className="text-sm">{msg}</p>}

      {report && (
        <div className="rounded-xl border p-3 text-sm">
          <div className="font-medium mb-2">Validation Report</div>
          <ul className="list-disc pl-5 space-y-1">
            <li>manifest: {String(report.hasManifest)}</li>
            <li>customers.csv: {String(report.hasCustomers)}</li>
            <li>products.csv: {String(report.hasProducts)}</li>
            <li>sales.csv: {String(report.hasSales)}</li>
            <li>sale_items.csv: {String(report.hasSaleItems)}</li>
            <li>settings.json: {String(report.hasSettings)}</li>
            <li>invoice PDFs: {report.invoicesPdfCount}</li>
          </ul>
        </div>
      )}
    </div>
  );
}
