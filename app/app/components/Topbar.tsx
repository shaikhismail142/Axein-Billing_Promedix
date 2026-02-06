'use client';

import { usePathname } from 'next/navigation';

function pageTitle(pathname: string | null) {
  if (!pathname || pathname === '/') return 'Dashboard';
  const map = [
    { prefix: '/products', label: 'Products' },
    { prefix: '/quotations', label: 'Quotations' },
    { prefix: '/invoices', label: 'Invoices' },
    { prefix: '/inventory', label: 'Inventory' },
    { prefix: '/reports', label: 'Reports' },
    { prefix: '/accounting', label: 'Accounting' },
    { prefix: '/settings', label: 'Settings' },
    { prefix: '/billing', label: 'Quick Billing' },
  ];
  const hit = map.find((m) => pathname.startsWith(m.prefix));
  return hit?.label ?? 'Workspace';
}

export default function Topbar({ onMenu, collapsed }: { onMenu: () => void; collapsed: boolean }) {
  const pathname = usePathname();
  const title = pageTitle(pathname);
  return (
    <header
      className="sticky top-0 z-30"
      style={{
        background: 'color-mix(in oklab, var(--surface-1) 80%, transparent)',
        backdropFilter: 'blur(10px) saturate(160%)',
        borderBottom: '1px solid var(--glass-brd)',
      }}
    >
      <div className="h-14 px-4 flex items-center gap-3">
        {/* Hamburger (mobile drawer + desktop collapse) */}
        <button
          onClick={onMenu}
          className="inline-flex items-center justify-center rounded-xl px-3 py-2"
          style={{ border: '1px solid var(--glass-brd)', background: 'var(--surface-1)', color: 'var(--text)' }}
          aria-label="Toggle sidebar"
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M3 6h18M3 12h18M3 18h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
        <div className="flex flex-col">
          <div className="text-[11px] uppercase tracking-[0.24em]" style={{ color: 'var(--muted)' }}>
            AxEin Billing
          </div>
          <div className="font-semibold" style={{ color: 'var(--text)' }}>
            {title}
          </div>
        </div>
        <div className="ml-auto text-xs" style={{ color: 'var(--muted)' }}>IST</div>
      </div>
    </header>
  );
}
