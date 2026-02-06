// components/ClientShell.tsx
'use client';

import * as React from 'react';
import Sidebar from '@/components/Sidebar';
import Topbar from '@/components/Topbar';

export default function ClientShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const [collapsed, setCollapsed] = React.useState(false);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  React.useEffect(() => {
    try {
      const v = localStorage.getItem("axein_sidebar_collapsed");
      if (v === "1") setCollapsed(true);
    } catch {}
  }, []);

  const toggleCollapsed = React.useCallback(() => {
    setCollapsed((v) => {
      const next = !v;
      try { localStorage.setItem("axein_sidebar_collapsed", next ? "1" : "0"); } catch {}
      return next;
    });
  }, []);

  const onBurger = React.useCallback(() => {
    if (window.matchMedia("(max-width: 639px)").matches) {
      setOpen(true);
    } else {
      toggleCollapsed();
    }
  }, [toggleCollapsed]);

  return (
    <div className="flex flex-1" style={{ background: 'var(--bg)', color: 'var(--text)' }}>
      {/* Sidebar (drawer on mobile, fixed on sm+) */}
      <Sidebar open={open} collapsed={collapsed} onClose={() => setOpen(false)} />

      {/* Content area */}
      <div className="flex-1 min-w-0">
        <Topbar onMenu={onBurger} collapsed={collapsed} />
        <main id="main" className="app-main p-4">
          <div className="container">{children}</div>
        </main>
      </div>
    </div>
  );
}
