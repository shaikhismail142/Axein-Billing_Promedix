'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

type LicenseStatus = {
  ok: boolean;
  isLicensed: boolean;
  trialActive: boolean;
  daysLeft: number;
  expiresAt: string | null;
  canStartTrial: boolean;
  deviceId: string;
  trialStartedAt: string | null;
  trialExpiresAt: string | null;
  trialEnabled: boolean;
  trialDays: number;
  serverTimeUTC: string;
  error?: string;
};

const tz = 'Asia/Kolkata';
const fmtDate = (iso?: string | null) => {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: tz,
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(d);
  } catch {
    return iso || '—';
  }
};

// ⬇️ NEW: make redirects configurable so Settings can disable them
export default function LicensePanel({
  redirectOnActive = true,
  redirectAfterSuccess = true,
}: {
  redirectOnActive?: boolean;
  redirectAfterSuccess?: boolean;
}) {
  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [trialBusy, setTrialBusy] = useState(false);
  const [keyBusy, setKeyBusy] = useState(false);
  const [licenseKey, setLicenseKey] = useState('');
  const [msg, setMsg] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const router = useRouter();

  async function fetchStatus() {
    setLoading(true);
    setMsg(null);
    try {
      const r = await fetch(`/api/license/status`, { cache: 'no-store' });
      const j = (await r.json()) as LicenseStatus;
      setStatus(j);
    } catch (e: any) {
      setMsg({ type: 'error', text: e?.message || 'Failed to load license status' });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchStatus();
  }, []);

  useEffect(() => {
    // If it’s already active, leave this page — only if allowed by prop
    if (redirectOnActive && status?.isLicensed) {
      const t = setTimeout(() => router.replace('/'), 300);
      return () => clearTimeout(t);
    }
  }, [redirectOnActive, status?.isLicensed, router]);

  const headline = useMemo(() => {
    if (!status) return 'Loading…';
    if (status.isLicensed) return 'License Active';
    if (status.trialActive)
      return `Trial Active — ${status.daysLeft} day${status.daysLeft === 1 ? '' : 's'} left`;
    if (status.canStartTrial) return `Start your ${status.trialDays}-day trial`;
    return 'Activation Required';
  }, [status]);

  const banner = useMemo(() => {
    if (!status) return null;
    if (status.isLicensed) {
      const exp =
        status.expiresAt && fmtDate(status.expiresAt) !== '—'
          ? `• Expires ${fmtDate(status.expiresAt)}`
          : '• Perpetual';
      return `Licensed • ${exp}`;
    }
    if (status.trialActive) {
      return `Trial ends ${fmtDate(status.trialExpiresAt)} • ${status.daysLeft} day${
        status.daysLeft === 1 ? '' : 's'
      } left`;
    }
    if (status.canStartTrial) return `You can start a ${status.trialDays}-day trial now.`;
    return `Trial not available. Please activate with a license key.`;
  }, [status]);

  async function handleStartTrial() {
    setTrialBusy(true);
    setMsg(null);
    try {
      const r = await fetch(`/api/license/start-trial`, { method: 'POST' });
      const j = (await r.json()) as any;
      if (!j.ok) throw new Error(j.error || 'Failed to start trial');
      setMsg({ type: 'success', text: 'Trial started successfully.' });
      await fetchStatus();
      // Let the customer continue using the app — only if allowed by prop
      if (redirectAfterSuccess) {
        setTimeout(() => router.replace('/'), 500);
      }
    } catch (e: any) {
      setMsg({ type: 'error', text: e?.message || 'Could not start trial' });
    } finally {
      setTrialBusy(false);
    }
  }

  async function handleVerifyKey(e: React.FormEvent) {
    e.preventDefault();
    const raw = licenseKey.trim();
    if (!raw) {
      setMsg({ type: 'error', text: 'Please paste a license token or JSON.' });
      return;
    }
    setKeyBusy(true);
    setMsg(null);

    try {
      let body: any;
      if (raw.startsWith('L-')) {
        body = { token: raw };
      } else if (raw.startsWith('{')) {
        const j = JSON.parse(raw);
        if (!j.license_key || !j.email || !j.expires_at || !j.signature) {
          throw new Error('JSON missing required fields');
        }
        body = {
          license_key: j.license_key,
          email: j.email,
          expires_at: j.expires_at,
          signature: j.signature,
        };
      } else {
        // treat as token-like error
        throw new Error('Please paste a full license token starting with L- or a JSON with all fields.');
      }

      const r = await fetch(`/api/license/verify-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = (await r.json()) as any;
      if (!j.ok) throw new Error(j.error || 'License verification failed');
      setMsg({ type: 'success', text: 'License activated. Thank you!' });
      setLicenseKey('');
      await fetchStatus();
      if (redirectAfterSuccess) {
        setTimeout(() => router.replace('/'), 400);
      }
    } catch (e: any) {
      setMsg({ type: 'error', text: e?.message || 'License verification failed' });
    } finally {
      setKeyBusy(false);
    }
  }

  function copyDeviceId() {
    if (!status?.deviceId) return;
    navigator.clipboard.writeText(status.deviceId).then(
      () => setMsg({ type: 'success', text: 'Device ID copied.' }),
      () => setMsg({ type: 'error', text: 'Copy failed.' })
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-2xl border border-slate-200/60 bg-white/70 p-5 shadow-sm backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/60">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-xl font-semibold">{headline}</div>
            <div className="text-sm text-slate-600 dark:text-slate-400">{banner}</div>
          </div>
          <button
            type="button"
            onClick={fetchStatus}
            className="rounded-xl border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* Device card */}
        <div className="rounded-2xl border border-slate-200/60 bg-white/80 p-5 shadow-sm backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/60">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Device</h2>
            <span className="text-xs text-slate-500">IST</span>
          </div>

          <div className="text-sm">
            <div className="mb-2 text-slate-600 dark:text-slate-400">
              <span className="font-medium text-slate-800 dark:text-slate-200">Device ID:</span>{' '}
              <code className="rounded bg-slate-100 px-1 py-0.5 dark:bg-slate-800">
                {status?.deviceId || '—'}
              </code>
            </div>
            <button
              className="rounded-xl border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
              onClick={copyDeviceId}
            >
              Copy Device ID
            </button>

            <div className="mt-4 grid grid-cols-2 gap-3 text-xs text-slate-600 dark:text-slate-400">
              <div>
                <div className="font-medium text-slate-800 dark:text-slate-200">Trial start</div>
                <div>{fmtDate(status?.trialStartedAt)}</div>
              </div>
              <div>
                <div className="font-medium text-slate-800 dark:text-slate-200">Trial ends</div>
                <div>{fmtDate(status?.trialExpiresAt)}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Trial card */}
        <div className="rounded-2xl border border-slate-200/60 bg-white/80 p-5 shadow-sm backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/60">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Trial</h2>
            {loading && <span className="text-xs text-slate-500">Refreshing…</span>}
          </div>

          <div className="text-sm text-slate-700 dark:text-slate-300">
            {status?.trialEnabled ? (
              <>
                <p className="mb-3">
                  {status?.trialActive
                    ? `Your trial is active. It will expire on ${fmtDate(status?.trialExpiresAt)}.`
                    : status?.canStartTrial
                    ? `You haven't started a trial yet.`
                    : `Trial is not available on this installation.`}
                </p>
                <button
                  className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-white"
                  onClick={handleStartTrial}
                  disabled={trialBusy || !status?.trialEnabled || status?.isLicensed || !!status?.trialStartedAt}
                >
                  {trialBusy ? 'Starting…' : status?.trialActive ? 'Trial Running' : 'Start 7-day Trial'}
                </button>
              </>
            ) : (
              <p>Trial feature is disabled by admin.</p>
            )}
          </div>
        </div>

        {/* License card (full width) */}
        <div className="md:col-span-2 rounded-2xl border border-slate-200/60 bg-white/80 p-5 shadow-sm backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/60">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Activate with License Key</h2>
            {status?.isLicensed && (
              <span className="rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
                Active
              </span>
            )}
          </div>

          <form onSubmit={handleVerifyKey} className="space-y-3">
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              Paste license token (L-...) <span className="text-slate-500">or</span> JSON with fields
            </label>
            <textarea
              value={licenseKey}
              onChange={(e) => setLicenseKey(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white p-3 text-sm shadow-inner outline-none ring-0 focus:border-slate-400 dark:border-slate-700 dark:bg-slate-900"
              rows={3}
              placeholder={`L-AXEIN-....<payload>.<sig>\nOR\n{"license_key":"AXEIN-...","email":"you@x.com","expires_at":"2030-12-31T00:00:00.000Z","signature":"<base64>"}`}
            />
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={keyBusy || !licenseKey.trim()}
                className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {keyBusy ? 'Verifying…' : 'Activate'}
              </button>
              <button
                type="button"
                onClick={() => setLicenseKey('')}
                className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={fetchStatus}
                className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
              >
                Refresh
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Messages */}
      {msg && (
        <div
          className={[
            'rounded-2xl border p-4',
            msg.type === 'success'
              ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200'
              : msg.type === 'error'
              ? 'border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-900/30 dark:text-rose-200'
              : 'border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-900/30 dark:text-sky-200',
          ].join(' ')}
        >
          <div className="text-sm">{msg.text}</div>
        </div>
      )}
    </div>
  );
}
