"use client";

import type { CSSProperties } from "react";
import { usePathname } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import SiteFooter from "@/components/SiteFooter";
import ClientShell from "@/components/ClientShell";
import LicenseBanner from "@/app/_components/LicenseBanner";
import AlertsBell from "@/app/_components/AlertsBell";
import ThemeToggle from "@/app/_components/ThemeToggle";

const PRINT_ROUTE_PREFIXES = [
  "/reports/tax/print",
  "/api/invoices",
  "/api/quotations",
];

function shouldHideChrome(pathname: string | null) {
  if (!pathname) return false;
  return PRINT_ROUTE_PREFIXES.some((p) => pathname.startsWith(p));
}

export default function ChromeShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const hideChrome = shouldHideChrome(pathname);

  if (hideChrome) {
    return (
      <div className="min-h-dvh" style={{ background: "white", color: "#0f172a" }}>
        <main id="main" className="p-6">
          {children}
        </main>
      </div>
    );
  }

  return (
    <div className="app-shell min-h-dvh flex flex-col">
      {/* Header */}
      <div id="site-chrome">
        <AppHeader />
      </div>

      {/* Top-right tray: Theme + Alerts */}
      <div
        className="fixed z-[70] top-3 right-3 sm:top-4 sm:right-4 pointer-events-none"
        style={
          {
            insetInlineEnd: "max(env(safe-area-inset-right, 0px), 0.75rem)",
            insetBlockStart: "max(env(safe-area-inset-top, 0px), 0.75rem)",
          } as CSSProperties
        }
        aria-label="Quick actions"
        role="region"
      >
        <div className="flex items-center gap-3">
          <div className="pointer-events-auto">
            <ThemeToggle />
          </div>
          <div className="pointer-events-auto">
            <AlertsBell />
          </div>
        </div>
      </div>

      {/* License status banner */}
      <LicenseBanner />

      {/* Main */}
      <ClientShell>
        {children}
      </ClientShell>

      {/* Footer */}
      <SiteFooter />
    </div>
  );
}
