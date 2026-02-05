'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

type Status = {
  ok: boolean;
  isLicensed: boolean;
  trialActive: boolean;
  daysLeft: number;
  expiresAt: string | null;
  canStartTrial: boolean;
};

export default function LicenseBanner() {
  const [st, setSt] = useState<Status | null>(null);

  async function refresh() {
    try {
      const r = await fetch('/api/license/status', { cache: 'no-store' });
      const j = (await r.json()) as Status;
      setSt(j);
    } catch {
      setSt(null);
    }
  }

  useEffect(() => { refresh(); }, []);

  if (!st || st.isLicensed) return null;

  const Wrap: React.FC<{ tone: 'amber'|'sky'|'rose'; children: React.ReactNode }> = ({ tone, children }) => {
    const toneMap = {
      amber: { border: 'color-mix(in oklab, #f59e0b 45%, transparent)', bg: 'color-mix(in oklab, #f59e0b 12%, transparent)', text: 'var(--text)' },
      sky:   { border: 'color-mix(in oklab, #0ea5e9 45%, transparent)', bg: 'color-mix(in oklab, #0ea5e9 12%, transparent)', text: 'var(--text)' },
      rose:  { border: 'color-mix(in oklab, #ef4444 45%, transparent)', bg: 'color-mix(in oklab, #ef4444 12%, transparent)', text: 'var(--text)' },
    } as const;
    const t = toneMap[tone];
    return (
      <div
        className="mx-2 my-2 rounded-xl px-3 py-2 text-sm"
        style={{ border: `1px solid ${t.border}`, background: t.bg, color: t.text }}
      >
        {children}
      </div>
    );
  };

  if (st.trialActive) {
    return (
      <Wrap tone="amber">
        You’re using a free trial. {st.daysLeft ?? 0} day{(st.daysLeft ?? 0) === 1 ? '' : 's'} left.
        <Link href="/activate" className="ml-2 underline">Activate now</Link>
      </Wrap>
    );
  }

  if (st.canStartTrial) {
    return (
      <Wrap tone="sky">
        You haven’t started your free 7-day trial.
        <Link href="/activate" className="ml-2 underline">Start trial / Activate</Link>
      </Wrap>
    );
  }

  return (
    <Wrap tone="rose">
      Your free trial has ended. Please activate to continue.{' '}
      <Link href="/activate" className="underline">Activate</Link>{' '}
      or contact <a className="underline" href="https://axein.in" target="_blank" rel="noreferrer">axein.in</a>
      {' '}| Phone: <a className="underline" href="tel:+918999253699">+91-8999253699</a>
    </Wrap>
  );
}
