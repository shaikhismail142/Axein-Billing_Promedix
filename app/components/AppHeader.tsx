"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

function cn(...c: Array<string | false | null | undefined>) {
  return c.filter(Boolean).join(" ");
}

function NavLink({
  href,
  label,
  exact,
  icon,
  primary,
}: {
  href: string;
  label: string;
  exact?: boolean;
  icon?: React.ReactNode;
  primary?: boolean;
}) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname?.startsWith(href || "");

  return (
    <Link
      href={href}
      className={cn("ax-navlink", active && "is-active", primary && "is-primary")}
    >
      {icon ? <span aria-hidden>{icon}</span> : null}
      {label}
    </Link>
  );
}

export default function AppHeader() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-[40]">
      {/* Glass tile wrapper */}
      <div className="mx-auto max-w-screen-2xl px-3 sm:px-4">
        <div className="ax-header mt-3">
          <div className="ax-header-inner flex h-16 items-center gap-3 px-3 sm:px-4">
            {/* Brand */}
            <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight text-[15px]">
              <span className="ax-brand-badge">
                AB
              </span>
              <span className="text-[16px] font-semibold">AxEin</span>
              <span className="text-[12px] uppercase tracking-[0.22em] opacity-60">Billing</span>
            </Link>

            {/* Desktop Nav (glassy buttons) */}
            <nav className="ml-6 hidden items-center gap-2 md:flex" aria-label="Primary">
              <NavLink href="/" label="Dashboard" exact />
              <NavLink href="/inventory" label="Inventory" />
              <NavLink href="/invoices" label="Invoices" />
              <NavLink href="/reports" label="Reports" />
              <NavLink href="/accounting" label="Accounting" />
              <NavLink href="/settings" label="Settings" />
            </nav>

            {/* Quick Billing (glassy too; NOT blue; correct URL) */}
            <div className="ml-auto hidden md:block">
              <NavLink href="/billing" label="Quick Billing" icon={<span>⚡</span>} primary />
            </div>

            {/* Spacer so the fixed top-right tray (Theme + Bell) doesn’t overlap */}
            <div className="hidden md:block h-9 w-32" aria-hidden />

            {/* Mobile menu button */}
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-controls="mobile-nav"
              className="ml-2 inline-flex h-9 w-9 items-center justify-center rounded-xl md:hidden"
              style={{
                border: "1px solid var(--glass-brd)",
                background: "color-mix(in oklab, var(--surface-1) 85%, transparent)",
                color: "var(--text)",
              }}
            >
              ☰<span className="sr-only">Toggle navigation</span>
            </button>
          </div>

          {/* Mobile Drawer */}
          {open && (
            <nav id="mobile-nav" className="px-3 pb-3 sm:px-4 md:hidden" aria-label="Primary mobile">
              <div className="grid gap-2">
                {/* Quick Billing first on mobile; glassy style */}
                <Link
                  href="/billing"
                  className="ax-navlink is-primary justify-center"
                >
                  <span aria-hidden>⚡</span> Quick Billing
                </Link>

                <NavLink href="/" label="Dashboard" exact />
                <NavLink href="/inventory" label="Inventory" />
                <NavLink href="/invoices" label="Invoices" />
                <NavLink href="/reports" label="Reports" />
                <NavLink href="/accounting" label="Accounting" />
                <NavLink href="/settings" label="Settings" />
              </div>
            </nav>
          )}
        </div>
      </div>
    </header>
  );
}
