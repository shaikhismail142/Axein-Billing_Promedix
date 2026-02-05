'use client';

import { useRef, useState } from 'react';

export default function BackupsPanel() {
  const [password, setPassword] = useState('admin');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [msgType, setMsgType] = useState<'success' | 'error' | 'info'>('info');
  const fileRef = useRef<HTMLInputElement>(null);
  const [restoreReport, setRestoreReport] = useState<any | null>(null);

  const card =
    'rounded-2xl border shadow-sm backdrop-blur-md ' +
    'border-slate-200/70 bg-white/90 ' +
    'dark:border-slate-800 dark:bg-slate-900/70';

  const h3 = 'text-lg font-semibold text-slate-800 dark:text-slate-100';
  const sub = 'text-sm text-slate-600 dark:text-slate-400 mt-1';

  const inputBase =
    'px-3 py-2 rounded-xl border w-full ' +
    'bg-white text-slate-900 placeholder:text-slate-400 border-slate-300 ' +
    'focus:outline-none focus:ring-2 focus:ring-slate-300 ' +
    'dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 dark:border-slate-700 ' +
    'dark:focus:ring-slate-700';

  const btnBase =
    'px-4 py-2 rounded-2xl text-sm font-medium shadow transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

  async function runBackup() {
    try {
      setBusy(true);
      setMsg(null);
      setMsgType('info');

      const res = await fetch('/api/admin/backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) throw new Error('Backup failed');

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const cd = res.headers.get('Content-Disposition') || '';
      const m = cd.match(/filename="(.+?)"/);
      a.href = url;
      a.download = m?.[1] || 'axein-backup.zip';
      a.click();
      URL.revokeObjectURL(url);

      setMsgType('success');
      setMsg('Backup downloaded. Check your Downloads folder.');
    } catch (e: any) {
      setMsgType('error');
      setMsg(e?.message || 'Backup failed');
    } finally {
      setBusy(false);
    }
  }

  async function validateRestore(file: File) {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('apply', 'false');

    const res = await fetch('/api/admin/restore', { method: 'POST', body: fd });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    setRestoreReport(data.report);
    setMsgType('success');
    setMsg('Backup validated. Review the report, then click Apply.');
  }

  async function applyRestore(file: File) {
    const ok = window.confirm('This will upsert data into your database. Continue?');
    if (!ok) return;
    const fd = new FormData();
    fd.append('file', file);
    fd.append('apply', 'true');

    const res = await fetch('/api/admin/restore', { method: 'POST', body: fd });
    if (!res.ok) throw new Error(await res.text());
    setMsgType('success');
    setMsg('Restore completed.');
  }

  function Msg({ children }: { children: React.ReactNode }) {
    if (!children) return null;
    const map = {
      success:
        'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-100',
      error:
        'border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-800 dark:bg-rose-900/30 dark:text-rose-100',
      info:
        'border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-900/30 dark:text-sky-100',
    } as const;
    return (
      <p
        role="status"
        className={`mt-2 rounded-xl border px-3 py-2 text-sm ${map[msgType]}`}
      >
        {children}
      </p>
    );
  }

  return (
    <div className="grid gap-6">
      {/* Backup card */}
      <section className={card}>
        <h3 className={h3}>Full Backup (DB + Invoice PDFs)</h3>
        <p className={sub}>
          Download a password-protected ZIP (default:&nbsp;
          <code className="text-slate-800 dark:text-slate-100">admin</code>)
        </p>

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div className="min-w-[220px]">
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
              ZIP Password
            </label>
            <input
              className={inputBase}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Zip password"
              aria-label="Zip password"
            />
          </div>

          <button
            onClick={runBackup}
            disabled={busy}
            className={`${btnBase} bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-white`}
          >
            {busy ? 'Preparing…' : 'Download Backup'}
          </button>
        </div>

        {msg && <Msg>{msg}</Msg>}
      </section>

      {/* Restore card */}
      <section className={card}>
        <div className="flex items-center justify-between">
          <h3 className={h3}>Restore from Backup</h3>
        </div>
        <p className={sub}>Upload a ZIP made by AxEin. We’ll validate first.</p>

        <div className="mt-4 flex flex-col gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
              Select backup .zip
            </label>
            <input
              ref={fileRef}
              type="file"
              accept=".zip"
              className={inputBase}
              aria-label="Backup zip file"
            />
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              onClick={async () => {
                const f = fileRef.current?.files?.[0];
                if (!f) return alert('Choose a file first');
                try {
                  await validateRestore(f);
                } catch (e: any) {
                  setMsgType('error');
                  setMsg(e?.message || 'Validation failed');
                }
              }}
              className={`${btnBase} bg-slate-800 text-white hover:bg-slate-700 dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-white`}
            >
              Validate
            </button>

            <button
              onClick={async () => {
                const f = fileRef.current?.files?.[0];
                if (!f) return alert('Choose a file first');
                try {
                  await applyRestore(f);
                } catch (e: any) {
                  setMsgType('error');
                  setMsg(e?.message || 'Restore failed');
                }
              }}
              className={`${btnBase} bg-emerald-600 text-white hover:bg-emerald-500 dark:bg-emerald-500 dark:hover:bg-emerald-400`}
            >
              Apply Restore
            </button>
          </div>

          {restoreReport && (
            <div className="mt-2 text-sm text-slate-700 dark:text-slate-300">
              <div className="opacity-70">Validation report:</div>
              <ul className="ml-5 list-disc">
                <li>manifest.json: {restoreReport.hasManifest ? '✅' : '❌'}</li>
                <li>db/customers.csv: {restoreReport.hasCustomers ? '✅' : '❌'}</li>
                <li>db/products.csv: {restoreReport.hasProducts ? '✅' : '❌'}</li>
                <li>db/sales.csv: {restoreReport.hasSales ? '✅' : '❌'}</li>
                <li>db/sale_items.csv: {restoreReport.hasSaleItems ? '✅' : '❌'}</li>
                <li>db/settings.json: {restoreReport.hasSettings ? '✅' : '❌'}</li>
                <li>invoices PDFs: {restoreReport.invoicesPdfCount}</li>
              </ul>
            </div>
          )}
        </div>

        {msg && !restoreReport && <Msg>{msg}</Msg>}
      </section>
    </div>
  );
}
