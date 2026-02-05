// app/license/page.tsx
import Link from 'next/link';
import { Suspense } from 'react';
import LicenseForm from './_components/LicenseForm';
import TrialCard from './_components/TrialCard';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;

async function getStatus() {
  const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL}/api/license/status`, {
    cache: 'no-store',
  });
  if (!res.ok) return { ok: false, error: `Status failed (${res.status})` };
  return res.json();
}

export default async function LicensePage() {
  const data = await getStatus();
  return (
    <main className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-semibold mb-2">License & Trial</h1>
      <p className="text-sm text-gray-500 mb-6">
        Enter a license key or start a limited-time trial. Your OTP activation page remains at <code>/activate</code>.
      </p>

      <Suspense fallback={<div className="text-sm text-gray-500">Loading…</div>}>
        <StatusCard data={data} />
      </Suspense>

      <div className="grid gap-6 mt-8">
        <LicenseForm />
        <TrialCard />
      </div>

      <div className="mt-8 flex items-center gap-4">
        <Link href="/" className="text-blue-600 underline">← Back to Dashboard</Link>
        <Link href="/activate" className="text-gray-600 underline">Go to OTP Activation</Link>
      </div>
    </main>
  );
}

function Pill({ children, cls = 'bg-gray-100 text-gray-800' }: { children: React.ReactNode; cls?: string }) {
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>{children}</span>;
}
function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-sm text-gray-500">{label}</span>
      <span className="text-sm">{value}</span>
    </div>
  );
}

function StatusCard({ data }: { data: any }) {
  const isLicensed = data?.isLicensed === true;
  const trialActive = data?.trialActive === true;
  const expiresAt = data?.expiresAt as string | null;
  const daysLeft = data?.daysLeft as number | null;
  const canStartTrial = data?.canStartTrial !== false;

  return (
    <div className="rounded-2xl border p-4 shadow-sm bg-white dark:bg-neutral-900">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">Current Status</h2>
        {isLicensed ? (
          <Pill cls="bg-green-100 text-green-800">Licensed</Pill>
        ) : trialActive ? (
          <Pill cls="bg-yellow-100 text-yellow-800">Trial</Pill>
        ) : (
          <Pill>Inactive</Pill>
        )}
      </div>

      <div className="mt-3 space-y-1.5">
        <Row label="Mode" value={data?.status?.mode ?? 'unknown'} />
        <Row label="Expires At" value={expiresAt ?? '—'} />
        <Row label="Days Left" value={daysLeft ?? '—'} />
        <Row label="Can Start Trial" value={canStartTrial ? 'Yes' : 'No'} />
      </div>

      {isLicensed && data?.status?.license?.email && (
        <div className="mt-3 text-xs text-gray-500">
          Licensed to: <span className="font-mono">{data.status.license.email}</span>
        </div>
      )}
    </div>
  );
}
