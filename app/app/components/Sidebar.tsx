'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

type SidebarProps = { open?: boolean; onClose?: () => void };

const nav = [
  { href: '/', label: 'Dashboard' },
  { href: '/products', label: 'Products' },
  { href: '/quotations', label: 'Quotations' },
  { href: '/invoices', label: 'Invoices' },
  { href: '/inventory/low-stock', label: 'Low stock' },
  { href: '/settings', label: 'Settings' },
];

export default function Sidebar({ open = false, onClose }: SidebarProps) {
  const pathname = usePathname();

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  const Nav = (
    <nav className="space-y-1 p-4">
      <div className="mb-3 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
        AxEin Billing
      </div>
      {nav.map((item) => {
        const active =
          item.href === '/'
            ? pathname === '/'
            : pathname === item.href || pathname.startsWith(item.href + '/');
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onClose}
            className="block rounded-xl px-3 py-2 text-sm transition-colors"
            style={{
              color: 'var(--text)',
              border: `1px solid ${active ? 'color-mix(in oklab, var(--primary) 35%, transparent)' : 'transparent'}`,
              background: active
                ? 'color-mix(in oklab, var(--primary) 14%, transparent)'
                : 'transparent'
            }}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  const CloseIcon = (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );

  return (
    <>
      {/* Mobile drawer */}
      <div
        aria-hidden={!open}
        className={[
          'fixed inset-0 z-40 sm:hidden transition',
          open ? 'pointer-events-auto' : 'pointer-events-none',
        ].join(' ')}
      >
        {/* Backdrop */}
        <div
          onClick={onClose}
          className={[
            'absolute inset-0 transition-opacity',
            open ? 'opacity-100' : 'opacity-0',
          ].join(' ')}
          style={{ background: 'rgba(0,0,0,.3)', backdropFilter: 'blur(1px)' }}
        />
        {/* Panel */}
        <aside
          className={[
            'absolute left-0 top-0 h-full w-64',
            'transition-transform',
            open ? 'translate-x-0' : '-translate-x-full',
          ].join(' ')}
          style={{
            borderRight: '1px solid var(--glass-brd)',
            background: 'var(--glass-bg)',
            backdropFilter: 'blur(10px)',
          }}
        >
          <button
            type="button"
            onClick={onClose}
            className="m-3 inline-flex items-center gap-2 rounded-xl px-3 py-1.5 text-sm"
            style={{ border: '1px solid var(--glass-brd)', background: 'var(--surface-1)' }}
          >
            {CloseIcon}
            Close
          </button>
          {Nav}
        </aside>
      </div>

      {/* Desktop / tablet (sticky) */}
      <aside
        className="sticky top-0 hidden h-[100dvh] w-64 shrink-0 sm:block"
        style={{
          borderRight: '1px solid var(--glass-brd)',
          background: 'var(--glass-bg)',
          backdropFilter: 'blur(8px)',
          position: 'sticky'
        }}
      >
        <div
          className="pointer-events-none absolute right-0 top-0 h-full w-px"
          style={{
            background: 'linear-gradient(to bottom, transparent, color-mix(in oklab, var(--text) 20%, transparent), transparent)',
            opacity: .35
          }}
        />
        {Nav}
      </aside>
    </>
  );
}
