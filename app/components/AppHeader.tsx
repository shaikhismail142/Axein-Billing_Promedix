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
}: {
  href: string;
  label: string;
  exact?: boolean;
  icon?: React.ReactNode;
}) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname?.startsWith(href || "");

  const base =
    "inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm transition-colors " +
    "backdrop-blur border ring-1 " +
    "bg-white/55 border-[color:var(--glass-brd)]/70 ring-black/5 text-[var(--text)] " +
    "dark:bg-slate-900/55 dark:ring-white/10";

  return (
    <Link
      href={href}
      className={cn(
        base,
        active
          ? "shadow-sm"
          : "text-[color:var(--muted)] hover:text-[var(--text)] hover:bg-white/65 dark:hover:bg-slate-900/65"
      )}
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
        <div
          className="mt-2 rounded-2xl border border-[color:var(--glass-brd)]/70
                     bg-[var(--surface-1)]/70 backdrop-blur
                     shadow-sm ring-1 ring-black/5 dark:ring-white/10"
        >
          <div className="flex h-14 items-center gap-3 px-3 sm:px-4">
            {/* Brand */}
            <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
              <span>AxEin</span>
              <span className="opacity-60">Billing</span>
            </Link>

            {/* Desktop Nav (glassy buttons) */}
            <nav className="ml-4 hidden items-center gap-2 md:flex" aria-label="Primary">
              <NavLink href="/" label="Dashboard" exact />
              <NavLink href="/inventory" label="Inventory" />
              <NavLink href="/invoices" label="Invoices" />
              <NavLink href="/reports" label="Reports" />
              <NavLink href="/settings" label="Settings" />
            </nav>

            {/* Quick Billing (glassy too; NOT blue; correct URL) */}
            <div className="ml-auto hidden md:block">
              <NavLink href="/billing" label="Quick Billing" icon={<span>⚡</span>} />
            </div>

            {/* Spacer so the fixed top-right tray (Theme + Bell) doesn’t overlap */}
            <div className="hidden md:block h-9 w-32" aria-hidden />

            {/* Mobile menu button */}
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-controls="mobile-nav"
              className="ml-2 inline-flex h-9 w-9 items-center justify-center rounded-xl
                         ring-1 ring-black/10 bg-white/70 dark:bg-slate-900/70
                         hover:opacity-90 md:hidden"
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
                  className="inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm
                             backdrop-blur border ring-1
                             bg-white/55 border-[color:var(--glass-brd)]/70 ring-black/5 text-[var(--text)]
                             hover:bg-white/65 dark:bg-slate-900/55 dark:hover:bg-slate-900/65 dark:ring-white/10"
                >
                  <span aria-hidden>⚡</span> Quick Billing
                </Link>

                <NavLink href="/" label="Dashboard" exact />
                <NavLink href="/inventory" label="Inventory" />
                <NavLink href="/invoices" label="Invoices" />
                <NavLink href="/reports" label="Reports" />
                <NavLink href="/settings" label="Settings" />
              </div>
            </nav>
          )}
        </div>
      </div>
    </header>
  );
}
