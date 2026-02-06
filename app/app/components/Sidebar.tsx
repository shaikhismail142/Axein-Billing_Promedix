'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

type SidebarProps = { open?: boolean; onClose?: () => void; collapsed?: boolean };

const nav = [
  { href: '/', label: 'Dashboard' },
  { href: '/products', label: 'Products' },
  { href: '/quotations', label: 'Quotations' },
  { href: '/invoices', label: 'Invoices' },
  { href: '/accounting', label: 'Accounting' },
  { href: '/inventory/low-stock', label: 'Low stock' },
  { href: '/settings', label: 'Settings' },
];

export default function Sidebar({ open = false, onClose, collapsed = false }: SidebarProps) {
  const pathname = usePathname();

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  const Nav = (
    <nav className={`space-y-1 ${collapsed ? "p-3" : "p-4"}`}>
      {!collapsed && (
        <div className="mb-3 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
          AxEin Billing
        </div>
      )}
      {nav.map((item) => {
        const active =
          item.href === '/'
            ? pathname === '/'
            : pathname === item.href || pathname.startsWith(item.href + '/');
        const icon = item.label.slice(0, 1).toUpperCase();
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onClose}
            title={item.label}
            className={[
              "group flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors",
              collapsed ? "justify-center" : "",
            ].join(" ")}
            style={{
              color: 'var(--text)',
              border: `1px solid ${active ? 'color-mix(in oklab, var(--primary) 35%, transparent)' : 'transparent'}`,
              background: active
                ? 'color-mix(in oklab, var(--primary) 18%, transparent)'
                : 'transparent'
            }}
            aria-current={active ? "page" : undefined}
          >
            <span
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-xs font-semibold"
              style={{
                background: 'color-mix(in oklab, var(--surface-1) 70%, transparent)',
                border: '1px solid var(--glass-brd)',
              }}
              aria-hidden
            >
              {icon}
            </span>
            {!collapsed && <span className="truncate">{item.label}</span>}
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
        className={`sticky top-0 hidden h-[100dvh] shrink-0 sm:block transition-[width] duration-200 ${collapsed ? "w-20" : "w-64"}`}
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
