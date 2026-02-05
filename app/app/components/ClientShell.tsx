// components/ClientShell.tsx
'use client';

import * as React from 'react';
import Sidebar from '@/components/Sidebar';
import Topbar from '@/components/Topbar';

export default function ClientShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex flex-1" style={{ background: 'var(--bg)', color: 'var(--text)' }}>
      {/* Sidebar (drawer on mobile, fixed on sm+) */}
      <Sidebar open={open} onClose={() => setOpen(false)} />

      {/* Content area */}
      <div className="flex-1 min-w-0 sm:ml-64">
        <Topbar onMenu={() => setOpen(true)} />
        <main className="app-main p-4">
          <div className="container">{children}</div>
        </main>
      </div>
    </div>
  );
}
